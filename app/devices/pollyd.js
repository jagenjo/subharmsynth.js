// devices/pollyd.js
// PARA D module, a four-oscillator, four-voice paraphonic analog synthesizer in the classic style. Its
// panel is laid out as the original's tilted front: CONTROLLERS, OSCILLATOR BANK, MIXER, MODIFIERS and
// OUTPUT (with the chorus and the distortion), black with white print, black knobs with numbered
// scales, blue and orange rocker switches. Below, on the keyboard deck: the pitch and mod wheels, glide,
// LFO and transpose, the sequencer / arpeggiator, and the CV sockets of its back panel. Wooden sides.
// DSP in pollyd-worklet.js.

(function(){

var SIZE = [1568, 700];
var DECK_Y = 496;                       // the keyboard deck under the tilted panel
var BLUE = "#2f6db5", ORANGE = "#e2741f", WHITE = "#e9e6de", INK = "#f2f0ea", DIM = "#8d8a83";
var RANGES = ["LO", "32'", "16'", "8'", "4'", "2'"];
var ARP_NAMES = ["UP", "DOWN", "INC", "EXC", "RANDOM", "ORDER", "UP 2 OCT", "DOWN 2 OCT"];
var MODES = ["mono", "unison", "poly"];

var JACKS = [[
	["PITCH", "out", "pitch_out"], ["V-TRIG", "out", "vtrig_out"], ["VELOCITY", "out", "vel_out"], ["SYNC OUT", "out", "sync_out"],
	["SYNC IN", "in", "sync_in"], ["EXT V-TRIG", "in", "vtrig_in"], ["LOUDNESS", "in", "loud_in"], ["FILTER", "in", "filter_in"],
	["OSCILLATOR", "in", "osc_in"], ["MOD SOURCE", "in", "mod_in"]
]];
var REAR_JACKS = [["OUT L", "aout", "out_l"], ["OUT R", "aout", "out_r"], ["EXT SIGNAL IN", "ain", "ext_in"]];

var M = null, S = null, ST = null;
var uis = {};      // module id -> { shift, patsel, setEnd, wheel, audition }

function emptySteps() { var a = []; for(var i = 0; i < 32; ++i) a.push({ notes: [], accent: false, glide: false, ratchet: 1 }); return a; }

function defaults()
{
	var patterns = [];
	for(var p = 0; p < 8; ++p) patterns.push({ len: 16, steps: emptySteps() });
	// pattern 1: four chords, a beat each, the last one tied into a glide
	var st = patterns[0].steps;
	[[0, [48, 55, 60, 63]], [4, [46, 53, 58, 62]], [8, [44, 51, 56, 60]], [12, [43, 50, 55, 59]]].forEach(function(c){
		st[c[0]].notes = c[1]; st[c[0]].accent = c[0] == 0;
		st[c[0] + 2].notes = c[1].slice( 1 );
	});
	var osc = [];
	for(var i = 0; i < 4; ++i) osc.push({ range: 3, wave: 2, fine: 0, vol: 0.75, on: true });
	osc[1].fine = 0.06; osc[2].fine = -0.05; osc[3].fine = 0.03;
	return {
		osc: osc, tune: 0, transpose: 0,
		noise: { vol: 0.5, on: false, pink: false }, ext: { vol: 0.5, on: false },
		mode: "poly", auto_damp: true, glide: 0.12, glide_on: false,
		osc_mod: false, filter_mod: false, osc4_ctrl: true, mod_mix: 0.5, mod_src1: "osc4", mod_src2: "lfo", mod_wheel: 0,
		lfo_rate: 5, lfo_wave: "tri",
		cutoff: 1800, emphasis: 0.25, contour: 0.45, kbd: 1, hp: false,
		f_attack: 0.01, f_decay: 0.6, f_sustain: 0.35, decay_sw: true,
		l_attack: 0.005, l_decay: 0.8, l_sustain: 0.85,
		chorus: { on: true, i: true, ii: false },
		dist: { on: false, amount: 0.4, tone: 0.5, level: 0.7 },
		volume: 0.7, vel_adj: 1,
		seq: { tempo: 120, sync: false, gate: 0.5, swing: 0, arp: false, arp_mode: 0, latch: false, hold: false,
			rec: false, pattern: 0, page: 0, cursor: 0, patterns: patterns }
	};
}

function validate( s, raw )
{
	var num = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	s.osc.forEach(function(o){ o.range = Math.round( num( o.range, 0, 5, 3 ) ); o.wave = Math.round( num( o.wave, 0, 5, 2 ) ); o.fine = num( o.fine, -7, 7, 0 ); o.vol = num( o.vol, 0, 1, 0.7 ); o.on = !!o.on; });
	if(MODES.indexOf( s.mode ) < 0) s.mode = "poly";
	s.kbd = Math.round( num( s.kbd, 0, 3, 1 ) );
	s.transpose = Math.round( num( s.transpose, -1, 1, 0 ) );
	s.tune = num( s.tune, -2, 2, 0 );
	if(s.mod_src1 != "feg") s.mod_src1 = "osc4";
	if(s.mod_src2 != "noise") s.mod_src2 = "lfo";
	if(s.lfo_wave != "square") s.lfo_wave = "tri";
	var q = s.seq, rp = raw && raw.seq && Array.isArray( raw.seq.patterns ) ? raw.seq.patterns : null;
	var pats = [];
	for(var p = 0; p < 8; ++p)
	{
		var src = rp ? rp[p] : q.patterns[p];
		var pat = { len: Math.round( num( src && src.len, 1, 32, 16 ) ), steps: emptySteps() };
		if(src && Array.isArray( src.steps ))
			src.steps.slice( 0, 32 ).forEach(function(x, i){
				if(!x || typeof x != "object") return;
				pat.steps[i] = {
					notes: (Array.isArray( x.notes ) ? x.notes : []).filter(function(n){ return typeof n == "number" && isFinite( n ); }).map(function(n){ return Math.round( num( n, 0, 127, 60 ) ); }).slice( 0, 4 ),
					accent: !!x.accent, glide: !!x.glide, ratchet: Math.round( num( x.ratchet, 1, 4, 1 ) )
				};
			});
		pats.push( pat );
	}
	q.patterns = pats;
	q.pattern = Math.round( num( q.pattern, 0, 7, 0 ) );
	q.page = Math.round( num( q.page, 0, 3, 0 ) );
	q.cursor = Math.round( num( q.cursor, 0, 31, 0 ) );
	q.arp_mode = Math.round( num( q.arp_mode, 0, 7, 0 ) );
	q.tempo = num( q.tempo, 30, 300, 120 );
	q.gate = num( q.gate, 0.05, 1, 0.5 );
	q.swing = num( q.swing, 0, 0.75, 0 );
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var exp = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var chance = function(p) { return Math.random() < p; };
	s.osc.forEach(function(o, i){
		o.range = i == 3 && chance(0.2) ? 0 : [2, 3, 3, 3, 4][ Math.floor( Math.random() * 5 ) ];
		o.wave = Math.floor( Math.random() * 6 );
		o.fine = i ? (chance(0.2) ? [7, 5, -5, 12 % 8][ Math.floor( Math.random() * 4 ) ] : rnd( -0.12, 0.12 )) : 0;
		o.vol = rnd( 0.4, 0.9 ); o.on = i == 0 || chance(0.75);
	});
	s.cutoff = exp( 200, 6000 ); s.emphasis = rnd( 0, 0.8 ); s.contour = rnd( 0, 0.8 ); s.kbd = Math.floor( Math.random() * 4 );
	s.f_attack = exp( 0.001, 1.5 ); s.f_decay = exp( 0.05, 3 ); s.f_sustain = rnd( 0, 1 );
	s.l_attack = chance(0.6) ? exp( 0.001, 0.05 ) : exp( 0.05, 2 ); s.l_decay = exp( 0.1, 4 ); s.l_sustain = rnd( 0.3, 1 );
	s.chorus.on = chance(0.6); s.chorus.i = chance(0.7); s.chorus.ii = !s.chorus.i || chance(0.3);
	s.dist.on = chance(0.2); s.glide_on = chance(0.2);
	s.mode = MODES[ Math.floor( Math.random() * 3 ) ];
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }
function uiOf() { return uis[ M.id ] || (uis[ M.id ] = { shift: false, patsel: false, setEnd: false, wheel: 0, audition: null }); }

// ---------------------------------------------------------------------------
// drawing helpers

function T( text, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + (size || 10) + "px " + FONT;
	ctx.fillStyle = color || INK;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillText( text, x, y );
}

function hot( id, x, y, w, h )
{
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	var kb = keyButton( full, x, y, w, h ); // its key on the computer keyboard
	return { hover: hover, clicked: clicked || kb.pressed, held: (ui.active === full && ui.down) || kb.held };
}

// a knob: the numbers 0..10 printed around it (or labels), its name above
function mknob( id, cx, cy, r, value, min, max, label, o )
{
	o = o || {};
	var nums = o.nums || ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
	if(!o.noScale)
		nums.forEach(function(n, i){
			var a = KNOB_A0 + (i / (nums.length - 1)) * KNOB_SWEEP;
			T( n, cx + Math.cos( a ) * (r + 13), cy + Math.sin( a ) * (r + 13) + 1, o.numSize || 8, WHITE, "center", false );
		});
	if(label)
		label.split( "\n" ).forEach(function(l, i, a){ T( l, cx, cy - r - (o.noScale ? 14 : 26) - (a.length - 1 - i) * 10, o.labelSize || 9 ); });
	o.style = "small";
	return knob( id, cx, cy, r, value, min, max, o );
}

// a rotary selector: its positions named around it (or drawn as wave shapes)
function selector( id, cx, cy, r, value, names, label, o )
{
	o = o || {};
	names.forEach(function(n, i){
		var a = KNOB_A0 + (names.length > 1 ? i / (names.length - 1) : 0) * KNOB_SWEEP, x = cx + Math.cos( a ) * (r + 15), y = cy + Math.sin( a ) * (r + 15);
		if(o.glyphs) glyph( n, x, y, i == value ? INK : DIM );
		else T( n, x, y + 1, 8, i == value ? INK : DIM, "center", i == value );
	});
	if(label) T( label, cx, cy - r - 30, 9 );
	return knob( id, cx, cy, r, value, 0, names.length - 1, { step: 1, style: "small", ticks: names.length,
		format: o.format || function(v){ return (label || "") + " " + (o.glyphs ? o.glyphNames[ v ] : names[ v ]); } } );
}

// small wave shapes for the WAVEFORM selectors
function glyph( kind, x, y, color )
{
	var w = 7, h = 4;
	ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
	switch(kind)
	{
		case "tri": ctx.moveTo( x - w, y + h ); ctx.lineTo( x - w / 2, y - h ); ctx.lineTo( x, y + h ); ctx.lineTo( x + w / 2, y - h ); ctx.lineTo( x + w, y + h ); break;
		case "trisaw": ctx.moveTo( x - w, y + h ); ctx.quadraticCurveTo( x - w / 2, y - h * 1.6, x, y - h ); ctx.lineTo( x, y + h ); ctx.quadraticCurveTo( x + w / 2, y - h * 1.6, x + w, y - h ); break;
		case "saw": ctx.moveTo( x - w, y + h ); ctx.lineTo( x, y - h ); ctx.lineTo( x, y + h ); ctx.lineTo( x + w, y - h ); ctx.lineTo( x + w, y + h ); break;
		case "rsaw": ctx.moveTo( x - w, y - h ); ctx.lineTo( x, y + h ); ctx.lineTo( x, y - h ); ctx.lineTo( x + w, y + h ); ctx.lineTo( x + w, y - h ); break;
		default:
			var d = kind == "sq" ? 0.5 : (kind == "wide" ? 0.3 : 0.12);
			ctx.moveTo( x - w, y + h ); ctx.lineTo( x - w, y - h ); ctx.lineTo( x - w + w * d, y - h ); ctx.lineTo( x - w + w * d, y + h ); ctx.lineTo( x, y + h );
			ctx.lineTo( x, y - h ); ctx.lineTo( x + w * d, y - h ); ctx.lineTo( x + w * d, y + h ); ctx.lineTo( x + w, y + h );
	}
	ctx.stroke();
}

// a rocker switch: on = the top half pressed in. caption above, its state below
function rocker( id, cx, cy, on, color, caption, onText, offText, tooltip )
{
	var w = 18, h = 30, x = cx - w / 2, y = cy - h / 2;
	var r = hot( id, x - 4, y - 4, w + 8, h + 8 );
	if(r.clicked) on = !on;
	if(caption) caption.split( "\n" ).forEach(function(l, i, a){ T( l, cx, y - 9 - (a.length - 1 - i) * 10, 8 ); });
	ctx.fillStyle = "#050505"; ctx.fillRect( x - 3, y - 3, w + 6, h + 6 );
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	var dark = shade( color, -0.45 ), light = shade( color, r.hover ? 0.25 : 0.1 );
	if(on) { g.addColorStop( 0, dark ); g.addColorStop( 0.5, color ); g.addColorStop( 0.52, light ); g.addColorStop( 1, color ); }
	else { g.addColorStop( 0, color ); g.addColorStop( 0.48, light ); g.addColorStop( 0.5, color ); g.addColorStop( 1, dark ); }
	ctx.fillStyle = g; ctx.fillRect( x, y, w, h );
	ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect( x + 2, on ? y + h / 2 + 2 : y + 2, w - 4, 2 );
	if(onText !== null) T( on ? (onText || "ON") : (offText || "OFF"), cx, y + h + 9, 7, on ? INK : DIM );
	if(r.hover && tooltip) tip( tooltip + ": " + (on ? (onText || "ON") : (offText || "OFF")), cx, y + h + 26 );
	return on;
}

function shade( hex, k )
{
	var n = parseInt( hex.slice( 1 ), 16 ), c = [n >> 16, (n >> 8) & 255, n & 255];
	return "rgb(" + c.map(function(v){ return Math.round( k > 0 ? v + (255 - v) * k : v * (1 + k) ); }).join(",") + ")";
}

// a small jack of the back panel, brought to the deck
function mj( id, cx, cy, type, label )
{
	var full = id_prefix + id;
	jacks[full] = { x: rackX( cx ), y: rackY( cy ), type: type, label: label };
	var hover = hitCircle( cx, cy, 12 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[full] ))
	{
		ctx.strokeStyle = hover ? INK : "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( cx, cy, 13, 0, Math.PI * 2 ); ctx.stroke();
	}
	var g = ctx.createRadialGradient( cx - 3, cy - 3, 1, cx, cy, 11 );
	g.addColorStop( 0, "#e6e6e2" ); g.addColorStop( 1, "#77776f" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, 10, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = hover && !cable_drag ? "#333" : "#080808";
	ctx.beginPath(); ctx.arc( cx, cy, 5.5, 0, Math.PI * 2 ); ctx.fill();
	T( label, cx, cy - 20, 8 );
	if(hover && !cable_drag) tip( label + (type == "out" ? " (OUT)" : " (IN)"), cx, cy + 22 );
}

function led( x, y, on, color )
{
	ctx.fillStyle = "#200"; ctx.beginPath(); ctx.arc( x, y, 3.6, 0, Math.PI * 2 ); ctx.fill();
	if(on)
	{
		ctx.fillStyle = color || "#ff3b2a"; ctx.beginPath(); ctx.arc( x, y, 3, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = "rgba(255,80,60,0.25)"; ctx.beginPath(); ctx.arc( x, y, 7, 0, Math.PI * 2 ); ctx.fill();
	}
}

// a rubber sequencer button with its LED
function sbtn( id, x, y, w, h, label, lit, color, tooltip )
{
	var r = hot( id, x, y, w, h );
	ctx.fillStyle = "#000"; ctx.beginPath(); ctx.roundRect( x - 1, y - 1, w + 2, h + 2, 4 ); ctx.fill();
	ctx.fillStyle = r.held ? "#3c3c3a" : (r.hover ? "#353533" : "#2a2a28");
	ctx.beginPath(); ctx.roundRect( x, y + (r.held ? 1 : 0), w, h, 3 ); ctx.fill();
	if(lit) { ctx.fillStyle = color || "#ff3b2a"; ctx.fillRect( x + 5, y + 4, w - 10, 3 ); }
	else { ctx.fillStyle = "#151514"; ctx.fillRect( x + 5, y + 4, w - 10, 3 ); }
	label.split( "\n" ).forEach(function(l, i, a){ T( l, x + w / 2, y + h / 2 + 4 + (i - (a.length - 1) / 2) * 9, 8, INK ); });
	if(r.hover && tooltip) tip( tooltip, x + w / 2, y + h + 14 );
	return r;
}

// the section names under the tilted panel, on a white line broken around them
function sectionLine( text, x1, x2 )
{
	var y = 450;
	ctx.font = "bold 11px " + FONT;
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "2px";
	var tw = ctx.measureText( text ).width + 16, cx = (x1 + x2) / 2;
	ctx.fillStyle = WHITE;
	ctx.fillRect( x1, y, cx - tw / 2 - x1, 1.5 ); ctx.fillRect( cx + tw / 2, y, x2 - cx - tw / 2, 1.5 );
	ctx.fillRect( x1, y - 8, 1.5, 9 ); ctx.fillRect( x2 - 1.5, y - 8, 1.5, 9 );
	T( text, cx, y + 1, 11 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
}

function heading( text, x, y ) { T( text, x, y, 9, WHITE ); }

var fmtPct = function(v){ return Math.round( v * 100 ) + "%"; };
var fmtT = function(v){ return v < 1 ? Math.round( v * 1000 ) + " ms" : v.toFixed( 2 ) + " s"; };
var fmtHz = function(v){ return v < 1000 ? Math.round( v ) + " Hz" : (v / 1000).toFixed( 2 ) + " kHz"; };

// ---------------------------------------------------------------------------
// the tilted panel

function drawPanel()
{
	var w = SIZE[0];
	// black panel, aluminium trim top and bottom
	ctx.fillStyle = "#121212"; ctx.fillRect( 22, 0, w - 44, DECK_Y - 18 );
	var g = ctx.createLinearGradient( 0, 0, 0, 6 );
	g.addColorStop( 0, "#9a9a96" ); g.addColorStop( 1, "#4a4a48" );
	ctx.fillStyle = g; ctx.fillRect( 22, 0, w - 44, 5 );
	// the wooden strip under the panel (the hinge of the original)
	g = ctx.createLinearGradient( 0, DECK_Y - 18, 0, DECK_Y );
	g.addColorStop( 0, "#6a4024" ); g.addColorStop( 0.5, "#94603a" ); g.addColorStop( 1, "#4a2c18" );
	ctx.fillStyle = g; ctx.fillRect( 22, DECK_Y - 18, w - 44, 18 );

	drawControllers();
	drawOscillators();
	drawMixer();
	drawModifiers();
	drawOutput();
	sectionLine( "CONTROLLERS", 34, 262 );
	sectionLine( "OSCILLATOR BANK", 272, 700 );
	sectionLine( "MIXER", 710, 958 );
	sectionLine( "MODIFIERS", 968, 1298 );
	sectionLine( "OUTPUT", 1308, 1536 );
}

function drawControllers()
{
	S.tune = mknob( "tune", 148, 82, 22, S.tune, -2, 2, "TUNE", { def: 0, bipolar: true, nums: ["-2", "", "-1", "", "0", "", "+1", "", "+2"],
		format: function(v){ return (v >= 0 ? "+" : "") + v.toFixed( 2 ) + " SEMITONES"; } } );
	S.glide = mknob( "glide", 90, 200, 22, S.glide, 0.002, 5, "GLIDE", { exp: true, def: 0.12, format: fmtT } );
	S.mod_mix = mknob( "mod_mix", 206, 200, 22, S.mod_mix, 0, 1, "MODULATION\nMIX", { def: 0.5,
		format: function(v){ return Math.round( (1 - v) * 100 ) + "% " + (S.mod_src1 == "feg" ? "FILTER EG" : "OSC 4") + " / " + Math.round( v * 100 ) + "% " + (S.mod_src2 == "lfo" ? "LFO" : "NOISE"); } } );
	S.osc_mod = rocker( "osc_mod", 56, 318, S.osc_mod, ORANGE, "OSCILLATOR\nMODULATION", null, null, "THE MOD WHEEL'S MODULATION TO THE OSCILLATORS' PITCH" );
	S.mod_src1 = rocker( "mod_src1", 116, 318, S.mod_src1 == "feg", BLUE, "OSC 4 /\nFILTER EG", "FILT EG", "OSC 4", "MODULATION SOURCE (LEFT OF THE MIX)" ) ? "feg" : "osc4";
	S.mod_src2 = rocker( "mod_src2", 176, 318, S.mod_src2 == "lfo", BLUE, "NOISE /\nLFO", "LFO", "NOISE", "MODULATION SOURCE (RIGHT OF THE MIX)" ) ? "lfo" : "noise";
	S.auto_damp = rocker( "auto_damp", 236, 318, S.auto_damp, BLUE, "AUTO\nDAMP", null, null, "AUTO DAMP (POLY): A KEY LET GO STOPS ITS NOTE AT ONCE" );
	var m = selector( "mode", 148, 400, 15, MODES.indexOf( S.mode ), ["MONO", "UNISON", "POLY"], null,
		{ format: function(v){ return "MODE: " + ["MONO: THE FOUR OSCILLATORS ON THE LAST NOTE", "UNISON: THE FOUR, DETUNED AND SPREAD", "POLY: AN OSCILLATOR A NOTE (4 VOICES)"][ v ]; } } );
	if(MODES[m] != S.mode) { S.mode = MODES[m]; send({ type: "allNotesOff" }); }
	T( "MODE", 84, 400, 9 );
}

function drawOscillators()
{
	var rows = [92, 177, 262, 347], RX = 360, FX = 488, WX = 612;
	T( "RANGE", RX, 38, 9 ); T( "FREQUENCY", FX, 38, 9 ); T( "WAVEFORM", WX, 38, 9 );
	var glyphs = ["tri", "trisaw", "saw", "sq", "wide", "narrow"], g4 = ["tri", "rsaw", "saw", "sq", "wide", "narrow"];
	var gnames = ["TRIANGLE", "TRI / SAW", "SAW", "SQUARE", "WIDE PULSE", "NARROW PULSE"], g4names = ["TRIANGLE", "REVERSE SAW", "SAW", "SQUARE", "WIDE PULSE", "NARROW PULSE"];
	S.osc.forEach(function(o, i){
		var cy = rows[i], n = i + 1;
		T( "OSC", 292, cy - 6, 8, DIM ); T( String( n ), 292, cy + 7, 14 );
		o.range = selector( "osc" + n + "_range", RX, cy, 20, o.range, RANGES, null, { format: function(v){ return "OSC " + n + " RANGE " + RANGES[v]; } } );
		if(i)
			o.fine = mknob( "osc" + n + "_fine", FX, cy, 22, o.fine, -7, 7, null, { def: 0, bipolar: true, nums: ["-7", "", "", "", "", "", "", "0", "", "", "", "", "", "", "+7"],
				format: function(v){ return "OSC " + n + " " + (v >= 0 ? "+" : "") + v.toFixed( 2 ) + " SEMITONES"; } } );
		else
		{
			T( "OSCILLATOR - 1", FX, cy - 6, 9, DIM ); T( "FOLLOWS TUNE", FX, cy + 8, 8, DIM, "center", false );
		}
		o.wave = selector( "osc" + n + "_wave", WX, cy, 20, o.wave, i == 3 ? g4 : glyphs, null, { glyphs: true, glyphNames: i == 3 ? g4names : gnames,
			format: function(v){ return "OSC " + n + " " + (i == 3 ? g4names : gnames)[v]; } } );
	});
	S.osc4_ctrl = rocker( "osc4_ctrl", 676, 347, S.osc4_ctrl, ORANGE, "OSC 4\nCONTROL", null, null, "OSC 4 FOLLOWS THE KEYBOARD (OFF: A DRONE / MODULATION OSCILLATOR)" );
}

function drawMixer()
{
	var names = ["OSC 1", "OSC 2", "OSC 3", "OSC 4", "EXT IN", "NOISE"];
	for(var i = 0; i < 6; ++i)
	{
		var cy = 70 + i * 63, src = i < 4 ? S.osc[i] : (i == 4 ? S.ext : S.noise), id = i < 4 ? "osc" + (i + 1) : (i == 4 ? "ext" : "noise");
		T( names[i] + " VOLUME", 790, cy - 28, 8 );
		src.vol = mknob( id + "_vol", 790, cy, 16, src.vol, 0, 1, null, { def: i < 4 ? 0.75 : 0.5, numSize: 7, format: fmtPct } );
		src.on = rocker( id + "_on", 856, cy + 2, src.on, BLUE, null, null, null, names[i] );
	}
	S.noise.pink = rocker( "noise_pink", 912, 70 + 5 * 63 + 2, S.noise.pink, WHITE, "NOISE", "PINK", "WHITE", "NOISE COLOUR" );
	T( "OVERLOAD", 912, 70 + 4 * 63 - 12, 7 );
	led( 912, 70 + 4 * 63 + 2, ST.overload );
}

function drawModifiers()
{
	S.filter_mod = rocker( "filter_mod", 996, 84, S.filter_mod, ORANGE, "FILTER\nMODULATION", null, null, "THE MOD WHEEL'S MODULATION TO THE CUTOFF" );
	var k1 = rocker( "kbd1", 996, 166, S.kbd & 1, ORANGE, "KEYBOARD\nCONTROL 1", null, null, "KEYBOARD CONTROL 1 (1/3)" );
	var k2 = rocker( "kbd2", 996, 248, (S.kbd & 2) >> 1, ORANGE, "KEYBOARD\nCONTROL 2", null, null, "KEYBOARD CONTROL 2 (2/3)" );
	S.kbd = (k1 ? 1 : 0) + (k2 ? 2 : 0);
	S.hp = rocker( "hp", 996, 330, S.hp, WHITE, "FILTER\nMODE", "HIGH", "LOW", "FILTER MODE" );
	S.decay_sw = rocker( "decay_sw", 996, 404, S.decay_sw, BLUE, "DECAY", null, null, "DECAY: THE CONTOURS RELEASE WITH THEIR DECAY TIME (OFF: AT ONCE)" );
	heading( "FILTER", 1180, 22 );
	S.cutoff = mknob( "cutoff", 1090, 98, 26, S.cutoff, 20, 20000, "CUTOFF\nFREQUENCY", { exp: true, def: 1800, nums: ["-5", "-4", "-3", "-2", "-1", "0", "1", "2", "3", "4", "5"], format: fmtHz } );
	S.emphasis = mknob( "emphasis", 1185, 98, 20, S.emphasis, 0, 1, "EMPHASIS", { def: 0.25, format: fmtPct } );
	S.contour = mknob( "contour", 1265, 98, 20, S.contour, 0, 1, "AMOUNT\nOF CONTOUR", { def: 0.45, format: fmtPct } );
	S.f_attack = mknob( "f_attack", 1090, 222, 20, S.f_attack, 0.001, 10, "ATTACK TIME", { exp: true, def: 0.01, format: fmtT } );
	S.f_decay = mknob( "f_decay", 1185, 222, 20, S.f_decay, 0.004, 20, "DECAY TIME", { exp: true, def: 0.6, format: fmtT } );
	S.f_sustain = mknob( "f_sustain", 1265, 222, 20, S.f_sustain, 0, 1, "SUSTAIN LEVEL", { def: 0.35, format: fmtPct } );
	heading( "LOUDNESS CONTOUR", 1180, 282 );
	S.l_attack = mknob( "l_attack", 1090, 352, 20, S.l_attack, 0.001, 10, "ATTACK TIME", { exp: true, def: 0.005, format: fmtT } );
	S.l_decay = mknob( "l_decay", 1185, 352, 20, S.l_decay, 0.004, 20, "DECAY TIME", { exp: true, def: 0.8, format: fmtT } );
	S.l_sustain = mknob( "l_sustain", 1265, 352, 20, S.l_sustain, 0, 1, "SUSTAIN LEVEL", { def: 0.85, format: fmtPct } );
	// the contours' lights
	led( 1046, 192, ST.feg > 0.05, "#ff3b2a" );
	led( 1046, 318, ST.leg > 0.05, "#ff3b2a" );
}

function drawOutput()
{
	S.volume = mknob( "volume", 1422, 98, 26, S.volume, 0, 1, "VOLUME", { def: 0.7, format: fmtPct } );
	heading( "CHORUS", 1422, 168 );
	var c = S.chorus;
	c.on = rocker( "chorus_on", 1356, 222, c.on, BLUE, "ON / OFF", null, null, "CHORUS" );
	c.i = rocker( "chorus_i", 1422, 222, c.i, WHITE, "I", null, null, "CHORUS I" );
	c.ii = rocker( "chorus_ii", 1488, 222, c.ii, WHITE, "II", null, null, "CHORUS II" );
	heading( "DISTORTION", 1422, 278 );
	var d = S.dist;
	d.amount = mknob( "dist_amount", 1356, 340, 16, d.amount, 0, 1, "DISTORTION", { def: 0.4, numSize: 7, format: fmtPct } );
	d.tone = mknob( "dist_tone", 1422, 340, 16, d.tone, 0, 1, "TONE", { def: 0.5, numSize: 7, format: fmtPct } );
	d.level = mknob( "dist_level", 1488, 340, 16, d.level, 0, 1, "LEVEL", { def: 0.7, numSize: 7, format: fmtPct } );
	d.on = rocker( "dist_on", 1422, 408, d.on, BLUE, null, null, null, "DISTORTION" );
}

// ---------------------------------------------------------------------------
// the keyboard deck: wheels, glide / LFO / transpose, the sequencer, the sockets of the back

function drawDeck()
{
	var w = SIZE[0], h = SIZE[1];
	var g = ctx.createLinearGradient( 0, DECK_Y, 0, h );
	g.addColorStop( 0, "#1b1b1a" ); g.addColorStop( 1, "#111110" );
	ctx.fillStyle = g; ctx.fillRect( 22, DECK_Y, w - 44, h - DECK_Y );
	drawWheels();
	S.glide_on = rocker( "glide_on", 196, 574, S.glide_on, BLUE, "GLIDE", null, null, "GLIDE ON / OFF" );
	S.lfo_rate = mknob( "lfo_rate", 262, 590, 17, S.lfo_rate, 0.05, 200, "LFO RATE", { exp: true, def: 5, numSize: 7,
		format: function(v){ return v < 10 ? v.toFixed( 2 ) + " Hz" : Math.round( v ) + " Hz"; } } );
	led( 300, 548, ST.lfo > 0.3, "#ff3b2a" );
	S.lfo_wave = rocker( "lfo_wave", 330, 574, S.lfo_wave == "square", WHITE, "WAVE\nSHAPE", "SQUARE", "TRI", "LFO WAVE" ) ? "square" : "tri";
	var tr = selector( "transpose", 262, 664, 11, S.transpose + 1, ["-1", "0", "+1"], null, { format: function(v){ return "TRANSPOSE " + ["-1 OCTAVE", "0", "+1 OCTAVE"][v]; } } );
	S.transpose = tr - 1;
	T( "TRANSPOSE", 196, 664, 8 );
	S.vel_adj = mknob( "vel_adj", 340, 664, 11, S.vel_adj, 0, 1, null, { def: 1, noScale: true, format: function(v){ return "VELOCITY CV " + Math.round( v * 100 ) + "%"; } } );
	T( "VEL", 370, 664, 8 );

	// the name
	ctx.font = "bold 34px " + FONT;
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "4px";
	ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	ctx.fillText( "PARA D", 412, 548 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
	T( "4-VOICE PARAPHONIC ANALOG SYNTHESIZER", 412, 566, 9, DIM, "left", false );

	drawSequencer();

	// the back panel's CV sockets
	ctx.fillStyle = "#0c0c0c"; ctx.beginPath(); ctx.roundRect( 1232, DECK_Y + 12, 306, h - DECK_Y - 24, 6 ); ctx.fill();
	var J = JACKS[0];
	for(var i = 0; i < 4; ++i) mj( J[i][2], 1262 + i * 64, 566, J[i][1], J[i][0] );
	for(var i = 4; i < 10; ++i) mj( J[i][2], 1258 + (i - 4) * 52, 650, J[i][1], J[i][0] );
	T( "OUT", 1514, 566, 8, DIM );
}

function drawWheels()
{
	var u = uiOf();
	[["pitch", 64], ["mod", 124]].forEach(function(wh){
		var x = wh[1] - 16, y = 524, ww = 32, hh = 132, full = id_prefix + wh[0] + "_wheel";
		var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, ww, hh );
		if(hover) ui.hot = full;
		if(hover && ui.pressed && ui.active === null) { ui.active = full; ui.startY = ui.y; ui.startN = wh[0] == "pitch" ? u.wheel : S.mod_wheel; }
		var v = wh[0] == "pitch" ? u.wheel : S.mod_wheel;
		if(ui.active === full && ui.down)
		{
			if(wh[0] == "pitch") { var nv = clamp( ui.startN + (ui.startY - ui.y) / 60, -1, 1 ); if(nv != u.wheel) { u.wheel = nv; send({ type: "wheel", value: nv * 2 / 12 }); } }
			else S.mod_wheel = clamp( ui.startN + (ui.startY - ui.y) / 120, 0, 1 );
		}
		else if(wh[0] == "pitch" && u.wheel !== 0) { u.wheel = 0; send({ type: "wheel", value: 0 }); } // springs back
		v = wh[0] == "pitch" ? u.wheel : S.mod_wheel;
		ctx.fillStyle = "#050505"; ctx.fillRect( x - 4, y - 4, ww + 8, hh + 8 );
		var g = ctx.createLinearGradient( 0, y, 0, y + hh );
		g.addColorStop( 0, "#0d0d0d" ); g.addColorStop( 0.5, hover ? "#3a3a38" : "#2c2c2a" ); g.addColorStop( 1, "#0d0d0d" );
		ctx.fillStyle = g; ctx.fillRect( x, y, ww, hh );
		// ridges moving with the wheel, the white mark
		var off = (wh[0] == "pitch" ? v : v * 2 - 1) * 40;
		ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1;
		ctx.beginPath();
		for(var k = -12; k <= 12; ++k)
		{
			var yy = y + hh / 2 - off + k * 9;
			if(yy > y + 4 && yy < y + hh - 4) { ctx.moveTo( x + 3, yy ); ctx.lineTo( x + ww - 3, yy ); }
		}
		ctx.stroke();
		var my = y + hh / 2 - off;
		if(my > y && my < y + hh) { ctx.fillStyle = WHITE; ctx.fillRect( x + 3, my - 2, ww - 6, 4 ); }
		T( wh[0] == "pitch" ? "PITCH" : "MOD", wh[1], y + hh + 18, 9 );
		if(hover) tip( wh[0] == "pitch" ? "PITCH WHEEL: ±2 SEMITONES (SPRINGS BACK)" : "MOD WHEEL: AMOUNT OF MODULATION " + Math.round( S.mod_wheel * 100 ) + "%", wh[1], y - 14 );
	});
}

function drawSequencer()
{
	var q = S.seq, u = uiOf(), pat = q.patterns[ q.pattern ];
	var rec = q.rec, stopped = !ST.playing, edit = rec && stopped;
	ctx.fillStyle = "#0e0e0d"; ctx.beginPath(); ctx.roundRect( 404, 578, 816, 108, 6 ); ctx.fill();
	q.tempo = mknob( "tempo", 446, 640, 19, q.tempo, 30, 300, "TEMPO", { exp: true, def: 120, numSize: 7, nums: ["30", "", "", "", "", "120", "", "", "", "", "300"],
		format: function(v){ return Math.round( v ) + " BPM" + (q.sync ? " (SYNC ON: THE RACK'S TEMPO)" : ""); } } );
	q.gate = mknob( "gate", 510, 646, 12, q.gate, 0.05, 1, "GATE", { def: 0.5, noScale: true, format: fmtPct } );
	q.swing = mknob( "swing", 556, 646, 12, q.swing, 0, 0.75, "SWING", { def: 0, noScale: true, format: function(v){ return Math.round( 50 + v * 33.3 ) + "%"; } } );
	var cur = pat.steps[ Math.max( 0, (q.cursor + pat.len - 1) % pat.len ) ];
	var rt = mknob( "ratchet", 602, 646, 12, cur.ratchet, 1, 4, "RATCHET", { step: 1, def: 1, noScale: true, format: function(v){ return "THE LAST STEP RECORDED PLAYS " + v + "×"; } } );
	if(edit) cur.ratchet = rt;
	q.sync = rocker( "sync", 646, 640, q.sync, BLUE, "SYNC", null, null, "SYNC: FOLLOW THE RACK'S TEMPO (ITS FIRST DEVICE WITH A CLOCK)" );

	// LOCATION: the page shown; the playing page blinks
	T( "LOCATION", 712, 594, 7, DIM );
	var playPage = ST.step >= 0 ? Math.floor( ST.step / 8 ) : -1, blink = (performance.now() % 500) < 250;
	for(var p = 0; p < 4; ++p)
		led( 742 + p * 14, 594, p == q.page || (ST.playing && p == playPage && blink), p == q.page ? "#ffcf3a" : "#6cdc5a" );
	T( (u.patsel ? "PATTERN?" : (u.setEnd ? "SET END?" : (q.arp ? "ARP " + ARP_NAMES[ q.arp_mode ] : "PATTERN " + (q.pattern + 1) + " · " + pat.len + " STEPS"))) + (edit ? " · REC STEP " + (q.cursor + 1) : ""), 812, 594, 8, u.patsel || u.setEnd ? "#ffcf3a" : INK, "left" );

	// the function buttons
	var bx = 690, by = 604, bw = 60, bs = 66;
	if(sbtn( "hold", bx, by, bw, 26, "HOLD\nREST", q.arp ? q.latch : q.hold, "#ff3b2a", edit ? "REST: AN EMPTY STEP" : (q.arp ? "HOLD: THE ARPEGGIO KEEPS PLAYING" : "HOLD: STAY ON THE STEP") ).clicked)
	{
		if(edit) { pat.steps[ q.cursor ] = { notes: [], accent: false, glide: false, ratchet: 1 }; q.cursor = (q.cursor + 1) % pat.len; }
		else if(q.arp) q.latch = !q.latch;
		else q.hold = !q.hold;
	}
	if(sbtn( "reset", bx + bs, by, bw, 26, "RESET\nACCENT", false, null, edit ? "ACCENT ON THE LAST STEP RECORDED" : "BACK TO STEP 1" ).clicked)
	{
		if(edit) cur.accent = !cur.accent;
		else send({ type: "reset" });
	}
	if(sbtn( "arp", bx + bs * 2, by, bw, 26, "ARP\nSET END", q.arp, "#ff3b2a", u.shift ? "SET END: THEN A STEP BUTTON" : "ARPEGGIATOR (THE STEP BUTTONS PICK ITS MODE)" ).clicked)
	{
		if(u.shift) { u.setEnd = !u.setEnd; u.shift = false; }
		else { q.arp = !q.arp; if(!q.arp) send({ type: "allNotesOff" }); }
	}
	if(sbtn( "pattern", bx + bs * 3, by, bw, 26, "PATTERN\nBANK", u.patsel, "#ffcf3a", "PATTERN: THEN A STEP BUTTON (1-8)" ).clicked) { u.patsel = !u.patsel; u.setEnd = false; }
	if(sbtn( "shift", bx + bs * 4, by, bw, 26, "SHIFT", u.shift, "#ffcf3a", "SHIFT + STEP: CLEAR THE STEP · SHIFT + ARP: SET END" ).clicked) u.shift = !u.shift;
	if(sbtn( "page", bx + bs * 5, by, bw, 26, "PAGE", false, null, "STEPS 1-8, 9-16, 17-24, 25-32" ).clicked) q.page = (q.page + 1) % 4;
	if(sbtn( "play", bx + 8 * 54, by, bw + 20, 26, "PLAY / STOP", ST.playing, "#6cdc5a", "PLAY / STOP THE PATTERN" ).clicked) send({ type: "play" });
	if(sbtn( "rec", bx + 8 * 54, by + 40, bw + 20, 30, "REC", rec, "#ff3b2a", "REC: STOPPED, EACH CHORD PLAYED IS A STEP; PLAYING, NOTES GO ONTO THE STEPS" ).clicked) q.rec = !q.rec;

	// STEP switches
	var a = u.audition;
	for(var k = 0; k < 8; ++k)
	{
		var stp = q.page * 8 + k, s8 = pat.steps[ stp ], inside = stp < pat.len;
		var lit, color = "#ff3b2a";
		if(u.patsel) { lit = k == q.pattern; color = "#ffcf3a"; }
		else if(u.setEnd) { lit = stp < pat.len; color = "#ffcf3a"; }
		else if(q.arp) { lit = k == q.arp_mode; color = "#6cdc5a"; }
		else if(ST.playing && ST.step == stp) { lit = true; color = "#ffffff"; }
		else if(edit && q.cursor == stp) { lit = blink; color = "#ffcf3a"; }
		else lit = inside && s8.notes.length > 0;
		var tipT = u.patsel ? "PATTERN " + (k + 1) : (q.arp ? "ARP " + ARP_NAMES[k] : "STEP " + (stp + 1) + ": " + (s8.notes.length ? s8.notes.map( noteName ).join(" ") : "REST") + (s8.accent ? " ACCENT" : "") + (s8.ratchet > 1 ? " ×" + s8.ratchet : "") + (inside ? "" : " (AFTER THE END)"));
		var r = sbtn( "step" + k, bx + k * 54, by + 40, 46, 30, String( stp + 1 ), lit, color, tipT );
		if(!inside && !u.patsel && !q.arp && !u.setEnd) { ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect( bx + k * 54, by + 40, 46, 30 ); }
		if(r.clicked)
		{
			if(u.patsel) { q.pattern = k; u.patsel = false; send({ type: "reset" }); }
			else if(u.setEnd) { pat.len = stp + 1; u.setEnd = false; }
			else if(q.arp) q.arp_mode = k;
			else if(u.shift) { pat.steps[stp] = { notes: [], accent: false, glide: false, ratchet: 1 }; u.shift = false; }
			else
			{
				q.cursor = stp;
				if(s8.notes.length) { s8.notes.forEach(function(n){ send({ type: "note", note: n, on: true, vel: 0.8 }); }); u.audition = s8.notes.slice(); }
			}
		}
	}
	if(a && !(typeof ui.active == "string" && ui.active.indexOf( id_prefix + "step" ) == 0 && ui.down))
	{
		a.forEach(function(n){ send({ type: "note", note: n, on: false }); });
		u.audition = null;
	}
}

// ---------------------------------------------------------------------------

function draw( mod )
{
	M = mod; S = mod.settings;
	ST = M.state = M.state || { playing: false, step: -1, gates: [], lfo: 0, feg: 0, leg: 0, overload: false };
	var w = SIZE[0], h = SIZE[1];
	drawCasing( 0, 0, w, h );
	drawPanel();
	drawDeck();
	M = null; S = null; ST = null;
}

// the notes the sequencer recorded (from the keys or MIDI while REC): into the pattern
function onState( m, state )
{
	if(!state.rec || !state.rec.length) return;
	var q = m.settings.seq;
	state.rec.forEach(function(r){
		var pat = q.patterns[ r[0] ];
		if(!pat || r[1] >= pat.len) return;
		var st = pat.steps[ r[1] ];
		if(r[4]) // while playing: onto the step
		{
			r[2].forEach(function(n){ if(st.notes.indexOf( n ) < 0 && st.notes.length < 4) st.notes.push( n ); });
		}
		else
		{
			pat.steps[ r[1] ] = { notes: r[2].slice( 0, 4 ), accent: false, glide: false, ratchet: 1 };
			q.cursor = (r[1] + 1) % pat.len;
		}
	});
}

WR.registerSynth( "pollyd", {
	title: "PARA D",
	description: "PARA D: 4-voice paraphonic analog synthesizer, chorus, distortion, arpeggiator and sequencer",
	about: "A classic analog monosynth design with four oscillators, played mono, in unison or as four voices through the ladder filter, with a stereo chorus, a distortion, an arpeggiator and a 32-step sequencer.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^step\\d$", 3], ["^(play|rec|arp|hold|reset)$", 3], ["^(pattern|shift|page)$", 2], ["^(glide_on|osc_mod|filter_mod|chorus_on|dist_on|osc\\d_on|noise_on)$", 1], ["", 0]],
	knob_jacks: [["^cutoff$", ["filter_in"]], ["^(tune|osc\\d_fine)$", ["osc_in"]], ["^volume$", ["loud_in"]], ["^mod_mix$", ["mod_in"]], ["^tempo$", ["sync_in"]], ["^vel_adj$", ["vel_out"]]],
	category: "Synths",
	wood: true, // wooden sides
	knob_skin: "lm",
	worklet: "devices/pollyd-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	audio_out: "out_l",      // cabled into the rack in stereo when it is added
	audio_out_r: "out_r",
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	onState: onState,
	size: function() { return SIZE; },
	draw: draw,
	rear_note: function( s ) { return s.mode.toUpperCase() + " · PATTERN " + (s.seq.pattern + 1) + (s.seq.arp ? " · ARP" : ""); },
	transport: function( mod, action, value ) {
		if(action == "play") mod.post({ type: "play", value: value });
		else if(action == "trigger") mod.post({ type: "trigger", gate: value });
		else if(action == "reset") mod.post({ type: "reset" });
	},
	tempo: function( s ) { return s.seq.tempo; }
});

})();
