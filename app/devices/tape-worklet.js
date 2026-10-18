// devices/tape-worklet.js
// TAPE DSP, hosted by the rack processor: a stereo tape machine for hazy, nostalgic, wobbly sound.
//   the tape: a delay line read at a moving point: WOW (slow, uneven pitch drift), FLUTTER (fast),
//   the two sides drifting a little apart; STOP winds the tape down to a halt (the pitch falls) and
//   starts it again -> SATURATE (tape compression, a little asymmetric) -> the head bump (low end) ->
//   TONE (the tape's high cut, 12 dB) -> AGE (dropouts: the level dips and darkens now and then) ->
//   HISS -> MIX with the dry signal -> OUTPUT.
//   MACHINE: CASSETTE (dark, slow wow), REEL (clean, a big head bump), VHS (warbly, bright hiss).
// CV: WOW (+-5 V = the whole range), TONE (1 V/oct), STOP (a gate). Audio on the back.

(function(){

const IN_IDS = ["in_l", "in_r", "wow_in", "tone_in", "stop_in"];
const OUT_IDS = ["out_l", "out_r"];
const I_L = 0, I_R = 1, I_WOW = 2, I_TONE = 3, I_STOP = 4;
const MACHINES = {
	cassette: { tone: 0.75, bump: 0.5, bumpHz: 70,  wowHz: 0.45, flutHz: 7.5, spread: 0.25, hissTone: 0.25 },
	reel:     { tone: 1.0,  bump: 1.0, bumpHz: 110, wowHz: 0.3,  flutHz: 12,  spread: 0.15, hissTone: 0.15 },
	vhs:      { tone: 0.6,  bump: 0.3, bumpHz: 90,  wowHz: 1.2,  flutHz: 5.5, spread: 0.45, hissTone: 0.55 }
};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

class TapeDSP {
	constructor() {
		this.s = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		const sr = sampleRate;
		this.N = Math.round(sr * 6);                   // 6 s of tape: room for a stop's lag
		this.bl = new Float32Array(this.N); this.br = new Float32Array(this.N);
		this.wp = 0;
		this.base = Math.round(sr * 0.012);           // the read point's place behind the write point
		this.wowPh = 0; this.flutPh = 0; this.rnd = 0; this.rndT = 0; this.rndLeft = 0; this.jit = 0;
		// STOP: the tape's speed, the read point while it is not at its place
		this.speed = 1; this.stopped = false; this.free = false; this.rp = 0; this.resync = 0;
		this.stopHigh = false; this.btn = false;
		this.f = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]; // per side: tone LP 1, 2, bump LP 1, 2, DC, hiss LP
		this.drop = 1; this.dropT = 1; this.dropLeft = 0;
		this.mod = 0;
	}

	message(m) { if (m.type === "stop") this.btn = !!m.on; }
	setSettings(s) { this.s = s; }
	setMidiConnected(c) { this.midiConnected = c; }

	beginBlock() {
		const s = this.s, sr = sampleRate, p = this.patched, ins = this.ins;
		const mc = MACHINES[s.machine] || MACHINES.cassette;
		this.mc = mc;
		const wow = clamp(s.wow + (p[I_WOW] ? ins[I_WOW] / 5 : 0), 0, 1);
		this.wowDepth = wow * wow * 0.007 * sr;        // up to 7 ms: a few cents to a sea-sick bend
		this.flutDepth = s.flutter * s.flutter * 0.0007 * sr;
		const fc = clamp(s.tone * mc.tone * Math.pow(2, p[I_TONE] ? ins[I_TONE] : 0), 300, sr * 0.45);
		this.toneK = 1 - Math.exp(-2 * Math.PI * fc / sr);
		this.bumpK1 = 1 - Math.exp(-2 * Math.PI * mc.bumpHz * 1.6 / sr);
		this.bumpK2 = 1 - Math.exp(-2 * Math.PI * mc.bumpHz * 0.6 / sr);
		this.drive = 1 + s.saturate * s.saturate * 8;
		this.hiss = s.hiss * s.hiss * 0.06;
		this.hissK = 1 - Math.exp(-2 * Math.PI * (2000 + 9000 * mc.hissTone) / sr);
		this.dcK = 1 - Math.exp(-2 * Math.PI * 25 / sr);
		// STOP: the button or a gate
		this.stopNow = this.btn || (p[I_STOP] && ins[I_STOP] > 1);
		this.stopRate = 1 / (Math.max(0.05, s.stop_time) * sr);
	}

	// the tape at d samples behind the write point (linear interpolation)
	read(b, pos) {
		const N = this.N;
		pos = ((pos % N) + N) % N;
		const i = pos | 0, f = pos - i;
		return b[i] * (1 - f) + b[(i + 1) % N] * f;
	}

	tick() {
		const s = this.s, ins = this.ins, outs = this.outs, sr = sampleRate, mc = this.mc;
		const xl = ins[I_L], xr = this.patched[I_R] ? ins[I_R] : xl;
		this.bl[this.wp] = xl; this.br[this.wp] = xr;
		if (!s.on) { outs[0] = xl; outs[1] = xr; this.wp = (this.wp + 1) % this.N; return 0; }

		// WOW: a slow sine and a wandering random; FLUTTER: fast, with a little jitter
		this.wowPh += mc.wowHz / sr; if (this.wowPh >= 1) this.wowPh -= 1;
		this.flutPh += mc.flutHz / sr; if (this.flutPh >= 1) this.flutPh -= 1;
		if (--this.rndLeft <= 0) { this.rndT = Math.random() * 2 - 1; this.rndLeft = Math.round(sr * (0.2 + Math.random() * 0.6)); }
		this.rnd += (this.rndT - this.rnd) * (3 / sr);
		this.jit += ((Math.random() * 2 - 1) - this.jit) * 0.002;
		const sw = Math.sin(2 * Math.PI * this.wowPh), sw2 = Math.sin(2 * Math.PI * (this.wowPh + mc.spread));
		const fl = Math.sin(2 * Math.PI * this.flutPh), fl2 = Math.sin(2 * Math.PI * (this.flutPh + 0.3));
		const ml = this.wowDepth * (0.55 * (1 + sw) + 0.45 * (1 + this.rnd)) + this.flutDepth * (1 + 0.8 * fl + 0.2 * this.jit * 8);
		const mr = this.wowDepth * (0.55 * (1 + sw2) + 0.45 * (1 + this.rnd)) + this.flutDepth * (1 + 0.8 * fl2 - 0.2 * this.jit * 8);
		this.mod = ml / (this.wowDepth * 2 + this.flutDepth * 2 + 1);

		// STOP: the tape slows to a halt; let go, it speeds up again, then finds its place
		let l, r, gain = 1;
		const placeL = this.wp - this.base - ml, placeR = this.wp - this.base - mr;
		if (this.stopNow && !this.free) { this.free = true; this.rp = placeL; }
		if (this.free) {
			if (this.stopNow) this.speed = Math.max(0, this.speed - this.stopRate);
			else this.speed = Math.min(1, this.speed + this.stopRate * 2);
			this.rp += this.speed;
			l = this.read(this.bl, this.rp); r = this.read(this.br, this.rp);
			gain = Math.min(1, this.speed * 3);                 // no sound from a tape that does not move
			if (!this.stopNow && this.speed >= 1) { this.free = false; this.resync = 1; }
		}
		else {
			l = this.read(this.bl, placeL); r = this.read(this.br, placeR);
			if (this.resync > 0) { // the lagging read fades into the tape at its place
				this.rp += 1;
				const k = this.resync;
				l = l * (1 - k) + this.read(this.bl, this.rp) * k; r = r * (1 - k) + this.read(this.br, this.rp) * k;
				this.resync = Math.max(0, this.resync - 1 / (0.05 * sr));
			}
		}
		this.wp = (this.wp + 1) % this.N;

		// AGE: dropouts, now and then
		if (this.dropLeft > 0) { if (--this.dropLeft === 0) this.dropT = 1; }
		else if (s.age > 0 && Math.random() < s.age * s.age * 1.5 / sr) {
			this.dropT = 1 - (0.3 + Math.random() * 0.6) * s.age;
			this.dropLeft = Math.round(sr * (0.03 + Math.random() * 0.22));
		}
		this.drop += (this.dropT - this.drop) * 0.004;

		const tk = this.toneK * (0.35 + 0.65 * this.drop) * (1 - 0.35 * s.age);
		const dry = [xl, xr], wet = [l, r];
		for (let c = 0; c < 2; c++) {
			const f = this.f[c];
			// SATURATE: tape compression, a little asymmetric
			let y = fastTanh(wet[c] * this.drive + 0.08 * s.saturate) - fastTanh(0.08 * s.saturate);
			y /= Math.min(this.drive, 3) * 0.6 + 0.4;
			// the head bump: a band around the machine's low frequency
			f[2] += (y - f[2]) * this.bumpK1; f[3] += (f[2] - f[3]) * this.bumpK2;
			y += (f[2] - f[3]) * mc.bump * 0.8;
			// TONE: two poles
			f[0] += (y - f[0]) * tk; f[1] += (f[0] - f[1]) * tk;
			y = f[1] * this.drop;
			// HISS
			f[5] += ((Math.random() * 2 - 1) - f[5]) * this.hissK;
			y += f[5] * this.hiss;
			// DC
			f[4] += (y - f[4]) * this.dcK; y -= f[4];
			y *= gain;
			outs[c] = (dry[c] * (1 - s.mix) + y * s.mix) * s.output;
		}
		return outs[0];
	}

	endBlock() {}

	state() { return { speed: this.free ? this.speed : 1, mod: this.mod, drop: this.drop, stopped: this.free && this.speed < 0.01 }; }
}
TapeDSP.IN_IDS = IN_IDS;
TapeDSP.OUT_IDS = OUT_IDS;
TapeDSP.MIDI_IN = null;

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.tape = TapeDSP;

})();
