// devices/mount-worklet.js
// MOUNT DSP: 8 voices of 3 oscillators (sine, triangle, saw, pulse or one of
// 8 wavetables, each shaped by SHAPE: manual, MOD ENV 1, LFO 1), pitch modulated by MOD ENV 2 and
// LFO 2; the mixer (OSC 1-3, RING 1*2, NOISE, VCA GAIN), a per-voice state variable filter (LP / BP /
// HP, 12 or 24 dB, resonance, overdrive, MOD ENV 1 and / or AMP ENV, LFO 1, OSC 3 FM, key tracking),
// three AHDSR envelopes, two LFOs (fade, low / high / sync), glide, unison, mono / legato, a
// 6 slot modulation matrix (with ANIMATE 1 / 2 and CV MOD IN as sources), the arpeggiator, and the
// effects: distortion, chorus, delay, reverb. It gets the raw notes of its MIDI channel (POLY).
(function(){

const IN_IDS = ["cv_in"];
const OUT_IDS = ["out_l","out_r"];
const VOICES = 8;
const CTRL = 16;
const C4 = 261.6255653005986;
const RANGE_OCT = [-1, 0, 1, 2];          // 16', 8', 4', 2' (8' plays C4 on C4)
const WAVES = ["sine","tri","saw","pulse","more"];
const TABLE_N = 1024, FRAMES = 8, TABLES = 8;
const SYNC_DIVS = [16, 12, 8, 6, 4, 3, 2, 1.5, 1, 0.75, 2 / 3, 0.5, 0.375, 1 / 3, 0.25, 0.1875, 1 / 6, 0.125, 1 / 12]; // beats

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}
function polyblep(t, dt) {
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}

// ---- the 8 wavetables ("more"), 8 frames each, from spectra ----
const TABLE_DATA = (() => {
	const out = [];
	let seed = 1;
	const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	for (let t = 0; t < TABLES; t++) {
		const frames = [];
		for (let f = 0; f < FRAMES; f++) {
			const x = f / (FRAMES - 1), amp = new Float32Array(65);
			for (let h = 1; h <= 64; h++) {
				let a = 0;
				switch (t) {
					case 0: a = h <= 2 + x * 62 ? 1 / h : 0; break;                                   // BRIGHT: harmonics added
					case 1: { const F = 300 + x * 2500, G = 1100 + x * 1400; a = Math.exp(-Math.pow((h * 110 - F) / 160, 2)) + 0.6 * Math.exp(-Math.pow((h * 110 - G) / 220, 2)) + (h == 1 ? 0.5 : 0); break; } // VOCAL
					case 2: { const bars = [1, 0.8 * (1 - x), 0.6, 0.5 * x, 0, 0.5 * x, 0, 0.4 * x]; a = h <= 8 ? bars[h - 1] : 0; break; } // ORGAN
					case 3: a = h % 2 ? 1 / Math.pow(h, 2 - 1.5 * x) : 0; break;                      // ODD
					case 4: { const pw = 0.5 - x * 0.46; a = Math.abs(Math.sin(Math.PI * h * pw)) / h; break; } // PULSE SWEEP
					case 5: a = rnd() < 0.35 + x * 0.3 ? rnd() / Math.sqrt(h) : 0; break;              // DIGITAL
					case 6: a = h == 1 ? 1 : (h % 2 ? 0.1 / h : (0.3 + x) / Math.sqrt(h)); break;      // HOLLOW
					default: { const r = 1 + x * 5; a = Math.abs(Math.sin(Math.PI * (h - r))) / (Math.abs(h - r) + 0.5) / Math.sqrt(h) * 2; } // SYNC
				}
				amp[h] = a;
			}
			const w = new Float32Array(TABLE_N + 1);
			let peak = 0;
			for (let i = 0; i < TABLE_N; i++) {
				let v = 0;
				for (let h = 1; h <= 64; h++) if (amp[h]) v += amp[h] * Math.sin(2 * Math.PI * h * i / TABLE_N);
				w[i] = v; peak = Math.max(peak, Math.abs(v));
			}
			for (let i = 0; i < TABLE_N; i++) w[i] /= peak || 1;
			w[TABLE_N] = w[0];
			frames.push(w);
		}
		out.push(frames);
	}
	return out;
})();

function oscSample(wave, t, dt, shape, table) {
	switch (wave) {
		case 0: { // sine, the phase bent by SHAPE
			const k = (shape - 0.5) * 1.6, p = t + k * t * (1 - t) * (1 - 2 * t) * 2;
			return Math.sin(2 * Math.PI * p);
		}
		case 1: { // triangle, its peak moved by SHAPE (toward a saw)
			const pk = clamp(0.5 + (shape - 0.5) * 0.96, 0.02, 0.98);
			return t < pk ? -1 + 2 * t / pk : 1 - 2 * (t - pk) / (1 - pk);
		}
		case 2: { // saw, SHAPE adds a second saw a fraction of a cycle away
			const s1 = 2 * t - 1 - polyblep(t, dt);
			const off = shape * 0.5; if (off < 0.01) return s1;
			let t2 = t + off; if (t2 >= 1) t2 -= 1;
			return (s1 + 2 * t2 - 1 - polyblep(t2, dt)) * 0.6;
		}
		case 3: { // pulse, SHAPE = width
			const pw = clamp(0.5 + (shape - 0.5) * 0.92, 0.04, 0.96);
			let t2 = t + 1 - pw; if (t2 >= 1) t2 -= 1;
			return (t < pw ? 1 : -1) + polyblep(t, dt) - polyblep(t2, dt);
		}
		default: { // a wavetable, SHAPE scans its frames
			const fr = TABLE_DATA[table], fp = clamp(shape, 0, 1) * (FRAMES - 1), f0 = fp | 0, f1 = Math.min(FRAMES - 1, f0 + 1), ff = fp - f0;
			const p = t * TABLE_N, i = p | 0, fi = p - i, a = fr[f0], b = fr[f1];
			const va = a[i] + (a[i + 1] - a[i]) * fi, vb = b[i] + (b[i + 1] - b[i]) * fi;
			return va + (vb - va) * ff;
		}
	}
}

function newEnv() { return { stage: 0, v: 0, t: 0 }; }   // stage: 0 idle, 1 attack, 2 hold, 3 decay/sustain, 4 release
function newVoice() {
	return { note: 60, vel: 1, gate: false, age: 0, active: false, pitch: 0, target: 0, ph: new Float64Array(3), inc: new Float64Array(3),
		shape: new Float32Array(3), amp: newEnv(), e1: newEnv(), e2: newEnv(), lfoFade: [0, 0], pan: 0, detune: 0, k: 0,
		f1: [0, 0], f2: [0, 0], g: 0.1, kq: 1.4, vca: 0, vcaT: 0, ampScale: 1, o3: 0, fcOct: 0, filterMod: 0, panNow: 0, noiseLvl: 0, osc3fm: 0 };
}

// a TPT state variable filter step: s = [ic1, ic2]; returns [lp, bp, hp]
function svf(s, x, g, k) {
	const a1 = 1 / (1 + g * (g + k)), v3 = x - s[1];
	const v1 = a1 * s[0] + g * a1 * v3, v2 = s[1] + g * v1;
	s[0] = 2 * v1 - s[0]; s[1] = 2 * v2 - s[1];
	return [v2, v1, x - k * v1 - v2];
}

class MountDSP {
	constructor() {
		this.s = null;
		this.host = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.sr = sampleRate;
		this.voices = []; for (let i = 0; i < VOICES; i++) this.voices.push(newVoice());
		this.clock = 0;
		this.stack = [];
		this.bend = 0; this.wheel = 0; this.anim = [0, 0];
		this.lfo = [{ ph: 0, v: 0, sh: 0 }, { ph: 0, v: 0, sh: 0 }];
		this.k = 0;
		// arpeggiator
		this.held = []; this.arpPhase = 0; this.arpIndex = -1; this.arpNote = -1; this.arpOff = 0; this.arpDir = 1; this.arpOct = 0;
		this.midiTicks = 0; this.lastMidiClock = -1e12; this.sampleCount = 0;
		// effects
		this.chorusBuf = [new Float32Array(4096), new Float32Array(4096)]; this.cpos = 0; this.cph = 0;
		const dl = Math.round(this.sr * 1.5);
		this.delayBuf = [new Float32Array(dl), new Float32Array(dl)]; this.dpos = 0; this.dlp = [0, 0]; this.dTime = 0.3 * this.sr;
		this.rev = this.makeReverb();
		this.dc = [0, 0, 0, 0];
	}

	makeReverb() {
		const sr = this.sr, s = sr / 44100;
		const combs = [1116, 1188, 1277, 1356, 1422, 1491].map(n => Math.round(n * s));
		const aps = [556, 441, 341].map(n => Math.round(n * s));
		const mk = (spread) => ({ c: combs.map(n => ({ b: new Float32Array(n + spread), p: 0, lp: 0 })), a: aps.map(n => ({ b: new Float32Array(n + spread), p: 0 })) });
		return [mk(0), mk(Math.round(23 * s))];
	}

	setSettings(s) { this.s = s; }
	setMidiConnected(c) {
		if (!c && this.midiConnected) this.message({ type: "allNotesOff" });
		this.midiConnected = c;
	}

	message(m) {
		switch (m.type) {
			case "note": m.on ? this.keyOn(m.note, m.vel === undefined ? 1 : m.vel) : this.keyOff(m.note); break;
			case "allNotesOff": this.held = []; this.stack = []; for (const v of this.voices) if (v.gate) this.release(v); break;
			case "bend": this.bend = m.value; break;
			case "wheel": this.wheel = m.value; break;
			case "anim": this.anim[m.n] = m.on ? 1 : 0; break;
			case "trigger": if (m.gate) this.keyOn(60, 1); else this.keyOff(60); break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.midiTicks = 0; this.arpIndex = -1; break;
		}
	}

	// ---- keys: the arpeggiator, or the voices ----
	keyOn(note, vel) {
		const a = this.s.arp;
		if (a.on) {
			if (a.latch && this.held.length && !this.held.some(h => h[2])) this.held = [];
			this.held = this.held.filter(h => h[0] !== note);
			this.held.push([note, vel, true]);
			return;
		}
		this.voiceOn(note, vel);
	}
	keyOff(note) {
		const a = this.s.arp;
		if (a.on) {
			if (a.latch) { const h = this.held.find(h => h[0] === note); if (h) h[2] = false; }
			else this.held = this.held.filter(h => h[0] !== note);
			return;
		}
		this.voiceOff(note);
	}

	unison() { return [1, 2, 4][this.s.voice.unison] || 1; }

	voiceOn(note, vel) {
		const s = this.s, mode = s.voice.mode;
		if (mode !== "poly") {
			const legato = mode === "legato" && this.stack.length > 0;
			this.stack = this.stack.filter(n => n !== note); this.stack.push(note);
			const u = this.unison();
			for (let i = 0; i < u; i++) {
				const v = this.voices[i];
				v.note = note; v.vel = vel; v.gate = true; v.active = true; v.age = ++this.clock;
				v.detune = u > 1 ? (i / (u - 1) - 0.5) * s.voice.detune : 0; v.pan = u > 1 ? (i / (u - 1) - 0.5) * 1.6 : 0;
				if (!legato) this.trigger(v);
				if (!(s.glide.on && s.glide.time > 0.001) || !legato && !this.stackWas) v.pitch = v.target = this.notePitch(v);
				this.voiceControl(v); // its pitch, filter and levels from the first sample
			}
			for (let i = u; i < VOICES; i++) if (this.voices[i].gate) this.release(this.voices[i]);
			this.stackWas = true;
			return;
		}
		const u = this.unison(), groups = VOICES / u;
		// a free group of voices (or the oldest)
		let best = -1, bestAge = 1e15;
		for (let gi = 0; gi < groups; gi++) {
			const v = this.voices[gi * u];
			const score = v.gate ? 1e9 + v.age : (v.active ? 1e8 + v.age : v.age);
			if (score < bestAge) { bestAge = score; best = gi; }
		}
		for (let i = 0; i < u; i++) {
			const v = this.voices[best * u + i];
			const glide = s.glide.on && s.glide.time > 0.001 && v.active;
			v.note = note; v.vel = vel; v.gate = true; v.active = true; v.age = ++this.clock;
			v.detune = u > 1 ? (i / (u - 1) - 0.5) * s.voice.detune : 0;
			v.pan = u > 1 ? (i / (u - 1) - 0.5) * 1.6 : ((best % 2) ? 0.15 : -0.15);
			if (!glide) v.pitch = v.target = this.notePitch(v);
			this.trigger(v);
			this.voiceControl(v);
		}
	}

	voiceOff(note) {
		const s = this.s;
		if (s.voice.mode !== "poly") {
			this.stack = this.stack.filter(n => n !== note);
			if (this.stack.length) { const n = this.stack[this.stack.length - 1]; for (let i = 0; i < this.unison(); i++) this.voices[i].note = n; }
			else { for (const v of this.voices) if (v.gate) this.release(v); this.stackWas = false; }
			return;
		}
		for (const v of this.voices) if (v.gate && v.note === note) this.release(v);
	}

	trigger(v) {
		if (this.s.lfo_retrig && !this.voices.some(o => o.gate && o !== v)) { this.lfo[0].ph = 0; this.lfo[1].ph = 0; } // KEY SYNC
		for (const e of [v.amp, v.e1, v.e2]) { e.stage = 1; e.t = 0; }
		v.lfoFade[0] = v.lfoFade[1] = 0;
	}
	release(v) { v.gate = false; for (const e of [v.amp, v.e1, v.e2]) if (e.stage) e.stage = 4; }

	notePitch(v) { return (v.note - 60) / 12; }

	// ---- AHDSR at control rate ----
	env(e, p, gate) {
		const sr = this.sr, dt = CTRL / sr;
		switch (e.stage) {
			case 1: e.v += dt / Math.max(0.0005, p.a) * 1.0; if (e.v >= 1) { e.v = 1; e.stage = 2; e.t = 0; } break;
			case 2: e.t += dt; if (e.t >= (p.h || 0)) e.stage = 3; break;
			case 3: e.v += (p.s - e.v) * (1 - Math.exp(-dt / Math.max(0.001, p.d) * 4.6)); break;
			case 4: e.v += (0 - e.v) * (1 - Math.exp(-dt / Math.max(0.001, p.r) * 4.6)); if (e.v < 1e-4) { e.v = 0; e.stage = 0; } break;
		}
		return e.v;
	}

	// ---- the arpeggiator ----
	arpTempo() {
		const a = this.s.arp;
		return a.tempo;
	}
	arpTick() {
		const a = this.s.arp;
		if (!a.on) { if (this.arpNote >= 0) { this.voiceOff(this.arpNote); this.arpNote = -1; } return; }
		let step = false;
		if (this.sampleCount - this.lastMidiClock < 0.5 * this.sr) { while (this.midiTicks >= 6) { this.midiTicks -= 6; step = true; } }
		else {
			const sw = (this.arpCount & 1 ? 1 - a.swing : 1 + a.swing);
			this.arpPhase += 1 / (60 * this.sr / (this.arpTempo() * 4) * sw);
			if (this.arpPhase >= 1) { this.arpPhase -= Math.floor(this.arpPhase); step = true; }
		}
		if (this.arpOff > 0 && --this.arpOff === 0 && this.arpNote >= 0) { this.voiceOff(this.arpNote); this.arpNote = -1; }
		if (!step) return;
		this.arpCount = (this.arpCount || 0) + 1;
		if (this.arpNote >= 0) { this.voiceOff(this.arpNote); this.arpNote = -1; }
		if (!this.held.length) { this.arpIndex = -1; return; }
		let notes = this.held.map(h => h[0]);
		if (a.pattern !== 4) notes.sort((x, y) => x - y);
		const oct = clamp(a.octaves, 1, 4), all = [];
		for (let o = 0; o < oct; o++) for (const n of notes) all.push(n + 12 * o);
		const n = all.length;
		if (a.pattern === 1) this.arpIndex = (this.arpIndex + n - 1 + (this.arpIndex < 0 ? 1 : 0)) % n;
		else if (a.pattern === 2) {
			if (n === 1) this.arpIndex = 0;
			else { let i = this.arpIndex + this.arpDir; if (i >= n) { this.arpDir = -1; i = n - 2; } else if (i < 0) { this.arpDir = 1; i = 1; } this.arpIndex = i; }
		}
		else if (a.pattern === 3) this.arpIndex = Math.floor(Math.random() * n);
		else this.arpIndex = (this.arpIndex + 1) % n;
		if (a.pattern === 1 && this.arpIndex < 0) this.arpIndex = n - 1;
		const note = all[clamp(this.arpIndex, 0, n - 1)], h = this.held.find(x => (note - x[0]) % 12 === 0);
		this.voiceOn(note, h ? h[1] : 1);
		this.arpNote = note;
		this.arpOff = Math.max(1, Math.round(60 * this.sr / (this.arpTempo() * 4) * clamp(a.gate, 0.05, 1)));
	}

	// ---- the modulation matrix: per voice sources ----
	modSources(v) {
		return { lfo1: this.lfo[0].v * v.lfoFade[0], lfo2: this.lfo[1].v * v.lfoFade[1], env1: v.e1.v, env2: v.e2.v, amp: v.amp.v, vel: v.vel,
			wheel: this.wheel, key: (v.note - 60) / 24, cv: this.patched[0] ? clamp(this.ins[0] / 5, -1, 1) : 0, anim1: this.anim[0], anim2: this.anim[1] };
	}

	beginBlock() {}

	control() {
		const s = this.s, sr = this.sr, dt = CTRL / sr;
		// the LFOs (global; each voice fades them in)
		const g = this.globalMods();
		for (let i = 0; i < 2; i++) {
			const p = s.lfo[i], L = this.lfo[i];
			let hz;
			if (p.range === "sync") hz = this.arpTempo() / 60 / SYNC_DIVS[Math.round(clamp(p.rate, 0, 1) * (SYNC_DIVS.length - 1))];
			else hz = p.range === "low" ? 0.01 * Math.pow(300, p.rate) : 0.3 * Math.pow(200, p.rate);
			hz *= Math.pow(2, (i ? g.lfo2_rate : g.lfo1_rate) * 3);
			const old = L.ph;
			L.ph += hz * dt; if (L.ph >= 1) L.ph -= Math.floor(L.ph);
			if (L.ph < old) L.sh = Math.random() * 2 - 1;
			const ph = L.ph;
			L.v = p.type === "saw" ? 1 - 2 * ph : (p.type === "square" ? (ph < 0.5 ? 1 : -1) : (p.type === "sh" ? L.sh : 1 - 4 * Math.abs(ph - 0.5)));
		}
		this.g = g;
		this.arpGlobal = 0;
	}

	// matrix destinations from the global sources only (LFO rates)
	globalMods() {
		const s = this.s, src = { lfo1: this.lfo[0].v, lfo2: this.lfo[1].v, env1: 0, env2: 0, amp: 0, vel: 0, wheel: this.wheel, key: 0,
			cv: this.patched[0] ? clamp(this.ins[0] / 5, -1, 1) : 0, anim1: this.anim[0], anim2: this.anim[1] };
		const o = { lfo1_rate: 0, lfo2_rate: 0, dist: 0 };
		for (const m of s.mod) if (o[m.dst] !== undefined && src[m.src] !== undefined) o[m.dst] += src[m.src] * m.depth;
		return o;
	}

	voiceControl(v) {
		const s = this.s, sr = this.sr, dt = CTRL / sr;
		const amp = this.env(v.amp, s.amp, v.gate), e1 = this.env(v.e1, s.env1, v.gate), e2 = this.env(v.e2, s.env2, v.gate);
		if (!v.amp.stage && !v.gate) { v.active = false; return; }
		for (let i = 0; i < 2; i++) { const fade = s.lfo[i].fade; v.lfoFade[i] = fade > 0.01 ? Math.min(1, v.lfoFade[i] + dt / (fade * 10)) : 1; } // FADE TIME
		// the matrix
		const src = this.modSources(v), d = { pitch: 0, osc1_pitch: 0, osc2_pitch: 0, osc3_pitch: 0, shape: 0, filter: 0, res: 0, vca: 0, noise: 0, pan: 0 };
		for (const m of s.mod) if (d[m.dst] !== undefined && src[m.src] !== undefined) d[m.dst] += src[m.src] * m.depth;
		// pitch, with glide
		v.target = this.notePitch(v);
		const gl = s.glide.on && s.glide.time > 0.001 ? 1 - Math.exp(-dt / s.glide.time * 3) : 1;
		v.pitch += (v.target - v.pitch) * gl;
		const lfo2 = src.lfo2, bend = this.bend * s.voice.bend / 2;
		for (let k = 0; k < 3; k++) {
			const o = s.osc[k];
			let p = v.pitch + RANGE_OCT[o.range] + (o.coarse + o.fine / 100) / 12 + v.detune / 12 + bend
				+ o.env2 * e2 * 2 + o.lfo2 * lfo2 / 2 + d.pitch * 2 + d["osc" + (k + 1) + "_pitch"] * 2 + s.voice.tune / 1200;
			v.inc[k] = clamp(C4 * Math.pow(2, p) / sr, 0, 0.45);
			const sh = o.shape;
			v.shape[k] = clamp(sh.manual + sh.env1 * e1 + sh.lfo1 * src.lfo1 * 0.5 + d.shape, 0, 1);
		}
		// filter
		const f = s.filter;
		let oct = Math.log2(20) + f.freq * Math.log2(1000) + f.track * (v.note - 60) / 12
			+ f.env * 7 * ((f.src_env1 ? e1 : 0) + (f.src_amp ? amp : 0)) + f.lfo1 * src.lfo1 * 3 + d.filter * 5;
		v.fcOct = oct;
		const fc = clamp(Math.pow(2, oct), 15, sr * 0.45);
		v.g = Math.tan(Math.PI * fc / sr);
		v.kq = 2 - 1.96 * clamp(f.res + d.res, 0, 1);
		v.osc3fm = f.osc3 * 4;
		// VCA: the amp envelope, velocity, gain
		const vel = 1 - s.voice.vel * (1 - v.vel);
		v.vcaT = amp * vel * clamp(1 + d.vca, 0, 2);
		v.noiseLvl = clamp(s.mix.noise + d.noise, 0, 1);
		v.panNow = clamp(v.pan + d.pan, -1, 1);
	}

	tick() {
		const s = this.s, sr = this.sr, outs = this.outs;
		if (this.k-- <= 0) {
			this.k = CTRL - 1;
			this.control();
			for (const v of this.voices) if (v.active) this.voiceControl(v);
		}
		this.arpTick();
		const mx = s.mix, f = s.filter, w = [WAVES.indexOf(s.osc[0].wave), WAVES.indexOf(s.osc[1].wave), WAVES.indexOf(s.osc[2].wave)];
		const lv = [mx.osc1 * mx.osc1, mx.osc2 * mx.osc2, mx.osc3 * mx.osc3], ring = mx.ring * mx.ring;
		const drive = 1 + f.drive * 6, shape = f.shape, slope24 = f.slope === 24;
		let L = 0, R = 0;
		for (const v of this.voices) {
			if (!v.active) continue;
			// oscillators (OSC 3 also runs for the filter FM)
			let o1 = 0, o2 = 0, o3 = 0;
			const need3 = lv[2] > 0 || f.osc3 > 0;
			for (let k = 0; k < 3; k++) {
				if (k === 2 && !need3) continue;
				if (k < 2 && lv[k] === 0 && ring === 0) continue;
				let t = v.ph[k] + v.inc[k]; if (t >= 1) t -= 1; v.ph[k] = t;
				const y = oscSample(w[k], t, v.inc[k], v.shape[k], s.osc[k].table);
				if (k === 0) o1 = y; else if (k === 1) o2 = y; else o3 = y;
			}
			let x = o1 * lv[0] + o2 * lv[1] + o3 * lv[2] + o1 * o2 * ring;
			if (v.noiseLvl > 0) x += (Math.random() * 2 - 1) * v.noiseLvl * v.noiseLvl;
			x = fastTanh(x * 0.5 * drive) / Math.min(drive, 2.2) * 1.4;
			// the filter (TPT state variable, inline), OSC 3 sweeping its frequency
			let g = v.g;
			if (v.osc3fm > 0) g = Math.tan(clamp(Math.atan(g) * Math.pow(2, o3 * v.osc3fm), 0.0005, 1.5));
			let s1 = v.f1, k = v.kq, a1 = 1 / (1 + g * (g + k)), v3 = x - s1[1];
			let b1 = a1 * s1[0] + g * a1 * v3, l1 = s1[1] + g * b1;
			s1[0] = 2 * b1 - s1[0]; s1[1] = 2 * l1 - s1[1];
			let out = shape === "lp" ? l1 : (shape === "bp" ? b1 : x - k * b1 - l1);
			if (slope24) {
				const s2 = v.f2, a2 = 1 / (1 + g * (g + 1.4)), w3 = out - s2[1];
				const b2 = a2 * s2[0] + g * a2 * w3, l2 = s2[1] + g * b2;
				s2[0] = 2 * b2 - s2[0]; s2[1] = 2 * l2 - s2[1];
				out = shape === "lp" ? l2 : (shape === "bp" ? b2 * 1.4 : out - 1.4 * b2 - l2);
			}
			v.vca += (v.vcaT - v.vca) * 0.02;
			out *= v.vca * mx.vca * 0.9;
			L += out * (1 - v.panNow) * 0.5 + out * 0.5; R += out * (1 + v.panNow) * 0.5 + out * 0.5;
		}
		L *= 0.45; R *= 0.45;
		// ---- effects: distortion, then chorus, delay, reverb (BYPASS: only the distortion) ----
		const fx = s.fx, dist = clamp(fx.dist + this.g.dist, 0, 1);
		if (dist > 0.001) { const k = 1 + dist * 20; L = fastTanh(L * k) / Math.sqrt(k) * 1.2; R = fastTanh(R * k * 1.02) / Math.sqrt(k) * 1.2; }
		if (!fx.bypass) {
			const c = fx.chorus;
			if (c.level > 0.001) {
				const rate = 0.1 + c.rate * 4, depth = [0.0012, 0.003, 0.006][c.type] || 0.003;
				this.cph += rate / sr; if (this.cph >= 1) this.cph -= 1;
				const tri = 1 - 4 * Math.abs(this.cph - 0.5), n = 4096;
				const bl = this.chorusBuf[0], br = this.chorusBuf[1];
				bl[this.cpos] = L; br[this.cpos] = R;
				let pl = this.cpos - (0.007 + depth * tri) * sr; if (pl < 0) pl += n;
				let pr = this.cpos - (0.007 - depth * tri) * sr; if (pr < 0) pr += n;
				const il = pl | 0, fl = pl - il, ir = pr | 0, fr2 = pr - ir;
				const wl = bl[il] * (1 - fl) + bl[(il + 1) % n] * fl, wr = br[ir] * (1 - fr2) + br[(ir + 1) % n] * fr2;
				this.cpos = (this.cpos + 1) % n;
				L = L * (1 - c.level * 0.5) + wl * c.level * 0.7; R = R * (1 - c.level * 0.5) + wr * c.level * 0.7;
			}
			const dly = fx.delay;
			if (dly.level > 0.001) {
				const want = dly.sync ? 60 / this.arpTempo() * SYNC_DIVS[11 + Math.round(clamp(dly.time, 0, 1) * 7)] : 0.01 + dly.time * 1.39;
				this.dTime += (Math.min(want, 1.45) * sr - this.dTime) * 0.0005;
				const n = this.delayBuf[0].length;
				let p = this.dpos - this.dTime; if (p < 0) p += n;
				const i = p | 0, fr = p - i, i1 = (i + 1) % n;
				const el = this.delayBuf[0][i] * (1 - fr) + this.delayBuf[0][i1] * fr, er = this.delayBuf[1][i] * (1 - fr) + this.delayBuf[1][i1] * fr;
				this.dlp[0] += (el - this.dlp[0]) * 0.4; this.dlp[1] += (er - this.dlp[1]) * 0.4;
				const fb = clamp(dly.fb, 0, 0.95);
				this.delayBuf[0][this.dpos] = fastTanh(L + this.dlp[1] * fb); this.delayBuf[1][this.dpos] = fastTanh(R + this.dlp[0] * fb); // crossed: ping-pong
				this.dpos = (this.dpos + 1) % n;
				L += this.dlp[0] * dly.level; R += this.dlp[1] * dly.level;
			}
			const rv = fx.reverb;
			if (rv.level > 0.001) {
				const fbk = 0.7 + rv.time * 0.28 - (2 - rv.type) * 0.02, damp = 0.25 + (2 - rv.type) * 0.1, inp = (L + R) * 0.08;
				const out = [0, 0];
				for (let c = 0; c < 2; c++) {
					const t = this.rev[c];
					let y = 0;
					const scale = 0.55 + 0.225 * rv.type;
					for (const cb of t.c) {
						if (cb.scale !== scale) { cb.scale = scale; cb.len = Math.max(16, Math.round(cb.b.length * scale)); }
						const len = cb.len;
						if (cb.p >= len) cb.p = 0;
						const o = cb.b[cb.p];
						cb.lp = o * (1 - damp) + cb.lp * damp;
						cb.b[cb.p] = inp + cb.lp * fbk;
						if (++cb.p >= len) cb.p = 0;
						y += o;
					}
					for (const ap of t.a) {
						const o = ap.b[ap.p];
						ap.b[ap.p] = y + o * 0.5;
						if (++ap.p >= ap.b.length) ap.p = 0;
						y = o - y * 0.5;
					}
					out[c] = y;
				}
				L += out[0] * rv.level; R += out[1] * rv.level;
			}
		}
		const vol = s.volume * s.volume;
		outs[0] = fastTanh(L * vol * 2);
		outs[1] = fastTanh(R * vol * 2);
		return outs[0];
	}

	endBlock(n) { this.sampleCount += n; }

	state() {
		return {
			voices: this.voices.map(v => v.active ? (v.gate ? 2 : 1) : 0),
			lfo: [this.lfo[0].v, this.lfo[1].v],
			arp: this.s.arp.on ? this.held.map(h => h[0]) : []
		};
	}
}
MountDSP.OUT_IDS = OUT_IDS;
MountDSP.IN_IDS = IN_IDS;
MountDSP.MIDI_IN = "midi_in";
MountDSP.POLY = true;
MountDSP.TABLE_NAMES = ["BRIGHT", "VOCAL", "ORGAN", "ODD", "PULSE SWEEP", "DIGITAL", "HOLLOW", "SYNC"];

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.mount = MountDSP;

})();
