// devices/reverb-worklet.js
// Reverb module, processor side. The convolution itself runs in native WebAudio nodes on the main
// thread (devices/reverb.js): this class only bridges the rear sockets to one of the rack processor's
// send / return slots. IN L / R go out on the slot's output, OUT L / R come back on its input one
// render quantum later. IN R is normalled to IN L.

(function(){

const IN_IDS = ["in_l","in_r"];
const OUT_IDS = ["out_l","out_r"];

class ReverbDSP {
	constructor() {
		this.s = null;
		this.host = null;    // the rack processor: sample index j within the block
		this.send = null;    // [L, R] Float32Arrays of the slot's output, set every block
		this.ret = null;     // [L, R] of the slot's input (null while nothing is connected)
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
	}

	message() {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }
	beginBlock() {}

	tick() {
		const j = this.host.j;
		const l = this.ins[0], r = this.patched[1] ? this.ins[1] : l;
		if (this.send) { this.send[0][j] = l; this.send[1][j] = r; }
		this.outs[0] = this.ret ? this.ret[0][j] : 0;
		this.outs[1] = this.ret ? this.ret[1][j] : 0;
		return 0;
	}

	endBlock() {}
	state() { return {}; }
}
ReverbDSP.OUT_IDS = OUT_IDS;
ReverbDSP.IN_IDS = IN_IDS;
ReverbDSP.MIDI_IN = null;
ReverbDSP.NATIVE = true; // gets a send / return slot

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.reverb = ReverbDSP;

})();
