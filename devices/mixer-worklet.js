// devices/mixer-worklet.js
// 6 channel line mixer DSP, hosted by the rack processor (rack-worklet.js).
// Per channel: mono input (rear), fader, LEVEL CV (front, a VCA: 5V = the fader's level),
// balance pan, post-fader aux send, mute and solo. AUX RETURN L / R (R normalled to L) is mixed
// back into the main bus, then the master fader. Audio sockets are line level (+-1), the front
// MIX output is the mono main mix at +-5V for the CV patch bay.

(function(){

const CHANNELS = 6;
// in1..in6, aux_ret_l, aux_ret_r on the back; cv1..cv6 on the front
const IN_IDS = ["in1","in2","in3","in4","in5","in6","aux_ret_l","aux_ret_r","cv1","cv2","cv3","cv4","cv5","cv6"];
const OUT_IDS = ["main_l","main_r","aux_send","mix"];
const I_RET_L = 6, I_RET_R = 7, I_CV = 8;
const O_MAIN_L = 0, O_MAIN_R = 1, O_AUX = 2, O_MIX = 3;

// fader position 0..1 -> gain: 0.75 is unity, the top is +7.5 dB
function faderGain(pos) { const g = pos / 0.75; return g * g * g; }
// knob 0..1 -> gain: unity at 0.75 too, for the aux and return levels
function knobGain(v) { const g = v / 0.75; return g * g; }

class MixerDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.gain = new Float32Array(CHANNELS); // smoothed channel gains
		this.gl = new Float32Array(CHANNELS);   // per block targets: main left / right, aux
		this.gr = new Float32Array(CHANNELS);
		this.ga = new Float32Array(CHANNELS);
		this.peak = new Float32Array(CHANNELS); // since the last state report
		this.peakMain = [0, 0];
		this.master = 0;
		this.ret = 0;
		this.auxMaster = 0;
	}

	message() {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	beginBlock() {
		const s = this.s;
		const solo = s.ch.some(c => c.solo);
		for (let i = 0; i < CHANNELS; i++) {
			const c = s.ch[i];
			const on = !c.mute && (!solo || c.solo);
			const target = on ? faderGain(c.level) : 0;
			this.gain[i] += (target - this.gain[i]) * 0.3;
			// balance: centre keeps both sides at full level
			this.gl[i] = Math.min(1, 1 - c.pan);
			this.gr[i] = Math.min(1, 1 + c.pan);
			this.ga[i] = knobGain(c.aux);
		}
		this.master += (faderGain(s.master) - this.master) * 0.3;
		this.ret += (knobGain(s.aux_return) - this.ret) * 0.3;
		this.auxMaster += (knobGain(s.aux_send) - this.auxMaster) * 0.3;
	}

	tick() {
		const ins = this.ins, outs = this.outs, patched = this.patched;
		let l = 0, r = 0, aux = 0;
		for (let i = 0; i < CHANNELS; i++) {
			let g = this.gain[i];
			if (patched[I_CV + i]) {
				const cv = ins[I_CV + i] / 5;
				g *= cv < 0 ? 0 : (cv > 1.5 ? 1.5 : cv);
			}
			const v = ins[i] * g;
			const a = v < 0 ? -v : v;
			if (a > this.peak[i]) this.peak[i] = a;
			l += v * this.gl[i];
			r += v * this.gr[i];
			aux += v * this.ga[i]; // post fader
		}
		const retL = ins[I_RET_L];
		const retR = patched[I_RET_R] ? ins[I_RET_R] : retL;
		l = (l + retL * this.ret) * this.master;
		r = (r + retR * this.ret) * this.master;
		outs[O_MAIN_L] = l;
		outs[O_MAIN_R] = r;
		outs[O_AUX] = aux * this.auxMaster;
		outs[O_MIX] = (l + r) * 2.5;
		const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
		if (al > this.peakMain[0]) this.peakMain[0] = al;
		if (ar > this.peakMain[1]) this.peakMain[1] = ar;
		return 0;
	}

	endBlock() {}

	// peaks since the last report (they reset here)
	state() {
		const st = { level: Array.from(this.peak), main: this.peakMain.slice() };
		this.peak.fill(0);
		this.peakMain[0] = this.peakMain[1] = 0;
		return st;
	}
}
MixerDSP.OUT_IDS = OUT_IDS;
MixerDSP.IN_IDS = IN_IDS;
MixerDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.mixer = MixerDSP;

})();
