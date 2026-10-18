// devices/subharm-worklet.js
// SUBHARM DSP, hosted by the rack processor (rack-worklet.js) in the AudioWorklet.
// Oscillators, subharmonic dividers, ladder filter, envelopes, master clock,
// polyrhythm dividers and sequencers are computed sample by sample, so rhythms and
// CV patching are sample accurate. The rack copies the patch cables into `ins`
// before every tick() and reads `outs` after it.
//
// Signal conventions on the patch bay (like the hardware, roughly):
//   audio outputs   +-5V
//   envelope outs   0..5V
//   seq outs        1V/oct (step value * SEQ OCT range)
//   clock / trigger 5V pulses, 5ms long
//   pitch inputs    1V/oct, cutoff input 1V/oct

(function(){

const C4 = 261.6255653005986;

// must match the jack ids in devices/subharm.js
// (the last one, "audio", is the AUDIO OUT socket on the back: line level, not +-5V)
const OUT_IDS = ["vco1","vco1_sub1","vco1_sub2","vco2","vco2_sub1","vco2_sub2","vca","vca_eg","vcf_eg","seq1","seq1_clk","seq2","seq2_clk","clock_out","trigger_out","audio"];
const IN_IDS = ["vco1_in","vco1_sub_in","vco1_pwm","vca_in","vco2_in","vco2_sub_in","vco2_pwm","cutoff_in","play_in","reset_in","trigger_in","rhythm1_in","rhythm2_in","rhythm3_in","rhythm4_in","clock_in"];

const O_VCO = [0, 3]; // +1 = sub 1, +2 = sub 2
const O_VCA = 6, O_VCA_EG = 7, O_VCF_EG = 8, O_SEQ = [9, 11], O_SEQ_CLK = [10, 12], O_CLOCK = 13, O_TRIG = 14, O_AUDIO = 15;
const I_VCO_PITCH = [0, 4], I_VCO_SUB = [1, 5], I_VCO_PWM = [2, 6];
const I_VCA = 3, I_CUTOFF = 7, I_PLAY = 8, I_RESET = 9, I_TRIG = 10, I_RHYTHM = 11, I_CLOCK = 15;
const PULSE_OUTS = [O_SEQ_CLK[0], O_SEQ_CLK[1], O_CLOCK, O_TRIG];

const WAVE_SQUARE = 0, WAVE_PWM = 1, WAVE_SAW = 2;
const WAVE_MODES = { square: WAVE_SQUARE, pwm: WAVE_PWM, saw: WAVE_SAW };

const GATE_V = 5;
const GATE_THRESHOLD = 1;
const PULSE_TIME = 0.005;
const SUB_DIV_PER_VOLT = 3;   // how many subharmonic divisions one volt of CV shifts
const CUTOFF_MIN = 20;        // cutoff knob spans 20Hz..20kHz
const EG_CUTOFF_OCTAVES = 7;  // VCF EG AMT at full = +-7 octaves
const MIDI_CLOCK_TIMEOUT = 0.5;

function log2All(ratios) { return ratios.map(Math.log2); }

// pitches are in octaves relative to C4, so all scales are rooted at C
const SCALES = {
	"12-ET": { degrees: [0,1,2,3,4,5,6,7,8,9,10,11].map(s => s / 12), period: 1 },
	"8-ET": { degrees: [0,2,4,5,7,9,11].map(s => s / 12), period: 1 },
	"12-JI": { degrees: log2All([1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8]), period: 1 },
	"8-JI": { degrees: log2All([1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8]), period: 1 }
};

// snap x (octaves) to the nearest degree of the scale
function quantize(x, scale) {
	const p = scale.period, d = scale.degrees;
	const o = Math.floor(x / p);
	const r = x - o * p;
	let best = d[0] + p, bd = Math.abs(r - best);
	for (let i = 0; i < d.length; i++) {
		const dd = Math.abs(r - d[i]);
		if (dd < bd) { bd = dd; best = d[i]; }
	}
	return o * p + best;
}

function polyblep(t, dt) {
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}

function saw(t, dt) { return 2 * t - 1 - polyblep(t, dt); }

function pulse(t, dt, pw) {
	let t2 = t - pw;
	if (t2 < 0) t2 += 1;
	return (t < pw ? 1 : -1) + polyblep(t, dt) - polyblep(t2, dt);
}

function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// analog-ish RC envelope: attack charges towards an overshoot target
const ATTACK_TARGET = 1.3;
const ATTACK_TC = Math.log(ATTACK_TARGET / (ATTACK_TARGET - 1)); // time constants to reach 1.0
const DECAY_TC = Math.log(1 / 0.01);                             // decay time = time to reach -40dB

class SubharmDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.pulses = new Int32Array(OUT_IDS.length);
		this.customScale = null;

		this.vcos = [0, 1].map(() => ({
			phase: Math.random(), cnt1: 0, cnt2: 0,
			knob: null, drift: 0, pitch: 0, freq: 0,
			prePitch: 0, scale: null, lastCv: NaN, lastQ: 0, // unquantized pitch, for the patched pitch input
			div1: 1, div2: 1, curDiv1: 1, curDiv2: 1
		}));
		this.lp = new Float64Array(4);
		this.smooth = null;
		this.vcaEg = { level: 0, stage: 0 };
		this.vcfEg = { level: 0, stage: 0 };

		this.playing = false;
		this.clockPhase = 0;
		this.rhythmCnt = [0, 0, 0, 0];
		this.rhythmFlash = [0, 0, 0, 0];
		this.clockFlash = 0;
		this.step = [0, 0];
		this.stepPending = [true, true]; // after reset the next advance stays on step 1
		this.controlDirty = true;

		this.holdButton = false;
		this.holdMidi = false;
		this.holdInput = false;
		this.midiPitch = 0;
		this.bend = 0;
		this.midiTicks = 0;
		this.midiClockCount = 0;
		this.lastMidiClock = -1e12;
		this.midiConnected = false;
		this.sampleCount = 0;
		this.clockSource = "internal";
	}

	// panel buttons, MIDI (only while the MIDI cable is in) and the rack's Scala scale
	message(m) {
		switch (m.type) {
			case "scale": this.customScale = m.scale; this.controlDirty = true; break;
			case "play": this.setPlaying(m.value === undefined ? !this.playing : !!m.value); break;
			case "reset": this.reset(); break;
			case "next": this.advance(0); this.advance(1); this.triggerEGs(); break;
			case "trigger": this.holdButton = !!m.gate; if (m.gate) this.triggerEGs(); break;
			case "midi":
				if (m.pitch !== undefined) { this.midiPitch = m.pitch; this.controlDirty = true; }
				this.holdMidi = !!m.gate;
				if (m.retrigger) this.triggerEGs();
				break;
			case "bend": this.bend = m.value; this.controlDirty = true; break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.reset(); this.midiClockCount = 0; this.midiTicks = 0; this.setPlaying(true); break;
			case "midiStop": this.setPlaying(false); break;
			case "midiContinue": this.setPlaying(true); break;
		}
	}

	setSettings(s) {
		this.s = s;
		this.controlDirty = true;
	}

	setMidiConnected(connected) {
		if (!connected && this.midiConnected) {
			// unplugging the MIDI cable releases held notes and the transposition
			this.holdMidi = false;
			this.midiPitch = 0;
			this.bend = 0;
			this.lastMidiClock = -1e12;
			this.controlDirty = true;
		}
		this.midiConnected = connected;
	}

	setPlaying(v) {
		if (v && !this.playing)
			this.clockPhase = 1; // first tick right away
		this.playing = v;
	}

	reset() {
		this.rhythmCnt.fill(0);
		this.step[0] = this.step[1] = 0;
		this.stepPending[0] = this.stepPending[1] = true;
		this.clockPhase = 1;
		this.midiClockCount = 0;
		this.controlDirty = true;
	}

	advance(s) {
		if (this.stepPending[s])
			this.stepPending[s] = false;
		else
			this.step[s] = (this.step[s] + 1) % 4;
		this.pulses[O_SEQ_CLK[s]] = Math.round(PULSE_TIME * sampleRate);
		this.controlDirty = true;
	}

	triggerEGs() {
		this.vcaEg.stage = 1;
		this.vcfEg.stage = 1;
		this.pulses[O_TRIG] = Math.round(PULSE_TIME * sampleRate);
	}

	// one pulse of the master clock: run the four rhythm dividers
	masterTick() {
		const s = this.s;
		this.pulses[O_CLOCK] = Math.round(PULSE_TIME * sampleRate);
		this.clockFlash = Math.round(0.05 * sampleRate);
		let adv1 = false, adv2 = false;
		for (let i = 0; i < 4; i++) {
			let div = s.rhythm[i];
			if (this.patched[I_RHYTHM + i])
				div += Math.round(this.ins[I_RHYTHM + i] * SUB_DIV_PER_VOLT);
			div = clamp(div, 1, 16);
			if (this.rhythmCnt[i] >= div)
				this.rhythmCnt[i] = 0;
			if (this.rhythmCnt[i] === 0) {
				this.rhythmFlash[i] = Math.round(0.06 * sampleRate);
				if (s.rhythm_seq1[i]) adv1 = true;
				if (s.rhythm_seq2[i]) adv2 = true;
			}
			this.rhythmCnt[i]++;
			if (this.rhythmCnt[i] >= div)
				this.rhythmCnt[i] = 0;
		}
		// coincident rhythms advance a sequencer only once (logical OR)
		if (adv1) this.advance(0);
		if (adv2) this.advance(1);
		if (adv1 || adv2) this.triggerEGs();
	}

	// pitch and divisions from knobs + sequencer + MIDI (everything but patched CV)
	updateControl(smoothKnob) {
		const s = this.s;
		let scale = null;
		if (s.quantize === "SCL") scale = this.customScale;
		else if (SCALES[s.quantize]) scale = SCALES[s.quantize];

		for (let i = 0; i < 2; i++) {
			const v = this.vcos[i];
			const sv = s.vco[i];
			const target = Math.log2(sv.freq / C4);
			if (v.knob === null || !smoothKnob) v.knob = target;
			else v.knob += (target - v.knob) * 0.25;
			if (Math.abs(target - v.knob) < 1e-6) v.knob = target;

			const seqCv = s.seq[i][this.step[i]] * s.seq_oct;
			const a = s.seq_assign[i];
			let p = v.knob + (a.osc ? seqCv : 0) + this.midiPitch;
			v.prePitch = p;
			v.scale = scale;
			v.lastCv = NaN;
			if (scale) p = quantize(p, scale);
			v.pitch = p + this.bend;

			const seqDiv = Math.round(seqCv * SUB_DIV_PER_VOLT);
			v.div1 = sv.sub1 + (a.sub1 ? seqDiv : 0);
			v.div2 = sv.sub2 + (a.sub2 ? seqDiv : 0);
		}
	}

	egCoefs(attack, decay) {
		const sr = sampleRate;
		return [
			1 - Math.exp(-ATTACK_TC / (Math.max(attack, 0.0005) * sr)),
			Math.exp(-DECAY_TC / (Math.max(decay, 0.001) * sr))
		];
	}

	stepEg(eg, ac, dc, hold) {
		if (eg.stage === 1) {
			eg.level += (ATTACK_TARGET - eg.level) * ac;
			if (eg.level >= 1) { eg.level = 1; eg.stage = hold ? 2 : 3; }
		}
		else if (eg.stage === 2) {
			if (!hold) eg.stage = 3;
		}
		else if (eg.stage === 3) {
			eg.level *= dc;
			if (eg.level < 1e-6) { eg.level = 0; eg.stage = 0; }
		}
	}

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising;
	}

	// per block control: knob smoothing, envelope coefficients, clock source
	beginBlock(n) {
		const s = this.s;
		const sr = sampleRate;
		for (const v of this.vcos) {
			v.drift += (Math.random() - 0.5) * 0.0004;
			v.drift *= 0.995;
		}
		this.updateControl(true);
		this.controlDirty = false;
		this.lp[0] += (Math.random() - 0.5) * 1e-5; // a little noise lets the filter self-oscillate

		const lvTarget = [
			s.vco[0].level, s.vco[0].sub1_level, s.vco[0].sub2_level,
			s.vco[1].level, s.vco[1].sub1_level, s.vco[1].sub2_level
		].map(x => x * x);
		const cutTarget = Math.log2(clamp(s.cutoff, CUTOFF_MIN, 20000) / CUTOFF_MIN);
		const volTarget = s.volume * s.volume;
		if (!this.smooth)
			this.smooth = { lv: lvTarget.slice(), cut: cutTarget, res: s.resonance, vol: volTarget };
		const sm = this.smooth;
		const k = 0.3;
		for (let i = 0; i < 6; i++) sm.lv[i] += (lvTarget[i] - sm.lv[i]) * k;
		sm.cut += (cutTarget - sm.cut) * k;
		sm.res += (s.resonance - sm.res) * k;
		sm.vol += (volTarget - sm.vol) * k;
		this.fbk = sm.res * 4.6; // self-oscillates over the last ~15% of the knob
		this.resComp = 1 + this.fbk * 0.3; // passband gain compensation for resonance
		// wave switch: up = all square, middle = pulse VCO + saw subs (SUB 1 normalled to PWM), down = all saw
		this.waveMode = [WAVE_MODES[s.vco[0].wave] || 0, WAVE_MODES[s.vco[1].wave] || 0];
		this.vcaC = this.egCoefs(s.vca_attack, s.vca_decay);
		this.vcfC = this.egCoefs(s.vcf_attack, s.vcf_decay);
		this.egAmt = s.vcf_eg_amt * EG_CUTOFF_OCTAVES;

		// clock source: patched CLOCK input > MIDI clock > internal tempo
		const extClock = this.patched[I_CLOCK] === 1;
		const midiClock = !extClock && (this.sampleCount - this.lastMidiClock) < MIDI_CLOCK_TIMEOUT * sr;
		this.extClock = extClock;
		this.internalClock = !extClock && !midiClock;
		this.clockSource = extClock ? "patch" : (midiClock ? "midi" : "internal");
		if (midiClock) {
			for (; this.midiTicks > 0; this.midiTicks--) {
				// MIDI clock is 24 ppqn, the master clock runs in 16ths (4 ppq)
				if (this.playing && this.midiClockCount % 6 === 0) this.masterTick();
				this.midiClockCount++;
			}
		}
		this.midiTicks = 0;
		this.clockInc = s.tempo / 60 / sr;
		this.twoPiOver2sr = 2 * Math.PI / (2 * sr);
	}

	// one sample; the result also goes to the AUDIO OUT socket on the back
	tick() {
		const s = this.s;
		const ins = this.ins, outs = this.outs, patched = this.patched, pulses = this.pulses;
		const lp = this.lp, sm = this.smooth, lv = sm.lv;

		if (this.gateEdge(I_PLAY)) this.setPlaying(!this.playing);
		if (this.gateEdge(I_RESET)) this.reset();
		if (this.gateEdge(I_TRIG)) this.triggerEGs();
		this.holdInput = this.gateHigh[I_TRIG] === 1;
		const clockEdge = this.gateEdge(I_CLOCK);

		// ---- clock ----
		if (this.playing) {
			if (this.internalClock) {
				this.clockPhase += this.clockInc;
				if (this.clockPhase >= 1) {
					this.clockPhase -= Math.floor(this.clockPhase);
					this.masterTick();
				}
			}
			else if (this.extClock && clockEdge)
				this.masterTick();
		}
		if (this.controlDirty) {
			this.updateControl(false);
			this.controlDirty = false;
		}

		// ---- oscillators + subharmonic dividers ----
		let mix = 0;
		for (let i = 0; i < 2; i++) {
			const v = this.vcos[i];
			let pitch = v.pitch + v.drift;
			if (patched[I_VCO_PITCH[i]]) {
				// the patched pitch CV goes through the quantizer too (only re-quantized when it changes)
				const cv = ins[I_VCO_PITCH[i]];
				if (!v.scale)
					pitch += cv;
				else {
					if (cv !== v.lastCv) {
						v.lastCv = cv;
						v.lastQ = quantize(v.prePitch + cv, v.scale);
					}
					pitch = v.lastQ + this.bend + v.drift;
				}
			}
			const f = C4 * Math.exp(pitch * Math.LN2);
			const dt = clamp(f / sampleRate, 0, 0.45);
			v.freq = f;

			let subCv = 0;
			if (patched[I_VCO_SUB[i]]) subCv = Math.round(ins[I_VCO_SUB[i]] * SUB_DIV_PER_VOLT);
			const d1 = clamp(v.div1 + subCv, 1, 16);
			const d2 = clamp(v.div2 + subCv, 1, 16);
			v.curDiv1 = d1; v.curDiv2 = d2;
			if (v.cnt1 >= d1) v.cnt1 %= d1;
			if (v.cnt2 >= d2) v.cnt2 %= d2;

			v.phase += dt;
			if (v.phase >= 1) {
				v.phase -= 1;
				if (++v.cnt1 >= d1) v.cnt1 = 0;
				if (++v.cnt2 >= d2) v.cnt2 = 0;
			}
			const ph = v.phase;
			const sp1 = (v.cnt1 + ph) / d1, dt1 = dt / d1;
			const sp2 = (v.cnt2 + ph) / d2, dt2 = dt / d2;

			let o, o1, o2;
			const mode = this.waveMode[i];
			if (mode === WAVE_SQUARE) {
				let pw = 0.5;
				if (patched[I_VCO_PWM[i]]) pw = clamp(0.5 + ins[I_VCO_PWM[i]] * 0.09, 0.05, 0.95);
				o = pulse(ph, dt, pw);
				o1 = pulse(sp1, dt1, 0.5);
				o2 = pulse(sp2, dt2, 0.5);
			}
			else if (mode === WAVE_PWM) {
				o1 = saw(sp1, dt1);
				o2 = saw(sp2, dt2);
				const pw = patched[I_VCO_PWM[i]] ? clamp(0.5 + ins[I_VCO_PWM[i]] * 0.09, 0.05, 0.95) : 0.5 + o1 * 0.4;
				o = pulse(ph, dt, pw);
			}
			else {
				o = saw(ph, dt);
				o1 = saw(sp1, dt1);
				o2 = saw(sp2, dt2);
			}
			const b = O_VCO[i];
			outs[b] = o * 5;
			outs[b + 1] = o1 * 5;
			outs[b + 2] = o2 * 5;
			mix += o * lv[i * 3] + o1 * lv[i * 3 + 1] + o2 * lv[i * 3 + 2];
		}

		// ---- envelopes ----
		const hold = this.holdButton || this.holdMidi || this.holdInput;
		this.stepEg(this.vcaEg, this.vcaC[0], this.vcaC[1], hold);
		this.stepEg(this.vcfEg, this.vcfC[0], this.vcfC[1], hold);
		if (s.eg_hold) { // EG button held until it blinks: both envelopes locked at maximum
			this.vcaEg.level = 1;
			this.vcfEg.level = 1;
		}

		// ---- 4-pole ladder filter, 2x oversampled ----
		let cutOct = sm.cut + this.vcfEg.level * this.egAmt;
		if (patched[I_CUTOFF]) cutOct += ins[I_CUTOFF];
		const fc = clamp(CUTOFF_MIN * Math.exp(cutOct * Math.LN2), 5, sampleRate * 0.45);
		const g = 1 - Math.exp(-this.twoPiOver2sr * fc);
		const input = mix * 0.5, fbk = this.fbk;
		for (let os = 0; os < 2; os++) {
			const x = fastTanh(input - fbk * lp[3]);
			lp[0] += g * (x - lp[0]);
			lp[1] += g * (lp[0] - lp[1]);
			lp[2] += g * (lp[1] - lp[2]);
			lp[3] += g * (lp[2] - lp[3]);
		}
		const filtered = lp[3] * this.resComp;

		// ---- VCA ----
		let vca;
		if (patched[I_VCA]) vca = clamp(ins[I_VCA] / 5, 0, 1.5);
		else vca = this.vcaEg.level;
		const vcaOut = filtered * vca;

		outs[O_VCA] = vcaOut * 5;
		outs[O_VCA_EG] = this.vcaEg.level * 5;
		outs[O_VCF_EG] = this.vcfEg.level * 5;
		outs[O_SEQ[0]] = s.seq[0][this.step[0]] * s.seq_oct;
		outs[O_SEQ[1]] = s.seq[1][this.step[1]] * s.seq_oct;
		for (let q = 0; q < PULSE_OUTS.length; q++) {
			const idx = PULSE_OUTS[q];
			if (pulses[idx] > 0) { outs[idx] = GATE_V; pulses[idx]--; }
			else outs[idx] = 0;
		}
		const audio = vcaOut * sm.vol * 2;
		outs[O_AUDIO] = audio;
		return audio;
	}

	endBlock(n) {
		this.sampleCount += n;
		for (let i = 0; i < 4; i++) this.rhythmFlash[i] = Math.max(0, this.rhythmFlash[i] - n);
		this.clockFlash = Math.max(0, this.clockFlash - n);
	}

	// for the panel: LEDs, tooltips
	state() {
		return {
			playing: this.playing,
			step: this.step.slice(),
			rhythm: this.rhythmFlash.map(x => x > 0),
			clock: this.clockFlash > 0,
			clock_source: this.clockSource,
			freq: this.vcos.map(v => v.freq),
			div: this.vcos.map(v => [v.curDiv1, v.curDiv2]),
			vca_eg: this.vcaEg.level,
			vcf_eg: this.vcfEg.level
		};
	}
}
SubharmDSP.OUT_IDS = OUT_IDS;
SubharmDSP.IN_IDS = IN_IDS;
SubharmDSP.MIDI_IN = "midi_in";
SubharmDSP.quantize = quantize;
SubharmDSP.SCALES = SCALES;

// shared AudioWorkletGlobalScope: the rack processor finds the module DSPs here
globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.subharm = SubharmDSP;

})();
