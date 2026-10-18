// devices/pollyd-worklet.js
// PARA D DSP (a classic analog synthesizer with four oscillators): four VCOs (6 ranges, 6
// waves), played as one voice (MONO, UNISON: the four on the last note) or as four (POLY: an
// oscillator a note, through the same filter and contours: paraphonic, AUTO DAMP silencing the keys let
// go), the mixer (OSC 1-4, NOISE white / pink, EXT IN), the 24 dB ladder filter (low / high pass,
// keyboard control 0, 1/3, 2/3, full) with its contour, the loudness contour (DECAY switch: release =
// decay), the modulation mix (OSC 4 or filter contour, noise or LFO) by the mod wheel to the
// oscillators and / or the filter, glide, a distortion (classic pedal style), the bucket brigade stereo chorus (I, II,
// I+II), an arpeggiator and a 32-step sequencer with 8 patterns (chords, accent, glide, ratchets).
// It gets the raw notes of its MIDI channel (POLY).
(function(){

const IN_IDS = ["ext_in","sync_in","vtrig_in","loud_in","filter_in","osc_in","mod_in"];
const OUT_IDS = ["out_l","out_r","pitch_out","vtrig_out","vel_out","sync_out"];
const I = {}; IN_IDS.forEach((id, k) => I[id] = k);
const O = {}; OUT_IDS.forEach((id, k) => O[id] = k);

const C4 = 261.6255653005986;
const RANGE_OCT = [-7, -2, -1, 0, 1, 2];   // LO, 32', 16', 8', 4', 2' (8' plays C4 on C4)
const CTRL = 16;                           // control rate (samples)
const ARP_MODES = 8;                       // UP, DOWN, INC, EXC, RANDOM, ORDER, UP 2 OCT, DOWN 2 OCT
const MIDI_CLOCK_TIMEOUT = 0.5;
const CHORUS_LEN = 4096;

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
// one oscillator sample: phase t (0..1), increment dt, wave 0..5; osc 4 has a reverse saw for the tri-saw
function wave(w, t, dt, four) {
	switch (w) {
		case 0: return 1 - 4 * Math.abs(t - 0.5);                                 // triangle
		case 1: return four ? -(2 * t - 1 - polyblep(t, dt))                        // OSC 4: reverse saw
			: 0.5 * (1 - 4 * Math.abs(t - 0.5)) + 0.5 * (2 * t - 1 - polyblep(t, dt)); // tri-saw
		case 2: return 2 * t - 1 - polyblep(t, dt);                                 // saw
		default: {
			const pw = w == 3 ? 0.5 : (w == 4 ? 0.3 : 0.1);                         // square, wide, narrow pulse
			let t2 = t + 1 - pw; if (t2 >= 1) t2 -= 1;
			return (t < pw ? 1 : -1) + polyblep(t, dt) - polyblep(t2, dt);
		}
	}
}

function newVoice() { return { note: 60, gate: false, age: 0, pitch: 0, target: 0, amp: 0, ampT: 1, vel: 1, seq: false }; }

class ParaDSP {
	constructor() {
		this.s = null;
		this.host = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.sr = sampleRate;
		this.voices = [newVoice(), newVoice(), newVoice(), newVoice()];
		this.ph = new Float64Array(4);
		this.inc = new Float64Array(4);          // phase increments (control rate)
		this.stack = [];                         // MONO / UNISON: held notes, last on top
		this.held = [];                          // ARP: [note, vel, still pressed]
		this.clock = 0;
		this.lastVel = 1;
		this.bend = 0; this.wheelBend = 0;
		// contours
		this.feg = 0; this.leg = 0; this.fStage = 0; this.lStage = 0; // 0 off / release, 1 attack, 2 decay-sustain
		this.anyGate = false; this.extGate = false;
		// modulation
		this.lfoPh = 0; this.lfo = 0;
		this.pinkB = new Float64Array(3); this.noise = 0; this.white = 0;
		this.osc4Out = 0;
		// filter (2x oversampled ladder)
		this.lp = new Float64Array(4);
		// distortion
		this.dHp = 0; this.dHpX = 0; this.dLp = 0;
		// chorus
		this.cl = new Float32Array(CHORUS_LEN); this.cpos = 0; this.cph = 0; this.cLpL = 0; this.cLpR = 0;
		// control-rate values
		this.k = 0;
		this.cut = 1000; this.g = 0.1; this.fbk = 0; this.mod = 0; this.loud = 1;
		this.vol = 0.7;
		// sequencer / arpeggiator
		this.playing = false; this.step = -1; this.stepPhase = 0; this.seqNotes = []; this.gateLeft = 0;
		this.ratchetLeft = 0; this.ratchetEvery = 0; this.ratchetCount = 0;
		this.arpIndex = -1; this.arpDir = 1; this.arpNote = -1; this.arpPhase = 0; this.arpOff = 0;
		this.syncHigh = false; this.vtrigHigh = false; this.syncPulse = 0;
		this.midiTicks = 0; this.lastMidiClock = -1e12; this.sampleCount = 0;
		this.rec = [];                           // recorded steps for the panel: [pattern, step, notes, accent]
		this.recChord = []; this.recPos = -1; this.lastCursor = -1;
	}

	setSettings(s) { this.s = s; }
	setMidiConnected(c) {
		if (!c && this.midiConnected) this.message({ type: "allNotesOff" });
		this.midiConnected = c;
	}

	message(m) {
		switch (m.type) {
			case "note": m.on ? this.keyOn(m.note, m.vel === undefined ? 1 : m.vel) : this.keyOff(m.note); break;
			case "allNotesOff":
				this.held = []; this.stack = []; this.recChord = [];
				for (const v of this.voices) v.gate = false;
				this.seqNotes = [];
				break;
			case "bend": this.bend = m.value; break;           // octaves
			case "wheel": this.wheelBend = m.value; break;     // the panel's pitch wheel: octaves
			case "play": this.setPlay(m.value === undefined ? !this.playing : !!m.value); break;
			case "reset": this.step = -1; this.stepPhase = 1; break;
			case "trigger": if (m.gate) this.keyOn(60, 1); else this.keyOff(60); break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.midiTicks = 0; this.step = -1; this.lastMidiClock = this.sampleCount; this.setPlay(true); break;
			case "midiContinue": this.setPlay(true); break;
			case "midiStop": this.setPlay(false); break;
		}
	}

	setPlay(on) {
		if (on && !this.playing) { this.step = -1; this.stepPhase = 1; this.midiTicks = 0; }
		if (!on) this.seqRelease();
		this.playing = on;
	}

	// ---- keys: to the arpeggiator, the recorder or the voices ----
	keyOn(note, vel) {
		const s = this.s, q = s.seq;
		this.lastVel = vel;
		if (q.rec) this.record(note);
		if (q.arp) {
			if (q.latch && this.held.length && !this.held.some(h => h[2])) this.held = []; // a new chord replaces a latched one
			this.held = this.held.filter(h => h[0] !== note);
			this.held.push([note, vel, true]);
			return;
		}
		this.voiceOn(note, vel, false);
	}

	keyOff(note) {
		const q = this.s.seq;
		if (q.rec && !this.playing) this.recordRelease(note);
		if (q.arp) {
			if (q.latch) { const h = this.held.find(h => h[0] === note); if (h) h[2] = false; }
			else this.held = this.held.filter(h => h[0] !== note);
			return;
		}
		this.voiceOff(note, false);
	}

	// ---- the recorder: stopped, a chord (the keys held together) a step; playing, onto the nearest step ----
	record(note) {
		const q = this.s.seq, pat = q.patterns[q.pattern];
		if (this.playing) {
			const st = this.step < 0 ? 0 : (this.stepPhase > 0.5 ? (this.step + 1) % pat.len : this.step);
			this.rec.push([q.pattern, st, [note], false, true]);
			return;
		}
		if (this.recChord.indexOf(note) < 0 && this.recChord.length < 4) this.recChord.push(note);
		this.recDown = (this.recDown || 0) + 1;
	}
	recordRelease() {
		this.recDown = Math.max(0, (this.recDown || 0) - 1);
		if (this.recDown || !this.recChord.length) return;
		const q = this.s.seq;
		this.rec.push([q.pattern, q.cursor, this.recChord.slice(), false, false]);
		this.recChord = [];
	}

	// ---- voices: one (MONO / UNISON) or four (POLY: an oscillator each) ----
	polyVoices() { return this.s.osc4_ctrl ? 4 : 3; }

	voiceOn(note, vel, seq) {
		const s = this.s;
		const wasGate = this.anyGate;
		if (s.mode !== "poly") {
			this.stack = this.stack.filter(n => n !== note);
			this.stack.push(note);
			for (const v of this.voices) { v.note = note; v.gate = true; v.vel = vel; v.seq = seq; v.amp = Math.max(v.amp, 0.001); }
		}
		else {
			const n = this.polyVoices();
			let v = null;
			for (let i = 0; i < n; i++) if (this.voices[i].gate && this.voices[i].note === note) v = this.voices[i];
			if (!v) for (let i = 0; i < n; i++) { const w = this.voices[i]; if (!w.gate && (!v || w.age < v.age)) v = w; }
			if (!v) for (let i = 0; i < n; i++) { const w = this.voices[i]; if (!v || w.age < v.age) v = w; } // steal the oldest
			const glide = s.glide_on && s.glide > 0.001;
			v.note = note; v.gate = true; v.vel = vel; v.seq = seq; v.age = ++this.clock;
			if (!glide) v.pitch = v.target = this.notePitch(v, this.voices.indexOf(v));
		}
		this.lastNote = note;
		if (!wasGate) this.trigger();
	}

	voiceOff(note, seq) {
		const s = this.s;
		if (s.mode !== "poly") {
			this.stack = this.stack.filter(n => n !== note);
			if (this.stack.length) { const n = this.stack[this.stack.length - 1]; for (const v of this.voices) v.note = n; this.lastNote = n; }
			else for (const v of this.voices) v.gate = false;
			return;
		}
		for (const v of this.voices) if (v.gate && v.note === note && v.seq === seq) v.gate = false;
	}

	trigger() { this.fStage = 1; this.lStage = 1; }

	// a voice's pitch in octaves from C4, before its oscillator's range
	notePitch(v) { return (v.note - 60) / 12 + this.s.transpose; }

	seqRelease() {
		for (const n of this.seqNotes) this.voiceOff(n, true);
		this.seqNotes = [];
	}

	// ---- sequencer and arpeggiator: a step at each 16th (internal tempo, SYNC IN or MIDI clock) ----
	clockSource() {
		if (this.patched[I.sync_in]) return "jack";
		if (this.sampleCount - this.lastMidiClock < MIDI_CLOCK_TIMEOUT * this.sr) return "midi";
		return "int";
	}

	advance() {
		const s = this.s, q = s.seq;
		this.syncPulse = Math.round(0.005 * this.sr);
		if (q.arp) { this.arpStep(); return; }
		if (!this.playing) return;
		const pat = q.patterns[q.pattern];
		if (!q.hold) this.step = (this.step + 1) % pat.len;
		const st = pat.steps[this.step];
		const tied = st && st.glide && this.seqNotes.length;
		if (!tied) this.seqRelease();
		if (!st || !st.notes.length) return;
		const vel = st.accent ? 1 : 0.7;
		if (tied) {
			const old = this.seqNotes; this.seqNotes = [];
			for (const n of st.notes) { this.voiceOn(n, vel, true); this.seqNotes.push(n); }
			for (const n of old) if (st.notes.indexOf(n) < 0) this.voiceOff(n, true);
		}
		else for (const n of st.notes) { this.voiceOn(n, vel, true); this.seqNotes.push(n); }
		if (st.accent) this.trigger();
		const stepLen = this.stepSamples();
		this.gateLeft = Math.max(1, Math.round(stepLen * clamp(q.gate, 0.05, 1) / Math.max(1, st.ratchet || 1)));
		if (st.glide) this.gateLeft = Math.round(stepLen * 1.05);
		this.ratchetCount = (st.ratchet || 1) - 1;
		this.ratchetEvery = Math.round(stepLen / Math.max(1, st.ratchet || 1));
		this.ratchetLeft = this.ratchetEvery;
		this.ratchetNotes = st.notes.slice(); this.ratchetVel = vel;
	}

	arpNotes() {
		const q = this.s.seq, mode = q.arp_mode;
		let notes = this.held.map(h => h[0]);
		if (mode !== 5) notes.sort((a, b) => a - b);
		if (mode === 6 || mode === 7) notes = notes.concat(notes.map(n => n + 12));
		if (mode === 1 || mode === 7) notes.reverse();
		return notes;
	}

	arpStep() {
		const q = this.s.seq;
		if (this.arpNote >= 0) { this.voiceOff(this.arpNote, true); this.arpNote = -1; }
		if (!this.held.length) { this.arpIndex = -1; return; }
		const notes = this.arpNotes(), n = notes.length, mode = q.arp_mode;
		if (mode === 4) this.arpIndex = Math.floor(Math.random() * n);
		else if (mode === 2 || mode === 3) { // up / down, inclusive (ends twice) or exclusive
			if (n === 1) this.arpIndex = 0;
			else {
				let i = this.arpIndex + this.arpDir;
				if (i >= n) { this.arpDir = -1; i = mode === 2 ? n - 1 : n - 2; if (mode === 2 && this.arpIndex === n - 1) i = n - 2; }
				else if (i < 0) { this.arpDir = 1; i = mode === 2 ? 0 : 1; if (mode === 2 && this.arpIndex === 0) i = 1; }
				this.arpIndex = clamp(i, 0, n - 1);
			}
		}
		else this.arpIndex = (this.arpIndex + 1) % n;
		const note = notes[this.arpIndex];
		const h = this.held.find(x => x[0] === note || x[0] + 12 === note);
		this.voiceOn(note, h ? h[1] : 1, true);
		this.arpNote = note;
		this.gateLeft = Math.max(1, Math.round(this.stepSamples() * clamp(q.gate, 0.05, 1)));
	}

	tempo() {
		const s = this.s.seq;
		return s.sync && this.host && this.host.tempo > 0 ? this.host.tempo : s.tempo;
	}
	stepSamples() { return 60 * this.sr / (this.tempo() * 4); }

	// ---- control rate: the knobs into coefficients ----
	control() {
		const s = this.s, sr = this.sr, ins = this.ins, patched = this.patched;
		// modulation: the mix of (OSC 4 or filter contour) and (noise / MOD SOURCE or LFO), by the mod wheel
		const lfoInc = clamp(s.lfo_rate, 0.05, 200) * CTRL / sr;
		this.lfoPh += lfoInc; if (this.lfoPh >= 1) this.lfoPh -= Math.floor(this.lfoPh);
		this.lfo = s.lfo_wave === "square" ? (this.lfoPh < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(this.lfoPh - 0.5);
		const src1 = s.mod_src1 === "feg" ? this.feg : this.osc4Out;
		const src2 = s.mod_src2 === "lfo" ? this.lfo : (patched[I.mod_in] ? ins[I.mod_in] / 5 : this.noise * 3);
		this.mod = clamp(s.mod_wheel, 0, 1) * ((1 - s.mod_mix) * src1 + s.mod_mix * src2);
		// pitches, with glide
		const glide = s.glide_on && s.glide > 0.001 ? 1 - Math.exp(-CTRL / (s.glide * sr)) : 1;
		const common = s.tune / 12 + this.bend + this.wheelBend + (s.osc_mod ? this.mod * 0.5 : 0) + (patched[I.osc_in] ? ins[I.osc_in] : 0);
		const poly = s.mode === "poly";
		for (let i = 0; i < 4; i++) {
			const v = this.voices[i], o = s.osc[i];
			v.target = this.notePitch(v);
			v.pitch += (v.target - v.pitch) * glide;
			const keyed = i < 3 || s.osc4_ctrl;
			let p = (keyed ? v.pitch + common : s.tune / 12) + RANGE_OCT[o.range] + (i ? o.fine / 12 : 0);
			if (s.mode === "unison") p += [0, 0.06, -0.06, 0.11][i] / 12;
			this.inc[i] = clamp(C4 * Math.pow(2, p) / sr, 0, 0.45);
			// AUTO DAMP (POLY): a key let go silences its oscillator; otherwise it rings on with the contour.
			// OSC 4 off the keyboard is a drone (or the modulation oscillator)
			v.ampT = !poly || !keyed || v.gate || !s.auto_damp ? 1 : 0;
		}
		// filter: cutoff, keyboard control (from the last note), contour, modulation, CV
		const kb = [0, 1 / 3, 2 / 3, 1][s.kbd] * ((this.lastNote === undefined ? 60 : this.lastNote) - 60) / 12;
		let oct = Math.log2(clamp(s.cutoff, 20, 20000) / 20) + kb + this.feg * s.contour * 6 + (s.filter_mod ? this.mod * 3 : 0);
		if (patched[I.filter_in]) oct += ins[I.filter_in];
		this.cut = clamp(20 * Math.pow(2, oct), 10, sr * 0.45);
		this.g = 1 - Math.exp(-2 * Math.PI * this.cut / (2 * sr));
		this.fbk = clamp(s.emphasis, 0, 1) * 4.3;
		this.loud = patched[I.loud_in] ? clamp(ins[I.loud_in] / 5, 0, 1.5) : 1;
		this.vol = s.volume * s.volume;
		let lv = this.voices[0];
		for (const v of this.voices) if (v.age > lv.age) lv = v;
		this.pitchOut = s.mode === "poly" ? lv.pitch : this.voices[0].pitch;
		// distortion coefficients
		const d = s.dist;
		this.dGain = 1 + d.amount * d.amount * 80;
		this.dTone = 1 - Math.exp(-2 * Math.PI * (400 + d.tone * d.tone * 7000) / sr);
	}

	// ---- the contours: ADS, release = DECAY when the DECAY switch is on (else 10 ms) ----
	contour(val, stage, a, d, sus, gate) {
		if (stage === 1) {
			val += (1.25 - val) * (1 - Math.exp(-CTRL / (Math.max(0.001, a) * this.sr * 0.7)));
			if (val >= 1) { val = 1; stage = 2; }
		}
		else if (stage === 2) val += (sus - val) * (1 - Math.exp(-CTRL / (Math.max(0.004, d) * this.sr / 4.6)));
		else {
			const r = this.s.decay_sw ? Math.max(0.004, d) : 0.01;
			val += (0 - val) * (1 - Math.exp(-CTRL / (r * this.sr / 4.6)));
		}
		if (!gate && stage) stage = 0;
		return [val, stage];
	}

	beginBlock() {}

	tick() {
		const s = this.s, ins = this.ins, patched = this.patched, outs = this.outs, sr = this.sr, q = s.seq;
		// ---- clocks and gates ----
		const src = this.clockSource();
		let adv = false;
		if (src === "jack") {
			const hi = ins[I.sync_in] > 1;
			if (hi && !this.syncHigh) adv = true;
			this.syncHigh = hi;
		}
		else if (src === "midi") {
			while (this.midiTicks >= 6) { this.midiTicks -= 6; adv = true; }
		}
		else if (this.playing || q.arp) {
			const sw = clamp(q.swing, 0, 0.75) * 0.5; // the even 16ths later
			const len = this.stepSamples() * ((this.step & 1) ? 1 - sw : 1 + sw);
			this.stepPhase += 1 / len;
			if (this.stepPhase >= 1) { this.stepPhase -= Math.floor(this.stepPhase); adv = true; }
		}
		if (adv && (this.playing || q.arp)) this.advance();
		if (this.gateLeft > 0 && --this.gateLeft === 0) {
			if (q.arp) { if (this.arpNote >= 0) { this.voiceOff(this.arpNote, true); this.arpNote = -1; } }
			else if (this.playing) { const st = q.patterns[q.pattern].steps[this.step]; if (!st || !st.glide) this.seqRelease(); }
		}
		if (this.ratchetCount > 0 && --this.ratchetLeft <= 0) { // the step again
			this.ratchetCount--; this.ratchetLeft = this.ratchetEvery;
			this.seqRelease();
			for (const n of this.ratchetNotes) { this.voiceOn(n, this.ratchetVel, true); this.seqNotes.push(n); }
			this.trigger();
			this.gateLeft = Math.max(1, Math.round(this.ratchetEvery * clamp(q.gate, 0.05, 1)));
		}
		if (!q.arp && this.arpNote >= 0) { this.voiceOff(this.arpNote, true); this.arpNote = -1; }
		if (!q.arp && this.held.length) this.held = [];
		// EXT V-TRIG: the contours from a gate
		const vt = patched[I.vtrig_in] && ins[I.vtrig_in] > 1;
		if (vt && !this.vtrigHigh) this.trigger();
		this.vtrigHigh = vt;
		this.anyGate = this.voices.some(v => v.gate) || vt;

		// ---- control rate ----
		if (this.k-- <= 0) {
			this.k = CTRL - 1;
			let r = this.contour(this.feg, this.fStage, s.f_attack, s.f_decay, s.f_sustain, this.anyGate);
			this.feg = r[0]; this.fStage = r[1];
			r = this.contour(this.leg, this.lStage, s.l_attack, s.l_decay, s.l_sustain, this.anyGate);
			this.leg = r[0]; this.lStage = r[1];
			this.control();
		}

		// ---- noise: white, and pink (three poles) ----
		const w = Math.random() * 2 - 1;
		const pb = this.pinkB;
		pb[0] = 0.99765 * pb[0] + w * 0.0990460; pb[1] = 0.96300 * pb[1] + w * 0.2965164; pb[2] = 0.57000 * pb[2] + w * 1.0526913;
		const pink = (pb[0] + pb[1] + pb[2] + w * 0.1848) * 0.2;
		this.noise = s.noise.pink ? pink : w * 0.6;

		// ---- oscillators into the mixer ----
		let mix = 0, left = 0, right = 0;
		const uni = s.mode === "unison";
		for (let i = 0; i < 4; i++) {
			const v = this.voices[i], o = s.osc[i], inc = this.inc[i];
			let t = this.ph[i] + inc; if (t >= 1) t -= 1; this.ph[i] = t;
			const x = wave(o.wave, t, inc, i === 3);
			if (i === 3) this.osc4Out = x;
			v.amp += (v.ampT - v.amp) * 0.004;
			if (!o.on) continue;
			const y = x * o.vol * o.vol * v.amp;
			mix += y;
			if (uni) { if (i & 1) right += y; else left += y; }
		}
		if (s.noise.on) mix += this.noise * s.noise.vol * s.noise.vol;
		let ext = 0;
		if (s.ext.on && patched[I.ext_in]) { ext = ins[I.ext_in] * s.ext.vol * s.ext.vol * 2; mix += ext; }
		this.overload = Math.abs(ext) > 1.2 ? 1 : this.overload * 0.9995;

		// ---- the ladder filter, LP or HP, 2x ----
		const lp = this.lp, g = this.g, fbk = this.fbk, input = mix * 0.45;
		let x = 0;
		for (let os = 0; os < 2; os++) {
			x = fastTanh(input - fbk * lp[3]);
			lp[0] += g * (x - lp[0]);
			lp[1] += g * (lp[0] - lp[1]);
			lp[2] += g * (lp[1] - lp[2]);
			lp[3] += g * (lp[2] - lp[3]);
		}
		let y = (s.hp ? x - 4 * lp[0] + 6 * lp[1] - 4 * lp[2] + lp[3] : lp[3]) * (1 + fbk * 0.35);

		// ---- loudness ----
		y *= this.leg * this.loud;

		// ---- distortion (classic pedal style): high pass, gain, asymmetric clipping, tone, level ----
		const d = s.dist;
		if (d.on) {
			this.dHp += (y - this.dHp) * 0.02;
			let z = (y - this.dHp) * this.dGain;
			z = z > 0 ? fastTanh(z) : fastTanh(z * 1.3) / 1.15;
			this.dLp += (z - this.dLp) * this.dTone;
			y = (this.dLp * (1 - d.tone * 0.4) + (z - this.dLp) * d.tone * 0.5) * d.level * 0.8;
		}

		// ---- bucket brigade chorus (I: slow, II: deeper, I+II: fast and shallow), stereo ----
		let l = y, r = y;
		if (uni) { const sp = 0.35; l = y + (left - right) * sp * this.leg * 0.2; r = y - (left - right) * sp * this.leg * 0.2; }
		const c = s.chorus;
		if (c.on && (c.i || c.ii)) {
			const rate = c.i && c.ii ? 8 : (c.ii ? 0.83 : 0.5), depth = c.i && c.ii ? 0.0006 : (c.ii ? 0.0035 : 0.0022);
			this.cph += rate / sr; if (this.cph >= 1) this.cph -= 1;
			const tri = 1 - 4 * Math.abs(this.cph - 0.5);
			const cl = this.cl, n = CHORUS_LEN;
			cl[this.cpos] = y;
			const read = (sec) => {
				let p = this.cpos - sec * sr; if (p < 0) p += n;
				const i0 = p | 0, f = p - i0, i1 = i0 + 1 >= n ? 0 : i0 + 1;
				return cl[i0 >= n ? 0 : i0] * (1 - f) + cl[i1] * f;
			};
			const wl = read(0.0055 + depth * tri), wr = read(0.0055 - depth * tri);
			this.cpos = (this.cpos + 1) % n;
			this.cLpL += (wl - this.cLpL) * 0.35; this.cLpR += (wr - this.cLpR) * 0.35; // the bucket brigade's dark repeats
			l = l * 0.7 + this.cLpL * 0.7; r = r * 0.7 + this.cLpR * 0.7;
		}

		// ---- outputs ----
		outs[O.out_l] = fastTanh(l * this.vol * 1.6);
		outs[O.out_r] = fastTanh(r * this.vol * 1.6);
		outs[O.pitch_out] = this.pitchOut || 0;
		outs[O.vtrig_out] = this.anyGate ? 5 : 0;
		outs[O.vel_out] = this.lastVel * 5 * clamp(s.vel_adj, 0, 1);
		outs[O.sync_out] = this.syncPulse > 0 ? 5 : 0;
		if (this.syncPulse > 0) this.syncPulse--;
		return outs[O.out_l];
	}

	endBlock(n) { this.sampleCount += n; }

	state() {
		const rec = this.rec; this.rec = [];
		return {
			playing: this.playing, step: this.step, gates: this.voices.map(v => v.gate ? v.note : -1),
			lfo: this.lfo, feg: this.feg, leg: this.leg, overload: this.overload > 0.5,
			arp: this.s.seq.arp ? this.held.map(h => h[0]) : [], clock: this.clockSource(), rec: rec
		};
	}
}
ParaDSP.OUT_IDS = OUT_IDS;
ParaDSP.IN_IDS = IN_IDS;
ParaDSP.MIDI_IN = "midi_in";
ParaDSP.POLY = true; // gets the raw MIDI notes and plays them on its own oscillators

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.pollyd = ParaDSP;

})();
