// devices/mystic-worklet.js
// MYSTIC DSP (a wave-scanning polyphonic synthesizer), hosted by the rack processor. Polyphonic:
// it gets the raw MIDI notes of its channel (POLY) and plays them on 8 voices (or one, in MONO).
// Per voice: OSC 1 and OSC 2 scan through 8 single cycle waves (WAVSCAN) and go through two mutators
// each (FM-LIN, WAVSTACK, SYNC, PW-ASYM, HARMONIC, PHAZDIST: transformations of the oscillator's phase
// or its wave), OSC 3 plays one wave; a mixer with ring modulation and noise; FILTER 1 (LP24 ladder,
// LP12, BP, HP, VOWEL, COMB) and FILTER 2 (state variable morphing LP -> BP -> HP), in series or
// parallel; an amp envelope, a filter envelope and a mod envelope (to the mutators and WAVSCAN).
// One LFO for all voices, and the arpeggiator. Digital like the original: no analog drift.

(function(){

const C4 = 261.6255653005986;
const IN_IDS = ["pitch_in","gate_in","mod1_in","mod2_in","clock_in"];
const OUT_IDS = ["env1_out","menv_out","lfo_out","gate_out","audio","pitch_out","clock_out"];
const I_PITCH = 0, I_GATE = 1, I_MOD1 = 2, I_MOD2 = 3, I_CLOCK = 4;
const O_ENV1 = 0, O_MENV = 1, O_LFO = 2, O_GATE = 3, O_AUDIO = 4, O_PITCH = 5, O_CLOCK = 6;
const VOICES = 8;
const CTRL = 16; // samples between control updates of a voice (pitch, WAVSCAN, filter coefficients)
const TABLE = 2048;
const GATE_THRESHOLD = 1;
const DECAY_TC = Math.log(1 / 0.01);
const ATTACK_TARGET = 1.3, ATTACK_TC = Math.log(ATTACK_TARGET / (ATTACK_TARGET - 1));
const ARP_DIVS = [1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 2 / 3, 1 / 12]; // beats: 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/4T, 1/32T

// DELAY and REVERB after the amp (mono)
class FxLine {
	constructor(n) { this.b = new Float32Array(n); this.n = n; this.w = 0; }
	write(x) { this.b[this.w] = x; if (++this.w >= this.n) this.w = 0; }
	read(d) {
		d = d < 1 ? 1 : (d > this.n - 2 ? this.n - 2 : d);
		let p = this.w - d; if (p < 0) p += this.n;
		let i = p | 0; if (i >= this.n) i -= this.n;
		const f = p - Math.floor(p), a = this.b[i], b = this.b[i + 1 < this.n ? i + 1 : 0];
		return a + (b - a) * f;
	}
}
class FxReverb { // 4 line feedback delay network with damping
	constructor() {
		const k = sampleRate / 44100;
		this.len = [1557, 1617, 1491, 1422].map(l => Math.round(l * k));
		this.lines = this.len.map(l => new FxLine(l + 2));
		this.lp = new Float64Array(4); this.o = new Float64Array(4);
	}
	process(x, g, damp) {
		const L = this.lines, o = this.o;
		for (let k = 0; k < 4; k++) o[k] = L[k].read(this.len[k]);
		const sum = (o[0] + o[1] + o[2] + o[3]) * 0.5;
		for (let k = 0; k < 4; k++) { this.lp[k] += (sum - o[k] - this.lp[k]) * (1 - damp); L[k].write(x * 0.5 + this.lp[k] * g); }
		return (o[0] - o[1] + o[2] - o[3]) * 0.5;
	}
}
const MIDI_CLOCK_TIMEOUT = 0.5;
const VOWELS = [[800, 1150], [350, 2000], [270, 2300], [450, 800], [325, 700]]; // A E I O U formants

// ---- the 8 waves: SINE TRIANGLE SAW SQUARE PULSE ORGAN VOX DIGITAL, additive (64 harmonics), peak 1 ----
function buildTable(amp) {
	const t = new Float32Array(TABLE + 1);
	for (let k = 1; k <= 64; k++) {
		const a = amp(k);
		if (!a) continue;
		for (let i = 0; i < TABLE; i++) t[i] += a * Math.sin(2 * Math.PI * k * i / TABLE);
	}
	let peak = 0;
	for (let i = 0; i < TABLE; i++) peak = Math.max(peak, Math.abs(t[i]));
	for (let i = 0; i < TABLE; i++) t[i] /= peak || 1;
	t[TABLE] = t[0];
	return t;
}
const WAVES = [
	buildTable(k => k === 1 ? 1 : 0),
	buildTable(k => k % 2 ? (((k - 1) / 2) % 2 ? -1 : 1) / (k * k) : 0),
	buildTable(k => 1 / k),
	buildTable(k => k % 2 ? 1 / k : 0),
	buildTable(k => Math.sin(Math.PI * k * 0.25) / k),                  // 25% pulse
	buildTable(k => ({ 1: 1, 2: 0.8, 3: 0.6, 4: 0.5, 6: 0.4, 8: 0.35 })[k] || 0), // drawbars
	buildTable(k => Math.exp(-Math.pow((k - 6) / 2, 2)) + 0.6 * Math.exp(-Math.pow((k - 14) / 3, 2)) + (k === 1 ? 0.5 : 0)),
	buildTable(k => (k === 1 || k % 8 === 0) ? 1 / Math.sqrt(k) : 0)
];

function lookup(t, p) {
	const x = p * TABLE, i = x | 0, f = x - i;
	return t[i] + (t[i + 1] - t[i]) * f;
}
function frac(x) { return x - Math.floor(x); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

function newVoice() {
	return {
		ctrl: 0, dt: new Float64Array(3), mm: 0, t0: [WAVES[0], WAVES[0], WAVES[0]], t1: [WAVES[0], WAVES[0], WAVES[0]], tf: new Float64Array(3),
		spr: new Float64Array(4), k1: 0, k1b: 0, k2: 0, oct1: 0, combD: 2,
		note: -1, vel: 1, gate: false, age: 0, pitch: 0, target: 0,
		ph: new Float64Array(3), mph: new Float64Array(4), sph: new Float64Array(8),
		e1: 0, e1s: 0, e2: 0, e2s: 0, e3: 0, e3s: 0,
		lad: new Float64Array(4), svf1: new Float64Array(2), svf2: new Float64Array(2), vow: new Float64Array(4),
		comb: new Float32Array(2048), combPos: 0
	};
}

class MysticDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.voices = [];
		for (let i = 0; i < VOICES; i++) this.voices.push(newVoice());
		this.clock = 0;          // voice ages
		this.monoStack = [];
		this.lastPitch = 0;
		this.bend = 0;
		this.lfoPh = 0; this.lfoHold = 0; this.lfo = 0;
		this.lastVoice = this.voices[0];
		// arpeggiator
		this.held = [];          // [note, velocity] in the order they were pressed
		this.latched = false;
		this.arpPhase = 0; this.arpIndex = -1; this.arpNote = -1; this.arpOff = 0; this.arpDir = 1;
		this.midiTicks = 0; this.midiCount = 0; this.lastMidiClock = -1e12; this.sampleCount = 0;
		this.preview = newVoice();
	}

	message(m) {
		switch (m.type) {
			case "note": m.on ? this.keyOn(m.note, m.vel) : this.keyOff(m.note); break;
			case "allNotesOff": this.held = []; this.monoStack = []; for (const v of this.voices) if (v.gate) this.release(v); break;
			case "bend": this.bend = m.value; break;
			case "trigger": if (m.gate) this.keyOn(60, 1); else this.keyOff(60); break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.midiCount = 0; this.arpIndex = -1; break;
		}
	}

	setSettings(s) { this.s = s; }
	setMidiConnected(c) {
		if (!c && this.midiConnected) this.message({ type: "allNotesOff" });
		this.midiConnected = c;
	}

	// ---- keys: straight to the voices, or to the arpeggiator ----
	keyOn(note, vel) {
		if (this.s.arp.on) {
			if (this.latched && !this.held.some(h => h[2])) this.held = []; // a new chord replaces a latched one
			this.held = this.held.filter(h => h[0] !== note);
			this.held.push([note, vel, true]);
			this.latched = false;
			return;
		}
		this.voiceOn(note, vel);
	}

	keyOff(note) {
		if (this.s.arp.on) {
			if (this.s.arp.latch) {
				const h = this.held.find(h => h[0] === note);
				if (h) h[2] = false; // still played, no longer held
				if (!this.held.some(h => h[2])) this.latched = true;
			}
			else this.held = this.held.filter(h => h[0] !== note);
			return;
		}
		this.voiceOff(note);
	}

	voiceOn(note, vel) {
		const s = this.s;
		const target = (note - 60) / 12;
		let v;
		if (s.voice_mode === "mono") {
			this.monoStack = this.monoStack.filter(n => n !== note);
			this.monoStack.push(note);
			v = this.voices[0];
			const legato = v.gate;
			v.note = note; v.target = target; v.vel = vel; v.gate = true;
			// legato: the envelopes go on and the pitch glides (or jumps, without GLIDE) to the new note
			if (!legato) { this.trigger(v); if (s.glide <= 0) v.pitch = target; }
		}
		else {
			v = this.voices.find(x => x.note === note && x.e2s) ||
				this.voices.find(x => !x.e2s) ||
				this.voices.filter(x => !x.gate).sort((a, b) => a.age - b.age)[0] ||
				this.voices.slice().sort((a, b) => a.age - b.age)[0];
			v.pitch = s.glide > 0 && this.lastPitch !== null ? this.lastPitch : target;
			v.note = note; v.target = target; v.vel = vel; v.gate = true;
			this.trigger(v);
		}
		v.age = ++this.clock;
		this.lastPitch = target;
		this.lastVoice = v;
	}

	voiceOff(note) {
		if (this.s.voice_mode === "mono") {
			this.monoStack = this.monoStack.filter(n => n !== note);
			const v = this.voices[0];
			if (this.monoStack.length) { const n = this.monoStack[this.monoStack.length - 1]; v.note = n; v.target = (n - 60) / 12; }
			else if (v.note === note) this.release(v);
			return;
		}
		for (const v of this.voices) if (v.note === note && v.gate) this.release(v);
	}

	trigger(v) {
		v.e1s = 1; v.e2s = 1; v.e3s = 1; v.ctrl = 0;
		if (v.e2 < 1e-4) { v.ph.fill(0); v.mph.fill(0); v.sph.fill(0); } // a fresh note starts in phase
	}
	release(v) { v.gate = false; v.e1s = 4; v.e2s = 4; }

	// ---- arpeggiator: one step ----
	arpStep() {
		const s = this.s, a = s.arp;
		this.clockPulse = Math.round(0.005 * sampleRate);
		if (this.arpNote >= 0) { this.voiceOff(this.arpNote); this.arpNote = -1; }
		if (!this.held.length) return;
		let notes = this.held.map(h => h[0]);
		if (a.mode !== "order") notes = notes.slice().sort((x, y) => x - y);
		const seq = [];
		for (let o = 0; o < a.oct; o++) for (const n of notes) seq.push(n + 12 * o);
		const len = seq.length;
		let i;
		if (a.mode === "random") i = Math.floor(Math.random() * len);
		else if (a.mode === "down") i = this.arpIndex = ((this.arpIndex < 0 ? len : this.arpIndex) - 1 + len) % len;
		else if (a.mode === "updown" && len > 1) {
			let n = this.arpIndex + this.arpDir;
			if (n >= len) { this.arpDir = -1; n = len - 2; }
			if (n < 0) { this.arpDir = 1; n = this.arpIndex < 0 ? 0 : 1; }
			i = this.arpIndex = n;
		}
		else i = this.arpIndex = (this.arpIndex + 1) % len;
		const note = seq[i % len];
		const h = this.held.find(x => x[0] === notes[(i % len) % notes.length]) || this.held[0];
		this.voiceOn(note, h[1]);
		this.arpNote = note;
		this.arpOff = Math.max(1, Math.round(this.arpStepSamples * clamp(a.gate, 0.05, 1)));
	}

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		const falling = !high && this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising ? 1 : (falling ? -1 : 0);
	}

	// ---- an oscillator through its mutators (j: which of the two is next), at phase p. The tables
	// (with WAVSCAN) and the mutator settings are worked out at control rate ----
	base(v, o, p) {
		const a = lookup(v.t0[o], p), f = v.tf[o];
		return f > 0.001 ? a + (lookup(v.t1[o], p) - a) * f : a;
	}

	mut(v, o, j, p) {
		if (j === 2 || o === 2) return this.base(v, o, p);
		const mi = o * 2 + j, mode = this.mMode[mi];
		const d = clamp(this.mDepth[mi] + v.mm, 0, 1), wet = this.mWet[mi];
		if (d <= 0.0005 || wet <= 0.0005 || mode === 0) return this.mut(v, o, j + 1, p);
		let w;
		switch (mode) {
			case 1: w = this.mut(v, o, j + 1, frac(p + d * 1.5 * lookup(WAVES[0], v.mph[mi]))); break;   // FM-LIN
			case 2: w = (this.mut(v, o, j + 1, p) + this.mut(v, o, j + 1, v.sph[mi * 2]) + this.mut(v, o, j + 1, v.sph[mi * 2 + 1])) / 3; break; // WAVSTACK
			case 3: w = this.mut(v, o, j + 1, frac(p * (1 + d * this.mRatio[mi] * 2))); break;            // OSC SYNC
			case 4: {                                                                                       // PW-ASYM
				const pw = 0.5 - d * 0.47;
				w = this.mut(v, o, j + 1, p < pw ? p * 0.5 / pw : 0.5 + (p - pw) * 0.5 / (1 - pw));
				break;
			}
			case 5: {                                                                                       // HARMONIC
				const h = 1 + d * Math.min(15, this.mRatio[mi] * 2), h0 = h | 0, f = h - h0;
				const a = this.mut(v, o, j + 1, frac(p * h0));
				w = f > 0.001 ? a + (this.mut(v, o, j + 1, frac(p * (h0 + 1))) - a) * f : a;
				break;
			}
			default: w = this.mut(v, o, j + 1, frac(p + d * 0.155 * lookup(WAVES[0], p)));                 // PHAZDIST
		}
		if (wet >= 0.9995) return w;
		const dry = this.mut(v, o, j + 1, p);
		return dry + (w - dry) * wet;
	}

	beginBlock(n) {
		const s = this.s, sr = sampleRate;
		const MODES = { off: 0, fm: 1, stack: 2, sync: 3, pw: 4, harmonic: 5, phazdist: 6 };
		this.mMode = this.mMode || new Int8Array(4); this.mRatio = this.mRatio || new Float64Array(4);
		this.mDepth = this.mDepth || new Float64Array(4); this.mWet = this.mWet || new Float64Array(4);
		for (let i = 0; i < 4; i++) {
			const m = s.mut[i];
			this.mMode[i] = MODES[m.mode] || 0; this.mRatio[i] = m.ratio; this.mDepth[i] = m.depth; this.mWet[i] = m.wet;
		}
		this.f1t = { lp24: 0, lp12: 1, bp: 2, hp: 3, vowel: 4, comb: 5 }[s.f1.type] || 0;
		const ad = (a, d) => [1 - Math.exp(-ATTACK_TC / (Math.max(a, 0.0005) * sr)), Math.exp(-DECAY_TC / (Math.max(d, 0.002) * sr))];
		this.c1 = ad(s.env1.a, s.env1.d); this.r1 = Math.exp(-DECAY_TC / (Math.max(s.env1.r, 0.002) * sr));
		this.c2 = ad(s.env2.a, s.env2.d); this.r2 = Math.exp(-DECAY_TC / (Math.max(s.env2.r, 0.002) * sr));
		this.c3 = ad(s.env3.a, s.env3.d);
		this.glideK = s.glide > 0.0005 ? 1 - Math.exp(-CTRL / (s.glide * 0.3 * sr)) : 1; // per control step
		this.cut1 = Math.log2(clamp(s.f1.cutoff, 20, 20000) / 20);
		this.cut2 = Math.log2(clamp(s.f2.cutoff, 20, 20000) / 20);
		this.vol = s.volume * s.volume;
		if (s.delay) this.dTone = 1 - Math.exp(-2 * Math.PI * clamp(s.delay.tone, 200, 18000) / sr);
		if (s.reverb) { this.rG = 0.7 + clamp(s.reverb.time, 0, 1) * 0.28; this.rDamp = 0.1 + (1 - clamp(s.reverb.tone, 0, 1)) * 0.6; }
		const a = s.arp;
		this.arpStepSamples = 60 / Math.max(10, a.tempo) * ARP_DIVS[clamp(a.div | 0, 0, ARP_DIVS.length - 1)] * sr;
		// arpeggiator clock: CLOCK IN > MIDI clock > TEMPO
		this.midiClock = !this.patched[I_CLOCK] && (this.sampleCount - this.lastMidiClock) < MIDI_CLOCK_TIMEOUT * sr;
		if (this.midiClock) {
			const ticks = Math.max(1, Math.round(24 * ARP_DIVS[clamp(a.div | 0, 0, ARP_DIVS.length - 1)]));
			for (; this.midiTicks > 0; this.midiTicks--) {
				if (a.on && this.midiCount % ticks === 0) this.arpStep();
				this.midiCount++;
			}
		}
		this.midiTicks = 0;
		if (!a.on && this.held.length) { this.held = []; if (this.arpNote >= 0) { this.voiceOff(this.arpNote); this.arpNote = -1; } }
	}

	// control rate: pitch (glide), oscillator increments, WAVSCAN tables, mutator spread, filter coefficients
	control(v, pitchCv, scanCv, cutCv, lfo) {
		const s = this.s, sr = sampleRate, l = s.lfo, f1 = s.f1;
		v.pitch += (v.target - v.pitch) * this.glideK;
		v.mm = v.e3 * s.menv.mut + lfo * l.mut;
		const scan = v.e3 * s.menv.scan * 7 + scanCv;
		for (let k = 0; k < 3; k++) {
			const os = s.osc[k];
			v.dt[k] = clamp(C4 * Math.pow(2, v.pitch + pitchCv + os.semi / 12 + os.cent / 1200) / sr, 0, 0.45);
			const w = k < 2 ? clamp(os.wave + scan, 0, 7) : clamp(os.wave | 0, 0, 7), i0 = w | 0;
			v.t0[k] = WAVES[i0]; v.t1[k] = WAVES[Math.min(7, i0 + 1)]; v.tf[k] = i0 < 7 ? w - i0 : 0;
		}
		for (let mi = 0; mi < 4; mi++)
			v.spr[mi] = (0.002 + clamp(this.mDepth[mi] + v.mm, 0, 1) * 0.02) * this.mRatio[mi];
		const oct1 = this.cut1 + v.e1 * f1.env * 8 + v.target * f1.key + cutCv;
		v.oct1 = oct1;
		const fc1 = clamp(20 * Math.pow(2, oct1), 20, sr * 0.45);
		if (this.f1t === 0) v.k1 = 1 - Math.exp(-2 * Math.PI * Math.min(fc1, sr * 0.3) / sr);
		else if (this.f1t === 4) {
			const pos = clamp((oct1 / 10) * 4, 0, 4), i0 = Math.min(3, pos | 0), fr = pos - i0;
			v.k1 = 2 * Math.sin(Math.PI * (VOWELS[i0][0] + (VOWELS[i0 + 1][0] - VOWELS[i0][0]) * fr) / sr);
			v.k1b = 2 * Math.sin(Math.PI * (VOWELS[i0][1] + (VOWELS[i0 + 1][1] - VOWELS[i0][1]) * fr) / sr);
		}
		else if (this.f1t === 5) v.combD = clamp(sr / fc1, 2, 2000);
		else v.k1 = 2 * Math.sin(Math.PI * Math.min(fc1, sr * 0.2) / (2 * sr));
		v.k2 = 2 * Math.sin(Math.PI * clamp(20 * Math.pow(2, this.cut2 + cutCv), 20, sr * 0.2) / (2 * sr));
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, patched = this.patched, sr = sampleRate;

		// ---- CV gate input: a note at C4 (moved by PITCH CV) ----
		const ge = this.gateEdge(I_GATE);
		if (ge > 0) this.voiceOn(60, 1); else if (ge < 0) this.voiceOff(60);

		// ---- arpeggiator ----
		if (s.arp.on) {
			if (this.arpOff > 0 && --this.arpOff === 0 && this.arpNote >= 0) { this.voiceOff(this.arpNote); this.arpNote = -1; }
			if (patched[I_CLOCK]) { if (this.gateEdge(I_CLOCK) > 0) this.arpStep(); }
			else if (!this.midiClock && this.held.length) {
				// SWING: the steps long and short in turn
				const sw = (clamp(s.arp.swing || 50, 50, 75) - 50) / 50;
				this.arpPhase += 1 / (this.arpStepSamples * (this.arpParity ? 1 - sw : 1 + sw));
				if (this.arpPhase >= 1 || this.arpIndex < 0 && this.arpNote < 0) { this.arpPhase = this.arpPhase >= 1 ? this.arpPhase - 1 : 0; this.arpParity = !this.arpParity; this.arpStep(); }
			}
			if (!this.held.length) { this.arpIndex = -1; this.arpPhase = 0; }
		}

		// ---- LFO (one for all voices) ----
		const l = s.lfo;
		this.lfoPh += clamp(l.rate, 0.01, 50) / sr;
		if (this.lfoPh >= 1) { this.lfoPh -= 1; this.lfoHold = Math.random() * 2 - 1; }
		const lp = this.lfoPh;
		switch (l.shape) {
			case "tri": this.lfo = 1 - 4 * Math.abs(lp - 0.5); break;
			case "saw": this.lfo = 1 - 2 * lp; break;
			case "square": this.lfo = lp < 0.5 ? 1 : -1; break;
			case "sh": this.lfo = this.lfoHold; break;
			default: this.lfo = lookup(WAVES[0], lp);
		}
		const lfo = this.lfo;
		const f1 = s.f1, f2 = s.f2, mx = s.mix, f1t = this.f1t, parallel = s.route === "parallel";
		const drive = 1 + f1.drive * 6, driveNorm = 1 / Math.min(drive, 2.5);
		const fb = f1.res * 4.2, q2 = 2 - f2.res * 1.95, q1 = 2 - f1.res * 1.95;
		const m2 = f2.morph, wLp = Math.max(0, 1 - 2 * m2), wBp = 1 - Math.abs(2 * m2 - 1), wHp = Math.max(0, 2 * m2 - 1);
		const e1s = s.env1.s, e2s = s.env2.s, c1 = this.c1, c2 = this.c2, c3 = this.c3, vs = s.vel;
		const useO1 = mx.osc1 > 0 || mx.ring > 0, useO2 = mx.osc2 > 0 || mx.ring > 0, useO3 = mx.osc3 > 0;
		let out = 0, anyGate = false, ctrlArgs = null;

		for (let vi = 0; vi < VOICES; vi++) {
			const v = this.voices[vi];
			if (!v.e2s && !v.gate) continue;
			anyGate = anyGate || v.gate;
			// envelopes: 1 attack, 2 decay, 3 sustain, 4 release, 0 idle (ENV 3 is attack / decay)
			if (v.e1s === 1) { v.e1 += (ATTACK_TARGET - v.e1) * c1[0]; if (v.e1 >= 1) { v.e1 = 1; v.e1s = 2; } }
			else if (v.e1s === 2) { v.e1 = e1s + (v.e1 - e1s) * c1[1]; if (Math.abs(v.e1 - e1s) < 1e-4) v.e1s = 3; }
			else if (v.e1s === 4) { v.e1 *= this.r1; if (v.e1 < 1e-5) { v.e1 = 0; v.e1s = 0; } }
			if (v.e1s === 3 && !v.gate) v.e1s = 4;
			if (v.e2s === 1) { v.e2 += (ATTACK_TARGET - v.e2) * c2[0]; if (v.e2 >= 1) { v.e2 = 1; v.e2s = 2; } }
			else if (v.e2s === 2) { v.e2 = e2s + (v.e2 - e2s) * c2[1]; if (Math.abs(v.e2 - e2s) < 1e-4) v.e2s = 3; }
			else if (v.e2s === 4) { v.e2 *= this.r2; if (v.e2 < 1e-5) { v.e2 = 0; v.e2s = 0; } }
			if (v.e2s === 3 && !v.gate) v.e2s = 4;
			if (v.e3s === 1) { v.e3 += (ATTACK_TARGET - v.e3) * c3[0]; if (v.e3 >= 1) { v.e3 = 1; v.e3s = 2; } }
			else if (v.e3s === 2) { v.e3 *= c3[1]; if (v.e3 < 1e-5) { v.e3 = 0; v.e3s = 0; } }

			if (v.ctrl-- <= 0) {
				if (!ctrlArgs)
					ctrlArgs = [ (patched[I_PITCH] ? ins[I_PITCH] : 0) + this.bend + lfo * l.pitch * (2 / 12),
						(patched[I_MOD2] ? ins[I_MOD2] / 5 * 7 : 0) + lfo * l.scan * 3.5,
						(patched[I_MOD1] ? ins[I_MOD1] : 0) + lfo * l.cutoff * 4 ];
				this.control(v, ctrlArgs[0], ctrlArgs[1], ctrlArgs[2], lfo);
				v.ctrl = CTRL - 1;
			}

			// oscillators: phases, mutator phases, values
			let o0 = 0, o1 = 0, o2 = 0;
			for (let k = 0; k < 2; k++) {
				const dt = v.dt[k];
				v.ph[k] = frac(v.ph[k] + dt);
				for (let j = 0; j < 2; j++) {
					const mi = k * 2 + j, mode = this.mMode[mi];
					if (mode === 1) v.mph[mi] = frac(v.mph[mi] + dt * this.mRatio[mi]);
					else if (mode === 2) {
						v.sph[mi * 2] = frac(v.sph[mi * 2] + dt * (1 + v.spr[mi]));
						v.sph[mi * 2 + 1] = frac(v.sph[mi * 2 + 1] + dt * (1 - v.spr[mi]));
					}
				}
			}
			v.ph[2] = frac(v.ph[2] + v.dt[2]);
			if (useO1) o0 = this.mut(v, 0, 0, v.ph[0]);
			if (useO2) o1 = this.mut(v, 1, 0, v.ph[1]);
			if (useO3) o2 = this.base(v, 2, v.ph[2]);
			const noise = mx.noise > 0 ? Math.random() * 2 - 1 : 0;
			const mix = (o0 * mx.osc1 + o1 * mx.osc2 + o2 * mx.osc3 + o0 * o1 * mx.ring + noise * mx.noise) * 0.5;

			// filter 1
			const x = fastTanh(mix * drive) * driveNorm;
			let y1;
			if (f1t === 0) { // LP ladder 24
				const g = v.k1, L = v.lad;
				const xin = fastTanh(x - fb * L[3]);
				L[0] += g * (xin - L[0]); L[1] += g * (L[0] - L[1]); L[2] += g * (L[1] - L[2]); L[3] += g * (L[2] - L[3]);
				y1 = L[3] * (1 + fb * 0.3);
			}
			else if (f1t === 4) { // VOWEL: two formant band passes
				const V = v.vow, q = 0.25 - f1.res * 0.2;
				let hp = x - V[0] - q * V[1]; V[1] += v.k1 * hp; V[0] += v.k1 * V[1];
				hp = x - V[2] - q * V[3]; V[3] += v.k1b * hp; V[2] += v.k1b * V[3];
				y1 = (V[1] + V[3] * 0.7) * (q + 0.1) * 2.5;
			}
			else if (f1t === 5) { // COMB
				const C = v.comb, n = 2048;
				let rp = v.combPos - v.combD; if (rp < 0) rp += n;
				const i0 = rp | 0, fr = rp - i0, a = C[i0], b = C[(i0 + 1) % n];
				const yy = x + (a + (b - a) * fr) * f1.res * 0.95;
				C[v.combPos] = fastTanh(yy);
				v.combPos = (v.combPos + 1) % n;
				y1 = yy * 0.6;
			}
			else { // LP 12 / BP / HP: state variable, 2x
				const f = v.k1, S = v.svf1;
				let hp = x - S[0] - q1 * S[1]; S[1] += f * hp; S[0] += f * S[1]; S[1] = fastTanh(S[1]);
				hp = x - S[0] - q1 * S[1]; S[1] += f * hp; S[0] += f * S[1]; S[1] = fastTanh(S[1]);
				y1 = f1t === 2 ? S[1] : (f1t === 3 ? hp : S[0]);
			}
			// filter 2: LP -> BP -> HP
			const in2 = parallel ? x : y1, S2 = v.svf2, f2c = v.k2;
			let hp2 = in2 - S2[0] - q2 * S2[1]; S2[1] += f2c * hp2; S2[0] += f2c * S2[1]; S2[1] = fastTanh(S2[1]);
			hp2 = in2 - S2[0] - q2 * S2[1]; S2[1] += f2c * hp2; S2[0] += f2c * S2[1]; S2[1] = fastTanh(S2[1]);
			const y2 = S2[0] * wLp + S2[1] * wBp + hp2 * wHp;
			const filtered = parallel ? (y1 + y2) * 0.5 : y2;
			// amp
			out += filtered * v.e2 * (1 - vs + vs * v.vel);
		}
		const lv = this.lastVoice;
		outs[O_ENV1] = lv.e1 * 5;
		outs[O_MENV] = lv.e3 * 5;
		outs[O_LFO] = lfo * 5;
		outs[O_GATE] = anyGate ? 5 : 0;
		outs[O_PITCH] = lv.pitch;                       // 1 V/oct, 0 V = C4
		outs[O_CLOCK] = this.clockPulse > 0 ? 5 : 0;    // a pulse on each arpeggiator step
		if (this.clockPulse > 0) this.clockPulse--;
		let audio = fastTanh(out * this.vol * 0.9);
		// DELAY, then REVERB
		const dl = s.delay, rv = s.reverb;
		if (dl && dl.on) {
			if (!this.dline) this.dline = new FxLine(Math.round(sampleRate * 2.1)), this.dlp = 0;
			const e = this.dline.read(clamp(dl.time, 0.01, 2) * sampleRate);
			this.dlp += (e - this.dlp) * this.dTone;
			this.dline.write(fastTanh(audio + this.dlp * clamp(dl.feedback, 0, 0.95)));
			audio += this.dlp * dl.mix;
		}
		if (rv && rv.on) {
			if (!this.rev) this.rev = new FxReverb();
			audio += this.rev.process(audio, this.rG, this.rDamp) * rv.mix;
		}
		outs[O_AUDIO] = audio;
		return audio;
	}

	endBlock(n) { this.sampleCount += n; }

	// a cycle of OSC 1 and OSC 2 through their mutators, for the panel's display
	waveform(o, n) {
		const v = this.preview, s = this.s, pts = new Array(n);
		v.mm = 0;
		const w = clamp(s.osc[o].wave, 0, 7), i0 = w | 0;
		v.t0[o] = WAVES[i0]; v.t1[o] = WAVES[Math.min(7, i0 + 1)]; v.tf[o] = i0 < 7 ? w - i0 : 0;
		for (let i = 0; i < n; i++) {
			const p = i / n;
			for (let j = 0; j < 2; j++) {
				const mi = o * 2 + j;
				v.mph[mi] = frac(p * s.mut[mi].ratio);
				v.sph[mi * 2] = frac(p * 1.03); v.sph[mi * 2 + 1] = frac(p * 0.97);
			}
			pts[i] = Math.round(this.mut(v, o, 0, p) * 1000) / 1000;
		}
		return pts;
	}

	state() {
		return {
			voices: this.voices.filter(v => v.e2s || v.gate).length,
			gates: this.voices.map(v => v.gate ? v.note : -1),
			lfo: this.lfo,
			arp: this.s.arp.on ? this.held.map(h => h[0]) : [],
			wave: [this.waveform(0, 96), this.waveform(1, 96)]
		};
	}
}
MysticDSP.OUT_IDS = OUT_IDS;
MysticDSP.IN_IDS = IN_IDS;
MysticDSP.MIDI_IN = "midi_in";
MysticDSP.POLY = true; // gets the raw MIDI notes and plays them on its own voices

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.mystic = MysticDSP;

})();
