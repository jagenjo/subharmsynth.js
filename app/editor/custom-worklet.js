// editor/custom-worklet.js
// CUSTOM SYNTH: the module catalog and the engine that plays a design made in the Synth Editor.
// Loaded twice: in the AudioWorklet (the engine, WR_DSP.custom) and in the page (the catalog, for the
// editor and the panel: WR_DSP.custom.CATALOG). It uses nothing of the page or of the other synths.
//
// A design (the device's settings): items on the panel (knobs, sliders, buttons, switches, LEDs, jacks,
// labels, sections) and inner modules (oscillators, filters, envelopes...), wired output -> input.
// Every item or module is a node; each sample the nodes run in dependency order (a wire closing a loop
// reads the previous sample). An input without a wire takes its constant (the module's default, or the
// value set in the editor). Signals: audio -1..1, gates 0 / 1, envelopes 0..1, pitch in octaves (0 = C4).
// Jacks convert to the rack's volts: CV and audio +-5 V <-> +-1, pitch 1 V/oct, gates 5 V.
(function(){

const C4 = 261.6255653005986;
const SLOTS = 8, ASLOTS = 4;
// front: in1..8, out1..8 (CV); back: AUDIO L / R (the AUDIO OUT module), ain1..4, aout1..4
const IN_IDS = [], OUT_IDS = [];
for (let i = 1; i <= SLOTS; i++) { IN_IDS.push("in" + i); OUT_IDS.push("out" + i); }
OUT_IDS.push("audio_l", "audio_r");
for (let i = 1; i <= ASLOTS; i++) { IN_IDS.push("ain" + i); OUT_IDS.push("aout" + i); }

// an input: [key, label, min, max, default, unit, names (an int input's choices)]
// units: oct (pitch, octaves from C4), hz / s / bpm (exponential), lvl (0..1), bi (-1..1), audio, gate, int, bits, x
const MODULES = {
	midi:   { title: "MIDI IN", cat: "Inputs", ins: [], outs: ["pitch", "gate", "vel"], about: "The notes of the keys or a MIDI device: PITCH (octaves from C4), GATE, VELOCITY" },
	osc:    { title: "OSCILLATOR", cat: "Sources", ins: [["pitch", "PITCH", -4, 4, 0, "oct"], ["fm", "FM", -2, 2, 0, "oct"], ["pw", "PULSE WIDTH", 0.05, 0.95, 0.5, "lvl"]],
		outs: ["sine", "tri", "saw", "square"], about: "Four waves at once; PITCH and FM add up (1 per octave)" },
	noise:  { title: "NOISE", cat: "Sources", ins: [], outs: ["white", "pink"], about: "White and pink noise" },
	lfo:    { title: "LFO", cat: "Modulation", ins: [["rate", "RATE", 0.02, 40, 2, "hz"]], outs: ["sine", "tri", "saw", "square"], about: "Slow waves, -1..1" },
	adsr:   { title: "ENVELOPE", cat: "Modulation", ins: [["gate", "GATE", 0, 1, 0, "gate"], ["a", "ATTACK", 0.001, 8, 0.01, "s"], ["d", "DECAY", 0.005, 8, 0.3, "s"],
		["s", "SUSTAIN", 0, 1, 0.6, "lvl"], ["r", "RELEASE", 0.005, 10, 0.4, "s"]], outs: ["env"], about: "ADSR, 0..1, started by GATE" },
	clock:  { title: "CLOCK", cat: "Modulation", ins: [["bpm", "TEMPO", 20, 300, 120, "bpm"]], outs: ["gate"], about: "A gate every 16th" },
	seq:    { title: "STEP SEQUENCER", cat: "Modulation", ins: [["clock", "CLOCK", 0, 1, 0, "gate"], ["reset", "RESET", 0, 1, 0, "gate"], ["len", "LENGTH", 1, 8, 8, "int"]]
		.concat([1, 2, 3, 4, 5, 6, 7, 8].map(function(k){ return ["s" + k, "STEP " + k, -2, 2, 0, "oct"]; })), outs: ["cv", "gate"],
		about: "8 steps (wire knobs into them), a step on each clock" },
	sh:     { title: "SAMPLE & HOLD", cat: "Modulation", ins: [["in", "IN", -1, 1, 0, "bi"], ["trig", "TRIGGER", 0, 1, 0, "gate"]], outs: ["out"], about: "Holds IN on each trigger" },
	slew:   { title: "SLEW", cat: "Modulation", ins: [["in", "IN", -4, 4, 0, "x"], ["time", "TIME", 0.001, 2, 0.05, "s"]], outs: ["out"], about: "Glides to IN (portamento)" },
	quant:  { title: "QUANTIZER", cat: "Modulation", ins: [["in", "IN", -4, 4, 0, "oct"]], outs: ["out"], about: "Rounds a pitch to semitones" },
	decay:  { title: "AD ENVELOPE", cat: "Modulation", ins: [["trig", "TRIGGER", 0, 1, 0, "gate"], ["a", "ATTACK", 0.001, 4, 0.002, "s"], ["d", "DECAY", 0.005, 8, 0.25, "s"]],
		outs: ["env"], about: "Rises and falls on each trigger, 0..1: drums, plucks" },
	follow: { title: "ENV FOLLOWER", cat: "Modulation", ins: [["in", "IN", -1, 1, 0, "audio"], ["time", "RELEASE", 0.005, 2, 0.1, "s"]], outs: ["env"],
		about: "How loud IN is, 0..1: let a sound move something else" },
	random: { title: "RANDOM", cat: "Modulation", ins: [["rate", "RATE", 0.05, 50, 2, "hz"], ["smooth", "SMOOTH", 0, 1, 0, "lvl"]], outs: ["out"],
		about: "A new random value -1..1 RATE times a second, stepped or smooth" },
	// triggers and time
	metro:  { title: "TRIGGER EVERY", cat: "Triggers & time", ins: [["time", "EVERY", 0.01, 30, 1, "s"], ["width", "WIDTH", 0.01, 0.99, 0.5, "lvl"], ["reset", "RESET", 0, 1, 0, "gate"]],
		outs: ["gate", "ramp"], about: "A gate every so many seconds (and a 0..1 ramp between them)" },
	div:    { title: "CLOCK DIVIDER", cat: "Triggers & time", ins: [["clock", "CLOCK", 0, 1, 0, "gate"], ["div", "DIVIDE BY", 1, 32, 2, "int"], ["reset", "RESET", 0, 1, 0, "gate"]],
		outs: ["out"], about: "Lets one gate in every N through" },
	euclid: { title: "EUCLID", cat: "Triggers & time", ins: [["clock", "CLOCK", 0, 1, 0, "gate"], ["steps", "STEPS", 1, 32, 8, "int"], ["hits", "HITS", 0, 32, 3, "int"],
		["rot", "ROTATE", 0, 31, 0, "int"], ["reset", "RESET", 0, 1, 0, "gate"]], outs: ["gate"], about: "HITS spread as evenly as can be over STEPS: world rhythms" },
	gdelay: { title: "GATE DELAY", cat: "Triggers & time", ins: [["in", "IN", 0, 1, 0, "gate"], ["time", "TIME", 0.001, 8, 0.25, "s"]], outs: ["out"],
		about: "The same gates, TIME later" },
	pulse:  { title: "PULSE", cat: "Triggers & time", ins: [["trig", "TRIGGER", 0, 1, 0, "gate"], ["len", "LENGTH", 0.001, 8, 0.1, "s"]], outs: ["gate"],
		about: "A gate of LENGTH on each trigger" },
	chance: { title: "CHANCE", cat: "Triggers & time", ins: [["in", "IN", 0, 1, 0, "gate"], ["prob", "CHANCE", 0, 1, 0.5, "lvl"]], outs: ["a", "b"],
		about: "Each gate goes to A (with that chance) or to B" },
	cmp:    { title: "COMPARATOR", cat: "Triggers & time", ins: [["in", "IN", -1, 1, 0, "bi"], ["thr", "THRESHOLD", -1, 1, 0, "bi"]], outs: ["gate"],
		about: "A gate while IN is over THRESHOLD: turns a wave into gates" },
	// mixing
	xfade:  { title: "CROSSFADE", cat: "Mixing", ins: [["a", "A", -1, 1, 0, "audio"], ["b", "B", -1, 1, 0, "audio"], ["fade", "FADE", 0, 1, 0.5, "lvl"]], outs: ["out"],
		about: "From A (0) to B (1)" },
	pan:    { title: "PANNER", cat: "Mixing", ins: [["in", "IN", -1, 1, 0, "audio"], ["pan", "PAN", -1, 1, 0, "bi"]], outs: ["l", "r"], about: "Places IN between LEFT and RIGHT" },
	switch: { title: "SWITCH", cat: "Mixing", ins: [["sel", "SELECT", 0, 1, 0, "gate"], ["a", "A", -4, 4, 0, "x"], ["b", "B", -4, 4, 0, "x"]], outs: ["out"],
		about: "A, or B while SELECT is on" },
	filter: { title: "FILTER", cat: "Processors", ins: [["in", "IN", -1, 1, 0, "audio"], ["cutoff", "CUTOFF", -4, 6, 2, "oct"], ["res", "RESONANCE", 0, 1, 0.2, "lvl"]],
		outs: ["lp", "bp", "hp"], about: "State variable filter; CUTOFF in octaves from C4 (2 = about 1 kHz)" },
	vca:    { title: "VCA", cat: "Processors", ins: [["in", "IN", -1, 1, 0, "audio"], ["gain", "GAIN", 0, 1, 1, "lvl"]], outs: ["out"], about: "IN times GAIN" },
	mix:    { title: "MIXER", cat: "Mixing", ins: [["a", "IN 1", -1, 1, 0, "audio"], ["b", "IN 2", -1, 1, 0, "audio"], ["c", "IN 3", -1, 1, 0, "audio"], ["d", "IN 4", -1, 1, 0, "audio"],
		["la", "LEVEL 1", 0, 1, 1, "lvl"], ["lb", "LEVEL 2", 0, 1, 1, "lvl"], ["lc", "LEVEL 3", 0, 1, 1, "lvl"], ["ld", "LEVEL 4", 0, 1, 1, "lvl"]], outs: ["out"], about: "Four inputs and their levels" },
	drive:  { title: "DRIVE", cat: "Distortion", ins: [["in", "IN", -1, 1, 0, "audio"], ["amount", "AMOUNT", 0, 1, 0.5, "lvl"]], outs: ["out"], about: "Saturation" },
	dist:   { title: "DISTORTION", cat: "Distortion", ins: [["in", "IN", -1, 1, 0, "audio"], ["drive", "DRIVE", 0, 1, 0.5, "lvl"], ["type", "TYPE", 0, 4, 0, "int", ["SOFT", "HARD", "FUZZ", "FOLD", "RECTIFY"]],
		["tone", "TONE", 200, 20000, 8000, "hz"]], outs: ["out"], about: "SOFT, HARD, FUZZ, FOLD or RECTIFY, with a TONE after" },
	crush:  { title: "BIT CRUSHER", cat: "Distortion", ins: [["in", "IN", -1, 1, 0, "audio"], ["bits", "BITS", 1, 16, 8, "bits"], ["rate", "RATE", 100, 48000, 12000, "hz"]], outs: ["out"],
		about: "Fewer bits, a lower sample rate: lo-fi, 8-bit" },
	fold:   { title: "WAVEFOLDER", cat: "Distortion", ins: [["in", "IN", -1, 1, 0, "audio"], ["amount", "AMOUNT", 0, 1, 0.3, "lvl"], ["bias", "SYMMETRY", -1, 1, 0, "bi"]], outs: ["out"],
		about: "Folds the wave back on itself: bright, metallic harmonics" },
	ring:   { title: "RING MOD", cat: "Distortion", ins: [["a", "A", -1, 1, 0, "audio"], ["b", "B", -1, 1, 0, "audio"]], outs: ["out"], about: "A times B: bells, robots" },
	// effects
	delay:  { title: "DELAY", cat: "Effects", ins: [["in", "IN", -1, 1, 0, "audio"], ["time", "TIME", 0.005, 2, 0.3, "s"], ["fb", "FEEDBACK", 0, 0.95, 0.4, "lvl"], ["mix", "MIX", 0, 1, 0.3, "lvl"]],
		outs: ["out"], about: "Echo" },
	reverb: { title: "REVERB", cat: "Effects", ins: [["in", "IN", -1, 1, 0, "audio"], ["size", "SIZE", 0, 1, 0.6, "lvl"], ["damp", "DAMPING", 0, 1, 0.4, "lvl"], ["mix", "MIX", 0, 1, 0.3, "lvl"]],
		outs: ["l", "r"], about: "A room to a hall, in stereo" },
	chorus: { title: "CHORUS", cat: "Effects", ins: [["in", "IN", -1, 1, 0, "audio"], ["rate", "RATE", 0.05, 8, 0.6, "hz"], ["depth", "DEPTH", 0, 1, 0.5, "lvl"], ["mix", "MIX", 0, 1, 0.5, "lvl"]],
		outs: ["l", "r"], about: "Wide and shimmering, in stereo" },
	rec:    { title: "RECORDER", cat: "Effects", ins: [["in", "IN", -1, 1, 0, "audio"], ["rec", "RECORD", 0, 1, 0, "gate"], ["play", "PLAY", 0, 1, 0, "gate"],
		["speed", "SPEED", -2, 2, 1, "x"], ["loop", "LOOP", 0, 1, 1, "gate"]], outs: ["out", "playing"],
		about: "Records IN (up to 8 s) while RECORD is on; PLAY starts it (SPEED below 0: backwards), LOOP repeats it" },
	math:   { title: "MATH", cat: "Utilities", ins: [["a", "A", -1, 1, 0, "bi"], ["b", "x B", -4, 4, 1, "x"], ["c", "+ C", -4, 4, 0, "x"]], outs: ["out"], about: "A x B + C: scale, offset, invert, multiply" },
	out:    { title: "AUDIO OUT", cat: "Outputs", ins: [["l", "LEFT", -1, 1, 0, "audio"], ["r", "RIGHT", -1, 1, 0, "audio"], ["vol", "VOLUME", 0, 1, 0.8, "lvl"]], outs: [], fixed: true,
		about: "To the rack's speakers (RIGHT follows LEFT when it has no wire)" }
};

// the panel items: their ports inside
const CONTROLS = {
	knob:    { title: "KNOB", outs: ["value"], ins: [] },
	slider:  { title: "SLIDER", outs: ["value"], ins: [] },
	button:  { title: "BUTTON", outs: ["gate"], ins: [] },
	toggle:  { title: "SWITCH", outs: ["on"], ins: [] },
	led:     { title: "LED", outs: [], ins: [["in", "IN", 0, 1, 0, "lvl"]] },
	jackin:  { title: "JACK IN", outs: ["out"], ins: [] },
	jackout: { title: "JACK OUT", outs: [], ins: [["in", "IN", -1, 1, 0, "bi"]] },
	label:   { title: "LABEL", outs: [], ins: [], deco: true },
	section: { title: "SECTION", outs: [], ins: [], deco: true },
	rect:    { title: "RECTANGLE", outs: [], ins: [], deco: true },
	line:    { title: "LINE", outs: [], ins: [], deco: true },
	screw:   { title: "SCREW", outs: [], ins: [], deco: true },
	// the back panel
	ain:     { title: "AUDIO IN", outs: ["audio"], ins: [], about: "Audio from the rack (a socket on the back)" },
	aout:    { title: "AUDIO OUT", outs: [], ins: [["in", "IN", -1, 1, 0, "audio"]], about: "Audio to the rack (a socket on the back)" },
	mainl:   { title: "MAIN OUT L", outs: [], ins: [], deco: true, fixed: true },
	mainr:   { title: "MAIN OUT R", outs: [], ins: [], deco: true, fixed: true },
	midiin:  { title: "MIDI IN", outs: [], ins: [], deco: true, fixed: true },
	vents:   { title: "VENTS", outs: [], ins: [], deco: true }
};

function specOf(kind) { return MODULES[kind] || CONTROLS[kind] || null; }

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function fastTanh(x) { if (x < -3) return -1; if (x > 3) return 1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function polyblep(t, dt) {
	if (t < dt) { t /= dt; return t + t - t * t - 1; }
	if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
	return 0;
}

// ---- ranges: a knob or slider takes the range of the input it is wired to (or its own) ----
function rangeOf(inp) { return { min: inp[2], max: inp[3], def: inp[4], unit: inp[5], names: inp[6] }; }
function isExp(unit) { return unit === "hz" || unit === "s" || unit === "bpm"; }
function controlRange(design, item) {
	if (item.range && item.range.min !== undefined) return item.range;
	const w = (design.wires || []).find(function(w){ return w.from[0] === item.id; });
	if (w) {
		const to = findItem(design, w.to[0]);
		const spec = to && specOf(to.kind);
		const inp = spec && spec.ins.find(function(i){ return i[0] === w.to[1]; });
		if (inp && inp[5] !== "gate") return rangeOf(inp);
	}
	return { min: 0, max: 1, def: 0.5, unit: "lvl" };
}
function findItem(design, id) { return (design.items || []).find(function(x){ return x.id === id; }) || (design.back || []).find(function(x){ return x.id === id; }) || (design.nodes || []).find(function(x){ return x.id === id; }); }
function fromN(r, n) { n = clamp(n, 0, 1); const v = isExp(r.unit) ? r.min * Math.pow(r.max / r.min, n) : r.min + (r.max - r.min) * n; return r.unit === "int" ? Math.round(v) : v; }
function toN(r, v) { return clamp(isExp(r.unit) ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min), 0, 1); }
const NOTE_N = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function fmt(r, v) {
	if (r.names) return r.names[clamp(Math.round(v - r.min), 0, r.names.length - 1)];
	switch (r.unit) {
		case "oct": { const st = v * 12; return (st >= 0 ? "+" : "") + st.toFixed(Math.abs(st) < 10 ? 1 : 0) + " st (" + NOTE_N[((Math.round(60 + st) % 12) + 12) % 12] + (Math.floor(Math.round(60 + st) / 12) - 1) + ")"; }
		case "hz": return v < 10 ? v.toFixed(2) + " Hz" : Math.round(v) + " Hz";
		case "s": return v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s";
		case "bpm": return Math.round(v) + " BPM";
		case "lvl": return Math.round(v * 100) + "%";
		case "int": return String(Math.round(v));
		case "bits": return v.toFixed(1) + " bits";
		case "bi": case "audio": return (v >= 0 ? "+" : "") + v.toFixed(2);
		default: return v.toFixed(2);
	}
}

// ---- the engine ----
const RUN = {};
function I(n, v, k) { const i = n.inIdx[k]; return i >= 0 ? v[i] : n.inConst[k]; }

RUN.knob = RUN.slider = function(n, v) { n.cur += (n.target - n.cur) * 0.005; v[n.o] = n.cur; };
RUN.button = RUN.toggle = function(n, v) { v[n.o] = n.target; };
RUN.led = function(n, v, e) { const x = Math.abs(I(n, v, 0)); if (x > n.peak) n.peak = x; };
RUN.jackin = function(n, v, e) {
	const x = e.ins[n.slot] || 0, m = n.mode;
	v[n.o] = m === "pitch" ? x : (m === "gate" ? (x > 1 ? 1 : 0) : x / 5);
};
RUN.jackout = function(n, v, e) {
	const x = I(n, v, 0), m = n.mode;
	e.outs[n.slot] = m === "pitch" ? x : (m === "gate" ? (x > 0.5 ? 5 : 0) : clamp(x * 5, -10, 10));
};
RUN.ain = function(n, v, e) { v[n.o] = e.ins[SLOTS + n.slot] || 0; };
RUN.aout = function(n, v, e) { e.outs[SLOTS + 2 + n.slot] = fastTanh(I(n, v, 0)); };
RUN.midi = function(n, v, e) {
	v[n.o] = e.pitch;
	let g = e.gate ? 1 : 0;
	if (e.gap > 0) { e.gap--; g = 0; } // a new note while held: the gate drops for a moment
	v[n.o + 1] = g;
	v[n.o + 2] = e.vel;
};
RUN.osc = function(n, v, e) {
	const f = C4 * Math.pow(2, I(n, v, 0) + I(n, v, 1)), dt = clamp(f / e.sr, 0, 0.45);
	let t = n.ph + dt; if (t >= 1) t -= 1; n.ph = t;
	const pw = clamp(I(n, v, 2), 0.02, 0.98);
	let t2 = t + 1 - pw; if (t2 >= 1) t2 -= 1;
	v[n.o] = Math.sin(2 * Math.PI * t);
	v[n.o + 1] = 1 - 4 * Math.abs(t - 0.5);
	v[n.o + 2] = 2 * t - 1 - polyblep(t, dt);
	v[n.o + 3] = (t < pw ? 1 : -1) + polyblep(t, dt) - polyblep(t2, dt);
};
RUN.noise = function(n, v) {
	const w = Math.random() * 2 - 1, b = n.b;
	b[0] = 0.99765 * b[0] + w * 0.099046; b[1] = 0.963 * b[1] + w * 0.2965164; b[2] = 0.57 * b[2] + w * 1.0526913;
	v[n.o] = w; v[n.o + 1] = (b[0] + b[1] + b[2] + w * 0.1848) * 0.25;
};
RUN.lfo = function(n, v, e) {
	let t = n.ph + clamp(I(n, v, 0), 0, 1000) / e.sr; if (t >= 1) t -= Math.floor(t); n.ph = t;
	v[n.o] = Math.sin(2 * Math.PI * t); v[n.o + 1] = 1 - 4 * Math.abs(t - 0.5); v[n.o + 2] = 2 * t - 1; v[n.o + 3] = t < 0.5 ? 1 : -1;
};
RUN.adsr = function(n, v, e) {
	const g = I(n, v, 0) > 0.5, sr = e.sr;
	if (g && !n.gate) n.stage = 1;
	if (!g && n.gate) n.stage = 3;
	n.gate = g;
	let x = n.val;
	if (n.stage === 1) { x += 1 / (Math.max(0.0005, I(n, v, 1)) * sr); if (x >= 1) { x = 1; n.stage = 2; } }
	else if (n.stage === 2) { const s = clamp(I(n, v, 3), 0, 1); x += (s - x) * (1 - Math.exp(-4.6 / (Math.max(0.001, I(n, v, 2)) * sr))); }
	else if (n.stage === 3) { x += (0 - x) * (1 - Math.exp(-4.6 / (Math.max(0.001, I(n, v, 4)) * sr))); if (x < 1e-5) { x = 0; n.stage = 0; } }
	n.val = x; v[n.o] = x;
};
RUN.clock = function(n, v, e) {
	let t = n.ph + clamp(I(n, v, 0), 1, 1000) * 4 / 60 / e.sr; if (t >= 1) t -= Math.floor(t); n.ph = t;
	v[n.o] = t < 0.5 ? 1 : 0;
};
RUN.seq = function(n, v) {
	const c = I(n, v, 0) > 0.5, r = I(n, v, 1) > 0.5, len = clamp(Math.round(I(n, v, 2)), 1, 8);
	if (r && !n.rh) n.step = -1;
	if (c && !n.ch) n.step = (n.step + 1) % len;
	n.ch = c; n.rh = r;
	const st = Math.max(0, n.step) % len;
	v[n.o] = I(n, v, 3 + st); v[n.o + 1] = c ? 1 : 0;
};
RUN.sh = function(n, v) { const t = I(n, v, 1) > 0.5; if (t && !n.th) n.hold = I(n, v, 0); n.th = t; v[n.o] = n.hold; };
RUN.slew = function(n, v, e) { const k = 1 - Math.exp(-4.6 / (Math.max(0.0005, I(n, v, 1)) * e.sr)); n.val += (I(n, v, 0) - n.val) * k; v[n.o] = n.val; };
RUN.quant = function(n, v) { v[n.o] = Math.round(I(n, v, 0) * 12) / 12; };
RUN.filter = function(n, v, e) {
	const fc = clamp(C4 * Math.pow(2, I(n, v, 1)), 10, e.sr * 0.45), g = Math.tan(Math.PI * fc / e.sr), k = 2 - 1.96 * clamp(I(n, v, 2), 0, 1);
	const s = n.s, x = I(n, v, 0), a1 = 1 / (1 + g * (g + k)), v3 = x - s[1];
	const b = a1 * s[0] + g * a1 * v3, l = s[1] + g * b;
	s[0] = 2 * b - s[0]; s[1] = 2 * l - s[1];
	v[n.o] = l; v[n.o + 1] = b; v[n.o + 2] = x - k * b - l;
};
RUN.vca = function(n, v) { v[n.o] = I(n, v, 0) * I(n, v, 1); };
RUN.mix = function(n, v) { v[n.o] = I(n, v, 0) * I(n, v, 4) + I(n, v, 1) * I(n, v, 5) + I(n, v, 2) * I(n, v, 6) + I(n, v, 3) * I(n, v, 7); };
RUN.drive = function(n, v) { const a = clamp(I(n, v, 1), 0, 1), k = 1 + a * 20; v[n.o] = fastTanh(I(n, v, 0) * k) / Math.sqrt(1 + a * 3); };
RUN.delay = function(n, v, e) {
	const b = n.buf, len = b.length, x = I(n, v, 0);
	let p = n.pos - clamp(I(n, v, 1), 0.001, 2) * e.sr; if (p < 0) p += len;
	const i = p | 0, f = p - i, y = b[i] * (1 - f) + b[(i + 1) % len] * f;
	b[n.pos] = fastTanh(x + y * clamp(I(n, v, 2), 0, 0.95));
	n.pos = (n.pos + 1) % len;
	const mix = clamp(I(n, v, 3), 0, 1);
	v[n.o] = x * (1 - mix) + y * mix;
};
RUN.math = function(n, v) { v[n.o] = I(n, v, 0) * I(n, v, 1) + I(n, v, 2); };
// edges: true once when a gate goes up (the state kept in n[key])
function rise(n, key, x) { const g = x > 0.5, r = g && !n[key]; n[key] = g; return r; }
RUN.decay = function(n, v, e) {
	if (rise(n, "th", I(n, v, 0))) n.stage = 1;
	let x = n.val;
	if (n.stage === 1) { x += 1 / (Math.max(0.0005, I(n, v, 1)) * e.sr); if (x >= 1) { x = 1; n.stage = 2; } }
	else if (n.stage === 2) { x *= Math.exp(-6.9 / (Math.max(0.002, I(n, v, 2)) * e.sr)); if (x < 1e-5) { x = 0; n.stage = 0; } }
	n.val = x; v[n.o] = x;
};
RUN.follow = function(n, v, e) {
	const x = Math.abs(I(n, v, 0));
	n.val += (x - n.val) * (x > n.val ? 1 - Math.exp(-1 / (0.002 * e.sr)) : 1 - Math.exp(-2.3 / (Math.max(0.002, I(n, v, 1)) * e.sr)));
	v[n.o] = Math.min(1, n.val * 1.4);
};
RUN.random = function(n, v, e) {
	n.ph += clamp(I(n, v, 0), 0.001, 1000) / e.sr;
	if (n.ph >= 1) { n.ph -= Math.floor(n.ph); n.hold = Math.random() * 2 - 1; }
	const sm = clamp(I(n, v, 1), 0, 1);
	if (sm < 0.001) n.val = n.hold;
	else n.val += (n.hold - n.val) * (1 - Math.exp(-4.6 * clamp(I(n, v, 0), 0.001, 1000) / (sm * 2 * e.sr)));
	v[n.o] = n.val;
};
RUN.metro = function(n, v, e) {
	if (rise(n, "rh", I(n, v, 2))) n.ph = 0;
	const t = n.ph; n.ph += 1 / (Math.max(0.001, I(n, v, 0)) * e.sr); if (n.ph >= 1) n.ph -= Math.floor(n.ph);
	v[n.o] = t < clamp(I(n, v, 1), 0.01, 0.99) ? 1 : 0; v[n.o + 1] = t;
};
RUN.div = function(n, v) {
	if (rise(n, "rh", I(n, v, 2))) n.step = -1;
	const c = I(n, v, 0) > 0.5;
	if (rise(n, "ch", I(n, v, 0))) n.step++;
	v[n.o] = c && n.step >= 0 && n.step % Math.max(1, Math.round(I(n, v, 1))) === 0 ? 1 : 0;
};
RUN.euclid = function(n, v) {
	if (rise(n, "rh", I(n, v, 4))) n.step = -1;
	const steps = clamp(Math.round(I(n, v, 1)), 1, 32), hits = clamp(Math.round(I(n, v, 2)), 0, steps);
	if (rise(n, "ch", I(n, v, 0))) n.step = (n.step + 1) % steps;
	const i = ((Math.max(0, n.step) + Math.round(I(n, v, 3))) % steps + steps) % steps;
	v[n.o] = n.ch && hits > 0 && (i * hits) % steps < hits ? 1 : 0;
};
RUN.gdelay = function(n, v, e) {
	const g = I(n, v, 0) > 0.5;
	n.t++;
	if (g !== n.th) { n.th = g; if (n.q.length < 256) n.q.push([n.t + Math.round(Math.max(0.001, I(n, v, 1)) * e.sr), g ? 1 : 0]); }
	while (n.q.length && n.q[0][0] <= n.t) n.val = n.q.shift()[1];
	v[n.o] = n.val;
};
RUN.pulse = function(n, v, e) {
	if (rise(n, "th", I(n, v, 0))) n.count = Math.round(Math.max(0.001, I(n, v, 1)) * e.sr);
	v[n.o] = n.count > 0 ? 1 : 0; if (n.count > 0) n.count--;
};
RUN.chance = function(n, v) {
	const g = I(n, v, 0) > 0.5;
	if (rise(n, "th", I(n, v, 0))) n.hold = Math.random() < clamp(I(n, v, 1), 0, 1) ? 1 : 0;
	v[n.o] = g && n.hold ? 1 : 0; v[n.o + 1] = g && !n.hold ? 1 : 0;
};
RUN.cmp = function(n, v) {
	const x = I(n, v, 0), t = I(n, v, 1);
	if (x > t + 0.001) n.val = 1; else if (x < t - 0.001) n.val = 0; // a little hysteresis
	v[n.o] = n.val;
};
RUN.xfade = function(n, v) { const f = clamp(I(n, v, 2), 0, 1); v[n.o] = I(n, v, 0) * (1 - f) + I(n, v, 1) * f; };
RUN.pan = function(n, v) { const x = I(n, v, 0), a = (clamp(I(n, v, 1), -1, 1) + 1) * Math.PI / 4; v[n.o] = x * Math.cos(a) * 1.4142; v[n.o + 1] = x * Math.sin(a) * 1.4142; };
RUN.switch = function(n, v) { v[n.o] = I(n, v, 0) > 0.5 ? I(n, v, 2) : I(n, v, 1); };
function fold(x) { let y = x * 0.25 + 0.25; y -= Math.floor(y); return y < 0.5 ? 4 * y - 1 : 3 - 4 * y; }
RUN.dist = function(n, v, e) {
	const a = clamp(I(n, v, 1), 0, 1), x = I(n, v, 0) * (1 + a * a * 40);
	let y;
	switch (Math.round(I(n, v, 2))) {
		case 1: y = clamp(x, -1, 1); break;                              // HARD
		case 2: y = clamp(x + 0.3, -0.7, 1) - 0.15; break;               // FUZZ: asymmetric
		case 3: y = fold(x); break;                                      // FOLD
		case 4: y = fastTanh(Math.abs(x) * 2 - 0.5); break;               // RECTIFY: an octave up
		default: y = fastTanh(x);                                        // SOFT
	}
	n.val += (y - n.val) * (1 - Math.exp(-2 * Math.PI * clamp(I(n, v, 3), 20, e.sr * 0.45) / e.sr));
	v[n.o] = n.val / (1 + a * 0.6);
};
RUN.crush = function(n, v, e) {
	n.ph += clamp(I(n, v, 2), 20, e.sr) / e.sr;
	if (n.ph >= 1) { n.ph -= Math.floor(n.ph); const q = Math.pow(2, clamp(I(n, v, 1), 1, 16) - 1); n.hold = Math.round(I(n, v, 0) * q) / q; }
	v[n.o] = n.hold;
};
RUN.fold = function(n, v) { const a = clamp(I(n, v, 1), 0, 1); v[n.o] = fold(I(n, v, 0) * (1 + a * 7) + I(n, v, 2) * 0.5 - 1); };
RUN.ring = function(n, v) { v[n.o] = I(n, v, 0) * I(n, v, 1); };
// REVERB: four combs and two all-passes a side (a classic design), lengths scaled to the sample rate
const COMBS = [1116, 1277, 1422, 1557], APS = [556, 441];
RUN.reverb = function(n, v) {
	const x = I(n, v, 0) * 0.2, fb = 0.7 + clamp(I(n, v, 1), 0, 1) * 0.28, d = clamp(I(n, v, 2), 0, 1) * 0.6, out = [0, 0];
	for (let c = 0; c < 2; c++) {
		const R = n.rv[c];
		let y = 0;
		for (let k = 0; k < 4; k++) {
			const b = R.comb[k], i = R.cp[k], o = b[i];
			R.lp[k] = o * (1 - d) + R.lp[k] * d;
			b[i] = x + R.lp[k] * fb; R.cp[k] = (i + 1) % b.length; y += o;
		}
		for (let k = 0; k < 2; k++) {
			const b = R.ap[k], i = R.apos[k], o = b[i];
			b[i] = y + o * 0.5; R.apos[k] = (i + 1) % b.length; y = o - y;
		}
		out[c] = y;
	}
	const mix = clamp(I(n, v, 3), 0, 1), dry = I(n, v, 0) * (1 - mix);
	v[n.o] = dry + out[0] * mix; v[n.o + 1] = dry + out[1] * mix;
};
RUN.chorus = function(n, v, e) {
	const b = n.buf, len = b.length, x = I(n, v, 0);
	b[n.pos] = x;
	n.ph += clamp(I(n, v, 1), 0.01, 20) / e.sr; if (n.ph >= 1) n.ph -= 1;
	const dep = clamp(I(n, v, 2), 0, 1) * 0.006 * e.sr, base = 0.008 * e.sr, mix = clamp(I(n, v, 3), 0, 1);
	for (let c = 0; c < 2; c++) {
		let p = n.pos - (base + dep * (1 + Math.sin(2 * Math.PI * (n.ph + c * 0.25))) * 0.5); if (p < 0) p += len;
		const i = p | 0, f = p - i, y = b[i] * (1 - f) + b[(i + 1) % len] * f;
		v[n.o + c] = x * (1 - mix * 0.5) + y * mix;
	}
	n.pos = (n.pos + 1) % len;
};
RUN.rec = function(n, v) {
	const b = n.buf, x = I(n, v, 0), rec = I(n, v, 1) > 0.5, speed = I(n, v, 3), loop = I(n, v, 4) > 0.5;
	if (rise(n, "rh", I(n, v, 1))) { n.len = 0; n.playing = false; }
	if (rec) { if (n.len < b.length) b[n.len++] = x; v[n.o] = x; v[n.o + 1] = 0; return; } // monitors IN while recording
	if (rise(n, "ph2", I(n, v, 2)) && n.len > 1) { n.playing = true; n.pos = speed < 0 ? n.len - 1 : 0; }
	let y = 0;
	if (n.playing && n.len > 1) {
		const i = n.pos | 0, f = n.pos - i;
		y = b[i] * (1 - f) + b[Math.min(n.len - 1, i + 1)] * f;
		n.pos += speed;
		if (n.pos >= n.len - 1 || n.pos < 0) {
			if (loop) n.pos = speed < 0 ? n.pos + n.len - 1 : n.pos - (n.len - 1);
			else n.playing = false;
		}
	}
	v[n.o] = y; v[n.o + 1] = n.playing ? 1 : 0;
};
RUN.out = function(n, v, e) {
	const vol = clamp(I(n, v, 2), 0, 1), l = I(n, v, 0), r = n.inIdx[1] >= 0 ? I(n, v, 1) : l;
	e.outs[SLOTS] = fastTanh(l * vol); e.outs[SLOTS + 1] = fastTanh(r * vol);
};

class CustomDSP {
	constructor() {
		this.s = null;
		this.host = null;
		this.outs = new Float32Array(OUT_IDS.length);
		this.ins = new Float32Array(IN_IDS.length);
		this.patched = new Uint8Array(IN_IDS.length);
		this.midiConnected = false;
		this.sr = typeof sampleRate !== "undefined" ? sampleRate : 48000;
		this.nodes = []; this.order = []; this.v = new Float64Array(1); this.byId = {};
		this.sig = null;
		this.pitch = 0; this.gate = false; this.vel = 1; this.gap = 0;
		this.buttons = {};
	}

	setSettings(s) {
		this.s = s;
		const sig = JSON.stringify([ (s.items || []).concat(s.back || []).map(function(i){ return [i.id, i.kind, i.slot, i.mode, i.range]; }), (s.nodes || []).map(function(n){ return [n.id, n.kind]; }), s.wires ]);
		if (sig !== this.sig) { this.sig = sig; this.compile(s); }
		this.update(s);
	}
	setMidiConnected(c) { if (!c && this.midiConnected) this.gate = false; this.midiConnected = c; }

	message(m) {
		switch (m.type) {
			case "midi":
				if (m.pitch !== undefined) this.pitch = m.pitch;
				if (m.velocity !== undefined) this.vel = m.velocity;
				if (m.gate && this.gate && m.retrigger) this.gap = 32;
				this.gate = !!m.gate;
				break;
			case "trigger": this.gate = !!m.gate; break;
			case "btn": this.buttons[m.id] = m.on ? 1 : 0; const n = this.byId[m.id]; if (n) n.target = m.on ? 1 : 0; break;
		}
	}

	// the design into nodes: their output slots, their inputs (a wire, or a constant), the order
	compile(s) {
		const nodes = [], byId = {};
		const add = (src, kind, item) => {
			const spec = specOf(kind);
			if (!spec || spec.deco || !RUN[kind]) return;
			const n = { id: src.id, kind, item, spec, run: RUN[kind], o: 0, inIdx: new Int32Array(spec.ins.length), inConst: new Float64Array(spec.ins.length) };
			// state
			n.ph = 0; n.val = 0; n.stage = 0; n.gate = false; n.s = new Float64Array(2); n.b = new Float64Array(3); n.step = -1; n.ch = n.rh = n.th = false; n.hold = 0; n.peak = 0;
			n.cur = n.target = 0;
			if (kind === "delay") { n.buf = new Float32Array(Math.round(this.sr * 2.05)); n.pos = 0; }
			if (kind === "chorus") { n.buf = new Float32Array(Math.round(this.sr * 0.03)); n.pos = 0; }
			if (kind === "rec") { n.buf = new Float32Array(Math.round(this.sr * 8)); n.len = 0; n.pos = 0; n.playing = false; }
			if (kind === "gdelay") { n.q = []; n.t = 0; }
			if (kind === "reverb") {
				const k = this.sr / 44100;
				n.rv = [0, 23].map((sp) => ({ comb: COMBS.map((l) => new Float32Array(Math.round((l + sp) * k))), cp: [0, 0, 0, 0], lp: [0, 0, 0, 0],
					ap: APS.map((l) => new Float32Array(Math.round((l + sp) * k))), apos: [0, 0] }));
			}
			n.count = 0;
			if (kind === "jackin" || kind === "jackout") { n.slot = clamp((item.slot | 0) - 1, 0, SLOTS - 1); n.mode = item.mode || "cv"; }
			if (kind === "ain" || kind === "aout") n.slot = clamp((item.slot | 0) - 1, 0, ASLOTS - 1);
			nodes.push(n); byId[n.id] = n;
		};
		(s.items || []).concat(s.back || []).forEach((it) => add(it, it.kind, it));
		(s.nodes || []).forEach((nd) => add(nd, nd.kind, null));
		let o = 0;
		for (const n of nodes) { n.o = o; o += Math.max(1, n.spec.outs.length); }
		const v = new Float64Array(o + 1);
		const wires = s.wires || [];
		for (const n of nodes) {
			n.deps = [];
			n.spec.ins.forEach((inp, k) => {
				const w = wires.find((w) => w.to[0] === n.id && w.to[1] === inp[0]);
				const src = w && byId[w.from[0]], oi = src ? src.spec.outs.indexOf(w.from[1]) : -1;
				n.inIdx[k] = src && oi >= 0 ? src.o + oi : -1;
				if (src && oi >= 0) n.deps.push(src);
			});
		}
		// dependency order (depth first); a loop reads the previous sample
		const order = [], mark = {};
		const visit = (n) => { if (mark[n.id]) return; mark[n.id] = 1; for (const d of n.deps) visit(d); order.push(n); };
		nodes.forEach(visit);
		// the controls keep their values across a recompile
		for (const n of nodes) { const old = this.byId[n.id]; if (old && old.kind === n.kind) { n.cur = old.cur; n.target = old.target; n.ph = old.ph; } }
		this.nodes = nodes; this.order = order; this.byId = byId; this.v = v;
		this.outs.fill(0);
	}

	// values that need no recompile: the controls, the inputs' constants
	update(s) {
		const items = {};
		(s.items || []).concat(s.back || []).forEach((i) => items[i.id] = i);
		const consts = {};
		(s.nodes || []).forEach((nd) => consts[nd.id] = nd.consts || {});
		for (const n of this.nodes) {
			const it = items[n.id];
			if (n.kind === "knob" || n.kind === "slider") {
				const r = controlRange(s, it);
				n.target = fromN(r, it.value === undefined ? toN(r, r.def) : it.value);
				if (n.fresh === undefined) { n.cur = n.target; n.fresh = false; }
			}
			else if (n.kind === "toggle") n.target = it.on ? 1 : 0;
			else if (n.kind === "button") n.target = this.buttons[n.id] || 0;
			const c = consts[n.id] || {};
			n.spec.ins.forEach((inp, k) => { n.inConst[k] = c[inp[0]] !== undefined ? +c[inp[0]] : inp[4]; });
		}
	}

	beginBlock() {}
	tick() {
		const v = this.v, order = this.order;
		for (let i = 0; i < order.length; i++) order[i].run(order[i], v, this);
		return this.outs[SLOTS];
	}
	endBlock() {}

	state() {
		const leds = {};
		for (const n of this.nodes) if (n.kind === "led") { leds[n.id] = Math.round(clamp(n.peak, 0, 1) * 100) / 100; n.peak *= 0.5; }
		return { leds };
	}
}
CustomDSP.IN_IDS = IN_IDS;
CustomDSP.OUT_IDS = OUT_IDS;
CustomDSP.MIDI_IN = "midi_in";
CustomDSP.CATALOG = { MODULES, CONTROLS, SLOTS, ASLOTS, specOf, controlRange, rangeOf, fromN, toN, fmt, isExp, findItem };

globalThis.WR_DSP = globalThis.WR_DSP || {};
globalThis.WR_DSP.custom = CustomDSP;
globalThis.WR_DSP.custom_half = CustomDSP;

})();
