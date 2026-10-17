// rack-worklet.js
// The rack's AudioWorkletProcessor. It hosts one DSP instance per module (synths, mixers, LFOs,
// compressors, delays, reverbs: their classes are registered in globalThis.WR_DSP by the
// devices/*-worklet.js files, loaded into the same AudioWorkletGlobalScope before this one), copies
// the patch cables between them every sample, and runs the rack's own jacks: the keys outputs and
// the audio interface input / main output.
//   input 0:  audio interface (microphone / line)      output 0: main, to the speakers
//   inputs 1..SLOTS / outputs 1..SLOTS: send / return slots of the modules whose DSP runs in native
//   nodes on the main thread (the convolution reverbs), one per module, all stereo
//
// Jack ids: the rack's own jacks are plain ("kb_gate1", "io_main_l"), a module's are prefixed with
// the module id ("subharm.vco1", "comp.in_l"). Cables are copied with one sample of delay. CV inputs
// take one cable; audio inputs (rear sockets) sum all the cables plugged in. MIDI reaches a module
// through a cable from the keys' MIDI output into its MIDI IN, or with its MASTER MIDI switch on.
//
// MIDI notes come in as { type: "note", channel 1..16, note, on }: one note stack per channel (plus
// one for OMNI, with every note) turns them into the mono { type: "midi", pitch, gate, retrigger }
// messages the modules play, last note priority, sent to the modules listening to that channel.
// { type: "sched", frame, msg } queues any message for a sample frame (the song sequencer).

const SLOTS = 8;
const RACK_OUT_IDS = ["kb_gate1","kb_key1","kb_gate2","kb_key2","kb_trig","in_l","in_r","io_input_l","io_input_r"];
const RACK_IN_IDS = ["io_main_l","io_main_r"];
const O_KB_GATE = [0, 2], O_KB_KEY = [1, 3], O_KB_TRIG = 4, O_IN_L = 5, O_IN_R = 6, O_IO_IN = [7, 8];
const I_MAIN = [0, 1];
const MIDI_OUT = "kb_midi";
// realtime MIDI (no channel) goes to every module the MIDI reaches
const MIDI_REALTIME = { midiClock: 1, midiStart: 1, midiStop: 1, midiContinue: 1 };

const GATE_V = 5;
const PULSE_TIME = 0.005;
const STATE_INTERVAL = 1024; // samples between UI state reports
const MAX_CABLES = 512;

function rackTanh(x) {
	if (x < -3) return -1;
	if (x > 3) return 1;
	const x2 = x * x;
	return x * (27 + x2) / (27 + 9 * x2);
}

class RackProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.s = null;
		this.outs = new Float32Array(RACK_OUT_IDS.length);
		this.ins = new Float32Array(RACK_IN_IDS.length);
		this.patched = new Uint8Array(RACK_IN_IDS.length);
		this.modules = [];     // [{ id, type, dsp, slot }] in rack order
		this.byId = {};
		this.scale = null;     // Scala scale from the toolbar, for the modules that quantize
		this.tempo = 120;      // BPM of the first module with a clock, for tempo synced delays
		this.j = 0;            // sample index in the block, for the send / return modules

		// cables, flattened: every sample dstArr[c][dstIdx[c]] += srcArr[c][srcIdx[c]]
		this.srcArr = []; this.srcIdx = new Int32Array(MAX_CABLES);
		this.dstArr = []; this.dstIdx = new Int32Array(MAX_CABLES);
		this.numCables = 0;
		// distinct cabled inputs, zeroed before the cables add into them
		this.zeroArr = []; this.zeroIdx = new Int32Array(MAX_CABLES);
		this.numZero = 0;

		this.kbGate = [false, false];
		this.kbKey = [0, 0];
		this.kbTrig = 0;
		this.stateCounter = 0;
		this.stacks = [];    // held notes per channel, 0 = all channels (OMNI)
		for (let c = 0; c <= 16; c++) this.stacks.push([]);
		this.queue = [];     // scheduled messages, sorted by frame
		this.port.onmessage = (e) => this.onMessage(e.data);
	}

	// modules the MIDI of `channel` reaches: cabled (or MASTER MIDI), listening to it or OMNI (0)
	// mono modules (poly: the polyphonic ones get the raw notes instead, see noteEvent)
	toChannel(channel, msg, omni, poly) {
		for (const mod of this.modules)
			if (mod.dsp.midiConnected && !!mod.dsp.constructor.POLY === !!poly &&
				(omni ? mod.midiChannel === 0 : mod.midiChannel === channel && channel > 0))
				mod.dsp.message(msg);
	}

	noteEvent(m) {
		const ch = Math.max(1, Math.min(16, m.channel | 0));
		// polyphonic modules allocate their own voices: every note on / off of their channel (or all)
		for (const mod of this.modules)
			if (mod.dsp.midiConnected && mod.dsp.constructor.POLY && (mod.midiChannel === 0 || mod.midiChannel === ch))
				mod.dsp.message({ type: "note", note: m.note, on: !!m.on, vel: m.vel === undefined ? 1 : m.vel });
		for (const k of [ch, 0]) {
			const st = this.stacks[k];
			const i = st.indexOf(m.note);
			if (i >= 0) st.splice(i, 1);
			let msg;
			if (m.on) {
				st.push(m.note);
				msg = { type: "midi", pitch: (m.note - 60) / 12, gate: true, retrigger: true, velocity: m.vel };
			}
			else if (st.length)
				msg = { type: "midi", pitch: (st[st.length - 1] - 60) / 12, gate: true, retrigger: false };
			else
				msg = { type: "midi", gate: false };
			if (m.on || i >= 0) this.toChannel(ch, msg, k === 0);
		}
	}

	notesOff() {
		for (const st of this.stacks) st.length = 0;
		for (const mod of this.modules)
			if (mod.dsp.midiConnected) mod.dsp.message(mod.dsp.constructor.POLY ? { type: "allNotesOff" } : { type: "midi", gate: false });
	}

	schedule(m) {
		const q = this.queue;
		let i = q.length;
		while (i > 0 && q[i - 1].frame > m.frame) i--;
		q.splice(i, 0, m);
	}

	onMessage(m) {
		if (MIDI_REALTIME[m.type]) {
			for (const mod of this.modules)
				if (mod.dsp.midiConnected) mod.dsp.message(m);
			return;
		}
		switch (m.type) {
			case "note": this.noteEvent(m); break;
			case "bend": {
				const ch = Math.max(1, Math.min(16, m.channel | 0));
				const msg = { type: "bend", value: m.value };
				for (const poly of [false, true]) {
					this.toChannel(ch, msg, false, poly);
					this.toChannel(ch, msg, true, poly);
				}
				break;
			}
			case "notesOff": this.notesOff(); break;
			case "sched": this.schedule(m); break;
			case "unsched": this.queue = this.queue.filter(e => e.tag !== m.tag); break;
			case "settings":
				if (m.tempo > 0) this.tempo = m.tempo;
				this.setSettings(m.settings);
				break;
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
		let slot = 0;
		for (const m of s.modules || []) {
			const Dsp = globalThis.WR_DSP && globalThis.WR_DSP[m.type];
			if (!Dsp) continue;
			let mod = this.byId[m.id];
			if (!mod || mod.type !== m.type) {
				mod = { id: m.id, type: m.type, dsp: new Dsp() };
				mod.dsp.host = this;
				mod.dsp.message({ type: "scale", scale: this.scale });
			}
			// native modules take the send / return slots in rack order (the main thread does the same)
			mod.slot = Dsp.NATIVE && slot < SLOTS ? 1 + slot++ : -1;
			mod.midiMaster = !!(m.settings && m.settings.midi_master); // MASTER MIDI: the keys' MIDI without a cable
			mod.midiChannel = m.settings ? Math.max(0, Math.min(16, m.settings.midi_channel | 0)) : 0; // 0 = OMNI
			if (mod.slot < 0) { mod.dsp.send = null; mod.dsp.ret = null; }
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
		for (const n of nodes) { n.patched.fill(0); n.ins.fill(0); if (n.outPatched) n.outPatched.fill(0); }
		const midi = {};
		let c = 0, z = 0;
		this.srcArr.length = 0;
		this.dstArr.length = 0;
		this.zeroArr.length = 0;
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
			if (!dst.node.patched[dst.index]) {
				this.zeroArr[z] = dst.node.ins; this.zeroIdx[z] = dst.index; z++;
			}
			dst.node.patched[dst.index] = 1;
			if (src.node.outPatched) src.node.outPatched[src.index] = 1; // for modules that take a cabled output out of a mix
			c++;
		}
		this.numCables = c;
		this.numZero = z;
		for (const mod of this.modules) mod.dsp.setMidiConnected(!!midi[mod.id] || mod.midiMaster);
	}

	process(inputs, outputs) {
		const out = outputs[0];
		const L = out[0], R = out[1];
		if (!this.s || !L) return true;

		const n = L.length;
		const ins = this.ins, outs = this.outs, patched = this.patched;
		// stereo input / output pairs (empty arrays while nothing is connected)
		const pair = (list, k) => {
			const b = list && list[k];
			return b && b.length ? [b[0], b[1] || b[0]] : null;
		};
		const io = pair(inputs, 0);
		const mods = this.modules.map(m => m.dsp);
		const nm = mods.length;
		for (const mod of this.modules) {
			if (mod.slot > 0) {
				mod.dsp.send = pair(outputs, mod.slot);
				mod.dsp.ret = pair(inputs, mod.slot);
			}
			mod.dsp.beginBlock(n);
		}
		const nc = this.numCables, srcArr = this.srcArr, srcIdx = this.srcIdx, dstArr = this.dstArr, dstIdx = this.dstIdx;
		const nz = this.numZero, zeroArr = this.zeroArr, zeroIdx = this.zeroIdx;

		const q = this.queue;
		for (let j = 0; j < n; j++) {
			this.j = j;
			// ---- scheduled messages (the song sequencer) due at this sample ----
			while (q.length && q[0].frame <= currentFrame + j)
				this.onMessage(q.shift().msg);
			// ---- audio interface input: +-5V on the front, line level on the back ----
			const inL = io ? io[0][j] : 0, inR = io ? io[1][j] : 0;
			outs[O_IN_L] = inL * 5;
			outs[O_IN_R] = inR * 5;
			outs[O_IO_IN[0]] = inL;
			outs[O_IO_IN[1]] = inR;

			// ---- patch cables (one sample of delay; several cables into an audio input add up) ----
			for (let c = 0; c < nz; c++)
				zeroArr[c][zeroIdx[c]] = 0;
			for (let c = 0; c < nc; c++)
				dstArr[c][dstIdx[c]] += srcArr[c][srcIdx[c]];

			// ---- keys device outputs ----
			outs[O_KB_GATE[0]] = this.kbGate[0] ? GATE_V : 0;
			outs[O_KB_GATE[1]] = this.kbGate[1] ? GATE_V : 0;
			outs[O_KB_KEY[0]] = this.kbKey[0];
			outs[O_KB_KEY[1]] = this.kbKey[1];
			if (this.kbTrig > 0) { outs[O_KB_TRIG] = GATE_V; this.kbTrig--; }
			else outs[O_KB_TRIG] = 0;

			// ---- the modules ----
			for (let m = 0; m < nm; m++) mods[m].tick();

			// ---- main out to the speakers, soft limited (MAIN IN R normalled to L) ----
			const yl = rackTanh(ins[I_MAIN[0]]);
			L[j] = yl;
			if (R) R[j] = patched[I_MAIN[1]] ? rackTanh(ins[I_MAIN[1]]) : yl;
		}
		for (let m = 0; m < nm; m++) mods[m].endBlock(n);

		this.stateCounter += n;
		if (this.stateCounter >= STATE_INTERVAL) {
			this.stateCounter = 0;
			const modules = {};
			for (const mod of this.modules) modules[mod.id] = mod.dsp.state();
			this.port.postMessage({ type: "state", modules: modules });
		}
		return true;
	}
}

// EXPORT WAV: the master output (its input) recorded in blocks of 4096 frames, posted to the page.
// Registered before the rack processor
class RecorderProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.on = false;
		this.fresh();
		this.port.onmessage = (e) => {
			if (e.data === "start") { this.on = true; this.fresh(); }
			else if (e.data === "stop") { this.flush(); this.on = false; this.port.postMessage({ type: "done" }); }
		};
	}
	fresh() { this.L = new Float32Array(4096); this.R = new Float32Array(4096); this.n = 0; }
	flush() {
		if (this.n) this.port.postMessage({ type: "chunk", L: this.L.slice(0, this.n), R: this.R.slice(0, this.n) });
		this.fresh();
	}
	process(inputs) {
		if (!this.on) return true;
		const inp = inputs[0], l = inp && inp[0], r = inp && (inp[1] || inp[0]);
		for (let i = 0; i < 128; i++) { // no input connected: silence, so the timing holds
			this.L[this.n] = l ? l[i] : 0; this.R[this.n] = r ? r[i] : 0;
			if (++this.n === 4096) this.flush();
		}
		return true;
	}
}
registerProcessor("webrack-recorder", RecorderProcessor);

registerProcessor("webrack", RackProcessor);

if (typeof module !== "undefined")
	module.exports = { RackProcessor, RACK_OUT_IDS, RACK_IN_IDS, SLOTS };
