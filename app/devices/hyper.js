// devices/hyper.js
// HYPER module (half rack width): lo-fi distortion and bit crusher for the warm, crunchy, broken
// console sounds of indie game soundtracks. WOBBLE (tape wow and flutter), DRIVE and TYPE
// (TAPE, TUBE, FUZZ, FOLD), TONE, RATE (sample rate reduction), BITS, MIX, OUTPUT, ON, and CV for
// DRIVE, BITS and RATE. Audio on the back. DSP in hyper-worklet.js.

(function(){

var H = 170;
var TYPES = [["tape", "TAPE"], ["tube", "TUBE"], ["fuzz", "FUZZ"], ["fold", "FOLD"]];
// starting points: [name, settings, tooltip]
var PRESETS = [
	["DRIFTER", { drive: 0.3, type: "tube", tone: 6500, bits: 10, rate: 22050, wobble: 0.35, mix: 1 }, "WARM, WOBBLY, SLIGHTLY CRUSHED (DRIFTER)"],
	["8-BIT", { drive: 0.2, type: "tape", tone: 12000, bits: 6, rate: 11025, wobble: 0.05, mix: 1 }, "CHIPTUNE GRIT"],
	["BROKEN", { drive: 0.7, type: "fuzz", tone: 4500, bits: 4, rate: 4000, wobble: 0.5, mix: 0.8 }, "A DYING CONSOLE"],
	["FOLDED", { drive: 0.55, type: "fold", tone: 9000, bits: 12, rate: 32000, wobble: 0.1, mix: 1 }, "WAVE FOLDING, METALLIC"]
];
var JACKS = [[["DRIVE","in","drive_in"], ["BITS","in","bits_in"], ["RATE","in","rate_in"]]];
var REAR_JACKS = [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];

function defaults()
{
	return { on: true, drive: 0.35, type: "tape", tone: 9000, bits: 8, rate: 16000, wobble: 0.15, mix: 1, output: 0.9 };
}

function validate( s )
{
	if(!TYPES.some(function(t){ return t[0] === s.type; })) s.type = "tape";
	s.bits = Math.min( 16, Math.max( 1, s.bits ) );
	s.rate = Math.min( 48000, Math.max( 100, s.rate ) );
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	s.drive = rnd( 0.1, 0.8 ); s.type = TYPES[ Math.floor( Math.random() * 4 ) ][0];
	s.tone = 2000 * Math.pow( 8, Math.random() ); s.bits = rnd( 3, 12 ); s.rate = 2000 * Math.pow( 16, Math.random() );
	s.wobble = Math.random() < 0.5 ? rnd( 0, 0.5 ) : 0;
}

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings;
	drawDevicePanel( 0, 0, w, h, "HYPER", ["DISTORTION", "BIT CRUSHER"] );
	var px = drawDeviceJacks( 0, 0, w, h, JACKS );
	var x0 = 66, dx = (px - 30 - x0) / 6, y = 70;
	s.wobble = knob( "wobble", x0, y, 20, s.wobble, 0, 1, { label: "WOBBLE", def: 0.15, format: function(v){ return v < 0.01 ? "OFF" : "WOW + FLUTTER " + Math.round( v * 100 ) + "%"; } } );
	s.drive = knob( "drive", x0 + dx, y, 22, s.drive, 0, 1, { label: "DRIVE", def: 0.35, format: function(v){ return "+" + (20 * Math.log10( 1 + v * v * 60 )).toFixed(1) + " dB"; } } );
	var ti = Math.max( 0, TYPES.findIndex(function(t){ return t[0] == s.type; }) );
	ti = knob( "type", x0 + dx * 2, y, 16, ti, 0, 3, { label: "TYPE", step: 1, style: "ring", def: 0, format: function(v){ return TYPES[v][1]; } } );
	s.type = TYPES[ ti ][0];
	drawLabel( TYPES[ ti ][1], x0 + dx * 2, y + 40, 10 );
	s.tone = knob( "tone", x0 + dx * 3, y, 20, s.tone, 300, 20000, { label: "TONE", exp: true, def: 9000, format: fmtHz } );
	s.rate = knob( "rate", x0 + dx * 4, y, 22, s.rate, 100, 48000, { label: "RATE", exp: true, def: 16000, format: function(v){ return v > 47900 ? "OFF" : fmtHz( v ); } } );
	s.bits = knob( "bits", x0 + dx * 5, y, 22, s.bits, 1, 16, { label: "BITS", def: 8, format: function(v){ return v > 15.95 ? "OFF (16)" : v.toFixed(1) + " BITS"; } } );
	s.mix = knob( "mix", x0 + dx * 6, y, 18, s.mix, 0, 1, { label: "MIX", def: 1, format: fmtPct } );
	s.output = knob( "output", x0 + dx * 6 - 44, y + 58, 12, s.output, 0, 1.5, { label: "OUT", def: 0.9, labelSize: 9, format: fmtPct } );
	if(button( "on", x0 + dx * 6 - 6, y + 46, 50, 22, "ON", s.on ).clicked)
		s.on = !s.on;
	PRESETS.forEach(function(p, i){
		var on = Object.keys( p[1] ).every(function(k){ return s[k] === p[1][k]; });
		if(tinyButton( "preset" + i, 236 + i * 58, h - 32, 54, 14, p[0], on, p[2] ))
			Object.keys( p[1] ).forEach(function(k){ s[k] = p[1][k]; });
	});
}

WR.registerSynth( "hyper", {
	title: "HYPER",
	description: "HYPER: lo-fi distortion and bit crusher",
	about: "Lo-fi distortion and bit crusher: tape wobble, 4 saturations, sample rate and bit reduction. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^on$", 2], ["", 1]],
	category: "Effects",
	half: true,
	insert: true,
	worklet: "devices/hyper-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	midi_in: null,
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return !s.on ? "BYPASSED (OFF): DRY THROUGH" : s.type.toUpperCase() + " · " + Math.round( s.bits ) + " BITS"; }
});

})();
