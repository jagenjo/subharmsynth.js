// devices/delay.js
// Stereo / ping-pong delay module (half rack width): TIME (free, or a division of the rack's tempo
// with SYNC), FEEDBACK, TONE (lowpass in the feedback), MIX, PING-PONG, ON and DRY (off = 100% wet,
// for an aux send). Audio on the back. DSP in delay-worklet.js.

(function(){

var H = 150;
// tempo divisions: [label, quarter notes]; delay-worklet.js has the same list
WR.DELAY_DIVS = [["1/16", 0.25], ["1/8T", 1/3], ["1/8", 0.5], ["1/8D", 0.75], ["1/4T", 2/3], ["1/4", 1], ["1/4D", 1.5], ["1/2", 2], ["1/1", 4]];
var REAR_JACKS = [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];

function defaults()
{
	return { on: false, sync: true, div: 3, time: 0.3, feedback: 0.4, tone: 5000, mix: 0.3, pingpong: true, dry: true };
}

function validate( s )
{
	s.div = Math.min( WR.DELAY_DIVS.length - 1, Math.max( 0, Math.round( s.div ) ) );
	s.feedback = Math.min( 0.95, Math.max( 0, s.feedback ) );
}

function delayTime( s )
{
	if(s.sync)
		return Math.min( 4.9, (60 / rack.tempo()) * WR.DELAY_DIVS[ s.div ][1] );
	return s.time;
}

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings;
	drawDevicePanel( 0, 0, w, h, "DELAY", ["STEREO", "PING-PONG ECHO"] );
	if(s.sync)
		s.div = knob( "div", 100, 70, 28, s.div, 0, WR.DELAY_DIVS.length - 1, {
			label: "TIME", step: 1, def: 3, style: "ring",
			format: function(v){ return WR.DELAY_DIVS[v][0] + "  " + Math.round( delayTime( s ) * 1000 ) + " ms"; }
		});
	else
		s.time = knob( "time", 100, 70, 28, s.time, 0.01, 2, {
			label: "TIME", exp: true, def: 0.3, style: "ring", format: fmtTime
		});
	s.feedback = knob( "feedback", 200, 70, 24, s.feedback, 0, 0.95, { label: "FEEDBACK", def: 0.4, format: fmtPct } );
	s.tone = knob( "tone", 290, 70, 24, s.tone, 500, 16000, { label: "TONE", exp: true, def: 5000, format: fmtHz } );
	s.mix = knob( "mix", 380, 70, 24, s.mix, 0, 1, { label: "MIX", def: 0.3, format: fmtPct } );
	if(button( "sync", 448, 40, 84, 22, "SYNC", s.sync ).clicked)
		s.sync = !s.sync;
	if(button( "pingpong", 448, 68, 84, 22, "PING-PONG", s.pingpong ).clicked)
		s.pingpong = !s.pingpong;
	if(button( "on", 448, 96, 84, 22, "ON", s.on ).clicked)
		s.on = !s.on;
	if(button( "dry", 360, 112, 64, 22, "DRY", s.dry ).clicked)
		s.dry = !s.dry;
}

WR.registerSynth( "delay", {
	title: "DELAY",
	description: "Stereo / ping-pong delay, tempo synced",
	about: "Stereo / ping-pong delay, free or synced to the tempo, with feedback tone. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^on$", 2], ["", 1]],
	category: "Effects",
	half: true,
	worklet: "devices/delay-worklet.js",
	jacks: [],
	rear_jacks: REAR_JACKS,
	midi_in: null,
	defaults: defaults,
	validate: validate,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return !s.on ? "BYPASSED (OFF): DRY THROUGH" : (s.dry ? "DRY + ECHOES" : "100% WET (DRY OFF)"); }
});

})();
