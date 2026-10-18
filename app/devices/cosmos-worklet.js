// devices/cosmos-worklet.js
// COSMOS DSP (a multi-algorithm stereo reverb), hosted by the rack processor: stereo, 12
// algorithms, each with the pedal's ten knobs (0..1 here, meaning per algorithm, as in the Space's user
// guide): MIX, DECAY, SIZE, DELAY, LOW, HIGH, XNOB, YNOB, FXMIX, CONTOUR.
//   HALL, ROOM, PLATE, SPRING, DUALVERB, REVERSE, MODECHOVERB, VOID, WARPVERB, TREMOLOVERB,
//   DYNAVERB, SHIMMER
// One reverb core for all: an 8-line feedback delay network (size, 3-band decay, damping, diffusion,
// random modulation, INF and FREEZE), with each algorithm's own processing around it. The pedal's
// algorithms are approximations from descriptions of classic studio reverbs.

(function(){

const IN_IDS = ["in_l", "in_r"];
const OUT_IDS = ["out_l", "out_r"];
const K = { MIX: 0, DECAY: 1, SIZE: 2, DELAY: 3, LOW: 4, HIGH: 5, X: 6, Y: 7, FX: 8, CONTOUR: 9 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function frac(x) { return x - Math.floor(x); }
function tanh(x) { if (x < -3) return -1; if (x > 3) return 1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function onePole(fc) { return 1 - Math.exp(-2 * Math.PI * clamp(fc, 5, sampleRate * 0.45) / sampleRate); }
// knob conversions (the UI shows the same)
const decaySec = (v) => 0.1 * Math.pow(500, v);               // 0.1 .. 50 s
const msOf = (v) => 2000 * v * v;                              // 0 .. 2000 ms
const bip = (v) => (v - 0.5) * 2;                              // -1 .. 1
const levelGain = (v) => v < 0.5 ? v * 2 : 1 + (v - 0.5) * 2;  // cut to 0 .. boost x2
const INF_AT = 0.965, FREEZE_AT = 0.985;                       // a decay knob's top: [INF], then [FREEZE]
// TEMPO mode: the DELAY knob in note values of the tapped tempo (beats); the panel has the same list
const NOTES = [1 / 16, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 3, 4];

class Line {
	constructor(n) { this.b = new Float32Array(n); this.n = n; this.w = 0; }
	write(x) { this.b[this.w] = x; if (++this.w >= this.n) this.w = 0; }
	read(d) {
		d = d < 1 ? 1 : (d > this.n - 2 ? this.n - 2 : d);
		let p = this.w - d; if (p < 0) p += this.n;
		let i = p | 0; if (i >= this.n) i -= this.n;
		const f = p - Math.floor(p), a = this.b[i], b = this.b[i + 1 < this.n ? i + 1 : 0];
		return a + (b - a) * f;
	}
	clear() { this.b.fill(0); }
}
class Allpass {
	constructor(n) { this.l = new Line(n + 2); this.d = n; }
	process(x, g) { const z = this.l.read(this.d), v = x + z * g; this.l.write(v); return z - v * g; }
}
class Shifter { // two read heads sweeping a window, crossfaded
	constructor(win) { this.line = new Line(Math.round(sampleRate * 0.25)); this.ph = 0; this.win = Math.round(sampleRate * (win || 0.07)); }
	process(x, cents) {
		this.line.write(x);
		const r = Math.pow(2, cents / 1200);
		this.ph = frac(this.ph + (1 - r) / this.win);
		const p2 = frac(this.ph + 0.5);
		return this.line.read(2 + this.ph * this.win) * Math.sin(Math.PI * this.ph) + this.line.read(2 + p2 * this.win) * Math.sin(Math.PI * p2);
	}
}

// ---- the reverb core: 8 lines, Hadamard feedback, 3-band decay, modulation, freeze ----
const BASE_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.3, 73.1];
class Fdn {
	constructor(maxScale) {
		const sr = sampleRate;
		this.lines = BASE_MS.map(ms => new Line(Math.round(ms / 1000 * sr * maxScale) + 64));
		this.lenMax = BASE_MS.map(ms => ms / 1000 * sr * maxScale);
		this.len = new Float64Array(8);
		this.gL = new Float64Array(8); this.gM = new Float64Array(8); this.gH = new Float64Array(8);
		this.lp1 = new Float64Array(8); this.lp2 = new Float64Array(8); this.damp = new Float64Array(8); this.hp = new Float64Array(8);
		this.o = new Float64Array(8);
		this.inAp = [[new Allpass(Math.round(sr * 0.0047)), new Allpass(Math.round(sr * 0.0036)), new Allpass(Math.round(sr * 0.0127)), new Allpass(Math.round(sr * 0.0093))],
			[new Allpass(Math.round(sr * 0.0049)), new Allpass(Math.round(sr * 0.0039)), new Allpass(Math.round(sr * 0.0131)), new Allpass(Math.round(sr * 0.0089))]];
		this.modPh = BASE_MS.map((m, i) => i / 8);
		this.modRate = BASE_MS.map((m, i) => 0.31 + i * 0.137);
		this.set({ scale: 1, t60: 2, lo: 1, hi: 1, diff: 0.6, mod: 0.2, hiDamp: 12000, loDamp: 20, freeze: false });
	}
	// scale (line lengths), t60 (s), lo / hi (decay multipliers of the low / high bands), diff (input
	// diffusion), mod (0..1), hiDamp / loDamp (Hz, in the loop), freeze, inf
	set(p) {
		const sr = sampleRate;
		this.p = p;
		const sc = clamp(p.scale, 0.05, 1);
		for (let k = 0; k < 8; k++) {
			this.len[k] = Math.max(16, this.lenMax[k] * sc);
			const g = (t) => p.freeze || p.inf ? 1 : Math.pow(10, -3 * this.len[k] / (Math.max(0.05, t) * sr));
			this.gM[k] = g(p.t60); this.gL[k] = g(p.t60 * p.lo); this.gH[k] = g(p.t60 * p.hi);
			if (p.inf && !p.freeze) { this.gM[k] = this.gL[k] = this.gH[k] = 0.9995; }
		}
		this.c300 = onePole(300); this.c1500 = onePole(1500);
		this.cDamp = onePole(p.freeze ? 20000 : p.hiDamp); this.cHp = onePole(p.freeze ? 5 : p.loDamp);
		this.modDepth = p.mod * 0.0025 * sr;
	}
	process(xl, xr) {
		const p = this.p, L = this.lines, o = this.o, sr = sampleRate;
		if (p.freeze) { xl = 0; xr = 0; }
		// input diffusion
		const d = p.diff * 0.72;
		for (let i = 0; i < 4; i++) { xl = this.inAp[0][i].process(xl, d); xr = this.inAp[1][i].process(xr, d); }
		for (let k = 0; k < 8; k++) {
			let dl = this.len[k];
			if (this.modDepth > 0.01) { this.modPh[k] = frac(this.modPh[k] + this.modRate[k] / sr); dl += Math.sin(2 * Math.PI * this.modPh[k]) * this.modDepth; }
			o[k] = L[k].read(dl);
		}
		// Hadamard 8 (butterflies), normalized
		const h = [o[0] + o[1], o[0] - o[1], o[2] + o[3], o[2] - o[3], o[4] + o[5], o[4] - o[5], o[6] + o[7], o[6] - o[7]];
		const h2 = [h[0] + h[2], h[1] + h[3], h[0] - h[2], h[1] - h[3], h[4] + h[6], h[5] + h[7], h[4] - h[6], h[5] - h[7]];
		const s = 0.35355339; // 1 / sqrt(8)
		for (let k = 0; k < 4; k++) {
			const a = (h2[k] + h2[k + 4]) * s, b = (h2[k] - h2[k + 4]) * s;
			this.fb(k, a + (k % 2 ? xr : xl) * 0.5);
			this.fb(k + 4, b + (k % 2 ? xl : xr) * 0.5);
		}
		this.outL = (o[0] - o[2] + o[4] - o[6]) * 0.5;
		this.outR = (o[1] - o[3] + o[5] - o[7]) * 0.5;
	}
	fb(k, x) { // 3 bands with their decays, damping, then into the line
		this.lp1[k] += (x - this.lp1[k]) * this.c300;
		this.lp2[k] += (x - this.lp2[k]) * this.c1500;
		const lo = this.lp1[k], hi = x - this.lp2[k], mid = x - lo - hi;
		let y = lo * this.gL[k] + mid * this.gM[k] + hi * this.gH[k];
		this.damp[k] += (y - this.damp[k]) * this.cDamp; y = this.damp[k];
		this.hp[k] += (y - this.hp[k]) * this.cHp; y -= this.hp[k];
		this.lines[k].write(y);
	}
	clear() { this.lines.forEach(l => l.clear()); }
}

// shelving / 3-band output EQ (per channel)
class Eq3 {
	constructor() { this.a = 0; this.b = 0; }
	process(x, lo, mid, hi, fLo, fHi) { // gains, crossover coefficients
		this.a += (x - this.a) * fLo; this.b += (x - this.b) * fHi;
		const l = this.a, h = x - this.b, m = x - l - h;
		return l * lo + m * mid + h * hi;
	}
}

class CosmosDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		const sr = sampleRate;
		this.rev = new Fdn(5);            // VOID is the biggest
		this.rev2 = new Fdn(2.5);         // DUALVERB's B, REVERSE's forward reverb
		this.pre = [new Line(Math.round(sr * 2.1)), new Line(Math.round(sr * 2.1))];
		this.pre2 = [new Line(Math.round(sr * 2.1)), new Line(Math.round(sr * 2.1))];
		this.echo = [new Line(Math.round(sr * 2.1)), new Line(Math.round(sr * 2.1))];
		this.mod = [new Line(Math.round(sr * 0.05)), new Line(Math.round(sr * 0.05))];
		this.eq = [new Eq3(), new Eq3()]; this.eq2 = [new Eq3(), new Eq3()]; this.eq3 = [new Eq3(), new Eq3()];
		this.sh = [new Shifter(), new Shifter(), new Shifter(), new Shifter()];
		this.springs = [0, 1, 2].map(i => ({ line: [new Line(Math.round(sr * 0.2)), new Line(Math.round(sr * 0.2))], ap: [0, 1, 2, 3, 4, 5].map(() => [new Allpass(1 + i), new Allpass(2 + i)]), lp: [0, 0], hp: [0, 0], bp: [[0, 0], [0, 0]] }));
		this.rbuf = [new Line(Math.round(sr * 4.2)), new Line(Math.round(sr * 4.2))]; this.rpos = 0;
		this.lfo = 0; this.lfo2 = 0.25; this.sh_v = 0; this.env = 0; this.gainEnv = 1; this.tone = [0, 0]; this.fbl = 0; this.fbr = 0;
		this.flt = [[0, 0], [0, 0]]; this.trem = 1; this.adsr = 0; this.lastIn = 0;
		this.algo = -1; this.tapTimes = [];
	}

	message(m) {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	beginBlock() {
		const s = this.s, a = s.algo | 0, P = s.params[a];
		if (a !== this.algo) { this.rev.clear(); this.rev2.clear(); this.algo = a; this.fbl = this.fbr = 0; }
		const hot = !!s.hot; // HOTSWITCH: freeze
		const dk = P[K.DECAY], freeze = hot || dk >= FREEZE_AT, inf = !freeze && dk >= INF_AT;
		const t60 = decaySec(dk), size = P[K.SIZE];
		// the DELAY knob: milliseconds, or a note value of the tempo in TEMPO mode
		const delayMs = s.tempo_mode ? 60000 / clamp(s.tempo, 30, 300) * NOTES[Math.min(NOTES.length - 1, Math.floor(P[K.DELAY] * NOTES.length))] : msOf(P[K.DELAY]);
		if (a !== 7) this.rev.modRate.forEach((r, i) => this.rev.modRate[i] = 0.31 + i * 0.137);
		const base = { scale: 0.15 + size * 0.85, t60: t60, lo: 1, hi: 1, diff: 0.7, mod: 0.15, hiDamp: 14000, loDamp: 15, freeze: freeze, inf: inf };
		const xLo = onePole(300), xHi = onePole(1500), c350 = onePole(350), c2k = onePole(2000);
		this.x = {}; const X = this.x;
		switch (a) {
			case 0: // HALL: 3-band decay (XNOB low, YNOB high), 3-band levels, MOD-LVL
				Object.assign(base, { lo: 0.25 * Math.pow(16, P[K.X]), hi: 0.25 * Math.pow(16, P[K.Y]), mod: P[K.FX] * 0.8, scale: 0.35 + size * 0.65 });
				X.eq = [levelGain(P[K.LOW]), levelGain(P[K.CONTOUR]), levelGain(P[K.HIGH]), xLo, xHi];
				break;
			case 1: // ROOM: smaller; ER / LR mix (XNOB), diffusion (YNOB), shelves (HI-FREQ on CONTOUR)
				Object.assign(base, { scale: 0.08 + size * 0.45, diff: P[K.Y], mod: P[K.FX] * 0.6, t60: decaySec(dk * 0.75) });
				X.er = 1 - P[K.X]; X.eq = [levelGain(P[K.LOW]), 1, levelGain(P[K.HIGH]), c350, onePole(1000 * Math.pow(12, P[K.CONTOUR]))];
				break;
			case 2: // PLATE: damping in the loop, TONE before it, DISTANCE (XNOB), diffusion (YNOB)
				Object.assign(base, { scale: 0.2 + size * 0.6, diff: 0.55 + P[K.Y] * 0.4, mod: P[K.FX] * 0.6,
					loDamp: 1000 * Math.pow(0.01, P[K.LOW]), hiDamp: 1000 * Math.pow(18, P[K.HIGH]) });
				X.tone = bip(P[K.CONTOUR]); X.dist = P[K.X];
				break;
			case 3: // SPRING: the tank (tension, springs), damping, resonance, input tremolo
				X.tension = 1 - P[K.SIZE]; X.nspr = 1 + P[K.DELAY] * 2; X.g = Math.pow(10, -3 * 0.05 / Math.max(0.1, t60));
				X.cLo = onePole(500 * Math.pow(0.04, P[K.LOW])); X.cHi = onePole(800 * Math.pow(12, P[K.HIGH]));
				X.res = P[K.CONTOUR]; X.mod = P[K.FX]; X.trSpd = 0.3 * Math.pow(40, P[K.Y]); X.trInt = P[K.X];
				break;
			case 4: // DUALVERB: A and B (decay, pre-delay, tone), A / B mix
				Object.assign(base, { scale: 0.25 + size * 0.7, mod: 0.2 });
				X.b = Object.assign({}, base, { scale: 0.15 + size * 0.5, t60: decaySec(P[K.X]), freeze: hot || P[K.X] >= FREEZE_AT, inf: P[K.X] >= INF_AT && P[K.X] < FREEZE_AT });
				X.aTone = bip(P[K.LOW]); X.bTone = bip(P[K.HIGH]); X.res = P[K.CONTOUR]; X.ab = P[K.FX];
				X.preB = s.tempo_mode ? 60000 / clamp(s.tempo, 30, 300) * NOTES[Math.min(NOTES.length - 1, Math.floor(P[K.Y] * NOTES.length))] : msOf(P[K.Y]);
				this.rev2.set(X.b);
				break;
			case 5: // REVERSE: windows played backwards, a forward reverb, feedback, late dry
				X.win = Math.round((0.01 + 2 * dk * dk) * sampleRate); X.fwd = P[K.SIZE]; X.fb = P[K.DELAY] * 0.92; X.diff = P[K.Y]; X.late = P[K.X]; X.mod = P[K.FX];
				X.eq = [levelGain(P[K.LOW]), 1, levelGain(P[K.HIGH]), onePole(400 / (1 + P[K.CONTOUR] * 3)), onePole(1500 * (1 + P[K.CONTOUR] * 3))];
				this.rev2.set(Object.assign({}, base, { scale: 0.5, t60: 2.5, freeze: hot || P[K.SIZE] >= FREEZE_AT }));
				break;
			case 6: // MODECHOVERB: reverb into an echo with feedback; swept verb / flanger / chorus
				Object.assign(base, { scale: 0.3 + size * 0.7, mod: 0.3 });
				X.off = dk < 0.02; X.echoMs = delayMs; X.efb = P[K.X] * 0.98; X.etone = bip(P[K.CONTOUR]);
				X.modType = P[K.FX] < 1 / 3 ? 0 : (P[K.FX] < 2 / 3 ? 1 : 2); X.modDepth = (P[K.FX] * 3) % 1; X.rate = 0.05 * Math.pow(160, P[K.Y]);
				X.eq = [levelGain(P[K.LOW]), 1, levelGain(P[K.HIGH]), c350, c2k];
				break;
			case 7: { // VOID: huge; GRAVITY (or inverse below the middle), feedback around it all
				const inv = dk < 0.5, grav = inv ? 1 - dk * 2 : (dk - 0.5) * 2;
				Object.assign(base, { scale: 0.25 + size * 0.75, t60: 1 + grav * grav * 60, inf: false, freeze: hot || P[K.FX] >= FREEZE_AT, mod: P[K.X] * 1.5, diff: 0.8 });
				this.rev.modRate.forEach((r, i) => this.rev.modRate[i] = (0.1 + i * 0.05) * Math.pow(10, P[K.Y] * 1.3));
				X.inv = inv ? grav : 0; X.fb = P[K.FX] >= INF_AT ? 0.995 : P[K.FX] * 0.9;
				X.res = P[K.CONTOUR]; X.eq = [levelGain(P[K.LOW]), 1, levelGain(P[K.HIGH]), c350, c2k];
				X.win = Math.round((0.3 + grav * 1.5) * sampleRate);
				break;
			}
			case 8: // WARPVERB: reverb into a 3-band EQ into distortion; wobble
				Object.assign(base, { t60: 0.1 + dk * dk * 8, inf: false, freeze: hot, scale: 0.05 + size * 0.9 });
				X.eq = [levelGain(P[K.LOW]), levelGain(P[K.CONTOUR]), levelGain(P[K.HIGH]), xLo, xHi];
				X.dist = P[K.X]; X.out = P[K.Y]; X.wobble = P[K.FX];
				break;
			case 9: // TREMOLOVERB: a big reverb chopped by a tremolo
				Object.assign(base, { scale: 0.3 + size * 0.7 });
				X.eq = [levelGain(P[K.LOW]), 1, levelGain(P[K.HIGH]), c350, onePole(1000 * Math.pow(12, P[K.CONTOUR]))];
				X.depth = P[K.FX] < 0.5 ? P[K.FX] * 2 : (P[K.FX] - 0.5) * 2; X.stereo = P[K.FX] >= 0.5;
				X.speed = 0.1 * Math.pow(200, P[K.Y]); X.shape = Math.min(8, Math.floor(P[K.X] * 9));
				break;
			case 10: { // DYNAVERB: a gate / expander / compressor on the reverb
				Object.assign(base, { scale: 0.2 + size * 0.8, t60: dk < 0.01 ? 0.05 : t60 });
				X.solo = dk < 0.01; X.thr = -80 + P[K.FX] * 80; X.atk = onePole(1 / (0.0002 * Math.pow(2500, P[K.DELAY]) * 6.28));
				X.rel = onePole(1 / (0.005 * Math.pow(400, P[K.Y]) * 6.28)); X.sc = P[K.CONTOUR];
				const r = P[K.X];
				X.ratio = r < 0.1 ? 0 : (r < 0.35 ? 1 / (1 + (0.35 - r) * 16) : (r < 0.75 ? 1 + (r - 0.35) * 47.5 : (r < 0.85 ? 1e6 : -10 + (r - 0.85) * 60)));
				X.eq = [levelGain(P[K.LOW]), 1, levelGain(P[K.HIGH]), c350, c2k];
				break;
			}
			case 11: // SHIMMER: reverb, delay, two pitch shifters fed back through 3 bands
				Object.assign(base, { t60: 0.3 + dk * dk * 20, inf: false, freeze: hot || P[K.FX] >= FREEZE_AT, scale: 0.3 + size * 0.7, mod: 0.25 });
				X.dly = delayMs; X.pa = (P[K.X] - 0.5) * 4800; X.pb = (P[K.Y] - 0.5) * 4800;
				X.fb = P[K.FX] >= INF_AT ? 0.98 : P[K.FX] * 0.9; X.pitchFreeze = P[K.FX] >= INF_AT && P[K.FX] < FREEZE_AT;
				X.eq = [P[K.LOW] * 1.1, P[K.CONTOUR] * 1.1, P[K.HIGH] * 1.1, xLo, xHi]; // LOW / MID / HI-DCY: the bands fed back
				break;
		}
		this.rev.set(base);
		this.preMs = a === 3 || a === 5 || a === 6 || a === 10 || a === 11 ? 0 : delayMs;
		if (a === 2) this.preMs += P[K.X] * 40;
		this.mixv = P[K.MIX];
	}

	// a tremolo / LFO shape at phase p: 0..1 (1 = full level)
	shape(sh, p) {
		switch (sh) {
			case 0: return 0.5 + 0.5 * Math.sin(2 * Math.PI * p);
			case 1: return 1 - Math.abs(2 * p - 1);
			case 2: return Math.pow(1 - Math.abs(2 * p - 1), 4);           // PEAK
			case 3: return this.sh_v;                                         // RANDOM (smoothed below)
			case 4: return p;                                                 // RAMP
			case 5: return p < 0.5 ? 1 : 0;                                   // SQUARE
			case 6: return this.sh_v;                                         // S&H
			case 7: return clamp(this.env * 6, 0, 1);                         // ENVELOPE
			default: return this.adsr;                                        // ADSR (on the attacks)
		}
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, P = s.params[s.algo | 0], X = this.x, a = this.algo, sr = sampleRate;
		const dl = ins[0], dr = this.patched[1] ? ins[1] : dl;
		let xl = s.active ? dl : 0, xr = s.active ? dr : 0;    // bypass: the tails go on
		const lvl = Math.abs(dl) + Math.abs(dr);
		this.env += (lvl - this.env) * (lvl > this.env ? 0.01 : 0.0005);
		// pre-delay
		if (this.preMs > 0.5) {
			this.pre[0].write(xl); this.pre[1].write(xr);
			const d = this.preMs * 0.001 * sr; xl = this.pre[0].read(d); xr = this.pre[1].read(d);
		}
		let wl = 0, wr = 0;
		switch (a) {
			case 0: {
				this.rev.process(xl, xr);
				wl = this.eq[0].process(this.rev.outL, X.eq[0], X.eq[1], X.eq[2], X.eq[3], X.eq[4]);
				wr = this.eq[1].process(this.rev.outR, X.eq[0], X.eq[1], X.eq[2], X.eq[3], X.eq[4]);
				break;
			}
			case 1: {
				this.rev.process(xl, xr);
				// early reflections: taps on the pre-delay line
				const sz = (0.3 + P[K.SIZE]) * sr * 0.001;
				this.pre2[0].write(xl); this.pre2[1].write(xr);
				let el = 0, er = 0;
				[[7, 0.8], [11, -0.6], [17, 0.5], [23, -0.45], [31, 0.35], [41, -0.3]].forEach(([ms, g], i) => { el += this.pre2[i % 2].read(ms * sz) * g; er += this.pre2[(i + 1) % 2].read(ms * 1.07 * sz) * g; });
				const m = X.er;
				wl = this.eq[0].process(el * m * 0.6 + this.rev.outL * (1 - m * 0.5), X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				wr = this.eq[1].process(er * m * 0.6 + this.rev.outR * (1 - m * 0.5), X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				break;
			}
			case 2: {
				// TONE: a tilt before the plate
				const t = X.tone, c = onePole(1200);
				this.tone[0] += (xl - this.tone[0]) * c; this.tone[1] += (xr - this.tone[1]) * c;
				const tl = t < 0 ? this.tone[0] + (xl - this.tone[0]) * (1 + t) : xl + (xl - this.tone[0]) * t;
				const tr = t < 0 ? this.tone[1] + (xr - this.tone[1]) * (1 + t) : xr + (xr - this.tone[1]) * t;
				this.rev.process(tl, tr);
				wl = this.rev.outL; wr = this.rev.outR;
				break;
			}
			case 3: { // SPRING
				// the input tremolo (tube amp style)
				this.lfo = frac(this.lfo + X.trSpd / sr);
				const tg = 1 - X.trInt * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.lfo));
				const il = dl * tg * (s.active ? 1 : 0), ir = dr * tg * (s.active ? 1 : 0);
				let ol = 0, or = 0;
				const n = Math.min(3, Math.ceil(X.nspr));
				for (let i = 0; i < n; i++) {
					const sp = this.springs[i], w = i + 1 > X.nspr ? X.nspr - i : 1;
					const len = (0.025 + X.tension * 0.04 + i * 0.0071) * sr;
					for (let c = 0; c < 2; c++) {
						let y = sp.line[c].read(len * (c ? 1.031 : 1));
						for (let k = 0; k < 6; k++) y = sp.ap[k][c].process(y, 0.62 - X.tension * 0.15); // the chirp
						sp.lp[c] += (y - sp.lp[c]) * X.cHi; y = sp.lp[c];
						sp.hp[c] += (y - sp.hp[c]) * X.cLo; y -= sp.hp[c];
						// RESONANCE: a peak at the high damping
						const B = sp.bp[c], f = Math.min(1, 2 * Math.sin(Math.PI * Math.min(8000, 800 * Math.pow(12, P[K.HIGH])) / sr));
						const h = y - B[0] - 0.3 * B[1]; B[1] += f * h; B[0] += f * B[1];
						if (X.mod > 0.01) y *= 1 + Math.sin(2 * Math.PI * (this.lfo * 3 + i * 0.3)) * X.mod * 0.05;
						sp.line[c].write(tanh((c ? ir : il) + y * X.g));
						const out = y + B[1] * X.res * 0.2; // RESONANCE: heard, not fed back
						if (c) or += out * w; else ol += out * w;
					}
				}
				wl = ol * 0.7; wr = or * 0.7;
				// VERBMIX mixes the reverb with the tremolo'd dry: the dry here is the tremolo
				outs[0] = il * (1 - this.mixv) + wl * this.mixv * 1.6;
				outs[1] = ir * (1 - this.mixv) + wr * this.mixv * 1.6;
				return 0;
			}
			case 4: { // DUALVERB
				this.pre2[0].write(dl * (s.active ? 1 : 0)); this.pre2[1].write(dr * (s.active ? 1 : 0));
				const pb = X.preB * 0.001 * sr, bl = pb > 0.5 ? this.pre2[0].read(pb) : dl, br = pb > 0.5 ? this.pre2[1].read(pb) : dr;
				const ab = X.ab, freezeMix = this.rev.p.freeze || this.rev2.p.freeze;
				this.rev.process(xl * (freezeMix ? 1 : (1 - ab)), xr * (freezeMix ? 1 : (1 - ab)));
				this.rev2.process(bl * (freezeMix ? 1 : ab), br * (freezeMix ? 1 : ab));
				const tone = (x, k, t) => { this.flt[k][0] += (x - this.flt[k][0]) * onePole(1500); const lp = this.flt[k][0]; return t < 0 ? lp + (x - lp) * (1 + t) : x + (x - lp) * t * (1 + X.res); };
				const al = tone(this.rev.outL, 0, X.aTone), arr = tone(this.rev.outR, 1, X.aTone);
				const bL = this.rev2.outL + (this.rev2.outL - this.tone[0]) * X.bTone, bR = this.rev2.outR + (this.rev2.outR - this.tone[1]) * X.bTone;
				this.tone[0] += (this.rev2.outL - this.tone[0]) * onePole(1500); this.tone[1] += (this.rev2.outR - this.tone[1]) * onePole(1500);
				// all the way right: A on the left, B on the right
				const dual = ab > 0.9 ? (ab - 0.9) * 10 : 0;
				wl = (al * (1 - ab) + bL * ab) * (1 - dual) + al * dual;
				wr = (arr * (1 - ab) + bR * ab) * (1 - dual) + bR * dual;
				if (freezeMix) { wl = al * (1 - ab) + bL * ab; wr = arr * (1 - ab) + bR * ab; }
				break;
			}
			case 5: { // REVERSE: the last window played backwards, rising; then a forward reverb, feedback
				const W = X.win;
				let il = xl + this.fbl * X.fb, ir = xr + this.fbr * X.fb;
				if (X.mod > 0.01) { il = this.sh[0].process(il, X.mod * 18) * 0.5 + il * 0.5; ir = this.sh[1].process(ir, -X.mod * 18) * 0.5 + ir * 0.5; }
				// diffusion before reversal: a smear of the window (0: a mechanical stutter)
				for (let i = 0; i < 2; i++) { il = this.rev.inAp[0][i].process(il, X.diff * 0.7); ir = this.rev.inAp[1][i].process(ir, X.diff * 0.7); }
				this.rbuf[0].write(il); this.rbuf[1].write(ir);
				this.rpos = (this.rpos + 1) % W;
				const back = 2 * this.rpos + 1, env = this.rpos / W; // reading backwards through the previous window
				const fade = Math.min(1, (W - this.rpos) / (0.004 * sr), this.rpos / (0.004 * sr));
				let rl = this.rbuf[0].read(back) * env * fade * 1.4, rr = this.rbuf[1].read(back) * env * fade * 1.4;
				this.rev2.process(rl * X.fwd, rr * X.fwd);
				rl += this.rev2.outL * X.fwd; rr += this.rev2.outR * X.fwd;
				this.fbl = tanh(rl); this.fbr = tanh(rr);
				// LATE DRY: the dry right after the build-up
				this.pre2[0].write(dl); this.pre2[1].write(dr);
				rl += this.pre2[0].read(W) * X.late; rr += this.pre2[1].read(W) * X.late;
				wl = this.eq[0].process(rl, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				wr = this.eq[1].process(rr, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				break;
			}
			case 6: { // MODECHOVERB
				let rl = xl, rr = xr;
				if (!X.off) { this.rev.process(xl, xr); rl = this.rev.outL; rr = this.rev.outR; }
				// the echo, its feedback through ECHTONE
				const ed = Math.max(1, X.echoMs * 0.001 * sr);
				let el = this.echo[0].read(ed), er = this.echo[1].read(ed);
				this.tone[0] += (el - this.tone[0]) * onePole(2000); this.tone[1] += (er - this.tone[1]) * onePole(2000);
				const tl = X.etone < 0 ? this.tone[0] + (el - this.tone[0]) * (1 + X.etone) : el + (el - this.tone[0]) * X.etone;
				const trr = X.etone < 0 ? this.tone[1] + (er - this.tone[1]) * (1 + X.etone) : er + (er - this.tone[1]) * X.etone;
				this.echo[0].write(tanh(rl + tl * X.efb)); this.echo[1].write(tanh(rr + trr * X.efb));
				let ml = X.echoMs > 1 ? rl + el : rl, mr = X.echoMs > 1 ? rr + er : rr;
				// the modulation: swept verb (a moving band pass), flanger, chorus
				this.lfo = frac(this.lfo + X.rate / sr);
				const lf = Math.sin(2 * Math.PI * this.lfo), dpt = X.modDepth;
				if (X.modType === 0) {
					const fc = 300 * Math.pow(20, 0.5 + 0.5 * lf), f = Math.min(1, 2 * Math.sin(Math.PI * fc / sr));
					for (let c = 0; c < 2; c++) { const B = this.flt[c], x = c ? mr : ml; const h = x - B[0] - 0.4 * B[1]; B[1] += f * h; B[0] += f * B[1]; if (c) mr = x * (1 - dpt) + B[1] * dpt * 1.5; else ml = x * (1 - dpt) + B[1] * dpt * 1.5; }
				}
				else {
					const flange = X.modType === 1;
					this.mod[0].write(ml + (flange ? this.fbl * 0.6 * dpt : 0)); this.mod[1].write(mr + (flange ? this.fbr * 0.6 * dpt : 0));
					const base = flange ? 0.003 : 0.012, sw = flange ? 0.0025 : 0.005;
					const m0 = this.mod[0].read((base + sw * (0.5 + 0.5 * lf)) * sr), m1 = this.mod[1].read((base + sw * (0.5 - 0.5 * lf)) * sr);
					this.fbl = m0; this.fbr = m1;
					ml = ml * (1 - dpt * 0.5) + m0 * dpt; mr = mr * (1 - dpt * 0.5) + m1 * dpt;
				}
				wl = this.eq[0].process(ml, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				wr = this.eq[1].process(mr, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				break;
			}
			case 7: { // VOID
				this.rev.process(xl + this.fbl * X.fb, xr + this.fbr * X.fb);
				let rl = this.rev.outL, rr = this.rev.outR;
				this.fbl = tanh(rl); this.fbr = tanh(rr);
				if (X.inv > 0) { // inverse gravity: the tail played backwards in windows, swelling up
					const W = X.win;
					this.rbuf[0].write(rl); this.rbuf[1].write(rr);
					this.rpos = (this.rpos + 1) % W;
					const env = this.rpos / W, fade = Math.min(1, (W - this.rpos) / (0.006 * sr), this.rpos / (0.006 * sr));
					const il = this.rbuf[0].read(2 * this.rpos + 1) * env * fade * 1.5, ir = this.rbuf[1].read(2 * this.rpos + 1) * env * fade * 1.5;
					rl = rl * (1 - X.inv) + il * X.inv; rr = rr * (1 - X.inv) + ir * X.inv;
				}
				const res = 1 + X.res * 0.6;
				wl = this.eq[0].process(rl, X.eq[0] * res, 1, X.eq[2] * res, X.eq[3], X.eq[4]);
				wr = this.eq[1].process(rr, X.eq[0] * res, 1, X.eq[2] * res, X.eq[3], X.eq[4]);
				break;
			}
			case 8: { // WARPVERB
				this.rev.process(xl, xr);
				let rl = this.rev.outL, rr = this.rev.outR;
				if (X.wobble > 0.01) { // a spooky detune
					this.lfo = frac(this.lfo + (0.2 + X.wobble * 6) / sr);
					this.mod[0].write(rl); this.mod[1].write(rr);
					rl = this.mod[0].read((0.006 + 0.004 * Math.sin(2 * Math.PI * this.lfo)) * sr);
					rr = this.mod[1].read((0.006 - 0.004 * Math.sin(2 * Math.PI * this.lfo)) * sr);
				}
				rl = this.eq[0].process(rl, X.eq[0], X.eq[1], X.eq[2], X.eq[3], X.eq[4]);
				rr = this.eq[1].process(rr, X.eq[0], X.eq[1], X.eq[2], X.eq[3], X.eq[4]);
				// XNOB: SOFTCLIP (left half) or OVERDRIVE (right half); YNOB: the output level
				const soft = X.dist < 0.5, drive = soft ? 1 + X.dist * 2 * 30 : 2 + (X.dist - 0.5) * 2 * 80;
				const clip = (x) => soft ? tanh(x * drive) : clamp(x * drive + 0.15, -0.7, 1) - 0.15 * 0.6;
				const og = Math.pow(10, (-40 + X.out * 40) / 20) * 2;
				wl = clip(rl) * og; wr = clip(rr) * og;
				break;
			}
			case 9: { // TREMOLOVERB
				this.rev.process(xl, xr);
				let rl = this.eq[0].process(this.rev.outL, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				let rr = this.eq[1].process(this.rev.outR, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				const was = this.lfo;
				this.lfo = frac(this.lfo + X.speed / sr);
				if (this.lfo < was) this.shTarget = Math.random();
				if (X.shape === 3) this.sh_v += ((this.shTarget || 0) - this.sh_v) * 0.0008; else if (X.shape === 6) this.sh_v = this.shTarget || 0;
				// ADSR: on each attack of the input
				const onset = lvl > this.lastIn * 1.8 && lvl > 0.05; this.lastIn = this.lastIn * 0.999 + lvl * 0.001;
				if (onset) this.adsrStage = 1;
				if (this.adsrStage === 1) { this.adsr += (1 - this.adsr) * 0.002; if (this.adsr > 0.98) this.adsrStage = 2; }
				else this.adsr += (0.6 - this.adsr) * 0.00005 / Math.max(0.05, X.speed / 20);
				const g = (p) => 1 - X.depth + X.depth * this.shape(X.shape, p);
				wl = rl * g(this.lfo); wr = rr * g(X.stereo ? frac(this.lfo + 0.25) : this.lfo);
				break;
			}
			case 10: { // DYNAVERB: a gate / expander / compressor on the reverb, side chain from the input and / or the reverb
				let rl = xl, rr = xr;
				if (!X.solo) { this.rev.process(xl, xr); rl = this.rev.outL; rr = this.rev.outR; }
				const det = (Math.abs(dl) + Math.abs(dr)) * (1 - X.sc) + (Math.abs(this.fbl) + Math.abs(this.fbr)) * X.sc;
				this.env2 = (this.env2 || 0) + (det - (this.env2 || 0)) * (det > (this.env2 || 0) ? X.atk : X.rel);
				const L = 20 * Math.log10(this.env2 + 1e-6), over = L - X.thr;
				let gdb = 0;
				if (X.ratio === 0) gdb = over < 0 ? -80 : 0;                         // gate
				else if (X.ratio < 1) gdb = over < 0 ? over * (1 / X.ratio - 1) : 0; // expansion
				else if (X.ratio >= 1e5) gdb = over > 0 ? -over : 0;                  // limiting
				else if (X.ratio > 1) gdb = over > 0 ? over * (1 / X.ratio - 1) : 0;  // compression
				else gdb = over > 0 ? over * (1 / X.ratio - 1) : 0;                   // negative: dynamic reversal
				const g = Math.pow(10, clamp(gdb, -80, 24) / 20);
				this.gainEnv += (g - this.gainEnv) * 0.01;
				this.fbl = rl * this.gainEnv; this.fbr = rr * this.gainEnv;
				wl = this.eq[0].process(this.fbl, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				wr = this.eq[1].process(this.fbr, X.eq[0], 1, X.eq[2], X.eq[3], X.eq[4]);
				break;
			}
			default: { // SHIMMER: reverb > delay > pitch A + B > 3 bands > back into the reverb
				const fbIn = X.pitchFreeze ? 0 : 1;
				this.rev.process(xl + this.fbl * X.fb * fbIn, xr + this.fbr * X.fb * fbIn);
				const rl = this.rev.outL, rr = this.rev.outR;
				const d = Math.max(1, X.dly * 0.001 * sr);
				this.echo[0].write(rl); this.echo[1].write(rr);
				const el = X.dly > 1 ? this.echo[0].read(d) : rl, er = X.dly > 1 ? this.echo[1].read(d) : rr;
				if (!X.pitchFreeze) {
					const pl = this.sh[0].process(el, X.pa) * 0.5 + this.sh[1].process(el, X.pb) * 0.5;
					const pr = this.sh[2].process(er, X.pa) * 0.5 + this.sh[3].process(er, X.pb) * 0.5;
					this.fbl = tanh(this.eq2[0].process(pl, X.eq[0], X.eq[1], X.eq[2], X.eq[3], X.eq[4]));
					this.fbr = tanh(this.eq2[1].process(pr, X.eq[0], X.eq[1], X.eq[2], X.eq[3], X.eq[4]));
				}
				wl = rl + this.fbl * 0.5; wr = rr + this.fbr * 0.5;
			}
		}
		// MIX: 100% is all wet
		const m = this.mixv, dg = Math.min(1, 2 * (1 - m)), wg = Math.min(1, 2 * m);
		outs[0] = dl * dg + wl * wg;
		outs[1] = dr * dg + wr * wg;
		return 0;
	}

	endBlock() {}
	state() { return { level: Math.min(1, this.env * 2), peak: this.env > 0.9 }; }
}
CosmosDSP.OUT_IDS = OUT_IDS;
CosmosDSP.IN_IDS = IN_IDS;
CosmosDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.cosmos = CosmosDSP;

})();
