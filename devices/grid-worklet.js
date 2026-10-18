// devices/grid-worklet.js
// GRID 32 DSP: a 32 x 32 note matrix sequencer. Each column is a step, each row a note of the scale
// (from ROOT and OCTAVE up). On every step the lit cells play: KEY / GATE get the lowest note, KEY 2 /
// GATE 2 the highest; with TIE a cell lit in the next step too holds the gate (no new trigger). TRIG
// pulses on every new note, CLOCK OUT on every step, EOC at the start of each cycle. CHANCE drops notes
// at random, SWING delays the even steps, DIRECTION plays forward, backward, ping-pong or at random.
// The clock: CLOCK IN (a step a pulse), MIDI clock (from its MIDI IN), the rack's tempo (SYNC) or its
// own TEMPO. With MIDI on, the notes also go into the rack's MIDI on CH, as the keys device's would.
(function(){

const IN_IDS = ["clock_in","reset_in","transpose_in","run_in"];
const OUT_IDS = ["key","gate","key2","gate2","trig","clock_out","eoc"];
const I = {}; IN_IDS.forEach((id, k) => I[id] = k);
const O = {}; OUT_IDS.forEach((id, k) => O[id] = k);

const SCALES = [
	[0,1,2,3,4,5,6,7,8,9,10,11], [0,2,4,5,7,9,11], [0,2,3,5,7,8,10], [0,2,3,5,7,9,10], [0,1,3,5,7,8,10], [0,2,4,6,7,9,11],
	[0,2,4,5,7,9,10], [0,2,4,7,9], [0,3,5,7,10], [0,3,5,6,7,10], [0,2,3,5,7,8,11], [0,2,4,6,8,10]
];
const DIVS = [1, 0.5, 0.25, 0.125, 1 / 3, 1 / 6];  // beats a step: 1/4, 1/8, 1/16, 1/32, 1/8T, 1/16T
const PULSE = 0.005;
const MIDI_CLOCK_TIMEOUT = 0.5;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

class GridDSP {
	constructor() {
		this.s = null;
		this.host = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.sr = sampleRate;
		this.playing = false;
		this.step = -1; this.pos = -1; this.dir = 1; this.count = 0;
		this.phase = 0;
		this.gateLeft = [0, 0];
		this.gate = [false, false];
		this.gapLeft = [0, 0];
		this.key = [0, 0];
		this.trigLeft = 0; this.clockLeft = 0; this.eocLeft = 0;
		this.clockHigh = false; this.resetHigh = false; this.runHigh = false;
		this.midiTicks = 0; this.lastMidiClock = -1e12; this.sampleCount = 0;
		this.kbd = 0;               // the keys' transposition (octaves), with KBD
		this.sounding = [];         // MIDI notes on
		this.held = [];             // MIDI notes to hold into the next step
		this.sending = false;
		this.lit = 0;               // the cells playing (bit mask of rows)
	}

	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	message(m) {
		switch (m.type) {
			case "play": this.setPlay(m.value === undefined ? !this.playing : !!m.value); break;
			case "reset": this.reset(); break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.reset(); this.midiTicks = 0; this.lastMidiClock = this.sampleCount; this.setPlay(true); break;
			case "midiContinue": this.setPlay(true); break;
			case "midiStop": this.setPlay(false); break;
			case "midi": // the keys transpose the pattern (KBD), C4 = none
				if (!this.sending && m.gate && m.pitch !== undefined) this.kbd = m.pitch;
				break;
		}
	}

	setPlay(on) {
		if (on && !this.playing) { this.reset(); this.phase = 1; }
		if (!on) { this.gate[0] = this.gate[1] = false; this.notesOff([]); }
		this.playing = on;
	}
	reset() { this.pos = -1; this.dir = 1; this.count = 0; this.phase = 1; }

	// the rows lit in a column of the pattern
	column(c) {
		const pat = this.s.patterns[this.s.pat];
		return pat ? (pat.cols[c] >>> 0) : 0;
	}

	noteOf(row) {
		const s = this.s, sc = SCALES[s.scale] || SCALES[0], n = sc.length;
		return 12 * (s.octave + 5) + s.root + 12 * Math.floor(row / n) + sc[row % n];
	}

	// the step after pos, in DIRECTION
	next(pos) {
		const len = clamp(this.s.len, 1, 32);
		switch (this.s.dir) {
			case "rev": return pos <= 0 ? len - 1 : Math.min(pos, len) - 1;
			case "ping": {
				if (len === 1) return 0;
				let p = pos + this.dir;
				if (pos < 0) { this.dir = 1; p = 0; }
				if (p >= len) { this.dir = -1; p = len - 2; }
				if (p < 0) { this.dir = 1; p = 1; }
				return p;
			}
			case "rnd": return Math.floor(Math.random() * len);
			default: return pos + 1 >= len ? 0 : pos + 1;
		}
	}

	advance() {
		const s = this.s;
		const prev = this.pos >= 0 ? this.column(this.pos) & this.lit : 0;
		this.pos = this.next(this.pos);
		if (this.count === 0 || (this.pos === 0 && s.dir !== "rnd")) this.eocLeft = Math.round(PULSE * this.sr);
		this.count++;
		this.clockLeft = Math.round(PULSE * this.sr);
		// the cells of the step, CHANCE dropping some (a tied note stays)
		let col = this.column(this.pos), lit = 0;
		for (let r = 0; r < 32; r++)
			if ((col >>> r) & 1) {
				const tied = s.tie && ((prev >>> r) & 1);
				if (tied || Math.random() < s.chance) lit |= (1 << r);
			}
		lit >>>= 0;
		this.lit = lit;
		const stepLen = this.stepSamples();
		const nextCol = this.column(this.peekNext());
		let lo = -1, hi = -1;
		for (let r = 0; r < 32; r++) if ((lit >>> r) & 1) { if (lo < 0) lo = r; hi = r; }
		const rows = [lo, hi];
		let anyNew = false;
		for (let v = 0; v < 2; v++) {
			const r = rows[v];
			if (r < 0) { this.gate[v] = false; this.gateLeft[v] = 0; continue; }
			const tiedIn = s.tie && this.gate[v] && ((prev >>> r) & 1) && this.key[v] === this.noteOf(r);
			const tiedOut = s.tie && ((nextCol >>> r) & 1);
			if (!tiedIn) { anyNew = true; if (this.gate[v]) this.gapLeft[v] = Math.round(0.002 * this.sr); } // a gap: the envelopes start again
			this.key[v] = this.noteOf(r);
			this.gate[v] = true;
			this.gateLeft[v] = tiedOut ? Math.round(stepLen * 1.5) : Math.max(1, Math.round(stepLen * clamp(s.gate, 0.02, 1)));
		}
		if (anyNew) this.trigLeft = Math.round(PULSE * this.sr);
		// MIDI: the step's notes on (the tied ones carry on), the others off
		if (s.midi) {
			const notes = [];
			for (let r = 0; r < 32; r++) if ((lit >>> r) & 1) notes.push(this.noteOf(r) + Math.round(this.kbdShift() * 12));
			this.notesOff(notes.filter(n => this.held.indexOf(n) >= 0));
			for (const n of notes) if (this.sounding.indexOf(n) < 0) { this.midiNote(n, true); this.sounding.push(n); }
			this.held = [];
			for (let r = 0; r < 32; r++) if (s.tie && ((lit >>> r) & 1) && ((nextCol >>> r) & 1)) this.held.push(this.noteOf(r) + Math.round(this.kbdShift() * 12));
			this.midiGateLeft = Math.max(1, Math.round(stepLen * clamp(s.gate, 0.02, 1)));
		}
		else if (this.sounding.length) this.notesOff([]);
	}

	// the step after this one, without moving (ping-pong / random: a guess, only for TIE)
	peekNext() {
		const len = clamp(this.s.len, 1, 32), d = this.s.dir;
		if (d === "rev") return this.pos <= 0 ? len - 1 : this.pos - 1;
		if (d === "ping") { const p = this.pos + this.dir; return p >= len ? Math.max(0, len - 2) : (p < 0 ? Math.min(1, len - 1) : p); }
		if (d === "rnd") return -1;
		return this.pos + 1 >= len ? 0 : this.pos + 1;
	}

	kbdShift() { return this.s.kbd_tr ? this.kbd : 0; }

	midiNote(note, on) {
		if (!this.host || !this.host.noteEvent) return;
		this.sending = true;
		this.host.noteEvent({ channel: this.s.channel, note: clamp(note, 0, 127), on: on, vel: 0.8 });
		this.sending = false;
	}
	notesOff(keep) {
		const off = this.sounding.filter(n => keep.indexOf(n) < 0);
		for (const n of off) this.midiNote(n, false);
		this.sounding = this.sounding.filter(n => keep.indexOf(n) >= 0);
	}

	stepSamples() {
		const s = this.s, bpm = s.sync && this.host && this.host.tempo > 0 ? this.host.tempo : s.tempo;
		return 60 * this.sr / clamp(bpm, 20, 400) * DIVS[s.div];
	}

	beginBlock() {}

	tick() {
		const s = this.s, ins = this.ins, patched = this.patched, outs = this.outs;
		// RUN: a gate plays while high; RESET: back to the start
		if (patched[I.run_in]) {
			const hi = ins[I.run_in] > 1;
			if (hi !== this.runHigh) this.setPlay(hi);
			this.runHigh = hi;
		}
		const rh = patched[I.reset_in] && ins[I.reset_in] > 1;
		if (rh && !this.resetHigh) this.reset();
		this.resetHigh = rh;
		// the clock
		let adv = false;
		if (patched[I.clock_in]) {
			const hi = ins[I.clock_in] > 1;
			if (hi && !this.clockHigh && this.playing) adv = true;
			this.clockHigh = hi;
		}
		else if (this.sampleCount - this.lastMidiClock < MIDI_CLOCK_TIMEOUT * this.sr) {
			const per = Math.max(1, Math.round(24 * DIVS[s.div]));
			if (this.midiTicks >= per) { this.midiTicks -= per; if (this.playing) adv = true; }
		}
		else if (this.playing) {
			const sw = clamp(s.swing, 0, 0.75) * 0.5;
			const len = this.stepSamples() * ((this.count & 1) ? 1 + sw : 1 - sw);
			this.phase += 1 / len;
			if (this.phase >= 1) { this.phase -= Math.floor(this.phase); adv = true; }
		}
		if (adv) this.advance();
		// gates, pulses
		for (let v = 0; v < 2; v++) if (this.gateLeft[v] > 0 && --this.gateLeft[v] === 0) this.gate[v] = false;
		if (this.midiGateLeft > 0 && --this.midiGateLeft === 0) this.notesOff(this.held);
		const tr = (patched[I.transpose_in] ? ins[I.transpose_in] : 0) + this.kbdShift();
		outs[O.key] = (this.key[0] - 60) / 12 + tr;
		outs[O.key2] = (this.key[1] - 60) / 12 + tr;
		outs[O.gate] = this.gate[0] && !this.gapLeft[0] ? 5 : 0;
		outs[O.gate2] = this.gate[1] && !this.gapLeft[1] ? 5 : 0;
		if (this.gapLeft[0] > 0) this.gapLeft[0]--;
		if (this.gapLeft[1] > 0) this.gapLeft[1]--;
		outs[O.trig] = this.trigLeft > 0 ? 5 : 0;
		outs[O.clock_out] = this.clockLeft > 0 ? 5 : 0;
		outs[O.eoc] = this.eocLeft > 0 ? 5 : 0;
		if (this.trigLeft > 0) this.trigLeft--;
		if (this.clockLeft > 0) this.clockLeft--;
		if (this.eocLeft > 0) this.eocLeft--;
		return 0;
	}

	endBlock(n) { this.sampleCount += n; }

	state() {
		return { playing: this.playing, pos: this.pos, lit: this.lit, gate: this.gate[0] || this.gate[1],
			clock: this.patched[I.clock_in] ? "jack" : (this.sampleCount - this.lastMidiClock < MIDI_CLOCK_TIMEOUT * this.sr ? "midi" : "int") };
	}
}
GridDSP.OUT_IDS = OUT_IDS;
GridDSP.IN_IDS = IN_IDS;
GridDSP.MIDI_IN = "midi_in";

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.grid = GridDSP;

})();
