// devices/comp-worklet.js
// Stereo compressor DSP (linked detector, 6 dB soft knee, parallel MIX), hosted by the rack processor,
// with its small oscilloscope. Audio IN / OUT L / R on the back (IN R normalled to IN L); on the front
// the SIDECHAIN input (+-5V, replaces the detector), the GR output (4 dB per volt) and the SCOPE input
// (+-5V full scale; unpatched, the scope shows the compressor's output).

(function(){

const IN_IDS = ["in_l","in_r","sidechain","scope"];
const OUT_IDS = ["out_l","out_r","gr"];
const I_L = 0, I_R = 1, I_SC = 2, I_SCOPE = 3;
const O_L = 0, O_R = 1, O_GR = 2;
const DB_TO_LN = Math.LN10 / 20;
const SCOPE_RING = 1024;     // columns kept, power of two
const SCOPE_POINTS = 256;    // columns shown
const SCOPE_ROLL_TIME = 0.2; // time bases above this scroll instead of triggering

class CompDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.env = 0;
		this.grPeak = 0;
		this.scopeMin = new Float32Array(SCOPE_RING);
		this.scopeMax = new Float32Array(SCOPE_RING);
		this.scopePos = 0;
		this.scopeCount = 0;
		this.scopeTime = 0;
		this.scopeBucket = 1;
		this.scopeLo = 0;
		this.scopeHi = 0;
	}

	message() {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	beginBlock() {
		const c = this.s, sr = sampleRate;
		this.atk = 1 - Math.exp(-1 / (Math.max(c.attack, 0.0001) * sr));
		this.rel = 1 - Math.exp(-1 / (Math.max(c.release, 0.001) * sr));
		this.slope = 1 - 1 / Math.max(c.ratio, 1);
		this.makeup = Math.exp(c.makeup * DB_TO_LN);
	}

	tick() {
		const c = this.s, ins = this.ins, outs = this.outs, patched = this.patched;
		let l = ins[I_L];
		let r = patched[I_R] ? ins[I_R] : l;
		if (c.on) {
			let det = patched[I_SC] ? ins[I_SC] / 5 : Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
			if (det < 0) det = -det;
			this.env += (det > this.env ? this.atk : this.rel) * (det - this.env);
			const over = 20 * Math.log10(this.env + 1e-9) - c.threshold;
			let gr = 0; // gain reduction in dB
			if (over > 3) gr = over * this.slope;
			else if (over > -3) gr = this.slope * (over + 3) * (over + 3) / 12;
			const g = (1 - c.mix) + c.mix * Math.exp(-gr * DB_TO_LN) * this.makeup;
			l *= g;
			r *= g;
			outs[O_GR] = Math.min(10, Math.max(0, gr / 4));
			if (gr > this.grPeak) this.grPeak = gr;
		}
		else
			outs[O_GR] = 0;
		outs[O_L] = l;
		outs[O_R] = r;
		this.scopeFeed(patched[I_SCOPE] ? ins[I_SCOPE] / 5 : (l + r) * 0.5, c.scope_time);
		return 0;
	}

	endBlock() {}

	// one min/max pair per bucket of samples, bucket size from the time base
	scopeFeed(v, timeBase) {
		if (timeBase !== this.scopeTime) {
			this.scopeTime = timeBase;
			this.scopeBucket = Math.max(1, Math.round(timeBase * sampleRate / SCOPE_POINTS));
			this.scopeMin.fill(0);
			this.scopeMax.fill(0);
			this.scopeCount = 0;
		}
		if (this.scopeCount === 0) { this.scopeLo = v; this.scopeHi = v; }
		else { if (v < this.scopeLo) this.scopeLo = v; if (v > this.scopeHi) this.scopeHi = v; }
		if (++this.scopeCount >= this.scopeBucket) {
			this.scopeMin[this.scopePos] = this.scopeLo;
			this.scopeMax[this.scopePos] = this.scopeHi;
			this.scopePos = (this.scopePos + 1) & (SCOPE_RING - 1);
			this.scopeCount = 0;
		}
	}

	// SCOPE_POINTS columns: triggered on a rising crossing of the signal's middle level for
	// short time bases, rolling (newest on the right) for long ones
	scopeSnapshot() {
		const mask = SCOPE_RING - 1, n = SCOPE_POINTS;
		let start = (this.scopePos - n + SCOPE_RING) & mask;
		if (this.scopeTime <= SCOPE_ROLL_TIME) {
			const from = (this.scopePos - 2 * n + SCOPE_RING) & mask;
			let lo = Infinity, hi = -Infinity;
			for (let k = 0; k < 2 * n; k++) {
				const i = (from + k) & mask;
				if (this.scopeMin[i] < lo) lo = this.scopeMin[i];
				if (this.scopeMax[i] > hi) hi = this.scopeMax[i];
			}
			const level = (lo + hi) * 0.5;
			for (let k = 1; k < n; k++) {
				const i = (from + k) & mask, j = (i - 1) & mask;
				const prev = (this.scopeMin[j] + this.scopeMax[j]) * 0.5, cur = (this.scopeMin[i] + this.scopeMax[i]) * 0.5;
				if (prev < level && cur >= level && hi - lo > 1e-4) { start = i; break; }
			}
		}
		const min = new Float32Array(n), max = new Float32Array(n);
		for (let k = 0; k < n; k++) {
			min[k] = this.scopeMin[(start + k) & mask];
			max[k] = this.scopeMax[(start + k) & mask];
		}
		return { min: min, max: max, input: this.patched[I_SCOPE] === 1 };
	}

	// gain reduction peak since the last report, and the scope
	state() {
		const st = { gr: this.grPeak, scope: this.scopeSnapshot() };
		this.grPeak = 0;
		return st;
	}
}
CompDSP.OUT_IDS = OUT_IDS;
CompDSP.IN_IDS = IN_IDS;
CompDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.comp = CompDSP;

})();
