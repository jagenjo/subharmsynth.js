// devices/mystic.js
// MYSTIC module, a replica of the ASM Hydrasynth (simplified): settings and a panel laid out as the
// Hydrasynth's: CV / GATE jacks, ARPEGGIATOR, MAIN SYSTEMS (the waves after the mutants), MASTER
// CONTROL (8 LED ring encoders around an OLED, editing the module chosen in MODULE SELECT) and FILTER
// CONTROLS. Polyphonic (8 voices): it plays every note of its MIDI channel, so it has no
// sequencer of its own; the song or the keys play it. DSP in mystic-worklet.js.

(function(){

var SIZE = [1568, 560];
var WAVE_NAMES = ["SINE", "TRIANGLE", "SAW", "SQUARE", "PULSE", "ORGAN", "VOX", "DIGITAL"];
var MUT_MODES = [["off", "OFF"], ["fm", "FM-LIN"], ["stack", "WAVSTACK"], ["sync", "OSC SYNC"], ["pw", "PW-ASM"], ["harmonic", "HARMONIC"], ["phazdist", "PHAZDIST"]];
var F1_TYPES = [["lp24", "LP LADDER 24"], ["lp12", "LP 12"], ["bp", "BAND PASS"], ["hp", "HIGH PASS"], ["vowel", "VOWEL"], ["comb", "COMB"]];
var LFO_SHAPES = [["sine", "SINE"], ["tri", "TRIANGLE"], ["saw", "SAW"], ["square", "SQUARE"], ["sh", "S&H"]];
var ARP_MODES = [["up", "UP"], ["down", "DOWN"], ["updown", "UP/DOWN"], ["random", "RANDOM"], ["order", "AS PLAYED"]];
var ARP_DIVS = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];

var JACKS = [
	[["PITCH CV","in","pitch_in"], ["GATE","in","gate_in"], ["MOD 1","in","mod1_in"]],
	[["MOD 2","in","mod2_in"], ["CLOCK","in","clock_in"], ["GATE","out","gate_out"]],
	[["ENV 1","out","env1_out"], ["MOD ENV","out","menv_out"], ["LFO","out","lfo_out"]]
];

var M = null;

function defaults()
{
	return {
		osc: [{ wave: 2, semi: 0, cent: 0 }, { wave: 3, semi: 0, cent: 7 }, { wave: 0, semi: -12, cent: 0 }], // OSC 3: wave index
		mut: [{ mode: "fm", ratio: 2, depth: 0, wet: 1 }, { mode: "pw", ratio: 1, depth: 0, wet: 1 },     // OSC 1
		      { mode: "stack", ratio: 1, depth: 0, wet: 1 }, { mode: "sync", ratio: 2, depth: 0, wet: 1 }], // OSC 2
		mix: { osc1: 0.7, osc2: 0.5, osc3: 0, ring: 0, noise: 0 },
		f1: { type: "lp24", cutoff: 2500, res: 0.25, drive: 0.1, env: 0.35, key: 0.5 },
		f2: { morph: 0, cutoff: 16000, res: 0.1 },
		route: "series",
		env1: { a: 0.005, d: 0.4, s: 0.3, r: 0.4 },   // filter
		env2: { a: 0.005, d: 0.3, s: 0.8, r: 0.5 },   // amp
		env3: { a: 0.001, d: 0.5 },                   // mod (AD)
		menv: { mut: 0, scan: 0 },
		lfo: { rate: 5, shape: "sine", pitch: 0, scan: 0, cutoff: 0, mut: 0 },
		vel: 0.5, volume: 0.7, voice_mode: "poly", glide: 0,
		arp: { on: false, mode: "up", div: 3, oct: 1, gate: 0.5, latch: false, tempo: 120 },
		ui_module: "osc1", ui_filter: 1 // what MASTER CONTROL and FILTER CONTROLS show
	};
}

function enumOf( list, v, def ) { return list.some(function(o){ return o[0] === v; }) ? v : def; }

function validate( s )
{
	var d = defaults();
	s.mut.forEach(function(m){ m.mode = enumOf( MUT_MODES, m.mode, "fm" ); m.ratio = Math.min( 8, Math.max( 0.25, m.ratio ) ); });
	s.f1.type = enumOf( F1_TYPES, s.f1.type, "lp24" );
	s.lfo.shape = enumOf( LFO_SHAPES, s.lfo.shape, "sine" );
	s.arp.mode = enumOf( ARP_MODES, s.arp.mode, "up" );
	s.arp.div = Math.min( ARP_DIVS.length - 1, Math.max( 0, Math.round( s.arp.div ) ) );
	s.arp.oct = Math.min( 4, Math.max( 1, Math.round( s.arp.oct ) ) );
	if(s.route != "series" && s.route != "parallel") s.route = "series";
	if(s.voice_mode != "poly" && s.voice_mode != "mono") s.voice_mode = "poly";
	if(MODULE_ORDER.indexOf( s.ui_module ) < 0) s.ui_module = "osc1";
	s.ui_filter = s.ui_filter == 2 ? 2 : 1;
	s.osc.forEach(function(o, i){ o.wave = Math.min( 7, Math.max( 0, i == 2 ? Math.round( o.wave ) : o.wave ) ); });
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var pick = function(l) { return l[ Math.floor( Math.random() * l.length ) ]; };
	var chance = function(p) { return Math.random() < p; };
	s.osc[0].wave = rnd( 0, 7 ); s.osc[1].wave = rnd( 0, 7 ); s.osc[2].wave = Math.floor( rnd( 0, 8 ) );
	s.osc[1].semi = pick([0, 0, 7, 12, -12, 5]); s.osc[1].cent = rnd( -12, 12 );
	s.mut.forEach(function(m){
		m.mode = pick( MUT_MODES.slice( 1 ) )[0];
		m.ratio = pick([0.5, 1, 1.5, 2, 3, 4, 5, 7]);
		m.depth = chance(0.7) ? rnd( 0, 0.7 ) : 0;
		m.wet = rnd( 0.5, 1 );
	});
	s.mix.osc1 = rnd( 0.4, 0.9 ); s.mix.osc2 = rnd( 0, 0.7 ); s.mix.osc3 = chance(0.3) ? rnd( 0, 0.5 ) : 0;
	s.mix.ring = chance(0.25) ? rnd( 0, 0.5 ) : 0; s.mix.noise = chance(0.2) ? rnd( 0, 0.3 ) : 0;
	s.f1.type = pick( F1_TYPES )[0]; s.f1.cutoff = expRnd( 300, 8000 ); s.f1.res = rnd( 0, 0.7 ); s.f1.env = rnd( -0.2, 0.7 );
	s.f2.morph = chance(0.6) ? 0 : rnd( 0, 1 ); s.f2.cutoff = expRnd( 2000, 20000 );
	s.env2.a = chance(0.7) ? expRnd( 0.001, 0.02 ) : expRnd( 0.05, 1 ); s.env2.d = expRnd( 0.1, 1.5 ); s.env2.s = rnd( 0, 1 ); s.env2.r = expRnd( 0.05, 1.5 );
	s.env1.a = expRnd( 0.001, 0.3 ); s.env1.d = expRnd( 0.05, 1.5 ); s.env1.s = rnd( 0, 0.7 ); s.env1.r = expRnd( 0.05, 1 );
	s.env3.d = expRnd( 0.05, 2 ); s.menv.mut = chance(0.5) ? rnd( -0.5, 0.7 ) : 0; s.menv.scan = chance(0.4) ? rnd( -0.5, 0.5 ) : 0;
	s.lfo.rate = expRnd( 0.1, 8 ); s.lfo.shape = pick( LFO_SHAPES )[0];
	s.lfo.pitch = chance(0.2) ? rnd( 0, 0.3 ) : 0; s.lfo.scan = chance(0.4) ? rnd( 0, 0.5 ) : 0; s.lfo.mut = chance(0.3) ? rnd( 0, 0.4 ) : 0;
}

// ---------------------------------------------------------------------------
// the panel, after the Hydrasynth's: matte black with lighter sections and red titles; CV / GATE
// jacks and the ARPEGGIATOR top left; MASTER CONTROL in the middle, 8 LED ring encoders around a
// white OLED that edit the module picked in MODULE SELECT (a diagram of the signal flow);
// FILTER CONTROLS top right; MAIN SYSTEMS (the waves, the voices) bottom left

var RED = "#ff4b1f", WHITE = "#e9e9e9", SECTION = "#121212", PANEL_BG = "#070707";
var UI_FONT = "Arial, Helvetica, sans-serif";

function t( text, x, y, size, color, align, bold )
{
	ctx.font = (bold ? "bold " : "") + (size || 10) + "px " + UI_FONT;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = color || WHITE;
	ctx.fillText( text, x, y );
}

function panelSection( title, x, y, w, h )
{
	ctx.fillStyle = SECTION;
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 5 ); ctx.fill();
	ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.roundRect( x + 0.5, y + 0.5, w - 1, h - 1, 5 ); ctx.stroke();
	if(title) t( title, x + w / 2, y + 13, 12, RED, "center", true );
}

// a small dark button with red text (lit: glowing) or the white backlit kind; returns { clicked, held }
function hyButton( id, x, y, w, h, text, lit, kind, tooltip )
{
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	var down = ui.active === full && ui.down, dy = down ? 1 : 0;
	ctx.fillStyle = "rgba(0,0,0,0.7)";
	ctx.beginPath(); ctx.roundRect( x + 1, y + 2, w, h, 2 ); ctx.fill();
	if(kind == "white")
	{
		if(lit) { ctx.fillStyle = "rgba(230,240,255,0.18)"; ctx.beginPath(); ctx.roundRect( x - 4, y - 4, w + 8, h + 8, 4 ); ctx.fill(); }
		var g = ctx.createLinearGradient( 0, y, 0, y + h );
		g.addColorStop( 0, lit ? "#ffffff" : "#7a7c80" ); g.addColorStop( 1, lit ? "#d6dde6" : "#55575a" );
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.roundRect( x, y + dy, w, h, 2 ); ctx.fill();
	}
	else
	{
		if(lit) { ctx.fillStyle = "rgba(255,75,31,0.22)"; ctx.beginPath(); ctx.roundRect( x - 3, y - 3, w + 6, h + 6, 4 ); ctx.fill(); }
		ctx.fillStyle = hover ? "#262626" : "#1b1b1b";
		ctx.beginPath(); ctx.roundRect( x, y + dy, w, h, 2 ); ctx.fill();
		ctx.strokeStyle = lit ? RED : "#3a3a3a"; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.roundRect( x + 0.5, y + 0.5 + dy, w - 1, h - 1, 2 ); ctx.stroke();
		var lines = String( text ).split( "\n" );
		lines.forEach(function(l, i){ t( l, x + w / 2, y + h / 2 + dy + (i - (lines.length - 1) / 2) * 9, 8, lit ? "#ff9a7a" : RED, "center", true ); });
	}
	if(hover && tooltip) tip( tooltip, x + w / 2, y + h + 12 );
	return { clicked: clicked, held: down };
}

// ---- the modules, and the 8 parameters each one shows on MASTER CONTROL ----
// a parameter: [label, get(s), set(s, v), min, max, knob options]
function P( label, path, min, max, o )
{
	var keys = path.split( "." );
	var get = function(s) { var v = s; keys.forEach(function(k){ v = v[k]; }); return v; };
	var set = function(s, v) { var o2 = s; keys.slice( 0, -1 ).forEach(function(k){ o2 = o2[k]; }); o2[ keys[ keys.length - 1 ] ] = v; };
	return { label: label, get: get, set: set, min: min, max: max, o: o || {} };
}
// a parameter choosing from a list [[value, NAME], ...]
function PL( label, path, list )
{
	var p = P( label, path, 0, list.length - 1, { step: 1 } );
	var get = p.get, set = p.set;
	p.get = function(s) { return Math.max( 0, list.findIndex(function(o){ return o[0] === get( s ); }) ); };
	p.set = function(s, v) { set( s, list[ Math.round( v ) ][0] ); };
	p.o.format = function(v){ return list[ Math.round( v ) ][1]; };
	p.text = function(v){ return list[ Math.round( v ) ][1]; };
	return p;
}
var fP = function(v){ return Math.round( v * 100 ) + "%"; };
var fS = function(v){ return (v > 0 ? "+" : "") + Math.round( v * 100 ); };
var fT = function(v){ return v >= 1 ? v.toFixed(2) + "s" : Math.round( v * 1000 ) + "ms"; };
var fHz = function(v){ return v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round( v ) + "Hz"; };
var wave = function(v){ var i = Math.floor( v ), f = v - i; return f < 0.03 || i >= 7 ? WAVE_NAMES[ Math.min( 7, i ) ] : WAVE_NAMES[i].substr( 0, 3 ) + ">" + WAVE_NAMES[i + 1].substr( 0, 3 ); };
var oscParams = function(k) {
	var lv = ["mix.osc1", "mix.osc2", "mix.osc3"][k];
	var list = [
		k < 2 ? P( "WAVSCAN", "osc." + k + ".wave", 0, 7, { def: k ? 3 : 2, format: wave } ) : P( "WAVE", "osc.2.wave", 0, 7, { step: 1, def: 0, format: function(v){ return WAVE_NAMES[ v | 0 ]; } } ),
		P( "SEMI", "osc." + k + ".semi", -24, 24, { step: 1, def: 0, bipolar: true, format: function(v){ return (v > 0 ? "+" : "") + v; } } ),
		P( "CENT", "osc." + k + ".cent", -50, 50, { def: 0, bipolar: true, format: function(v){ return (v > 0 ? "+" : "") + Math.round( v ); } } ),
		P( "LEVEL", lv, 0, 1, { def: [0.7, 0.5, 0][k], format: fP } )
	];
	if(k < 2) list.push( P( "ENV3>SCAN", "menv.scan", -1, 1, { def: 0, bipolar: true, format: fS } ), P( "LFO>SCAN", "lfo.scan", 0, 1, { def: 0, format: fP } ) );
	return list;
};
var mutParams = function(i) {
	return [
		PL( "MODE", "mut." + i + ".mode", MUT_MODES ),
		P( "RATIO", "mut." + i + ".ratio", 0.25, 8, { exp: true, def: 2, format: function(v){ return v.toFixed(2); } } ),
		P( "DEPTH", "mut." + i + ".depth", 0, 1, { def: 0, format: fP } ),
		P( "DRY/WET", "mut." + i + ".wet", 0, 1, { def: 1, format: fP } ),
		P( "ENV3>MUT", "menv.mut", -1, 1, { def: 0, bipolar: true, format: fS } ),
		P( "LFO>MUT", "lfo.mut", 0, 1, { def: 0, format: fP } )
	];
};
var envParams = function(e, adsr) {
	var list = [ P( "ATTACK", e + ".a", 0.001, 10, { exp: true, def: 0.005, format: fT } ), P( "DECAY", e + ".d", 0.002, 10, { exp: true, def: 0.4, format: fT } ) ];
	if(adsr) list.push( P( "SUSTAIN", e + ".s", 0, 1, { def: 0.5, format: fP } ), P( "RELEASE", e + ".r", 0.002, 10, { exp: true, def: 0.4, format: fT } ) );
	return list;
};
var MODULES = {
	osc1: { name: "OSC 1", params: function(){ return oscParams( 0 ); } },
	osc2: { name: "OSC 2", params: function(){ return oscParams( 1 ); } },
	osc3: { name: "OSC 3", params: function(){ return oscParams( 2 ); } },
	mut1: { name: "MUTANT 1", params: function(){ return mutParams( 0 ); } },
	mut2: { name: "MUTANT 2", params: function(){ return mutParams( 1 ); } },
	mut3: { name: "MUTANT 3", params: function(){ return mutParams( 2 ); } },
	mut4: { name: "MUTANT 4", params: function(){ return mutParams( 3 ); } },
	ring: { name: "RING-NOISE", params: function(){ return [ P( "RING MOD", "mix.ring", 0, 1, { def: 0, format: fP } ), P( "NOISE", "mix.noise", 0, 1, { def: 0, format: fP } ) ]; } },
	mixer: { name: "MIXER", params: function(){ return [ P( "OSC 1", "mix.osc1", 0, 1, { def: 0.7, format: fP } ), P( "OSC 2", "mix.osc2", 0, 1, { def: 0.5, format: fP } ),
		P( "OSC 3", "mix.osc3", 0, 1, { def: 0, format: fP } ), P( "RING", "mix.ring", 0, 1, { def: 0, format: fP } ), P( "NOISE", "mix.noise", 0, 1, { def: 0, format: fP } ) ]; } },
	filter1: { name: "FILTER 1", params: function(){ return [ PL( "TYPE", "f1.type", F1_TYPES ), P( "CUTOFF", "f1.cutoff", 20, 20000, { exp: true, def: 2500, format: fHz } ),
		P( "RESONANCE", "f1.res", 0, 1, { def: 0.25, format: fP } ), P( "DRIVE", "f1.drive", 0, 1, { def: 0.1, format: fP } ),
		P( "ENV1 AMT", "f1.env", -1, 1, { def: 0.35, bipolar: true, format: fS } ), P( "KEYTRACK", "f1.key", 0, 1, { def: 0.5, format: fP } ),
		P( "LFO>CUT", "lfo.cutoff", 0, 1, { def: 0, format: fP } ), PL( "ROUTING", "route", [["series", "SERIES"], ["parallel", "PARALLEL"]] ) ]; } },
	filter2: { name: "FILTER 2", params: function(){ return [ P( "MORPH", "f2.morph", 0, 1, { def: 0, format: function(v){ return v < 0.25 ? "LP" : (v < 0.75 ? "BP" : "HP") + " " + Math.round( v * 100 ); } } ),
		P( "CUTOFF", "f2.cutoff", 20, 20000, { exp: true, def: 16000, format: fHz } ), P( "RESONANCE", "f2.res", 0, 1, { def: 0.1, format: fP } ),
		PL( "ROUTING", "route", [["series", "SERIES"], ["parallel", "PARALLEL"]] ) ]; } },
	amp: { name: "AMP", params: function(){ return [ P( "VOLUME", "volume", 0, 1, { def: 0.7, format: fP } ), P( "VELOCITY", "vel", 0, 1, { def: 0.5, format: fP } ),
		PL( "VOICES", "voice_mode", [["poly", "POLY 8"], ["mono", "MONO"]] ), P( "GLIDE", "glide", 0, 2, { def: 0, format: function(v){ return v < 0.001 ? "OFF" : fT( v ); } } ) ].concat( envParams( "env2", true ) ); } },
	env1: { name: "ENV 1 (FILTER)", params: function(){ return envParams( "env1", true ).concat([ P( "FILTER AMT", "f1.env", -1, 1, { def: 0.35, bipolar: true, format: fS } ) ]); } },
	env2: { name: "ENV 2 (AMP)", params: function(){ return envParams( "env2", true ).concat([ P( "VELOCITY", "vel", 0, 1, { def: 0.5, format: fP } ) ]); } },
	env3: { name: "ENV 3 (MOD)", params: function(){ return envParams( "env3", false ).concat([ P( ">MUTANTS", "menv.mut", -1, 1, { def: 0, bipolar: true, format: fS } ), P( ">WAVSCAN", "menv.scan", -1, 1, { def: 0, bipolar: true, format: fS } ) ]); } },
	lfo1: { name: "LFO 1", params: function(){ return [ P( "RATE", "lfo.rate", 0.01, 50, { exp: true, def: 5, format: function(v){ return v < 10 ? v.toFixed(2) + "Hz" : Math.round( v ) + "Hz"; } } ), PL( "WAVE", "lfo.shape", LFO_SHAPES ),
		P( ">PITCH", "lfo.pitch", 0, 1, { def: 0, format: fP } ), P( ">WAVSCAN", "lfo.scan", 0, 1, { def: 0, format: fP } ), P( ">CUTOFF", "lfo.cutoff", 0, 1, { def: 0, format: fP } ), P( ">MUTANTS", "lfo.mut", 0, 1, { def: 0, format: fP } ) ]; } }
};
var MODULE_ORDER = ["osc1", "mut1", "mut2", "osc2", "mut3", "mut4", "osc3", "ring", "mixer", "filter1", "filter2", "amp", "env1", "env2", "env3", "lfo1"];

function drawBackground( w, h )
{
	// aluminium end cheeks, matte black panel
	[0, w - 22].forEach(function(x){
		var g = ctx.createLinearGradient( x, 0, x + 22, 0 );
		g.addColorStop( 0, "#6d7074" ); g.addColorStop( 0.45, "#d9dcdf" ); g.addColorStop( 1, "#8a8d91" );
		ctx.fillStyle = g;
		ctx.fillRect( x, 0, 22, h );
	});
	ctx.fillStyle = PANEL_BG;
	ctx.fillRect( 22, 0, w - 44, h );
	// the name: an orange wave emblem and the name in white
	var x = 46, y = 30;
	ctx.fillStyle = "#ff5a1f";
	ctx.beginPath(); ctx.roundRect( x, y, 54, 34, 6 ); ctx.fill();
	ctx.strokeStyle = "#0a0a0a"; ctx.lineWidth = 3;
	ctx.beginPath();
	for(var i = 0; i <= 40; ++i) { var px = x + 7 + i, py = y + 17 - Math.sin( i / 40 * Math.PI * 2 ) * 9 * (1 - i / 60); i ? ctx.lineTo( px, py ) : ctx.moveTo( px, py ); }
	ctx.stroke();
	ctx.font = "bold 22px " + UI_FONT;
	ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	ctx.fillStyle = WHITE;
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "3px";
	ctx.fillText( "MYSTIC", x, y + 66 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
	t( "WAVE MORPHING SYNTHESIZER", x, y + 82, 8, "#9a9a9a", "left" );
}

function drawLeft( h )
{
	var s = M.settings;
	s.volume = knob( "volume", 98, 190, 24, s.volume, 0, 1, { def: 0.7, format: function(v){ return "MASTER VOLUME " + fP( v ); } } );
	t( "MASTER", 98, 230, 9 ); t( "VOLUME", 98, 241, 9 );
	t( "VOICE", 98, 280, 9, "#9a9a9a" );
	if(hyButton( "poly", 58, 292, 38, 18, "POLY", s.voice_mode == "poly", "red", "8 VOICES" ).clicked) s.voice_mode = "poly";
	if(hyButton( "mono", 100, 292, 38, 18, "MONO", s.voice_mode == "mono", "red", "ONE VOICE, LEGATO" ).clicked) s.voice_mode = "mono";
	s.glide = knob( "glide", 98, 360, 16, s.glide, 0, 2, { def: 0, format: function(v){ return v < 0.001 ? "GLIDE OFF" : "GLIDE " + fT( v ); } } );
	t( "GLIDE", 98, 388, 9 );
	s.vel = knob( "vel", 98, 438, 16, s.vel, 0, 1, { def: 0.5, format: function(v){ return "VELOCITY " + fP( v ); } } );
	t( "VELOCITY", 98, 466, 9 );
}

function drawCv()
{
	panelSection( "CV / GATE", 170, 14, 540, 88 );
	t( "INPUTS", 300, 30, 8, "#9a9a9a" ); t( "OUTPUTS", 575, 30, 8, "#9a9a9a" );
	[["pitch_in", "PITCH", "in"], ["gate_in", "GATE", "in"], ["mod1_in", "MOD 1", "in"], ["mod2_in", "MOD 2", "in"], ["clock_in", "CLOCK", "in"]].forEach(function(j, i){
		drawJack( j[0], 200 + i * 50, 74, j[1], j[2] );
	});
	[["gate_out", "GATE", "out"], ["env1_out", "ENV 1", "out"], ["menv_out", "ENV 3", "out"], ["lfo_out", "LFO 1", "out"]].forEach(function(j, i){
		drawJack( j[0], 500 + i * 50, 74, j[1], j[2] );
	});
}

function drawArp()
{
	var a = M.settings.arp;
	panelSection( "ARPEGGIATOR", 170, 112, 540, 178 );
	var y = 168, row2 = 238;
	a.tempo = knob( "arp_tempo", 220, y, 17, a.tempo, 30, 300, { exp: true, def: 120, format: function(v){ return Math.round( v ) + " BPM (MIDI CLOCK / CLOCK IN WIN)"; } } );
	t( "TEMPO", 220, y + 28, 9 );
	a.gate = knob( "arp_gate", 300, y, 17, a.gate, 0.05, 1, { def: 0.5, format: fP } );
	t( "GATE", 300, y + 28, 9 );
	var mi = Math.max( 0, ARP_MODES.findIndex(function(o){ return o[0] == a.mode; }) );
	mi = knob( "arp_mode", 380, y, 17, mi, 0, ARP_MODES.length - 1, { step: 1, def: 0, format: function(v){ return ARP_MODES[v][1]; } } );
	a.mode = ARP_MODES[ mi ][0];
	t( "MODE", 380, y + 28, 9 );
	a.oct = knob( "arp_oct", 460, y, 17, a.oct, 1, 4, { step: 1, def: 1, format: function(v){ return v + " OCTAVE" + (v > 1 ? "S" : ""); } } );
	t( "OCTAVE", 460, y + 28, 9 );
	a.div = knob( "arp_div", 540, y, 17, a.div, 0, ARP_DIVS.length - 1, { step: 1, def: 3, format: function(v){ return ARP_DIVS[v]; } } );
	t( "DIVISION", 540, y + 28, 9 );
	t( ARP_MODES[ mi ][1] + " · " + ARP_DIVS[ a.div ] + " · " + a.oct + " OCT", 620, y - 4, 9, "#9a9a9a" );
	if(hyButton( "arp_on", 590, y + 10, 60, 20, "ARP ON", a.on, "red", "THE ARPEGGIATOR" ).clicked) a.on = !a.on;
	if(hyButton( "arp_latch", 220 - 30, row2, 60, 20, "LATCH", a.latch, "red", "KEEP PLAYING AFTER THE KEYS ARE RELEASED" ).clicked) a.latch = !a.latch;
	var st = M.state || {};
	t( a.on ? ((st.arp || []).length ? "ARP: " + st.arp.map( noteName ).join(" ") : "ARP: HOLD SOME KEYS") : "", 270, row2 + 10, 9, "#9a9a9a", "left" );
}

// the voices and the waves after their mutants, on a white OLED
function drawMain( h )
{
	panelSection( "MAIN SYSTEMS", 170, 300, 540, h - 314 );
	var x = 190, y = 324, w = 500, hh = h - 352, st = M.state || {}, s = M.settings;
	ctx.fillStyle = "#000";
	ctx.beginPath(); ctx.roundRect( x - 4, y - 4, w + 8, hh + 8, 3 ); ctx.fill();
	var trace = function(pts, x0, label) {
		var tw = w * 0.5 - 24, mid = y + hh * 0.52, amp = hh * 0.3;
		ctx.strokeStyle = "#f0f4f8"; ctx.lineWidth = 1.4;
		ctx.beginPath();
		(pts || []).forEach(function(v, i){ var px = x0 + i / (pts.length - 1) * tw, py = mid - Math.max( -1.2, Math.min( 1.2, v ) ) * amp; i ? ctx.lineTo( px, py ) : ctx.moveTo( px, py ); });
		ctx.stroke();
		t( label, x0, y + 10, 9, "#f0f4f8", "left", true );
	};
	var wv = st.wave || [];
	var mutName = function(i){ var m = s.mut[i]; return m.depth > 0.0005 && m.mode != "off" ? (MUT_MODES.find(function(o){ return o[0] == m.mode; }) || ["", ""])[1] : "-"; };
	trace( wv[0], x + 10, "OSC 1  " + mutName( 0 ) + " / " + mutName( 1 ) );
	trace( wv[1], x + w * 0.5 + 10, "OSC 2  " + mutName( 2 ) + " / " + mutName( 3 ) );
	ctx.fillStyle = "#3a3a3a"; ctx.fillRect( x + w * 0.5, y + 4, 1, hh - 8 );
	var notes = (st.gates || []).filter(function(n){ return n >= 0; }).map( noteName );
	t( (st.voices || 0) + "/8 VOICES" + (notes.length ? "  " + notes.slice( 0, 6 ).join(" ") : ""), x + w - 6, y + hh - 9, 9, "#f0f4f8", "right" );
}

function drawMasterControl( h )
{
	var s = M.settings, mod = MODULES[ s.ui_module ] || MODULES.osc1, params = mod.params();
	var X0 = 724, W = 450;
	panelSection( "MASTER CONTROL", X0, 14, W, h - 28 );
	var cols = [X0 + 60, X0 + 150, X0 + 240, X0 + 330], topY = 76, botY = h - 66;
	var oledY = 150, oledH = h - 300;
	// OLED
	ctx.fillStyle = "#000";
	ctx.beginPath(); ctx.roundRect( X0 + 18, oledY, 366, oledH, 3 ); ctx.fill();
	t( mod.name, X0 + 30, oledY + 12, 10, "#f0f4f8", "left", true );
	t( "PAGE " + (MODULE_ORDER.indexOf( s.ui_module ) + 1) + "/" + MODULE_ORDER.length, X0 + 372, oledY + 12, 9, "#9aa0a6", "right" );
	ctx.fillStyle = "#2c2c2c"; ctx.fillRect( X0 + 26, oledY + 22, 350, 1 );
	for(var k = 0; k < 8; ++k)
	{
		var p = params[k], col = k % 4, top = k < 4;
		var cx = cols[ col ], ky = top ? topY : botY;
		var by = top ? topY + 34 : botY - 50;
		// the parameter on the OLED: name and value
		var ty = oledY + (top ? 40 : oledH - 40);
		if(p)
		{
			var v = p.get( s ), o = {};
			for(var key in p.o) o[key] = p.o[key];
			o.format = function(pp){ return function(val){ return pp.label + ": " + (pp.o.format ? pp.o.format( val ) : val); }; }( p );
			var nv = knob( "enc" + k, cx, ky, 20, v, p.min, p.max, o );
			if(nv !== v) p.set( s, nv );
			t( p.label, cx, ty, 9, "#f0f4f8", "center", true );
			t( p.o.format ? p.o.format( p.get( s ) ) : String( p.get( s ) ), cx, ty + 15, 12, "#f0f4f8", "center", true );
			if(hyButton( "encbtn" + k, cx - 16, by, 32, 14, "", true, "white", "RESET " + p.label ).clicked && p.o.def !== undefined) p.set( s, p.o.def );
		}
		else
		{
			drawSkinKnob( "ledring", cx, ky, 20, -1, false ); // nothing on this one: all LEDs off
			t( "-", cx, ty + 8, 10, "#555" );
			hyButton( "encbtn" + k, cx - 16, by, 32, 14, "", false, "white" );
		}
		t( String( k + 1 ), cx, top ? by + 24 : by - 9, 9 );
	}
	ctx.fillStyle = "#2c2c2c"; ctx.fillRect( X0 + 26, oledY + oledH / 2, 350, 1 );
	// PAGE: the previous / next module
	var i = MODULE_ORDER.indexOf( s.ui_module );
	if(hyButton( "page_up", X0 + 398, oledY + 20, 36, 22, "▲", false, "red", "PREVIOUS MODULE" ).clicked) s.ui_module = MODULE_ORDER[ (i + MODULE_ORDER.length - 1) % MODULE_ORDER.length ];
	if(hyButton( "page_down", X0 + 398, oledY + 48, 36, 22, "▼", false, "red", "NEXT MODULE" ).clicked) s.ui_module = MODULE_ORDER[ (i + 1) % MODULE_ORDER.length ];
	t( "PAGE", X0 + 416, oledY + 84, 9 );
	if(hyButton( "init", X0 + 398, oledY + oledH - 26, 36, 22, "INIT", false, "red", "THIS MODULE'S PARAMETERS TO THEIR DEFAULTS" ).clicked)
		params.forEach(function(p){ if(p.o.def !== undefined) p.set( s, p.o.def ); else if(p.text) p.set( s, 0 ); });
}

function drawFilterControls()
{
	var s = M.settings, f2 = s.ui_filter == 2;
	panelSection( "FILTER CONTROLS", 1188, 14, 358, 136 );
	var ks = [1230, 1290, 1350, 1410, 1470], y = 76;
	if(f2)
	{
		s.f2.cutoff = knob( "fc_cut", ks[0], y, 19, s.f2.cutoff, 20, 20000, { exp: true, def: 16000, format: function(v){ return "FILTER 2 CUTOFF " + fmtHz( v ); } } );
		s.f2.res = knob( "fc_res", ks[1], y, 19, s.f2.res, 0, 1, { def: 0.1, format: function(v){ return "FILTER 2 RESONANCE " + fP( v ); } } );
		s.f2.morph = knob( "fc_drive", ks[2], y, 19, s.f2.morph, 0, 1, { def: 0, format: function(v){ return "FILTER 2 MORPH: LP > BP > HP " + fP( v ); } } );
	}
	else
	{
		s.f1.cutoff = knob( "fc_cut", ks[0], y, 19, s.f1.cutoff, 20, 20000, { exp: true, def: 2500, format: function(v){ return "FILTER 1 CUTOFF " + fmtHz( v ); } } );
		s.f1.res = knob( "fc_res", ks[1], y, 19, s.f1.res, 0, 1, { def: 0.25, format: function(v){ return "FILTER 1 RESONANCE " + fP( v ); } } );
		s.f1.drive = knob( "fc_drive", ks[2], y, 19, s.f1.drive, 0, 1, { def: 0.1, format: function(v){ return "FILTER 1 DRIVE " + fP( v ); } } );
	}
	s.f1.env = knob( "fc_env", ks[3], y, 19, s.f1.env, -1, 1, { def: 0.35, bipolar: true, format: function(v){ return "ENV 1 > FILTER 1 " + fS( v ); } } );
	s.lfo.cutoff = knob( "fc_lfo", ks[4], y, 19, s.lfo.cutoff, 0, 1, { def: 0, format: function(v){ return "LFO 1 > CUTOFF " + fP( v ); } } );
	["CUTOFF", "RESONANCE", f2 ? "MORPH" : "DRIVE", "ENV 1", "LFO 1"].forEach(function(l, i){ t( l, ks[i], y + 36, 8 ); });
	if(hyButton( "filt1", 1504, 40, 34, 22, "FILTER\n1", !f2, "red" ).clicked) s.ui_filter = 1;
	if(hyButton( "filt2", 1504, 70, 34, 22, "FILTER\n2", f2, "red" ).clicked) s.ui_filter = 2;
}

// the signal flow: oscillators through their mutants into the mixer, the filters, the amp; the
// envelopes above, the LFO below. A button shows its module on MASTER CONTROL
function drawModuleSelect( h )
{
	var s = M.settings;
	panelSection( "MODULE SELECT", 1188, 160, 358, h - 174 );
	var bw = 46, bh = 20;
	var pos = {
		env1: [1290, 196], env2: [1345, 196], env3: [1400, 196],
		osc1: [1206, 250], mut1: [1262, 250], mut2: [1318, 250],
		osc2: [1206, 298], mut3: [1262, 298], mut4: [1318, 298],
		osc3: [1206, 346], ring: [1262, 346],
		mixer: [1382, 298], filter1: [1442, 270], filter2: [1442, 326], amp: [1496, 298],
		lfo1: [1345, 400]
	};
	var names = { env1: "ENV 1", env2: "ENV 2", env3: "ENV 3", osc1: "OSC\n1", osc2: "OSC\n2", osc3: "OSC\n3", mut1: "MUTANT\n1", mut2: "MUTANT\n2", mut3: "MUTANT\n3", mut4: "MUTANT\n4",
		ring: "RING-\nNOISE", mixer: "MIXER", filter1: "FILTER\n1", filter2: "FILTER\n2", amp: "AMP", lfo1: "LFO 1" };
	var c = function(k, dx, dy) { var p = pos[k]; return [ p[0] + bw / 2 + (dx || 0) * bw / 2, p[1] + bh / 2 + (dy || 0) * bh / 2 ]; };
	ctx.strokeStyle = "#5a5a5a"; ctx.lineWidth = 1.2;
	var line = function(pts) { ctx.beginPath(); pts.forEach(function(p, i){ i ? ctx.lineTo( p[0], p[1] ) : ctx.moveTo( p[0], p[1] ); }); ctx.stroke(); };
	line([ c( "osc1", 1 ), c( "mut1", -1 ) ]); line([ c( "mut1", 1 ), c( "mut2", -1 ) ]);
	line([ c( "osc2", 1 ), c( "mut3", -1 ) ]); line([ c( "mut3", 1 ), c( "mut4", -1 ) ]);
	line([ c( "osc3", 1 ), c( "ring", -1 ) ]);
	line([ c( "mut2", 1 ), [ 1372, c( "mut2" )[1] ], [ 1372, c( "mixer" )[1] ], c( "mixer", -1 ) ]);
	line([ c( "mut4", 1 ), c( "mixer", -1 ) ]);
	line([ c( "ring", 1 ), [ 1372, c( "ring" )[1] ], [ 1372, c( "mixer" )[1] ] ]);
	line([ c( "mixer", 1 ), [ 1436, c( "mixer" )[1] ], [ 1436, c( "filter1" )[1] ], c( "filter1", -1 ) ]);
	line([ [ 1436, c( "mixer" )[1] ], [ 1436, c( "filter2" )[1] ], c( "filter2", -1 ) ]);
	line([ c( "filter1", 1 ), [ 1492, c( "filter1" )[1] ], [ 1492, c( "amp" )[1] ], c( "amp", -1 ) ]);
	line([ c( "filter2", 1 ), [ 1492, c( "filter2" )[1] ], [ 1492, c( "amp" )[1] ] ]);
	ctx.setLineDash && ctx.setLineDash([ 3, 3 ]);
	line([ c( "env1", 0, 1 ), [ c( "env1" )[0], 240 ] ]); line([ c( "env2", 0, 1 ), [ c( "env2" )[0], 240 ] ]); line([ c( "env3", 0, 1 ), [ c( "env3" )[0], 240 ] ]);
	line([ [ 1220, 240 ], [ 1530, 240 ] ]);
	line([ c( "lfo1", 0, -1 ), [ c( "lfo1" )[0], 384 ] ]); line([ [ 1220, 384 ], [ 1530, 384 ] ]);
	ctx.setLineDash && ctx.setLineDash([]);
	t( "MOD SOURCES", 1220, 232, 7, "#7a7a7a", "left" ); t( "MODULATION", 1220, 392, 7, "#7a7a7a", "left" );
	MODULE_ORDER.forEach(function(k){
		var p = pos[k];
		if(hyButton( "mod_" + k, p[0], p[1], bw, bh, names[k], s.ui_module == k, "red", MODULES[k].name + " ON MASTER CONTROL" ).clicked) s.ui_module = k;
	});
	// the output
	t( "OUT", 1530, c( "amp" )[1] + 22, 8, "#9a9a9a" );
}

function drawPanel()
{
	var w = SIZE[0], h = SIZE[1];
	drawBackground( w, h );
	drawLeft( h );
	drawCv();
	drawArp();
	drawMain( h );
	drawMasterControl( h );
	drawFilterControls();
	drawModuleSelect( h );
}

WR.registerSynth( "mystic", {
	title: "MYSTIC",
	description: "MYSTIC: polyphonic wave morphing synthesizer with mutators",
	about: "After the ASM Hydrasynth: 8 voices, wave-scanning oscillators with mutants, two filters, three envelopes, an arpeggiator. Edit pages around an OLED.",
	category: "Synths",
	worklet: "devices/mystic-worklet.js",
	jacks: JACKS,
	rear_jacks: [["AUDIO OUT", "aout", "audio"]],
	audio_out: "audio",
	midi_in: "midi_in",
	knob_skin: "ledring",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: function( mod ) {
		M = mod;
		M.state = M.state || { voices: 0, gates: [], lfo: 0, arp: [], wave: null };
		drawPanel();
		M = null;
	},
	transport: function( mod, action, value ) {
		if(action == "trigger") mod.post({ type: "trigger", gate: value }); // T plays C4
	}
});

})();
