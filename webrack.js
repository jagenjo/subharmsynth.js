// webrack.js
// The rack: a column of synth modules between the shared devices (keys on top; LFO, compressor,
// reverb and delay below), with one patch bay across all of them. This is the main thread side:
// settings, module list, patches (presets), audio graph and post FX, Scala scales, Web MIDI and the keys.
// The synths register themselves from synths/*.js (panel, jacks, defaults) and synths/*-worklet.js
// (DSP); all DSP runs in one AudioWorkletProcessor (rack-worklet.js) hosting the modules.

var C4_FREQ = 261.6255653005986;

var WR = {
	types: {},   // registered synths: type -> definition (see WR.registerSynth)
	order: []
};

WR.VERSION = "20261016i"; // bump together with the ?v= in index.html so browsers reload the scripts

// def: {
//   title, description,           names for menus and the panel
//   worklet,                      DSP file, registers globalThis.WR_DSP[type]
//   jacks,                        patch bay rows of [label, "in"|"out"|"midiin", id]
//   midi_in,                      id of its MIDI IN jack, if it has one
//   defaults(),                   settings of a new module
//   validate(s, data),            fix-ups after a load (ranges, enums, old saves)
//   randomize(s, rack),
//   size(layout),                 [w, h] of the panel in its own coordinates
//   draw(module),                 draws the panel (code.js widgets)
//   transport(module, action, value)  play / reset / next / trigger from the computer keyboard
//   tempo(s)                      BPM for the delay's tempo sync, if it has a clock
// }
WR.registerSynth = function( type, def )
{
	def.type = type;
	WR.types[ type ] = def;
	WR.order.push( type );
}

// patch bay ids: the rack's own jacks are plain, a module's are prefixed with its id
WR.jackId = function( module_id, id ) { return module_id + "." + id; }

// jacks of the shared devices
WR.LFO_JACKS = [
	[["RATE 1","in","lfo1_rate"], ["RATE 2","in","lfo2_rate"]],
	[["SYNC 1","in","lfo1_sync"], ["SYNC 2","in","lfo2_sync"]],
	[["LFO 1","out","lfo1"], ["LFO 2","out","lfo2"]]
];
WR.COMP_JACKS = [
	[["SIDECHAIN","in","comp_sc"], ["GR","out","comp_gr"], ["SCOPE","in","scope_in"]]
];
// audio sockets on the back of the shared devices (line level, "ain" / "aout"): patched like the
// front jacks, but only with each other. An audio input sums every cable plugged into it
WR.REAR_JACKS = {
	io: [["MAIN IN L","ain","io_main_l"], ["MAIN IN R","ain","io_main_r"], ["INPUT L","aout","io_input_l"], ["INPUT R","aout","io_input_r"]],
	comp: [["IN L","ain","comp_in_l"], ["IN R","ain","comp_in_r"], ["OUT L","aout","comp_out_l"], ["OUT R","aout","comp_out_r"]],
	delay: [["IN L","ain","delay_in_l"], ["IN R","ain","delay_in_r"], ["OUT L","aout","delay_out_l"], ["OUT R","aout","delay_out_r"]],
	reverb: [["IN L","ain","reverb_in_l"], ["IN R","ain","reverb_in_r"], ["OUT L","aout","reverb_out_l"], ["OUT R","aout","reverb_out_r"]]
};
// the default audio path after the synths: compressor -> delay -> reverb -> speakers (L red, R white)
WR.AUDIO_CHAIN = [
	["comp_out_l", "delay_in_l", 1], ["comp_out_r", "delay_in_r", 5],
	["delay_out_l", "reverb_in_l", 1], ["delay_out_r", "reverb_in_r", 5],
	["reverb_out_l", "io_main_l", 1], ["reverb_out_r", "io_main_r", 5]
];

// audio I/O device: the audio interface input as patchable signals (+-5V)
WR.IO_JACKS = [
	[["IN L","out","in_l"], ["IN R","out","in_r"]]
];
WR.KB_JACKS = [
	[["GATE 1","out","kb_gate1"], ["KEY 1","out","kb_key1"], ["GATE 2","out","kb_gate2"], ["KEY 2","out","kb_key2"], ["TRIG","out","kb_trig"], ["MIDI","midiout","kb_midi"]]
];
WR.SCOPE_TIMES = [0.005, 0.02, 0.1, 0.5, 2];
WR.LFO_SHAPES = ["sine","tri","saw","ramp","square","sh"];

function WRContext()
{
	this.context = null;
	this.node = null;
	this.settings = WRContext.defaultSettings();
	this.state = { lfo: [0,0], comp_gr: 0, scope: null };
	this.module_state = {}; // module id -> state reported by its DSP
	this.custom_scale = null; // { file, description, degrees, period }
	this.midi = { access: null, inputs: [], selected: "all", activity: 0, status: "off" };
	this.keys = { held: {}, all: [], zones: [[], []] }; // held: note -> zone
	this.onmidichange = null;
	// audio I/O: per browser, not part of the patches
	this.io = WRContext.loadIO();
	this.io_devices = { outputs: [], inputs: [], status: "" };
	this.input = null;  // { stream, source } while the audio input is on
	this.meter = [0, 0]; // master peak level per channel, linear
	this._sent = null;
	this._initializing = null;
}
WR.Context = WRContext;

WRContext.USER_PATCHES_KEY = "SUBHARM_patches";
WRContext.OLD_STORAGE_KEY = "SUBHARM_state_v2";
WRContext.PATCH_FORMAT = "webrack-patch";
WRContext.OLD_PATCH_FORMAT = "subharm-patch";

// the shared devices' settings (everything but the modules and the cables)
WRContext.rackDefaults = function()
{
	return {
		reverb: 0.15,       // reverb MIX
		// post FX devices: delay (off by default) and reverb settings
		fx: { reverb_on: true, reverb_room: "HALL B", reverb_predelay: 0.02, reverb_tone: 12000,
			delay_on: false, delay_sync: true, delay_div: 3, delay_time: 0.3, delay_feedback: 0.4, delay_tone: 5000, delay_mix: 0.3, delay_pingpong: true,
			reverb_dry: true, delay_dry: true }, // DRY off: 100% wet, for an aux send
		scale_file: null,
		lfo: [
			{ rate: 0.5, shape: "sine", level: 1 },  // rate in Hz, level scales the +-5V output
			{ rate: 4, shape: "tri", level: 0.5 }
		],
		comp: { on: true, threshold: -12, ratio: 3, attack: 0.005, release: 0.12, makeup: 0, mix: 1 }, // dB / s
		scope: { time: 0.02 }, // oscilloscope window in seconds, one of WR.SCOPE_TIMES
		kb: { split: false, split_note: 60, octave: 0 } // keys device; split_note starts the upper zone
	};
}

WRContext.defaultSettings = function()
{
	var s = WRContext.rackDefaults();
	s.version = 4;
	s.modules = [];
	s.patches = WR.AUDIO_CHAIN.map(function(c){ return c.slice(); }); // [output id, input id, color index]
	WRContext.addModuleTo( s, "subharm" );
	return s;
}

// appends a new module of `type` to the settings, cabled in; returns it
WRContext.addModuleTo = function( s, type )
{
	var def = WR.types[ type ];
	var id = type, n = 1;
	while(s.modules.some(function(m){ return m.id == id; }))
		id = type + (++n);
	var m = { id: id, type: type, settings: def.defaults() };
	s.modules.push( m );
	if(def.midi_in) // new synths with a MIDI IN get the keys' MIDI cable
		s.patches.push([ "kb_midi", WR.jackId( id, def.midi_in ), 5 ]);
	WRContext.routeAudio( s, m );
	return m;
}

WR.isMixerInput = function( s, id )
{
	return s.modules.some(function(m){ return m.type == "mixer" && id.indexOf( m.id + ".in" ) == 0; });
}

// cables a new module's audio in: a synth goes to a free mixer channel, or where the other synths
// go, or the compressor. A new mixer takes over the synths that weren't on a mixer yet
WRContext.routeAudio = function( s, m )
{
	var def = WR.types[ m.type ];
	var has = function(dst){ return s.patches.some(function(p){ return p[1] == dst; }); };
	var synthAudio = function(id){ return /\.audio$/.test( id ); };
	if(def.mixer)
	{
		var loose = s.patches.filter(function(p){ return synthAudio( p[0] ) && !WR.isMixerInput( s, p[1] ); });
		if(!loose.length)
			return;
		var dest = loose[0][1];
		s.patches = s.patches.filter(function(p){ return loose.indexOf( p ) == -1; });
		loose.slice( 0, def.channels ).forEach(function(p, k){
			s.patches.push([ p[0], WR.jackId( m.id, "in" + (k + 1) ), p[2] ]);
		});
		var types = WRContext.jackTypes( s.modules );
		var right = /_l$/.test( dest ) && types[ dest.replace(/_l$/, "_r") ] ? dest.replace(/_l$/, "_r") : dest;
		s.patches.push([ WR.jackId( m.id, "main_l" ), dest, 1 ]);
		s.patches.push([ WR.jackId( m.id, "main_r" ), right, 5 ]);
		return;
	}
	if(!def.audio_out)
		return;
	var src = WR.jackId( m.id, def.audio_out );
	var color = 2 + (s.modules.length % 5);
	var mixers = s.modules.filter(function(o){ return WR.types[ o.type ].mixer; });
	for(var i = 0; i < mixers.length; ++i)
		for(var k = 1; k <= WR.types[ mixers[i].type ].channels; ++k)
		{
			var dst = WR.jackId( mixers[i].id, "in" + k );
			if(!has( dst ))
			{
				s.patches.push([ src, dst, color ]);
				return;
			}
		}
	var other = s.patches.find(function(p){ return synthAudio( p[0] ) && p[0] != src; });
	s.patches.push([ src, other ? other[1] : "comp_in_l", color ]);
}

WRContext.prototype.init = function()
{
	if(this._initializing)
		return this._initializing;
	var that = this;
	var ctx = this.context = new AudioContext({ latencyHint: "interactive" });
	var v = "?v=" + WR.VERSION;
	// the module DSPs register into the worklet's global scope before the rack processor is created
	var load = Promise.resolve();
	WR.order.forEach(function(type){
		load = load.then(function(){ return ctx.audioWorklet.addModule( WR.types[type].worklet + v ); });
	});
	this._initializing = load.then(function(){ return ctx.audioWorklet.addModule( "rack-worklet.js" + v ); }).then(function(){
		var node = that.node = new AudioWorkletNode( ctx, "webrack", {
			numberOfInputs: 3, numberOfOutputs: 3, outputChannelCount: [2, 2, 2],
			channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers"
		});
		node.port.onmessage = function(e) {
			if(e.data.type == "state")
			{
				that.state = e.data.rack;
				that.module_state = e.data.modules;
			}
		};

		that.buildPostFx( ctx, node );
		// audio interface input -> gain -> the rack's IN L / IN R jacks
		that.input_gain = ctx.createGain();
		that.input_gain.connect( node, 0, 0 );
		that.updateIO();
		if(that.io.output_id)
			that.setOutput( that.io.output_id );
		if(that.io.input_on)
			that.setInput( that.io.input_id );
		that.refreshDevices();
		if(navigator.mediaDevices && navigator.mediaDevices.addEventListener)
			navigator.mediaDevices.addEventListener( "devicechange", function(){ that.refreshDevices(); } );

		that._sent = null;
		that.sendScale();
		that.sync();
	});
	return this._initializing;
}

WRContext.prototype.post = function( msg )
{
	if(this.node)
		this.node.port.postMessage( msg );
}

WRContext.prototype.postModule = function( id, msg )
{
	this.post({ type: "module", id: id, msg: msg });
}

// sends the settings to the audio thread when they changed
WRContext.prototype.sync = function()
{
	if(!this.node)
		return;
	var json = JSON.stringify( this.settings );
	if(json === this._sent)
		return;
	this._sent = json;
	this.post({ type: "settings", settings: this.settings });
	this.updatePostFx();
}

// ---- modules ----

// what a panel needs to draw a module: its settings, the state its DSP reports, and a way to message it
WRContext.prototype.modules = function()
{
	var that = this;
	return this.settings.modules.map(function(m){
		return {
			id: m.id, type: m.type, def: WR.types[ m.type ], settings: m.settings,
			state: that.module_state[ m.id ] || null,
			post: function(msg){ that.postModule( m.id, msg ); }
		};
	});
}

WRContext.prototype.addModule = function( type )
{
	var m = WRContext.addModuleTo( this.settings, type );
	this.module_state[ m.id ] = null;
	return m;
}

WRContext.prototype.removeModule = function( id )
{
	var prefix = id + ".";
	this.settings.modules = this.settings.modules.filter(function(m){ return m.id != id; });
	this.settings.patches = this.settings.patches.filter(function(p){ return p[0].indexOf( prefix ) != 0 && p[1].indexOf( prefix ) != 0; });
	delete this.module_state[ id ];
}

WRContext.prototype.moveModule = function( id, dir )
{
	var list = this.settings.modules;
	var i = list.findIndex(function(m){ return m.id == id; });
	var j = i + dir;
	if(i < 0 || j < 0 || j >= list.length)
		return;
	var m = list[i];
	list[i] = list[j];
	list[j] = m;
}

// play / reset / next / trigger on every module (computer keyboard shortcuts). Play starts all
// of them when none is running, otherwise stops them all
WRContext.prototype.transport = function( action, value )
{
	var mods = this.modules();
	if(action == "play")
		value = !mods.some(function(m){ return m.state && m.state.playing; });
	mods.forEach(function(m){
		if(m.def.transport)
			m.def.transport( m, action, value );
	});
}

// BPM of the first module with a clock, for the delay's tempo sync
WRContext.prototype.tempo = function()
{
	var mods = this.settings.modules;
	for(var i = 0; i < mods.length; ++i)
	{
		var def = WR.types[ mods[i].type ];
		if(def.tempo)
			return def.tempo( mods[i].settings );
	}
	return 120;
}

// every jack id in the rack -> type
WRContext.jackTypes = function( modules )
{
	var types = {};
	WR.LFO_JACKS.concat( WR.COMP_JACKS, WR.KB_JACKS, WR.IO_JACKS ).forEach(function(row){
		row.forEach(function(j){ types[ j[2] ] = j[1]; });
	});
	for(var dev in WR.REAR_JACKS)
		WR.REAR_JACKS[dev].forEach(function(j){ types[ j[2] ] = j[1]; });
	modules.forEach(function(m){
		var def = WR.types[ m.type ];
		def.jacks.concat([ def.rear_jacks || [] ]).forEach(function(row){
			row.forEach(function(j){ types[ WR.jackId( m.id, j[2] ) ] = j[1]; });
		});
	});
	return types;
}

// ---- post FX (not on the hardware): delay inserted on the master, reverb as a send ----
//   rack -> bus -> speakers
//   rack -> delay (two lines, normal or ping-pong, lowpass in the feedback) -> bus
//   bus -> pre-delay -> convolver -> tone -> reverb mix -> speakers

// reverb rooms, short to long: [name, impulse file]; a null file is generated in code.
// data/impulses/ are Voxengo "IM Reverbs" (see data/impulses/license.txt)
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
WR.DELAY_DIVS = [["1/16", 0.25], ["1/8T", 1/3], ["1/8", 0.5], ["1/8D", 0.75], ["1/4T", 2/3], ["1/4", 1], ["1/4D", 1.5], ["1/2", 2], ["1/1", 4]];

// Native nodes around the rack processor. Its output 0 goes to the speakers; outputs 1 and 2 are the
// signals patched into the delay and reverb sockets, which come back on its inputs 1 and 2:
//   output 0 -> master volume -> speakers (+ meters)
//   output 1 -> delay: dry + two delay lines (normal or ping-pong, lowpass in the feedback) -> input 1
//   output 2 -> reverb: dry + pre-delay -> convolver -> tone -> mix -> input 2
// The returns go through a DelayNode: a loop through the processor needs one (it adds a render quantum)
WRContext.prototype.buildPostFx = function( ctx, node )
{
	// master volume, then the speakers; the meters listen after it
	var master = this.master = ctx.createGain();
	node.connect( master, 0 );
	master.connect( ctx.destination );
	var split = ctx.createChannelSplitter( 2 );
	master.connect( split );
	this.analysers = [0, 1].map(function(c){
		var a = ctx.createAnalyser();
		a.fftSize = 1024;
		split.connect( a, c );
		return a;
	});
	this._meter_buf = new Float32Array( 1024 );

	var returnTo = function( input ) {
		var bus = ctx.createGain(), loop = ctx.createDelay( 0.1 );
		loop.delayTime.value = 0;
		bus.connect( loop );
		loop.connect( node, 0, input );
		return bus;
	};

	// delay
	var d = this.delay = {
		inL: ctx.createGain(), inR: ctx.createGain(), inPP: ctx.createGain(), dry: ctx.createGain(),
		lineL: ctx.createDelay( 5 ), lineR: ctx.createDelay( 5 ),
		toneL: ctx.createBiquadFilter(), toneR: ctx.createBiquadFilter(),
		selfL: ctx.createGain(), selfR: ctx.createGain(), crossLR: ctx.createGain(), crossRL: ctx.createGain(),
		merger: ctx.createChannelMerger( 2 ), wet: ctx.createGain(), ret: returnTo( 1 )
	};
	var dsplit = ctx.createChannelSplitter( 2 );
	node.connect( dsplit, 1 );
	dsplit.connect( d.inL, 0 ); dsplit.connect( d.inR, 1 );
	var mono = ctx.createGain();
	mono.channelCount = 1;
	mono.channelCountMode = "explicit"; // ping-pong starts from the mono sum on the left
	node.connect( mono, 1 );
	mono.connect( d.inPP );
	d.inPP.connect( d.lineL );
	d.inL.connect( d.lineL ); d.inR.connect( d.lineR );
	d.lineL.connect( d.toneL ); d.lineR.connect( d.toneR );
	d.toneL.connect( d.selfL ); d.selfL.connect( d.lineL );
	d.toneR.connect( d.selfR ); d.selfR.connect( d.lineR );
	d.toneL.connect( d.crossLR ); d.crossLR.connect( d.lineR );
	d.toneR.connect( d.crossRL ); d.crossRL.connect( d.lineL );
	d.toneL.connect( d.merger, 0, 0 ); d.toneR.connect( d.merger, 0, 1 );
	d.merger.connect( d.wet );
	d.wet.connect( d.ret );
	node.connect( d.dry, 1 );
	d.dry.connect( d.ret );
	[d.toneL, d.toneR].forEach(function(f){ f.type = "lowpass"; f.Q.value = 0.5; });
	[d.wet, d.inL, d.inR, d.inPP, d.selfL, d.selfR, d.crossLR, d.crossRL].forEach(function(g){ g.gain.value = 0; });

	// reverb
	var r = this.reverb = {
		predelay: ctx.createDelay( 1 ), convolver: ctx.createConvolver(), dry: ctx.createGain(),
		tone: ctx.createBiquadFilter(), wet: ctx.createGain(), ret: returnTo( 2 ), buffers: {}, loading: {}, room: null
	};
	r.tone.type = "lowpass";
	r.wet.gain.value = 0;
	node.connect( r.predelay, 2 );
	r.predelay.connect( r.convolver );
	r.convolver.connect( r.tone );
	r.tone.connect( r.wet );
	r.wet.connect( r.ret );
	node.connect( r.dry, 2 );
	r.dry.connect( r.ret );
}

// impulses are loaded the first time their room is selected
WRContext.prototype.loadReverbRoom = function( name )
{
	var r = this.reverb, that = this;
	var room = WR.REVERB_ROOMS[ WR.reverbRoomIndex( name ) ];
	if(!room || r.buffers[name] || r.loading[name])
		return;
	if(!room[1])
	{
		r.buffers[name] = WR.makePlate( this.context, 2.6 );
		return;
	}
	r.loading[name] = true;
	var ctx = this.context;
	fetch( room[1] )
		.then(function(res){ if(!res.ok) throw new Error("HTTP " + res.status); return res.arrayBuffer(); })
		.then(function(b){ return ctx.decodeAudioData(b); })
		.then(function(buffer){ r.buffers[name] = buffer; that.updatePostFx(); })
		.catch(function(err){ console.warn("reverb impulse not loaded", room[1], err); })
		.finally(function(){ delete r.loading[name]; });
}

// true while the selected room's impulse is still downloading
WRContext.prototype.reverbLoading = function()
{
	return !!(this.reverb && this.reverb.loading[ this.settings.fx.reverb_room ]);
}

WRContext.prototype.delayTime = function()
{
	var fx = this.settings.fx;
	if(fx.delay_sync)
		return Math.min( 4.9, (60 / this.tempo()) * WR.DELAY_DIVS[ fx.delay_div ][1] );
	return fx.delay_time;
}

WRContext.prototype.updatePostFx = function()
{
	if(!this.master)
		return;
	var fx = this.settings.fx;
	var t = this.context.currentTime;
	var set = function(param, v, tc) { param.setTargetAtTime( v, t, tc || 0.03 ); };

	var d = this.delay;
	var time = this.delayTime();
	set( d.lineL.delayTime, time, 0.05 );
	set( d.lineR.delayTime, time, 0.05 );
	set( d.toneL.frequency, fx.delay_tone );
	set( d.toneR.frequency, fx.delay_tone );
	var on = fx.delay_on ? 1 : 0, fb = fx.delay_feedback;
	set( d.inL.gain, fx.delay_pingpong ? 0 : on );
	set( d.inR.gain, fx.delay_pingpong ? 0 : on );
	set( d.inPP.gain, fx.delay_pingpong ? on : 0 ); // ping-pong starts on the left only
	set( d.dry.gain, on && !fx.delay_dry ? 0 : 1 ); // bypassed (off) = dry through
	set( d.selfL.gain, fx.delay_pingpong ? 0 : fb );
	set( d.selfR.gain, fx.delay_pingpong ? 0 : fb );
	set( d.crossLR.gain, fx.delay_pingpong ? fb : 0 );
	set( d.crossRL.gain, fx.delay_pingpong ? fb : 0 );
	set( d.wet.gain, on * fx.delay_mix );

	var r = this.reverb;
	this.loadReverbRoom( fx.reverb_room );
	if(r.room != fx.reverb_room && r.buffers[ fx.reverb_room ])
	{
		r.convolver.buffer = r.buffers[ fx.reverb_room ];
		r.room = fx.reverb_room;
	}
	var mix = this.settings.reverb;
	set( r.predelay.delayTime, fx.reverb_predelay );
	set( r.tone.frequency, fx.reverb_tone );
	set( r.wet.gain, fx.reverb_on ? mix * mix * 0.8 : 0 );
	set( r.dry.gain, fx.reverb_on && !fx.reverb_dry ? 0 : 1 );
}

// ---- audio I/O device: output and input devices, input gain, master volume ----

WRContext.IO_KEY = "SUBHARM_io";

WRContext.loadIO = function()
{
	var io = { master: 0.8, input_gain: 0.5, output_id: "", input_id: "", input_on: false };
	try {
		var saved = JSON.parse( localStorage.getItem( WRContext.IO_KEY ) || "{}" ) || {};
		io = WR.mergeValid( io, saved );
	} catch(err) {}
	return io;
}

WRContext.prototype.saveIO = function()
{
	try { localStorage.setItem( WRContext.IO_KEY, JSON.stringify( this.io ) ); } catch(err) {}
}

// MASTER knob 0..1 -> gain: 0.8 (the default) is unity, full is +3.9 dB
WRContext.masterGain = function( v ) { return (v / 0.8) * (v / 0.8); }

// gains from the knobs; called every frame, cheap when nothing changed
WRContext.prototype.updateIO = function()
{
	if(!this.master)
		return;
	var key = this.io.master + "/" + this.io.input_gain;
	if(key === this._io_sent)
		return;
	this._io_sent = key;
	var t = this.context.currentTime;
	this.master.gain.setTargetAtTime( WRContext.masterGain( this.io.master ), t, 0.02 );
	this.input_gain.gain.setTargetAtTime( 4 * this.io.input_gain * this.io.input_gain, t, 0.02 ); // 0.5 = unity
	this.saveIO();
}

// peak level of the master output since the last call, with a falling hold
WRContext.prototype.updateMeter = function()
{
	if(!this.analysers)
		return this.meter;
	var buf = this._meter_buf;
	for(var c = 0; c < 2; ++c)
	{
		this.analysers[c].getFloatTimeDomainData( buf );
		var peak = 0;
		for(var i = 0; i < buf.length; ++i)
		{
			var v = buf[i] < 0 ? -buf[i] : buf[i];
			if(v > peak) peak = v;
		}
		this.meter[c] = Math.max( peak, this.meter[c] * 0.92 );
	}
	return this.meter;
}

WRContext.prototype.refreshDevices = function()
{
	var that = this, d = this.io_devices;
	if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
	{
		d.status = "no device list in this browser";
		return Promise.resolve();
	}
	return navigator.mediaDevices.enumerateDevices().then(function(list){
		// "default" / "communications" are aliases of other entries: the default goes first as ""
		var pick = function(kind) {
			var r = [{ id: "", label: "DEFAULT" }];
			list.forEach(function(dev, i){
				if(dev.kind == kind && dev.deviceId != "default" && dev.deviceId != "communications" && dev.deviceId)
					r.push({ id: dev.deviceId, label: dev.label || (kind == "audioinput" ? "INPUT " : "OUTPUT ") + r.length });
			});
			return r;
		};
		d.outputs = pick( "audiooutput" );
		d.inputs = pick( "audioinput" );
	}).catch(function(){});
}

WRContext.prototype.canSelectOutput = function()
{
	return !!(this.context ? this.context.setSinkId : (window.AudioContext && AudioContext.prototype.setSinkId));
}

WRContext.prototype.deviceLabel = function( list, id )
{
	var dev = list.find(function(d){ return d.id == id; });
	return dev ? dev.label.toUpperCase() : (id ? "DISCONNECTED" : "DEFAULT");
}

WRContext.prototype.setOutput = function( id )
{
	var that = this;
	if(!this.context || !this.context.setSinkId)
		return Promise.reject( new Error("this browser can't choose the output device") );
	return this.context.setSinkId( id || "" ).then(function(){
		that.io.output_id = id || "";
		that.saveIO();
	});
}

WRContext.prototype.cycleOutput = function( dir )
{
	var list = this.io_devices.outputs;
	if(list.length < 2)
		return Promise.resolve();
	var i = list.findIndex(function(d){ return d.id == this.io.output_id; }, this);
	return this.setOutput( list[ (i + dir + list.length) % list.length ].id );
}

// opens the input device (null / false closes it): microphone or line in, without voice processing
WRContext.prototype.setInput = function( id )
{
	var that = this;
	if(this.input)
	{
		this.input.source.disconnect();
		this.input.stream.getTracks().forEach(function(t){ t.stop(); });
		this.input = null;
	}
	if(id === null || id === false)
	{
		this.io.input_on = false;
		this.saveIO();
		return Promise.resolve();
	}
	if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
		return Promise.reject( new Error("no audio input in this browser") );
	var audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 };
	if(id)
		audio.deviceId = { exact: id };
	return navigator.mediaDevices.getUserMedia({ audio: audio }).then(function(stream){
		var source = that.context.createMediaStreamSource( stream );
		source.connect( that.input_gain );
		that.input = { stream: stream, source: source };
		that.io.input_on = true;
		that.io.input_id = id || "";
		that.saveIO();
		return that.refreshDevices(); // device names are only readable once access is granted
	}, function(err){
		that.io.input_on = false;
		that.saveIO();
		throw err;
	});
}

WRContext.prototype.cycleInput = function( dir )
{
	var list = this.io_devices.inputs;
	if(list.length < 2)
		return Promise.resolve();
	var i = list.findIndex(function(d){ return d.id == this.io.input_id; }, this);
	var id = list[ (i + dir + list.length) % list.length ].id;
	if(!this.input)
	{
		this.io.input_id = id;
		this.saveIO();
		return Promise.resolve();
	}
	return this.setInput( id );
}

// ---- patching ----

WRContext.prototype.connect = function( out_id, in_id, color )
{
	var patches = this.settings.patches;
	var audio = WRContext.jackTypes( this.settings.modules )[ in_id ] == "ain";
	for(var i = patches.length - 1; i >= 0; --i)
		if(patches[i][1] == in_id && (!audio || patches[i][0] == out_id))
			patches.splice(i,1); // a CV input takes a single cable, an audio input adds them up
	patches.push([ out_id, in_id, color || 0 ]);
}

WRContext.prototype.disconnect = function( jack_id )
{
	this.settings.patches = this.settings.patches.filter(function(p){ return p[0] != jack_id && p[1] != jack_id; });
}

// ---- patches (presets): the whole rack, its modules and cables ----

// copies `data` over `def`, keeping only fields with the right type so a
// malformed or older patch file can never put garbage into the engine
WR.mergeValid = function( def, data )
{
	if(Array.isArray(def))
	{
		if(!Array.isArray(data) || data.length != def.length)
			return def;
		return def.map(function(d, i){ return WR.mergeValid( d, data[i] ); });
	}
	if(def && typeof def == "object")
	{
		if(!data || typeof data != "object" || Array.isArray(data))
			return def;
		var r = {};
		for(var k in def)
			r[k] = WR.mergeValid( def[k], data[k] );
		return r;
	}
	if(typeof def == "number")
		return (typeof data == "number" && isFinite(data)) ? data : def;
	return typeof data == typeof def ? data : def;
}

// saves from before the rack (version 2 and older) are a single Subharmonicon with the shared
// devices in the same object: they become a rack with one "subharm" module
WR.migrateV2 = function( data )
{
	var r = { version: 3, modules: [{ id: "subharm", type: "subharm", settings: data }] };
	["reverb", "fx", "scale_file", "lfo", "comp", "scope", "kb"].forEach(function(k){
		if(k in data)
			r[k] = data[k];
	});
	var ids = {};
	WR.types.subharm.jacks.forEach(function(row){ row.forEach(function(j){ ids[ j[2] ] = true; }); });
	r.patches = (Array.isArray(data.patches) ? data.patches : []).map(function(p){
		if(!Array.isArray(p))
			return p;
		return p.map(function(id, k){ return k < 2 && ids[id] ? WR.jackId( "subharm", id ) : id; });
	});
	// from before the keys device: MIDI went straight into the synth
	if(!data.kb && !r.patches.some(function(p){ return Array.isArray(p) && p[1] == "subharm.midi_in"; }))
		r.patches.push([ "kb_midi", "subharm.midi_in", 5 ]);
	return r;
}

WRContext.prototype.setSettings = function( data )
{
	data = data || {};
	if(!(data.version >= 3))
		data = WR.migrateV2( data );
	var add_audio = !(data.version >= 4); // from before the rear sockets: cable the old fixed audio path
	var s = WR.mergeValid( WRContext.rackDefaults(), data );
	s.version = 4;
	s.scale_file = typeof data.scale_file == "string" ? data.scale_file : null;
	if(data.fx && typeof data.fx.reverb_room == "number") // saves from when there were two rooms
		s.fx.reverb_room = data.fx.reverb_room == 0 ? "HALL A" : "HALL B";
	if(WR.reverbRoomIndex( s.fx.reverb_room ) == -1)
		s.fx.reverb_room = "HALL B";
	s.fx.delay_div = Math.min( WR.DELAY_DIVS.length - 1, Math.max( 0, Math.round( s.fx.delay_div ) ) );
	s.fx.delay_feedback = Math.min( 0.95, Math.max( 0, s.fx.delay_feedback ) );
	if(WR.SCOPE_TIMES.indexOf( s.scope.time ) == -1)
		s.scope.time = 0.02;
	s.lfo.forEach(function(l){
		if(WR.LFO_SHAPES.indexOf( l.shape ) == -1)
			l.shape = "sine";
	});
	s.kb.split_note = Math.min( 96, Math.max( 24, Math.round( s.kb.split_note ) ) );
	s.kb.octave = Math.min( 2, Math.max( -2, Math.round( s.kb.octave ) ) );

	// modules: known types only, unique ids, settings validated by their synth
	s.modules = [];
	(Array.isArray(data.modules) ? data.modules : []).forEach(function(m){
		if(!m || typeof m != "object" || !WR.types[ m.type ])
			return;
		var def = WR.types[ m.type ];
		var id = m.id;
		var taken = function(id){ return s.modules.some(function(o){ return o.id == id; }); };
		if(typeof id != "string" || !/^[a-z][a-z0-9_]*$/.test( id ) || taken( id ))
		{
			id = m.type;
			for(var n = 2; taken( id ); ++n)
				id = m.type + n;
		}
		var raw = m.settings && typeof m.settings == "object" ? m.settings : {};
		var ms = WR.mergeValid( def.defaults(), raw );
		if(def.validate)
			def.validate( ms, raw );
		s.modules.push({ id: id, type: m.type, settings: ms });
	});

	var jack_ids = WRContext.jackTypes( s.modules );
	s.patches = (Array.isArray(data.patches) ? data.patches : []).filter(function(p){
		return Array.isArray(p) && ((jack_ids[ p[0] ] == "out" && jack_ids[ p[1] ] == "in") ||
			(jack_ids[ p[0] ] == "aout" && jack_ids[ p[1] ] == "ain") ||
			(jack_ids[ p[0] ] == "midiout" && jack_ids[ p[1] ] == "midiin"));
	}).map(function(p){ return [ p[0], p[1], (p[2] | 0) ]; });
	if(add_audio)
	{
		s.patches = s.patches.concat( WR.AUDIO_CHAIN.map(function(c){ return c.slice(); }) );
		var all = s.modules;
		s.modules = [];
		all.forEach(function(m){ s.modules.push( m ); WRContext.routeAudio( s, m ); });
	}
	this.settings = s;
	this.module_state = {};
	this.allNotesOff();

	if(!s.scale_file)
		this.clearScale();
	else if(!this.custom_scale || this.custom_scale.file != s.scale_file)
	{
		var that = this;
		this.loadScale( s.scale_file, true ).catch(function(){ that.clearScale(); });
	}
}

WRContext.prototype.getUserPatches = function()
{
	var patches = {};
	try {
		patches = JSON.parse( localStorage.getItem( WRContext.USER_PATCHES_KEY ) || "{}" ) || {};
		// the old single save slot becomes a named patch
		var old = localStorage.getItem( WRContext.OLD_STORAGE_KEY );
		if(old)
		{
			if(!patches["Saved patch"])
				patches["Saved patch"] = JSON.parse( old );
			localStorage.setItem( WRContext.USER_PATCHES_KEY, JSON.stringify( patches ) );
			localStorage.removeItem( WRContext.OLD_STORAGE_KEY );
		}
	} catch(err) {}
	return patches;
}

WRContext.prototype.saveUserPatch = function( name )
{
	try {
		var patches = this.getUserPatches();
		patches[ name ] = JSON.parse( JSON.stringify( this.settings ) );
		localStorage.setItem( WRContext.USER_PATCHES_KEY, JSON.stringify( patches ) );
		return true;
	} catch(err) { return false; }
}

WRContext.prototype.deleteUserPatch = function( name )
{
	try {
		var patches = this.getUserPatches();
		delete patches[ name ];
		localStorage.setItem( WRContext.USER_PATCHES_KEY, JSON.stringify( patches ) );
	} catch(err) {}
}

WRContext.prototype.exportPatch = function( name )
{
	return JSON.stringify({ format: WRContext.PATCH_FORMAT, version: 4, name: name || "", settings: this.settings }, null, "\t");
}

// accepts an exported file (also the older subharm-patch files) or a bare settings object; returns the patch name
WRContext.prototype.importPatch = function( text )
{
	var data = JSON.parse( text );
	if(!data || typeof data != "object")
		throw new Error("not a patch file");
	var settings = data.format == WRContext.PATCH_FORMAT || data.format == WRContext.OLD_PATCH_FORMAT ? data.settings : data;
	if(!settings || typeof settings != "object" || !(Array.isArray(settings.modules) || Array.isArray(settings.vco)))
		throw new Error("not a patch file");
	this.setSettings( settings );
	return typeof data.name == "string" ? data.name : "";
}

// new random sound on every module and the LFOs; volumes, compressor, reverb, cables and the scale are kept
WRContext.prototype.randomize = function()
{
	var that = this;
	this.settings.modules.forEach(function(m){
		var def = WR.types[ m.type ];
		if(def.randomize)
			def.randomize( m.settings, that );
	});
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	this.settings.lfo.forEach(function(l){
		l.rate = 0.05 * Math.pow( 8 / 0.05, Math.random() );
		l.shape = WR.LFO_SHAPES[ Math.floor( Math.random() * WR.LFO_SHAPES.length ) ];
		l.level = rnd( 0.2, 1 );
	});
}

// ---- Scala scales (extension, not on the hardware), used by the modules that quantize ----

WR.parseScala = function( text )
{
	var lines = text.split(/\r?\n/).filter(function(l){ return l.trim()[0] != "!"; });
	if(lines.length < 2)
		return null;
	var description = lines[0].trim();
	var count = parseInt( lines[1] );
	if(!(count > 0))
		return null;
	var pitches = [];
	for(var i = 2; i < lines.length && pitches.length < count; ++i)
	{
		var tok = lines[i].trim().split(/\s+/)[0];
		if(!tok)
			continue;
		var oct;
		if(tok.indexOf(".") != -1)
			oct = parseFloat(tok) / 1200;
		else if(tok.indexOf("/") != -1)
		{
			var t = tok.split("/");
			oct = Math.log2( parseFloat(t[0]) / parseFloat(t[1]) );
		}
		else
			oct = Math.log2( parseFloat(tok) );
		if(isFinite(oct))
			pitches.push( oct );
	}
	if(!pitches.length)
		return null;
	var period = pitches[ pitches.length - 1 ];
	if(!(period > 0))
		period = 1;
	var degrees = [0];
	for(var i = 0; i < pitches.length - 1; ++i)
	{
		var d = pitches[i] - Math.floor( pitches[i] / period ) * period;
		if(d > 1e-9 && d < period - 1e-9)
			degrees.push( d );
	}
	degrees.sort(function(a,b){ return a - b; });
	return { description: description, degrees: degrees, period: period };
}

// keep_modes: loading a patch, whose modules already say whether they use the scale
WRContext.prototype.loadScale = function( file, keep_modes )
{
	var that = this;
	return fetch( "data/scales/" + encodeURIComponent(file) )
		.then(function(r){ if(!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
		.then(function(text){
			var scale = WR.parseScala( text );
			if(!scale)
				throw new Error("invalid scala file");
			scale.file = file;
			that.custom_scale = scale;
			that.settings.scale_file = file;
			if(!keep_modes)
				that.notifyScale( true );
			that.sendScale();
			return scale;
		});
}

WRContext.prototype.clearScale = function()
{
	this.custom_scale = null;
	this.settings.scale_file = null;
	this.notifyScale( false );
	this.sendScale();
}

// lets the synths switch their quantizer to the new scale (or off it)
WRContext.prototype.notifyScale = function( loaded )
{
	this.settings.modules.forEach(function(m){
		var def = WR.types[ m.type ];
		if(def.onScale)
			def.onScale( m.settings, loaded );
	});
}

WRContext.prototype.sendScale = function()
{
	var s = this.custom_scale;
	this.post({ type: "scale", scale: s ? { degrees: s.degrees, period: s.period } : null });
}

// ---- MIDI ----

WRContext.prototype.initMIDI = function()
{
	var that = this;
	if(!navigator.requestMIDIAccess)
	{
		this.midi.status = "Web MIDI not supported in this browser";
		this.notifyMIDI();
		return Promise.resolve(false);
	}
	return navigator.requestMIDIAccess().then(function(access){
		that.midi.access = access;
		that.midi.status = "on";
		access.onstatechange = function(){ that.bindMIDI(); };
		that.bindMIDI();
		return true;
	}, function(){
		that.midi.status = "MIDI access denied";
		that.notifyMIDI();
		return false;
	});
}

WRContext.prototype.bindMIDI = function()
{
	var that = this;
	var midi = this.midi;
	midi.inputs = Array.from( midi.access.inputs.values() );
	midi.inputs.forEach(function(input){
		var active = midi.selected == "all" || midi.selected == input.id;
		input.onmidimessage = active ? function(e){ that.onMIDIMessage(e.data); } : null;
	});
	this.notifyMIDI();
}

WRContext.prototype.selectMIDIInput = function( id )
{
	this.midi.selected = id;
	this.allNotesOff();
	if(this.midi.access)
		this.bindMIDI();
}

WRContext.prototype.cycleMIDIInput = function( dir )
{
	var ids = ["all"].concat( this.midi.inputs.map(function(i){ return i.id; }) );
	var i = ids.indexOf( this.midi.selected );
	this.selectMIDIInput( ids[ (i + dir + ids.length) % ids.length ] );
}

WRContext.prototype.midiInputName = function()
{
	var midi = this.midi;
	if(!midi.access)
		return midi.status == "off" ? "MIDI OFF" : midi.status.toUpperCase();
	if(midi.selected == "all")
		return "ALL INPUTS (" + midi.inputs.length + ")";
	var input = midi.inputs.find(function(i){ return i.id == midi.selected; });
	return input ? (input.name || input.id).toUpperCase() : "DISCONNECTED";
}

WRContext.prototype.notifyMIDI = function()
{
	if(this.onmidichange)
		this.onmidichange( this.midi );
}

WRContext.prototype.onMIDIMessage = function( data )
{
	var st = data[0];
	this.midi.activity = performance.now();

	// realtime messages go straight to the MIDI path (reach a synth only through a MIDI cable)
	switch(st)
	{
		case 0xF8: this.post({ type: "midiClock" }); return;
		case 0xFA: this.post({ type: "midiStart" }); return;
		case 0xFB: this.post({ type: "midiContinue" }); return;
		case 0xFC: this.post({ type: "midiStop" }); return;
	}
	if(st >= 0xF0)
		return;

	var cmd = st & 0xF0;
	if(cmd == 0x90 && data[2] > 0)
		this.noteOn( data[1] );
	else if(cmd == 0x80 || cmd == 0x90)
		this.noteOff( data[1] );
	else if(cmd == 0xE0)
	{
		var bend = ((data[2] << 7) | data[1]) - 8192;
		this.post({ type: "bend", value: (bend / 8192) * (2 / 12) }); // +-2 semitones
	}
	else if(cmd == 0xB0 && (data[1] == 123 || data[1] == 120))
		this.allNotesOff();
}

// ---- keys device: every note source (MIDI device, on-screen keys, computer keyboard) ends here ----
// The full keyboard feeds the MIDI output (last note priority) and the TRIG output (a pulse on every
// key press, whatever the split). Each zone of the split keyboard
// feeds its own KEY (1V/oct, C4 = 0V) and GATE outputs; without split both zones carry all notes.

WRContext.prototype.noteZone = function( note )
{
	var kb = this.settings.kb;
	return kb.split && note >= kb.split_note ? 1 : 0;
}

WRContext.prototype.noteOn = function( note )
{
	var k = this.keys;
	if(k.held[ note ] !== undefined)
		return;
	var zone = this.noteZone( note );
	k.held[ note ] = zone;
	k.all.push( note );
	this.post({ type: "kbTrig" });
	this.post({ type: "midi", pitch: (note - 60) / 12, gate: true, retrigger: true });
	this.pushZone( zone, note );
	if(!this.settings.kb.split)
		this.pushZone( 1, note );
}

WRContext.prototype.noteOff = function( note )
{
	var k = this.keys;
	var zone = k.held[ note ];
	if(zone === undefined)
		return;
	delete k.held[ note ];
	k.all = k.all.filter(function(n){ return n != note; });
	if(k.all.length)
		this.post({ type: "midi", pitch: (k.all[k.all.length - 1] - 60) / 12, gate: true, retrigger: false });
	else
		this.post({ type: "midi", gate: false });
	this.popZone( zone, note );
	if(k.zones[1].indexOf( note ) != -1)
		this.popZone( 1, note );
}

WRContext.prototype.pushZone = function( zone, note )
{
	var z = this.keys.zones[ zone ];
	z.push( note );
	this.post({ type: "kb", zone: zone, key: (note - 60) / 12, gate: true });
}

WRContext.prototype.popZone = function( zone, note )
{
	var z = this.keys.zones[ zone ] = this.keys.zones[ zone ].filter(function(n){ return n != note; });
	if(z.length)
		this.post({ type: "kb", zone: zone, key: (z[z.length - 1] - 60) / 12, gate: true });
	else
		this.post({ type: "kb", zone: zone, gate: false });
}

WRContext.prototype.allNotesOff = function()
{
	Object.keys( this.keys.held ).forEach(function(n){ this.noteOff( Number(n) ); }, this);
	this.keys = { held: {}, all: [], zones: [[], []] };
	this.post({ type: "midi", gate: false });
	this.post({ type: "kb", zone: 0, gate: false });
	this.post({ type: "kb", zone: 1, gate: false });
}

// ---- helpers ----

function freqToNoteName( freq )
{
	if(!(freq > 0))
		return "";
	var names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
	var midi = 69 + 12 * Math.log2( freq / 440 );
	var n = Math.round( midi );
	var cents = Math.round( (midi - n) * 100 );
	var name = names[ ((n % 12) + 12) % 12 ] + (Math.floor(n / 12) - 1);
	if(cents)
		name += (cents > 0 ? " +" : " ") + cents + "c";
	return name;
}
