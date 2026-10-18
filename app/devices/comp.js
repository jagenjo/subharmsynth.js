// devices/comp.js
// Stereo compressor module (half rack width) with a small green CRT oscilloscope. Front: THRESHOLD,
// RATIO, ATTACK, RELEASE, MAKEUP, MIX (parallel), ON, a gain reduction meter, the SIDECHAIN and SCOPE
// inputs and the GR output (gain reduction as CV, 4 dB per volt). Audio on the back. DSP in comp-worklet.js.

(function(){

var H = 200;
var SCOPE_TIMES = [0.005, 0.02, 0.1, 0.5, 2];
var JACKS = [
	[["SIDECHAIN","in","sidechain"], ["GR","out","gr"], ["SCOPE","in","scope"]]
];
var REAR_JACKS = [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];

var M = null;

function defaults()
{
	// dB / s; scope_time: oscilloscope window in seconds, one of SCOPE_TIMES
	return { on: true, threshold: -12, ratio: 3, attack: 0.005, release: 0.12, makeup: 0, mix: 1, scope_time: 0.02 };
}

function validate( s )
{
	if(SCOPE_TIMES.indexOf( s.scope_time ) == -1)
		s.scope_time = 0.02;
}

// small retro CRT oscilloscope: green phosphor trace of the SCOPE input (+-5V full scale) or,
// with nothing patched, the compressor's output. Clicking the screen cycles the time base.
function fmtScopeTime( t ) { return t >= 1 ? t + " s" : Math.round( t * 1000 ) + " ms"; }

function drawScope( x, y, w, h, data )
{
	var s = M.settings;
	var id = id_prefix + "scope_screen";
	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitRect( x, y, w, h );
	if(hover)
	{
		ui.hot = id;
		tip( "CLICK: TIME BASE (" + fmtScopeTime( s.scope_time ) + ")", x + w * 0.5, y + h + 12 );
	}
	if((hover && ui.pressed && ui.active === null) | keyButton( id, x, y, w, h ).pressed)
	{
		if(ui.pressed) ui.active = id;
		s.scope_time = SCOPE_TIMES[ (SCOPE_TIMES.indexOf( s.scope_time ) + 1) % SCOPE_TIMES.length ];
	}

	// bezel and screen
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x - 3, y - 3, w + 6, h + 6, 8 ); ctx.fill();
	var g = ctx.createRadialGradient( x + w * 0.5, y + h * 0.5, 4, x + w * 0.5, y + h * 0.5, w * 0.7 );
	g.addColorStop( 0, "#0f2a14" );
	g.addColorStop( 1, "#04100a" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 6 ); ctx.fill();

	ctx.save();
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 6 ); ctx.clip();

	// graticule
	ctx.strokeStyle = "rgba(80,255,120,0.12)";
	ctx.lineWidth = 0.6;
	ctx.beginPath();
	for(var i = 1; i < 8; ++i) { ctx.moveTo( x + w * i / 8, y ); ctx.lineTo( x + w * i / 8, y + h ); }
	for(var i = 1; i < 6; ++i) { ctx.moveTo( x, y + h * i / 6 ); ctx.lineTo( x + w, y + h * i / 6 ); }
	ctx.stroke();
	ctx.strokeStyle = "rgba(80,255,120,0.25)";
	ctx.beginPath(); ctx.moveTo( x, y + h * 0.5 ); ctx.lineTo( x + w, y + h * 0.5 ); ctx.stroke();

	// trace, drawn twice: a wide soft glow and a thin bright core. Each column holds the min and
	// max of the samples it covers, so dense audio at long time bases shows as a band
	var mid = y + h * 0.5, amp = h * 0.45;
	var n = data && data.min ? data.min.length : 0;
	var Y = function(v) { return mid - clamp( v, -1.05, 1.05 ) * amp; };
	var trace = function(){
		ctx.beginPath();
		if(!n)
		{
			ctx.moveTo( x, mid ); ctx.lineTo( x + w, mid );
			return;
		}
		for(var i = 0; i < n; ++i)
		{
			var px = x + (i / (n - 1)) * w;
			var lo = Y( data.max[i] ), hi = Y( data.min[i] );
			if(i) ctx.lineTo( px, lo ); else ctx.moveTo( px, lo );
			if(hi - lo > 1) ctx.lineTo( px, hi );
		}
	};
	ctx.lineJoin = "round";
	ctx.strokeStyle = "rgba(60,255,110,0.18)";
	ctx.lineWidth = 4;
	trace(); ctx.stroke();
	ctx.strokeStyle = "#7dff9a";
	ctx.lineWidth = 1.2;
	trace(); ctx.stroke();

	// scanlines and glass reflection
	ctx.fillStyle = "rgba(0,0,0,0.18)";
	for(var yy = y; yy < y + h; yy += 3)
		ctx.fillRect( x, yy, w, 1 );
	g = ctx.createLinearGradient( x, y, x, y + h * 0.5 );
	g.addColorStop( 0, "rgba(255,255,255,0.07)" );
	g.addColorStop( 1, "rgba(255,255,255,0)" );
	ctx.fillStyle = g;
	ctx.fillRect( x, y, w, h * 0.5 );
	ctx.restore();

	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.font = "9px " + FONT;
	ctx.fillStyle = "rgba(125,255,154,0.6)";
	ctx.fillText( data && data.input ? "IN ±5V" : "OUT", x + 5, y + 8 );
	ctx.textAlign = "right";
	ctx.fillText( fmtScopeTime( s.scope_time ) + (s.scope_time > 0.2 ? " ROLL" : ""), x + w - 5, y + 8 );
}

function draw( mod )
{
	M = mod;
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var c = M.settings, st = M.state || { gr: 0, scope: null };
	drawDevicePanel( 0, 0, w, h, "COMPRESSOR", ["STEREO", "DYNAMICS PROCESSOR"] );
	var px = drawDeviceJacks( 0, 0, w, h, JACKS );
	drawScope( px + 12, 80, 146, h - 100, st.scope );

	// six knobs in a row, then the gain reduction meter and the ON button
	var mx = px - 62;
	var step = (mx - 10 - 40) / 6;
	var r = Math.min( 24, step * 0.3 );
	drawSection( "DYNAMICS", 40, mx - 14, 20 );
	var knobs = [
		["threshold", "THRESHOLD", -48, 0, { def: -12, format: fmtDb }],
		["ratio", "RATIO", 1, 20, { exp: true, def: 3, format: function(v){ return v.toFixed(1) + " : 1"; } }],
		["attack", "ATTACK", 0.0005, 0.2, { style: "ring", exp: true, def: 0.005, format: fmtTime }],
		["release", "RELEASE", 0.01, 2, { style: "ring", exp: true, def: 0.12, format: fmtTime }],
		["makeup", "MAKEUP", 0, 24, { def: 0, format: fmtDb }],
		["mix", "MIX", 0, 1, { def: 1, format: function(v){ return Math.round(v * 100) + "% WET"; } }]
	];
	knobs.forEach(function(k, i){
		k[4].label = k[1];
		c[ k[0] ] = knob( k[0], 40 + step * (i + 0.5), 96, r, c[ k[0] ], k[2], k[3], k[4] );
	});

	drawSection( "GR", mx, px - 12, 20 );
	var levels = [20, 15, 10, 6, 3, 1];
	drawLedColumn( mx + 14, 40, levels.map(function(db){ return "-" + db; }),
		function(k){ return c.on && st.gr >= levels[k]; },
		function(k){ return k < 2 ? "#ff3b2f" : "#ffb02f"; } );
	if(button( "on", mx + 2, 136, 44, 22, "ON", c.on ).clicked)
		c.on = !c.on;
	M = null;
}

WR.registerSynth( "comp", {
	title: "COMPRESSOR",
	description: "Stereo compressor with sidechain and oscilloscope",
	about: "A stereo compressor with sidechain input, gain reduction meter and an oscilloscope of the output. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^on$", 2], ["^scope_screen$", 0]],
	category: "Mixing",
	half: true,
	worklet: "devices/comp-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	midi_in: null,
	defaults: defaults,
	validate: validate,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return s.on ? "STEREO, LINKED · IN R NORMALLED TO IN L" : "BYPASSED (OFF)"; }
});

})();
