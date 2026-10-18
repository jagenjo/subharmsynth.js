// devices/universe-worklet.js
// UNIVERSE DSP (a granular / looper / delay effect), hosted by the rack processor: a stereo granular,
// looping and delay effect. The input goes into a ring buffer (about 11 s); an effect engine plays
// "grains" from it (pieces of what was just played, at other speeds, looped, reversed, filtered,
// crushed), timed by the tempo and TIME. 11 effects x 4 variations (A-D) = 44 presets:
//   MICRO LOOP: MOSAIC, SEQ, GLIDE      GRANULES: HAZE, TUNNEL, STRUM
//   GLITCH: BLOCKS, INTERRUPT, ARP      MULTIDELAY: PATTERN, WARP
// What each variation does, and what ACTIVITY and REPEATS control in each effect, follows the pedal's
// manual (ACTIVITY: "more or less" of what the effect does; REPEATS: how long it lasts, or how often).
// How it is done is a guess. Then the resonant low-pass FILTER, pitch modulation, MIX, a stereo
// reverb with 4 modes (SPACE) and a 60 s phrase looper. HOLD freezes the buffer.

(function(){

const IN_IDS = ["in_l", "in_r", "clock_in", "hold_in", "activity_in", "mix_in"];
const OUT_IDS = ["out_l", "out_r", "clock_out", "env_out"];
const I_L = 0, I_R = 1, I_CLOCK = 2, I_HOLD = 3, I_ACT = 4, I_MIX = 5;
const O_L = 0, O_R = 1, O_CLOCK = 2, O_ENV = 3;
const RING = 1 << 19;          // samples kept (about 11 s at 48 kHz), power of two
const MASK = RING - 1;
const MAX_GRAINS = 32;
const TIMES = [4, 2, 1, 0.5, 0.25, 0.125]; // TIME: beats a step (1/4x, 1/2x, the tapped tempo, 2x, 4x, 8x)
const LOOPER_SPEEDS = [0.25, 0.5, 1, 2, 4];
const LOOPER_SECONDS = 60;
const GATE_THRESHOLD = 1;
const MIDI_CLOCK_TIMEOUT = 2;
const FDN = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116]; // reverb delay lengths at 44.1 kHz
// SPACE modes: [T60 seconds, damping, input diffusion]: ROOM, HALL, CATHEDRAL, AMBIENT WASH
const REVERBS = [[0.7, 0.45, 0.25], [2.2, 0.3, 0.35], [5, 0.2, 0.4], [14, 0.12, 0.5]];
// MULTIDELAY tap patterns, in steps
const PATTERNS = [[1, 2, 3, 4], [1, 1.5, 3, 3.5], [0.75, 1.5, 2.25, 3], [0.5, 1.25, 2, 3.5]];
const ARP = [1, 1.26, 1.5, 2, 2.52, 3, 4, 3]; // major arpeggio ratios, up then back
const F_NONE = 0, F_LP = 1, F_BP = 2;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}
function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function frac(x) { return x - Math.floor(x); }

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
		this.later = [];               // grains to start later: bursts, cascades
		this.stepPhase = 0;
		this.stepCount = 0;
		this.spawnTimer = 0;
		this.onsets = [];              // absolute positions of recent note onsets
		this.lastOnset = -1e9;         // sampleCount of the last onset
		this.envFast = 0; this.envSlow = 0; this.onsetHold = 0;
		this.duck = 1;                 // INTERRUPT: dry signal ducked during a glitch
		this.duckTimer = 0;
		this.hazeLag = 0.2;            // HAZE A: the stretched read position (seconds back)
		this.drone = { off: 0, level: 0 }; // TUNNEL
		this.tapS = new Float64Array(16); // WARP: filter state of each tap (4 taps x 4)
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
			case "loopStop":
				// FADE TIME (LOOP LEVEL's secondary): the loop fades out before it stops
				if (this.loopState === "playing" || this.loopState === "overdub") { this.loopState = this.s.loop_fade > 0.01 ? "fading" : "stopped"; this.fade = 1; }
				else if (this.loopState === "recording") this.closeLoop(), this.loopState = "stopped";
				break;
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
			case "stopped": case "fading": this.loopState = "playing"; this.loopPos = 0; break;
		}
	}

	closeLoop() {
		this.loopLen = Math.max(1, Math.floor(this.loopPos));
		if (this.s.loop_quantize) { // QUANTIZE: to the nearest beat
			const beat = 60 / this.tempo * sampleRate;
			this.loopLen = Math.min(Math.floor(this.loopPos), Math.max(Math.round(beat), Math.round(Math.round(this.loopLen / beat) * beat))) || this.loopLen;
		}
		this.loopPos = 0;
	}

	// ---- grains: a piece of the buffer, `off` samples back, `len` long, played at `rate` ----
	// o: loop (cycles through the piece for its life), life, rate2 (glides to it), cycles (rate
	// goes rate -> rate2 and back that many times), pan, gain, crush (bits), filter: [type, fc, fc2, q],
	// echoes (plays again that many times, quieter: REPEATS)
	spawn(off, len, rate, o) {
		o = o || {};
		if (this.grains.length >= MAX_GRAINS) this.grains.shift();
		off = clamp(off, 16, RING - 16);
		len = clamp(len, 16, off);
		if (this.s.fx_reverse) rate = -rate;
		const rate2 = o.rate2 === undefined ? rate : (this.s.fx_reverse ? -o.rate2 : o.rate2);
		const loop = !!o.loop;
		const life = o.life || (loop ? len * 2 : len / Math.max(0.1, (Math.abs(rate) + Math.abs(rate2)) * 0.5));
		const f = o.filter || null;
		this.grains.push({
			start: this.w - off, len: len, rate: rate, rate2: rate2, cycles: o.cycles || 0,
			age: 0, pos: rate < 0 ? len - 1 : 0, life: Math.max(32, life), loop: loop,
			pan: o.pan === undefined ? rnd(-0.6, 0.6) : o.pan, gain: o.gain === undefined ? 0.7 : o.gain,
			crush: o.crush || 0, held: 0, hx: 0, hy: 0,
			ft: f ? f[0] : F_NONE, fc: f ? f[1] : 0, fc2: f ? (f[2] || f[1]) : 0, q: f ? f[3] : 1,
			l0: 0, b0: 0, l1: 0, b1: 0,
			echoes: o.echoes === undefined ? this.echoes : o.echoes, flat: !!o.flat
		});
	}

	later_(delay, off, len, rate, o) {
		this.later.push({ at: this.sampleCount + Math.round(delay), off: off + Math.round(delay), len: len, rate: rate, o: o });
	}

	// how far back the k-th most recent note onset is (at least `len`, to have a whole grain)
	onsetOff(k, len) {
		const n = this.onsets.length;
		const pos = n ? this.onsets[Math.max(0, n - 1 - (k || 0) % n)] : this.w - this.stepLen;
		return Math.max(len, this.w - pos);
	}

	// ---- one step of the effect (every TIME) ----
	step() {
		const s = this.s, act = this.act, L = this.stepLen, sr = sampleRate;
		const fx = Math.floor(s.preset / 4), v = s.preset % 4;
		this.stepCount++;
		this.clockPulse = Math.round(0.005 * sr);
		this.flash = Math.round(0.06 * sr);
		const c = this.stepCount;
		switch (fx) {
			case 0: { // MOSAIC: overlapping loops at different speeds; ACTIVITY = loopers active
				const speeds = [[1, 2, 1, 2], [1, 0.5, 1, 0.5], [2, 2, 2, 2], [0.5, 1, 2, 4]][v];
				const n = 1 + Math.round(act * 3);
				for (let i = 0; i < n; i++)
					this.spawn(L * (1 + (i & 1)), L * (i & 1 ? 0.5 : 1), speeds[i], { loop: true, life: L * 2, gain: 0.6 / Math.sqrt(n), pan: (i / Math.max(1, n - 1) - 0.5) * 1.2 });
				break;
			}
			case 1: { // SEQ: loop samples rearranged into new sequences
				if (v === 0) { // A: filtered, shuffled samples in random rhythms; ACTIVITY adds filter variation
					if (Math.random() < 0.85) {
						const fc = 9000 * Math.pow(2, -Math.random() * act * 5);
						this.spawn(L * Math.floor(rnd(1, 5)), L, 1, { filter: [F_LP, fc, fc, 1.2], life: L });
					}
				}
				else if (v === 1) { // B: normal / half speed, ACTIVITY the bounce between them; full: a sustainer
					const half = c % 2 === 0 && Math.random() < act;
					this.spawn(L, half ? L / 2 : L, half ? 0.5 : 1, { life: L });
					if (act > 0.95 && c % 4 === 0) this.spawn(L * 2, L, 0.5, { loop: true, life: L * 4, gain: 0.3, flat: true, filter: [F_LP, 1200, 1200, 1.4], echoes: 0 });
				}
				else if (v === 2) { // C: overlapping layers with filter sweeps; ACTIVITY adds layers
					const n = 1 + Math.round(act * 3);
					for (let i = 0; i < n; i++) {
						const up = Math.random() < 0.5;
						this.spawn(L * Math.floor(rnd(1, 4)), L / 2, 1, { loop: true, life: L * 2, gain: 0.55 / Math.sqrt(n), filter: [F_BP, up ? 300 : 5000, up ? 5000 : 300, 0.6] });
					}
				}
				else { // D: interlocking rhythmic layers, bit-crushed; full: crushed sub octave
					const n = 1 + Math.round(act * 2);
					for (let i = 0; i < n; i++)
						this.spawn(L, L / (i + 2), 1, { loop: true, life: L, gain: 0.5, crush: 6 });
					if (act > 0.95) this.spawn(L, L / 2, 0.5, { life: L, crush: 4, gain: 0.45 });
				}
				break;
			}
			case 2: { // GLIDE: short overlapping loops pitch-shifting; ACTIVITY = how fast, SHAPE = the pattern
				const pairs = [[0.5, 1], [2, 0.5], [1, 2], [0.5, 2]][v];
				const cyc = 0.5 + act * 3;
				this.spawn(L, L / 2, pairs[0], { rate2: pairs[1], cycles: cyc, loop: true, life: L * 2, gain: 0.5, flat: true });
				if (v === 3) this.spawn(L, L / 2, pairs[1], { rate2: pairs[0], cycles: cyc, loop: true, life: L * 2, gain: 0.5, flat: true });
				break;
			}
			case 4: // TUNNEL: a new drone source every 8 steps (D: on each note)
				if (v !== 3 && c % 8 === 1) this.drone.off = Math.min(this.w, Math.round(L * 2));
				break;
			case 5: { // STRUM: chains of recent note onsets; ACTIVITY = density
				const len = Math.min(L, 0.4 * sr);
				if (v === 0) { // A: the most recent note again and again
					this.spawn(this.onsetOff(0, len), len, 1, { gain: 0.65 });
					if (Math.random() < act) this.later_(L / 2, this.onsetOff(0, len), len, 1, { gain: 0.55 });
				}
				else if (v === 1) { // B: many overlapping copies of the last onset: phasing
					const n = 2 + Math.round(act * 6);
					for (let i = 0; i < n; i++)
						this.later_(i * 0.006 * sr, this.onsetOff(0, len), len, 1 + (i - n / 2) * 0.0025, { gain: 0.6 / Math.sqrt(n) });
				}
				else { // C: cascading chains of recent onsets (D: + double speed grains)
					const n = 1 + Math.round(act * 6), gap = L / (n + 1);
					for (let i = 0; i < n; i++) {
						const dbl = v === 3 && i % 2 === 1;
						this.later_(i * gap, this.onsetOff(i, len), dbl ? len / 2 : len, dbl ? 2 : 1, { gain: 0.6 * Math.pow(0.85, i) });
					}
				}
				break;
			}
			case 6: { // BLOCKS: glitches and bursts of notes; ACTIVITY = variation and manipulation
				if (Math.random() < 0.35 + act * 0.5) {
					if (v === 2) { // C: filtered overlapping samples that fade out: a softer glitch
						const fc = rnd(600, 3000);
						this.spawn(this.onsetOff(Math.floor(Math.random() * 3), L), L, 1, { loop: true, life: L * 3, gain: 0.5, filter: [F_LP, fc, fc * 0.3, 1] });
						break;
					}
					const burst = 2 + Math.floor(Math.random() * (1 + act * 6)), len = L / 4;
					for (let i = 0; i < burst; i++) {
						const k = Math.floor(Math.random() * 4);
						const rate = v === 0 ? 1 : (Math.random() < 0.3 + act * 0.6 ? pick([0.5, 1.5, 2, v === 3 ? -1 : 1]) : 1);
						this.later_(i * len, this.onsetOff(k, len), len, rate, { crush: v === 3 ? 6 : 0, gain: 0.6, echoes: 0 });
					}
				}
				break;
			}
			case 7: { // INTERRUPT: glitches cut into the dry signal; REPEATS = how often, ACTIVITY = variation
				if (Math.random() < 0.08 + s.repeats * 0.8) {
					const len = L / 2, n = 1 + Math.floor(act * 3);
					for (let i = 0; i < n; i++) {
						const off = this.onsetOff(Math.floor(Math.random() * 3), len / n);
						if (v === 0) this.later_(i * len / n, off, len / n, 1, { gain: 0.85, echoes: 0 });
						else if (v === 1) this.later_(i * len / n, off, len / n, pick([0.5, 2, 1.5, 0.75]), { gain: 0.85, echoes: 0 });
						else if (v === 2) { const up = Math.random() < 0.5; this.later_(i * len / n, off, len / n, 1, { gain: 0.8, echoes: 2, filter: [F_BP, up ? 300 : 4000, up ? 4000 : 300, 0.5] }); }
						else this.later_(i * len / n, off, len / n, pick([-1, 4, 0.5, -2]), { gain: 0.85, crush: 5, echoes: 0 });
					}
					this.duckTimer = len;
				}
				break;
			}
			case 8: { // ARP: recent samples as arpeggios; ACTIVITY = number of steps
				const n = 2 + Math.round(act * 6), k = c % n, len = Math.min(L, 0.3 * sr);
				let rate = ARP[k];
				if (v === 1) rate = [1, 2, 0.5, 1.5, 3, 0.75, 2, 1][(c * 5) % 8] ; // pitch-shifted speeds
				this.spawn(this.onsetOff(0, len), len, rate, {
					gain: 0.6, crush: v === 3 ? 6 : 0,
					filter: v === 2 ? [F_LP, 300 * Math.pow(2, Math.random() * 5), 0, 2] : null
				});
				break;
			}
			case 10: { // WARP C (pitch-shifted taps) and D (double speed grains): grains on each step
				const n = 1 + Math.round(act * 3);
				if (v === 2)
					for (let k = 0; k < n; k++) this.spawn(L * PATTERNS[0][k], L, k % 2 ? 0.5 : 2, { life: L, gain: 0.5 * Math.pow(0.8, k), echoes: 0 });
				if (v === 3) this.spawn(L, L / 2, 2, { gain: 0.45, life: L, echoes: 0 });
				break;
			}
		}
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
		this.stepLen = Math.max(64, 60 / this.tempo * TIMES[clamp(s.subdiv | 0, 0, TIMES.length - 1)] * sr);
		this.act = clamp(s.activity + (this.patched[I_ACT] ? this.ins[I_ACT] / 5 : 0), 0, 1);
		this.mix = clamp(s.mix + (this.patched[I_MIX] ? this.ins[I_MIX] / 5 : 0), 0, 1);
		this.fx = Math.floor(s.preset / 4);
		// REPEATS: echoes of each grain (INTERRUPT: how often; TUNNEL: decay; MULTIDELAY: feedback)
		this.echoes = this.fx === 7 || this.fx === 4 || this.fx >= 9 ? 0 : Math.floor(s.repeats * 6.99);
		this.fc = 2 * Math.sin(Math.PI * Math.min(150 * Math.pow(120, s.filter), sr * 0.2) / (2 * sr));
		this.q = 2 - s.resonance * 1.9;
		if (!this.fdn) {
			const k = sr / 44100;
			this.fdn = FDN.map(l => new Float32Array(Math.round(l * k) + 1));
			this.fdnPos = new Int32Array(FDN.length);
			this.fdnLp = new Float64Array(FDN.length);
			this.fdnOut = new Float64Array(FDN.length);
		}
		const rv = REVERBS[clamp(s.reverb_mode | 0, 0, 3)];
		this.fdnG = this.fdn.map(b => Math.pow(10, -3 * b.length / (rv[0] * sr)));
		this.fdnDamp = rv[1];
	}

	readBuf(buf, pos) {
		const i = Math.floor(pos), f = pos - i;
		const a = buf[i & MASK], b = buf[(i + 1) & MASK];
		return a + (b - a) * f;
	}

	// grain envelope from SHAPE: percussive (0), flat (0.5), swelling (1)
	env(t, flat) {
		const sh = flat ? 0.5 : this.s.shape;
		const a = 0.01 + sh * sh * 0.7, r = sh < 0.5 ? 0.95 - sh * 1.6 : 0.15;
		let e = t < a ? t / a : 1;
		if (t > 1 - r) e *= (1 - t) / r;
		return sh < 0.25 ? e * Math.exp(-t * (1 - sh * 4) * 3) : e;
	}

	// the continuous effects: HAZE (clusters of grains) and TUNNEL (drone loops)
	continuous() {
		const s = this.s, sr = sampleRate, act = this.act, v = s.preset % 4, L = this.stepLen;
		if (this.fx === 3 && --this.spawnTimer <= 0) { // HAZE; ACTIVITY = grain density and spread
			this.spawnTimer = Math.round((0.22 - act * 0.2) * sr * rnd(0.6, 1.4) * (v === 1 ? 0.5 : 1));
			const len = (0.05 + (1 - act) * 0.15) * sr * rnd(0.7, 1.3), spread = (0.05 + act * 1.5) * sr;
			let off, rate = 1;
			if (v === 0) { // A: stretched overlapping samples: the read position lags behind, slowly
				this.hazeLag += 0.5 * (0.22 - act * 0.2) * rnd(0.6, 1.4);
				if (this.hazeLag > 1.5) this.hazeLag = 0.15;
				off = this.hazeLag * sr + len;
			}
			else off = len + Math.random() * spread;
			if (v === 1) rate = 1 + rnd(-0.01, 0.01);
			if (v === 2) rate = pick([1, 2]);
			if (v === 3) rate = pick([1, 0.5]);
			this.spawn(off, len, rate, { gain: v === 1 ? 0.3 : 0.4, echoes: 0, pan: rnd(-0.9, 0.9) });
		}
		if (this.fx === 4) { // TUNNEL: overlapping drone loops; ACTIVITY = how deep the modifier, REPEATS = decay
			const d = this.drone;
			if (v === 3 && this.sampleCount === this.lastOnset) { d.off = Math.min(this.w, Math.round(L * 2)); }
			d.level *= Math.exp(-1 / ((0.4 + s.repeats * s.repeats * 20) * sr));
			if (this.sampleCount - this.lastOnset < 64) d.level = 1;
			if (--this.spawnTimer <= 0) {
				this.spawnTimer = Math.round(L / 2);
				if (!d.off) d.off = Math.min(this.w, Math.round(L * 2));
				d.off += Math.round(L / 2); // the source stays put as the buffer moves on
				if (d.off > RING - L * 2) d.off = Math.round(L * 2);
				const t = this.sampleCount / sr;
				let len = L * 0.5, rate = 1, filter = null;
				if (v === 0) len *= 1 - act * 0.85 * (0.5 + 0.5 * Math.sin(t * 0.9)); // A: compresses and lengthens
				if (v === 1) { rate = 0.5; const fc = 400 * Math.pow(2, act * 3 * (1 + Math.sin(t * 0.6))); filter = [F_LP, fc, fc, 1]; } // B: sub octave, filter sweeps
				if (v === 2) { const fc = pick([250, 500, 1000, 2000]) * (1 + 0.5 * act * Math.sin(t * 0.4)); filter = [F_BP, fc, fc, 0.5 - act * 0.3]; } // C: resonant band passes (louder below)
				if (v === 3) len *= 0.1 + 0.9 * Math.min(1, (this.sampleCount - this.lastOnset) / (L * (2 + act * 6))); // D: per note
				if (d.level > 0.003)
					this.spawn(d.off, Math.max(256, len), rate, { loop: true, life: L * 1.2, gain: (v === 2 ? 2 : 0.5) * d.level, filter: filter, echoes: 0, flat: true });
			}
		}
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, patched = this.patched, sr = sampleRate;
		const inL = ins[I_L], inR = patched[I_R] ? ins[I_R] : inL;
		const fx = this.fx, v = s.preset % 4;

		// ---- CV: HOLD (toggles on a gate), CLOCK (each pulse a step, its rate the tempo) ----
		if (this.gateEdge(I_HOLD)) this.holdCv = !this.holdCv;
		const hold = s.hold !== !!this.holdCv;
		let stepNow = false;
		if (patched[I_CLOCK]) {
			if (this.gateEdge(I_CLOCK)) {
				if (this.lastClockIn > 0) this.clockTempo = clamp(60 * sr / (this.sampleCount - this.lastClockIn) * TIMES[s.subdiv | 0], 30, 300);
				this.lastClockIn = this.sampleCount;
				stepNow = true;
			}
		}
		else {
			this.stepPhase += 1 / this.stepLen;
			if (this.stepPhase >= 1) { this.stepPhase -= 1; stepNow = true; }
		}

		// ---- onset detection on the input (STRUM, BLOCKS, ARP, INTERRUPT, TUNNEL D) ----
		const a = Math.abs(inL) + Math.abs(inR);
		this.envFast += (a - this.envFast) * 0.01;
		this.envSlow += (a - this.envSlow) * 0.0005;
		if (this.onsetHold > 0) this.onsetHold--;
		else if (this.envFast > this.envSlow * 1.8 && this.envFast > 0.02 && !hold) {
			this.onsets.push(this.w);
			if (this.onsets.length > 16) this.onsets.shift();
			this.onsetHold = Math.round(0.08 * sr);
			this.lastOnset = this.sampleCount;
		}

		if (!s.bypass && !s.looper_only) {
			if (stepNow) this.step();
			for (let i = this.later.length - 1; i >= 0; i--) {
				const e = this.later[i];
				if (this.sampleCount >= e.at) { this.spawn(e.off, e.len, e.rate, e.o); this.later.splice(i, 1); }
			}
			this.continuous();
		}

		// ---- the grains ----
		this.modPh += (0.05 + s.mod_rate * 8) / sr;
		if (this.modPh >= 1) this.modPh -= 1;
		const mod = 1 + Math.sin(2 * Math.PI * this.modPh) * s.mod_depth * 0.03;
		const shape = s.shape, k2 = 2 * Math.PI / sr;
		let wl = 0, wr = 0;
		for (let i = this.grains.length - 1; i >= 0; i--) {
			const g = this.grains[i];
			let t = g.age / g.life;
			let p = g.pos;
			if (t >= 1 || (!g.loop && (p < 0 || p >= g.len))) {
				if (g.echoes > 0) { // REPEATS: once more, quieter
					g.echoes--; g.age = 0; g.gain *= 0.6; g.pos = p = g.rate < 0 ? g.len - 1 : 0; t = 0;
				}
				else { this.grains.splice(i, 1); continue; }
			}
			// rate: glides rate -> rate2 over its life, or back and forth (GLIDE: SHAPE is the pattern)
			let r;
			if (g.cycles) {
				const ph = frac(t * g.cycles);
				const pat = shape < 0.33 ? ph : (shape < 0.66 ? 1 - Math.abs(2 * ph - 1) : 0.5 - 0.5 * Math.cos(2 * Math.PI * ph));
				r = g.rate + (g.rate2 - g.rate) * pat;
			}
			else r = g.rate + (g.rate2 - g.rate) * t;
			if (g.loop) p = ((p % g.len) + g.len) % g.len;
			let x = this.readBuf(this.bufL, g.start + p), y = this.readBuf(this.bufR, g.start + p);
			// a short fade at the loop seam
			if (g.loop) { const edge = Math.min(p, g.len - p) / Math.min(256, g.len * 0.25); if (edge < 1) { x *= edge; y *= edge; } }
			if (g.crush) {
				if (g.held-- <= 0) { g.hx = x; g.hy = y; g.held = 3; }
				const qz = 1 << g.crush;
				x = Math.round(g.hx * qz) / qz; y = Math.round(g.hy * qz) / qz;
			}
			if (g.ft) { // the grain's own filter (state variable), its cutoff sweeping fc -> fc2
				const f = Math.min(0.9, k2 * (g.fc + (g.fc2 - g.fc) * t)), q = Math.min(g.q, 1.95 - f); // stable
				let h = x - g.l0 - q * g.b0; g.b0 += f * h; g.l0 += f * g.b0;
				h = y - g.l1 - q * g.b1; g.b1 += f * h; g.l1 += f * g.b1;
				if (g.ft === F_LP) { x = g.l0; y = g.l1; } else { x = g.b0 * q * 1.5; y = g.b1 * q * 1.5; }
			}
			const e = this.env(t, g.flat) * g.gain;
			wl += x * (1 - Math.max(0, g.pan)) * e;
			wr += y * (1 + Math.min(0, g.pan)) * e;
			g.pos += r * mod;
			g.age++;
		}

		// ---- MULTIDELAY taps: PATTERN, WARP A (envelope filter) and B (resonant band pass) ----
		if (!s.bypass && !s.looper_only && (fx === 9 || (fx === 10 && v < 2))) {
			const pat = PATTERNS[fx === 9 ? v : 0];
			const n = 1 + Math.round(this.act * 3), wob = (mod - 1) * 400, T = this.tapS;
			for (let k = 0; k < n; k++) {
				const d = pat[k] * this.stepLen + wob;
				let x = this.readBuf(this.bufL, this.w - d), y = this.readBuf(this.bufR, this.w - d);
				if (fx === 10) {
					const fc = v === 0 ? 250 + Math.min(1, this.envFast * 3) * 6000 : [500, 900, 1600, 2800][k];
					const f = Math.min(1.2, k2 * fc), q = v === 0 ? 0.9 : 0.15, o = k * 4;
					let h = x - T[o] - q * T[o + 1]; T[o + 1] += f * h; T[o] += f * T[o + 1];
					h = y - T[o + 2] - q * T[o + 3]; T[o + 3] += f * h; T[o + 2] += f * T[o + 3];
					if (v === 0) { x = T[o]; y = T[o + 2]; } else { x = T[o + 1] * 0.5; y = T[o + 3] * 0.5; }
				}
				const gk = 0.75 * Math.pow(0.8, k), pan = k % 2 ? 0.5 : -0.5;
				wl += x * gk * (1 - Math.max(0, pan));
				wr += y * gk * (1 + Math.min(0, pan));
			}
		}

		// ---- filter (resonant low-pass, 2x) on the wet signal ----
		const f = this.fc, q = this.q;
		for (let k = 0; k < 2; k++) {
			let h = wl - this.lpL[0] - q * this.lpL[1]; this.lpL[1] += f * h; this.lpL[0] += f * this.lpL[1]; this.lpL[1] = fastTanh(this.lpL[1]);
			h = wr - this.lpR[0] - q * this.lpR[1]; this.lpR[1] += f * h; this.lpR[0] += f * this.lpR[1]; this.lpR[1] = fastTanh(this.lpR[1]);
		}
		wl = this.lpL[0] * s.fx_volume; wr = this.lpR[0] * s.fx_volume;

		// ---- the buffer: the input (MULTIDELAY: + REPEATS, the taps fed back); HOLD freezes it ----
		if (!hold) {
			const fb = fx >= 9 ? s.repeats * 0.85 : 0;
			this.bufL[this.w & MASK] = fastTanh(inL + wl * fb);
			this.bufR[this.w & MASK] = fastTanh(inR + wr * fb);
			this.w++;
		}

		// ---- MIX, then SPACE (reverb of everything) ----
		if (this.duckTimer > 0) { this.duckTimer--; this.duck += (0.1 - this.duck) * 0.01; }
		else this.duck += (1 - this.duck) * 0.002;
		const m = s.looper_only ? 0 : this.mix;
		const dryG = Math.min(1, 2 * (1 - m)) * (fx === 7 && !s.bypass ? this.duck : 1);
		const wetG = s.bypass ? 0 : Math.min(1, 2 * m);
		let ol = inL * dryG + wl * wetG, or = inR * dryG + wr * wetG;
		if (s.space > 0.001 && !s.bypass) {
			const F = this.fdn, P = this.fdnPos, G = this.fdnG, LP = this.fdnLp, n = F.length, o8 = this.fdnOut;
			let sum = 0;
			for (let k = 0; k < n; k++) { o8[k] = F[k][P[k]]; sum += o8[k]; }
			const inv = 2 / n, damp = this.fdnDamp;
			let rl = 0, rr = 0;
			for (let k = 0; k < n; k++) {
				const x = sum * inv - o8[k]; // Householder feedback
				LP[k] += (x - LP[k]) * (1 - damp);
				F[k][P[k]] = (k % 2 ? or : ol) * 0.35 + LP[k] * G[k];
				P[k] = (P[k] + 1) % F[k].length;
				if (k % 2) rr += o8[k]; else rl += o8[k];
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
			else if (this.loopState === "playing" || this.loopState === "overdub" || this.loopState === "fading") {
				const len = this.loopLen, sp = LOOPER_SPEEDS[clamp(s.looper_speed | 0, 0, LOOPER_SPEEDS.length - 1)] * (s.reverse ? -1 : 1);
				const p = ((this.loopPos % len) + len) % len;
				const i = Math.floor(p), j = (i + 1) % len, fr = p - i;
				const pl = this.loopL[i] + (this.loopL[j] - this.loopL[i]) * fr, pr = this.loopR[i] + (this.loopR[j] - this.loopR[i]) * fr;
				if (this.loopState === "overdub") { this.loopL[i] = clamp(this.loopL[i] + recL * 0.8, -2, 2); this.loopR[i] = clamp(this.loopR[i] + recR * 0.8, -2, 2); }
				let lv = s.loop_level;
				if (this.loopState === "fading") {
					this.fade -= 1 / (Math.max(0.01, s.loop_fade) * sampleRate);
					if (this.fade <= 0) { this.fade = 0; this.loopState = "stopped"; }
					lv *= this.fade;
				}
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
