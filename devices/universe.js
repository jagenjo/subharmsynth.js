// devices/universe.js
// UNIVERSE module, a granular / looper / delay effect, half rack
// width, laid out as the pedal: ACTIVITY, SHAPE, FILTER, MIX / TIME, REPEATS, SPACE, LOOP LEVEL (SHIFT:
// their secondary controls), SELECT (SUBDIV / TEMPO), the preset knob among the 11 effects (x A-D
// = 44 presets), the PHRASE LOOPER, the A-D lights and the footswitches (TAP / REC-PLAY-DUB, bypass,
// HOLD / STOP-ERASE). CV jacks on the top edge, stereo audio on the back.
// DSP in universe-worklet.js.

(function(){

var H = 470;
var EFFECTS = [
	["MICRO LOOP", ["MOSAIC", "SEQ", "GLIDE"]],
	["GRANULES", ["HAZE", "TUNNEL", "STRUM"]],
	["GLITCH", ["BLOCKS", "INTERRUPT", "ARP"]],
	["MULTIDELAY", ["PATTERN", "WARP"]]
];
var NAMES = ["MOSAIC", "SEQ", "GLIDE", "HAZE", "TUNNEL", "STRUM", "BLOCKS", "INTERRUPT", "ARP", "PATTERN", "WARP"];
// what each variation does, and what ACTIVITY does in each effect (from the pedal's manual)
var VARIATIONS = {
	MOSAIC: ["NORMAL + DOUBLE SPEED (OCTAVE UP)", "NORMAL + HALF SPEED (OCTAVE DOWN)", "ALL LOOPS AT DOUBLE SPEED", "HALF, NORMAL, DOUBLE AND 4X SPEED"],
	SEQ: ["FILTERED, SHUFFLED RANDOM RHYTHMS", "NORMAL / HALF SPEED (+ SUSTAINER)", "OVERLAPPING LAYERS, FILTER SWEEPS", "INTERLOCKING, BIT-CRUSHED (+ SUB)"],
	GLIDE: ["HALF \u2194 NORMAL SPEED", "DOUBLE \u2194 HALF SPEED", "NORMAL \u2194 DOUBLE SPEED", "BOTH DIRECTIONS AT ONCE"],
	HAZE: ["SHORT, DIFFUSE, STRETCHED", "MANY RANDOM GRAINS", "NORMAL + DOUBLE SPEED GRAINS", "NORMAL + HALF SPEED GRAINS"],
	TUNNEL: ["DRONE COMPRESSES AND LENGTHENS", "SUB OCTAVE DRONE, FILTER SWEEPS", "RESONANT BAND PASS FILTERS", "ENVELOPE-TRIGGERED, PER NOTE"],
	STRUM: ["REPEATS THE LAST NOTE", "OVERLAPPING COPIES: PHASING", "CASCADING CHAINS OF NOTES", "CHAINS + DOUBLE SPEED GRAINS"],
	BLOCKS: ["REARRANGED + BURSTS OF NOTES", "REARRANGED, PITCH-SHIFTED", "SOFT: FILTERED, FADING SAMPLES", "PITCH-SHIFTED + BIT-CRUSHED"],
	INTERRUPT: ["REARRANGED PLAYING CUTS IN", "PITCH-SHIFTED INTERRUPTIONS", "FILTER SWEEPS AND DELAY", "BIT-CRUSHED, DRASTIC"],
	ARP: ["ARPEGGIOS OF THE LAST NOTE", "PITCH-SHIFTED SPEED PATTERN", "A RANDOM FILTER EACH STEP", "BIT-CRUSHED ARPEGGIOS"],
	PATTERN: ["RHYTHM 1: CLASSIC DELAY", "RHYTHM 2", "RHYTHM 3", "RHYTHM 4"],
	WARP: ["ENVELOPE FILTER ON EACH TAP", "RESONANT BAND PASS ON EACH TAP", "PITCH-SHIFTED TAPS", "TAPS + DOUBLE SPEED GRAINS"]
};
var ACTIVITY = { MOSAIC: "LOOPERS ACTIVE", SEQ: "VARIATION / LAYERS", GLIDE: "GLIDE SPEED", HAZE: "DENSITY AND SPREAD", TUNNEL: "DEPTH OF THE CHANGES",
	STRUM: "DENSITY", BLOCKS: "VARIATION", INTERRUPT: "VARIATION", ARP: "ARPEGGIO STEPS", PATTERN: "DELAY TAPS", WARP: "DELAY TAPS" };
var REPEATS = { INTERRUPT: "HOW OFTEN", TUNNEL: "DRONE DECAY", PATTERN: "FEEDBACK", WARP: "FEEDBACK" }; // others: echoes of each sample
var REVERBS = ["ROOM", "HALL", "CATHEDRAL", "AMBIENT WASH"];
var TIMES = ["\u00bc\u00d7 (1 BAR)", "\u00bd\u00d7 (1/2)", "1\u00d7 (1/4, THE TEMPO)", "2\u00d7 (1/8)", "4\u00d7 (1/16)", "8\u00d7 (1/32)"];
var LOOPER_SPEEDS = ["¼ X", "½ X", "1 X", "2 X", "4 X"];
var JACKS = [
	[["CLOCK","in","clock_in"], ["HOLD","in","hold_in"]],
	[["ACTIVITY","in","activity_in"], ["MIX","in","mix_in"]],
	[["CLOCK","out","clock_out"], ["ENV","out","env_out"]]
];
var REAR_JACKS = [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];

var M = null;
var taps = {}; // module id -> recent TAP times

function defaults()
{
	return {
		preset: 0, activity: 0.5, repeats: 0.3, shape: 0.5, filter: 0.8, resonance: 0.2,
		mix: 0.5, subdiv: 3, space: 0.3, reverb_mode: 1, loop_level: 0.8, looper_speed: 2, fx_volume: 1,
		mod_depth: 0, mod_rate: 0.3, tempo: 120, sync: true,
		hold: false, bypass: false, fx_reverse: false, reverse: false, looper_pre: false, looper_only: false,
		looper: false, burst: false, loop_quantize: false, loop_fade: 0, time_mode: "subdiv", shift: false
	};
}

function validate( s )
{
	s.preset = Math.min( 43, Math.max( 0, Math.round( s.preset ) ) );
	s.reverb_mode = Math.min( 3, Math.max( 0, Math.round( s.reverb_mode ) ) );
	s.fx_volume = Math.min( 1.5, Math.max( 0, s.fx_volume ) );
	s.subdiv = Math.min( TIMES.length - 1, Math.max( 0, Math.round( s.subdiv ) ) );
	s.looper_speed = Math.min( LOOPER_SPEEDS.length - 1, Math.max( 0, Math.round( s.looper_speed ) ) );
	s.tempo = Math.min( 300, Math.max( 30, s.tempo ) );
	s.loop_fade = Math.min( 10, Math.max( 0, s.loop_fade ) );
	if(s.time_mode != "tempo") s.time_mode = "subdiv";
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	s.preset = Math.floor( Math.random() * 44 );
	s.activity = rnd( 0.2, 0.9 ); s.repeats = rnd( 0, 0.6 ); s.shape = rnd( 0, 1 );
	s.filter = rnd( 0.5, 1 ); s.resonance = rnd( 0, 0.5 ); s.mix = rnd( 0.35, 0.75 );
	s.subdiv = Math.floor( rnd( 1, 5 ) ); s.reverb_mode = Math.floor( rnd( 0, 4 ) ); s.space = rnd( 0, 0.6 ); s.mod_depth = Math.random() < 0.3 ? rnd( 0, 0.5 ) : 0;
}

function send( msg )
{
	var m = M;
	act(function(){ m.post( msg ); });
}

function tap( id )
{
	var now = performance.now(), t = (taps[id] || []).filter(function(x){ return now - x < 2000; });
	t.push( now );
	taps[id] = t;
	if(t.length >= 2)
	{
		M.settings.tempo = Math.min( 300, Math.max( 30, Math.round( 60000 / ((now - t[0]) / (t.length - 1)) ) ) );
		M.settings.sync = false;
	}
}

// ---------------------------------------------------------------------------
// the panel, laid out as the pedal's: a light grey enclosure with navy print; two rows of knobs
// (their secondary controls with SHIFT); SELECT with the SUBDIV / TEMPO lights; the preset knob
// among the four groups of effects; the PHRASE LOOPER box; the A-D lights; three footswitches.
// The CV jacks sit on the top edge, as a pedal's jacks do

var BODY = "#d7d9dd", NAVY = "#252d4b", GREY_TXT = "#7d8392", BLUE = "#3ba3e6", AMBER = "#ffb23a";
var P_FONT = "Arial, Helvetica, sans-serif", TOP = 64;
var foot = {}; // module id -> footswitch presses

function txt( t, x, y, size, color, align, style )
{
	ctx.font = (style || "bold italic ") + size + "px " + P_FONT;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = color || NAVY;
	ctx.fillText( t, x, y );
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

function led( x, y, on, color, r )
{
	r = r || 4.5;
	if(on)
	{
		var g = ctx.createRadialGradient( x, y, 1, x, y, r * 3 );
		g.addColorStop( 0, color ); g.addColorStop( 1, "rgba(255,255,255,0)" );
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.arc( x, y, r * 3, 0, Math.PI * 2 ); ctx.fill();
	}
	ctx.fillStyle = "#1c2030";
	ctx.beginPath(); ctx.arc( x, y, r + 1.2, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = on ? color : "#4a3a5a";
	ctx.beginPath(); ctx.arc( x, y, r, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "rgba(255,255,255,0.45)";
	ctx.beginPath(); ctx.arc( x - r * 0.3, y - r * 0.35, r * 0.35, 0, Math.PI * 2 ); ctx.fill();
}

// an LED with its name, both clickable (ledLeft: the LED left of the name)
function ledItem( id, x, y, name, on, ledLeft, tooltip, color )
{
	ctx.font = "bold italic 10px " + P_FONT;
	var tw = ctx.measureText( name ).width;
	var bx = ledLeft ? x - 7 : x - tw - 14, r = hot( id, bx, y - 8, tw + 22, 16 );
	led( ledLeft ? x : x, y, on, color || AMBER );
	txt( name, ledLeft ? x + 10 : x - 10, y + 1, 10, NAVY, ledLeft ? "left" : "right" );
	if(r.hover && tooltip) tip( tooltip, x, y + 18 );
	return r.clicked;
}

// the blue printed pill (USER, REVERSE, SHIFT, SYNC); on: brighter
function pill( id, x, y, w, text, on, tooltip )
{
	var r = hot( id, x, y - 8, w, 16 );
	ctx.fillStyle = on ? "#62c0ff" : BLUE;
	ctx.beginPath(); ctx.roundRect( x, y - 7, w, 14, 3 ); ctx.fill();
	if(on) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect( x - 1, y - 8, w + 2, 16, 4 ); ctx.stroke(); }
	txt( text, x + w / 2, y + 1, 9, "#ffffff" );
	if(r.hover && tooltip) tip( tooltip, x + w / 2, y + 18 );
	return r.clicked;
}

// a round push button with a lit top (SELECT, the looper's)
function roundButton( id, x, y, r, on, color, tooltip, white )
{
	var h = hot( id, x - r - 2, y - r - 2, 2 * r + 4, 2 * r + 4 );
	ctx.fillStyle = "rgba(0,0,0,0.25)";
	ctx.beginPath(); ctx.arc( x + 1, y + 2, r + 2, 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createLinearGradient( x - r, y - r, x + r, y + r );
	g.addColorStop( 0, "#f2f3f5" ); g.addColorStop( 1, "#7f848c" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( x, y, r + 2, 0, Math.PI * 2 ); ctx.fill();
	if(white) { ctx.fillStyle = h.held ? "#d8dadf" : "#f7f8fa"; ctx.beginPath(); ctx.arc( x, y, r - 1, 0, Math.PI * 2 ); ctx.fill(); }
	else led( x, y, on, color, r - 2 );
	if(h.hover && tooltip) tip( tooltip, x, y + r + 14 );
	return h;
}

// a chrome footswitch
function footswitch( id, x, y, tooltip )
{
	var h = hot( id, x - 24, y - 24, 48, 48 );
	ctx.fillStyle = "rgba(0,0,0,0.22)";
	ctx.beginPath(); ctx.arc( x + 2, y + 4, 24, 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createLinearGradient( x - 24, y - 24, x + 24, y + 24 );
	g.addColorStop( 0, "#f6f7f8" ); g.addColorStop( 0.5, "#9da2a9" ); g.addColorStop( 1, "#dfe2e5" );
	ctx.fillStyle = g;
	ctx.beginPath();
	for(var i = 0; i < 6; ++i) { var a = i * Math.PI / 3; ctx.lineTo( x + Math.cos(a) * 24, y + Math.sin(a) * 24 ); }
	ctx.closePath(); ctx.fill();
	ctx.strokeStyle = "rgba(40,45,60,0.35)"; ctx.lineWidth = 1; ctx.stroke();
	g = ctx.createRadialGradient( x - 6, y - 7, 2, x, y, 16 );
	g.addColorStop( 0, "#ffffff" ); g.addColorStop( 0.6, h.held ? "#a8adb4" : "#c3c7cd" ); g.addColorStop( 1, "#6c7178" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( x, y + (h.held ? 1 : 0), 15, 0, Math.PI * 2 ); ctx.fill();
	if(h.hover && tooltip) tip( tooltip, x, y + 34 );
	return h;
}

// a navy outlined box, its title breaking the top edge
function box( x, y, w, h, title )
{
	ctx.strokeStyle = NAVY; ctx.lineWidth = 1.6;
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 7 ); ctx.stroke();
	ctx.font = "bold italic 12px " + P_FONT;
	var tw = ctx.measureText( title ).width + 10;
	ctx.fillStyle = BODY;
	ctx.fillRect( x + w / 2 - tw / 2, y - 3, tw, 6 );
	txt( title, x + w / 2, y, 12 );
}

function drawBody( w, h )
{
	// a dark shelf in the rack (the move / remove buttons on its right edge), the jacks' edge on
	// top, then the enclosure
	ctx.fillStyle = "#121214";
	ctx.fillRect( 0, 0, w, h );
	var g = ctx.createLinearGradient( 0, 0, 0, TOP );
	g.addColorStop( 0, "#9fa3aa" ); g.addColorStop( 1, "#c4c7cc" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( 26, 4, w - 52, TOP, 10 ); ctx.fill();
	g = ctx.createLinearGradient( 0, TOP, 0, h );
	g.addColorStop( 0, "#e4e6e9" ); g.addColorStop( 1, BODY );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( 26, TOP - 4, w - 52, h - TOP, 12 ); ctx.fill();
	ctx.strokeStyle = "rgba(60,64,75,0.35)"; ctx.lineWidth = 1.2;
	ctx.beginPath(); ctx.roundRect( 26.5, TOP - 3.5, w - 53, h - TOP - 1, 12 ); ctx.stroke();
}

function knobLabel( x, y, main, second, shift )
{
	txt( main, x, y, 12, shift && second ? GREY_TXT : NAVY );
	if(second) txt( second, x, y + 12, 8, shift ? NAVY : GREY_TXT, "center", "bold " );
}

// the emblem (a ringed planet, in stripes of colour) and the name
function drawLogo( x, y )
{
	var cols = ["#e8452c", "#f28a2e", "#f6c23a", "#5bbf6a", "#3ba3e6"];
	ctx.save();
	ctx.beginPath(); ctx.arc( x, y, 16, 0, Math.PI * 2 ); ctx.clip();
	cols.forEach(function(c, i){ ctx.fillStyle = c; ctx.fillRect( x - 16, y - 16 + i * 6.4, 32, 6.4 ); });
	ctx.restore();
	ctx.strokeStyle = NAVY; ctx.lineWidth = 2.2;
	ctx.beginPath(); ctx.ellipse( x, y + 1, 26, 7, -0.25, 0.15 * Math.PI, 1.0 * Math.PI ); ctx.stroke();
	ctx.strokeStyle = BODY; ctx.lineWidth = 5;
	ctx.font = "bold italic 17px " + P_FONT;
	ctx.textAlign = "left"; ctx.textBaseline = "middle";
	ctx.strokeText( "UNIVERSE", x + 30, y + 1 );
	ctx.fillStyle = NAVY;
	ctx.fillText( "UNIVERSE", x + 30, y + 1 );
}

function draw( mod )
{
	M = mod;
	var st = M.state = M.state || {};
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings, sh = !!s.shift;
	var fx = Math.floor( s.preset / 4 ), v = s.preset % 4, name = NAMES[ fx ];
	drawBody( w, h );

	// ---- the CV jacks on the top edge ----
	[["clock_in", "CLOCK", "in"], ["hold_in", "HOLD", "in"], ["activity_in", "ACTIVITY", "in"], ["mix_in", "MIX", "in"], ["clock_out", "CLOCK", "out"], ["env_out", "ENV", "out"]].forEach(function(j, i){
		drawJack( j[0], 70 + i * 60 + (i >= 4 ? 30 : 0), 40, j[1], j[2] );
	});

	// ---- the knobs (SHIFT: their secondary controls) ----
	var kx = [70, 150, 230, 310], k1 = TOP + 50, k2 = TOP + 146;
	knob_scale_color = "#3a4260";
	var R = 22;
	s.activity = knob( "activity", kx[0], k1, R, s.activity, 0, 1, { def: 0.5, format: function(x){ return "ACTIVITY " + fmtPct( x ) + ": " + ACTIVITY[ name ]; } } );
	knobLabel( kx[0], k1 + 38, "ACTIVITY", "", sh );
	if(sh) s.mod_rate = knob( "mod_rate", kx[1], k1, R, s.mod_rate, 0, 1, { def: 0.3, format: function(x){ return "MOD FREQ " + (0.05 + x * 8).toFixed(2) + " Hz"; } } );
	else s.shape = knob( "shape", kx[1], k1, R, s.shape, 0, 1, { def: 0.5, format: function(x){ return "SHAPE: " + (name == "GLIDE" ? "GLIDE PATTERN " + (x < 0.33 ? "RAMP" : (x < 0.66 ? "TRIANGLE" : "SMOOTH")) : (x < 0.25 ? "PERCUSSIVE" : (x > 0.75 ? "SWELL" : (Math.abs( x - 0.5 ) < 0.08 ? "FLAT" : fmtPct( x ))))); } } );
	knobLabel( kx[1], k1 + 38, "SHAPE", "MOD FREQ", sh );
	if(sh) s.resonance = knob( "resonance", kx[2], k1, R, s.resonance, 0, 1, { def: 0.2, format: function(x){ return "RESONANCE " + fmtPct( x ); } } );
	else s.filter = knob( "filter", kx[2], k1, R, s.filter, 0, 1, { def: 0.8, format: function(x){ return "FILTER " + fmtHz( 150 * Math.pow( 120, x ) ); } } );
	knobLabel( kx[2], k1 + 38, "FILTER", "RESONANCE", sh );
	if(sh) s.fx_volume = knob( "fx_volume", kx[3], k1, R, s.fx_volume, 0, 1.5, { def: 1, format: function(x){ return "EFFECT VOLUME " + fmtPct( x ); } } );
	else s.mix = knob( "mix", kx[3], k1, R, s.mix, 0, 1, { def: 0.5, format: function(x){ return x < 0.02 ? "DRY" : (x > 0.98 ? "WET" : Math.round( (1 - x) * 100 ) + " DRY / " + Math.round( x * 100 ) + " WET"); } } );
	knobLabel( kx[3], k1 + 38, "MIX", "EFFECT VOLUME", sh );
	// TIME: the subdivision on the blue scale, or (TEMPO) the tempo; SHIFT: the looper's speed
	ctx.strokeStyle = BLUE; ctx.lineWidth = 3;
	ctx.beginPath(); ctx.arc( kx[0], k2, R + 9, KNOB_A0, KNOB_A0 + KNOB_SWEEP ); ctx.stroke();
	["¼", "½", "TAP", "2X", "4X", "8X"].forEach(function(l, i){
		var a = KNOB_A0 + i / 5 * KNOB_SWEEP;
		txt( l, kx[0] + Math.cos(a) * (R + 19), k2 + Math.sin(a) * (R + 19), 8, BLUE, "center", "bold " );
	});
	if(sh) s.looper_speed = knob( "looper_speed", kx[0], k2, R, s.looper_speed, 0, LOOPER_SPEEDS.length - 1, { step: 1, def: 2, ticks: 1, format: function(x){ return "LOOPER SPEED " + LOOPER_SPEEDS[x]; } } );
	else if(s.time_mode == "tempo") s.tempo = knob( "tempo", kx[0], k2, R, s.tempo, 30, 300, { def: 120, ticks: 1, format: function(x){ return "TEMPO " + Math.round( x ) + " BPM" + (s.sync ? " (SYNC ON: THE RACK'S TEMPO WINS)" : ""); } } );
	else s.subdiv = knob( "subdiv", kx[0], k2, R, s.subdiv, 0, TIMES.length - 1, { step: 1, def: 3, ticks: 1, format: function(x){ return "TIME " + TIMES[x] + " at " + Math.round( st.tempo || s.tempo ) + " BPM"; } } );
	knobLabel( kx[0], k2 + 40, "TIME", sh ? "LOOPER SPEED" : "", sh );
	if(sh) s.mod_depth = knob( "mod_depth", kx[1], k2, R, s.mod_depth, 0, 1, { def: 0, format: function(x){ return "MOD DEPTH " + fmtPct( x ); } } );
	else s.repeats = knob( "repeats", kx[1], k2, R, s.repeats, 0, 1, { def: 0.3, format: function(x){ return "REPEATS " + (REPEATS[ name ] ? fmtPct( x ) + " " + REPEATS[ name ] : Math.floor( x * 6.99 ) + " ECHOES OF EACH SAMPLE"); } } );
	knobLabel( kx[1], k2 + 38, "REPEATS", "MOD DEPTH", sh );
	if(sh) s.reverb_mode = knob( "reverb_mode", kx[2], k2, R, s.reverb_mode, 0, 3, { step: 1, def: 1, format: function(x){ return "REVERB: " + REVERBS[x]; } } );
	else s.space = knob( "space", kx[2], k2, R, s.space, 0, 1, { def: 0.3, format: function(x){ return "SPACE " + fmtPct( x ) + " (" + REVERBS[ s.reverb_mode ] + ")"; } } );
	knobLabel( kx[2], k2 + 38, "SPACE", "REVERB TIME", sh );
	if(sh) s.loop_fade = knob( "loop_fade", kx[3], k2, R, s.loop_fade, 0, 10, { def: 0, format: function(x){ return x < 0.02 ? "FADE TIME: OFF" : "FADE TIME " + x.toFixed(1) + " s"; } } );
	else s.loop_level = knob( "loop_level", kx[3], k2, R, s.loop_level, 0, 1, { def: 0.8, format: function(x){ return "LOOP LEVEL " + fmtPct( x ); } } );
	knobLabel( kx[3], k2 + 38, "LOOP LEVEL", "FADE TIME", sh );

	// ---- SELECT (SUBDIV / TEMPO), SHIFT, SYNC ----
	var sy = TOP + 232;
	var sel = roundButton( "select", kx[0], sy, 10, !!st.step, AMBER, "SELECT: THE TIME KNOB SETS THE SUBDIVISION OR THE TEMPO" );
	if(sel.clicked) s.time_mode = s.time_mode == "tempo" ? "subdiv" : "tempo";
	txt( "○ SELECT", kx[0] + 18, sy - 5, 8, NAVY, "left", "bold " );
	txt( "• SHIFT", kx[0] + 18, sy + 6, 8, NAVY, "left", "bold " );
	ctx.strokeStyle = NAVY; ctx.lineWidth = 1.3;
	ctx.beginPath(); ctx.moveTo( kx[0], sy + 13 ); ctx.lineTo( kx[0], sy + 30 ); ctx.moveTo( kx[0] - 22, sy + 30 ); ctx.lineTo( kx[0] + 22, sy + 30 ); ctx.stroke();
	led( kx[0] - 22, sy + 30, s.time_mode != "tempo", "#ffd23a", 5 );
	led( kx[0] + 22, sy + 30, s.time_mode == "tempo", BLUE, 5 );
	txt( "SUBDIV", kx[0] - 22, sy + 46, 8, NAVY, "center", "bold " );
	txt( "TEMPO", kx[0] + 22, sy + 46, 8, NAVY, "center", "bold " );
	if(pill( "shift", kx[1] + 4, sy - 2, 54, "SHIFT", sh, "SHIFT: THE KNOBS SET THEIR SECONDARY CONTROLS (GREY)" )) s.shift = !s.shift;
	if(pill( "sync", kx[1] + 4, sy + 22, 54, "SYNC", s.sync, "SYNC: FOLLOW THE RACK'S TEMPO (MIDI CLOCK AND CLOCK IN ALWAYS WIN)" )) s.sync = !s.sync;

	// ---- the preset selector among the four groups ----
	var cx = w - 188, cy = TOP + 96, bw = 108;
	box( cx - 150, TOP + 22, bw, 72, "MICRO LOOP" );
	box( cx + 42, TOP + 22, bw, 72, "GRANULES" );
	box( cx - 150, TOP + 116, bw, 72, "GLITCH" );
	box( cx + 42, TOP + 116, bw, 56, "MULTIDELAY" );
	var item = function(i, x, y, left) {
		var on = i == fx;
		if(ledItem( "fx" + i, x, y, NAMES[i], on, left, NAMES[i] + " " + "ABCD"[v] + ": " + VARIATIONS[ NAMES[i] ][ v ], on ? AMBER : "#b04ad0" ))
			s.preset = i * 4 + v;
	};
	[0, 1, 2].forEach(function(r){ item( r, cx - 136, TOP + 40 + r * 18, true ); });
	[3, 4, 5].forEach(function(r, k){ item( r, cx + 136, TOP + 40 + k * 18, false ); });
	[6, 7, 8].forEach(function(r, k){ item( r, cx - 136, TOP + 134 + k * 18, true ); });
	[9, 10].forEach(function(r, k){ item( r, cx + 136, TOP + 136 + k * 18, false ); });
	s.preset = knob( "preset", cx, cy, 26, s.preset, 0, 43, { step: 1, ticks: 1, def: 0, format: function(x){ var n = NAMES[ Math.floor( x / 4 ) ]; return n + " " + "ABCD"[ x % 4 ] + ": " + VARIATIONS[n][ x % 4 ]; } } );
	txt( "FWD/REV", cx + 30, cy - 36, 8, NAVY, "center", "bold " );
	var fr = hot( "fx_reverse", cx + 8, cy - 44, 46, 26 );
	led( cx + 30, cy - 26, s.fx_reverse, "#ff5a2a", 3.5 );
	if(fr.hover) tip( "FWD / REV: THE EFFECT BACKWARDS", cx + 30, cy - 4 );
	if(fr.clicked) s.fx_reverse = !s.fx_reverse;
	led( cx, cy + 38, false, NAVY, 2 );
	txt( "SAVE", cx, cy + 50, 8, NAVY, "center", "bold " );
	if(pill( "user", cx + 54, TOP + 186, 70, "USER", false, "USER PRESETS: THE RACK SAVES ITSELF (SESSIONS, SAVE AS)" )) setStatus( "UNIVERSE: user presets are the rack's patches and sessions" );
	led( cx + 138, TOP + 186, false, "#b04ad0", 4 );

	// ---- PHRASE LOOPER ----
	var lx = cx - 150, ly = TOP + 214, lw = 300, lh = 98, ls = st.loop || "empty";
	box( lx, ly, lw, lh, "PHRASE LOOPER" );
	if(ledItem( "looper_pre", lx + 16, ly + 24, "PRE-FX", s.looper_pre, true, "PRE-FX: RECORD THE DRY INPUT, THE EFFECTS PLAY ON IT", "#b04ad0" )) s.looper_pre = !s.looper_pre;
	if(ledItem( "looper_only", lx + 16, ly + 44, "LOOPER ONLY", s.looper_only, true, "LOOPER ONLY: THE EFFECTS OFF, THE LOOP AND THE DRY SIGNAL", "#b04ad0" )) s.looper_only = !s.looper_only;
	if(ledItem( "burst", lx + lw - 16, ly + 24, "BURST", s.burst, false, "BURST: REC RECORDS WHILE HELD, PLAYS WHEN RELEASED", "#b04ad0" )) s.burst = !s.burst;
	if(ledItem( "loop_quantize", lx + lw - 16, ly + 44, "QUANTIZE", s.loop_quantize, false, "QUANTIZE: THE LOOP TRIMMED TO THE NEAREST BEAT", "#b04ad0" )) s.loop_quantize = !s.loop_quantize;
	var lcol = { recording: "#ff3b30", overdub: "#ff8a30", playing: "#4cd964", fading: "#4cd964", stopped: "#ffffff" }[ ls ];
	if(roundButton( "looper", lx + lw / 2, ly + 32, 11, s.looper, ls == "empty" ? AMBER : lcol, "THE PHRASE LOOPER: THE FOOTSWITCHES RECORD / PLAY / DUB AND STOP / ERASE" ).clicked) s.looper = !s.looper;
	if(roundButton( "reverse_btn", lx + lw / 2 - 52, ly + 72, 8, false, "", "REVERSE THE LOOP", true ).clicked) s.reverse = !s.reverse;
	if(pill( "reverse", lx + lw / 2 - 36, ly + 72, 96, "REVERSE", s.reverse, "REVERSE THE LOOP" )) s.reverse = !s.reverse;
	// where the loop is
	ctx.fillStyle = "#b9bdc4";
	ctx.fillRect( lx + 16, ly + 84, 80, 4 );
	if(ls != "empty")
	{
		ctx.fillStyle = lcol;
		var f = ls == "recording" ? Math.min( 1, (st.loop_pos || 0) / 60 ) : (st.loop_pos || 0);
		ctx.fillRect( lx + 16, ly + 84, 80 * f, 4 );
	}
	txt( ls == "empty" ? "EMPTY" : ls.toUpperCase() + (st.loop_len ? " " + st.loop_len.toFixed(1) + "s" : ""), lx + 16, ly + 72, 8, GREY_TXT, "left", "bold " );

	// ---- the A-D lights ----
	var ax = Math.round( w * 0.47 ) - 38, ay = TOP + 252;
	for(var j = 0; j < 4; j++)
	{
		var bx = ax + j * 20, on = j == v;
		var hb = hot( "var" + j, bx - 2, ay - 2, 20, 50 );
		ctx.fillStyle = on ? "rgba(255,180,60,0.35)" : "rgba(170,215,255,0.35)";
		ctx.beginPath(); ctx.roundRect( bx - 3, ay - 3, 22, 52, 5 ); ctx.fill();
		var g = ctx.createLinearGradient( bx, 0, bx + 16, 0 );
		g.addColorStop( 0, on ? "#ffd27a" : "#e6f4ff" ); g.addColorStop( 1, on ? AMBER : "#a9d6f5" );
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.roundRect( bx, ay, 16, 46, 3 ); ctx.fill();
		if(hb.hover) tip( name + " " + "ABCD"[j] + ": " + VARIATIONS[ name ][j], bx + 8, ay + 60 );
		if(hb.clicked) s.preset = fx * 4 + j;
	}
	txt( name + " " + "ABCD"[v], ax + 38, ay + 58, 9, NAVY, "center", "bold " );

	// ---- the footswitches ----
	var fy = h - 46, f1 = 80, f2 = Math.round( w * 0.47 ), f3 = w - 92;
	ctx.fillStyle = "#4a5068";
	ctx.fillRect( f1, fy - 2, f3 - f1, 4 );
	txt( "TAP", f1 - 22, fy - 40, 11, NAVY, "left" );
	txt( "REC/PLAY/DUB", f1 - 22, fy - 28, 9, BLUE, "left" );
	txt( "HOLD", f3 + 22, fy - 40, 11, NAVY, "right" );
	txt( "STOP/ERASE", f3 + 22, fy - 28, 9, BLUE, "right" );
	ctx.fillStyle = BODY;
	ctx.fillRect( (f1 + f2) / 2 - 62, fy - 22, 136, 44 );
	drawLogo( (f1 + f2) / 2 - 40, fy );
	var fs = foot[ M.id ] = foot[ M.id ] || {};
	// left: TAP, or the looper's REC / PLAY / DUB (BURST: records while held)
	var L = footswitch( "foot_l", f1, fy, s.looper ? (s.burst ? "BURST: HOLD TO RECORD, LET GO TO PLAY" : "REC / PLAY / DUB") : "TAP THE TEMPO" );
	if(L.clicked)
	{
		if(!s.looper) tap( M.id );
		else if(s.burst) { if(ls != "empty") send({ type: "loopErase" }); send({ type: "looper" }); fs.burst = true; }
		else send({ type: "looper" });
	}
	if(fs.burst && !L.held) { fs.burst = false; send({ type: "looper" }); }
	led( f1, fy - 58, s.looper ? ls == "recording" || ls == "overdub" : !!st.step, s.looper ? "#ff3b30" : AMBER, 3.5 );
	// middle: bypass
	if(footswitch( "foot_m", f2, fy, s.bypass ? "BYPASSED: PRESS TO ENGAGE" : "ENGAGED: PRESS TO BYPASS" ).clicked) s.bypass = !s.bypass;
	led( f2, fy - 34, !s.bypass, "#ff3b30", 3.5 );
	// right: HOLD, or the looper's STOP (held a second: ERASE)
	var Rf = footswitch( "foot_r", f3, fy, s.looper ? "STOP (HOLD FOR A SECOND: ERASE)" : "HOLD: FREEZE WHAT IS PLAYING" );
	if(Rf.clicked) { if(s.looper) fs.down = performance.now(); else s.hold = !s.hold; }
	if(fs.down)
	{
		if(Rf.held && performance.now() - fs.down > 1000) { send({ type: "loopErase" }); fs.down = 0; setStatus( "UNIVERSE: loop erased" ); }
		else if(!Rf.held) { send({ type: "loopStop" }); fs.down = 0; }
	}
	led( f3, fy - 58, s.looper ? ls == "playing" || ls == "overdub" : !!(st.hold === undefined ? s.hold : st.hold), s.looper ? "#4cd964" : "#62c0ff", 3.5 );
	knob_scale_color = null;
	M = null;
}

WR.registerSynth( "universe", {
	title: "UNIVERSE",
	description: "UNIVERSE: granular micro loops, glitches, delays and a phrase looper",
	about: "11 granular, looping, glitch and delay effects x 4 variations, a reverb and a phrase looper. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^foot_[lmr]$", 3], ["^(var\\d|fx\\d+|looper)$", 2], ["^(user|reverse_btn)$", 0], ["", 1]],
	category: "Effects",
	half: true,
	insert: true,
	worklet: "devices/universe-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	midi_in: "midi_in", // MIDI clock
	knob_skin: "greycap",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return s.bypass ? "BYPASSED: DRY THROUGH" : NAMES[ Math.floor( s.preset / 4 ) ] + " " + "ABCD"[ s.preset % 4 ]; }
});

})();
