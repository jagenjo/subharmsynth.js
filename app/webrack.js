// webrack.js
// The rack: the audio I/O and keys rows on top, then a column of modules (synths, mixers, LFOs,
// compressors, reverbs, delays) with one patch bay across all of them, front (CV) and back (audio).
// This is the main thread side: settings, module list, patches (presets), the audio graph with the
// native nodes of some modules, audio I/O, Scala scales, Web MIDI and the keys. The modules register
// themselves from devices/*.js (panel, jacks, defaults) and devices/*-worklet.js (DSP); all DSP runs
// in one AudioWorkletProcessor (rack-worklet.js) hosting them.

var C4_FREQ = 261.6255653005986;

var WR = {
	types: {},   // registered synths: type -> definition (see WR.registerSynth)
	order: []
};

WR.VERSION = "20261022a"; // bump together with the ?v= in index.html so browsers reload the scripts

// def: {
//   title, description,           names for menus and the panel
//   category                      group in the Add device menu ("Synths" when missing)
//   half                          half the rack's width: two in a row side by side
//   max                           how many fit in a rack
//   rear_jacks                    audio sockets on the back: [label, "ain"|"aout", id]
//   audio_out                     id of its main audio output socket (routed when it is added)
//   audio_out_r                   a stereo synth's right output (routed to the R of the same pair)
//   native { build(ctx), update(graph, s, rack) }  DSP in native nodes, fed by a send / return slot
//   rear_note(s)                  what the rear label says about its audio
//   worklet,                      DSP file, registers globalThis.WR_DSP[type]
//   jacks,                        patch bay rows of [label, "in"|"out"|"midiin", id]
//   midi_in,                      id of its MIDI IN jack, if it has one
//   onState( module, state ),     called with each state its DSP reports
//   knob_skin,                    its knobs' style by default (code.js: KNOB_SKIN_NAMES)
//   insert,                       an effect (in_l / in_r / out_l / out_r) put in before the speakers when added
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
	// a MIDI IN is on the back, with the MASTER MIDI switch (the keys' MIDI without a cable) and the
	// channel it listens to (0 = OMNI, all of them)
	if(def.midi_in)
	{
		var defaults = def.defaults;
		def.defaults = function() { var s = defaults(); s.midi_master = false; s.midi_channel = 0; return s; };
		def.rear_jacks = (def.rear_jacks || []).concat([[ "MIDI IN", "midiin", def.midi_in ]]);
	}
	WR.types[ type ] = def;
	WR.order.push( type );
}

// patch bay ids: the rack's own jacks are plain, a module's are prefixed with its id
WR.jackId = function( module_id, id ) { return module_id + "." + id; }
// knob styles a device can have (code.js draws them); "" = the device's own default
WR.KNOB_SKINS = ["", "aluminium", "classic", "lm", "chrome", "cream", "soft", "ledring", "greycap", "flat"];

// audio sockets on the back of the audio I/O row (line level, "ain" / "aout"): patched like the
// front jacks, but only with each other. An audio input sums every cable plugged into it
WR.REAR_JACKS = {
	keys: [["MIDI OUT","midiout","kb_midi"]], // every note: the MIDI device, the on-screen keys, the QWERTY keys, the song
	io: [["MAIN IN L","ain","io_main_l"], ["MAIN IN R","ain","io_main_r"], ["INPUT L","aout","io_input_l"], ["INPUT R","aout","io_input_r"]]
};
// the default audio path after the synths: compressor -> delay -> reverb -> speakers (L red, R white)
WR.AUDIO_CHAIN = [
	["comp.out_l", "delay.in_l", 1], ["comp.out_r", "delay.in_r", 5],
	["delay.out_l", "reverb.in_l", 1], ["delay.out_r", "reverb.in_r", 5],
	["reverb.out_l", "io_main_l", 1], ["reverb.out_r", "io_main_r", 5]
];
WR.SLOTS = 8; // send / return slots of the rack processor, for the modules with native DSP

// audio I/O device: the audio interface input as patchable signals (+-5V)
WR.IO_JACKS = [
	[["IN L","out","in_l"], ["IN R","out","in_r"]]
];
WR.KB_JACKS = [
	[["GATE 1","out","kb_gate1"], ["KEY 1","out","kb_key1"], ["GATE 2","out","kb_gate2"], ["KEY 2","out","kb_key2"], ["TRIG","out","kb_trig"]]
];

function WRContext()
{
	this.context = null;
	this.node = null;
	this.settings = WRContext.defaultSettings();
	this.module_state = {}; // module id -> state reported by its DSP
	this.native = {};       // module id -> its native nodes (modules with def.native)
	this.custom_scale = null; // { file, description, degrees, period }
	this.midi = { access: null, inputs: [], selected: "all", activity: 0, status: "off" };
	this.keys = { held: {}, channel: {}, all: [], zones: [[], []] }; // held: note -> zone, channel: note -> MIDI channel
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

// ---- the song: the bottom bar's multitrack sequencer, saved with the patch ----
// notes: [start, length (beats), MIDI note, velocity 0..1]; each track plays on its MIDI channel
WR.SONG_GRIDS = [1, 2, 4, 8]; // grid divisions of a beat: 1/4, 1/8, 1/16, 1/32 notes

WR.defaultSong = function()
{
	return { bpm: 120, bars: 4, loop: true, grid: 4, clock: false, sel: 0,
		tracks: [{ name: "TRACK 1", channel: 1, mute: false, solo: false, notes: [] }] };
}

// a short arpeggio for new racks, so PLAY has something to play
WR.demoSong = function()
{
	var song = WR.defaultSong(), notes = song.tracks[0].notes;
	var arp = [48, 51, 55, 58, 60, 58, 55, 51], roots = [0, 0, -4, -2];
	for(var bar = 0; bar < 4; ++bar)
		for(var i = 0; i < 8; ++i)
			notes.push([ bar * 4 + i * 0.5, 0.45, arp[i] + roots[bar], i % 4 == 0 ? 1 : 0.7 ]);
	return song;
}

WR.validateSong = function( data )
{
	var def = WR.defaultSong();
	var s = WR.mergeValid({ bpm: def.bpm, bars: def.bars, loop: def.loop, grid: def.grid, clock: def.clock, sel: def.sel },
		data && typeof data == "object" ? data : {} );
	s.bpm = Math.min( 300, Math.max( 20, s.bpm ) );
	s.bars = Math.min( 64, Math.max( 1, Math.round( s.bars ) ) );
	if(WR.SONG_GRIDS.indexOf( s.grid ) == -1)
		s.grid = 4;
	var tracks = data && Array.isArray(data.tracks) ? data.tracks : def.tracks;
	s.tracks = tracks.slice( 0, 16 ).filter(function(t){ return t && typeof t == "object"; }).map(function(t, i){
		if(t.type == "cv") // a knob's movements: [beat, 0..1] points, sorted
			return {
				type: "cv",
				name: typeof t.name == "string" && t.name.trim() ? t.name.trim().substr( 0, 24 ).toUpperCase() : "CV " + (i + 1),
				target: typeof t.target == "string" ? t.target.substr( 0, 120 ) : "",
				channel: 1, mute: !!t.mute, solo: false, notes: [],
				points: (Array.isArray(t.points) ? t.points : []).filter(function(p){
					return Array.isArray(p) && typeof p[0] == "number" && isFinite(p[0]) && typeof p[1] == "number" && isFinite(p[1]);
				}).map(function(p){ return [ Math.max( 0, p[0] ), Math.min( 1, Math.max( 0, p[1] ) ) ]; })
				.sort(function(a, b){ return a[0] - b[0]; }).slice( 0, 8000 )
			};
		return {
			name: typeof t.name == "string" && t.name.trim() ? t.name.trim().substr( 0, 24 ).toUpperCase() : "TRACK " + (i + 1),
			channel: Math.min( 16, Math.max( 1, Math.round( +t.channel || 1 ) ) ),
			mute: !!t.mute, solo: !!t.solo,
			notes: (Array.isArray(t.notes) ? t.notes : []).filter(function(n){
				return Array.isArray(n) && n.length >= 3 && n.slice( 0, 3 ).every(function(v){ return typeof v == "number" && isFinite(v); });
			}).map(function(n){
				return [ Math.max( 0, n[0] ), Math.max( 1 / 64, n[1] ), Math.min( 127, Math.max( 0, Math.round( n[2] ) ) ),
					typeof n[3] == "number" && isFinite(n[3]) ? Math.min( 1, Math.max( 0, n[3] ) ) : 1 ];
			})
		};
	});
	if(!s.tracks.length)
		s.tracks = def.tracks;
	s.sel = Math.min( s.tracks.length - 1, Math.max( 0, Math.round( s.sel ) ) );
	return s;
}

// the rack's own settings (everything but the modules and the cables)
WRContext.rackDefaults = function()
{
	return {
		scale_file: null,
		kb: { split: false, split_note: 60, octave: 0, channel: 1 } // keys device; split_note starts the upper zone; channel
		                                                             // of the on-screen and QWERTY keys
	};
}

// a Subharm, then the LFO and compressor, the reverb and delay, cabled as the default audio path
WRContext.defaultSettings = function()
{
	var s = WRContext.rackDefaults();
	s.version = 5;
	s.modules = [];
	s.patches = []; // [output id, input id, color index]
	["lfo", "comp", "reverb", "delay"].forEach(function(type){ WRContext.addModuleTo( s, type ); });
	s.patches = WR.AUDIO_CHAIN.map(function(c){ return c.slice(); });
	WRContext.addModuleTo( s, "subharm" );
	s.modules.unshift( s.modules.pop() );
	s.song = WR.demoSong();
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
	if(def.midi_in) // new synths with a MIDI IN get the keys' MIDI, through MASTER MIDI (no cable)
		m.settings.midi_master = true;
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
	var outs = s.modules.map(function(o){ var d = WR.types[ o.type ]; return d && d.audio_out ? WR.jackId( o.id, d.audio_out ) : null; });
	var synthAudio = function(id){ return /\.audio$/.test( id ) || outs.indexOf( id ) >= 0; };
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
	if(def.insert) // an effect: goes in just before the speakers
	{
		var outs = { io_main_l: "out_l", io_main_r: "out_r" }, ins = { io_main_l: "in_l", io_main_r: "in_r" };
		var last = s.patches.filter(function(p){ return outs[ p[1] ]; });
		last.forEach(function(p){ s.patches.push([ WR.jackId( m.id, outs[ p[1] ] ), p[1], p[2] ]); p[1] = WR.jackId( m.id, ins[ p[1] ] ); });
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
	var comp = s.modules.find(function(o){ return o.type == "comp"; });
	var dst = other ? other[1] : (comp ? WR.jackId( comp.id, "in_l" ) : "io_main_l");
	s.patches.push([ src, dst, color ]);
	// a stereo synth: its right output into the R of the same pair
	if(def.audio_out_r && /_l$/.test( dst ))
		s.patches.push([ WR.jackId( m.id, def.audio_out_r ), dst.replace(/_l$/, "_r"), color ]);
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
	var loaded = {}; // two types can share a file (the custom synths: full and half width)
	WR.order.forEach(function(type){
		var file = WR.types[type].worklet;
		if(loaded[ file ]) return;
		loaded[ file ] = true;
		load = load.then(function(){ return ctx.audioWorklet.addModule( file + v ); });
	});
	this._initializing = load.then(function(){ return ctx.audioWorklet.addModule( "rack-worklet.js" + v ); }).then(function(){
		var node = that.node = new AudioWorkletNode( ctx, "webrack", {
			numberOfInputs: 1 + WR.SLOTS, numberOfOutputs: 1 + WR.SLOTS,
			outputChannelCount: new Array( 1 + WR.SLOTS ).fill( 2 ),
			channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers"
		});
		node.port.onmessage = function(e) {
			if(e.data.type == "state")
				that.onState( e.data.modules );
		};

		that.buildMaster( ctx, node );
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
	this.post({ type: "settings", settings: this.settings, tempo: this.tempo() });
	this.updateNative();
}

// a state report from the processor: kept for the panels, and given to the devices that act on it
// (def.onState( module, state ), e.g. hits recorded by a drum machine's sequencer)
WRContext.prototype.onState = function( states )
{
	this.module_state = states;
	this.settings.modules.forEach(function(m){
		var def = WR.types[ m.type ];
		if(def && def.onState && states[ m.id ])
			def.onState( m, states[ m.id ] );
	});
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

// null when the rack already has as many as the device allows
WRContext.prototype.addModule = function( type )
{
	var def = WR.types[ type ];
	if(def.max && this.settings.modules.filter(function(m){ return m.type == type; }).length >= def.max)
		return null;
	var m = WRContext.addModuleTo( this.settings, type );
	this.module_state[ m.id ] = null;
	return m;
}

// which audio inputs pass to which outputs, to cable around a device when it is removed: an effect's
// IN L / R -> OUT L / R, a mixer's channels -> MAIN L / R. null for devices that make their own sound
WR.audioThru = function( def )
{
	if(def.thru)
		return def.thru;
	if(def.mixer)
	{
		var chans = [];
		for(var k = 1; k <= def.channels; ++k) chans.push( "in" + k );
		return { L: chans, R: [], outL: "main_l", outR: "main_r" };
	}
	var has = function(id){ return (def.rear_jacks || []).some(function(j){ return j && j[2] == id; }); };
	if(has( "in_l" ) && has( "out_l" ))
		return { L: ["in_l"], R: has( "in_r" ) ? ["in_r"] : [], outL: "out_l", outR: has( "out_r" ) ? "out_r" : null };
	return null;
}

// before removing module `id` from settings `s`: what came into it goes on to where it went, so the
// audio path stays whole. An unpatched IN R takes IN L (as the sockets do), and is left to the
// receiving socket's own normalling when that is the R of the same pair
WRContext.bridgeAudio = function( s, id )
{
	var m = s.modules.find(function(o){ return o.id == id; });
	var thru = m && WR.types[ m.type ] ? WR.audioThru( WR.types[ m.type ] ) : null;
	if(!thru)
		return;
	var prefix = id + ".";
	var J = function(j){ return WR.jackId( id, j ); };
	var sources = function(ins){ return s.patches.filter(function(p){ return ins.some(function(j){ return p[1] == J( j ); }) && p[0].indexOf( prefix ) != 0; }); };
	var srcL = sources( thru.L ), srcR = sources( thru.R ), normalled = !srcR.length;
	if(normalled) srcR = srcL;
	var dests = function(out){ return out ? s.patches.filter(function(p){ return p[0] == J( out ) && p[1].indexOf( prefix ) != 0; }).map(function(p){ return p[1]; }) : []; };
	var dL = dests( thru.outL ), dR = dests( thru.outR );
	var add = [];
	var connect = function(src, dst){
		if(!s.patches.concat( add ).some(function(p){ return p[0] == src[0] && p[1] == dst; }))
			add.push([ src[0], dst, src[2] ]);
	};
	dL.forEach(function(d){ srcL.forEach(function(src){ connect( src, d ); }); });
	dR.forEach(function(d){
		// R of the same pair as a left destination, nothing else in it: it will take its L by itself
		var pairL = d.replace(/_r$/, "_l");
		var others = s.patches.some(function(p){ return p[1] == d && p[0].indexOf( prefix ) != 0; });
		if(normalled && pairL != d && dL.indexOf( pairL ) != -1 && !others)
			return;
		srcR.forEach(function(src){ connect( src, d ); });
	});
	s.patches = s.patches.concat( add );
}

WRContext.prototype.removeModule = function( id )
{
	var prefix = id + ".";
	WRContext.bridgeAudio( this.settings, id );
	this.settings.modules = this.settings.modules.filter(function(m){ return m.id != id; });
	this.settings.patches = this.settings.patches.filter(function(p){ return p[0].indexOf( prefix ) != 0 && p[1].indexOf( prefix ) != 0; });
	delete this.module_state[ id ];
}

// the rows of the rack: [{ mods: [module] or [left, right], half }]. Half width devices share a row
// when they are next to each other in the list
WR.rows = function( modules )
{
	var rows = [];
	modules.forEach(function(m){
		var half = !!WR.types[ m.type ].half;
		var last = rows[ rows.length - 1 ];
		if(half && last && last.half && last.mods.length == 1)
			last.mods.push( m );
		else
			rows.push({ mods: [m], half: half });
	});
	return rows;
}

// one place up (dir -1) or down (1). A full width device jumps over a whole row: past both devices
// of a half width pair, which stays together
WRContext.prototype.moveModule = function( id, dir )
{
	var list = this.settings.modules;
	var i = list.findIndex(function(m){ return m.id == id; });
	if(i < 0)
		return;
	var m = list[i];
	if(!WR.types[ m.type ].half)
	{
		var rows = WR.rows( list );
		var r = rows.findIndex(function(row){ return row.mods[0] === m; });
		var other = rows[ r + dir ];
		if(!other)
			return;
		rows[ r + dir ] = rows[r];
		rows[r] = other;
		this.settings.modules = [].concat.apply( [], rows.map(function(row){ return row.mods; }) );
		return;
	}
	var j = i + dir;
	if(j < 0 || j >= list.length)
		return;
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

// BPM of the first module with a clock, for tempo synced delays
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
	WR.KB_JACKS.concat( WR.IO_JACKS ).forEach(function(row){
		row.forEach(function(j){ types[ j[2] ] = j[1]; });
	});
	for(var dev in WR.REAR_JACKS)
		WR.REAR_JACKS[dev].forEach(function(j){ types[ j[2] ] = j[1]; });
	modules.forEach(function(m){
		var def = WR.types[ m.type ];
		def.jacks.concat([ def.rear_jacks || [] ]).forEach(function(row){
			row.forEach(function(j){ if(j) types[ WR.jackId( m.id, j[2] ) ] = j[1]; }); // null: an empty place
		});
	});
	return types;
}

// ---- audio graph ----
// The rack processor's output 0 goes to the master volume, the speakers and the meters. The modules
// with native DSP (reverbs) get a send / return slot each, in rack order (as the processor does):
//   processor output k -> module's nodes -> DelayNode -> processor input k
// A loop through the processor needs that DelayNode (it adds a render quantum)

WRContext.prototype.buildMaster = function( ctx, node )
{
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
}

// builds, moves and updates the native nodes of the modules that have them
WRContext.prototype.updateNative = function()
{
	if(!this.node || !this.master) // the audio graph is built
		return;
	var that = this, ctx = this.context, slot = 0, seen = {};
	this.settings.modules.forEach(function(m){
		var def = WR.types[ m.type ];
		if(!def.native || slot >= WR.SLOTS)
			return;
		var k = 1 + slot++;
		var g = that.native[ m.id ];
		if(g && g.type != m.type)
		{
			that.dropNative( m.id );
			g = null;
		}
		if(!g)
		{
			g = that.native[ m.id ] = def.native.build( ctx );
			g.type = m.type;
			g.slot = -1;
			g.loop = ctx.createDelay( 0.1 );
			g.loop.delayTime.value = 0;
			g.output.connect( g.loop );
		}
		if(g.slot != k) // new, or the modules were reordered
		{
			if(g.slot > 0)
			{
				that.node.disconnect( g.input, g.slot );
				g.loop.disconnect();
			}
			that.node.connect( g.input, k );
			g.loop.connect( that.node, 0, k );
			g.slot = k;
		}
		seen[ m.id ] = true;
		def.native.update( g, m.settings, that );
	});
	for(var id in this.native)
		if(!seen[id])
			this.dropNative( id );
}

WRContext.prototype.dropNative = function( id )
{
	var g = this.native[id];
	try { this.node.disconnect( g.input ); } catch(err) {}
	g.loop.disconnect();
	g.output.disconnect();
	delete this.native[id];
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

// EXPORT WAV: records the master output from now; recordStop() resolves { sampleRate, L, R, peak }
WRContext.prototype.recordStart = function()
{
	var ctx = this.context;
	if(!this.recorder)
	{
		this.recorder = new AudioWorkletNode( ctx, "webrack-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
			channelCount: 2, channelCountMode: "explicit" } );
		var mute = ctx.createGain(); // pulled by the destination, heard by nobody
		mute.gain.value = 0;
		this.master.connect( this.recorder );
		this.recorder.connect( mute );
		mute.connect( ctx.destination );
	}
	var rec = this._rec = { chunks: [], frames: 0, peak: 0, lastLoud: 0, done: null };
	this.recorder.port.onmessage = function(e){
		var m = e.data;
		if(m.type == "chunk")
		{
			var p = 0;
			for(var i = 0; i < m.L.length; ++i) p = Math.max( p, Math.abs( m.L[i] ), Math.abs( m.R[i] ) );
			rec.chunks.push( m );
			rec.frames += m.L.length;
			rec.peak = Math.max( rec.peak, p );
			if(p > 0.0005) rec.lastLoud = rec.frames; // -66 dB: the tail still rings
		}
		else if(m.type == "done" && rec.done)
			rec.done();
	};
	this.recorder.port.postMessage( "start" );
	return rec;
}

// minFrames: kept even if silent (the song); after it, the silent end is cut (0.1 s left)
WRContext.prototype.recordStop = function( minFrames )
{
	var rec = this._rec, recorder = this.recorder, sr = this.context.sampleRate;
	return new Promise(function(resolve){
		rec.done = function(){
			var n = Math.min( rec.frames, Math.max( minFrames || 0, rec.lastLoud + Math.round( sr * 0.1 ) ) );
			var L = new Float32Array( n ), R = new Float32Array( n ), o = 0;
			rec.chunks.forEach(function(c){
				if(o >= n) return;
				var k = Math.min( c.L.length, n - o );
				L.set( c.L.subarray( 0, k ), o ); R.set( c.R.subarray( 0, k ), o );
				o += k;
			});
			resolve({ sampleRate: sr, L: L, R: R, peak: rec.peak });
		};
		recorder.port.postMessage( "stop" );
	});
}

// a stereo 16-bit WAV file of two channels (-1..1)
WR.encodeWav = function( L, R, sampleRate )
{
	var n = L.length, buf = new ArrayBuffer( 44 + n * 4 ), v = new DataView( buf );
	var str = function(o, t){ for(var i = 0; i < t.length; ++i) v.setUint8( o + i, t.charCodeAt( i ) ); };
	str( 0, "RIFF" ); v.setUint32( 4, 36 + n * 4, true ); str( 8, "WAVE" );
	str( 12, "fmt " ); v.setUint32( 16, 16, true ); v.setUint16( 20, 1, true ); v.setUint16( 22, 2, true );
	v.setUint32( 24, sampleRate, true ); v.setUint32( 28, sampleRate * 4, true ); v.setUint16( 32, 4, true ); v.setUint16( 34, 16, true );
	str( 36, "data" ); v.setUint32( 40, n * 4, true );
	for(var i = 0, o = 44; i < n; ++i, o += 4)
	{
		v.setInt16( o, Math.round( Math.max( -1, Math.min( 1, L[i] ) ) * 32767 ), true );
		v.setInt16( o + 2, Math.round( Math.max( -1, Math.min( 1, R[i] ) ) * 32767 ), true );
	}
	return buf;
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
	var type = WRContext.jackTypes( this.settings.modules )[ in_id ];
	var audio = type == "ain";
	if(type == "midiin") // a MIDI cable takes over from MASTER MIDI
		this.setMidiMaster( in_id.substr( 0, in_id.indexOf(".") ), false );
	for(var i = patches.length - 1; i >= 0; --i)
		if(patches[i][1] == in_id && (!audio || patches[i][0] == out_id))
			patches.splice(i,1); // a CV input takes a single cable, an audio input adds them up
	patches.push([ out_id, in_id, color || 0 ]);
}

// MASTER MIDI of a module: on, it gets the keys' MIDI without a cable (its MIDI IN cable is unplugged)
WRContext.prototype.setMidiMaster = function( module_id, on )
{
	var m = this.settings.modules.find(function(m){ return m.id == module_id; });
	var def = m && WR.types[ m.type ];
	if(!def || !def.midi_in)
		return;
	m.settings.midi_master = !!on;
	if(on)
	{
		var jack = WR.jackId( module_id, def.midi_in );
		this.settings.patches = this.settings.patches.filter(function(p){ return p[1] != jack; });
	}
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

// saves from before the rack (version 2 and older) are a single SUBHARM with the shared
// devices in the same object: they become a rack with one "subharm" module
WR.migrateV2 = function( data )
{
	var r = { version: 3, modules: [{ id: "subharm", type: "subharm", settings: data }] };
	["reverb", "fx", "scale_file", "lfo", "comp", "scope", "kb"].forEach(function(k){
		if(k in data)
			r[k] = data[k];
	});
	var ids = {};
	var subharm = WR.types.subharm;
	subharm.jacks.concat([ subharm.rear_jacks || [] ]).forEach(function(row){ row.forEach(function(j){ if(j) ids[ j[2] ] = true; }); });
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

// saves from before the LFO, compressor, reverb and delay were modules (version 3 and 4): they had a
// single one of each, set at the rack level. They become modules "lfo", "comp", "reverb" and "delay"
// after the synths, and their jacks get those modules' ids
WR.MIGRATE_V4_JACKS = {
	lfo1_rate: "lfo.rate1", lfo2_rate: "lfo.rate2", lfo1_sync: "lfo.sync1", lfo2_sync: "lfo.sync2", lfo1: "lfo.lfo1", lfo2: "lfo.lfo2",
	comp_sc: "comp.sidechain", comp_gr: "comp.gr", scope_in: "comp.scope",
	comp_in_l: "comp.in_l", comp_in_r: "comp.in_r", comp_out_l: "comp.out_l", comp_out_r: "comp.out_r",
	delay_in_l: "delay.in_l", delay_in_r: "delay.in_r", delay_out_l: "delay.out_l", delay_out_r: "delay.out_r",
	reverb_in_l: "reverb.in_l", reverb_in_r: "reverb.in_r", reverb_out_l: "reverb.out_l", reverb_out_r: "reverb.out_r"
};

WR.migrateV4 = function( data )
{
	var fx = data.fx && typeof data.fx == "object" ? data.fx : {};
	var comp = data.comp && typeof data.comp == "object" ? data.comp : {};
	var modules = (Array.isArray(data.modules) ? data.modules : []).concat([
		{ id: "lfo", type: "lfo", settings: { lfo: data.lfo } },
		{ id: "comp", type: "comp", settings: { on: comp.on, threshold: comp.threshold, ratio: comp.ratio, attack: comp.attack,
			release: comp.release, makeup: comp.makeup, mix: comp.mix, scope_time: data.scope && data.scope.time } },
		{ id: "reverb", type: "reverb", settings: { on: fx.reverb_on, mix: data.reverb, room: fx.reverb_room, predelay: fx.reverb_predelay,
			tone: fx.reverb_tone, dry: fx.reverb_dry } },
		{ id: "delay", type: "delay", settings: { on: fx.delay_on, sync: fx.delay_sync, div: fx.delay_div, time: fx.delay_time,
			feedback: fx.delay_feedback, tone: fx.delay_tone, mix: fx.delay_mix, pingpong: fx.delay_pingpong, dry: fx.delay_dry } }
	]);
	var patches = (Array.isArray(data.patches) ? data.patches : []).map(function(p){
		if(!Array.isArray(p))
			return p;
		return p.map(function(id, k){ return k < 2 && WR.MIGRATE_V4_JACKS[id] ? WR.MIGRATE_V4_JACKS[id] : id; });
	});
	return { version: 5, modules: modules, patches: patches, scale_file: data.scale_file, kb: data.kb,
		add_audio: !(data.version >= 4) }; // from before the rear sockets: cable the old fixed audio path
}

// devices that were renamed: older saves have the old type, module ids and jacks (legacy ids, kept to load them)
WR.RENAMED_TYPES = { dfam: "dram", mother32: "brother32", labyrinth: "maze", hydra: "mystic" };

WR.migrateRenamed = function( data )
{
	var mods = Array.isArray(data.modules) ? data.modules : [];
	if(!mods.some(function(m){ return m && WR.RENAMED_TYPES[ m.type ]; }))
		return data;
	var taken = {}, rename = {};
	mods.forEach(function(m){ if(m && typeof m.id == "string") taken[ m.id ] = true; });
	var modules = mods.map(function(m){
		var type = m && WR.RENAMED_TYPES[ m.type ];
		if(!type)
			return m;
		var id = m.id;
		if(typeof id == "string" && id.indexOf( m.type ) == 0)
		{
			var nid = type + id.substr( m.type.length );
			if(!taken[ nid ])
			{
				rename[id] = nid;
				id = nid;
			}
		}
		var r = {};
		for(var k in m) r[k] = m[k];
		r.type = type;
		r.id = id;
		return r;
	});
	var patches = (Array.isArray(data.patches) ? data.patches : []).map(function(p){
		if(!Array.isArray(p))
			return p;
		return p.map(function(id, k){
			var dot = k < 2 && typeof id == "string" ? id.indexOf(".") : -1;
			return dot > 0 && rename[ id.substr( 0, dot ) ] ? rename[ id.substr( 0, dot ) ] + id.substr( dot ) : id;
		});
	});
	var r = {};
	for(var k in data) r[k] = data[k];
	r.modules = modules;
	r.patches = patches;
	return r;
}

WRContext.prototype.setSettings = function( data )
{
	data = data || {};
	if(!(data.version >= 3))
		data = WR.migrateV2( data );
	if(!(data.version >= 5))
		data = WR.migrateV4( data );
	data = WR.migrateRenamed( data );
	var add_audio = !!data.add_audio;
	var s = WR.mergeValid( WRContext.rackDefaults(), data );
	s.version = 5;
	s.scale_file = typeof data.scale_file == "string" ? data.scale_file : null;
	s.kb.split_note = Math.min( 96, Math.max( 24, Math.round( s.kb.split_note ) ) );
	s.kb.octave = Math.min( 2, Math.max( -2, Math.round( s.kb.octave ) ) );
	s.kb.channel = Math.min( 16, Math.max( 1, Math.round( s.kb.channel ) ) );
	s.song = WR.validateSong( data.song );
	// MIDI learn: [kind ("cc" / "note"), channel 1..16, number 0..127, control id]
	s.midi_map = (Array.isArray( data.midi_map ) ? data.midi_map : []).filter(function(m){
		return Array.isArray( m ) && (m[0] == "cc" || m[0] == "note") && m[1] >= 1 && m[1] <= 16 && m[2] >= 0 && m[2] <= 127 && typeof m[3] == "string" && m[3].length < 120;
	}).map(function(m){ return [ m[0], m[1] | 0, m[2] | 0, m[3] ]; }).slice( 0, 512 );

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
		if(raw.knob_skin && WR.KNOB_SKINS.indexOf( raw.knob_skin ) > 0) // the device's knob style, if not its default
			ms.knob_skin = raw.knob_skin;
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
		s.modules.forEach(function(m){ WRContext.routeAudio( s, m ); });
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
	return JSON.stringify({ format: WRContext.PATCH_FORMAT, version: 5, name: name || "", settings: this.settings }, null, "\t");
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

// new random sound on every synth and LFO; volumes, effects, cables and the scale are kept
WRContext.prototype.randomize = function()
{
	var that = this;
	this.settings.modules.forEach(function(m){
		var def = WR.types[ m.type ];
		if(def.randomize)
			def.randomize( m.settings, that );
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
		if(window.gfTrack) gfTrack( "midi-on", { inputs: access.inputs.size }, true );
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

	var cmd = st & 0xF0, channel = (st & 0x0F) + 1;
	// MIDI learn: a CC or note mapped to a knob or button (or being learnt) goes there instead
	if((cmd == 0xB0 || cmd == 0x90 || cmd == 0x80) && WR.midiControl && WR.midiControl( cmd, channel, data[1], data[2] ))
		return;
	if(cmd == 0x90 && data[2] > 0)
		this.noteOn( data[1], channel, data[2] / 127 );
	else if(cmd == 0x80 || cmd == 0x90)
		this.noteOff( data[1], channel );
	else if(cmd == 0xE0)
	{
		var bend = ((data[2] << 7) | data[1]) - 8192;
		this.post({ type: "bend", channel: channel, value: (bend / 8192) * (2 / 12) }); // +-2 semitones
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

// channel: 1..16, the keys device's own channel when missing (on-screen and QWERTY keys)
WRContext.prototype.noteOn = function( note, channel, velocity )
{
	var k = this.keys;
	if(k.held[ note ] !== undefined)
		return;
	channel = channel || this.settings.kb.channel;
	var zone = this.noteZone( note );
	k.held[ note ] = zone;
	k.channel[ note ] = channel;
	k.all.push( note );
	this.post({ type: "kbTrig" });
	this.post({ type: "note", channel: channel, note: note, on: true, vel: velocity === undefined ? 1 : velocity });
	if(this.onnote)
		this.onnote( note, true, channel, velocity === undefined ? 1 : velocity );
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
	var channel = k.channel[ note ];
	delete k.held[ note ];
	delete k.channel[ note ];
	k.all = k.all.filter(function(n){ return n != note; });
	this.post({ type: "note", channel: channel, note: note, on: false });
	if(this.onnote)
		this.onnote( note, false, channel );
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
	this.keys = { held: {}, channel: {}, all: [], zones: [[], []] };
	this.post({ type: "notesOff" });
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
