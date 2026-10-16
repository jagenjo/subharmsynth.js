// rack-worklet.js
// The rack's AudioWorkletProcessor. It hosts one DSP instance per synth module (their classes are
// registered in globalThis.WR_DSP by the synths/*-worklet.js files, loaded into the same
// AudioWorkletGlobalScope before this one), copies the patch cables between them every sample,
// and runs the shared devices: keys outputs, dual LFO, the compressor on the master bus and the scope.
//
// Jack ids: the rack's own jacks are plain ("lfo1", "kb_gate1"), a module's are prefixed with
// the module id ("subharm.vco1", "dfam2.vca"). Each input takes one cable, with one sample of delay.

const RACK_OUT_IDS = ["lfo1","lfo2","comp_gr","kb_gate1","kb_key1","kb_gate2","kb_key2","kb_trig"];
const RACK_IN_IDS = ["lfo1_rate","lfo2_rate","lfo1_sync","lfo2_sync","comp_sc","scope_in"];
const O_LFO = [0, 1], O_COMP_GR = 2, O_KB_GATE = [3, 5], O_KB_KEY = [4, 6], O_KB_TRIG = 7;
const I_LFO_RATE = [0, 1], I_LFO_SYNC = [2, 3], I_COMP_SC = 4, I_SCOPE = 5;
const MIDI_OUT = "kb_midi";
const MIDI_MESSAGES = { midi: 1, bend: 1, midiClock: 1, midiStart: 1, midiStop: 1, midiContinue: 1 };
const LFO_SHAPES = { sine: 0, tri: 1, saw: 2, ramp: 3, square: 4, sh: 5 };

const GATE_V = 5;
const GATE_THRESHOLD = 1;
const PULSE_TIME = 0.005;
const DB_TO_LN = Math.LN10 / 20;
const SCOPE_RING = 1024;     // columns kept, power of two
const SCOPE_POINTS = 256;    // columns shown
const SCOPE_ROLL_TIME = 0.2; // time bases above this scroll instead of triggering
const STATE_INTERVAL = 1024; // samples between UI state reports
const MAX_CABLES = 256;

function rackTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

function rackClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

class RackProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.s = null;
		this.outs = new Float32Array(RACK_OUT_IDS.length);
		this.ins = new Float32Array(RACK_IN_IDS.length);
		this.patched = new Uint8Array(RACK_IN_IDS.length);
		this.gateHigh = new Uint8Array(RACK_IN_IDS.length);
		this.modules = [];     // [{ id, type, dsp }] in rack order
		this.byId = {};
		this.scale = null;     // Scala scale from the toolbar, for the modules that quantize

		// cables, flattened: every sample dstArr[c][dstIdx[c]] = srcArr[c][srcIdx[c]]
		this.srcArr = []; this.srcIdx = new Int32Array(MAX_CABLES);
		this.dstArr = []; this.dstIdx = new Int32Array(MAX_CABLES);
		this.numCables = 0;

		this.kbGate = [false, false];
		this.kbKey = [0, 0];
		this.kbTrig = 0;

		this.lfoPhase = [0, 0];
		this.lfoHold = [Math.random() * 2 - 1, Math.random() * 2 - 1];
		this.lfoValue = [0, 0];
		this.compEnv = 0;
		this.compGrPeak = 0;

		// oscilloscope on the compressor: ring buffer of min/max columns
		this.scopeMin = new Float32Array(SCOPE_RING);
		this.scopeMax = new Float32Array(SCOPE_RING);
		this.scopePos = 0;
		this.scopeCount = 0;
		this.scopeTime = 0;
		this.scopeBucket = 1;
		this.scopeLo = 0;
		this.scopeHi = 0;

		this.stateCounter = 0;
		this.port.onmessage = (e) => this.onMessage(e.data);
	}

	onMessage(m) {
		if (MIDI_MESSAGES[m.type]) {
			// MIDI reaches a module only through a cable from the keys device's MIDI output
			for (const mod of this.modules)
				if (mod.dsp.midiConnected) mod.dsp.message(m);
			return;
		}
		switch (m.type) {
			case "settings": this.setSettings(m.settings); break;
			case "module": {
				const mod = this.byId[m.id];
				if (mod) mod.dsp.message(m.msg);
				break;
			}
			case "scale":
				this.scale = m.scale;
				for (const mod of this.modules) mod.dsp.message({ type: "scale", scale: m.scale });
				break;
			case "kbTrig": this.kbTrig = Math.round(PULSE_TIME * sampleRate); break; // any key, whatever the split
			case "kb":
				if (m.key !== undefined) this.kbKey[m.zone] = m.key;
				this.kbGate[m.zone] = !!m.gate;
				break;
		}
	}

	setSettings(s) {
		this.s = s;
		// keep the running instances of modules that are still in the rack
		const byId = {};
		const list = [];
		for (const m of s.modules || []) {
			const Dsp = globalThis.WR_DSP && globalThis.WR_DSP[m.type];
			if (!Dsp) continue;
			let mod = this.byId[m.id];
			if (!mod || mod.type !== m.type) {
				mod = { id: m.id, type: m.type, dsp: new Dsp() };
				mod.dsp.message({ type: "scale", scale: this.scale });
			}
			mod.dsp.setSettings(m.settings);
			byId[m.id] = mod;
			list.push(mod);
		}
		this.modules = list;
		this.byId = byId;
		this.setPatches(s.patches || []);
	}

	// "id" or "module.id" -> { node, index } in the outputs or inputs table
	resolve(id, dir) {
		const dot = id.indexOf(".");
		if (dot < 0) {
			const i = (dir === "out" ? RACK_OUT_IDS : RACK_IN_IDS).indexOf(id);
			return i < 0 ? null : { node: this, index: i };
		}
		const mod = this.byId[id.substr(0, dot)];
		if (!mod) return null;
		const ids = dir === "out" ? mod.dsp.constructor.OUT_IDS : mod.dsp.constructor.IN_IDS;
		const i = ids.indexOf(id.substr(dot + 1));
		return i < 0 ? null : { node: mod.dsp, index: i };
	}

	setPatches(patches) {
		const nodes = [this].concat(this.modules.map(m => m.dsp));
		for (const n of nodes) { n.patched.fill(0); n.ins.fill(0); }
		const midi = {};
		let c = 0;
		this.srcArr.length = 0;
		this.dstArr.length = 0;
		for (const p of patches) {
			if (p[0] === MIDI_OUT) { // MIDI cable into a module's MIDI IN
				const dot = p[1].indexOf(".");
				const mod = dot > 0 && this.byId[p[1].substr(0, dot)];
				if (mod && mod.dsp.constructor.MIDI_IN === p[1].substr(dot + 1)) midi[mod.id] = true;
				continue;
			}
			const src = this.resolve(p[0], "out"), dst = this.resolve(p[1], "in");
			if (!src || !dst || c >= MAX_CABLES) continue;
			this.srcArr[c] = src.node.outs; this.srcIdx[c] = src.index;
			this.dstArr[c] = dst.node.ins; this.dstIdx[c] = dst.index;
			dst.node.patched[dst.index] = 1;
			c++;
		}
		this.numCables = c;
		for (const mod of this.modules) mod.dsp.setMidiConnected(!!midi[mod.id]);
	}

	gateEdge(i) {
		const high = this.ins[i] > GATE_THRESHOLD ? 1 : 0;
		const rising = high && !this.gateHigh[i];
		this.gateHigh[i] = high;
		return rising;
	}

	// scope input: one min/max pair per bucket of samples, bucket size from the time base
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

	process(inputs, outputs) {
		const out = outputs[0];
		const L = out[0], R = out[1];
		const s = this.s;
		if (!s || !L) return true;

		const sr = sampleRate;
		const n = L.length;
		const ins = this.ins, outs = this.outs, patched = this.patched;
		const mods = this.modules.map(m => m.dsp);
		const nm = mods.length;
		for (let m = 0; m < nm; m++) mods[m].beginBlock(n);

		const lfoShape = [LFO_SHAPES[s.lfo[0].shape] || 0, LFO_SHAPES[s.lfo[1].shape] || 0];
		const comp = s.comp;
		const compAtk = 1 - Math.exp(-1 / (Math.max(comp.attack, 0.0001) * sr));
		const compRel = 1 - Math.exp(-1 / (Math.max(comp.release, 0.001) * sr));
		const compSlope = 1 - 1 / Math.max(comp.ratio, 1);
		const compMakeup = Math.exp(comp.makeup * DB_TO_LN);
		const nc = this.numCables, srcArr = this.srcArr, srcIdx = this.srcIdx, dstArr = this.dstArr, dstIdx = this.dstIdx;

		for (let j = 0; j < n; j++) {
			// ---- patch cables (one sample of delay) ----
			for (let c = 0; c < nc; c++)
				dstArr[c][dstIdx[c]] = srcArr[c][srcIdx[c]];

			// ---- keys device outputs ----
			outs[O_KB_GATE[0]] = this.kbGate[0] ? GATE_V : 0;
			outs[O_KB_GATE[1]] = this.kbGate[1] ? GATE_V : 0;
			outs[O_KB_KEY[0]] = this.kbKey[0];
			outs[O_KB_KEY[1]] = this.kbKey[1];
			if (this.kbTrig > 0) { outs[O_KB_TRIG] = GATE_V; this.kbTrig--; }
			else outs[O_KB_TRIG] = 0;

			// ---- dual LFO ----
			for (let i = 0; i < 2; i++) {
				const lfo = s.lfo[i];
				if (this.gateEdge(I_LFO_SYNC[i])) {
					this.lfoPhase[i] = 0;
					this.lfoHold[i] = Math.random() * 2 - 1;
				}
				let rate = lfo.rate;
				if (patched[I_LFO_RATE[i]]) rate *= Math.exp(ins[I_LFO_RATE[i]] * Math.LN2);
				let p = this.lfoPhase[i] + rackClamp(rate, 0.001, 200) / sr;
				if (p >= 1) {
					p -= Math.floor(p);
					this.lfoHold[i] = Math.random() * 2 - 1;
				}
				this.lfoPhase[i] = p;
				let v;
				switch (lfoShape[i]) {
					case 0: v = Math.sin(2 * Math.PI * p); break;
					case 1: v = 1 - 4 * Math.abs(p - 0.5); break;
					case 2: v = 1 - 2 * p; break;
					case 3: v = 2 * p - 1; break;
					case 4: v = p < 0.5 ? 1 : -1; break;
					default: v = this.lfoHold[i];
				}
				this.lfoValue[i] = v * lfo.level;
				outs[O_LFO[i]] = v * lfo.level * 5;
			}

			// ---- the synths, summed on the master bus ----
			let master = 0;
			for (let m = 0; m < nm; m++) master += mods[m].tick();

			// ---- compressor on the master bus (sidechain jack replaces the detector input) ----
			if (comp.on) {
				const det = patched[I_COMP_SC] ? ins[I_COMP_SC] / 5 : master;
				const a = det < 0 ? -det : det;
				this.compEnv += (a > this.compEnv ? compAtk : compRel) * (a - this.compEnv);
				const over = 20 * Math.log10(this.compEnv + 1e-9) - comp.threshold;
				let gr = 0; // gain reduction in dB, 6dB soft knee
				if (over > 3) gr = over * compSlope;
				else if (over > -3) gr = compSlope * (over + 3) * (over + 3) / 12;
				master *= (1 - comp.mix) + comp.mix * Math.exp(-gr * DB_TO_LN) * compMakeup;
				outs[O_COMP_GR] = rackClamp(gr / 4, 0, 10);
				if (gr > this.compGrPeak) this.compGrPeak = gr;
			}
			else
				outs[O_COMP_GR] = 0;
			const y = rackTanh(master); // soft limiter on the output
			// scope: the patched SCOPE input (+-5V full scale) or the master output
			this.scopeFeed(patched[I_SCOPE] ? ins[I_SCOPE] / 5 : y, s.scope.time);
			L[j] = y;
			if (R) R[j] = y;
		}
		for (let m = 0; m < nm; m++) mods[m].endBlock(n);

		this.stateCounter += n;
		if (this.stateCounter >= STATE_INTERVAL) {
			this.stateCounter = 0;
			const modules = {};
			for (const mod of this.modules) modules[mod.id] = mod.dsp.state();
			this.port.postMessage({
				type: "state",
				rack: { lfo: this.lfoValue.slice(), comp_gr: this.compGrPeak, scope: this.scopeSnapshot() },
				modules: modules
			});
			this.compGrPeak = 0;
		}
		return true;
	}
}

registerProcessor("webrack", RackProcessor);

if (typeof module !== "undefined")
	module.exports = { RackProcessor, RACK_OUT_IDS, RACK_IN_IDS };
