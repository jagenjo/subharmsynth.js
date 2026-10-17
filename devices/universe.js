// devices/universe.js
// UNIVERSE module, a replica of the Hologram Microcosm (granular / looper / delay pedal), half rack
// width: the effect selector (11 effects x variations A-D = 44 presets), ACTIVITY, REPEATS, SHAPE,
// FILTER, MIX, TIME, SPACE, LOOP LEVEL (the pedal's secondary controls as small knobs beside them),
// TAP / SYNC, HOLD, BYPASS, the phrase looper, a small CV patch bay. Stereo audio on the back.
// DSP in universe-worklet.js.

(function(){

var H = 420;
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
		hold: false, bypass: false, fx_reverse: false, reverse: false, looper_pre: false, looper_only: false
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

// a small secondary knob, up and right of its main one
function second( id, x, y, value, min, max, o )
{
	o.labelSize = 9;
	return knob( id, x, y, 11, value, min, max, o );
}

function draw( mod )
{
	M = mod;
	var st = M.state = M.state || {};
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings;
	drawDevicePanel( 0, 0, w, h, "UNIVERSE", ["GRANULAR · LOOPER", "MICRO LOOP · DELAY"] );
	var px = drawDeviceJacks( 0, 0, w, h, JACKS );
	var right = px - 14, colW = (right - 40) / 4;

	// effect selector: 11 effects in 4 groups, then the variation A-D
	var fx = Math.floor( s.preset / 4 ), v = s.preset % 4, k = 0;
	EFFECTS.forEach(function(g, gi){
		var x = 40 + gi * colW;
		drawLabel( g[0], x + colW * 0.5 - 2, 34, 10 );
		g[1].forEach(function(name, r){
			var i = k++;
			if(button( "fx" + i, x, 44 + r * 24, colW - 8, 20, name, i == fx ).clicked)
				s.preset = i * 4 + v;
		});
	});
	var name = NAMES[ fx ];
	drawLcd( 40, 124, right - 40 - 4 * 34 - 52, 22, (s.fx_reverse ? "\u25c0 " : "") + name + " " + "ABCD"[v] + " \u00b7 " + VARIATIONS[ name ][ v ], "left" );
	if(button( "fx_reverse", right - 4 * 34 - 44, 124, 40, 22, "REV", s.fx_reverse ).clicked)
		s.fx_reverse = !s.fx_reverse;
	for(var j = 0; j < 4; j++)
		if(button( "var" + j, right - (4 - j) * 34 + 4, 124, 30, 22, "ABCD"[j], j == v ).clicked)
			s.preset = fx * 4 + j;

	// knobs: two rows of four, the secondary controls beside them
	var kx = function(i){ return 40 + colW * (i + 0.36); }, R1 = 204, R2 = 292;
	s.activity = knob( "activity", kx(0), R1, 22, s.activity, 0, 1, { label: "ACTIVITY", def: 0.5, format: function(v){ return fmtPct( v ) + " " + ACTIVITY[ name ]; } } );
	s.repeats = knob( "repeats", kx(1), R1, 22, s.repeats, 0, 1, { label: "REPEATS", def: 0.3, format: function(v){ return REPEATS[ name ] ? fmtPct( v ) + " " + REPEATS[ name ] : Math.floor( v * 6.99 ) + " ECHOES OF EACH SAMPLE"; } } );
	s.mod_depth = second( "mod_depth", kx(1) + 50, R1 - 30, s.mod_depth, 0, 1, { label: "MOD", def: 0, format: function(v){ return "PITCH MOD DEPTH " + Math.round( v * 100 ) + "%"; } } );
	s.shape = knob( "shape", kx(2), R1, 22, s.shape, 0, 1, { label: "SHAPE", def: 0.5,
		format: function(v){ return name == "GLIDE" ? "GLIDE PATTERN: " + (v < 0.33 ? "RAMP" : (v < 0.66 ? "TRIANGLE" : "SMOOTH")) : (v < 0.25 ? "PERCUSSIVE" : (v > 0.75 ? "SWELL" : (Math.abs( v - 0.5 ) < 0.08 ? "FLAT" : fmtPct( v )))); } } );
	s.mod_rate = second( "mod_rate", kx(2) + 50, R1 - 30, s.mod_rate, 0, 1, { label: "RATE", def: 0.3, format: function(v){ return "PITCH MOD " + (0.05 + v * 8).toFixed(2) + " Hz"; } } );
	s.filter = knob( "filter", kx(3), R1, 22, s.filter, 0, 1, { label: "FILTER", def: 0.8, format: function(v){ return fmtHz( 150 * Math.pow( 120, v ) ); } } );
	s.resonance = second( "resonance", kx(3) + 50, R1 - 30, s.resonance, 0, 1, { label: "RES", def: 0.2, format: function(v){ return "RESONANCE " + fmtPct( v ); } } );
	s.mix = knob( "mix", kx(0), R2, 22, s.mix, 0, 1, { label: "MIX", def: 0.5,
		format: function(v){ return v < 0.02 ? "DRY" : (v > 0.98 ? "WET" : Math.round( (1 - v) * 100 ) + " DRY / " + Math.round( v * 100 ) + " WET"); } } );
	s.fx_volume = second( "fx_volume", kx(0) + 50, R2 - 30, s.fx_volume, 0, 1.5, { label: "VOL", def: 1, format: function(v){ return "EFFECT VOLUME " + fmtPct( v ); } } );
	s.subdiv = knob( "subdiv", kx(1), R2, 22, s.subdiv, 0, TIMES.length - 1, { label: "TIME", step: 1, style: "ring", def: 3,
		format: function(v){ return TIMES[v] + " at " + Math.round( st.tempo || (s.sync ? rack.tempo() : s.tempo) ) + " BPM"; } } );
	s.tempo = second( "tempo", kx(1) + 50, R2 - 30, s.tempo, 30, 300, { label: "TEMPO", def: 120, format: function(v){ return Math.round( v ) + " BPM" + (s.sync ? " (SYNC: THE RACK'S TEMPO)" : ""); } } );
	s.space = knob( "space", kx(2), R2, 22, s.space, 0, 1, { label: "SPACE", def: 0.3, format: fmtPct } );
	s.reverb_mode = second( "reverb_mode", kx(2) + 50, R2 - 30, s.reverb_mode, 0, 3, { label: "REVERB", step: 1, def: 1, format: function(v){ return REVERBS[v]; } } );
	s.loop_level = knob( "loop_level", kx(3), R2, 22, s.loop_level, 0, 1, { label: "LOOP LEVEL", def: 0.8, format: fmtPct } );
	s.looper_speed = second( "looper_speed", kx(3) + 50, R2 - 30, s.looper_speed, 0, LOOPER_SPEEDS.length - 1, { label: "SPEED", step: 1, def: 2, format: function(v){ return "LOOPER " + LOOPER_SPEEDS[v]; } } );

	// TAP / SYNC, HOLD, BYPASS
	var by = 334;
	drawLed( 82, by - 9, 3, !!st.step, "#ffb02f" );
	if(button( "tap", 40, by, 52, 24, "TAP", false ).clicked)
		tap( M.id );
	if(button( "sync", 96, by, 52, 24, "SYNC", s.sync ).clicked)
		s.sync = !s.sync;
	if(button( "hold", 152, by, 56, 24, "HOLD", !!(st.hold === undefined ? s.hold : st.hold) ).clicked)
		s.hold = !s.hold;
	if(button( "bypass", 212, by, 64, 24, "BYPASS", s.bypass ).clicked)
		s.bypass = !s.bypass;

	// the phrase looper
	var lx = 290, ls = st.loop || "empty";
	var foot = { empty: "REC", recording: "PLAY", playing: "DUB", overdub: "PLAY", stopped: "PLAY" }[ ls ];
	if(button( "loop_rec", lx, by, 48, 24, foot, ls == "recording" || ls == "overdub" ).clicked)
		send({ type: "looper" });
	if(button( "loop_stop", lx + 52, by, 48, 24, "STOP", false ).clicked)
		send({ type: "loopStop" });
	if(button( "loop_erase", lx + 104, by, 52, 24, "ERASE", false ).clicked)
		send({ type: "loopErase" });
	if(tinyButton( "reverse", lx, by + 30, 48, 14, "REVERSE", s.reverse, "LOOPER: PLAY REVERSED" )) s.reverse = !s.reverse;
	if(tinyButton( "looper_pre", lx + 52, by + 30, 48, 14, "PRE-FX", s.looper_pre, "LOOPER: RECORD THE DRY INPUT (THEN THE EFFECTS PLAY ON IT)" )) s.looper_pre = !s.looper_pre;
	if(tinyButton( "looper_only", lx + 104, by + 30, 52, 14, "ONLY", s.looper_only, "LOOPER ONLY: THE EFFECT OFF, THE LOOP AND THE DRY SIGNAL" )) s.looper_only = !s.looper_only;
	// loop status LED and progress
	var lcol = { recording: "#ff3b30", overdub: "#ff8a30", playing: "#4cd964", stopped: "#7f8c96" }[ ls ];
	drawLed( lx + 168, by + 12, 4, ls != "empty", lcol || "#4cd964" );
	ctx.fillStyle = "#111";
	ctx.fillRect( lx + 178, by + 9, right - lx - 178, 6 );
	if(ls != "empty")
	{
		ctx.fillStyle = lcol || "#4cd964";
		var f = ls == "recording" ? Math.min( 1, (st.loop_pos || 0) / 60 ) : (st.loop_pos || 0);
		ctx.fillRect( lx + 178, by + 9, (right - lx - 178) * f, 6 );
	}
	ctx.font = "9px " + FONT;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( ls == "empty" ? "LOOPER EMPTY" : ls.toUpperCase() + (st.loop_len ? " " + st.loop_len.toFixed(1) + " s" : ""), lx + 178, by + 26 );
	M = null;
}

WR.registerSynth( "universe", {
	title: "UNIVERSE",
	description: "UNIVERSE: granular micro loops, glitches, delays and a phrase looper",
	category: "Effects",
	half: true,
	insert: true,
	worklet: "devices/universe-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	midi_in: "midi_in", // MIDI clock
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return s.bypass ? "BYPASSED: DRY THROUGH" : NAMES[ Math.floor( s.preset / 4 ) ] + " " + "ABCD"[ s.preset % 4 ]; }
});

})();
