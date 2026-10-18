// devices/tape.js
// TAPE module (half rack width): a tape machine for hazy, nostalgic, wobbly sound. WOW, FLUTTER,
// SATURATE, TONE, HISS, AGE (dropouts), MIX, OUTPUT; MACHINE (CASSETTE, REEL, VHS); STOP (held: the
// tape winds down, let go: it spins up again) with its STOP TIME; ON. CV: WOW, TONE, STOP (a gate).
// A cassette on the panel turns with the tape (its speed, its wobble). Audio on the back.
// DSP in tape-worklet.js.

(function(){

var H = 270;
var MACHINES = [["cassette", "CASSETTE", "DARK, A SLOW UNEVEN WOW"], ["reel", "REEL", "CLEANER, A BIG LOW END"], ["vhs", "VHS", "WARBLY, BRIGHT HISS"]];
var JACKS = [[["WOW", "in", "wow_in"], ["TONE", "in", "tone_in"]], [["STOP", "in", "stop_in"]]];
// starting points: [name, settings, tooltip]
var PRESETS = [
	["HAZY", { machine: "cassette", wow: 0.45, flutter: 0.25, saturate: 0.4, tone: 5500, hiss: 0.2, age: 0.15, mix: 1 }, "A WARM, WOBBLY OLD CASSETTE: THE NOSTALGIC SOUND"],
	["WARPED", { machine: "cassette", wow: 0.8, flutter: 0.35, saturate: 0.5, tone: 4000, hiss: 0.25, age: 0.45, mix: 1 }, "A TAPE LEFT IN THE SUN: SEA-SICK PITCH, DROPOUTS"],
	["VHS", { machine: "vhs", wow: 0.55, flutter: 0.45, saturate: 0.3, tone: 7000, hiss: 0.35, age: 0.3, mix: 1 }, "A WORN VIDEO TAPE: WARBLY, HISSY"],
	["STUDIO", { machine: "reel", wow: 0.12, flutter: 0.1, saturate: 0.55, tone: 16000, hiss: 0.05, age: 0, mix: 1 }, "A GOOD REEL TO REEL: WARMTH, LOW END, A LITTLE MOVEMENT"]
];
var REAR_JACKS = [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];
var reels = {};   // module id -> the reels' angle
var held = {};    // module id -> STOP held

function defaults()
{
	return { on: true, wow: 0.3, flutter: 0.2, saturate: 0.35, tone: 9000, hiss: 0.15, age: 0.1, mix: 1, output: 0.9, machine: "cassette", stop_time: 0.8 };
}

function validate( s )
{
	if(!MACHINES.some(function(m){ return m[0] === s.machine; })) s.machine = "cassette";
	s.tone = Math.min( 20000, Math.max( 500, s.tone ) );
	s.stop_time = Math.min( 4, Math.max( 0.05, s.stop_time ) );
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	s.wow = rnd( 0.1, 0.7 ); s.flutter = rnd( 0, 0.5 ); s.saturate = rnd( 0.1, 0.7 ); s.tone = 2500 * Math.pow( 6, Math.random() );
	s.hiss = rnd( 0, 0.4 ); s.age = Math.random() < 0.5 ? rnd( 0, 0.5 ) : 0; s.machine = MACHINES[ Math.floor( Math.random() * 3 ) ][0];
}

// the cassette: its shell, its label, the window with the two reels turning
function drawCassette( id, x, y, w, h, st, machine, label )
{
	var a = reels[ id ] = (reels[ id ] || 0) + 0.05 * (st.speed === undefined ? 1 : st.speed) * (1 + (st.mod || 0) * 0.6);
	// shell
	ctx.fillStyle = "#1a1a1b"; ctx.beginPath(); ctx.roundRect( x + 2, y + 4, w, h, 8 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	g.addColorStop( 0, "#3a3a3d" ); g.addColorStop( 1, "#262628" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect( x, y, w, h, 8 ); ctx.fill();
	[[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + h - 9], [x + w - 9, y + h - 9]].forEach(function(p){
		ctx.fillStyle = "#151516"; ctx.beginPath(); ctx.arc( p[0], p[1], 3.5, 0, Math.PI * 2 ); ctx.fill();
	});
	// the label: cream, lines, a hand written title
	var lx = x + 16, ly = y + 12, lw = w - 32, lh = h * 0.62;
	ctx.fillStyle = machine == "vhs" ? "#d9d4c4" : "#e8dcc0";
	ctx.beginPath(); ctx.roundRect( lx, ly, lw, lh, 3 ); ctx.fill();
	ctx.fillStyle = machine == "reel" ? "#4a7a9c" : (machine == "vhs" ? "#8c3a3a" : "#c8643c");
	ctx.fillRect( lx, ly + 8, lw, 5 );
	ctx.strokeStyle = "rgba(60,50,40,0.35)"; ctx.lineWidth = 1;
	ctx.beginPath(); for(var k = 0; k < 3; ++k) { ctx.moveTo( lx + 8, ly + 30 + k * 11 ); ctx.lineTo( lx + lw - 8, ly + 30 + k * 11 ); } ctx.stroke();
	ctx.font = "italic bold 15px Georgia, 'Times New Roman', serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#2a3550";
	ctx.fillText( label, lx + 10, ly + 28 );
	ctx.font = "bold 9px " + FONT; ctx.textAlign = "right"; ctx.fillStyle = "#5a5040";
	ctx.fillText( machine == "vhs" ? "SP 120" : (machine == "reel" ? "7½ IPS" : "C-60  A"), lx + lw - 8, ly + 26 );
	// the window, and the reels in it
	var wy = ly + lh - 30, wx = x + w * 0.22, ww = w * 0.56, wh = 34;
	ctx.fillStyle = "#0d0d0e"; ctx.beginPath(); ctx.roundRect( wx, wy, ww, wh, 10 ); ctx.fill();
	var r1 = [ x + w * 0.31, wy + wh / 2 ], r2 = [ x + w * 0.69, wy + wh / 2 ];
	// the tape on each reel: the left one full, the right one emptier
	ctx.fillStyle = "#3a2a1e"; ctx.beginPath(); ctx.arc( r1[0], r1[1], 21, 0, Math.PI * 2 ); ctx.fill();
	ctx.beginPath(); ctx.arc( r2[0], r2[1], 15, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#0d0d0e"; ctx.fillRect( wx, wy - 1, ww, 3 ); ctx.fillRect( wx, wy + wh - 2, ww, 3 ); // the window's edge hides the packs
	[r1, r2].forEach(function(c){
		ctx.fillStyle = "#e8e6e0"; ctx.beginPath(); ctx.arc( c[0], c[1], 9, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = "#0d0d0e"; ctx.beginPath(); ctx.arc( c[0], c[1], 4, 0, Math.PI * 2 ); ctx.fill();
		ctx.strokeStyle = "#0d0d0e"; ctx.lineWidth = 2;
		ctx.beginPath();
		for(var t = 0; t < 6; ++t) { var b = a + t * Math.PI / 3; ctx.moveTo( c[0] + Math.cos( b ) * 5, c[1] + Math.sin( b ) * 5 ); ctx.lineTo( c[0] + Math.cos( b ) * 8.5, c[1] + Math.sin( b ) * 8.5 ); }
		ctx.stroke();
	});
	// a dropout darkens the window a little
	if(st.drop !== undefined && st.drop < 0.98) { ctx.fillStyle = "rgba(0,0,0," + (1 - st.drop) * 0.6 + ")"; ctx.beginPath(); ctx.roundRect( wx, wy, ww, wh, 10 ); ctx.fill(); }
	// the tape's path along the bottom, between the guides
	ctx.fillStyle = "#2a2a2c"; ctx.beginPath(); ctx.roundRect( x + w * 0.2, y + h - 22, w * 0.6, 14, 4 ); ctx.fill();
	ctx.fillStyle = "#4a3426"; ctx.fillRect( x + w * 0.22, y + h - 16, w * 0.56, 2.5 );
}

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings, st = M.state || {};
	drawDevicePanel( 0, 0, w, h, "TAPE", ["TAPE MACHINE", "WOW · FLUTTER · SATURATION"] );
	var px = drawDeviceJacks( 0, 0, w, h, JACKS );
	drawCassette( M.id, 40, 24, 220, 150, st, s.machine, s.on ? (st.stopped ? "stopped" : "memories") : "bypassed" );
	// MACHINE, under the cassette
	MACHINES.forEach(function(m, i){
		if(tinyButton( "machine_" + m[0], 40 + i * 74, 186, 68, 18, m[1], s.machine == m[0], "MACHINE: " + m[1] + ": " + m[2] )) s.machine = m[0];
	});
	// the knobs: two rows
	var kx = function(i){ return 300 + i * ((px - 300 - 26) / 3); }, y1 = 66, y2 = 150;
	s.wow = knob( "wow", kx(0), y1, 19, s.wow, 0, 1, { label: "WOW", def: 0.3, format: function(v){ return v < 0.01 ? "OFF" : "SLOW DRIFT " + Math.round( v * 100 ) + "%"; } } );
	s.flutter = knob( "flutter", kx(1), y1, 19, s.flutter, 0, 1, { label: "FLUTTER", def: 0.2, format: function(v){ return v < 0.01 ? "OFF" : "FAST FLUTTER " + Math.round( v * 100 ) + "%"; } } );
	s.saturate = knob( "saturate", kx(2), y1, 19, s.saturate, 0, 1, { label: "SATURATE", def: 0.35, format: fmtPct } );
	s.tone = knob( "tone", kx(3), y1, 19, s.tone, 500, 20000, { label: "TONE", exp: true, def: 9000, format: fmtHz } );
	s.hiss = knob( "hiss", kx(0), y2, 17, s.hiss, 0, 1, { label: "HISS", def: 0.15, format: fmtPct } );
	s.age = knob( "age", kx(1), y2, 17, s.age, 0, 1, { label: "AGE", def: 0.1, format: function(v){ return v < 0.01 ? "NEW TAPE" : "DROPOUTS " + Math.round( v * 100 ) + "%"; } } );
	s.mix = knob( "mix", kx(2), y2, 17, s.mix, 0, 1, { label: "MIX", def: 1, format: fmtPct } );
	s.output = knob( "output", kx(3), y2, 17, s.output, 0, 1.5, { label: "OUTPUT", def: 0.9, format: fmtPct } );
	// STOP (held), its time; ON
	var hb = !!held[ M.id ];
	var b = button( "stop", kx(0) - 34, 202, 70, 26, "STOP", hb || !!st.stopped );
	if(b.held != hb) { held[ M.id ] = b.held; var m = M; act(function(){ m.post({ type: "stop", on: b.held }); }); }
	if(hitRect( kx(0) - 34, 202, 70, 26 )) tip( "HOLD: THE TAPE WINDS DOWN; LET GO: IT SPINS UP AGAIN", kx(0), 242 );
	s.stop_time = knob( "stop_time", kx(1), 215, 11, s.stop_time, 0.05, 4, { label: "STOP TIME", exp: true, def: 0.8, labelSize: 9, format: function(v){ return v.toFixed( 2 ) + " S TO A HALT"; } } );
	if(button( "on", kx(3) - 30, 202, 60, 26, "ON", s.on ).clicked)
		s.on = !s.on;
	// presets, on the jacks' plate
	drawLabel( "PRESETS", px + 85, 166, 9 );
	PRESETS.forEach(function(p, i){
		var on = Object.keys( p[1] ).every(function(k){ return s[k] === p[1][k]; });
		if(tinyButton( "preset" + i, px + 18 + (i % 2) * 70, 180 + Math.floor( i / 2 ) * 22, 64, 16, p[0], on, p[2] ))
			Object.keys( p[1] ).forEach(function(k){ s[k] = p[1][k]; });
	});
}

WR.registerSynth( "tape", {
	title: "TAPE",
	description: "TAPE: a tape machine for hazy, wobbly, nostalgic sound",
	about: "Wow and flutter, tape saturation, a darkening tone, hiss and dropouts, three machines (cassette, reel, VHS) and a tape stop. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^stop$", 3], ["^on$", 2], ["^machine_", 1], ["", 1]],
	knob_jacks: [["^wow$", ["wow_in"]], ["^tone$", ["tone_in"]], ["^stop_time$", ["stop_in"]]],
	category: "Effects",
	half: true,
	insert: true,
	worklet: "devices/tape-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	midi_in: null,
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return !s.on ? "BYPASSED (OFF): DRY THROUGH" : s.machine.toUpperCase() + " · WOW " + Math.round( s.wow * 100 ) + "%"; }
});

})();
