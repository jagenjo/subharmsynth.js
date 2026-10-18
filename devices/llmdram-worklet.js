// devices/llmdram-worklet.js
// LLM DRAM DSP (an early 80s style sampling drum machine), hosted by
// the rack processor. The drum sounds are synthesized here at start (not the original samples), at
// 28 kHz, and kept as 8-bit companded and 12-bit "samples" played back without interpolation, which
// gives them the grain of the early sampling drum machines.
//   24 pad sounds (some share a mixer channel: SNARE 1-3, BASS 1-2, HI HAT 1 / 2 / OPEN, ...) on 16
//   mixer channels, each with PAN, LEVEL, MUTE / SOLO, SEND (to the FX bus) and the display's
//   parameters (BIT, SAMP, DIST, PLAY direction, TUNE, LEV, STRT, LEN, LOOP), plus the TUNE knobs.
//   FX bus: WAVE DESIGNER (attack / sustain transient shaper) and ANALOG FILTER (4-pole low pass, or
//   high pass, with resonance). INPUT: the rear IN into the mix. MASTER.
//   Sequencer: 16 patterns of up to 64 steps (1/16), swing, auto fill, step repeat, note repeat,
//   pattern / song play, recording from the pads and MIDI (the hits are reported to the main thread,
//   which owns the patterns). Tempo: RATE, or SYNC (MIDI clock, else the rack's tempo).

(function(){

const NATIVE = 28000;               // the samples' rate
const CHANNELS = 16;
const SLOTS = 24;
const IN_IDS = ["in"];
const OUT_IDS = ["out_l", "out_r"];
for (let c = 0; c < CHANNELS; c++) OUT_IDS.push("ch" + (c + 1));
// pad sound -> mixer channel
const SLOT_CH = [0, 0, 1, 1, 1, 2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 9, 9, 10, 10, 11, 12, 13, 14, 15];
// TUNE knobs: which channel each detunes
const TUNE_KNOB_CH = { tune_snare: 1, tune_tom_hi: 4, tune_tom_mid: 5, tune_tom_lo: 6, tune_conga_hi: 11, tune_conga_lo: 12 };
// MIDI note -> pad sound (General MIDI drums where they exist)
const MIDI_MAP = { 36: 0, 35: 1, 38: 2, 40: 3, 41: 4, 37: 5, 42: 6, 44: 7, 46: 8, 50: 9, 48: 9, 47: 10, 45: 11, 43: 11,
	51: 12, 59: 13, 53: 13, 49: 14, 57: 14, 69: 15, 70: 16, 54: 17, 58: 18, 63: 19, 62: 19, 64: 20, 56: 21, 39: 22, 33: 23 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

// ---------------------------------------------------------------------------
// the sample library, synthesized once

let seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; }

function render(secs, fn) {
	const n = Math.round(secs * NATIVE), out = new Float32Array(n);
	const st = {};
	for (let i = 0; i < n; i++) out[i] = fn(i / NATIVE, st, i);
	// fade the last 3 ms, normalize to 0.95
	let peak = 0;
	for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
	const g = peak > 0 ? 0.95 / peak : 1, f = Math.round(0.003 * NATIVE);
	for (let i = 0; i < n; i++) out[i] *= g * Math.min(1, (n - i) / f);
	return out;
}

// simple filters for the synthesis
function hp1(st, k, x, a) { const y = a * ((st[k] || 0) + x - (st[k + "x"] || 0)); st[k] = y; st[k + "x"] = x; return y; }
function bp(st, k, x, f, q) { // state variable band pass
	const F = Math.min(1, 2 * Math.sin(Math.PI * Math.min(f, NATIVE / 4) / NATIVE)); // stable
	let l = st[k + "l"] || 0, b = st[k + "b"] || 0;
	const h = x - l - q * b; b += F * h; l += F * b;
	st[k + "l"] = l; st[k + "b"] = b; st[k + "h"] = h;
	return b;
}
function phase(st, k, f) { st[k] = ((st[k] || 0) + f / NATIVE) % 1; return st[k]; }
function sine(st, k, f) { return Math.sin(2 * Math.PI * phase(st, k, f)); }
function sq(st, k, f) { return phase(st, k, f) < 0.5 ? 1 : -1; }
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(st, k, mul) { let s = 0; for (let i = 0; i < 6; i++) s += sq(st, k + i, METAL[i] * mul); return s / 6; }

const LIBRARY = [
	["BASS 1", 0.45, (t, st) => sine(st, "p", 48 + 72 * Math.exp(-t * 32)) * Math.exp(-t * 8) + (t < 0.004 ? rnd() * 0.6 : 0)],
	["BASS 2", 0.35, (t, st) => fastTanh(2.2 * sine(st, "p", 55 + 110 * Math.exp(-t * 48)) * Math.exp(-t * 11)) + (t < 0.003 ? rnd() * 0.8 : 0)],
	["SNARE 1", 0.35, (t, st) => (sine(st, "a", 185) * 0.5 + sine(st, "b", 330) * 0.3) * Math.exp(-t * 20) + hp1(st, "h", rnd(), 0.7) * Math.exp(-t * 14) * 0.9],
	["SNARE 2", 0.5, (t, st) => sine(st, "a", 200) * 0.5 * Math.exp(-t * 18) + bp(st, "n", rnd(), 3500, 0.9) * Math.exp(-t * 8) * 1.4],
	["SNARE 3", 0.25, (t, st) => sine(st, "a", 240) * 0.6 * Math.exp(-t * 30) + hp1(st, "h", rnd(), 0.5) * Math.exp(-t * 22)],
	["SIDESTICK", 0.12, (t, st) => (sine(st, "a", 1700) * 0.6 + sine(st, "b", 480) * 0.7) * Math.exp(-t * 60) + (t < 0.002 ? rnd() : 0)],
	["HI HAT 1", 0.15, (t, st) => hp1(st, "h", bp(st, "m", metal(st, "o", 1) + rnd() * 0.3, 9000, 0.6), 0.6) * Math.exp(-t * 45)],
	["HI HAT 2", 0.2, (t, st) => hp1(st, "h", bp(st, "m", metal(st, "o", 1.04) + rnd() * 0.6, 8000, 0.7), 0.6) * Math.exp(-t * 30)],
	["HH OPEN", 0.8, (t, st) => hp1(st, "h", bp(st, "m", metal(st, "o", 1) + rnd() * 0.35, 8500, 0.6), 0.6) * Math.exp(-t * 5.5)],
	["TOM HI", 0.55, (t, st) => sine(st, "p", 210 * (1 + 0.6 * Math.exp(-t * 12))) * Math.exp(-t * 7) + (t < 0.005 ? rnd() * 0.3 : 0)],
	["TOM MID", 0.6, (t, st) => sine(st, "p", 150 * (1 + 0.6 * Math.exp(-t * 11))) * Math.exp(-t * 6) + (t < 0.005 ? rnd() * 0.3 : 0)],
	["TOM LO", 0.7, (t, st) => sine(st, "p", 105 * (1 + 0.6 * Math.exp(-t * 10))) * Math.exp(-t * 5) + (t < 0.005 ? rnd() * 0.3 : 0)],
	["RIDE 1", 1.6, (t, st) => hp1(st, "h", metal(st, "o", 2.3) * 0.7 + bp(st, "n", rnd(), 7000, 0.8) * 0.5, 0.7) * Math.exp(-t * 2.2)],
	["RIDE 2", 1.4, (t, st) => hp1(st, "h", metal(st, "o", 1.7) * 0.6 + (sine(st, "b1", 2350) + sine(st, "b2", 3520)) * 0.25 * Math.exp(-t * 3) + rnd() * 0.15, 0.7) * Math.exp(-t * 2.8)],
	["CRASH", 1.6, (t, st) => hp1(st, "h", rnd() * 0.8 + metal(st, "o", 3.1) * 0.5, 0.4) * Math.min(1, t / 0.005) * Math.exp(-t * 2.4)],
	["CABASA 1", 0.12, (t, st) => hp1(st, "h", rnd(), 0.25) * Math.min(1, t / 0.01) * Math.exp(-t * 35)],
	["CABASA 2", 0.18, (t, st) => hp1(st, "h", rnd(), 0.3) * Math.min(1, t / 0.025) * Math.exp(-t * 20)],
	["TAMB 1", 0.3, (t, st) => hp1(st, "h", rnd() * (0.5 + 0.5 * (sine(st, "a", 5100) + sine(st, "b", 7300) + sine(st, "c", 9800)) / 3), 0.2) * Math.exp(-t * 14)],
	["TAMB 2", 0.35, (t, st) => hp1(st, "h", rnd() * (0.6 + 0.4 * sine(st, "a", 6200)), 0.2) * (Math.exp(-t * 18) + (t > 0.045 ? 0.8 * Math.exp(-(t - 0.045) * 16) : 0))],
	["CONGA HI", 0.3, (t, st) => sine(st, "p", 370 * (1 + 0.15 * Math.exp(-t * 40))) * Math.exp(-t * 14) + (t < 0.003 ? rnd() * 0.4 : 0)],
	["CONGA LO", 0.4, (t, st) => sine(st, "p", 245 * (1 + 0.15 * Math.exp(-t * 35))) * Math.exp(-t * 10) + (t < 0.003 ? rnd() * 0.4 : 0)],
	["COWBELL", 0.35, (t, st) => bp(st, "f", sq(st, "a", 545) + sq(st, "b", 815), 800, 0.5) * (0.5 * Math.exp(-t * 30) + 0.5 * Math.exp(-t * 7))],
	["CLAPS", 0.35, (t, st) => {
		const n = bp(st, "f", rnd(), 1100, 0.6);
		let e = 0;
		for (const d of [0, 0.011, 0.022]) if (t >= d) e += Math.exp(-(t - d) * 300);
		if (t > 0.03) e += 0.7 * Math.exp(-(t - 0.03) * 18);
		return n * e;
	}],
	["CLICK", 0.03, (t, st) => sine(st, "a", 1500) * Math.exp(-t * 200)],
	// more for SAMP
	["BOOM", 1.2, (t, st) => sine(st, "p", 45 + 30 * Math.exp(-t * 20)) * Math.exp(-t * 2.5)],
	["RIMSHOT", 0.1, (t, st) => (sine(st, "a", 1800) * 0.5 + sine(st, "b", 470) * 0.6 + bp(st, "n", rnd(), 4000, 0.5)) * Math.exp(-t * 70)],
	["CLAVE", 0.12, (t, st) => sine(st, "a", 2500) * Math.exp(-t * 45)],
	["SHAKER", 0.15, (t, st) => hp1(st, "h", rnd(), 0.2) * Math.sin(Math.PI * Math.min(1, t / 0.15))],
	["WOOD BLOCK", 0.12, (t, st) => (sine(st, "a", 1050) + 0.3 * sine(st, "b", 2900)) * Math.exp(-t * 50)],
	["AGOGO", 0.4, (t, st) => (sine(st, "a", 880) + 0.5 * sine(st, "b", 2420)) * Math.exp(-t * 9)],
	["LASER", 0.3, (t, st) => sq(st, "a", 3000 * Math.exp(-t * 14)) * Math.exp(-t * 8)],
	["NOISE HIT", 0.4, (t, st) => rnd() * Math.exp(-t * 9)]
];

// 8-bit companded (mu-law-like) and 12-bit linear versions of each sample
function mulaw8(x) {
	const s = x < 0 ? -1 : 1, m = Math.log(1 + 255 * Math.min(1, Math.abs(x))) / Math.log(256);
	const q = Math.round(m * 127) / 127;
	return s * (Math.pow(256, q) - 1) / 255;
}
let SAMPLES = null;
function buildLibrary() {
	if (SAMPLES) return SAMPLES;
	SAMPLES = LIBRARY.map(([name, secs, fn]) => {
		seed = 12345 + name.length * 977;
		const raw = render(secs, fn);
		const q8 = new Float32Array(raw.length), q12 = new Float32Array(raw.length);
		for (let i = 0; i < raw.length; i++) { q8[i] = mulaw8(raw[i]); q12[i] = Math.round(raw[i] * 2048) / 2048; }
		return { name: name, q8: q8, q12: q12 };
	});
	return SAMPLES;
}

// ---------------------------------------------------------------------------

class LlmDramDSP {
	constructor() {
		this.s = null;
		this.host = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.outPatched = new Uint8Array(OUT_IDS.length); // set by the host: the individual outs cabled
		this.midiConnected = false;
		this.lib = buildLibrary();
		this.voices = [];
		for (let c = 0; c < CHANNELS; c++) this.voices.push({ on: false, smp: null, pos: 0, inc: 1, end: 0, start: 0, gain: 0, rev: false, loop: false, t: 0, fade: 0 });
		this.trig = new Float64Array(SLOTS); // sampleCount of each pad sound's last hit (pad lights)
		this.sampleCount = 0;
		// sequencer
		this.playing = false;
		this.step = 0;                 // step being played (0..len-1)
		this.stepPhase = 0;            // 0..1 through the current step
		this.bar = 0;
		this.pat = 0;                  // pattern playing
		this.queued = -1;
		this.repeatFrom = -1;          // STEP REPEAT: the beat looped
		this.repeats = new Set();      // NOTE REPEAT: pad sounds held
		this.recorded = [];            // hits recorded since the last state report
		this.fill = null;
		this.midiTicks = 0; this.lastMidiClock = -1e12; this.midiTickTimes = [];
		// FX bus
		this.ef = 0; this.es = 0; this.es2 = 0;
		this.lad = [0, 0, 0, 0]; this.hp = [0, 0];
		this.inLevel = 0;
	}

	message(m) {
		switch (m.type) {
			case "hit": this.hit(m.slot, m.vel === undefined ? 1 : m.vel, m.record && !m.tune, m.tune || 0); break;
			case "play": m.value ? this.start() : this.stop(); break;
			case "repeat": if (m.on) this.repeats.add(m.slot); else this.repeats.delete(m.slot); break;
			case "note": { // MIDI
				const slot = MIDI_MAP[m.note];
				if (m.on && slot !== undefined) this.hit(slot, m.vel === undefined ? 1 : m.vel, true);
				break;
			}
			case "allNotesOff": this.repeats.clear(); break;
			case "midiClock":
				this.midiTickTimes.push(this.sampleCount); if (this.midiTickTimes.length > 25) this.midiTickTimes.shift();
				this.lastMidiClock = this.sampleCount;
				if (this.s.sync && this.playing && ++this.midiTicks >= 6) { this.midiTicks = 0; this.nextStep(); }
				break;
			case "midiStart": if (this.s.sync) { this.start(); this.midiTicks = 0; } break;
			case "midiStop": if (this.s.sync) this.stop(); break;
		}
	}

	setSettings(s) { this.s = s; if (!this.playing) this.pat = s.pattern; }
	setMidiConnected(c) { this.midiConnected = c; }

	start() {
		if (this.playing) return;
		this.playing = true; this.step = -1; this.stepPhase = 1; this.bar = 0; this.pat = this.s.pattern; this.queued = -1;
		this.firstStep = true;
	}
	stop() { this.playing = false; this.repeatFrom = -1; }

	// a pad sound: (re)starts its channel's voice
	hit(slot, vel, record, pitch) {
		const s = this.s, c = SLOT_CH[slot], ch = s.ch[c], v = this.voices[c];
		const smp = this.lib[clamp(s.assign[slot] | 0, 0, this.lib.length - 1)];
		const data = ch.bit >= 12 ? smp.q12 : smp.q8, n = data.length;
		let tune = ch.tune + (pitch || 0);
		for (const k in TUNE_KNOB_CH) if (TUNE_KNOB_CH[k] === c) tune += s[k];
		v.smp = data;
		v.start = Math.floor(clamp(ch.start, 0, 0.95) * n);
		v.end = Math.max(v.start + 16, Math.floor(v.start + clamp(ch.len, 0.02, 1) * (n - v.start)));
		v.rev = !!ch.rev; v.loop = !!ch.loop;
		v.pos = v.rev ? v.end - 1 : v.start;
		v.inc = NATIVE / sampleRate * Math.pow(2, tune / 12);
		v.gain = vel; v.t = 0; v.on = true;
		// HI HAT DECAY: a closing envelope on the hi hats
		v.decay = c === 3 ? Math.exp(-1 / ((0.02 + s.hh_decay * s.hh_decay * 1.2) * sampleRate)) : 1;
		v.env = 1;
		this.trig[slot] = this.sampleCount;
		if (record && s.rec && this.playing) {
			// the nearest step (QUAN), or the step it falls in
			let st = this.step, ph = this.stepPhase;
			if (s.quantize && ph > 0.5) st = (st + 1) % this.len();
			this.recorded.push([this.pat, Math.max(0, st), slot, Math.round(vel * 100) / 100]);
		}
	}

	len() { const p = this.s.patterns[this.pat]; return p ? clamp(p.len | 0, 1, 64) : 16; }

	nextStep() {
		const s = this.s;
		let len = this.len();
		if (this.firstStep) { this.firstStep = false; this.step = 0; }
		else if (s.step_repeat) {
			if (this.repeatFrom < 0) this.repeatFrom = Math.floor(this.step / 4) * 4;
			this.step = this.repeatFrom + ((this.step - this.repeatFrom + 1) % 4);
		}
		else {
			this.repeatFrom = -1;
			this.step++;
			if (this.step >= len) { // the bar ends: queued pattern, song, fill
				this.step = 0; this.bar++;
				if (s.mode === "song") {
					for (let k = 1; k <= 16; k++) {
						const p = (this.pat + k) % 16;
						if (s.patterns[p] && s.patterns[p].hits.length) { this.pat = p; break; }
					}
				}
				else this.pat = s.pattern;
				len = this.len();
			}
		}
		// AUTO FILL: the last beat of every 4th bar is a snare / tom fill
		const fillNow = s.auto_fill && this.bar % 4 === 3 && this.step >= len - 4;
		const p = s.patterns[this.pat];
		if (p && !fillNow)
			for (const h of p.hits) if (h[0] === this.step) this.hitSeq(h[1], h[2]);
		if (fillNow) {
			const k = this.step - (len - 4);
			if (k === 0) this.fill = [0, 1, 2, 3].map(() => [2, 9, 10, 11, 2][Math.floor(Math.random() * 5)]);
			this.hitSeq(this.fill ? this.fill[k] : 2, 0.9);
			if (k === 3) this.hitSeq(0, 1);
		}
		for (const slot of this.repeats) this.hitSeq(slot, 1);
		// CLICK while recording: the metronome on each beat
		if (s.rec && this.step % 4 === 0) this.hitSeq(23, this.step === 0 ? 1 : 0.6);
	}

	hitSeq(slot, vel) {
		const c = SLOT_CH[slot], s = this.s;
		const solo = s.ch.some(ch => ch.solo);
		if (s.ch[c].mute || (solo && !s.ch[c].solo)) return;
		this.hit(slot, vel, false);
	}

	beginBlock(n) {
		const s = this.s, sr = sampleRate;
		const midi = (this.sampleCount - this.lastMidiClock) < 0.5 * sr && this.midiTickTimes.length > 4;
		this.tempo = s.sync ? (midi ? (() => { const t = this.midiTickTimes; return 60 * sr / ((t[t.length - 1] - t[0]) / (t.length - 1) * 24); })() : (this.host && this.host.tempo > 0 ? this.host.tempo : s.tempo)) : s.tempo;
		this.midiDriven = s.sync && midi;
		this.stepLen = 60 / clamp(this.tempo, 30, 300) / 4 * sr;
		// mixer gains: fader (audio taper), LEV, pan (equal power)
		const solo = s.ch.some(ch => ch.solo);
		this.gl = this.gl || new Float64Array(CHANNELS); this.gr = this.gr || new Float64Array(CHANNELS);
		for (let c = 0; c < CHANNELS; c++) {
			const ch = s.ch[c];
			const g = (ch.mute || (solo && !ch.solo)) ? 0 : ch.level * ch.level * 1.4 * ch.lev;
			const a = (clamp(ch.pan, -1, 1) + 1) * Math.PI / 4;
			this.gl[c] = g * Math.cos(a); this.gr[c] = g * Math.sin(a);
		}
		this.fcut = 1 - Math.exp(-2 * Math.PI * Math.min(s.cutoff, sr * 0.3) / sr);
		this.fsvf = 2 * Math.sin(Math.PI * Math.min(s.cutoff, sr * 0.2) / (2 * sr));
		this.mvol = s.master * s.master * 1.6;
	}

	tick() {
		const s = this.s, outs = this.outs, sr = sampleRate;

		// ---- sequencer clock (swing: the even 1/16s come late) ----
		if (this.playing && !this.midiDriven) {
			const sw = (clamp(s.swing, 50, 75) - 50) / 50;
			const len = this.step % 2 === 0 ? this.stepLen * (1 + sw) : this.stepLen * (1 - sw);
			this.stepPhase += 1 / len;
			if (this.stepPhase >= 1) { this.stepPhase -= 1; if (this.stepPhase > 1) this.stepPhase = 0; this.nextStep(); }
		}
		else if (!this.playing && this.repeats.size) { // NOTE REPEAT without the sequencer: 1/16s at the tempo
			this.stepPhase += 1 / this.stepLen;
			if (this.stepPhase >= 1) { this.stepPhase -= 1; for (const slot of this.repeats) this.hit(slot, 1, false); }
		}

		// ---- voices ----
		let dl = 0, dr = 0, fx = 0, fxr = 0;
		const indiv = this.outPatched;
		for (let c = 0; c < CHANNELS; c++) {
			const v = this.voices[c];
			let x = 0;
			if (v.on) {
				const ch = s.ch[c];
				const i = v.pos | 0;      // no interpolation: the grain of the early samplers
				x = v.smp[i] * v.gain;
				if (ch.dist > 0.001) x = fastTanh(x * (1 + ch.dist * 8)) / (1 + ch.dist * 0.5);
				if (v.decay < 1) { v.env *= v.decay; x *= v.env; if (v.env < 1e-4) v.on = false; }
				// LEN short of the end: fade the last 4 ms
				const left = v.rev ? v.pos - v.start : v.end - v.pos;
				if (!v.loop && left < 0.004 * NATIVE) x *= left / (0.004 * NATIVE);
				v.pos += v.rev ? -v.inc : v.inc;
				if (v.rev ? v.pos < v.start : v.pos >= v.end) {
					if (v.loop) v.pos = v.rev ? v.end - 1 : v.start;
					else v.on = false;
				}
			}
			outs[2 + c] = x;
			if (indiv[2 + c]) continue; // patched to its own output: out of the mix
			const l = x * this.gl[c], r = x * this.gr[c];
			if (s.ch[c].send) { fx += l; fxr += r; } else { dl += l; dr += r; }
		}

		// ---- FX bus: WAVE DESIGNER, then the ANALOG FILTER ----
		if (s.send_bus !== false) {
			const a = Math.abs(fx) + Math.abs(fxr);
			this.ef += (a - this.ef) * (a > this.ef ? 0.3 : 0.0007);
			this.es += (a - this.es) * (a > this.es ? 0.001 : 0.0007);
			this.es2 += (a - this.es2) * (a > this.es2 ? 0.3 : 0.00005);
			let g = 1;
			if (Math.abs(s.wd_attack) > 0.01) g *= Math.pow((this.ef + 1e-4) / (this.es + 1e-4), s.wd_attack);
			if (Math.abs(s.wd_sustain) > 0.01) g *= Math.pow((this.es2 + 1e-4) / (this.ef + 1e-4), s.wd_sustain * 0.7);
			g = clamp(g, 0.1, 4);
			fx *= g; fxr *= g;
			if (s.filter_on) {
				const m = (fx + fxr) * 0.5, res = s.resonance * 3.9;
				let y;
				if (!s.hpf) { // 4-pole low pass (the 3320)
					const L = this.lad, k = this.fcut;
					const xin = fastTanh(m - res * L[3]);
					L[0] += k * (xin - L[0]); L[1] += k * (L[0] - L[1]); L[2] += k * (L[1] - L[2]); L[3] += k * (L[2] - L[3]);
					y = L[3] * (1 + res * 0.25);
				}
				else { // high pass
					const S = this.hp, f = this.fsvf, q = 2 - s.resonance * 1.9;
					const h = m - S[0] - q * S[1]; S[1] += f * h; S[0] += f * S[1]; S[1] = fastTanh(S[1]);
					y = h;
				}
				const side = (fx - fxr) * 0.5;
				fx = y + side * 0.3; fxr = y - side * 0.3;
			}
		}
		dl += fx; dr += fxr;

		// ---- INPUT (the rear IN) and MASTER (the 2164 VCA's soft edge) ----
		const inp = this.patched[0] ? this.ins[0] * s.input * 2 : 0;
		this.inLevel = Math.max(Math.abs(inp), this.inLevel * 0.9995);
		outs[0] = fastTanh((dl + inp) * this.mvol);
		outs[1] = fastTanh((dr + inp) * this.mvol);
		this.sampleCount++;
		return 0;
	}

	endBlock() {}

	state() {
		const now = this.sampleCount, lit = [];
		for (let k = 0; k < SLOTS; k++) lit.push(now - this.trig[k] < 0.12 * sampleRate ? 1 : 0);
		const rec = this.recorded;
		this.recorded = [];
		return { playing: this.playing, step: this.step, pat: this.pat, lit: lit, rec: rec, sig: this.inLevel > 0.02, tempo: this.tempo, bar: this.bar };
	}
}
LlmDramDSP.OUT_IDS = OUT_IDS;
LlmDramDSP.IN_IDS = IN_IDS;
LlmDramDSP.MIDI_IN = "midi_in";
LlmDramDSP.POLY = true;           // every MIDI note, not a mono voice
LlmDramDSP.LIBRARY_NAMES = LIBRARY.map(l => l[0]);

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.llmdram = LlmDramDSP;

})();
