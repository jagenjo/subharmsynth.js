// devices/delay-worklet.js
// Stereo delay DSP, hosted by the rack processor: two delay lines with a lowpass (TONE) in the feedback,
// feeding back into themselves (normal) or into each other (PING-PONG, starting from the mono sum on
// the left). TIME is free (10 ms..2 s) or a division of the rack's tempo (SYNC). Off = bypassed;
// DRY off = 100% wet, for an aux send. Audio IN / OUT L / R on the back, IN R normalled to IN L.

(function(){

const IN_IDS = ["in_l","in_r"];
const OUT_IDS = ["out_l","out_r"];
// must match WR.DELAY_DIVS in webrack.js: quarter notes
const DIVS = [0.25, 1/3, 0.5, 0.75, 2/3, 1, 1.5, 2, 4];
const MAX_TIME = 5;

class DelayDSP {
	constructor() {
		this.s = null;
		this.host = null; // the rack processor: tempo for SYNC
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.size = Math.ceil(MAX_TIME * sampleRate) + 4;
		this.bufL = new Float32Array(this.size);
		this.bufR = new Float32Array(this.size);
		this.pos = 0;
		this.cur = -1;   // delay time in samples, glides to the target
		this.lpL = 0;
		this.lpR = 0;
		this.cleared = true;
	}

	message() {}
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	time() {
		const s = this.s;
		if (s.sync) {
			const bpm = this.host && this.host.tempo > 0 ? this.host.tempo : 120;
			return Math.min(MAX_TIME - 0.1, (60 / bpm) * DIVS[Math.max(0, Math.min(DIVS.length - 1, s.div | 0))]);
		}
		return Math.min(MAX_TIME - 0.1, Math.max(0.001, s.time));
	}

	beginBlock() {
		const s = this.s;
		this.target = this.time() * sampleRate;
		if (this.cur < 0) this.cur = this.target;
		this.glide = 1 - Math.exp(-1 / (0.05 * sampleRate));
		this.tone = 1 - Math.exp(-2 * Math.PI * Math.min(s.tone, sampleRate * 0.45) / sampleRate);
		this.fb = Math.min(0.95, Math.max(0, s.feedback));
	}

	read(buf, d) {
		let p = this.pos - d;
		while (p < 0) p += this.size;
		let i = p | 0;
		if (i >= this.size) i -= this.size; // p a hair under 0, wrapped, rounds to size
		const f = p - Math.floor(p);
		const a = buf[i], b = buf[i + 1 < this.size ? i + 1 : 0];
		return a + (b - a) * f;
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs;
		const xl = ins[0], xr = this.patched[1] ? ins[1] : xl;
		if (!s.on) {
			// bypassed: dry through, the lines are cleared once so the echoes don't come back later
			if (!this.cleared) { this.bufL.fill(0); this.bufR.fill(0); this.lpL = this.lpR = 0; this.cleared = true; }
			outs[0] = xl;
			outs[1] = xr;
			return 0;
		}
		this.cleared = false;
		this.cur += (this.target - this.cur) * this.glide;
		const d = this.cur < 1 ? 1 : this.cur;
		this.lpL += (this.read(this.bufL, d) - this.lpL) * this.tone;
		this.lpR += (this.read(this.bufR, d) - this.lpR) * this.tone;
		const wl = this.lpL, wr = this.lpR, fb = this.fb;
		if (s.pingpong) {
			this.bufL[this.pos] = (xl + xr) * 0.5 + wr * fb;
			this.bufR[this.pos] = wl * fb;
		}
		else {
			this.bufL[this.pos] = xl + wl * fb;
			this.bufR[this.pos] = xr + wr * fb;
		}
		if (++this.pos >= this.size) this.pos = 0;
		const dry = s.dry ? 1 : 0;
		outs[0] = xl * dry + wl * s.mix;
		outs[1] = xr * dry + wr * s.mix;
		return 0;
	}

	endBlock() {}
	state() { return { time: this.cur / sampleRate }; }
}
DelayDSP.OUT_IDS = OUT_IDS;
DelayDSP.IN_IDS = IN_IDS;
DelayDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.delay = DelayDSP;

})();
