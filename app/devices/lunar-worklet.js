// devices/lunar-worklet.js
// LUNAR 21 DSP (an ambient drone machine), hosted by the rack
// processor:
//   VOICE 1, 2, 6, 7: drone voices of 5 oscillators each (reed-like pulses), each with MUTE, TUNE and
//     MOD (a slow drift of its own), VOLT (the voice's pitch), ATT / RLS, played by its button or pad
//     (HOLD latches), its GATE input, a CV (1 V/oct) input and an ENV output
//   VOICE 3, 8: a square oscillator (PITCH, RANGE) with a sub DIVIDER, a modulator (RATE, x10) doing
//     FM and / or AM, NOISE, ATT / RLS; MOD OUT and an S&H (IN, CLOCK, OUT)
//   VOICE 4, 5: VCO 1 / 2: OCTAVE (LO, 64' to 1'), TUNE, FINE, SHAPE (sine > triangle > saw > square,
//     PW), FM; played from the touch plates (or MIDI) through EG VCA 1 / 2 (ADSR, HOLD, LOOP)
//   a 10 channel mixer (PAN, VOL: the voices, EXT AUDIO, PREAMP), FILTER L / R (12 dB, aggressive and
//   LINK), the DUAL EFFECTOR (a cartridge per side, 3 programs, X / Y / Z, BLEND), MASTER VOLUME
//   LFO A / B, JOYSTICK, 5 STEP SEQUENCER (PULSER), PREAMP and ENVELOPE FOLLOWER as CV sources

(function(){

const IN_IDS = ["ext_audio", "preamp_in",
	"v1_gate", "v1_cv", "v2_gate", "v2_cv", "v6_gate", "v6_cv", "v7_gate", "v7_cv",
	"v3_gate", "v3_fm", "v3_sh_in", "v3_sh_clk", "v8_gate", "v8_fm", "v8_sh_in", "v8_sh_clk",
	"v4_voct", "v4_fm", "v4_shape", "v5_voct", "v5_fm", "v5_shape", "v5_sync",
	"eg1_gate", "vca1_cv", "eg2_gate", "vca2_cv",
	"fx_cvx", "fx_cvy", "fx_cvz", "filt_cv", "seq_clock", "preamp_cv"];
const OUT_IDS = ["out_l", "out_r", "dry4", "dry5",
	"v1_env", "v2_env", "v6_env", "v7_env", "v3_env", "v3_mod", "v3_sh", "v8_env", "v8_mod", "v8_sh",
	"v4_out", "v5_out", "eg1_out", "eg2_out", "lfoa_out", "lfob_out", "joy_x", "joy_y",
	"pulser_out", "seq_cv", "seq_gate", "envf_out", "envf_gate", "kb_voct", "kb_gate", "kb_voct2", "kb_gate2"];
const I = {}, O = {};
IN_IDS.forEach((id, i) => I[id] = i);
OUT_IDS.forEach((id, i) => O[id] = i);
const DRONES = [1, 2, 6, 7], NOISES = [3, 8];
// the jacks of each voice, looked up once
const DJ = DRONES.map(n => ({ gate: I["v" + n + "_gate"], cv: I["v" + n + "_cv"], env: O["v" + n + "_env"] }));
const NJ = NOISES.map(n => ({ gate: I["v" + n + "_gate"], fm: I["v" + n + "_fm"], shIn: I["v" + n + "_sh_in"], shClk: I["v" + n + "_sh_clk"], env: O["v" + n + "_env"], mod: O["v" + n + "_mod"], sh: O["v" + n + "_sh"] }));
const VJ = [4, 5].map((n, k) => ({ voct: I["v" + n + "_voct"], fm: I["v" + n + "_fm"], shape: I["v" + n + "_shape"], out: O["v" + n + "_out"],
	egGate: I["eg" + (k + 1) + "_gate"], egOut: O["eg" + (k + 1) + "_out"], vca: I["vca" + (k + 1) + "_cv"], dry: O["dry" + n] }));
const FOOT = [-7, -3, -2, -1, 0, 1, 2, 3]; // OCTAVE: LO, 64', 32', 16', 8', 4', 2', 1' (octaves from 8')
const C2 = 65.406;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function tanh(x) { if (x < -3) return -1; if (x > 3) return 1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function frac(x) { return x - Math.floor(x); }
function blep(t, dt) { // polyBLEP: the step's correction near the discontinuity
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}
function pulse(ph, dt, pw) { // band-limited pulse
	let y = ph < pw ? 1 : -1;
	y += blep(ph, dt);
	y -= blep(frac(ph - pw + 1), dt);
	return y;
}
function envCoef(t) { return 1 - Math.exp(-1 / (Math.max(0.0005, t) * sampleRate)); }

// ---------------------------------------------------------------------------
// building blocks of the effector

class Line {
	constructor(n) { this.b = new Float32Array(n); this.n = n; this.w = 0; }
	write(x) { this.b[this.w] = x; this.w = (this.w + 1) % this.n; }
	read(d) { // d samples back, interpolated
		d = clamp(d, 1, this.n - 2);
		let p = this.w - d; if (p < 0) p += this.n;
		let i = p | 0;
		if (i >= this.n) i -= this.n; // p a hair under 0, wrapped, rounds to n
		const f = p - Math.floor(p), a = this.b[i], b = this.b[(i + 1) % this.n];
		return a + (b - a) * f;
	}
}

class Reverb { // 4 line feedback delay network, mono
	constructor() {
		const k = sampleRate / 44100;
		this.lines = [1557, 1617, 1491, 1422].map(l => new Line(Math.round(l * k) + 2));
		this.len = this.lines.map(l => l.n - 2);
		this.lp = new Float64Array(4);
		this.ap = new Line(Math.round(556 * k) + 2); this.apLen = Math.round(556 * k);
		this.o = new Float64Array(4);
	}
	process(x, decay, damp) {
		const L = this.lines, o = this.o;
		for (let k = 0; k < 4; k++) o[k] = L[k].read(this.len[k]);
		const s = (o[0] + o[1] + o[2] + o[3]) * 0.5;
		const g = clamp(decay, 0, 0.985);
		for (let k = 0; k < 4; k++) {
			this.lp[k] += (s - o[k] - this.lp[k]) * (1 - damp);
			L[k].write(x * 0.5 + this.lp[k] * g);
		}
		// a diffusing all-pass on the way out
		const y = (o[0] + o[2]) * 0.5, d = this.ap.read(this.apLen), v = y + d * 0.5;
		this.ap.write(v);
		return d - v * 0.5;
	}
}

class Shifter { // pitch shifter: two read heads sweeping a 60 ms window, crossfaded
	constructor() { this.line = new Line(Math.round(sampleRate * 0.2)); this.ph = 0; this.win = Math.round(sampleRate * 0.06); }
	process(x, semis) {
		this.line.write(x);
		const r = Math.pow(2, semis / 12);
		this.ph = frac(this.ph + (1 - r) / this.win);
		const p2 = frac(this.ph + 0.5);
		const g1 = Math.sin(Math.PI * this.ph), g2 = Math.sin(Math.PI * p2);
		return this.line.read(2 + this.ph * this.win) * g1 + this.line.read(2 + p2 * this.win) * g2;
	}
}

// the cartridges: [name, [the 3 programs: [name, X, Y, Z]]] (main thread: the same list)
const CARTRIDGES = [
	["CATHEDRAL", [["SHIMMER", "OCT UP", "OCT DOWN", "DECAY"], ["OCT UP DELAY", "FEEDBACK", "DELAY", "REVERB"], ["SPACE REVERB", "FEEDBACK", "DELAY", "REVERB"]]],
	["TIME", [["DELAY REVERB", "FEEDBACK", "DELAY", "REVERB"], ["DELAY CHORUS", "FEEDBACK", "DELAY", "MOD DEPTH"], ["DELAY VIBRATO", "FEEDBACK", "DELAY / RATE", "MOD DEPTH"]]],
	["MAGIC", [["PITCH DELAY", "FEEDBACK", "DELAY", "PITCH"], ["REVERSE DELAY", "FEEDBACK", "DELAY", "PITCH"], ["BELL DELAY", "FEEDBACK", "DELAY", "PITCH"]]],
	["INFINITY", [["RESONANCE REVERB", "PRE DELAY", "PRE DELAY MOD", "DECAY"], ["O.D.D.", "FEEDBACK", "DELAY", "PITCH"], ["RESONANCE DELAY", "FEEDBACK", "DELAY", "PITCH"]]],
	["VIBROTREM", [["TREMOLO", "DEPTH", "RATE", "REVERB"], ["VIBRATO", "DEPTH", "RATE", "REVERB"], ["CHORUS", "DEPTH", "RATE", "REVERB"]]],
	["VIBE", [["PHASER", "DEPTH", "RATE", "REVERB"], ["FLANGER", "DEPTH", "RATE", "REVERB"], ["RESONANCE", "RESONANCE", "RATE", "MOD DEPTH"]]],
	["PITCH SHIFTER", [["SYNTHTAVER", "OCT DOWN", "OCT UP", "DIRECT"], ["OCTAVER", "OCT DOWN", "OCT UP", "DIRECT"], ["HARMONIZER", "PITCH 1", "PITCH 2", "VOICE MIX"]]],
	["STRING RINGER", [["SYNTHETIC RING", "FREQUENCY", "RESONANCE", "SUB"], ["RING MOD", "FREQUENCY", "RATE", "REVERB"], ["S&H RING MOD", "PITCH SPEED", "S&H RATE", "FREQ"]]],
	["DIGITAL", [["FILTER DAC", "FILTER", "SAMPLE RATE", "INPUT GAIN"], ["LFO DAC", "SAMPLE RATE", "LFO SPEED", "LFO AMOUNT"], ["ENVELOPE CRUSHER", "SAMPLE RATE", "ENV AMOUNT", "INPUT GAIN"]]],
	["FILTER", [["AUTO WAH", "FILTER", "ENVELOPE", "REVERB"], ["LFO WAH", "FILTER", "RATE", "RESONANCE"], ["DUAL FILTER", "CUT 1", "CUT 2", "RESONANCE"]]]
];

class Effector { // one side of the DUAL EFFECTOR
	constructor() {
		this.d = new Line(Math.round(sampleRate * 2.1));
		this.d2 = new Line(Math.round(sampleRate * 0.1));
		this.rev = new Reverb();
		this.sh1 = new Shifter(); this.sh2 = new Shifter();
		this.lfo = 0; this.lfo2 = 0.25; this.fb = 0; this.env = 0; this.hold = 0; this.hcount = 0; this.sh = 0;
		this.ap = new Float64Array(4); this.svfS = new Float64Array(4); this.rc = 0; this.revOut = 0; this.ring = 0;
		this.lp = 0; this.bp = 0; this.hp = 0; this.quiet = 0;
		this.rev_ph = 0;
	}
	// state variable filter k (0, 1): this.lp / this.bp / this.hp
	svf(k, x, fc, q) {
		const f = Math.min(1, 2 * Math.sin(Math.PI * Math.min(fc, sampleRate * 0.15) / sampleRate)), S = this.svfS;
		q = Math.min(q, 1.95 - f);
		const h = x - S[k * 2] - q * S[k * 2 + 1]; S[k * 2 + 1] += f * h; S[k * 2] += f * S[k * 2 + 1];
		S[k * 2 + 1] = tanh(S[k * 2 + 1]);
		this.lp = S[k * 2]; this.bp = S[k * 2 + 1]; this.hp = h;
	}
	clear() { // silence everything inside, so waking up starts clean
		[this.d, this.d2, this.sh1.line, this.sh2.line, this.rev.ap].concat(this.rev.lines).forEach(l => l.b.fill(0));
		this.rev.lp.fill(0); this.ap.fill(0); this.svfS.fill(0); this.fb = 0; this.revOut = 0;
	}
	lfoStep(rate) { this.lfo = frac(this.lfo + rate / sampleRate); return Math.sin(2 * Math.PI * this.lfo); }
	process(x, cart, prog, X, Y, Z) {
		const sr = sampleRate;
		// asleep after 4 s of silence (the tails rung out); wakes with the first sound
		if (Math.abs(x) > 1e-5) this.quiet = 0;
		else if (++this.quiet > 4 * sr) { if (this.quiet === 4 * sr + 1) this.clear(); this.quiet = 4 * sr + 2; return 0; }
		const a = Math.abs(x); this.env += (a - this.env) * (a > this.env ? 0.01 : 0.0003);
		let y = 0, t;
		switch (cart) {
			case 0: // CATHEDRAL
				if (prog === 0) { // shimmer: the reverb fed back an octave up / down
					const fbk = this.sh1.process(this.revOut, 12) * X * 0.5 + this.sh2.process(this.revOut, -12) * Y * 0.4;
					this.revOut = this.rev.process(x + fbk, 0.75 + Z * 0.23, 0.35);
					y = this.revOut;
				}
				else {
					t = 0.05 + Y * Y * 1.5;
					const dl = this.d.read(t * sr);
					this.d.write(x + (prog === 1 ? this.sh1.process(dl, 12) : dl) * X * 0.85);
					y = dl * 0.8 + this.rev.process(prog === 1 ? dl : x + dl, 0.6 + Z * 0.38, 0.3) * Z * 1.2;
				}
				break;
			case 1: { // TIME
				let d = (0.02 + Y * Y * 1.6) * sr;
				if (prog === 2) d = 0.3 * sr + this.lfoStep(0.2 + Y * 6) * Z * 0.004 * sr;
				const dl = this.d.read(d);
				this.d.write(tanh(x + dl * X * 0.95));
				if (prog === 0) y = dl + this.rev.process(dl, 0.8, 0.3) * Z;
				else if (prog === 1) { this.d2.write(dl); y = dl * 0.5 + this.d2.read((0.01 + 0.005 * this.lfoStep(0.6) * Z) * sr) * 0.7; }
				else y = dl;
				break;
			}
			case 2: { // MAGIC: pitched (reversed, bell) repeats
				const semis = Math.round((Z - 0.5) * 24) || 12;
				t = (0.08 + Y * Y * 1.2) * sr;
				let dl;
				if (prog === 1) { // reversed: read backwards through the delay window
					this.rev_ph = (this.rev_ph + 2) % t;
					dl = this.d.read(this.rev_ph + 1) * Math.sin(Math.PI * this.rev_ph / t);
				}
				else dl = this.d.read(t);
				const p = this.sh1.process(dl, prog === 2 ? (semis > 0 ? semis + 7 : semis) : semis);
				this.d.write(x + p * X * 0.85);
				if (prog === 2) this.svf(0, p, 1200, 0.5);
				y = prog === 2 ? this.hp * 0.9 + dl * 0.3 : p + dl * 0.3;
				break;
			}
			case 3: // INFINITY
				if (prog === 0) { // a big resonant reverb after a (modulated) pre delay
					const pd = (0.01 + X * 0.25 + this.lfoStep(0.3) * Y * 0.02) * sr;
					this.d.write(x);
					y = this.rev.process(this.d.read(pd), 0.9 + Z * 0.095, 0.15);
				}
				else { // a dirty delay oscillating in its feedback, or a resonant short one
					t = prog === 1 ? (0.05 + Y * 0.8) * sr : (0.002 + Y * Y * 0.05) * sr;
					const dl = this.d.read(t);
					const p = Z > 0.52 || Z < 0.48 ? this.sh1.process(dl, Math.round((Z - 0.5) * 24)) : dl;
					this.d.write(tanh(x + p * (prog === 1 ? 0.6 + X * 0.55 : 0.5 + X * 0.49) * (prog === 1 ? 1.4 : 1)));
					y = dl;
				}
				break;
			case 4: { // VIBROTREM
				const m = this.lfoStep(0.2 + Y * Y * 12);
				if (prog === 0) y = x * (1 - X * (0.5 + 0.5 * m));
				else {
					this.d2.write(x);
					const dd = prog === 1 ? (0.004 + 0.003 * m * X) * sr : (0.015 + 0.008 * m * X) * sr;
					y = prog === 1 ? this.d2.read(dd) : x * 0.6 + this.d2.read(dd) * 0.7;
				}
				y += this.rev.process(y, 0.82, 0.3) * Z;
				break;
			}
			case 5: { // VIBE: phaser, flanger, resonance
				const m = 0.5 + 0.5 * this.lfoStep(0.05 + Y * Y * 6);
				if (prog === 0) {
					let v = x + this.fb * 0.5;
					const g = 0.3 + m * X * 0.65;
					for (let k = 0; k < 4; k++) { const o = -g * v + this.ap[k]; this.ap[k] = v + g * o; v = o; }
					this.fb = v;
					y = (x + v) * 0.6 + this.rev.process(v, 0.7, 0.3) * Z;
				}
				else {
					this.d2.write(x + this.fb * (prog === 1 ? 0.6 : 0.5 + X * 0.48));
					const dd = prog === 1 ? (0.0008 + m * X * 0.006) * sr : (0.002 + 0.01 * (1 - Y)) * sr * (1 + (m - 0.5) * Z * 0.2);
					this.fb = this.d2.read(dd);
					y = prog === 1 ? (x + this.fb) * 0.6 + this.rev.process(this.fb, 0.7, 0.3) * Z : this.fb;
				}
				break;
			}
			case 6: { // PITCH SHIFTER
				if (prog === 2) {
					const p1 = this.sh1.process(x, Math.round((X - 0.5) * 24)), p2 = this.sh2.process(x, Math.round((Y - 0.5) * 24));
					y = x * (1 - Z) + (p1 + p2) * 0.5 * Z * 1.3;
				}
				else {
					const dn = this.sh1.process(x, -12), up = this.sh2.process(prog === 0 ? tanh(x * 3) : x, 12);
					y = dn * X + up * Y + x * Z;
				}
				break;
			}
			case 7: { // STRING RINGER
				if (prog === 0) {
					const f = 40 * Math.pow(100, X);
					this.ring = frac(this.ring + f / sr);
					const r = x * Math.sin(2 * Math.PI * this.ring);
					this.svf(0, r, f * 2, 0.6 - Y * 0.55);
					y = this.bp + this.sh1.process(x, -12) * Z;
				}
				else {
					let f = 40 * Math.pow(100, prog === 1 ? X : Z);
					if (prog === 2) {
						if (++this.hcount > sr / (1 + Y * 30)) { this.hcount = 0; this.sh = Math.random(); }
						f *= Math.pow(2, (this.sh - 0.5) * 2 * X * 3);
					}
					else f *= 1 + 0.3 * this.lfoStep(0.1 + Y * 8);
					this.ring = frac(this.ring + f / sr);
					y = x * Math.sin(2 * Math.PI * this.ring);
					if (prog === 1) y += this.rev.process(y, 0.8, 0.3) * Z;
				}
				break;
			}
			case 8: { // DIGITAL: sample rate reduction
				let rate = prog === 0 ? Y : X;
				if (prog === 1) rate = clamp(rate + this.lfoStep(0.1 + Y * 10) * Z * 0.5, 0, 1);
				if (prog === 2) rate = clamp(rate + this.env * Y * 4, 0, 1);
				const sr2 = 300 * Math.pow(100, rate);
				this.hcount += sr2 / sr;
				if (this.hcount >= 1) { this.hcount -= Math.floor(this.hcount); this.hold = tanh(x * (prog === 1 ? 1 : 1 + Z * 6)); }
				y = Math.round(this.hold * 32) / 32;
				if (prog === 0) { this.svf(0, y, 200 * Math.pow(80, X), 1); y = this.lp; }
				break;
			}
			default: { // FILTER
				if (prog === 2) {
					this.svf(0, x, 100 * Math.pow(150, X), 2 - Z * 1.9);
					this.svf(1, this.lp, 30 * Math.pow(100, Y), 2 - Z * 1.9);
					y = this.hp;
				}
				else {
					const mod = prog === 0 ? clamp(this.env * Y * 8, 0, 1) : 0.5 + 0.5 * this.lfoStep(0.1 + Y * 6);
					this.svf(0, x, 200 * Math.pow(30, clamp(X * 0.4 + mod * 0.6, 0, 1)), prog === 0 ? 0.4 : 2 - Z * 1.9);
					y = this.bp * 1.6;
					if (prog === 0) y += this.rev.process(y, 0.8, 0.3) * Z;
				}
			}
		}
		return y;
	}
}

// ---------------------------------------------------------------------------

function newDrone() { return { ph: new Float64Array(5), dt: new Float64Array(5), ctrl: 0, drift: [0, 1, 2, 3, 4].map(k => ({ ph: Math.random(), rate: 0.07 + k * 0.053 + Math.random() * 0.05 })), env: 0, lp: 0, gate: false, gateHigh: 0 }; }
function newNoise() { return { ph: 0, sub: 0, subOut: 1, mph: 0, env: 0, gate: false, gateHigh: 0, sh: 0, shHigh: 0, lp: 0, last: 1 }; }
function newVco() { return { ph: 0, syncHigh: 0 }; }
function newEg() { return { v: 0, stage: 0, gate: false, gateHigh: 0 }; } // stage: 0 idle, 1 attack, 2 decay / sustain, 3 release

class LunarDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.outPatched = new Uint8Array(OUT_IDS.length); // set by the host: which outputs are cabled
		this.midiConnected = false;
		this.drones = DRONES.map(newDrone);
		this.noises = NOISES.map(newNoise);
		this.vcos = [newVco(), newVco()];
		this.egs = [newEg(), newEg()];
		this.fx = [new Effector(), new Effector()];
		this.flt = [[0, 0], [0, 0]];
		this.lfo = [0, 0.3];
		this.seq = { ph: 0, step: -1, clkHigh: 0, gateOn: false, pulser: false };
		this.envf = 0; this.envfGate = false;
		this.droneGates = [false, false, false, false, false, false]; // the buttons / pads held: v1, v2, v3, v6, v7, v8
		this.kb = { notes: [], held: [] };     // held plates / MIDI notes; their voltages
		this.kbOut = [{ v: 0, gate: false }, { v: 0, gate: false }];
		this.sampleCount = 0;
		this.dcl = 0; this.dcr = 0;
		this.light = { drones: [0, 0, 0, 0, 0, 0], lfo: [0, 0], seq: -1, eg: [0, 0], envf: 0 };
	}

	message(m) {
		switch (m.type) {
			case "drone": this.droneGates[m.index] = !!m.on; break;
			case "plate": this.kbNote(m.note, m.on); break;
			case "note": this.kbNote(m.note - 48, m.on); break; // MIDI: C3 = the first plate at octave 0
			case "allNotesOff": this.kb.notes = []; this.kbAssign(); break;
		}
	}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	// the plates / MIDI: notes held, newest last; UNISON: both VCOs on the newest, DUO: the two newest
	kbNote(note, on) {
		this.kb.notes = this.kb.notes.filter(n => n !== note);
		if (on) this.kb.notes.push(note);
		this.kbAssign();
	}
	kbAssign() {
		const n = this.kb.notes, s = this.s, oct = s ? s.kb.octave * 12 : 0;
		const v = (note) => (note + oct) / 12;
		if (!n.length) { this.kbOut[0].gate = false; this.kbOut[1].gate = false; return; }
		const last = n[n.length - 1];
		if (s && s.kb.mode === "duo" && n.length > 1) {
			this.kbOut[0].v = v(n[n.length - 2]); this.kbOut[1].v = v(last);
			this.kbOut[0].gate = this.kbOut[1].gate = true;
		}
		else {
			this.kbOut[0].v = this.kbOut[1].v = v(last);
			this.kbOut[0].gate = this.kbOut[1].gate = true;
		}
	}

	edge(i, st, k) { // a gate input's rising / falling edge: +1, -1, 0
		const high = this.ins[i] > 1 ? 1 : 0, was = st[k];
		st[k] = high;
		return high && !was ? 1 : (!high && was ? -1 : 0);
	}

	// the mixer's gains per block: VOL (squared), PAN (equal power)
	beginBlock() {
		const s = this.s;
		this.gl = this.gl || new Float64Array(10); this.gr = this.gr || new Float64Array(10);
		for (let c = 0; c < 10; c++) {
			const m = s.mix[c], g = m.vol * m.vol * 1.2, a = (clamp(m.pan, -1, 1) + 1) * Math.PI / 4;
			this.gl[c] = g * Math.cos(a); this.gr[c] = g * Math.sin(a);
		}
		this.filterBase();
	}
	filterBase() { const fl = this.s.filt; this.fcL = 30 * Math.pow(600, fl.l.freq); this.fcR = 30 * Math.pow(600, (fl.link ? fl.l : fl.r).freq); }
	mixIn(ch, x) { this.busL += x * this.gl[ch]; this.busR += x * this.gr[ch]; }

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, P = this.patched, sr = sampleRate;
		this.busL = 0; this.busR = 0;

		// ---- LFO A / B (0..10 V): WAVE morphs triangle > square ----
		const lfoV = [0, 0];
		for (let k = 0; k < 2; k++) {
			const l = s.lfo[k];
			this.lfo[k] = frac(this.lfo[k] + (0.02 * Math.pow(1000, l.rate)) / sr);
			const tri = 1 - 4 * Math.abs(this.lfo[k] - 0.5), sq = this.lfo[k] < 0.5 ? 1 : -1;
			lfoV[k] = tri + (sq - tri) * l.wave;
			outs[O.lfoa_out + k] = (lfoV[k] + 1) * 5;
		}
		// ---- JOYSTICK ----
		outs[O.joy_x] = clamp(s.joy.x * 5 + (s.joy.offx - 0.5) * 10, -10, 10);
		outs[O.joy_y] = clamp(s.joy.y * 5 + (s.joy.offy - 0.5) * 10, -10, 10);

		// ---- 5 STEP SEQUENCER, clocked by the PULSER (or CLOCK in) ----
		const sq = this.seq, pRate = 0.1 * Math.pow(200, s.seq.pulser);
		sq.ph += pRate / sr;
		const pulserTick = sq.ph >= 1;
		if (pulserTick) sq.ph -= Math.floor(sq.ph);
		outs[O.pulser_out] = sq.ph < 0.5 ? 10 : -10;
		let clk = false;
		if (P[I.seq_clock]) clk = this.edge(I.seq_clock, sq, "clkHigh") > 0;
		else clk = pulserTick;
		if (clk) {
			sq.step = (sq.step + 1) % (s.seq.stages === 4 ? 4 : 5);
			sq.gateOn = s.seq.steps[sq.step].gate;
			sq.gateTimer = Math.round(0.5 * sr / pRate);
		}
		if (sq.gateTimer > 0 && --sq.gateTimer === 0 && !P[I.seq_clock]) sq.gateOn = false;
		if (P[I.seq_clock] && ins[I.seq_clock] < 1) sq.gateOn = false;
		const stepV = sq.step >= 0 ? s.seq.steps[sq.step].v : 0;
		outs[O.seq_cv] = stepV * 5;
		outs[O.seq_gate] = sq.gateOn ? 10 : 0;

		// ---- the plates' CV / gates ----
		outs[O.kb_voct] = this.kbOut[0].v; outs[O.kb_gate] = this.kbOut[0].gate ? 8 : 0;
		outs[O.kb_voct2] = this.kbOut[1].v; outs[O.kb_gate2] = this.kbOut[1].gate ? 8 : 0;

		// ---- drone voices 1, 2, 6, 7 ----
		for (let k = 0; k < 4; k++) {
			const d = this.drones[k], ds = s.drones[k], J = DJ[k], gi = J.gate, ci = J.cv;
			const gate = this.droneGates[[0, 1, 3, 4][k]] || ds.latched || (P[gi] && ins[gi] > 1);
			d.env += ((gate ? 1 : 0) - d.env) * envCoef(gate ? ds.att : ds.rls);
			let x = 0;
			if (d.env > 0.0005) {
				// the increments every 32 samples: VOLT, CV, TUNE, the MOD drift
				if (d.ctrl-- <= 0) {
					d.ctrl = 31;
					const base = C2 * Math.pow(2, ds.volt / 12 + (P[ci] ? ins[ci] : 0));
					for (let j = 0; j < 5; j++) {
						const o = ds.osc[j], dr = d.drift[j];
						dr.ph = frac(dr.ph + dr.rate * 32 / sr);
						d.dt[j] = Math.min(0.45, base * Math.pow(2, (o.tune + Math.sin(2 * Math.PI * dr.ph) * o.mod * 0.6) / 12) / sr);
					}
				}
				let on = 0;
				for (let j = 0; j < 5; j++) {
					if (!ds.osc[j].on) continue;
					on++;
					const dt = d.dt[j];
					d.ph[j] = frac(d.ph[j] + dt);
					x += pulse(d.ph[j], dt, 0.22 + j * 0.04);
				}
				if (on) x /= Math.sqrt(on) * 2.2;
				d.lp += (x - d.lp) * 0.18; // a softer reed
				x = d.lp * d.env;
			}
			outs[J.env] = d.env * 10;
			this.light.drones[[0, 1, 3, 4][k]] = d.env;
			this.mixIn(DRONES[k] - 1, x);
		}

		// ---- voices 3, 8: square with a sub divider, modulator FM / AM, noise, S&H ----
		for (let k = 0; k < 2; k++) {
			const n = this.noises[k], ns = s.noises[k], J = NJ[k], gi = J.gate;
			const gate = this.droneGates[k ? 5 : 2] || ns.latched || (P[gi] && ins[gi] > 1);
			n.env += ((gate ? 1 : 0) - n.env) * envCoef(gate ? ns.att : ns.rls);
			n.mph = frac(n.mph + 0.03 * Math.pow(600, ns.rate) * (ns.x10 ? 10 : 1) / sr);
			const mod = 1 - 4 * Math.abs(n.mph - 0.5); // triangle -1..1
			outs[J.mod] = (mod + 1) * 6;
			const noise = Math.random() * 2 - 1;
			let x = 0;
			if (n.env > 0.0005) {
				let f = (ns.range === "hi" ? 80 : 20) * Math.pow(ns.range === "hi" ? 60 : 30, ns.pitch);
				if (ns.fm) f *= Math.pow(2, mod * ns.fm_amt * 3);
				if (P[J.fm]) f *= Math.pow(2, ins[J.fm] * ns.fm_amt);
				const dt = Math.min(0.45, f / sr);
				n.ph += dt;
				if (n.ph >= 1) { // the divider counts the cycles
					n.ph -= 1;
					if (++n.sub >= Math.max(1, Math.round(ns.divider))) { n.sub = 0; n.subOut = -n.subOut; }
				}
				const tone = pulse(n.ph, dt, 0.5) * 0.6 + (ns.divider >= 1.5 ? n.subOut * 0.5 : 0);
				x = tone * (1 - ns.noise) + noise * ns.noise;
				if (ns.am) x *= 0.5 + 0.5 * mod;
				n.lp += (x - n.lp) * 0.3;
				x = n.lp * n.env * 0.6;
			}
			outs[J.env] = n.env * 10;
			this.light.drones[k ? 5 : 2] = n.env;
			// S&H: IN (else the noise) on CLOCK (else the modulator)
			const clkI = J.shClk;
			const tickSh = P[clkI] ? this.edge(clkI, n, "shHigh") > 0 : (mod > 0 && n.last <= 0);
			n.last = mod;
			if (tickSh) n.sh = P[J.shIn] ? clamp(ins[J.shIn], -5, 5) : noise * 5;
			outs[J.sh] = n.sh;
			this.mixIn(NOISES[k] - 1, x);
		}

		// ---- voices 4, 5: VCO 1 / 2 through EG VCA 1 / 2 ----
		for (let k = 0; k < 2; k++) {
			const v = this.vcos[k], vs = s.vcos[k], eg = this.egs[k], es = s.egs[k], J = VJ[k];
			const kbv = this.kbOut[k];
			const egOn = es.hold || eg.stage !== 0 || kbv.gate || (P[J.egGate] && ins[J.egGate] > 1);
			if (!egOn && !this.outPatched[J.out]) { // silent and not cabled: skip the oscillator
				outs[J.out] = 0; outs[J.egOut] = 0; outs[J.dry] = 0; eg.gate = false;
				continue;
			}
			const voct = (P[J.voct] ? ins[J.voct] : 0) + kbv.v;
			let pitch = FOOT[vs.octave] + voct + (vs.tune + vs.fine) / 12;
			if (P[J.fm]) pitch += ins[J.fm] * vs.fm * 0.5;
			const f = 261.63 * Math.pow(2, pitch - 1); // 8', the first plate: C3
			const dt = Math.min(0.45, f / sr);
			if (k === 1 && P[I.v5_sync] && this.edge(I.v5_sync, v, "syncHigh") > 0) v.ph = 0;
			v.ph = frac(v.ph + dt);
			const shape = clamp(vs.shape + (P[J.shape] ? ins[J.shape] / 5 : 0), 0, 1) * 3;
			const p = v.ph;
			const sine = Math.sin(2 * Math.PI * p), tri = 1 - 4 * Math.abs(p - 0.5);
			const saw = 2 * p - 1 - blep(p, dt), sqw = pulse(p, dt, 0.5 + (vs.pw - 0.5) * 0.9);
			const w = [sine, tri, saw, sqw], i0 = Math.min(2, Math.floor(shape)), fr = shape - i0;
			const x = w[i0] + (w[i0 + 1] - w[i0]) * fr;
			outs[J.out] = x * 5;
			// EG: ADSR; HOLD keeps the gate open; LOOP: attack / decay over and over
			const gi = J.egGate;
			const gate = es.hold || (P[gi] ? ins[gi] > 1 : kbv.gate);
			if (gate && !eg.gate) eg.stage = 1;
			if (!gate && eg.gate) eg.stage = 3;
			eg.gate = gate;
			if (eg.stage === 1) { eg.v += (1.05 - eg.v) * envCoef(es.a); if (eg.v >= 1) { eg.v = 1; eg.stage = 2; } }
			else if (eg.stage === 2) {
				eg.v += (es.s - eg.v) * envCoef(es.d);
				if (es.loop && Math.abs(eg.v - es.s) < 0.01) eg.stage = 1;
			}
			else if (eg.stage === 3) { eg.v += (0 - eg.v) * envCoef(es.r); if (eg.v < 1e-4) { eg.v = 0; eg.stage = 0; } }
			outs[J.egOut] = eg.v * 8;
			this.light.eg[k] = eg.v;
			const ci = J.vca;
			const gain = clamp(eg.v + (P[ci] ? ins[ci] / 5 : 0), 0, 1.5);
			const y = x * gain * 0.5;
			outs[J.dry] = y;
			this.mixIn(3 + k, y);
		}

		// ---- EXT AUDIO, PREAMP (with the ENVELOPE FOLLOWER) ----
		if (P[I.ext_audio]) this.mixIn(8, ins[I.ext_audio]);
		// PREAMP: the rear PREAMP IN (audio) and the front EXT. SOURCE (a CV-level signal, / 5)
		const preIn = (P[I.preamp_in] ? ins[I.preamp_in] : 0) + (P[I.preamp_cv] ? ins[I.preamp_cv] / 5 : 0);
		const pre = P[I.preamp_in] || P[I.preamp_cv] ? tanh(preIn * (1 + s.preamp.gain * 20)) : 0;
		this.mixIn(9, pre);
		const a = Math.abs(pre);
		this.envf += (a - this.envf) * (a > this.envf ? envCoef(s.envf.att) : envCoef(s.envf.rls));
		outs[O.envf_out] = clamp(this.envf * 14, 0, 10);
		this.envfGate = this.envf > (this.envfGate ? 0.04 : 0.07);
		outs[O.envf_gate] = this.envfGate ? 8 : 0;

		// ---- FILTER L / R: 12 dB, aggressive (driven integrators), LINK: R follows L ----
		const fcv = P[I.filt_cv] ? ins[I.filt_cv] * s.filt.cv * 2 : 0; // CV FREQ: 1 V/oct at half
		const fl = s.filt.l, fr2 = s.filt.link ? s.filt.l : s.filt.r;
		const run = this.runFilter || (this.runFilter = (k, x, st, fcv) => {
			// run twice a sample: the coefficient for twice the rate
			const fc = clamp(st === this.s.filt.l ? this.fcL : this.fcR, 20, 1e9) * (fcv ? Math.pow(2, fcv) : 1);
			if (fc > 10000 || fc !== st._fc) { st._fc = Math.min(fc, 10000, sr * 0.2); st._f = 2 * Math.sin(Math.PI * st._fc / (2 * sr)); }
			const f = st._f, S = this.flt[k];
			const q = Math.max(0.04, Math.min(2 - st.res * 1.96, 1.9 - f)); // stable: the damping under 2 - f
			for (let n = 0; n < 2; n++) {
				const h = tanh(x * 0.8) - S[0] - q * S[1];
				S[1] = tanh(S[1] + f * h); S[0] = tanh(S[0] + f * S[1]);
			}
			return S[0] * 1.2;
		});
		let l = run(0, this.busL, fl, fcv), r = run(1, this.busR, fr2, fcv);

		// ---- DUAL EFFECTOR: a cartridge on each side, BLEND, MASTER VOLUME ----
		const cx = P[I.fx_cvx] ? ins[I.fx_cvx] / 10 : 0, cy = P[I.fx_cvy] ? ins[I.fx_cvy] / 10 : 0, cz = P[I.fx_cvz] ? ins[I.fx_cvz] / 10 : 0;
		const cl = s.fx.ch[0], cr = s.fx.ch[1], b = s.fx.blend;
		const wl = b > 0.001 ? this.fx[0].process(l, cl.cart, cl.prog, clamp(cl.x + cx, 0, 1), clamp(cl.y + cy, 0, 1), clamp(cl.z + cz, 0, 1)) : 0;
		const wr = b > 0.001 ? this.fx[1].process(r, cr.cart, cr.prog, clamp(cr.x + cx, 0, 1), clamp(cr.y + cy, 0, 1), clamp(cr.z + cz, 0, 1)) : 0;
		const mv = s.fx.master * s.fx.master * 1.5;
		let ol = (l * (1 - b) + wl * b) * mv, or = (r * (1 - b) + wr * b) * mv;
		this.dcl += (ol - this.dcl) * 0.0004; this.dcr += (or - this.dcr) * 0.0004; // DC blocker
		outs[O.out_l] = tanh(ol - this.dcl);
		outs[O.out_r] = tanh(or - this.dcr);

		this.light.lfo[0] = lfoV[0]; this.light.lfo[1] = lfoV[1];
		this.light.seq = sq.step; this.light.seqGate = sq.gateOn; this.light.envf = this.envf;
		this.sampleCount++;
		return 0;
	}

	endBlock() {}

	state() {
		const L = this.light;
		return { drones: L.drones.map(v => Math.round(v * 100) / 100), lfo: L.lfo.slice(), seq: L.seq, seqGate: !!L.seqGate, eg: L.eg.slice(), envf: L.envf, sig: L.envf > 0.02 };
	}
}
LunarDSP.OUT_IDS = OUT_IDS;
LunarDSP.IN_IDS = IN_IDS;
LunarDSP.MIDI_IN = "midi_in";
LunarDSP.POLY = true;
LunarDSP.CARTRIDGES = CARTRIDGES;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.lunar = LunarDSP;

})();
