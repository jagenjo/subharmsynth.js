// devices/hyper-worklet.js
// HYPER DSP, hosted by the rack processor: a lo-fi stereo distortion and bit crusher, after the
// warm, broken-console sound of indie game soundtracks:
//   WOBBLE (tape wow and flutter: a modulated short delay) -> DRIVE through a TYPE of saturation
//   (TAPE, TUBE, FUZZ, FOLD) -> TONE (low pass) -> RATE (sample rate reduction, aliasing included)
//   -> BITS (1-16, continuous) -> MIX with the dry signal.
// CV: DRIVE (+-5 V = the whole range), BITS (1 V = -3 bits), RATE (1 V/oct). Audio on the back.

(function(){

const IN_IDS = ["in_l", "in_r", "drive_in", "bits_in", "rate_in"];
const OUT_IDS = ["out_l", "out_r"];
const I_L = 0, I_R = 1, I_DRIVE = 2, I_BITS = 3, I_RATE = 4;
const WOB = 2048; // wobble delay line (samples)
const TYPES = { tape: 0, tube: 1, fuzz: 2, fold: 3 };

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

class HyperDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.wl = new Float32Array(WOB); this.wr = new Float32Array(WOB); this.wp = 0;
		this.wow = 0; this.flutter = 0;
		this.toneL = 0; this.toneR = 0;
		this.ratePh = 0; this.holdL = 0; this.holdR = 0;
		this.dcL = 0; this.dcR = 0;
	}

	message() {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	beginBlock() {
		const s = this.s, sr = sampleRate, ins = this.ins, p = this.patched;
		const drive = clamp(s.drive + (p[I_DRIVE] ? ins[I_DRIVE] / 5 : 0), 0, 1);
		this.gain = 1 + drive * drive * 60;                     // up to +36 dB into the saturation
		this.makeup = 1 / (1 + drive * 2.2);
		this.type = TYPES[s.type] || 0;
		this.tone = 1 - Math.exp(-2 * Math.PI * Math.min(s.tone, sr * 0.45) / sr);
		this.bits = clamp(s.bits - (p[I_BITS] ? ins[I_BITS] * 3 : 0), 1, 16);
		this.levels = Math.pow(2, this.bits - 1);
		this.rate = clamp(s.rate * Math.pow(2, p[I_RATE] ? ins[I_RATE] : 0), 100, sr);
		this.wobDepth = s.wobble * s.wobble * 0.004 * sr;      // up to 4 ms of pitch-bending delay
	}

	shape(x) {
		switch (this.type) {
			case 1: return fastTanh(x + 0.3) - 0.2913;            // TUBE: asymmetric, even harmonics
			case 2: return clamp(x * 1.5, -0.8, 0.8) * 1.2;       // FUZZ: hard clipping
			case 3: {                                             // FOLD: the wave folds back on itself
				let y = x * 0.5 + 0.25;
				y = y - Math.floor(y);
				return (y < 0.5 ? 4 * y - 1 : 3 - 4 * y);
			}
			default: return fastTanh(x);                          // TAPE: soft
		}
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, sr = sampleRate;
		const xl = ins[I_L], xr = this.patched[I_R] ? ins[I_R] : xl;
		if (!s.on) { outs[0] = xl; outs[1] = xr; return 0; }

		// WOBBLE: wow (slow) and flutter (fast) move the read point of a short delay
		let l = xl, r = xr;
		this.wl[this.wp] = xl; this.wr[this.wp] = xr;
		if (this.wobDepth > 0.5) {
			this.wow += 0.55 / sr; if (this.wow >= 1) this.wow -= 1;
			this.flutter += 6.3 / sr; if (this.flutter >= 1) this.flutter -= 1;
			const d = 8 + this.wobDepth * (1 + Math.sin(2 * Math.PI * this.wow) * 0.8 + Math.sin(2 * Math.PI * this.flutter) * 0.2);
			let p = this.wp - d; if (p < 0) p += WOB;
			const i = p | 0, f = p - i, j = (i + 1) % WOB;
			l = this.wl[i] + (this.wl[j] - this.wl[i]) * f;
			r = this.wr[i] + (this.wr[j] - this.wr[i]) * f;
		}
		this.wp = (this.wp + 1) % WOB;

		// DRIVE through the saturation, then TONE
		l = this.shape(l * this.gain) * this.makeup;
		r = this.shape(r * this.gain) * this.makeup;
		this.dcL += (l - this.dcL) * 0.0005; this.dcR += (r - this.dcR) * 0.0005; // DC blocker (TUBE, FOLD shift it)
		l -= this.dcL; r -= this.dcR;
		this.toneL += (l - this.toneL) * this.tone;
		this.toneR += (r - this.toneR) * this.tone;
		l = this.toneL; r = this.toneR;

		// RATE: sample and hold (no anti-aliasing: the aliasing is the sound); BITS: fewer levels
		this.ratePh += this.rate / sr;
		if (this.ratePh >= 1) { this.ratePh -= Math.floor(this.ratePh); this.holdL = l; this.holdR = r; }
		if (this.rate < sr * 0.999) { l = this.holdL; r = this.holdR; }
		if (this.bits < 15.99) {
			const q = this.levels;
			l = Math.round(l * q) / q; r = Math.round(r * q) / q;
		}

		// MIX, OUTPUT
		const m = s.mix;
		outs[0] = (xl * (1 - m) + l * m) * s.output;
		outs[1] = (xr * (1 - m) + r * m) * s.output;
		return 0;
	}

	endBlock() {}
	state() { return { bits: this.bits, rate: this.rate }; }
}
HyperDSP.OUT_IDS = OUT_IDS;
HyperDSP.IN_IDS = IN_IDS;
HyperDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.hyper = HyperDSP;

})();
