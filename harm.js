// harm.js
// Subharmonicon controller: panel settings, patch bay definition, audio graph,
// Scala scales and Web MIDI. The DSP itself lives in harm-worklet.js.

var C4_FREQ = 261.6255653005986;

function Harm()
{
	this.context = null;
	this.node = null;
	this.settings = Harm.defaultSettings();
	this.state = {
		playing: false, step: [0,0], rhythm: [false,false,false,false], clock: false,
		clock_source: "internal", freq: [0,0], div: [[1,1],[1,1]], vca_eg: 0, vcf_eg: 0, lfo: [0,0], comp_gr: 0
	};
	this.custom_scale = null; // { file, description, degrees, period }
	this.midi = { access: null, inputs: [], selected: "all", activity: 0, status: "off" };
	this.keys = { held: {}, all: [], zones: [[], []] }; // held: note -> zone
	this.onmidichange = null;
	this._sent = null;
	this._initializing = null;
}

Harm.STORAGE_KEY = "SUBHARM_state_v2";

Harm.defaultSettings = function()
{
	return {
		version: 2,
		vco: [
			// freq: VCO FREQ knob, C4 to C8. wave: "square" (up), "pwm" (middle), "saw" (down)
			{ freq: 261.63, wave: "saw", sub1: 2, sub2: 4, level: 0.55, sub1_level: 0.6, sub2_level: 0.45 },
			{ freq: 392.00, wave: "square", sub1: 4, sub2: 6, level: 0.35, sub1_level: 0.4, sub2_level: 0.3 }
		],
		seq: [
			[0, 3/12, 5/12, 7/12],
			[0, -3/12, 2/12, -1/12]
		],
		seq_assign: [
			{ osc: true, sub1: false, sub2: false },
			{ osc: true, sub1: false, sub2: false }
		],
		seq_oct: 1,         // +-1, +-2 or +-5 octaves
		quantize: "12-ET",  // OFF, 12-ET, 8-ET, 12-JI, 8-JI, SCL (custom Scala scale)
		tempo: 300,
		rhythm: [2, 3, 5, 7],
		rhythm_seq1: [true, false, true, false],
		rhythm_seq2: [false, true, false, true],
		cutoff: 900,
		resonance: 0.35,
		vcf_eg_amt: 0.45,
		vcf_attack: 0.004,
		vcf_decay: 0.35,
		vca_attack: 0.004,
		vca_decay: 0.6,
		volume: 0.7,
		eg_hold: false,     // EG button: envelopes locked at maximum (drone)
		reverb: 0.15,
		scale_file: null,
		// extra devices below the panel
		lfo: [
			{ rate: 0.5, shape: "sine", level: 1 },  // rate in Hz, level scales the +-5V output
			{ rate: 4, shape: "tri", level: 0.5 }
		],
		comp: { on: true, threshold: -12, ratio: 3, attack: 0.005, release: 0.12, makeup: 0, mix: 1 }, // dB / s
		kb: { split: false, split_note: 60, octave: 0 }, // keys device; split_note starts the upper zone
		patches: [["kb_midi", "midi_in", 5]] // [output id, input id, color index]
	};
}

// patch bay, 4 columns x 8 rows, same layout as the hardware
Harm.JACKS = [
	[["VCO 1","in","vco1_in"], ["VCO 1 SUB","in","vco1_sub_in"], ["VCO 1 PWM","in","vco1_pwm"], ["VCA","out","vca"]],
	[["VCO 1","out","vco1"], ["VCO 1 SUB 1","out","vco1_sub1"], ["VCO 1 SUB 2","out","vco1_sub2"], ["VCA","in","vca_in"]],
	[["VCO 2","in","vco2_in"], ["VCO 2 SUB","in","vco2_sub_in"], ["VCO 2 PWM","in","vco2_pwm"], ["VCA EG","out","vca_eg"]],
	[["VCO 2","out","vco2"], ["VCO 2 SUB 1","out","vco2_sub1"], ["VCO 2 SUB 2","out","vco2_sub2"], ["CUTOFF","in","cutoff_in"]],
	[["PLAY","in","play_in"], ["RESET","in","reset_in"], ["TRIGGER","in","trigger_in"], ["VCF EG","out","vcf_eg"]],
	[["RHYTHM 1","in","rhythm1_in"], ["RHYTHM 2","in","rhythm2_in"], ["RHYTHM 3","in","rhythm3_in"], ["RHYTHM 4","in","rhythm4_in"]],
	[["SEQ 1","out","seq1"], ["SEQ 1 CLK","out","seq1_clk"], ["SEQ 2","out","seq2"], ["SEQ 2 CLK","out","seq2_clk"]],
	[["MIDI IN","midiin","midi_in"], ["CLOCK","in","clock_in"], ["CLOCK","out","clock_out"], ["TRIGGER","out","trigger_out"]]
];

Harm.VCO_MIN_FREQ = 261.63; // VCO FREQ knob range is C4..C8
Harm.VCO_MAX_FREQ = 4186.0;
Harm.TEMPO_MIN = 20;         // 0.333Hz..50Hz at 1 ppq
Harm.TEMPO_MAX = 3000;

// jacks of the devices below the panel
Harm.LFO_JACKS = [
	[["RATE 1","in","lfo1_rate"], ["RATE 2","in","lfo2_rate"]],
	[["SYNC 1","in","lfo1_sync"], ["SYNC 2","in","lfo2_sync"]],
	[["LFO 1","out","lfo1"], ["LFO 2","out","lfo2"]]
];
Harm.COMP_JACKS = [
	[["SIDECHAIN","in","comp_sc"], ["GR","out","comp_gr"]]
];
Harm.KB_JACKS = [
	[["GATE 1","out","kb_gate1"], ["KEY 1","out","kb_key1"], ["GATE 2","out","kb_gate2"], ["KEY 2","out","kb_key2"], ["MIDI","midiout","kb_midi"]]
];
Harm.LFO_SHAPES = ["sine","tri","saw","ramp","square","sh"];

Harm.jackTypes = function()
{
	var types = {};
	Harm.JACKS.concat( Harm.LFO_JACKS, Harm.COMP_JACKS, Harm.KB_JACKS ).forEach(function(row){
		row.forEach(function(j){ types[ j[2] ] = j[1]; });
	});
	return types;
}

Harm.QUANTIZE_MODES = ["OFF","12-ET","8-ET","12-JI","8-JI","SCL"];

Harm.prototype.init = function()
{
	if(this._initializing)
		return this._initializing;
	var that = this;
	var ctx = this.context = new AudioContext({ latencyHint: "interactive" });
	this._initializing = ctx.audioWorklet.addModule("harm-worklet.js").then(function(){
		var node = that.node = new AudioWorkletNode( ctx, "subharmonicon", {
			numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
		});
		node.port.onmessage = function(e) {
			if(e.data.type == "state")
				that.state = e.data;
		};

		that.dry_gain = ctx.createGain();
		node.connect( that.dry_gain );
		that.dry_gain.connect( ctx.destination );

		// reverb is not part of the hardware, it is an extra send effect
		that.reverb = ctx.createConvolver();
		that.reverb_gain = ctx.createGain();
		that.reverb_gain.gain.value = 0;
		node.connect( that.reverb );
		that.reverb.connect( that.reverb_gain );
		that.reverb_gain.connect( ctx.destination );
		fetch("data/BIG HALL E003 M2S.wav")
			.then(function(r){ return r.arrayBuffer(); })
			.then(function(b){ return ctx.decodeAudioData(b); })
			.then(function(buffer){ that.reverb.buffer = buffer; })
			.catch(function(err){ console.warn("reverb impulse not loaded", err); });

		that._sent = null;
		that.sync();
		that.sendScale();
	});
	return this._initializing;
}

Harm.prototype.post = function( msg )
{
	if(this.node)
		this.node.port.postMessage( msg );
}

// sends the settings to the audio thread when they changed
Harm.prototype.sync = function()
{
	if(!this.node)
		return;
	var json = JSON.stringify( this.settings );
	if(json === this._sent)
		return;
	this._sent = json;
	this.post({ type: "settings", settings: this.settings });
	var reverb = this.settings.reverb;
	this.reverb_gain.gain.setTargetAtTime( reverb * reverb * 0.8, this.context.currentTime, 0.02 );
}

Harm.prototype.play = function() { this.post({ type: "play" }); }
Harm.prototype.reset = function() { this.post({ type: "reset" }); }
Harm.prototype.next = function() { this.post({ type: "next" }); }
Harm.prototype.trigger = function( gate ) { this.post({ type: "trigger", gate: gate }); }

Harm.prototype.cycleQuantize = function()
{
	// hardware order: 12-ET, 8-ET, 12-JI, 8-JI, off (no LED). SCL only if a scale is loaded
	var order = ["12-ET","8-ET","12-JI","8-JI"];
	if(this.custom_scale)
		order.push("SCL");
	order.push("OFF");
	var i = order.indexOf( this.settings.quantize );
	this.settings.quantize = order[ (i + 1) % order.length ];
}

Harm.prototype.cycleSeqOct = function()
{
	var s = this.settings;
	s.seq_oct = s.seq_oct == 1 ? 2 : (s.seq_oct == 2 ? 5 : 1);
}

// ---- patching ----

Harm.prototype.connect = function( out_id, in_id, color )
{
	var patches = this.settings.patches;
	for(var i = patches.length - 1; i >= 0; --i)
		if(patches[i][1] == in_id)
			patches.splice(i,1); // an input takes a single cable
	patches.push([ out_id, in_id, color || 0 ]);
}

Harm.prototype.disconnect = function( jack_id )
{
	this.settings.patches = this.settings.patches.filter(function(p){ return p[0] != jack_id && p[1] != jack_id; });
}

// ---- patches (presets) ----

Harm.USER_PATCHES_KEY = "SUBHARM_patches";
Harm.PATCH_FORMAT = "subharm-patch";

// copies `data` over `def`, keeping only fields with the right type so a
// malformed or older patch file can never put garbage into the engine
Harm.mergeValid = function( def, data )
{
	if(Array.isArray(def))
	{
		if(!Array.isArray(data) || data.length != def.length)
			return def;
		return def.map(function(d, i){ return Harm.mergeValid( d, data[i] ); });
	}
	if(def && typeof def == "object")
	{
		if(!data || typeof data != "object" || Array.isArray(data))
			return def;
		var r = {};
		for(var k in def)
			r[k] = Harm.mergeValid( def[k], data[k] );
		return r;
	}
	if(typeof def == "number")
		return (typeof data == "number" && isFinite(data)) ? data : def;
	return typeof data == typeof def ? data : def;
}

Harm.prototype.setSettings = function( data )
{
	data = data || {};
	var s = Harm.mergeValid( Harm.defaultSettings(), data );
	if(Harm.QUANTIZE_MODES.indexOf( s.quantize ) == -1)
		s.quantize = "12-ET";
	if([1,2,5].indexOf( s.seq_oct ) == -1)
		s.seq_oct = 1;
	s.scale_file = typeof data.scale_file == "string" ? data.scale_file : null;
	var jack_ids = Harm.jackTypes();
	s.lfo.forEach(function(l){
		if(Harm.LFO_SHAPES.indexOf( l.shape ) == -1)
			l.shape = "sine";
	});
	s.patches = (Array.isArray(data.patches) ? data.patches : []).filter(function(p){
		return Array.isArray(p) && ((jack_ids[ p[0] ] == "out" && jack_ids[ p[1] ] == "in") ||
			(jack_ids[ p[0] ] == "midiout" && jack_ids[ p[1] ] == "midiin"));
	}).map(function(p){ return [ p[0], p[1], (p[2] | 0) ]; });
	// saves from before the hardware-accurate ranges
	if(data.vca_eg === false && data.eg_hold === undefined)
		s.eg_hold = true;
	s.vco.forEach(function(v){
		while(v.freq < Harm.VCO_MIN_FREQ - 0.01)
			v.freq *= 2;
	});
	s.kb.split_note = Math.min( 96, Math.max( 24, Math.round( s.kb.split_note ) ) );
	s.kb.octave = Math.min( 2, Math.max( -2, Math.round( s.kb.octave ) ) );
	if(!data.kb && !s.patches.some(function(p){ return p[1] == "midi_in"; }))
		s.patches.push([ "kb_midi", "midi_in", 5 ]);
	this.settings = s;
	this.allNotesOff();

	if(!s.scale_file)
		this.clearScale();
	else if(!this.custom_scale || this.custom_scale.file != s.scale_file)
	{
		var quantize = s.quantize;
		var that = this;
		this.loadScale( s.scale_file ).then(function(){ that.settings.quantize = quantize; }, function(){
			that.clearScale();
		});
	}
}

Harm.prototype.getUserPatches = function()
{
	var patches = {};
	try {
		patches = JSON.parse( localStorage.getItem( Harm.USER_PATCHES_KEY ) || "{}" ) || {};
		// the old single save slot becomes a named patch
		var old = localStorage.getItem( Harm.STORAGE_KEY );
		if(old)
		{
			if(!patches["Saved patch"])
				patches["Saved patch"] = JSON.parse( old );
			localStorage.setItem( Harm.USER_PATCHES_KEY, JSON.stringify( patches ) );
			localStorage.removeItem( Harm.STORAGE_KEY );
		}
	} catch(err) {}
	return patches;
}

Harm.prototype.saveUserPatch = function( name )
{
	try {
		var patches = this.getUserPatches();
		patches[ name ] = JSON.parse( JSON.stringify( this.settings ) );
		localStorage.setItem( Harm.USER_PATCHES_KEY, JSON.stringify( patches ) );
		return true;
	} catch(err) { return false; }
}

Harm.prototype.deleteUserPatch = function( name )
{
	try {
		var patches = this.getUserPatches();
		delete patches[ name ];
		localStorage.setItem( Harm.USER_PATCHES_KEY, JSON.stringify( patches ) );
	} catch(err) {}
}

Harm.prototype.exportPatch = function( name )
{
	return JSON.stringify({ format: Harm.PATCH_FORMAT, version: 2, name: name || "", settings: this.settings }, null, "\t");
}

// accepts an exported file or a bare settings object; returns the patch name
Harm.prototype.importPatch = function( text )
{
	var data = JSON.parse( text );
	if(!data || typeof data != "object")
		throw new Error("not a patch file");
	var settings = data.format == Harm.PATCH_FORMAT ? data.settings : data;
	if(!settings || typeof settings != "object" || !Array.isArray(settings.vco))
		throw new Error("not a patch file");
	this.setSettings( settings );
	return typeof data.name == "string" ? data.name : "";
}

// ---- randomize ----

// new random sound; volume, compressor, reverb, cables and the loaded scale are kept
Harm.prototype.randomize = function()
{
	var s = this.settings;
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var pick = function(list) { return list[ Math.floor( Math.random() * list.length ) ]; };
	var chance = function(p) { return Math.random() < p; };

	s.vco.forEach(function(v){
		v.freq = expRnd( Harm.VCO_MIN_FREQ, 1046.5 );
		v.wave = pick( ["square", "pwm", "saw"] );
		v.sub1 = pick( [2, 2, 3, 3, 4, 5, 6, 8] );
		v.sub2 = pick( [3, 4, 4, 5, 6, 7, 8, 12, 16] );
		v.level = chance(0.8) ? rnd( 0.25, 0.8 ) : 0;
		v.sub1_level = rnd( 0.2, 0.8 );
		v.sub2_level = chance(0.8) ? rnd( 0.15, 0.7 ) : 0;
	});
	s.seq_oct = pick( [1, 1, 1, 2, 2, 5] );
	var spread = s.seq_oct == 1 ? 1 : (s.seq_oct == 2 ? 0.6 : 0.25);
	s.seq = [0, 1].map(function(){ return [0, 1, 2, 3].map(function(k){ return k == 0 ? 0 : Math.round( rnd( -spread, spread ) * 24 ) / 24; }); });
	s.seq_assign = [0, 1].map(function(){
		var a = { osc: chance(0.85), sub1: chance(0.3), sub2: chance(0.3) };
		if(!a.osc && !a.sub1 && !a.sub2)
			a.osc = true;
		return a;
	});
	var modes = ["12-ET", "8-ET", "12-JI", "8-JI", "8-ET", "8-JI", "OFF"];
	if(this.custom_scale)
		modes.push( "SCL", "SCL" );
	s.quantize = pick( modes );

	s.tempo = expRnd( 90, 720 );
	s.rhythm = [0, 1, 2, 3].map(function(){ return pick( [1, 2, 2, 3, 3, 4, 5, 6, 7, 8] ); });
	s.rhythm_seq1 = [0, 1, 2, 3].map(function(){ return chance(0.4); });
	s.rhythm_seq2 = [0, 1, 2, 3].map(function(){ return chance(0.4); });
	// every sequencer gets at least one rhythm so the patch always plays
	if(s.rhythm_seq1.indexOf(true) == -1) s.rhythm_seq1[ Math.floor( Math.random() * 4 ) ] = true;
	if(s.rhythm_seq2.indexOf(true) == -1) s.rhythm_seq2[ Math.floor( Math.random() * 4 ) ] = true;

	s.cutoff = expRnd( 250, 5000 );
	s.resonance = rnd( 0, 0.7 );
	s.vcf_eg_amt = chance(0.8) ? rnd( 0.1, 0.8 ) : rnd( -0.5, 0 );
	s.vcf_attack = chance(0.75) ? expRnd( 0.001, 0.03 ) : expRnd( 0.03, 1 );
	s.vcf_decay = expRnd( 0.05, 1.5 );
	s.vca_attack = chance(0.8) ? expRnd( 0.001, 0.02 ) : expRnd( 0.02, 0.8 );
	s.vca_decay = expRnd( 0.08, 2 );
	s.eg_hold = chance(0.08);

	s.lfo.forEach(function(l){
		l.rate = expRnd( 0.05, 8 );
		l.shape = pick( Harm.LFO_SHAPES );
		l.level = rnd( 0.2, 1 );
	});
}

// ---- Scala scales (extension, not on the hardware) ----

Harm.parseScala = function( text )
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

Harm.prototype.loadScale = function( file )
{
	var that = this;
	return fetch( "data/scales/" + encodeURIComponent(file) )
		.then(function(r){ if(!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
		.then(function(text){
			var scale = Harm.parseScala( text );
			if(!scale)
				throw new Error("invalid scala file");
			scale.file = file;
			that.custom_scale = scale;
			that.settings.scale_file = file;
			that.settings.quantize = "SCL";
			that.sendScale();
			return scale;
		});
}

Harm.prototype.clearScale = function()
{
	this.custom_scale = null;
	this.settings.scale_file = null;
	if(this.settings.quantize == "SCL")
		this.settings.quantize = "12-ET";
	this.sendScale();
}

Harm.prototype.sendScale = function()
{
	var s = this.custom_scale;
	this.post({ type: "scale", scale: s ? { degrees: s.degrees, period: s.period } : null });
}

// ---- MIDI ----

Harm.prototype.initMIDI = function()
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

Harm.prototype.bindMIDI = function()
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

Harm.prototype.selectMIDIInput = function( id )
{
	this.midi.selected = id;
	this.allNotesOff();
	if(this.midi.access)
		this.bindMIDI();
}

Harm.prototype.cycleMIDIInput = function( dir )
{
	var ids = ["all"].concat( this.midi.inputs.map(function(i){ return i.id; }) );
	var i = ids.indexOf( this.midi.selected );
	this.selectMIDIInput( ids[ (i + dir + ids.length) % ids.length ] );
}

Harm.prototype.midiInputName = function()
{
	var midi = this.midi;
	if(!midi.access)
		return midi.status == "off" ? "MIDI OFF" : midi.status.toUpperCase();
	if(midi.selected == "all")
		return "ALL INPUTS (" + midi.inputs.length + ")";
	var input = midi.inputs.find(function(i){ return i.id == midi.selected; });
	return input ? (input.name || input.id).toUpperCase() : "DISCONNECTED";
}

Harm.prototype.notifyMIDI = function()
{
	if(this.onmidichange)
		this.onmidichange( this.midi );
}

Harm.prototype.onMIDIMessage = function( data )
{
	var st = data[0];
	this.midi.activity = performance.now();

	// realtime messages go straight to the MIDI path (reach the synth only through the MIDI cable)
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
// The full keyboard feeds the MIDI output (last note priority). Each zone of the split keyboard
// feeds its own KEY (1V/oct, C4 = 0V) and GATE outputs; without split both zones carry all notes.

Harm.prototype.noteZone = function( note )
{
	var kb = this.settings.kb;
	return kb.split && note >= kb.split_note ? 1 : 0;
}

Harm.prototype.noteOn = function( note )
{
	var k = this.keys;
	if(k.held[ note ] !== undefined)
		return;
	var zone = this.noteZone( note );
	k.held[ note ] = zone;
	k.all.push( note );
	this.post({ type: "midi", pitch: (note - 60) / 12, gate: true, retrigger: true });
	this.pushZone( zone, note );
	if(!this.settings.kb.split)
		this.pushZone( 1, note );
}

Harm.prototype.noteOff = function( note )
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

Harm.prototype.pushZone = function( zone, note )
{
	var z = this.keys.zones[ zone ];
	z.push( note );
	this.post({ type: "kb", zone: zone, key: (note - 60) / 12, gate: true });
}

Harm.prototype.popZone = function( zone, note )
{
	var z = this.keys.zones[ zone ] = this.keys.zones[ zone ].filter(function(n){ return n != note; });
	if(z.length)
		this.post({ type: "kb", zone: zone, key: (z[z.length - 1] - 60) / 12, gate: true });
	else
		this.post({ type: "kb", zone: zone, gate: false });
}

Harm.prototype.allNotesOff = function()
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
