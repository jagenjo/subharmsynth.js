// devices/b32-worklet.js
// Brother-32 DSP (a semi-modular synthesizer), hosted by the rack processor (rack-worklet.js): a VCO (saw / pulse with
// pulse width, linear FM, EG or LFO modulation of frequency or pulse width), a VCO / noise mixer,
// a ladder filter (LP / HP), an AD envelope with a sustain switch, a VCA (EG or always on), an LFO
// (triangle / square), glide, the VC mix crossfader, a mult, and the 32 step sequencer with a note,
// rest, accent and glide per step. MIDI notes play it (and transpose the running sequence), MIDI
// clock drives the sequencer in 16ths.
//
// Signal levels: audio +-5V, EG / gates 0..5V, KB 1V/oct (C4 = 0V), CV inputs 1V/oct where pitch.

(function(){

const C4 = 261.6255653005986;

// must match the jack ids in devices/b32.js ("audio" is the AUDIO OUT socket on the back, line level)
const IN_IDS = ["ext_audio","mix_cv","vca_cv","cutoff_in","res_in","pitch_in","lin_fm","vco_mod","lfo_rate_in",
	"mix1","mix2","vc_mix_ctrl","mult_in","gate_in","tempo_in","run_stop","reset_in","hold"];
const OUT_IDS = ["vca","noise","vcf","saw","pulse","lfo_tri","lfo_sq","vc_mix","mult1","mult2","assign","eg","kb","gate","audio"];
const I = {}; IN_IDS.forEach((id, k) => I[id] = k);
const O = {}; OUT_IDS.forEach((id, k) => O[id] = k);

const STEPS = 32;
const GATE_V = 5;
const GATE_THRESHOLD = 1;
const PULSE_TIME = 0.005;
const CUTOFF_MIN = 20;
const EG_CUTOFF_OCTAVES = 7;
const MIDI_CLOCK_TIMEOUT = 0.5;
const DECAY_TC = Math.log(1 / 0.01);
const ATTACK_TARGET = 1.3;
const ATTACK_TC = Math.log(ATTACK_TARGET / (ATTACK_TARGET - 1));

function polyblep(t, dt) {
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}

function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

class B32DSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;

		this.phase = Math.random();
		this.freq = 0;
		this.pitch = null;      // current (gliding) pitch in octaves, KB note
		this.target = 0;
		this.glideCoef = 1;
		this.lp = new Float64Array(4);
		this.smooth = null;
		this.eg = 0;
		this.egStage = 0;       // 1 attack, 2 sustain, 3 decay
		this.lfoPhase = 0;

		// sequencer
		this.playing = false;
		this.step = 0;
		this.stepPending = true;
		this.clockPhase = 0;
		this.seqGate = 0;       // samples left of the current step's gate
		this.accent = false;
		this.clockPulse = 0;
		this.midiTicks = 0;
		this.midiClockCount = 0;
		this.lastMidiClock = -1e12;
		this.sampleCount = 0;

		// keyboard: on-panel keys and MIDI (last note priority)
		this.keyNote = null;    // MIDI note number held, or null
		this.keyGate = false;
		this.bend = 0;
		this.flash = 0;
		this.stepSamples = 6000; // set every block from TEMPO
	}

	message(m) {
		switch (m.type) {
			case "play": this.setPlaying(m.value === undefined ? !this.playing : !!m.value); break;
			case "reset": this.reset(); break;
			case "next": this.advance(); break;
			case "trigger": this.keyGate = !!m.gate; if (m.gate) this.retrigger(); break;
			case "key": // on-panel keyboard
				if (m.gate) { this.keyNote = m.note; this.keyGate = true; this.retrigger(); }
				else if (this.keyNote === m.note) this.keyGate = false;
				break;
			case "midi":
				if (m.pitch !== undefined) this.keyNote = Math.round(60 + m.pitch * 12);
				this.keyGate = !!m.gate;
				if (m.retrigger) this.retrigger();
				break;
			case "bend": this.bend = m.value; break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.reset(); this.midiClockCount = 0; this.midiTicks = 0; this.setPlaying(true); break;
			case "midiStop": this.setPlaying(false); break;
			case "midiContinue": this.setPlaying(true); break;
		}
	}

	setSettings(s) { this.s = s; }

	setMidiConnected(c) {
		if (!c && this.midiConnected) { this.keyGate = false; this.bend = 0; this.lastMidiClock = -1e12; }
		this.midiConnected = c;
	}

	setPlaying(v) {
		if (v && !this.playing) this.clockPhase = 1; // first step right away
		if (!v) this.seqGate = 0;
		this.playing = v;
	}

	reset() {
		this.step = 0;
		this.stepPending = true;
		this.clockPhase = 1;
		this.midiClockCount = 0;
	}

	retrigger() { this.egStage = 1; }

	// next step: its note (with glide if marked), gate unless it is a rest, accent
	advance() {
		const s = this.s;
		const len = clamp(s.length | 0, 1, STEPS);
		if (this.stepPending) this.stepPending = false;
		else this.step = (this.step + 1) % len;
		if (this.step >= len) this.step = 0;
		const st = s.steps[this.step];
		this.clockPulse = Math.round(PULSE_TIME * sampleRate);
		this.flash = Math.round(0.06 * sampleRate);
		this.stepGlide = st.glide;
		this.accent = st.gate && st.accent;
		if (st.gate) {
			this.seqGate = Math.max(1, Math.round(clamp(s.gate_length, 0.05, 1) * this.stepSamples));
			if (!st.glide || this.egStage === 0) this.retrigger();
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
		const target = [Math.log2(clamp(s.cutoff, CUTOFF_MIN, 20000) / CUTOFF_MIN), s.resonance, s.volume * s.volume, s.mix, s.pw];
		if (!this.smooth) this.smooth = target.slice();
		for (let i = 0; i < target.length; i++) this.smooth[i] += (target[i] - this.smooth[i]) * 0.3;
		this.atk = 1 - Math.exp(-ATTACK_TC / (Math.max(s.attack, 0.0005) * sr));
		this.dec = Math.exp(-DECAY_TC / (Math.max(s.decay, 0.002) * sr));
		this.stepSamples = sr * 60 / (Math.max(1, s.tempo) * 4); // a step per 16th
		this.twoPiOver2sr = Math.PI / sr;

		// clock source: patched TEMPO input > MIDI clock > internal
		this.extClock = this.patched[I.tempo_in] === 1;
		const midiClock = !this.extClock && (this.sampleCount - this.lastMidiClock) < MIDI_CLOCK_TIMEOUT * sr;
		this.internalClock = !this.extClock && !midiClock;
		if (midiClock) {
			for (; this.midiTicks > 0; this.midiTicks--) {
				if (this.playing && this.midiClockCount % 6 === 0 && !this.holding) this.advance();
				this.midiClockCount++;
			}
		}
		this.midiTicks = 0;
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, patched = this.patched, sm = this.smooth, lp = this.lp;
		const sr = sampleRate;

		// ---- sequencer ----
		if (this.gateEdge(I.run_stop)) this.setPlaying(!this.playing);
		if (this.gateEdge(I.reset_in)) this.reset();
		this.holding = patched[I.hold] && ins[I.hold] > GATE_THRESHOLD;
		const clockEdge = this.gateEdge(I.tempo_in);
		if (this.playing && !this.holding) {
			if (this.internalClock) {
				this.clockPhase += 1 / this.stepSamples;
				if (this.clockPhase >= 1) { this.clockPhase -= Math.floor(this.clockPhase); this.advance(); }
			}
			else if (this.extClock && clockEdge) this.advance();
		}
		if (this.seqGate > 0 && !this.holding) this.seqGate--;
		const gateInEdge = this.gateEdge(I.gate_in);
		if (gateInEdge) this.retrigger();

		// pitch: the running sequence (transposed by a held key, relative to C3), or the key played
		const st = s.steps[this.step];
		let note;
		if (this.playing) note = st.note + (this.keyGate && this.keyNote !== null ? this.keyNote - 48 : 0);
		else note = this.keyNote !== null ? this.keyNote : st.note;
		this.target = (note - 60) / 12 + this.bend;
		const gate = (this.playing && this.seqGate > 0) || this.keyGate || this.gateHigh[I.gate_in] === 1;

		// glide: the GLIDE knob on every change, or a short one into steps marked glide
		const glideTime = Math.max(s.glide, this.playing && this.stepGlide ? 0.08 : 0);
		if (this.pitch === null || glideTime <= 0.0005) this.pitch = this.target;
		else this.pitch += (this.target - this.pitch) * (1 - Math.exp(-1 / (glideTime * 0.3 * sr)));

		// ---- envelope: attack, then sustain while the gate is held (SUSTAIN on) or decay ----
		if (this.egStage === 1) {
			this.eg += (ATTACK_TARGET - this.eg) * this.atk;
			if (this.eg >= 1) { this.eg = 1; this.egStage = s.sustain ? 2 : 3; }
		}
		else if (this.egStage === 2) { if (!gate) this.egStage = 3; }
		else if (this.egStage === 3) { this.eg *= this.dec; if (this.eg < 1e-6) { this.eg = 0; this.egStage = 0; } }

		// ---- LFO ----
		let rate = s.lfo_rate;
		if (patched[I.lfo_rate_in]) rate *= Math.exp(ins[I.lfo_rate_in] * Math.LN2);
		this.lfoPhase += clamp(rate, 0.001, 1000) / sr;
		if (this.lfoPhase >= 1) this.lfoPhase -= Math.floor(this.lfoPhase);
		const tri = 1 - 4 * Math.abs(this.lfoPhase - 0.5);
		const sq = this.lfoPhase < 0.5 ? 1 : -1;
		const lfo = s.lfo_wave === "sq" ? sq : tri;

		// ---- VCO: modulation from the EG or LFO (or the VCO MOD input) to frequency or pulse width ----
		let modSrc = s.vco_mod_src === "eg" ? this.eg : lfo;
		if (patched[I.vco_mod]) modSrc = ins[I.vco_mod] / 5;
		const mod = modSrc * s.vco_mod;
		let p = Math.log2(s.freq / C4) + this.pitch;
		if (patched[I.pitch_in]) p += ins[I.pitch_in];
		if (s.vco_mod_dest === "freq") p += mod * 3;
		let f = C4 * Math.exp(p * Math.LN2);
		if (patched[I.lin_fm]) f *= 1 + ins[I.lin_fm] / 5;
		const dt = clamp(f / sr, -0.45, 0.45);
		this.freq = f;
		this.phase += dt;
		if (this.phase >= 1) this.phase -= 1;
		else if (this.phase < 0) this.phase += 1;
		const t = this.phase, adt = Math.abs(dt);
		const saw = 2 * t - 1 - polyblep(t, adt);
		let pw = sm[4] + (s.vco_mod_dest === "pw" ? mod * 0.45 : 0);
		pw = clamp(pw, 0.03, 0.97);
		let t2 = t - pw; if (t2 < 0) t2 += 1;
		const pulse = (t < pw ? 1 : -1) + polyblep(t, adt) - polyblep(t2, adt);

		// ---- mixer: VCO (saw or pulse) against noise (or EXT AUDIO) ----
		const noise = Math.random() * 2 - 1;
		const other = patched[I.ext_audio] ? ins[I.ext_audio] / 5 : noise;
		let mix = sm[3];
		if (patched[I.mix_cv]) mix = clamp(mix + ins[I.mix_cv] / 5, 0, 1);
		const vco = s.wave === "pulse" ? pulse : saw;
		const input = (vco * (1 - mix) + other * mix) * 0.5;

		// ---- ladder filter, LP or HP, 2x oversampled ----
		let vcfSrc = s.vcf_mod_src === "lfo" ? lfo : this.eg;
		let cutOct = sm[0] + vcfSrc * s.vcf_mod * EG_CUTOFF_OCTAVES + (this.accent && gate ? 0.6 : 0);
		if (patched[I.cutoff_in]) cutOct += ins[I.cutoff_in];
		const fc = clamp(CUTOFF_MIN * Math.exp(cutOct * Math.LN2), 5, sr * 0.45);
		const g = 1 - Math.exp(-this.twoPiOver2sr * fc);
		let res = sm[1];
		if (patched[I.res_in]) res = clamp(res + ins[I.res_in] / 5, 0, 1);
		const fbk = res * 4.4;
		let x = 0;
		for (let os = 0; os < 2; os++) {
			x = fastTanh(input - fbk * lp[3]);
			lp[0] += g * (x - lp[0]);
			lp[1] += g * (lp[0] - lp[1]);
			lp[2] += g * (lp[1] - lp[2]);
			lp[3] += g * (lp[2] - lp[3]);
		}
		const filtered = (s.vcf_mode === "hp" ? x - 4 * lp[0] + 6 * lp[1] - 4 * lp[2] + lp[3] : lp[3]) * (1 + fbk * 0.3);

		// ---- VCA: EG (accented steps louder) or always on; the VCA CV input takes over ----
		let vca = s.vca_mode === "on" ? 1 : this.eg * (this.accent ? 1 : 0.75);
		if (patched[I.vca_cv]) vca = clamp(ins[I.vca_cv] / 5, 0, 1.6);
		const vcaOut = filtered * vca;

		// ---- utilities: VC mix (MIX 1 normalled to +5V, MIX 2 to 0V), mult ----
		let c = s.vc_mix;
		if (patched[I.vc_mix_ctrl]) c += ins[I.vc_mix_ctrl] / 5;
		c = clamp(c, 0, 1);
		const m1 = patched[I.mix1] ? ins[I.mix1] : 5, m2 = patched[I.mix2] ? ins[I.mix2] : 0;

		outs[O.vca] = vcaOut * 5;
		outs[O.noise] = noise * 5;
		outs[O.vcf] = filtered * 5;
		outs[O.saw] = saw * 5;
		outs[O.pulse] = pulse * 5;
		outs[O.lfo_tri] = tri * 5;
		outs[O.lfo_sq] = sq * 5;
		outs[O.vc_mix] = m1 * (1 - c) + m2 * c;
		outs[O.mult1] = outs[O.mult2] = ins[I.mult_in];
		outs[O.eg] = this.eg * 5;
		outs[O.kb] = this.pitch;
		outs[O.gate] = gate ? GATE_V : 0;
		let assign = 0;
		if (s.assign === "accent") assign = this.accent && gate ? GATE_V : 0;
		else if (s.assign === "clock") assign = this.clockPulse > 0 ? GATE_V : 0;
		else assign = (this.step / Math.max(1, (s.length | 0) - 1)) * 5; // ramp over the sequence
		if (this.clockPulse > 0) this.clockPulse--;
		outs[O.assign] = assign;
		const audio = vcaOut * sm[2] * 2;
		outs[O.audio] = audio;
		this.gateOn = gate;
		return audio;
	}

	endBlock(n) {
		this.sampleCount += n;
		this.flash = Math.max(0, this.flash - n);
	}

	state() {
		return { playing: this.playing, step: this.step, freq: this.freq, eg: this.eg, gate: !!this.gateOn,
			lfo: s_lfo(this.lfoPhase), clock: this.flash > 0, key: this.keyGate ? this.keyNote : null };
	}
}
function s_lfo(p) { return 1 - 4 * Math.abs(p - 0.5); }

B32DSP.OUT_IDS = OUT_IDS;
B32DSP.IN_IDS = IN_IDS;
B32DSP.MIDI_IN = "midi_in";

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.brother32 = B32DSP;

})();
