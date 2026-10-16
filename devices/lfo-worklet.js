// devices/lfo-worklet.js
// Dual LFO DSP, hosted by the rack processor (rack-worklet.js): two LFOs with RATE (0.01..100 Hz,
// RATE CV 1V/oct), SHAPE, LEVEL and a SYNC input each (a gate restarts the cycle). Outputs +-5V.

(function(){

const IN_IDS = ["rate1","rate2","sync1","sync2"];
const OUT_IDS = ["lfo1","lfo2"];
const I_RATE = [0, 1], I_SYNC = [2, 3];
const SHAPES = { sine: 0, tri: 1, saw: 2, ramp: 3, square: 4, sh: 5 };
const GATE_THRESHOLD = 1;

class LfoDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.gateHigh = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.phase = [0, 0];
		this.hold = [Math.random() * 2 - 1, Math.random() * 2 - 1];
		this.value = [0, 0];
	}

	message() {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }
	beginBlock() { this.shape = [SHAPES[this.s.lfo[0].shape] || 0, SHAPES[this.s.lfo[1].shape] || 0]; }

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising;
	}

	tick() {
		const ins = this.ins, patched = this.patched;
		for (let i = 0; i < 2; i++) {
			const lfo = this.s.lfo[i];
			if (this.gateEdge(I_SYNC[i])) {
				this.phase[i] = 0;
				this.hold[i] = Math.random() * 2 - 1;
			}
			let rate = lfo.rate;
			if (patched[I_RATE[i]]) rate *= Math.exp(ins[I_RATE[i]] * Math.LN2);
			rate = rate < 0.001 ? 0.001 : (rate > 200 ? 200 : rate);
			let p = this.phase[i] + rate / sampleRate;
			if (p >= 1) {
				p -= Math.floor(p);
				this.hold[i] = Math.random() * 2 - 1;
			}
			this.phase[i] = p;
			let v;
			switch (this.shape[i]) {
				case 0: v = Math.sin(2 * Math.PI * p); break;
				case 1: v = 1 - 4 * Math.abs(p - 0.5); break;
				case 2: v = 1 - 2 * p; break;
				case 3: v = 2 * p - 1; break;
				case 4: v = p < 0.5 ? 1 : -1; break;
				default: v = this.hold[i];
			}
			this.value[i] = v * lfo.level;
			this.outs[i] = v * lfo.level * 5;
		}
		return 0;
	}

	endBlock() {}
	state() { return { lfo: this.value.slice() }; }
}
LfoDSP.OUT_IDS = OUT_IDS;
LfoDSP.IN_IDS = IN_IDS;
LfoDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.lfo = LfoDSP;

})();
