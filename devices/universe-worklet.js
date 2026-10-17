// devices/universe-worklet.js
// UNIVERSE DSP (a replica of the Hologram Microcosm), hosted by the rack processor: a stereo granular,
// looping and delay effect. The input goes into a ring buffer (about 11 s); an effect engine plays
// "grains" from it (pieces of what was just played, at other speeds, looped, reversed, crushed),
// timed by the tempo and its subdivision. 11 effects x 4 variations (A-D) = 44 presets:
//   MICRO LOOP: MOSAIC, SEQ, GLIDE      GRANULES: HAZE, TUNNEL, STRUM
//   GLITCH: BLOCKS, INTERRUPT, ARP      MULTIDELAY: PATTERN, WARP
// Then the resonant low-pass FILTER, pitch modulation, REPEATS (the wet signal fed back into the
// buffer), a stereo reverb (SPACE), MIX, and a 60 s phrase looper. HOLD freezes the buffer.
// Each effect's algorithm follows the manual's description of what it does; the details are guesses.

(function(){

const IN_IDS = ["in_l", "in_r", "clock_in", "hold_in", "activity_in", "mix_in"];
const OUT_IDS = ["out_l", "out_r", "clock_out", "env_out"];
const I_L = 0, I_R = 1, I_CLOCK = 2, I_HOLD = 3, I_ACT = 4, I_MIX = 5;
const O_L = 0, O_R = 1, O_CLOCK = 2, O_ENV = 3;
const RING = 1 << 19;          // samples kept (about 11 s at 48 kHz), power of two
const MASK = RING - 1;
const MAX_GRAINS = 24;
const SUBDIVS = [0.25, 1 / 3, 0.5, 2 / 3, 1, 2, 4]; // beats: 1/16, 1/8T, 1/8, 1/4T, 1/4, 1/2, 1/1
const LOOPER_SPEEDS = [0.25, 0.5, 1, 2, 4];
const LOOPER_SECONDS = 60;
const GATE_THRESHOLD = 1;
const MIDI_CLOCK_TIMEOUT = 2;
const FDN = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116]; // reverb delay lengths at 44.1 kHz

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}
function pick(l) { return l[Math.floor(Math.random() * l.length)]; }

class UniverseDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.bufL = new Float32Array(RING);
		this.bufR = new Float32Array(RING);
		this.w = 0;                    // absolute write position (samples written)
		this.grains = [];
		this.stepPhase = 0;
		this.stepCount = 0;
		this.spawnTimer = 0;
		this.onsets = [];              // absolute positions of recent note onsets
		this.envFast = 0; this.envSlow = 0; this.onsetHold = 0;
		this.duck = 1;                 // INTERRUPT: dry signal ducked during a burst
		this.duckTimer = 0;
		this.modPh = 0;
		this.lpL = [0, 0]; this.lpR = [0, 0];
		this.fdn = null; this.fdnPos = null;
		this.host = null;              // the rack processor: its tempo for SYNC
		this.tempo = 120;
		this.lastMidiClock = -1e12; this.midiTickTimes = []; this.sampleCount = 0;
		this.lastClockIn = -1;
		this.clockPulse = 0;
		// phrase looper
		this.loopL = null; this.loopR = null;
		this.loopState = "empty";      // empty, recording, playing, overdub, stopped
		this.loopLen = 0; this.loopPos = 0;
		this.flash = 0;
	}

	message(m) {
		switch (m.type) {
			case "looper": this.looperFoot(); break;
			case "loopStop": if (this.loopState === "playing" || this.loopState === "overdub") this.loopState = "stopped"; else if (this.loopState === "recording") this.closeLoop(), this.loopState = "stopped"; break;
			case "loopErase": this.loopState = "empty"; this.loopLen = 0; this.loopPos = 0; break;
			case "clearHold": this.grains = []; break;
			case "midiClock": this.midiTickTimes.push(this.sampleCount); if (this.midiTickTimes.length > 25) this.midiTickTimes.shift(); this.lastMidiClock = this.sampleCount; break;
		}
	}

	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	// ---- phrase looper: REC -> PLAY -> OVERDUB -> PLAY ... ----
	looperFoot() {
		if (!this.loopL) {
			this.loopL = new Float32Array(LOOPER_SECONDS * sampleRate);
			this.loopR = new Float32Array(LOOPER_SECONDS * sampleRate);
		}
		switch (this.loopState) {
			case "empty": this.loopState = "recording"; this.loopLen = 0; this.loopPos = 0; break;
			case "recording": this.closeLoop(); this.loopState = "playing"; break;
			case "playing": this.loopState = "overdub"; break;
			case "overdub": this.loopState = "playing"; break;
			case "stopped": this.loopState = "playing"; this.loopPos = 0; break;
		}
	}

	closeLoop() {
		this.loopLen = Math.max(1, Math.floor(this.loopPos));
		this.loopPos = 0;
	}

	// ---- grains: a piece of the buffer, `off` samples back, `len` long, played at `rate` ----
	spawn(off, len, rate, o) {
		o = o || {};
		if (this.grains.length >= MAX_GRAINS) this.grains.shift();
		off = clamp(off, 16, RING - 16);
		len = clamp(len, 16, off);
		const loop = !!o.loop;
		const life = o.life || (loop ? len * 2 : len / Math.abs(rate));
		this.grains.push({
			start: this.w - off, len: len, rate: rate, rate2: o.rate2 === undefined ? rate : o.rate2,
			age: 0, pos: rate < 0 ? len - 1 : 0, life: Math.max(32, life), loop: loop,
			pan: o.pan === undefined ? (Math.random() * 2 - 1) * 0.6 : o.pan, gain: o.gain === undefined ? 0.7 : o.gain,
			crush: o.crush || 0, held: 0
		});
	}

	// how far back the k-th most recent note onset is (at least `len`, to have a whole grain)
	onsetOff(k, len) {
		const n = this.onsets.length;
		const pos = n ? this.onsets[Math.max(0, n - 1 - (k || 0))] : this.w - this.stepLen;
		return Math.max(len, this.w - pos);
	}

	// ---- one step of the effect (every subdivision) ----
	step() {
		const s = this.s, act = this.act, L = this.stepLen;
		const fx = Math.floor(s.preset / 4), v = s.preset % 4;
		this.stepCount++;
		this.clockPulse = Math.round(0.005 * sampleRate);
		this.flash = Math.round(0.06 * sampleRate);
		switch (fx) {
			case 0: { // MOSAIC: overlapping loops at multiple speeds
				const sets = [[1, 2], [1, 2, 0.5], [2, 4, 1], [1, -1, 2, -2]][v];
				const n = 1 + Math.round(act * (sets.length - 1));
				for (let i = 0; i < n; i++) {
					const r = sets[i];
					this.spawn(L, L / Math.max(1, Math.abs(r)), r, { loop: true, life: L * 2, gain: 0.55 });
				}
				break;
			}
			case 1: { // SEQ: sequenced samples alternate between normal and half speed
				const half = (this.stepCount % 2 === 0) ? Math.random() < 0.3 + act * 0.7 : false;
				this.spawn(L, L, half ? 0.5 : 1, { life: L * (half ? 2 : 1), crush: v === 2 || (v === 3 && act > 0.8) ? 6 : 0 });
				if (v === 1 && this.stepCount % 4 === 0) this.spawn(L * 2, L, 0.5, { loop: true, life: L * 4, gain: 0.35 }); // sustainer
				if (v === 3 && act > 0.8) this.spawn(L, L, 0.5, { life: L * 2, crush: 4, gain: 0.45 });                         // crushed sub octave
				break;
			}
			case 2: { // GLIDE: short overlapping loops that shift in pitch
				const pairs = [[[0.5, 1]], [[2, 0.5]], [[1, 2]], [[0.5, 2], [2, 0.5]]][v];
				const n = 1 + Math.round(act * 2);
				for (let i = 0; i < n; i++) {
					const p = pairs[i % pairs.length];
					this.spawn(L, L / 2, p[0], { rate2: p[1], loop: true, life: L * 2, gain: 0.5 });
				}
				break;
			}
			case 5: { // STRUM: chains of recent note onsets
				const n = v === 0 ? 1 : 1 + Math.round(act * 6);
				const k = this.stepCount % n;
				const len = Math.min(L, 0.4 * sampleRate);
				const rate = v === 2 && k % 2 ? 2 : (v === 3 && k % 3 === 2 ? -1 : 1);
				this.spawn(this.onsetOff(k, len), len, rate, { gain: 0.65 });
				break;
			}
			case 6: { // BLOCKS: incoming audio triggers glitches and bursts of notes
				if (Math.random() < 0.25 + act * 0.6) {
					const burst = 2 + Math.floor(Math.random() * (2 + act * 5));
					const len = L / 4;
					for (let i = 0; i < burst; i++) {
						const rate = v === 0 ? 1 : (v === 3 && Math.random() < 0.4 ? -1 : pick([0.5, 1, 1.5, 2]));
						this.spawnLater(i * len, this.onsetOff(Math.floor(Math.random() * 4), len), len, rate, { crush: v >= 2 ? 6 : 0, gain: 0.6 });
					}
				}
				break;
			}
			case 7: { // INTERRUPT: glitches interrupt the dry signal with pitch shifted bursts
				if (Math.random() < 0.15 + act * 0.6) {
					const len = L / 2;
					const rates = [[1], [2, 0.5], [2, 0.5, 1.5], [-1, 4, 0.5]][v];
					const n = 1 + Math.floor(act * 3);
					for (let i = 0; i < n; i++)
						this.spawnLater(i * len / n, len, len / n, pick(rates), { crush: v >= 2 ? 5 : 0, gain: 0.8 });
					this.duckTimer = len;
				}
				break;
			}
			case 8: { // ARP: samples of recent notes as arpeggios
				const pat = [1, 1.26, 1.5, 2, 2.52, 3];
				const n = 2 + Math.round(act * 4);
				let k = this.stepCount % n;
				if (v === 1) { const c = this.stepCount % (2 * n - 2 || 1); k = c < n ? c : 2 * n - 2 - c; }
				if (v === 2) k = Math.floor(Math.random() * n);
				const len = Math.min(L, 0.3 * sampleRate);
				this.spawn(this.onsetOff(0, len), len, pat[k] * (v === 2 && Math.random() < 0.3 ? 0.5 : 1), { crush: v === 3 ? 6 : 0, gain: 0.6 });
				break;
			}
			case 10: { // WARP: delay taps cross-fade with double speed grains
				const amount = [0.25, 0.5, 0.75, 0.5][v];
				this.spawn(L, L / 2, v === 3 ? -2 : 2, { gain: amount, life: L });
				break;
			}
		}
	}

	spawnLater(delay, off, len, rate, o) {
		(this.later = this.later || []).push({ at: this.sampleCount + Math.round(delay), off: off + Math.round(delay), len: len, rate: rate, o: o });
	}

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising;
	}

	beginBlock(n) {
		const s = this.s, sr = sampleRate;
		// tempo: MIDI clock > CLOCK in > SYNC (the rack's tempo) > its own TEMPO (set by TAP too)
		const midi = (this.sampleCount - this.lastMidiClock) < MIDI_CLOCK_TIMEOUT * sr && this.midiTickTimes.length > 4;
		if (midi) {
			const t = this.midiTickTimes, d = (t[t.length - 1] - t[0]) / (t.length - 1);
			this.tempo = clamp(60 * sr / (d * 24), 30, 300);
		}
		else if (this.clockTempo && this.patched[I_CLOCK]) this.tempo = this.clockTempo;
		else if (s.sync && this.host && this.host.tempo > 0) this.tempo = this.host.tempo;
		else this.tempo = clamp(s.tempo, 30, 300);
		this.stepLen = Math.max(64, 60 / this.tempo * SUBDIVS[clamp(s.subdiv | 0, 0, SUBDIVS.length - 1)] * sr);
		this.act = clamp(s.activity + (this.patched[I_ACT] ? this.ins[I_ACT] / 5 : 0), 0, 1);
		this.mix = clamp(s.mix + (this.patched[I_MIX] ? this.ins[I_MIX] / 5 : 0), 0, 1);
		this.fc = 2 * Math.sin(Math.PI * Math.min(150 * Math.pow(120, s.filter), sr * 0.2) / (2 * sr));
		this.q = 2 - s.resonance * 1.9;
		if (!this.fdn) {
			const k = sr / 44100;
			this.fdn = FDN.map(l => new Float32Array(Math.round(l * k) + 1));
			this.fdnPos = new Int32Array(FDN.length);
			this.fdnLp = new Float64Array(FDN.length);
			this.fdnOut = new Float64Array(FDN.length);
		}
		const t60 = 0.4 + s.reverb_time * 9.6;
		this.fdnG = this.fdn.map(b => Math.pow(10, -3 * b.length / (t60 * sr)));
	}

	readBuf(buf, pos) {
		const i = Math.floor(pos), f = pos - i;
		const a = buf[i & MASK], b = buf[(i + 1) & MASK];
		return a + (b - a) * f;
	}

	// grain envelope from SHAPE: percussive (0), flat (0.5), swelling (1)
	env(t) {
		const sh = this.s.shape;
		const a = 0.01 + sh * sh * 0.7, r = sh < 0.5 ? 0.95 - sh * 1.6 : 0.15;
		let e = t < a ? t / a : 1;
		if (t > 1 - r) e *= (1 - t) / r;
		return sh < 0.25 ? e * Math.exp(-t * (1 - sh * 4) * 3) : e;
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, patched = this.patched, sr = sampleRate;
		const inL = ins[I_L], inR = patched[I_R] ? ins[I_R] : inL;
		const fx = Math.floor(s.preset / 4), v = s.preset % 4;

		// ---- CV: HOLD (toggles on a gate), CLOCK (each pulse a step, its rate the tempo) ----
		if (this.gateEdge(I_HOLD)) this.holdCv = !this.holdCv;
		const hold = s.hold !== !!this.holdCv;
		let stepNow = false;
		if (patched[I_CLOCK]) {
			if (this.gateEdge(I_CLOCK)) {
				if (this.lastClockIn > 0) this.clockTempo = clamp(60 * sr / (this.sampleCount - this.lastClockIn) * SUBDIVS[s.subdiv | 0], 30, 300);
				this.lastClockIn = this.sampleCount;
				stepNow = true;
			}
		}
		else {
			this.stepPhase += 1 / this.stepLen;
			if (this.stepPhase >= 1) { this.stepPhase -= 1; stepNow = true; }
		}

		// ---- onset detection on the input (STRUM, BLOCKS, ARP) ----
		const a = Math.abs(inL) + Math.abs(inR);
		this.envFast += (a - this.envFast) * 0.01;
		this.envSlow += (a - this.envSlow) * 0.0005;
		if (this.onsetHold > 0) this.onsetHold--;
		else if (this.envFast > this.envSlow * 1.8 && this.envFast > 0.02 && !hold) {
			this.onsets.push(this.w);
			if (this.onsets.length > 16) this.onsets.shift();
			this.onsetHold = Math.round(0.08 * sr);
		}

		if (!s.bypass) {
			if (stepNow) this.step();
			if (this.later) {
				for (let i = this.later.length - 1; i >= 0; i--) {
					const e = this.later[i];
					if (this.sampleCount >= e.at) { this.spawn(e.off, e.len, e.rate, e.o); this.later.splice(i, 1); }
				}
			}
			// continuous effects: HAZE (clusters of grains), TUNNEL (drone loops changing length)
			if (fx === 3 && --this.spawnTimer <= 0) {
				this.spawnTimer = Math.round((0.2 - this.act * 0.185) * sr * (0.6 + Math.random() * 0.8));
				const len = (0.06 + s.shape * 0.2) * sr * (0.7 + Math.random() * 0.6);
				const rate = [1 + (Math.random() - 0.5) * 0.006, pick([1, 2]), pick([1, 0.5]), pick([1, -1])][v];
				this.spawn(len + Math.random() * 1.5 * sr, len, rate, { gain: 0.45 });
			}
			if (fx === 4 && --this.spawnTimer <= 0) {
				this.spawnTimer = Math.round(this.stepLen);
				const base = this.stepLen * (0.05 + this.act * 0.45) * (1 + 0.5 * Math.sin(this.sampleCount / sr * 0.7));
				const rates = [[1], [1, 2], [0.5, 1], [1, -1]][v];
				for (const r of rates) this.spawn(this.stepLen * 2, base, r, { loop: true, life: this.stepLen * 2.2, gain: 0.5 });
			}
		}

		// ---- the grains ----
		const modRate = 0.05 + s.mod_rate * 8;
		this.modPh += modRate / sr;
		if (this.modPh >= 1) this.modPh -= 1;
		const mod = 1 + Math.sin(2 * Math.PI * this.modPh) * s.mod_depth * 0.03;
		let wl = 0, wr = 0;
		for (let i = this.grains.length - 1; i >= 0; i--) {
			const g = this.grains[i];
			const t = g.age / g.life;
			if (t >= 1) { this.grains.splice(i, 1); continue; }
			const rate = (g.rate + (g.rate2 - g.rate) * t) * mod;
			let p = g.pos;
			if (g.loop) { p = ((p % g.len) + g.len) % g.len; }
			else if (p < 0 || p >= g.len) { this.grains.splice(i, 1); continue; }
			let x = this.readBuf(this.bufL, g.start + p), y = this.readBuf(this.bufR, g.start + p);
			// a short fade at the loop seam
			if (g.loop) { const edge = Math.min(p, g.len - p) / Math.min(256, g.len * 0.25); if (edge < 1) { x *= edge; y *= edge; } }
			if (g.crush) {
				if (g.held-- <= 0) { g.hx = x; g.hy = y; g.held = 3; }
				const qz = 1 << g.crush;
				x = Math.round(g.hx * qz) / qz; y = Math.round(g.hy * qz) / qz;
			}
			const e = this.env(t) * g.gain;
			wl += (x * (1 - Math.max(0, g.pan)) ) * e;
			wr += (y * (1 + Math.min(0, g.pan)) ) * e;
			g.pos += rate;
			g.age++;
		}

		// ---- MULTIDELAY taps: PATTERN (and WARP) read the buffer at rhythmic offsets ----
		if (!s.bypass && (fx === 9 || fx === 10)) {
			const pats = fx === 9 ? [[1, 2, 3, 4], [1, 1.5, 2.5, 3], [0.75, 1.5, 2.25, 3], [0.5, 1, 1.75, 2.5]][v] : [1, 2, 3, 4];
			const n = 1 + Math.round(this.act * 3), wob = (mod - 1) * 400;
			for (let k = 0; k < n; k++) {
				const d = pats[k] * this.stepLen + wob;
				const gk = 0.7 * Math.pow(0.75, k) * (fx === 10 ? 1 - [0.25, 0.5, 0.75, 0.5][v] : 1);
				const pan = k % 2 ? 0.5 : -0.5;
				wl += this.readBuf(this.bufL, this.w - d) * gk * (1 - Math.max(0, pan));
				wr += this.readBuf(this.bufR, this.w - d) * gk * (1 + Math.min(0, pan));
			}
		}

		// ---- filter (resonant low-pass, 2x) on the wet signal ----
		const f = this.fc, q = this.q;
		for (let k = 0; k < 2; k++) {
			let h = wl - this.lpL[0] - q * this.lpL[1]; this.lpL[1] += f * h; this.lpL[0] += f * this.lpL[1]; this.lpL[1] = fastTanh(this.lpL[1]);
			h = wr - this.lpR[0] - q * this.lpR[1]; this.lpR[1] += f * h; this.lpR[0] += f * this.lpR[1]; this.lpR[1] = fastTanh(this.lpR[1]);
		}
		wl = this.lpL[0]; wr = this.lpR[0];

		// ---- the buffer: the input plus REPEATS (the wet signal fed back); HOLD freezes it ----
		if (!hold) {
			const fb = s.repeats * 0.85;
			this.bufL[this.w & MASK] = fastTanh(inL + wl * fb);
			this.bufR[this.w & MASK] = fastTanh(inR + wr * fb);
			this.w++;
		}

		// ---- MIX, then SPACE (reverb of everything) ----
		if (this.duckTimer > 0) { this.duckTimer--; this.duck += (0.1 - this.duck) * 0.01; }
		else this.duck += (1 - this.duck) * 0.002;
		const m = this.mix;
		const dryG = Math.min(1, 2 * (1 - m)) * (fx === 7 && !s.bypass ? this.duck : 1);
		const wetG = s.bypass ? 0 : Math.min(1, 2 * m);
		let ol = inL * dryG + wl * wetG, or = inR * dryG + wr * wetG;
		if (s.space > 0.001 && !s.bypass) {
			const F = this.fdn, P = this.fdnPos, G = this.fdnG, LP = this.fdnLp;
			const n = F.length, outs8 = this.fdnOut;
			let sum = 0;
			for (let k = 0; k < n; k++) { outs8[k] = F[k][P[k]]; sum += outs8[k]; }
			const inv = 2 / n, damp = 0.3;
			let rl = 0, rr = 0;
			for (let k = 0; k < n; k++) {
				const x = (sum * inv - outs8[k]); // Householder feedback
				LP[k] += (x - LP[k]) * (1 - damp);
				F[k][P[k]] = (k % 2 ? or : ol) * 0.35 + LP[k] * G[k];
				P[k] = (P[k] + 1) % F[k].length;
				if (k % 2) rr += outs8[k]; else rl += outs8[k];
			}
			ol += rl * s.space * 0.5;
			or += rr * s.space * 0.5;
		}

		// ---- phrase looper: post (or pre) effects ----
		if (this.loopL && this.loopState !== "empty") {
			const recL = s.looper_pre ? inL : ol, recR = s.looper_pre ? inR : or;
			const max = this.loopL.length;
			if (this.loopState === "recording") {
				const i = Math.floor(this.loopPos);
				if (i < max) { this.loopL[i] = recL; this.loopR[i] = recR; this.loopPos++; }
				else { this.closeLoop(); this.loopState = "playing"; }
			}
			else if (this.loopState === "playing" || this.loopState === "overdub") {
				const len = this.loopLen, sp = LOOPER_SPEEDS[clamp(s.looper_speed | 0, 0, LOOPER_SPEEDS.length - 1)] * (s.reverse ? -1 : 1);
				let p = ((this.loopPos % len) + len) % len;
				const i = Math.floor(p), j = (i + 1) % len, fr = p - i;
				const pl = this.loopL[i] + (this.loopL[j] - this.loopL[i]) * fr, pr = this.loopR[i] + (this.loopR[j] - this.loopR[i]) * fr;
				if (this.loopState === "overdub") { this.loopL[i] = clamp(this.loopL[i] + recL * 0.8, -2, 2); this.loopR[i] = clamp(this.loopR[i] + recR * 0.8, -2, 2); }
				const lv = s.loop_level;
				if (s.looper_only) { ol = inL * dryG; or = inR * dryG; }
				ol += pl * lv; or += pr * lv;
				this.loopPos = p + sp;
			}
		}

		outs[O_L] = ol;
		outs[O_R] = or;
		outs[O_CLOCK] = this.clockPulse > 0 ? 5 : 0;
		if (this.clockPulse > 0) this.clockPulse--;
		outs[O_ENV] = clamp(this.envFast * 5, 0, 8);
		this.sampleCount++;
		return 0;
	}

	endBlock(n) { this.flash = Math.max(0, this.flash - n); }

	state() {
		return {
			tempo: this.tempo, step: this.flash > 0, grains: this.grains.length, hold: this.s.hold !== !!this.holdCv,
			loop: this.loopState, loop_len: this.loopLen / sampleRate,
			loop_pos: this.loopLen ? (((this.loopPos % this.loopLen) + this.loopLen) % this.loopLen) / this.loopLen : (this.loopState === "recording" ? this.loopPos / sampleRate : 0),
			level: Math.min(1, this.envFast)
		};
	}
}
UniverseDSP.OUT_IDS = OUT_IDS;
UniverseDSP.IN_IDS = IN_IDS;
UniverseDSP.MIDI_IN = "midi_in";

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.universe = UniverseDSP;

})();
