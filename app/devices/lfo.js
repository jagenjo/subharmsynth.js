// devices/lfo.js
// Dual LFO module (half rack width): per LFO RATE (0.01..100 Hz), SHAPE, LEVEL, a RATE CV input
// (1V/oct) and a SYNC input (a gate restarts the cycle). Outputs +-5V. DSP in lfo-worklet.js.

(function(){

var H = 200;
var SHAPES = ["sine","tri","saw","ramp","square","sh"];
var SHAPE_LABELS = { sine: "SINE", tri: "TRI", saw: "SAW", ramp: "RAMP", square: "SQUARE", sh: "S&H" };
var JACKS = [
	[["RATE 1","in","rate1"], ["RATE 2","in","rate2"]],
	[["SYNC 1","in","sync1"], ["SYNC 2","in","sync2"]],
	[["LFO 1","out","lfo1"], ["LFO 2","out","lfo2"]]
];

function defaults()
{
	return { lfo: [
		{ rate: 0.5, shape: "sine", level: 1 },  // rate in Hz, level scales the +-5V output
		{ rate: 4, shape: "tri", level: 0.5 }
	] };
}

function validate( s )
{
	s.lfo.forEach(function(l){
		if(SHAPES.indexOf( l.shape ) == -1)
			l.shape = "sine";
	});
}

function randomize( s )
{
	s.lfo.forEach(function(l){
		l.rate = 0.05 * Math.pow( 8 / 0.05, Math.random() );
		l.shape = SHAPES[ Math.floor( Math.random() * SHAPES.length ) ];
		l.level = 0.2 + Math.random() * 0.8;
	});
}

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings, st = M.state || { lfo: [0, 0] };
	drawDevicePanel( 0, 0, w, h, "DUAL LFO", ["LOW FREQUENCY", "OSCILLATORS"] );
	var px = drawDeviceJacks( 0, 0, w, h, JACKS );
	var sw = (px - 10 - 40) / 2; // section width

	for(var i = 0; i < 2; ++i)
	{
		var lfo = s.lfo[i];
		var gx = 40 + i * sw;
		drawSection( "LFO " + (i + 1), gx, gx + sw - 16, 20 );
		lfo.rate = knob( "rate" + i, gx + 38, 92, 28, lfo.rate, 0.01, 100, {
			label: "RATE", style: "ring", exp: true, def: i ? 4 : 0.5, format: fmtRate
		});
		drawLed( gx + 72, 48, 3.5, (st.lfo[i] || 0) > 0.05, "#ffb02f" );
		lfo.level = knob( "level" + i, gx + 118, 96, 20, lfo.level, 0, 1, {
			label: "LEVEL", def: 1, format: function(v){ return fmtPct(v) + "  (±" + (v * 5).toFixed(1) + " V)"; }
		});
		drawLedColumn( gx + sw - 70, 40, SHAPES.map(function(sh){ return SHAPE_LABELS[sh]; }),
			function(k){ return lfo.shape == SHAPES[k]; } );
		if(button( "shape" + i, gx + sw - 80, 136, 58, 22, "SHAPE" ).clicked)
			lfo.shape = SHAPES[ (SHAPES.indexOf( lfo.shape ) + 1) % SHAPES.length ];
	}
}

WR.registerSynth( "lfo", {
	title: "DUAL LFO",
	description: "Two low frequency oscillators, CV outputs",
	about: "Two LFOs (sine, triangle, saw, ramp, square, S&H) with rate and level, and sync inputs. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["", 1]],
	// a knob's sockets, lit when the mouse is over it (code.js: controlJacks)
	knob_jacks: [["^rate(\\d)$", function(m){ return ["rate" + (+m[1] + 1)]; }]],
	category: "Modulation",
	half: true,
	worklet: "devices/lfo-worklet.js",
	jacks: JACKS,
	midi_in: null,
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function() { return "NO AUDIO: CV ON THE FRONT"; }
});

})();
