// devices/reverb.js
// Convolution reverb module (half rack width): MIX, PRE-DELAY, TONE (lowpass on the tail), ROOM
// (12 impulses, loaded the first time they are chosen), ON and DRY (off = 100% wet, for an aux send).
// The convolution runs in native WebAudio nodes built here (`native`), fed by a send / return slot
// of the rack processor (reverb-worklet.js bridges the rear sockets to it).

(function(){

var H = 150;
var REAR_JACKS = [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]];

// reverb rooms, short to long: [name, impulse file]; a null file is generated in code.
// data/impulses/: free impulse responses, redistributed under data/impulses/license.txt
WR.REVERB_ROOMS = [
	["DRUM ROOM S", "data/impulses/Small Drum Room.wav"],
	["DRUM ROOM", "data/impulses/Nice Drum Room.wav"],
	["CAVE", "data/impulses/Small Prehistoric Cave.wav"],
	["SALON", "data/impulses/French 18th Century Salon.wav"],
	["PLATE", null],
	["OPERA HALL", "data/impulses/Scala Milan Opera Hall.wav"],
	["SILO", "data/impulses/In The Silo.wav"],
	["HALL A", "data/BIG HALL E002 M2S.wav"],
	["HALL B", "data/BIG HALL E003 M2S.wav"],
	["GARAGE", "data/impulses/Parking Garage.wav"],
	["ECHO HALL", "data/impulses/Large Long Echo Hall.wav"],
	["CHURCH", "data/impulses/St Nicolaes Church.wav"]
];
WR.reverbRoomIndex = function( name ) { return WR.REVERB_ROOMS.findIndex(function(r){ return r[0] == name; }); }

// synthetic plate: dense decorrelated noise per channel, -60dB after `seconds`,
// getting darker as it decays (one-pole lowpass closing over time)
WR.makePlate = function( ctx, seconds )
{
	var sr = ctx.sampleRate, n = Math.round( sr * seconds );
	var buffer = ctx.createBuffer( 2, n, sr );
	for(var c = 0; c < 2; ++c)
	{
		var data = buffer.getChannelData( c ), y = 0;
		for(var i = 0; i < n; ++i)
		{
			var t = i / n;
			var a = 0.85 - 0.75 * t;  // lowpass coefficient, bright to dark
			y += a * ((Math.random() * 2 - 1) - y);
			var env = Math.exp( -6.9 * t ) * Math.min( 1, i / (sr * 0.002) );
			data[i] = y * env;
		}
	}
	return buffer;
}

// impulses, shared by every reverb in the rack: loaded the first time their room is chosen
var buffers = {}, loading = {};

function loadRoom( rack, name )
{
	var room = WR.REVERB_ROOMS[ WR.reverbRoomIndex( name ) ];
	if(!room || buffers[name] || loading[name])
		return;
	if(!room[1])
	{
		buffers[name] = WR.makePlate( rack.context, 2.6 );
		return;
	}
	loading[name] = true;
	var ctx = rack.context;
	fetch( room[1] )
		.then(function(res){ if(!res.ok) throw new Error("HTTP " + res.status); return res.arrayBuffer(); })
		.then(function(b){ return ctx.decodeAudioData(b); })
		.then(function(buffer){ buffers[name] = buffer; rack.updateNative( true ); })
		.catch(function(err){ console.warn("reverb impulse not loaded", room[1], err); })
		.finally(function(){ delete loading[name]; });
}

function defaults()
{
	return { on: true, mix: 0.15, room: "HALL B", predelay: 0.02, tone: 12000, dry: true };
}

function validate( s, data )
{
	if(typeof data.room == "number") // saves from when there were two rooms
		s.room = data.room == 0 ? "HALL A" : "HALL B";
	if(WR.reverbRoomIndex( s.room ) == -1)
		s.room = "HALL B";
}

// native graph: input -> pre-delay -> convolver -> tone -> wet ; input -> dry ; both -> output
var native = {
	build: function( ctx ) {
		var g = {
			input: ctx.createGain(), output: ctx.createGain(),
			predelay: ctx.createDelay( 1 ), convolver: ctx.createConvolver(),
			tone: ctx.createBiquadFilter(), wet: ctx.createGain(), dry: ctx.createGain(), room: null
		};
		g.tone.type = "lowpass";
		g.wet.gain.value = 0;
		g.input.connect( g.predelay );
		g.predelay.connect( g.convolver );
		g.convolver.connect( g.tone );
		g.tone.connect( g.wet );
		g.wet.connect( g.output );
		g.input.connect( g.dry );
		g.dry.connect( g.output );
		return g;
	},
	update: function( g, s, rack ) {
		loadRoom( rack, s.room );
		if(g.room != s.room && buffers[ s.room ])
		{
			g.convolver.buffer = buffers[ s.room ];
			g.room = s.room;
		}
		var t = rack.context.currentTime;
		g.predelay.delayTime.setTargetAtTime( s.predelay, t, 0.03 );
		g.tone.frequency.setTargetAtTime( s.tone, t, 0.03 );
		g.wet.gain.setTargetAtTime( s.on ? s.mix * s.mix * 0.8 : 0, t, 0.03 );
		g.dry.gain.setTargetAtTime( s.on && !s.dry ? 0 : 1, t, 0.03 ); // bypassed (off) = dry through
	}
};

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	var s = M.settings;
	drawDevicePanel( 0, 0, w, h, "REVERB", ["CONVOLUTION", "STEREO REVERB"] );
	s.mix = knob( "mix", 100, 70, 28, s.mix, 0, 1, { label: "MIX", def: 0.15, format: fmtPct } );
	s.predelay = knob( "predelay", 210, 70, 24, s.predelay, 0, 0.25, { label: "PRE-DELAY", style: "ring", def: 0.02, format: fmtTime } );
	s.tone = knob( "tone", 310, 70, 24, s.tone, 500, 16000, { label: "TONE", exp: true, def: 12000, format: fmtHz } );
	// ROOM: name display with previous / next buttons
	var rooms = WR.REVERB_ROOMS, ri = WR.reverbRoomIndex( s.room );
	drawLabel( "ROOM", 476, 30, 11 );
	var lx = 392, lw = 168;
	drawLcd( lx, 42, lw, 24, (ri + 1) + "/" + rooms.length + " " + s.room + (loading[ s.room ] ? " …" : ""), "center" );
	if(button( "prev", lx, 84, 36, 22, "◀" ).clicked)
		s.room = rooms[ (ri - 1 + rooms.length) % rooms.length ][0];
	if(button( "next", lx + 42, 84, 36, 22, "▶" ).clicked)
		s.room = rooms[ (ri + 1) % rooms.length ][0];
	if(button( "on", lx + 92, 84, 76, 22, "ON", s.on ).clicked)
		s.on = !s.on;
	if(button( "dry", lx + 92, 112, 76, 22, "DRY", s.dry ).clicked)
		s.dry = !s.dry;
}

WR.registerSynth( "reverb", {
	title: "REVERB",
	description: "Convolution reverb, 12 rooms",
	about: "Convolution reverb with 12 rooms, from drum rooms to churches, with pre-delay and tone. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^on$", 2], ["", 1]],
	category: "Effects",
	half: true,
	max: 8, // one send / return slot of the rack processor each
	worklet: "devices/reverb-worklet.js",
	native: native,
	jacks: [],
	rear_jacks: REAR_JACKS,
	midi_in: null,
	defaults: defaults,
	validate: validate,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return !s.on ? "BYPASSED (OFF): DRY THROUGH" : (s.dry ? "DRY + REVERB" : "100% WET (DRY OFF)"); }
});

})();
