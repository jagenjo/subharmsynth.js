// devices/reroute-worklet.js
// REROUTE DSP: 8 channels; what comes into a front socket goes out of the same channel's socket on
// the back, and what comes into a back socket goes out of the same channel's front socket
(function(){

const N = 8;
const IN_IDS = [], OUT_IDS = [];
for (let i = 0; i < N; i++) { IN_IDS.push("f_in" + i); OUT_IDS.push("f_out" + i); }
for (let i = 0; i < N; i++) { IN_IDS.push("r_in" + i); OUT_IDS.push("r_out" + i); }

class RerouteDSP {
	constructor() {
		this.s = null;
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
		const ins = this.ins, outs = this.outs;
		for (let i = 0; i < N; i++) {
			outs[N + i] = ins[i];      // front in -> back out
			outs[i] = ins[N + i];      // back in -> front out
		}
		return 0;
	}
	endBlock() {}
	state() { return null; }
}
RerouteDSP.OUT_IDS = OUT_IDS;
RerouteDSP.IN_IDS = IN_IDS;
RerouteDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.reroute = RerouteDSP;

})();
