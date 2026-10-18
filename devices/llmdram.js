// devices/llmdram.js
// LLM DRAM module, a sampling drum machine in the style of the early 80s: its panel laid
// out as a classic drum machine's (charcoal with orange sections, black skirted knobs), 16 pads with the
// PERCUSSION bank, the TUNE knobs, WAVE DESIGNER, ANALOG FILTER, VOLUME, the 16 channel mixer (PAN,
// VOICE SELECT, LEVEL), the display with the selected voice's parameters, and the sequencer (PADS,
// STEP, PATT and SONG modes, REC, swing, auto fill, step / note repeat). Its own widgets draw the
// buttons, pads and sliders in its style; its knobs use the "lm" knob style by default.
// Coordinates are those of the hardware's top view (1600 px wide), moved by X() / Y().
// DSP in llmdram-worklet.js.

(function(){

var SIZE = [1568, 790]; // from the logo to the bottom of the mixer, no empty bands
var ORANGE = "#e3692c", PANEL = "#292929", LM_FONT = "Arial, Helvetica, sans-serif";
var X = function(x){ return x - 8; }, Y = function(y){ return y - 50; };

// pad sounds (slots) and their mixer channels; worklet: SLOT_CH, LIBRARY
var SLOT_NAMES = ["BASS 1", "BASS 2", "SNARE 1", "SNARE 2", "SNARE 3", "SIDESTICK", "HI HAT 1", "HI HAT 2", "HI HAT OPEN",
	"TOM HI", "TOM MID", "TOM LO", "RIDE 1", "RIDE 2", "CRASH", "CABASA 1", "CABASA 2", "TAMBOURINE 1", "TAMBOURINE 2",
	"CONGA HI", "CONGA LO", "COWBELL", "CLAPS", "CLICK"];
var SLOT_CH = [0, 0, 1, 1, 1, 2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 9, 9, 10, 10, 11, 12, 13, 14, 15];
var CH_NAMES = ["BASS", "SNARE", "SIDESTICK", "HI HAT", "HI", "MID", "LO", "RIDE", "CRASH", "CABASA", "TAMB", "HI", "LO", "COWBELL", "CLAPS", "CLICK"];
var CH_LONG = ["BASS", "SNARE", "SIDESTICK", "HI HAT", "TOM HI", "TOM MID", "TOM LO", "RIDE", "CRASH", "CABASA", "TAMBOURINE", "CONGA HI", "CONGA LO", "COWBELL", "CLAPS", "CLICK"];
var LIBRARY = ["BASS 1", "BASS 2", "SNARE 1", "SNARE 2", "SNARE 3", "SIDESTICK", "HI HAT 1", "HI HAT 2", "HH OPEN", "TOM HI", "TOM MID", "TOM LO",
	"RIDE 1", "RIDE 2", "CRASH", "CABASA 1", "CABASA 2", "TAMB 1", "TAMB 2", "CONGA HI", "CONGA LO", "COWBELL", "CLAPS", "CLICK",
	"BOOM", "RIMSHOT", "CLAVE", "SHAKER", "WOOD BLOCK", "AGOGO", "LASER", "NOISE HIT"];
var PAD_DRUMS = [6, 7, 8, 9, 10, 11, 12, 13], PAD_PERC = [15, 16, 17, 18, 19, 20, 21, 22], PAD_LOW = [5, 2, 3, 4, 0, 1, 14, -1];
var PAD_X = [102, 195, 288, 381, 475, 568, 661, 755], PAD_Y = [646, 750];
var MIX_X = []; for(var c = 0; c < 16; ++c) MIX_X.push( 860 + c * 44.6 );

var REAR_JACKS = [["OUT L","aout","out_l"], ["OUT R","aout","out_r"], ["IN","ain","in"]];
CH_LONG.forEach(function(n, c){ REAR_JACKS.push([ n, "aout", "ch" + (c + 1) ]); });

var M = null, S = null, ST = null;
var held = {};    // module id -> pad slots held with NOTE REPEAT
var enc = {};     // module id -> encoder drag
var copied = {};  // module id -> a copied pattern
var lastErase = {};
var tapTimes = {};

function channel( i )
{
	var pans = [0, 0, 0.1, 0.35, -0.4, -0.15, 0.15, 0.45, -0.45, 0.5, -0.5, 0.3, -0.3, 0.2, -0.2, 0];
	return { pan: pans[i], level: i == 15 ? 0.4 : 0.75, mute: false, solo: false, send: false, tune: 0, lev: 1, bit: 8, dist: 0, rev: false, start: 0, len: 1, loop: false };
}

function emptyPattern() { return { len: 16, hits: [] }; }

function defaults()
{
	var ch = [], patterns = [], assign = [];
	for(var c = 0; c < 16; ++c) ch.push( channel( c ) );
	for(var p = 0; p < 16; ++p) patterns.push( emptyPattern() );
	for(var k = 0; k < 24; ++k) assign.push( k );
	// a first beat: bass, snare, closed hi hats, an open one, claps on 4
	var h = patterns[0].hits;
	[0, 6, 8, 10].forEach(function(t){ h.push([ t, 0, 1 ]); });
	[4, 12].forEach(function(t){ h.push([ t, 2, 1 ]); });
	for(var t = 0; t < 16; t += 2) h.push([ t, t == 14 ? 8 : 6, t % 4 ? 0.7 : 1 ]);
	h.push([ 12, 22, 0.8 ]);
	return {
		ch: ch, assign: assign, patterns: patterns, pattern: 0,
		tune_snare: 0, tune_tom_hi: 0, tune_tom_mid: 0, tune_tom_lo: 0, tune_conga_hi: 0, tune_conga_lo: 0, hh_decay: 0.7,
		wd_attack: 0, wd_sustain: 0, cutoff: 8000, resonance: 0.2, hpf: false, filter_on: true,
		input: 0.5, master: 0.75,
		tempo: 120, sync: true, swing: 50,
		mode: "pads", rec: false, quantize: true, auto_fill: false, step_repeat: false, note_repeat: false, trigger: false,
		perc: false, sel: 2, page: 0, menu: "voice", cursor: 4
	};
}

function validate( s, raw )
{
	var clampTo = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	// arrays: fill what is there, keep the right lengths
	var ch = [];
	for(var c = 0; c < 16; ++c)
	{
		var src = raw && Array.isArray( raw.ch ) && raw.ch[c] && typeof raw.ch[c] == "object" ? raw.ch[c] : {};
		var d = channel( c ), o = {};
		Object.keys( d ).forEach(function(k){ o[k] = typeof d[k] == "boolean" ? (src[k] === undefined ? d[k] : !!src[k]) : clampTo( src[k] === undefined ? d[k] : src[k], -48, 48, d[k] ); });
		o.pan = clampTo( o.pan, -1, 1, 0 ); o.level = clampTo( o.level, 0, 1, 0.75 ); o.lev = clampTo( o.lev, 0, 1, 1 );
		o.bit = o.bit >= 12 ? 12 : 8; o.dist = clampTo( o.dist, 0, 1, 0 ); o.start = clampTo( o.start, 0, 0.9, 0 ); o.len = clampTo( o.len, 0.05, 1, 1 );
		o.tune = Math.round( clampTo( o.tune, -24, 24, 0 ) );
		ch.push( o );
	}
	s.ch = ch;
	var assign = [];
	for(var k = 0; k < 24; ++k)
		assign.push( Math.round( clampTo( raw && Array.isArray( raw.assign ) ? raw.assign[k] : k, 0, LIBRARY.length - 1, k ) ) );
	s.assign = assign;
	var pats = [];
	for(var p = 0; p < 16; ++p)
	{
		var rp = raw && Array.isArray( raw.patterns ) && raw.patterns[p] && typeof raw.patterns[p] == "object" ? raw.patterns[p] : null;
		if(!rp) { pats.push( raw && Array.isArray( raw.patterns ) ? emptyPattern() : s.patterns[p] ); continue; }
		var len = Math.round( clampTo( rp.len, 1, 64, 16 ) );
		var hits = (Array.isArray( rp.hits ) ? rp.hits : []).filter(function(h){ return Array.isArray( h ) && h.length >= 2; }).map(function(h){
			return [ Math.round( clampTo( h[0], 0, 63, 0 ) ), Math.round( clampTo( h[1], 0, 23, 0 ) ), clampTo( h[2] === undefined ? 1 : h[2], 0.05, 1, 1 ) ];
		}).slice( 0, 2000 );
		pats.push({ len: len, hits: hits });
	}
	s.patterns = pats;
	s.pattern = Math.round( clampTo( s.pattern, 0, 15, 0 ) );
	if(["pads", "step", "patt", "song"].indexOf( s.mode ) < 0) s.mode = "pads";
	if(s.menu != "voice" && s.menu != "pattern") s.menu = "voice";
	s.sel = Math.round( clampTo( s.sel, 0, 23, 2 ) );
	s.cursor = Math.round( clampTo( s.cursor, 0, 8, 4 ) );
	s.page = Math.round( clampTo( s.page, 0, 3, 0 ) );
	s.tempo = clampTo( s.tempo, 30, 300, 120 );
	s.swing = clampTo( s.swing, 50, 75, 50 );
}

function randomize( s )
{
	var p = s.patterns[ s.pattern ], len = p.len;
	p.hits = [];
	var add = function(slot, prob, vel) { for(var t = 0; t < len; ++t) if(Math.random() < prob( t )) p.hits.push([ t, slot, vel ]); };
	add( 0, function(t){ return t % 8 == 0 ? 0.95 : (t % 2 == 0 ? 0.2 : 0.05); }, 1 );
	add( 2 + Math.floor( Math.random() * 3 ), function(t){ return t % 8 == 4 ? 0.95 : 0.04; }, 1 );
	add( 6, function(t){ return t % 2 == 0 ? 0.85 : 0.25; }, 0.8 );
	add( 8, function(t){ return t % 8 == 6 ? 0.3 : 0; }, 0.8 );
	add( [19, 20, 21, 17, 15][ Math.floor( Math.random() * 5 ) ], function(t){ return 0.18; }, 0.7 );
	add( 22, function(t){ return t % 8 == 4 ? 0.35 : 0; }, 0.8 );
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }

// ---------------------------------------------------------------------------
// widgets in the LM style

function txt( t, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + (size || 11) + "px " + LM_FONT;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = color || ORANGE;
	ctx.fillText( t, x, y );
}

// an orange outlined section, its title cutting the top edge
function section( x1, y1, x2, y2 )
{
	ctx.strokeStyle = ORANGE;
	ctx.lineWidth = 1.6;
	ctx.beginPath(); ctx.roundRect( X(x1) + 0.5, Y(y1) + 0.5, x2 - x1, y2 - y1, 3 ); ctx.stroke();
}

// "—— TEXT ——" across x1..x2, with ticks at the ends (down: towards what it groups)
function groupLine( text, x1, x2, y, ticks )
{
	ctx.font = "bold 11px " + LM_FONT;
	var tw = text ? ctx.measureText( text ).width + 10 : 0, cx = (x1 + x2) * 0.5;
	ctx.strokeStyle = ORANGE;
	ctx.lineWidth = 1.3;
	ctx.beginPath();
	ctx.moveTo( X(x1), Y(y) ); ctx.lineTo( X(cx) - tw * 0.5, Y(y) );
	ctx.moveTo( X(cx) + tw * 0.5, Y(y) ); ctx.lineTo( X(x2), Y(y) );
	if(ticks) { ctx.moveTo( X(x1), Y(y) ); ctx.lineTo( X(x1), Y(y) + ticks ); ctx.moveTo( X(x2), Y(y) ); ctx.lineTo( X(x2), Y(y) + ticks ); }
	ctx.stroke();
	if(text) txt( text, X(cx), Y(y) );
}

// a rectangular grey button (centre x, y in hardware coordinates); lit: white rim. returns { clicked, held }
function lmButton( id, cx, cy, w, h, text, lit, tooltip, color )
{
	var x = X(cx) - w * 0.5, y = Y(cy) - h * 0.5;
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	var kb = keyButton( full, x, y, w, h );
	clicked = clicked || kb.pressed;
	var down = (ui.active === full && ui.down) || kb.held, dy = down ? 1 : 0;
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	ctx.beginPath(); ctx.roundRect( x + 1, y + 3, w, h, 4 ); ctx.fill();
	if(color && lit) // the transport buttons glow
	{
		var gl = ctx.createRadialGradient( x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, w * 0.75 );
		gl.addColorStop( 0, color ); gl.addColorStop( 1, "rgba(0,0,0,0)" );
		ctx.fillStyle = gl;
		ctx.fillRect( x - w * 0.3, y - h * 0.3, w * 1.6, h * 1.6 );
	}
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	g.addColorStop( 0, hover ? "#4b4b4b" : "#404040" );
	g.addColorStop( 1, "#262626" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x, y + dy, w, h, 4 ); ctx.fill();
	ctx.strokeStyle = lit ? (color || "#f4f4f4") : "#7c7c7c";
	ctx.lineWidth = lit ? 2.2 : 1.3;
	ctx.beginPath(); ctx.roundRect( x + 1, y + 1 + dy, w - 2, h - 2, 3.5 ); ctx.stroke();
	if(typeof text == "function") text( x + w / 2, y + h / 2 + dy );
	else if(text) txt( text, x + w / 2, y + h / 2 + 1 + dy, 10, lit ? "#ffffff" : "#e2e2e2" );
	if(hover && tooltip) tip( tooltip, x + w / 2, y + h + 12 );
	return { clicked: clicked, held: down };
}

// a drum pad (centre in hardware coordinates); lit: orange glow; mark: white rim (the playing step)
function pad( id, cx, cy, number, lit, mark, tooltip )
{
	var w = 70, x = X(cx) - w / 2, y = Y(cy) - w / 2;
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, w );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	if(padSlide( full, id_prefix + "pad", x, y, w, w )) { hover = true; clicked = true; ui.hot = full; } // sliding over from another pad
	var kb = keyButton( full, x, y, w, w );
	clicked = clicked || kb.pressed;
	var down = (ui.active === full && ui.down) || kb.held;
	if(lit)
	{
		var gl = ctx.createRadialGradient( x + w / 2, y + w / 2, w * 0.3, x + w / 2, y + w / 2, w * 0.85 );
		gl.addColorStop( 0, "rgba(255,130,40,0.55)" ); gl.addColorStop( 1, "rgba(255,110,30,0)" );
		ctx.fillStyle = gl;
		ctx.fillRect( x - 20, y - 20, w + 40, w + 40 );
	}
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	ctx.beginPath(); ctx.roundRect( x + 1, y + 4, w, w, 6 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, y, 0, y + w );
	g.addColorStop( 0, lit ? "#5a3a26" : (hover ? "#3e3e3e" : "#353535") );
	g.addColorStop( 1, lit ? "#3a2418" : "#222" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x, y + (down ? 1 : 0), w, w, 6 ); ctx.fill();
	ctx.strokeStyle = mark ? "#ffffff" : (lit ? "#ff8a3a" : "#8a8a8a");
	ctx.lineWidth = mark || lit ? 2.4 : 1.4;
	ctx.beginPath(); ctx.roundRect( x + 1.5, y + 1.5 + (down ? 1 : 0), w - 3, w - 3, 5 ); ctx.stroke();
	// the number tab at the top
	ctx.fillStyle = lit ? "#ff9a4a" : "#9a9a9a";
	ctx.beginPath(); ctx.roundRect( x + 6, y + 5, w - 12, 13, 3 ); ctx.fill();
	txt( String( number ), x + w / 2, y + 12, 9, lit ? "#3a1a08" : "#1a1a1a" );
	if(hover && tooltip) tip( tooltip, x + w / 2, y + w + 12 );
	return { clicked: clicked, held: down };
}

// a slider (hardware coordinates: x, the slot from y1 to y2); value 0..1 (1 at the top)
function lmSlider( id, cx, y1, y2, value, tooltip, def )
{
	var x = X(cx), top = Y(y1), h = y2 - y1, capW = 16, capH = 26;
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x - 12, top - 10, 24, h + 20 );
	if(hover) ui.hot = full;
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = full;
		if(ui.dbl && def !== undefined) value = def;
		ui.startY = ui.y; ui.startN = value;
	}
	if(ui.active === full && ui.down)
		value = clamp( ui.startN + (ui.startY - ui.y) / (h * (ui.shift ? 5 : 1)), 0, 1 );
	if(hover && ui.wheel && ui.active === null && wheel_knobs) { value = clamp( value - ui.wheel * 0.02, 0, 1 ); ui.wheel = 0; }
	ctx.fillStyle = "#0b0b0b";
	ctx.beginPath(); ctx.roundRect( x - 2.5, top, 5, h, 2.5 ); ctx.fill();
	var cy = top + (1 - value) * h;
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	ctx.beginPath(); ctx.roundRect( x - capW / 2 + 1, cy - capH / 2 + 3, capW, capH, 2 ); ctx.fill();
	var g = ctx.createLinearGradient( x - capW / 2, 0, x + capW / 2, 0 );
	g.addColorStop( 0, "#3a3a3a" ); g.addColorStop( 0.5, hover || ui.active === full ? "#262626" : "#1a1a1a" ); g.addColorStop( 1, "#0e0e0e" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x - capW / 2, cy - capH / 2, capW, capH, 2 ); ctx.fill();
	ctx.fillStyle = "#d8d8d8";
	ctx.fillRect( x - capW / 2 + 2, cy - 0.75, capW - 4, 1.5 );
	if((hover || ui.active === full) && tooltip) tip( tooltip( value ), x, Y(y2) + 16 );
	return value;
}

function led( cx, cy, on, color )
{
	ctx.fillStyle = on ? (color || "#ff5a2a") : "#3a3a3a";
	ctx.fillRect( X(cx) - 4, Y(cy) - 2.5, 8, 5 );
	if(on)
	{
		ctx.fillStyle = "rgba(255,120,60,0.35)";
		ctx.fillRect( X(cx) - 7, Y(cy) - 5, 14, 10 );
	}
}

// ---------------------------------------------------------------------------
// the display: the selected voice's parameters (or the pattern's), a cursor, a status line

var VOICE_PARAMS = [
	["BIT", "box", function(c){ return c.bit; }, function(c, d){ c.bit = d > 0 ? 12 : 8; }],
	["SAMP", "box", function(c){ return S.assign[ S.sel ] + 1; }, function(c, d){ S.assign[ S.sel ] = (S.assign[ S.sel ] + d + LIBRARY.length) % LIBRARY.length; }],
	["DIST", "knob", function(c){ return c.dist; }, function(c, d){ c.dist = clamp( Math.round( (c.dist + d * 0.05) * 100 ) / 100, 0, 1 ); }],
	["PLAY", "dir", function(c){ return c.rev; }, function(c, d){ c.rev = d < 0; }],
	["TUNE", "knob", function(c){ return (c.tune + 24) / 48; }, function(c, d){ c.tune = clamp( c.tune + d, -24, 24 ); }, function(c){ return (c.tune > 0 ? "+" : "") + c.tune; }],
	["LEV", "slider", function(c){ return c.lev; }, function(c, d){ c.lev = clamp( Math.round( (c.lev + d * 0.05) * 100 ) / 100, 0, 1 ); }],
	["STRT", "knob", function(c){ return c.start / 0.9; }, function(c, d){ c.start = clamp( Math.round( (c.start + d * 0.05) * 100 ) / 100, 0, 0.9 ); }],
	["LEN", "knob", function(c){ return c.len; }, function(c, d){ c.len = clamp( Math.round( (c.len + d * 0.05) * 100 ) / 100, 0.05, 1 ); }],
	["LOOP", "onoff", function(c){ return c.loop; }, function(c, d){ c.loop = d > 0; }]
];
var PATTERN_PARAMS = [
	["PATT", "box", function(){ return S.pattern + 1; }, function(c, d){ S.pattern = clamp( S.pattern + d, 0, 15 ); }],
	["LEN", "box", function(){ return S.patterns[ S.pattern ].len; }, function(c, d){ var p = S.patterns[ S.pattern ]; p.len = clamp( p.len + d, 1, 64 ); }],
	["SWNG", "box", function(){ return Math.round( S.swing ); }, function(c, d){ S.swing = clamp( S.swing + d, 50, 75 ); }],
	["BPM", "box", function(){ return Math.round( S.tempo ); }, function(c, d){ S.tempo = clamp( Math.round( S.tempo ) + d, 30, 300 ); }],
	["QUAN", "onoff", function(){ return S.quantize; }, function(c, d){ S.quantize = d > 0; }],
	["SYNC", "onoff", function(){ return S.sync; }, function(c, d){ S.sync = d > 0; }],
	["FILL", "onoff", function(){ return S.auto_fill; }, function(c, d){ S.auto_fill = d > 0; }],
	["SREP", "onoff", function(){ return S.step_repeat; }, function(c, d){ S.step_repeat = d > 0; }],
	["PERC", "onoff", function(){ return S.perc; }, function(c, d){ S.perc = d > 0; }]
];

function params() { return S.menu == "pattern" ? PATTERN_PARAMS : VOICE_PARAMS; }
function edit( d ) { var p = params()[ S.cursor ]; p[3]( S.ch[ SLOT_CH[ S.sel ] ], d ); }

function drawDisplay()
{
	var x = X(358), y = Y(343), w = 210, h = 107;
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x - 3, y - 3, w + 6, h + 6, 3 ); ctx.fill();
	ctx.fillStyle = "#0c0c0c";
	ctx.fillRect( x, y, w, h );
	var white = "#e9eef0", c = S.ch[ SLOT_CH[ S.sel ] ];
	var pix = function(t, px, py, size, color, align) { ctx.font = "bold " + (size || 8) + "px 'Courier New', monospace"; ctx.textAlign = align || "center"; ctx.textBaseline = "middle"; ctx.fillStyle = color || white; ctx.fillText( t, px, py ); };
	// top line: what is edited
	pix( S.menu == "pattern" ? "PATTERN " + (S.pattern + 1) : SLOT_NAMES[ S.sel ] + " · " + LIBRARY[ S.assign[ S.sel ] ], x + 6, y + 7, 8, "#9aa4a8", "left" );
	var list = params();
	list.forEach(function(p, i){
		var col = i < 5 ? i : i - 4, row = i < 5 ? 0 : 1;
		var cx = x + 22 + col * 41, cy = y + 30 + row * 34;
		if(row == 1 && i == 5 && S.menu == "voice") { // the channel box
			ctx.strokeStyle = white; ctx.lineWidth = 1;
			ctx.strokeRect( x + 6, cy - 14, 24, 22 );
			pix( "C" + String( SLOT_CH[ S.sel ] + 1 ).padStart( 2, "0" ), x + 18, cy - 7, 7 );
			pix( c.send ? "FX" : "DRY", x + 18, cy + 2, 7 );
		}
		var v = p[2]( c ), sel = i == S.cursor;
		ctx.strokeStyle = white; ctx.fillStyle = white; ctx.lineWidth = 1.2;
		if(p[1] == "box") { ctx.strokeRect( cx - 9, cy - 12, 18, 15 ); pix( String( v ), cx, cy - 4, 8 ); }
		else if(p[1] == "knob") {
			ctx.beginPath(); ctx.arc( cx, cy - 4, 8, 0, Math.PI * 2 ); ctx.stroke();
			var a = KNOB_A0 + clamp( v, 0, 1 ) * KNOB_SWEEP;
			ctx.beginPath(); ctx.moveTo( cx, cy - 4 ); ctx.lineTo( cx + Math.cos(a) * 8, cy - 4 + Math.sin(a) * 8 ); ctx.stroke();
		}
		else if(p[1] == "dir") pix( v ? "←←" : "→→", cx, cy - 4, 11 );
		else if(p[1] == "slider") { ctx.strokeRect( cx - 2, cy - 13, 4, 18 ); ctx.fillRect( cx - 5, cy + 4 - v * 16, 10, 3 ); }
		else if(p[1] == "onoff") { ctx.strokeRect( cx - 9, cy - 10, 18, 11 ); if(v) ctx.fillRect( cx - 7, cy - 8, 14, 7 ); }
		if(sel) { ctx.fillStyle = white; ctx.fillRect( cx - 17, cy + 6, 34, 10 ); }
		pix( p[0], cx, cy + 11, 8, sel ? "#0c0c0c" : white );
		if(sel && p[4]) pix( p[4]( c ), cx + 15, cy - 12, 7, "#9aa4a8" );
	});
	// status line, inverted
	ctx.fillStyle = white;
	ctx.fillRect( x + 2, y + h - 14, w - 4, 12 );
	var st = ST || {};
	var pat = (st.playing && st.pat !== undefined ? st.pat : S.pattern) + 1;
	var step = st.playing ? (st.step + 1) : 0;
	pix( String( pat ).padStart( 2, "0" ) + "|" + (S.mode == "step" ? "PAGE " + (S.page + 1) : S.mode.toUpperCase()) + (S.rec ? " REC" : ""), x + 5, y + h - 8, 8, "#0c0c0c", "left" );
	pix( (step ? "S" + String( step ).padStart( 2, "0" ) + " " : "") + (S.sync ? "⇄" : "P") + Math.round( st.tempo || S.tempo ), x + w - 6, y + h - 8, 8, "#0c0c0c", "right" );
}

// ---------------------------------------------------------------------------

function drawPanel( w, h )
{
	// wood cheeks and the charcoal panel
	drawCasing( 0, 0, w, h );
	ctx.fillStyle = PANEL;
	ctx.fillRect( 22, 0, w - 44, h );
	// the name: outlined serif, as the hardware's logo, and the subtitle
	ctx.font = "italic 44px Georgia, 'Times New Roman', serif";
	ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.6;
	ctx.strokeText( "LLM Dram", X(104), Y(116) );
	txt( "HYBRID 8/12-BIT SAMPLING DRUM MACHINE", X(385), Y(111), 13, ORANGE, "left", false );
	txt( "16 VOICES · 64 STEPS", X(1545), Y(98), 12, ORANGE, "right", false );
}

function draw( mod )
{
	M = mod; S = mod.settings; ST = mod.state;
	var w = SIZE[0], h = SIZE[1];
	drawPanel( w, h );
	var playing = !!(ST && ST.playing);

	// ---- top row of functions ----
	section( 43, 133, 703, 215 );
	var top = [["MIDI"], ["USB"], ["SYNC"], ["RAND"], ["STEP", "REPEAT"], ["NOTE", "REPEAT"], ["AUTO", "FILL"], ["TRIGGER"]];
	var TOPX = [94, 173, 253, 332, 412, 492, 572, 651];
	top.forEach(function(t, i){
		if(t.length == 1) txt( t[0], X(TOPX[i]), Y(146), 10 );
		else { txt( t[0], X(TOPX[i]), Y(145), 10 ); txt( t[1], X(TOPX[i]), Y(157), 10 ); }
	});
	if(lmButton( "midi", 94, 184, 52, 30, "", false, "MIDI: ON THE BACK (TAB)" ).clicked) setStatus( "MIDI IN is on the back of the LLM DRAM (Tab): notes play the pads (GM drum map), clock syncs it" );
	if(lmButton( "usb", 173, 184, 52, 30, "", false, "USB: NOT HERE" ).clicked) setStatus( "USB: not here" );
	if(lmButton( "sync", 253, 184, 52, 30, "", S.sync, "SYNC: FOLLOW MIDI CLOCK / THE RACK'S TEMPO" ).clicked) S.sync = !S.sync;
	if(lmButton( "rand", 332, 184, 52, 30, "", false, "RAND: A NEW PATTERN" ).clicked) { randomize( S ); setStatus( "LLM DRAM: pattern " + (S.pattern + 1) + " randomized" ); }
	if(lmButton( "step_repeat", 412, 184, 52, 30, function(cx, cy){ ctx.fillStyle = "#ddd"; ctx.fillRect( cx - 13, cy - 0.75, 26, 1.5 ); }, S.step_repeat, "STEP REPEAT: LOOP THE CURRENT BEAT" ).clicked) S.step_repeat = !S.step_repeat;
	if(lmButton( "note_repeat", 492, 184, 52, 30, function(cx, cy){ ctx.fillStyle = "#ddd"; ctx.fillRect( cx - 13, cy - 0.75, 26, 1.5 ); }, S.note_repeat, "NOTE REPEAT: HELD PADS REPEAT EVERY 1/16" ).clicked) S.note_repeat = !S.note_repeat;
	if(lmButton( "auto_fill", 572, 184, 52, 30, "", S.auto_fill, "AUTO FILL: A FILL EVERY 4 BARS" ).clicked) S.auto_fill = !S.auto_fill;
	if(lmButton( "trigger", 651, 184, 52, 30, "", S.trigger, "TRIGGER: THE PADS PLAY THE SELECTED SOUND IN 16 PITCHES" ).clicked) S.trigger = !S.trigger;

	// ---- EDIT / MODE ----
	section( 43, 228, 703, 308 );
	groupLine( "EDIT", 66, 356, 242 );
	groupLine( "MODE", 386, 680, 242 );
	if(lmButton( "save", 94, 278, 52, 28, "SAVE", false, "SAVE: THE RACK SAVES ITSELF (SESSIONS)" ).clicked) setStatus( "The LLM DRAM's patterns are saved with the rack (sessions, Save as)" );
	if(lmButton( "copy", 173, 278, 52, 28, "COPY", !!copied[ M.id ], "COPY THE PATTERN, THEN PICK ONE IN PATT MODE TO PASTE" ).clicked)
	{
		copied[ M.id ] = copied[ M.id ] ? null : JSON.parse( JSON.stringify( S.patterns[ S.pattern ] ) );
		if(copied[ M.id ]) { S.mode = "patt"; setStatus( "Pattern " + (S.pattern + 1) + " copied: press a pad to paste it" ); }
	}
	if(lmButton( "erase", 253, 278, 52, 28, "ERASE", false, "ERASE THE SELECTED SOUND (TWICE: THE WHOLE PATTERN)" ).clicked)
	{
		var p = S.patterns[ S.pattern ], now = performance.now();
		if(now - (lastErase[ M.id ] || 0) < 800) { p.hits = []; setStatus( "Pattern " + (S.pattern + 1) + " erased" ); }
		else { p.hits = p.hits.filter(function(h){ return h[1] != S.sel; }); setStatus( SLOT_NAMES[ S.sel ] + " erased from pattern " + (S.pattern + 1) + " (ERASE again: the whole pattern)" ); }
		lastErase[ M.id ] = now;
	}
	if(lmButton( "dump", 332, 278, 52, 28, "DUMP", false, "DUMP: NOT HERE" ).clicked) setStatus( "DUMP: not here" );
	[["song", 412, "SONG"], ["patt", 492, "PATT"], ["step", 572, "STEP"], ["pads", 651, "PADS"]].forEach(function(b){
		if(lmButton( "mode_" + b[0], b[1], 278, 52, 28, b[2], S.mode == b[0] ).clicked) S.mode = b[0];
	});

	// ---- TEMPO ----
	section( 713, 133, 813, 308 );
	txt( "TEMPO", X(763), Y(146), 11 );
	txt( "RATE", X(763), Y(163), 10 );
	S.tempo = knob( "tempo", X(763), Y(202), 19, S.tempo, 30, 300, { def: 120, ticks: 1, format: function(v){ return S.sync ? "SYNC: " + Math.round( (ST && ST.tempo) || v ) + " BPM (SYNC OFF TO SET)" : Math.round( v ) + " BPM"; } } );
	if(lmButton( "tap", 763, 278, 52, 28, "TAP", false, "TAP THE TEMPO" ).clicked)
	{
		var t = performance.now(), taps = tapTimes[ M.id ] = (tapTimes[ M.id ] || []).filter(function(x){ return t - x < 2000; });
		taps.push( t );
		if(taps.length >= 2) { S.tempo = Math.min( 300, Math.max( 30, Math.round( 60000 / ((t - taps[0]) / (taps.length - 1)) ) ) ); S.sync = false; }
	}

	// ---- display, navigation, transport ----
	section( 43, 320, 813, 558 );
	if(lmButton( "length", 94, 360, 52, 28, "LENGTH", false, "PATTERN LENGTH: 16, 32, 48, 64 STEPS" ).clicked)
	{
		var pp = S.patterns[ S.pattern ];
		pp.len = pp.len >= 64 ? 16 : Math.ceil( (pp.len + 1) / 16 ) * 16;
		setStatus( "Pattern " + (S.pattern + 1) + ": " + pp.len + " steps" );
	}
	if(lmButton( "samp", 162, 360, 52, 28, "SAMP", false, "CHOOSE THE SELECTED SOUND'S SAMPLE (ENCODER)" ).clicked) { S.menu = "voice"; S.cursor = 1; }
	if(lmButton( "bank", 229, 360, 52, 28, "BANK", S.perc, "BANK: THE TOP ROW OF PADS PLAYS PERCUSSION" ).clicked) S.perc = !S.perc;
	if(lmButton( "quan", 297, 360, 52, 28, "QUAN", S.quantize, "QUANTIZE THE RECORDED HITS" ).clicked) S.quantize = !S.quantize;
	var arrows = function(dir){ return function(cx, cy){ ctx.fillStyle = "#e2e2e2"; ctx.beginPath();
		for(var k = 0; k < 2; ++k) { var ox = (k - 0.5) * 8 * dir; ctx.moveTo( cx + ox + 4 * dir, cy ); ctx.lineTo( cx + ox - 4 * dir, cy - 5 ); ctx.lineTo( cx + ox - 4 * dir, cy + 5 ); }
		ctx.fill(); }; };
	if(lmButton( "prev", 94, 423, 52, 28, arrows( -1 ), false, S.mode == "step" ? "PREVIOUS PAGE" : "PREVIOUS PATTERN" ).clicked)
	{ if(S.mode == "step") S.page = Math.max( 0, S.page - 1 ); else S.pattern = (S.pattern + 15) % 16; }
	var chSel = S.ch[ SLOT_CH[ S.sel ] ];
	if(lmButton( "mute", 162, 423, 52, 28, "MUTE", chSel.mute, "MUTE THE SELECTED VOICE" ).clicked) chSel.mute = !chSel.mute;
	if(lmButton( "solo", 229, 423, 52, 28, "SOLO", chSel.solo, "SOLO THE SELECTED VOICE" ).clicked) chSel.solo = !chSel.solo;
	if(lmButton( "next", 297, 423, 52, 28, arrows( 1 ), false, S.mode == "step" ? "NEXT PAGE" : "NEXT PATTERN" ).clicked)
	{ if(S.mode == "step") S.page = Math.min( Math.ceil( S.patterns[ S.pattern ].len / 16 ) - 1, S.page + 1 ); else S.pattern = (S.pattern + 1) % 16; }
	// transport
	if(lmButton( "rec", 102, 508, 66, 66, function(cx, cy){ ctx.fillStyle = S.rec ? "#ff4040" : "#c03030"; ctx.beginPath(); ctx.arc( cx, cy, 7, 0, Math.PI * 2 ); ctx.fill(); }, S.rec, "RECORD (THE PADS AND MIDI, WHILE PLAYING)", "rgba(255,60,50,0.55)" ).clicked) S.rec = !S.rec;
	if(lmButton( "stop", 195, 508, 66, 66, function(cx, cy){ ctx.fillStyle = "#eee"; ctx.fillRect( cx - 8, cy - 8, 16, 16 ); }, !playing, "STOP" ).clicked) send({ type: "play", value: false });
	if(lmButton( "play", 288, 508, 66, 66, function(cx, cy){ ctx.fillStyle = "#eee"; ctx.fillRect( cx - 14, cy - 7, 3, 14 ); ctx.fillRect( cx - 9, cy - 7, 3, 14 );
		ctx.fillRect( cx - 3, cy - 7, 1.5, 14 ); ctx.beginPath(); ctx.moveTo( cx + 3, cy - 8 ); ctx.lineTo( cx + 15, cy ); ctx.lineTo( cx + 3, cy + 8 ); ctx.fill(); }, playing, "PLAY / STOP", "rgba(255,255,255,0.25)" ).clicked) send({ type: "play", value: !playing });
	drawDisplay();
	if(lmButton( "no", 380, 527, 52, 28, "NO-", false, "THE VALUE DOWN" ).clicked) edit( -1 );
	if(lmButton( "menu", 462, 527, 52, 28, "MENU", S.menu == "pattern", "THE DISPLAY: THE VOICE / THE PATTERN" ).clicked) { S.menu = S.menu == "voice" ? "pattern" : "voice"; }
	if(lmButton( "yes", 545, 527, 52, 28, "YES+", false, "THE VALUE UP" ).clicked) edit( 1 );
	var tri = function(a){ return function(cx, cy){ ctx.fillStyle = "#e2e2e2"; ctx.beginPath(); ctx.moveTo( cx + Math.cos(a) * 6, cy + Math.sin(a) * 6 ); ctx.lineTo( cx + Math.cos(a + 2.2) * 6, cy + Math.sin(a + 2.2) * 6 ); ctx.lineTo( cx + Math.cos(a - 2.2) * 6, cy + Math.sin(a - 2.2) * 6 ); ctx.fill(); }; };
	// the cursor: row 1 is params 0-4 (columns 0-4), row 2 params 5-8 (columns 1-4)
	if(lmButton( "up", 695, 376, 52, 28, tri( -Math.PI / 2 ), false ).clicked && S.cursor >= 5) S.cursor -= 4;
	if(lmButton( "down", 695, 503, 52, 28, tri( Math.PI / 2 ), false ).clicked && S.cursor < 5) S.cursor = S.cursor == 0 ? 5 : S.cursor + 4;
	if(lmButton( "left", 623, 440, 52, 28, tri( Math.PI ), false ).clicked) S.cursor = Math.max( 0, S.cursor - 1 );
	if(lmButton( "right", 767, 440, 52, 28, tri( 0 ), false ).clicked) S.cursor = Math.min( 8, S.cursor + 1 );
	encoder( 695, 438 );

	// ---- pads ----
	section( 43, 570, 813, 825 );
	drawPads();

	// ---- WAVE DESIGNER / ANALOG FILTER ----
	section( 833, 133, 1343, 243 );
	groupLine( "WAVE DESIGNER", 858, 1045, 146 );
	groupLine( "ANALOG FILTER", 1065, 1330, 146 );
	var kn = function(id, x, label, v, min, max, o) { txt( label, X(x), Y(163), 10 ); o.ticks = o.ticks || 21; return knob( id, X(x), Y(203), 19, v, min, max, o ); };
	S.wd_attack = kn( "wd_attack", 882, "ATTACK", S.wd_attack, -1, 1, { def: 0, format: function(v){ return v < -0.02 ? "SOFTER ATTACK " + Math.round( -v * 100 ) + "%" : (v > 0.02 ? "PUNCHIER " + Math.round( v * 100 ) + "%" : "OFF"); } } );
	txt( "SIG", X(950), Y(172), 9 );
	led( 950, 158, ST && ST.lit && S.ch.some(function(c, i){ return c.send && SLOT_CH.some(function(ch, k){ return ch == i && ST.lit[k]; }); }) );
	if(lmButton( "send", 950, 203, 46, 26, "SEND", chSel.send, "SEND THE SELECTED VOICE THROUGH THE WAVE DESIGNER AND FILTER" ).clicked) chSel.send = !chSel.send;
	S.wd_sustain = kn( "wd_sustain", 1018, "SUSTAIN", S.wd_sustain, -1, 1, { def: 0, format: function(v){ return v < -0.02 ? "SHORTER " + Math.round( -v * 100 ) + "%" : (v > 0.02 ? "LONGER " + Math.round( v * 100 ) + "%" : "OFF"); } } );
	S.cutoff = kn( "cutoff", 1094, "CUTOFF", S.cutoff, 40, 20000, { exp: true, def: 8000, format: fmtHz } );
	if(lmButton( "hpf", 1162, 203, 46, 26, "HPF", S.hpf, "HIGH PASS (OFF: LOW PASS)" ).clicked) S.hpf = !S.hpf;
	if(lmButton( "filter_on", 1230, 203, 46, 26, "ON", S.filter_on, "THE FILTER ON" ).clicked) S.filter_on = !S.filter_on;
	S.resonance = kn( "resonance", 1298, "RESONANCE", S.resonance, 0, 1, { def: 0.2, format: fmtPct } );

	// ---- VOLUME ----
	section( 1355, 133, 1556, 243 );
	groupLine( "VOLUME", 1370, 1540, 146 );
	S.input = kn( "input", 1402, "INPUT", S.input, 0, 1, { def: 0.5, format: function(v){ return "REAR IN → MIX " + fmtPct( v ); } } );
	txt( "REC", X(1453), Y(172), 9 );
	led( 1453, 158, ST && ST.sig );
	S.master = kn( "master", 1506, "MASTER", S.master, 0, 1, { def: 0.75, format: fmtPct } );

	// ---- TUNE ----
	section( 833, 255, 1556, 373 );
	groupLine( "TUNE", 850, 1540, 269 );
	var semis = function(v){ return (v > 0 ? "+" : "") + Math.round( v ) + " SEMITONES"; };
	[["tune_snare", 882], ["tune_tom_hi", 986], ["tune_tom_mid", 1090], ["tune_tom_lo", 1194], ["tune_conga_hi", 1298], ["tune_conga_lo", 1402]].forEach(function(t){
		S[ t[0] ] = knob( t[0], X(t[1]), Y(310), 19, S[ t[0] ], -12, 12, { def: 0, step: 1, ticks: 21, format: semis } );
	});
	S.hh_decay = knob( "hh_decay", X(1506), Y(310), 19, S.hh_decay, 0, 1, { def: 0.7, ticks: 21, format: function(v){ return "HI HAT DECAY " + fmtPct( v ); } } );
	txt( "SNARE", X(882), Y(356), 10 );
	["HI", "MID", "LO"].forEach(function(t, i){ txt( t, X(986 + i * 104), Y(345), 10 ); });
	groupLine( "TOMS", 970, 1210, 356, -6 );
	txt( "HI", X(1298), Y(345), 10 ); txt( "LO", X(1402), Y(345), 10 );
	groupLine( "CONGAS", 1282, 1418, 356, -6 );
	txt( "HI HAT", X(1506), Y(345), 10 ); txt( "DECAY", X(1506), Y(356), 10 );

	// ---- MIXER ----
	section( 833, 385, 1556, 825 );
	drawMixer();
	M = null; S = null; ST = null;
}

// the endless encoder in the navigation cross: drag up / down (or the wheel) to change the value
function encoder( cx, cy )
{
	var id = id_prefix + "encoder", e = enc[ M.id ] = enc[ M.id ] || { angle: 0.5 };
	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitCircle( X(cx), Y(cy), 22 );
	if(hover) { ui.hot = id; tip( params()[ S.cursor ][0] + ": DRAG OR WHEEL", X(cx), Y(cy) + 34 ); }
	if(hover && ui.pressed && ui.active === null) { ui.active = id; e.y = ui.y; }
	if(ui.active === id && ui.down)
	{
		var d = Math.trunc( (e.y - ui.y) / 10 );
		if(d) { edit( d ); e.y -= d * 10; e.angle += d * 0.08; }
	}
	if(hover && ui.wheel && ui.active === null) { var dw = ui.wheel > 0 ? -1 : 1; edit( dw ); e.angle += dw * 0.08; ui.wheel = 0; }
	var sk = ["lm", "chrome", "cream", "soft"].indexOf( knob_skin ) >= 0 ? knob_skin : "lm";
	drawSkinKnob( sk, X(cx), Y(cy), 19, ((e.angle % 1) + 1) % 1, hover );
}

function padSlot( i )
{
	if(i < 8) return (S.perc ? PAD_PERC : PAD_DRUMS)[i];
	return PAD_LOW[ i - 8 ];
}

function drawPads()
{
	// labels: the percussion bank over the top row, the drums under it, the bottom row under it
	var lx = function(i){ return PAD_X[i]; };
	groupLine( "CABASA", lx(0) - 30, lx(1) + 30, 587, 6 ); txt( "1", X(lx(0)), Y(597), 10 ); txt( "2", X(lx(1)), Y(597), 10 );
	groupLine( "TAMBOURINE", lx(2) - 30, lx(3) + 30, 587, 6 ); txt( "1", X(lx(2)), Y(597), 10 ); txt( "2", X(lx(3)), Y(597), 10 );
	groupLine( "CONGAS", lx(4) - 30, lx(5) + 30, 587, 6 ); txt( "HI", X(lx(4)), Y(597), 10 ); txt( "LO", X(lx(5)), Y(597), 10 );
	txt( "COWBELL", X(lx(6)), Y(597), 11 ); txt( "CLAPS", X(lx(7)), Y(597), 11 );
	txt( "1", X(lx(0)), Y(693), 10 ); txt( "2", X(lx(1)), Y(693), 10 ); txt( "OPEN", X(lx(2)), Y(693), 10 );
	groupLine( "HI HAT", lx(0) - 30, lx(2) + 30, 703, -6 );
	txt( "HI", X(lx(3)), Y(693), 10 ); txt( "MID", X(lx(4)), Y(693), 10 ); txt( "LO", X(lx(5)), Y(693), 10 );
	groupLine( "TOMS", lx(3) - 30, lx(5) + 30, 703, -6 );
	txt( "1", X(lx(6)), Y(693), 10 ); txt( "2", X(lx(7)), Y(693), 10 );
	groupLine( "RIDE", lx(6) - 30, lx(7) + 30, 703, -6 );
	txt( "SIDESTICK", X(lx(0)), Y(799), 11 );
	txt( "1", X(lx(1)), Y(799), 10 ); txt( "2", X(lx(2)), Y(799), 10 ); txt( "3", X(lx(3)), Y(799), 10 );
	groupLine( "SNARE", lx(1) - 30, lx(3) + 30, 809, -6 );
	txt( "1", X(lx(4)), Y(799), 10 ); txt( "2", X(lx(5)), Y(799), 10 );
	groupLine( "BASS", lx(4) - 30, lx(5) + 30, 809, -6 );
	txt( "CRASH", X(lx(6)), Y(799), 11 ); txt( "PERCUSSION", X(lx(7)), Y(799), 11 );
	// the PERCUSSION bank LED and the bar on the right
	led( 800, 580, S.perc );
	ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.3;
	ctx.beginPath(); ctx.moveTo( X(800), Y(592) ); ctx.lineTo( X(800), Y(748) ); ctx.lineTo( X(794), Y(752) ); ctx.stroke();

	var st = ST || {}, pat = S.patterns[ S.pattern ], playingPat = st.playing && st.pat == S.pattern;
	var mid = M.id, hs = held[ mid ] = held[ mid ] || {};
	for(var i = 0; i < 16; ++i)
	{
		var cx = PAD_X[ i % 8 ], cy = PAD_Y[ i < 8 ? 0 : 1 ], lit = false, mark = false, slot = padSlot( i ), tipText;
		if(S.mode == "step")
		{
			var stp = S.page * 16 + i;
			lit = stp < pat.len && pat.hits.some(function(hh){ return hh[0] == stp && hh[1] == S.sel; });
			mark = playingPat && st.step == stp;
			tipText = stp < pat.len ? "STEP " + (stp + 1) + " · " + SLOT_NAMES[ S.sel ] : "PAST THE PATTERN'S END";
		}
		else if(S.mode == "patt" || S.mode == "song")
		{
			lit = i == S.pattern;
			mark = st.playing && st.pat == i && i != S.pattern;
			tipText = "PATTERN " + (i + 1) + (S.patterns[i].hits.length ? "" : " (EMPTY)") + (copied[ mid ] ? ": PASTE" : "");
		}
		else
		{
			lit = slot >= 0 ? !!(st.lit && st.lit[ slot ]) : S.perc;
			if(S.trigger && i != 15) { lit = false; tipText = SLOT_NAMES[ S.sel ] + " " + (i - 8 > 0 ? "+" : "") + (i - 8) + " SEMITONES"; }
			else tipText = slot >= 0 ? SLOT_NAMES[ slot ] : "PERCUSSION: THE TOP ROW PLAYS CABASA, TAMBOURINE, CONGAS, COWBELL, CLAPS";
		}
		var r = pad( "pad" + i, cx, cy, i + 1, lit, mark, tipText );
		if(r.clicked) padPressed( i, slot );
		// NOTE REPEAT: stop when the pad is let go
		if(hs[i] !== undefined && !r.held) { send({ type: "repeat", slot: hs[i], on: false }); delete hs[i]; }
	}
}

function padPressed( i, slot )
{
	var pat = S.patterns[ S.pattern ];
	if(S.mode == "step")
	{
		var stp = S.page * 16 + i;
		if(stp >= pat.len) return;
		var k = pat.hits.findIndex(function(h){ return h[0] == stp && h[1] == S.sel; });
		if(k >= 0) pat.hits.splice( k, 1 ); else pat.hits.push([ stp, S.sel, 1 ]);
		return;
	}
	if(S.mode == "patt" || S.mode == "song")
	{
		if(copied[ M.id ]) { S.patterns[i] = copied[ M.id ]; copied[ M.id ] = null; setStatus( "Pasted into pattern " + (i + 1) ); }
		S.pattern = i;
		return;
	}
	// PADS
	if(S.trigger && i != 15)
	{
		send({ type: "hit", slot: S.sel, vel: 1, record: true, tune: i - 8 });
		return;
	}
	if(slot < 0) { S.perc = !S.perc; return; } // PERCUSSION
	S.sel = slot;
	send({ type: "hit", slot: slot, vel: 1, record: true });
	if(S.note_repeat) { send({ type: "repeat", slot: slot, on: true }); held[ M.id ][i] = slot; }
}

function drawMixer()
{
	var st = ST || {};
	// pan sliders
	txt( "LEFT", X(882), Y(418), 9 ); txt( "RIGHT", X(882), Y(486), 9 );
	txt( "LEFT", X(1505), Y(418), 9 ); txt( "RIGHT", X(1505), Y(486), 9 );
	S.ch.forEach(function(c, i){
		var v = lmSlider( "pan" + i, MIX_X[i], 408, 492, (1 - c.pan) / 2, function(v){ var p = 1 - v * 2; return CH_LONG[i] + " PAN " + (Math.abs( p ) < 0.03 ? "CENTRE" : (p < 0 ? "L " : "R ") + Math.round( Math.abs( p ) * 100 ) + "%"); }, 0.5 );
		c.pan = Math.round( (1 - v * 2) * 100 ) / 100;
	});
	groupLine( "VOICE SELECT", 853, 1535, 515 );
	var selCh = SLOT_CH[ S.sel ];
	S.ch.forEach(function(c, i){
		var slots = SLOT_CH.map(function(ch, k){ return ch == i ? k : -1; }).filter(function(k){ return k >= 0; });
		var b = lmButton( "voice" + i, MIX_X[i], 545, 30, 28, function(cx, cy){
			if(c.mute) { ctx.fillStyle = "#ff4a3a"; ctx.fillRect( cx - 8, cy - 1, 16, 2 ); }
			if(c.solo) { ctx.fillStyle = "#ffd23a"; ctx.beginPath(); ctx.arc( cx, cy, 3, 0, Math.PI * 2 ); ctx.fill(); }
			if(c.send) { ctx.fillStyle = ORANGE; ctx.fillRect( cx + 8, cy - 9, 4, 4 ); }
		}, i == selCh, CH_LONG[i] + (slots.length > 1 ? ": PRESS AGAIN FOR " + slots.map(function(k){ return SLOT_NAMES[k]; }).join(" / ") : "") );
		if(b.clicked)
		{
			if(selCh == i && slots.length > 1) S.sel = slots[ (slots.indexOf( S.sel ) + 1) % slots.length ];
			else if(selCh != i) S.sel = slots[0];
			S.menu = "voice";
			send({ type: "hit", slot: S.sel, vel: 1, record: false });
		}
		if(st.lit && slots.some(function(k){ return st.lit[k]; }))
		{
			ctx.fillStyle = "rgba(255,130,40,0.9)";
			ctx.fillRect( X(MIX_X[i]) - 8, Y(527), 16, 3 );
		}
	});
	CH_NAMES.forEach(function(n, i){ txt( n, X(MIX_X[i]), Y(591), 9 ); });
	groupLine( "TOMS", MIX_X[4] - 14, MIX_X[6] + 14, 577, 5 );
	groupLine( "CONGA", MIX_X[11] - 14, MIX_X[12] + 14, 577, 5 );
	groupLine( "DRUMS", 853, 1225, 612 );
	groupLine( "PERCUSSION", 1255, 1535, 612 );
	// level faders
	S.ch.forEach(function(c, i){
		c.level = Math.round( lmSlider( "level" + i, MIX_X[i], 630, 800, c.level, function(v){ return CH_LONG[i] + " " + (v < 0.005 ? "-∞" : (20 * Math.log10( v * v * 1.4 )).toFixed(1) + " dB"); }, 0.75 ) * 1000 ) / 1000;
	});
	groupLine( "MIXER", 853, 1535, 811 );
}

// hits the sequencer recorded (from the pads or MIDI while REC and playing): into the patterns
function onState( m, state )
{
	if(!state.rec || !state.rec.length) return;
	var s = m.settings;
	state.rec.forEach(function(r){
		var p = s.patterns[ r[0] ];
		if(!p || r[1] >= p.len) return;
		if(!p.hits.some(function(h){ return h[0] == r[1] && h[1] == r[2]; }))
			p.hits.push([ r[1], r[2], r[3] ]);
	});
}

WR.registerSynth( "llmdram", {
	title: "LLM DRAM",
	description: "LLM DRAM: 8/12-bit sampling drum machine (early 80s style), 16 pads, mixer and sequencer",
	about: "An early 80s style drum machine: 24 gritty 8/12-bit sounds on 16 pads, a mixer, tuning, wave designer, filter and a 64-step sequencer.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^pad\\d+$", 3], ["^(play|stop|rec|tap)$", 3], ["^(mute|solo|step_repeat|note_repeat|auto_fill|trigger)$", 2], ["^mode_", 2], ["^voice\\d+$", 2], ["^(prev|next)$", 2], ["^(midi|usb|dump|save|samp|bank|length|quan|copy)$", 0], ["", 1]],
	category: "Synths",
	wood: true, // wooden sides
	worklet: "devices/llmdram-worklet.js",
	jacks: [],
	rear_jacks: REAR_JACKS,
	audio_out: "out_l",      // cabled into the rack in stereo when it is added
	audio_out_r: "out_r",
	midi_in: "midi_in",
	knob_skin: "lm",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	onState: onState,
	size: function() { return SIZE; },
	draw: draw,
	rear_note: function( s ) { return "16 VOICES · PATTERN " + (s.pattern + 1) + " · " + (s.sync ? "SYNC" : Math.round( s.tempo ) + " BPM"); },
	transport: function( mod, action, value ) {
		if(action == "play") mod.post({ type: "play", value: value });
		else if(action == "trigger") mod.post({ type: "hit", slot: 0, vel: 1 });
	}
});

})();
