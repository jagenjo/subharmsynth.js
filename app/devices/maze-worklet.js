// devices/maze-worklet.js
// Maze DSP (a generative semi-modular synthesizer), hosted by the rack processor (rack-worklet.js): a parallel generative voice
// and two generative 8 bit sequencers.
//   voice: sine VCO and triangle MOD VCO (MOD VCO -> VCO FM, ring modulation, MOD VCO sync), a
//   saturating mixer with tone-adjustable noise, then two paths, a wavefolder (VCW) and a 2-pole
//   state-variable filter morphing LP -> BP (VCF), in parallel or in series either way (ORDER), each
//   with its VCA (EG2), mixed by BLEND. EG1 / EG2 are decay-only envelopes.
//   sequencers: 8 bits each, a random voltage stored in every bit flipped on; a trigger on each bit
//   that is on; CORRUPT rewrites the voltages (and above 12 o'clock flips bits) as the write head
//   passes; CV RANGE scales the voltages before the quantizer; CHAIN SEQ makes one 16 step sequence.
//
// The live pattern belongs to the DSP: it adopts the one in the settings when a patch is loaded
// (a new seq_id), and reports the live one in its state so the panel shows it and patches save it.

(function(){

const C4 = 261.6255653005986;

// must match the jack ids in devices/maze.js ("audio" is the AUDIO OUT socket on the back)
const IN_IDS = ["vco_pitch","mvco_sync","mvco_pitch","blend_in","vcw_in","fold_in","vcw_vca","vcf_in","cutoff_in","vcf_vca",
	"umix1","umix2","eg2_trig","clock1","bit_flip1","clock2","bit_flip2","trigger_in","reset_in"];
const OUT_IDS = ["vca","mvco","noise","mixer","eg1","eg2","umix_out","seq1_cv","seq1_trig","seq2_cv","seq2_trig","clock_out","audio"];
const I = {}; IN_IDS.forEach((id, k) => I[id] = k);
const O = {}; OUT_IDS.forEach((id, k) => O[id] = k);

const BITS = 8;
const GATE_THRESHOLD = 1;
const PULSE_TIME = 0.005;
const MIDI_CLOCK_TIMEOUT = 5;
const DECAY_TC = Math.log(1 / 0.01);

// quantizer scales (semitones of the octave); the first is unquantized
const SCALES = [
	null, [0,1,2,3,4,5,6,7,8,9,10,11], [0,2,4,5,7,9,11], [0,2,4,7,9], [0,2,3,5,7,9,11], [0,2,3,5,7,8,11],
	[0,2,3,5,6,8,9,11], [0,2,4,6,8,10], [0,2,3,7,8], [0,5,7,10], [0,4,7,11], [0,2,3,5,7,8,10], [0,3,7,10], [0,2,3,5,7,9,10], [0,2,3,7,9]
];

function quantize(v, scale) { // v in volts (octaves)
	if (!scale) return v;
	const o = Math.floor(v), r = (v - o) * 12;
	let best = 0, bd = 1e9;
	for (const d of scale.concat([12])) { const dd = Math.abs(r - d); if (dd < bd) { bd = dd; best = d; } }
	return o + best / 12;
}

function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

class MazeDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;

		this.ph = [0, 0];      // VCO, MOD VCO phases
		this.freq = [0, 0];
		this.lpN = 0; this.hpN = 0; // noise tone filters
		this.svf = [0, 0];     // VCF integrators
		this.eg = [0, 0];
		this.vel = [1, 1];
		this.smooth = null;

		this.seqId = null;
		this.seq = [0, 1].map(() => ({ bits: new Array(BITS).fill(false), cv: new Array(BITS).fill(0), length: BITS, out: 0 }));
		this.head = [0, 0];    // play heads (write heads move with them)
		this.chainHead = 0;
		this.trig = [0, 0];    // trigger pulses
		this.flash = [0, 0];
		this.playing = false;
		this.clockPhase = 0;
		this.clockPulse = 0;
		this.midiTicks = 0;
		this.midiCount = 0;
		this.lastMidiClock = -1e12;
		this.sampleCount = 0;
		this.midiPitch = 0;
		this.hold = false;     // TRIGGER button
		this.stepSamples = 6000;
	}

	message(m) {
		switch (m.type) {
			case "play": this.setPlaying(m.value === undefined ? !this.playing : !!m.value); break;
			case "reset": this.reset(); break;
			case "next": if (!this.playing) this.clockTick(true); break; // ADVANCE, only while stopped
			case "trigger": if (m.gate) this.fire(0, 1, true); break;
			case "flip": this.flip(m.seq, m.bit === undefined ? this.head[m.seq] : m.bit); break;
			case "shift": this.shift(m.seq); break;
			case "length": { const q = this.seq[m.seq]; q.length = q.length <= 1 ? BITS : q.length - 1; break; }
			case "pattern": this.adopt(m.pattern); break; // BUFFER recall
			case "midi":
				if (m.pitch !== undefined) this.midiPitch = m.pitch;
				if (m.retrigger) this.fire(0, 1, true);
				break;
			case "midiClock": this.midiTicks++; this.lastMidiClock = this.sampleCount; break;
			case "midiStart": this.reset(); this.midiCount = 0; this.setPlaying(true); break;
			case "midiStop": this.setPlaying(false); break;
			case "midiContinue": this.setPlaying(true); break;
		}
	}

	setSettings(s) {
		this.s = s;
		if (s.seq_id !== this.seqId) { this.seqId = s.seq_id; this.adopt(s.seq); }
	}

	setMidiConnected(c) { if (!c) this.midiPitch = 0; this.midiConnected = c; }

	adopt(pattern) {
		if (!pattern) return;
		for (let k = 0; k < 2; k++) {
			const p = pattern[k], q = this.seq[k];
			if (!p) continue;
			for (let i = 0; i < BITS; i++) { q.bits[i] = !!p.bits[i]; q.cv[i] = +p.cv[i] || 0; }
			q.length = clamp(p.length | 0, 1, BITS);
		}
	}

	setPlaying(v) {
		if (v && !this.playing) this.clockPhase = 1;
		this.playing = v;
	}

	reset() { this.head[0] = this.head[1] = 0; this.chainHead = 0; this.started = false; }

	flip(k, i) {
		const q = this.seq[k];
		q.bits[i] = !q.bits[i];
		if (q.bits[i]) q.cv[i] = Math.random() * 10 - 5; // a new random voltage
	}

	shift(k) { // rotate right within the length
		const q = this.seq[k], n = q.length;
		const b = q.bits[n - 1], v = q.cv[n - 1];
		for (let i = n - 1; i > 0; i--) { q.bits[i] = q.bits[i - 1]; q.cv[i] = q.cv[i - 1]; }
		q.bits[0] = b; q.cv[0] = v;
	}

	// CORRUPT as the write head passes: new voltages below 12 o'clock, also bit flips above
	corrupt(k, i, amount) {
		const q = this.seq[k];
		const pv = Math.min(1, amount * 2) * 0.5;
		if (Math.random() < pv) q.cv[i] = Math.random() * 10 - 5;
		if (amount > 0.5 && Math.random() < (amount - 0.5) * 2 * 0.35) this.flip(k, i);
	}

	// EG triggers: EG TRIG MIX balances SEQ1 against SEQ2 (velocities)
	fire(k, vel, both) {
		const s = this.s;
		const v = both ? 1 : vel;
		if (v <= 0.001) return;
		this.eg[0] = Math.max(this.eg[0], v); this.vel[0] = v;
		if (!this.patched[I.eg2_trig]) { this.eg[1] = Math.max(this.eg[1], v); this.vel[1] = v; }
	}

	stepSeq(k, s) {
		const q = this.seq[k];
		if (this.started) this.head[k] = (this.head[k] + 1) % q.length;
		if (this.head[k] >= q.length) this.head[k] = 0;
		this.play(k, k, this.head[k], s);
	}

	// plays bit i of sequencer `src` on the outputs of sequencer k
	play(k, src, i, s) {
		const q = this.seq[src];
		if (s.corrupt[src] > 0.001) this.corrupt(src, i, s.corrupt[src]);
		this.flash[k] = Math.round(0.06 * sampleRate);
		if (q.bits[i]) {
			this.seq[k].out = q.cv[i];
			this.trig[k] = Math.round(PULSE_TIME * sampleRate);
			const mix = s.eg_trig_mix; // 0: SEQ1 only, 1: SEQ2 only
			const vel = k === 0 ? Math.min(1, 2 * (1 - mix)) : Math.min(1, 2 * mix);
			this.fire(k, vel, false);
		}
	}

	// one clock: both sequencers (or the chained 16 steps)
	clockTick(both) {
		const s = this.s;
		this.clockPulse = Math.round(PULSE_TIME * sampleRate);
		if (s.chain) {
			const n = this.seq[0].length + this.seq[1].length;
			if (this.started) this.chainHead = (this.chainHead + 1) % n;
			const p = this.chainHead, src = p < this.seq[0].length ? 0 : 1, i = src ? p - this.seq[0].length : p;
			this.head[src] = i;
			this.play(0, src, i, s);
			this.play(1, src, i, s);
		}
		else if (both) {
			this.stepSeq(0, s);
			this.stepSeq(1, s);
		}
		this.started = true;
	}

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising;
	}

	beginBlock(n) {
		const s = this.s, sr = sampleRate;
		const t = [s.vco_lvl, s.mvco_lvl, s.ring_lvl, s.noise_lvl, s.fold, s.bias, s.blend, s.volume * s.volume,
			Math.log2(clamp(s.cutoff, 20, 20000) / 20), s.resonance, s.filter_type];
		if (!this.smooth) this.smooth = t.slice();
		for (let i = 0; i < t.length; i++) this.smooth[i] += (t[i] - this.smooth[i]) * 0.3;
		this.dec = [Math.exp(-DECAY_TC / (Math.max(s.eg1_decay, 0.005) * sr)), Math.exp(-DECAY_TC / (Math.max(s.eg2_decay, 0.005) * sr))];
		this.stepSamples = sr * 60 / (Math.max(1, s.tempo) * 4); // a clock per 16th
		this.scale = SCALES[s.quantize] || null;
		this.toneLp = 1 - Math.exp(-2 * Math.PI * 600 / sr);
		this.toneHp = 1 - Math.exp(-2 * Math.PI * 3000 / sr);

		this.midiClock = (this.sampleCount - this.lastMidiClock) < MIDI_CLOCK_TIMEOUT * sr;
		if (this.midiClock) {
			for (; this.midiTicks > 0; this.midiTicks--) {
				if (this.playing && this.midiCount % 6 === 0) this.clockTick(true);
				this.midiCount++;
			}
		}
		this.midiTicks = 0;
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, patched = this.patched, sm = this.smooth, sr = sampleRate;

		// ---- clocks: internal (TEMPO or MIDI) normalled to CLOCK 1, CLOCK 1 normalled to CLOCK 2 ----
		let internal = false;
		if (this.playing && !this.midiClock) {
			this.clockPhase += 1 / this.stepSamples;
			if (this.clockPhase >= 1) { this.clockPhase -= Math.floor(this.clockPhase); internal = true; }
		}
		if (internal) this.clockPulse = Math.round(PULSE_TIME * sampleRate);
		const e1 = this.gateEdge(I.clock1), e2 = this.gateEdge(I.clock2);
		if (s.chain) {
			if (patched[I.clock1] ? (this.playing && e1) : internal) this.clockTick(false);
		}
		else {
			const c1 = patched[I.clock1] ? (this.playing && e1) : internal;
			const c2 = patched[I.clock2] ? (this.playing && e2) : c1;
			if (c1) this.stepSeq(0, s);
			if (c2) this.stepSeq(1, s);
			if (c1 || c2) this.started = true;
		}
		if (this.gateEdge(I.bit_flip1)) this.flip(0, this.head[0]);
		if (this.gateEdge(I.bit_flip2)) this.flip(1, this.head[1]);
		if (this.gateEdge(I.reset_in)) this.reset();
		if (this.gateEdge(I.trigger_in)) { this.eg[0] = 1; this.vel[0] = 1; if (!patched[I.eg2_trig]) { this.eg[1] = 1; this.vel[1] = 1; } }
		if (this.gateEdge(I.eg2_trig)) { this.eg[1] = 1; this.vel[1] = 1; }

		// sequencer CVs: stored voltage x CV RANGE, quantized
		const cv1 = quantize(this.seq[0].out * s.cv_range[0], this.scale);
		const cv2 = quantize(this.seq[1].out * s.cv_range[1], this.scale);

		// ---- envelopes: decay only ----
		const eg1 = this.eg[0], eg2 = this.eg[1];
		this.eg[0] *= this.dec[0];
		this.eg[1] *= this.dec[1];

		// ---- oscillators ----
		let pm = Math.log2(s.mvco_freq / C4) + s.mvco_eg1 * eg1 * 4 + cv2 * s.mvco_seq2;
		if (patched[I.mvco_pitch]) pm += ins[I.mvco_pitch];
		const fm = C4 * Math.exp(pm * Math.LN2);
		if (patched[I.mvco_sync] && ins[I.mvco_sync] > GATE_THRESHOLD) this.ph[1] = 0;
		else { this.ph[1] += clamp(fm / sr, 0, 0.45); if (this.ph[1] >= 1) this.ph[1] -= 1; }
		const tri = 1 - 4 * Math.abs(this.ph[1] - 0.5);
		let pv = Math.log2(s.vco_freq / C4) + s.vco_eg1 * eg1 * 4 + cv1 * s.vco_seq1 + this.midiPitch;
		if (patched[I.vco_pitch]) pv += ins[I.vco_pitch];
		let fv = C4 * Math.exp(pv * Math.LN2);
		fv *= 1 + tri * s.fm_amt * 2.5; // MOD VCO -> VCO linear FM
		this.ph[0] += clamp(fv / sr, -0.45, 0.45);
		this.ph[0] -= Math.floor(this.ph[0]);
		const sine = Math.sin(2 * Math.PI * this.ph[0]);
		this.freq[0] = fv; this.freq[1] = fm;
		const ring = sine * tri;

		// ---- saturating mixer: channels overdrive above 12 o'clock ----
		const white = Math.random() * 2 - 1;
		this.lpN += (white - this.lpN) * this.toneLp;
		this.hpN += (white - this.hpN) * this.toneHp;
		const noise = this.lpN * 2.5 * (1 - s.noise_tone) + (white - this.hpN) * s.noise_tone;
		const ch = (x, lvl) => fastTanh(x * lvl * 2);
		const mixer = fastTanh(ch(sine, sm[0]) + ch(tri, sm[1]) + ch(ring, sm[2]) + ch(noise, sm[3])) * 0.8;

		// ---- VCW and VCF, parallel or in series ----
		const foldSrc = patched[I.fold_in] ? ins[I.fold_in] / 5 : eg1; // EG1 normalled, EG1/CV AMT attenuates
		const fold = clamp(sm[4] + foldSrc * s.vcw_eg1 + cv1 / 5 * s.vcw_seq1, 0, 1.5);
		const cutSrc = patched[I.cutoff_in] ? ins[I.cutoff_in] / 5 : eg1;
		let cutOct = sm[8] + cutSrc * s.vcf_eg1 * 7 + cv2 * s.vcf_seq2;
		const fc = clamp(20 * Math.exp(cutOct * Math.LN2), 10, sr * 0.2);
		const wavefold = (x) => {
			const g = 1 + fold * 6;
			return Math.sin((x * g + sm[5]) * Math.PI * 0.5) * 0.9;
		};
		const filter = (x) => {
			// 2-pole state-variable (Chamberlin, 2x per sample for stability), LP morphing to BP
			const f = 2 * Math.sin(Math.PI * fc / (2 * sr));
			const q = 2 - sm[9] * 1.97;
			let lp = 0, bp = 0;
			for (let k = 0; k < 2; k++) {
				const hp = x - this.svf[0] - q * this.svf[1];
				this.svf[1] += f * hp;
				this.svf[0] += f * this.svf[1];
				this.svf[1] = fastTanh(this.svf[1]); // keeps it bounded at full resonance
			}
			lp = this.svf[0]; bp = this.svf[1];
			return lp * (1 - sm[10]) + bp * sm[10] * 1.5;
		};
		const vcwIn = patched[I.vcw_in] ? ins[I.vcw_in] / 5 : mixer;
		const vcfIn = patched[I.vcf_in] ? ins[I.vcf_in] / 5 : mixer;
		let w, f;
		if (s.order === "vcw_vcf") { w = wavefold(vcwIn); f = filter(patched[I.vcf_in] ? vcfIn : w); }
		else if (s.order === "vcf_vcw") { f = filter(vcfIn); w = wavefold(patched[I.vcw_in] ? vcwIn : f); }
		else { w = wavefold(vcwIn); f = filter(vcfIn); }

		// ---- VCAs (EG2 normalled to both), BLEND ----
		const vw = patched[I.vcw_vca] ? clamp(ins[I.vcw_vca] / 5, 0, 1.6) : eg2;
		const vf = patched[I.vcf_vca] ? clamp(ins[I.vcf_vca] / 5, 0, 1.6) : eg2;
		let b = sm[6];
		if (patched[I.blend_in]) b += ins[I.blend_in] / 5;
		b = clamp(b, 0, 1);
		const out = w * vw * (1 - b) + f * vf * b;

		// ---- utility mixer: U MIX 1 (RING normalled) at its level, plus U MIX 2 at unity ----
		const u1 = patched[I.umix1] ? ins[I.umix1] : ring * 5;
		const u2 = patched[I.umix2] ? ins[I.umix2] : 0;

		outs[O.vca] = out * 5;
		outs[O.mvco] = tri * 5;
		outs[O.noise] = noise * 5;
		outs[O.mixer] = mixer * 5;
		outs[O.eg1] = eg1 * 8;
		outs[O.eg2] = eg2 * 8;
		outs[O.umix_out] = u1 * s.umix1_lvl + u2;
		outs[O.seq1_cv] = cv1;
		outs[O.seq2_cv] = cv2;
		for (let k = 0; k < 2; k++) {
			outs[k ? O.seq2_trig : O.seq1_trig] = this.trig[k] > 0 ? 5 : 0;
			if (this.trig[k] > 0) this.trig[k]--;
		}
		outs[O.clock_out] = this.clockPulse > 0 ? 5 : 0;
		if (this.clockPulse > 0) this.clockPulse--;
		const audio = out * sm[7] * 1.6;
		outs[O.audio] = audio;
		return audio;
	}

	endBlock(n) {
		this.sampleCount += n;
		this.flash[0] = Math.max(0, this.flash[0] - n);
		this.flash[1] = Math.max(0, this.flash[1] - n);
	}

	state() {
		return {
			playing: this.playing, head: this.head.slice(), chain_head: this.chainHead,
			seq: this.seq.map(q => ({ bits: q.bits.slice(), cv: q.cv.map(v => Math.round(v * 1000) / 1000), length: q.length })),
			eg: this.eg.slice(), freq: this.freq.slice(), clock: this.flash[0] > 0 || this.flash[1] > 0
		};
	}
}
MazeDSP.OUT_IDS = OUT_IDS;
MazeDSP.IN_IDS = IN_IDS;
MazeDSP.MIDI_IN = "midi_in";

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.maze = MazeDSP;

})();
