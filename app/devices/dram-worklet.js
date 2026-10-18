// devices/dram-worklet.js
// DRAM DSP (an analog percussion synthesizer), hosted by the rack processor (rack-worklet.js).
// Two VCOs (triangle / square) with a shared decay-only pitch envelope, 1->2 FM and hard sync,
// white noise (or the EXT AUDIO input), a ladder filter with LP / HP modes and noise modulation,
// a VCA with FAST / SLOW attack, and the 8-step sequencer with a pitch and a velocity per step.
//
// Signal levels: audio +-5V, envelopes 0..5V, sequencer PITCH +-5V (1V/oct into the VCOs),
// VELOCITY 0..5V, TRIGGER 5ms pulses at 5V. CV inputs on pitch, tempo and decays are 1V/oct.

(function(){

const C4 = 261.6255653005986;

// must match the jack ids in devices/dram.js
// (the last one, "audio", is the AUDIO OUT socket on the back: line level, not +-5V)
const OUT_IDS = ["vca","vca_eg","vcf_eg","vco_eg","vco1","vco2","trigger_out","velocity_out","pitch_out","audio"];
const IN_IDS = ["trigger_in","vca_cv","velocity_in","vca_decay_in","ext_audio","vcf_decay_in","noise_level_in","vco_decay_in",
	"vcf_mod","vco1_cv","fm_amt_in","vco2_cv","tempo_in","run_stop","adv_clock"];

const O_VCA = 0, O_VCA_EG = 1, O_VCF_EG = 2, O_VCO_EG = 3, O_VCO1 = 4, O_VCO2 = 5, O_TRIG = 6, O_VEL = 7, O_PITCH = 8, O_AUDIO = 9;
const I_TRIG = 0, I_VCA_CV = 1, I_VEL = 2, I_VCA_DECAY = 3, I_EXT = 4, I_VCF_DECAY = 5, I_NOISE = 6, I_VCO_DECAY = 7,
	I_VCF_MOD = 8, I_VCO1 = 9, I_FM = 10, I_VCO2 = 11, I_TEMPO = 12, I_RUN = 13, I_ADV = 14;

const STEPS = 8;
const GATE_V = 5;
const GATE_THRESHOLD = 1;
const PULSE_TIME = 0.005;
const CUTOFF_MIN = 20;
const EG_CUTOFF_OCTAVES = 7;  // VCF EG AMOUNT at full = +-7 octaves
const EG_PITCH_OCTAVES = 5;   // VCO EG AMOUNT at full = +-5 octaves
const FM_OCTAVES = 3;         // 1->2 FM AMOUNT at full: VCO 1 swings VCO 2 by +-3 octaves
const NOISE_MOD_OCTAVES = 4;  // NOISE / VCF MOD at full
const SEQ_VOLTS = 5;          // PITCH knobs span +-5V
const DECAY_TC = Math.log(1 / 0.01); // decay time = time to reach -40dB
const ATTACK_TIMES = { fast: 0.001, slow: 0.1 };

function polyblep(t, dt) {
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}

function square(t, dt) {
	let t2 = t - 0.5;
	if (t2 < 0) t2 += 1;
	return (t < 0.5 ? 1 : -1) + polyblep(t, dt) - polyblep(t2, dt);
}

function triangle(t) { return 4 * Math.abs(t - 0.5) - 1; }

function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// per-sample decay multiplier for a decay time (to -40dB), stretched by a 1V/oct CV
function decayCoef(time, cv) {
	const t = clamp(time * Math.exp(cv * Math.LN2), 0.002, 30);
	return Math.exp(-DECAY_TC / (t * sampleRate));
}

class DramDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;

		this.phase = [Math.random(), Math.random()];
		this.freq = [0, 0];
		this.lp = new Float64Array(4);
		this.smooth = null;
		this.vcoEg = 0;
		this.vcfEg = 0;
		this.vcaEg = 0;
		this.vcaStage = 0; // 1 attack, 2 decay
		this.velocity = 1; // of the last trigger
		this.trigPulse = 0;
		this.flash = 0;

		this.playing = false;
		this.clockPhase = 0;
		this.step = 0;
		this.stepPending = true; // the first advance after a reset plays step 1
	}

	message(m) {
		switch (m.type) {
			case "play": this.setPlaying(m.value === undefined ? !this.playing : !!m.value); break;
			case "reset": this.step = 0; this.stepPending = true; break;
			case "next": this.advance(); break;           // ADVANCE button
			case "trigger": if (m.gate) this.trigger(); break; // TRIGGER button: the current step
		}
	}

	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	setPlaying(v) {
		if (v && !this.playing)
			this.clockPhase = 1; // first step right away
		this.playing = v;
	}

	advance() {
		if (this.stepPending)
			this.stepPending = false;
		else
			this.step = (this.step + 1) % STEPS;
		this.trigger();
	}

	// fires the three envelopes with the current step's velocity
	trigger() {
		const s = this.s;
		this.velocity = this.patched[I_VEL] ? clamp(this.ins[I_VEL] / 5, 0, 1.6) : s.velocity[this.step];
		this.vcoEg = 1;
		this.vcfEg = 1;
		this.vcaStage = 1;
		this.trigPulse = Math.round(PULSE_TIME * sampleRate);
		this.flash = Math.round(0.06 * sampleRate);
	}

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising;
	}

	beginBlock(n) {
		const s = this.s;
		const target = [
			Math.log2(s.vco1_freq / C4), Math.log2(s.vco2_freq / C4),
			s.vco1_level * s.vco1_level, s.vco2_level * s.vco2_level, s.noise_level * s.noise_level,
			Math.log2(clamp(s.cutoff, CUTOFF_MIN, 20000) / CUTOFF_MIN), s.resonance, s.volume * s.volume
		];
		if (!this.smooth)
			this.smooth = target.slice();
		const sm = this.smooth;
		for (let i = 0; i < sm.length; i++) sm[i] += (target[i] - sm[i]) * 0.3;
		this.fbk = sm[6] * 4.4;
		this.resComp = 1 + this.fbk * 0.3;
		this.attackCoef = 1 - Math.exp(-Math.log(1.3 / 0.3) / (ATTACK_TIMES[s.vca_attack] * sampleRate));
		this.decay = [decayCoef(s.vco_decay, 0), decayCoef(s.vcf_decay, 0), decayCoef(s.vca_decay, 0)];
		this.stepInc = s.tempo * 4 / 60 / sampleRate; // TEMPO in BPM, a step per 16th
		this.twoPiOver2sr = 2 * Math.PI / (2 * sampleRate);
	}

	tick() {
		const s = this.s;
		const ins = this.ins, outs = this.outs, patched = this.patched, sm = this.smooth, lp = this.lp;

		// ---- sequencer ----
		if (this.gateEdge(I_RUN)) this.setPlaying(!this.playing);
		if (patched[I_ADV]) {
			// an ADV / CLOCK cable replaces the internal clock
			if (this.gateEdge(I_ADV)) this.advance();
		}
		else if (this.playing) {
			let inc = this.stepInc;
			if (patched[I_TEMPO]) inc *= Math.exp(ins[I_TEMPO] * Math.LN2);
			this.clockPhase += inc;
			if (this.clockPhase >= 1) {
				this.clockPhase -= Math.floor(this.clockPhase);
				this.advance();
			}
		}
		if (this.gateEdge(I_TRIG)) this.trigger();

		// ---- envelopes: decay only, the VCA one with a FAST / SLOW attack ----
		this.vcoEg *= patched[I_VCO_DECAY] ? decayCoef(s.vco_decay, ins[I_VCO_DECAY]) : this.decay[0];
		this.vcfEg *= patched[I_VCF_DECAY] ? decayCoef(s.vcf_decay, ins[I_VCF_DECAY]) : this.decay[1];
		if (this.vcaStage === 1) {
			this.vcaEg += (1.3 - this.vcaEg) * this.attackCoef;
			if (this.vcaEg >= 1) { this.vcaEg = 1; this.vcaStage = 2; }
		}
		else
			this.vcaEg *= patched[I_VCA_DECAY] ? decayCoef(s.vca_decay, ins[I_VCA_DECAY]) : this.decay[2];
		const vel = this.velocity;

		// ---- oscillators ----
		const seqCv = s.pitch[this.step] * SEQ_VOLTS;
		const mod = s.seq_pitch_mod;
		let p1 = sm[0] + this.vcoEg * s.vco1_eg_amt * EG_PITCH_OCTAVES + (mod === "both" ? seqCv : 0);
		let p2 = sm[1] + this.vcoEg * s.vco2_eg_amt * EG_PITCH_OCTAVES + (mod !== "off" ? seqCv : 0);
		if (patched[I_VCO1]) p1 += ins[I_VCO1];
		if (patched[I_VCO2]) p2 += ins[I_VCO2];

		const f1 = C4 * Math.exp(p1 * Math.LN2);
		const dt1 = clamp(f1 / sampleRate, 0, 0.45);
		this.phase[0] += dt1;
		let wrapped = false;
		if (this.phase[0] >= 1) { this.phase[0] -= 1; wrapped = true; }
		const t1 = this.phase[0];
		const o1 = s.vco1_wave === "square" ? square(t1, dt1) : triangle(t1);

		let fm = s.fm_amt;
		if (patched[I_FM]) fm = clamp(fm + ins[I_FM] / 5, 0, 1);
		p2 += o1 * fm * FM_OCTAVES;
		const f2 = C4 * Math.exp(p2 * Math.LN2);
		const dt2 = clamp(f2 / sampleRate, 0, 0.45);
		this.phase[1] += dt2;
		if (s.hard_sync && wrapped) this.phase[1] = t1 * dt2 / dt1; // restart with VCO 1, keeping the sub-sample offset
		if (this.phase[1] >= 1) this.phase[1] -= Math.floor(this.phase[1]);
		const t2 = this.phase[1];
		const o2 = s.vco2_wave === "square" ? square(t2, dt2) : triangle(t2);
		this.freq[0] = f1;
		this.freq[1] = f2;

		// ---- mixer: VCO 1, VCO 2 and noise (or EXT AUDIO) ----
		const noise = Math.random() * 2 - 1;
		const src = patched[I_EXT] ? ins[I_EXT] / 5 : noise;
		let nl = sm[4];
		if (patched[I_NOISE]) nl = clamp(s.noise_level + ins[I_NOISE] / 5, 0, 1.2) ** 2;
		const mix = o1 * sm[2] + o2 * sm[3] + src * nl;

		// ---- ladder filter, LP or HP, 2x oversampled ----
		const modSrc = patched[I_VCF_MOD] ? ins[I_VCF_MOD] / 5 : noise;
		let cutOct = sm[5] + this.vcfEg * vel * s.vcf_eg_amt * EG_CUTOFF_OCTAVES + modSrc * s.noise_vcf_mod * NOISE_MOD_OCTAVES;
		const fc = clamp(CUTOFF_MIN * Math.exp(cutOct * Math.LN2), 5, sampleRate * 0.45);
		const g = 1 - Math.exp(-this.twoPiOver2sr * fc);
		const input = mix * 0.5, fbk = this.fbk;
		let x = 0;
		for (let os = 0; os < 2; os++) {
			x = fastTanh(input - fbk * lp[3]);
			lp[0] += g * (x - lp[0]);
			lp[1] += g * (lp[0] - lp[1]);
			lp[2] += g * (lp[1] - lp[2]);
			lp[3] += g * (lp[2] - lp[3]);
		}
		// high pass from the same four poles: (1 - lowpass)^4
		const filtered = (s.vcf_mode === "hp" ? x - 4 * lp[0] + 6 * lp[1] - 4 * lp[2] + lp[3] : lp[3]) * this.resComp;

		// ---- VCA: the velocity scaled VCA EG, or the VCA CV input ----
		const vcaEg = this.vcaEg * vel;
		const vca = patched[I_VCA_CV] ? clamp(ins[I_VCA_CV] / 5, 0, 1.6) : vcaEg;
		const vcaOut = filtered * vca;

		outs[O_VCA] = vcaOut * 5;
		outs[O_VCA_EG] = vcaEg * 5;
		outs[O_VCF_EG] = this.vcfEg * vel * 5;
		outs[O_VCO_EG] = this.vcoEg * 5;
		outs[O_VCO1] = o1 * 5;
		outs[O_VCO2] = o2 * 5;
		outs[O_VEL] = s.velocity[this.step] * 5;
		outs[O_PITCH] = seqCv;
		if (this.trigPulse > 0) { outs[O_TRIG] = GATE_V; this.trigPulse--; }
		else outs[O_TRIG] = 0;
		const audio = vcaOut * sm[7] * 2;
		outs[O_AUDIO] = audio;
		return audio;
	}

	endBlock(n) {
		this.flash = Math.max(0, this.flash - n);
		if (this.vcoEg < 1e-7) this.vcoEg = 0;
		if (this.vcfEg < 1e-7) this.vcfEg = 0;
		if (this.vcaEg < 1e-7) this.vcaEg = 0;
	}

	state() {
		return {
			playing: this.playing,
			step: this.step,
			trig: this.flash > 0,
			freq: this.freq.slice(),
			vco_eg: this.vcoEg,
			vcf_eg: this.vcfEg * this.velocity,
			vca_eg: this.vcaEg * this.velocity
		};
	}
}
DramDSP.OUT_IDS = OUT_IDS;
DramDSP.IN_IDS = IN_IDS;
DramDSP.MIDI_IN = null; // no MIDI on the hardware: play it from the keys device with CV cables

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.dram = DramDSP;

})();
