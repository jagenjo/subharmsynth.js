

function Harm( context )
{
	this.context = context || null;

	this.playing = false;
	this.time_ms = 0;

	this.current_seq = [0,0];
	this.note = "A4";
	this.rhythm_last_tick = [0,0,0,0];

	this.last_trigger_time = 0;

	this.globals = {
		amp_factor: 0.5,
		reverb_factor: 0.5,
		delay_factor: 0.5,
		cutoff_max: 2000,
		resonance_max: 20,
		subharmonic_freq_factor: 1,
		vcf_attack_range: [0.001, 10],
		vcf_decay_range: [0.005, 10],
		vca_attack_range: [0.001, 10],
		vca_decay_range: [0.005, 10]
	};

	this.settings = {
		volume: 0.3,
		tempo: 120,
		eg: true,
		freq: 440, 
		cutoff: 0.25,
		resonance: 0,
		vcf_eg_amt: 0,
		vcf_attack: 0.1,
		vcf_decay: 0.1,
		vca_attack: 0.02,
		vca_decay: 0.1,
		reverb: 0.1,
		delay: 0.1,
		seq_oct:1, //2 or //5
		quantize:"12-ET", //8-ET, 12-JI, 8-JI
		osc: [{
				shape: "square",
				freq_factor: 1,
				amp: 0.5,
				subosc1_factor: 0.5,
				subosc1_amp: 0.5,
				subosc1_detune: 10,
				subosc2_factor: 4,
				subosc2_amp: 0.5,
				subosc2_detune: 10,
				osc1_assign: true,
				sub1_assign: true,
				sub2_assign: true
			},{
				shape: "square",
				freq_factor: 1,
				amp: 0,
				subosc1_factor: 0.5,
				subosc1_amp: 0,
				subosc1_detune: 10,
				subosc2_factor: 4,
				subosc2_amp: 0,
				subosc2_detune: 10,
				osc1_assign: true,
				sub1_assign: true,
				sub2_assign: true
			}],
		seq: [
				[0,0,0,0],
				[0,0,0,0]
			],
		rhythm_sub: [1,1,1,1],
		rhythm_seq1: [1,0,0,0],
		rhythm_seq2: [0,0,0,0]
	};

	this.voices = [];

	this.sockets = [];
}

Harm.socket_names = [
	["VCO 1","VCO 1 SUB","VCO 1 PWM","!VCA"],
	["!VCO 1","!VCO 1 SUB 1","!VCO 1 SUB 2","VCA"],
	["VCO 2","VCO 2 SUB","VCO 2 PWM","!VCA EG"],
	["!VCO 2","!VCO 2 SUB 1","!VCO 2 SUB 2","CUTOFF"],
	["PLAY","RESET","TRIGGER","!VCF EG"],
	["RHYTHM 1","RHYTHM 2","RHYTHM 3","RHYTHM 4"],
	["!SEQ 1","!SEQ 1 CLK","!SEQ 2","!SEQ 2 CLK"],
	["MIDI IN","CLOCK","!CLOCK","!TRIGGER"]
];

Harm.prototype.play = function()
{
	if(this.playing)
	{
		this.playing = false;
		clearTimeout( this.timeout );
		this.timeout = null;
		return;
	}

	this.playing = true;
	//var now = performance.now();
	var now = this.context.currentTime;
	this.rhythm_last_tick = [now,now,now,now];
	var that = this;
	loop();

	function loop()
	{
		that.timeout = setTimeout( loop, 1 ); //as fast as possible
		that.onTick();
	}
}

Harm.prototype.reset = function()
{
	this.time_ms = 0;
	this.current_seq[0] = 0;
	this.current_seq[1] = 0;

	var now = this.context.currentTime;
	for(var i = 0; i < 4; ++i)
		this.rhythm_last_tick[i] = now;
}

Harm.prototype.next = function()
{
	this.current_seq[0] = (this.current_seq[0] + 1) % 4;
	this.current_seq[1] = (this.current_seq[1] + 1) % 4;
}

Harm.prototype.trigger = function()
{
	this.last_trigger_time = this.context.currentTime;

	if( this.settings.eg )
	{
		this.voices[0].triggerEnvelope( this.settings.vca_attack * 0.5, this.settings.vca_decay * 0.5 ); //half a second
		this.voices[1].triggerEnvelope( this.settings.vca_attack * 0.5, this.settings.vca_decay * 0.5 ); //half a second
	}
}

Harm.prototype.tickSequencer = function(num)
{
	//advance
	this.current_seq[num] = (this.current_seq[num] + 1) % 4;

	if(!this.voices.length)
		return;

	this.last_trigger_time = this.context.currentTime;

	//trigger envelope
	if(this.settings.eg)
		this.voices[num].triggerEnvelope( this.settings.vca_attack * 0.5, this.settings.vca_decay * 0.5 ); //half a second
}

//every 1 ms
Harm.prototype.onTick = function()
{
	var audio_ctx = this.context;
	//var now = performance.now();
	var now = audio_ctx.currentTime;

	var settings = this.settings;
	
	for(var i = 0; i < 4; ++i)
	{
		var last = this.rhythm_last_tick[i];
		var bps = (settings.tempo / 60);
		var delta = (1 / bps) * settings.rhythm_sub[i]; //ms until next subbeat
		var next = last + delta;
		if( now < next )
			continue;
		this.rhythm_last_tick[i] = now;
		if( settings.rhythm_seq1[i] )
			this.tickSequencer(0);
		if( settings.rhythm_seq2[i] )
			this.tickSequencer(1);
	}
}

Harm.prototype.playNote = function( note )
{
	/*
	this.current_seq0 = (this.current_seq0 + 1) % 4;
	this.current_seq1 = (this.current_seq1 + 1) % 4;

	var seq0 = this.settings.seq0[ this.current_seq0 ];
	var seq1 = this.settings.seq1[ this.current_seq1 ];

	var freq = getNoteFrequency( note, seq0 );

	this.settings.freq = freq;
	var voice = this.voices[0];
	if(voice)
		voice.triggerEnvelope( this.settings.attack, this.settings.decay, this.settings.sustain, this.settings.release );
	*/
}

Harm.prototype.init = function()
{
	console.log("initializing synth");

	var audio_ctx = this.context = new AudioContext();

	var out = audio_ctx.destination;

	this.volume_gain = audio_ctx.createGain();
	this.volume_gain.gain.value = 0.5;
	this.volume_gain.connect( out );

	//reverb
	this.reverb_gain = audio_ctx.createGain();
	this.reverb_gain.gain.value = 0.2;
	this.reverb_gain.connect( audio_ctx.destination );
	var reverb = this.reverb = audio_ctx.createConvolver();
	this.reverb.connect( this.reverb_gain );
	// load impulse response from file
    fetch("../data/BIG HALL E003 M2S.wav")
		.then(resp=>resp.arrayBuffer())
		.then(arraybuffer=>audio_ctx.decodeAudioData(arraybuffer))
		.then(buffer=>reverb.buffer = buffer );

	//delay
	/*
	this.delay_gain = audio_ctx.createGain();
	this.delay_gain.gain.value = 0.2;
	this.delay_gain.connect( reverb );
	var delay = this.delay = audio_ctx.createDelay();
	delay.delayTime.value = 1;
	this.delay.connect( this.delay_gain );
	*/

	this.filter = audio_ctx.createBiquadFilter();
	this.filter.connect( this.volume_gain );
	this.filter.connect( this.reverb );


	//filter controller ****
	/*
	this.filter_controller = audio_ctx.createConstantSource();
	this.filter_controller.offset.value = 0;
	this.filter_controller.connect( this.filter.frequency );
	this.filter_controller.start();
	*/

	/*
	var lfo = this.lfo = audio_ctx.createOscillator();
	lfo.frequency.value = 1;
	lfo.start();
	lfo.connect( this.filter.frequency );
	*/

	//create voices
	var voice = this.createVoice( this.filter );
	this.voices.push(voice);
	voice = this.createVoice( this.filter );
	this.voices.push(voice);
}

Harm.prototype.createVoice = function( output )
{
	var ctx = this.context;

	var envelope = ctx.createGain();
	envelope.gain.value = 0;
	envelope.connect( output );

	var osc = ctx.createOscillator();
	osc.frequency.value = 440;
	osc.type = "square"; //"sawtooth";
	osc.start();

	var osc_gain = ctx.createGain();
	osc_gain.gain.value = 0.5;
	osc.connect( osc_gain );
	osc_gain.connect( envelope );

	var subosc1 = ctx.createOscillator();
	subosc1.frequency.value = 220;
	subosc1.detune.value = (Math.random() * 2 - 1) * 10;
	subosc1.start();

	var subosc1_gain = ctx.createGain();
	subosc1_gain.gain.value = 0.5;
	subosc1.connect( subosc1_gain );
	subosc1_gain.connect( envelope );

	var subosc2 = ctx.createOscillator();
	subosc2.frequency.value = 220;
	subosc2.detune.value = (Math.random() * 2 - 1) * 10;
	subosc2.start();

	var subosc2_gain = ctx.createGain();
	subosc2_gain.gain.value = 0.5;
	subosc2.connect( subosc2_gain );
	subosc2_gain.connect( envelope );

	return {
		env_value: 0,
		envelope: envelope,
		osc: osc,
		osc_gain: osc_gain,
		subosc1: subosc1,
		subosc1_gain: subosc1_gain,
		subosc2: subosc2,
		subosc2_gain: subosc2_gain,

		triggerEnvelope: function( a,d )
		{	
			var now = ctx.currentTime;
			var gain = this.envelope.gain;
			gain.cancelScheduledValues(now);
			gain.linearRampToValueAtTime( 1, now + a );
			gain.setTargetAtTime( 0, now + a, a + d );
			//gain.exponentialRampToValueAtTime( 1, now + a );
			//gain.setTargetAtTime( s, now + a, d );
			//gain.setTargetAtTime( 0, now + a + d, r );
		},

		open: function()
		{
			var now = ctx.currentTime;
			var gain = this.envelope.gain;
			gain.cancelScheduledValues(now);
			gain.linearRampToValueAtTime( 1, now);
		}
	};
}

Harm.prototype.update = function(dt)
{
	if(!this.context)
		return;

	var now = this.context.currentTime;
	if(this.playing)
	{
		this.time_ms += dt;
	}

	var settings = this.settings;
	var globals = this.globals;

	this.volume_gain.gain.value = settings.volume * this.globals.amp_factor;
	this.reverb_gain.gain.value = settings.reverb * this.globals.reverb_factor;
	//this.delay_gain.gain.value = settings.delay * this.globals.delay_factor;

	var cutoff = settings.cutoff;
	var since_trigger = now - this.last_trigger_time;
	var attack_filter = settings.vcf_attack;
	var decay_filter = settings.vcf_decay;
	var vcf_factor = 0;
	if( since_trigger < attack_filter )
		vcf_factor = remap( since_trigger,0,attack_filter,0,1 );
	else if ( (since_trigger - attack_filter) < decay_filter )
		vcf_factor = remap( (since_trigger - attack_filter),0,decay_filter,1,0 );
	cutoff += vcf_factor * settings.vcf_eg_amt;

	//this.filter.frequency.value = cutoff * this.globals.cutoff_max;
	var filter_freq = Math.max(cutoff * this.globals.cutoff_max,0);
	//this.filter_controller.offset.value = filter_freq;
	this.filter.frequency.setValueAtTime( filter_freq, now );
	this.filter.Q.value = settings.resonance * this.globals.resonance_max;

	var quantize_mode = this.settings.quantize;

	for(var i = 0; i < 2; ++i)
	{
		var voice = this.voices[i];
		var osc = settings.osc[i];

		if( !this.settings.eg )
			voice.open();

		var seq = this.settings.seq[i][ this.current_seq[i] ] * this.settings.seq_oct;
		var freq = getNoteFrequency( this.note, seq );
		freq *= osc.freq_factor;
		this.settings.freq = freq;

		var freq_flat = getNoteFrequency( this.note, 0 );
		freq_flat *= osc.freq_factor;

		voice.osc.type = osc.shape || "square"; 
		voice.osc.frequency.setValueAtTime( quantize( osc.osc1_assign ? freq : freq_flat, quantize_mode ), now );
		voice.osc_gain.gain.value = osc.amp;
		voice.subosc1.frequency.value = quantize( (osc.sub1_assign ? freq : freq_flat) / (osc.subosc1_factor * globals.subharmonic_freq_factor), quantize_mode );
		voice.subosc1.detune.value = osc.subosc1_detune;
		voice.subosc1_gain.gain.value = osc.subosc1_amp;
		voice.subosc1.type = voice.osc.type; 
		voice.subosc2.frequency.value = quantize( (osc.sub2_assign ? freq : freq_flat) / (osc.subosc2_factor * globals.subharmonic_freq_factor), quantize_mode );
		voice.subosc2.detune.value = osc.subosc2_detune;
		voice.subosc2_gain.gain.value = osc.subosc2_amp;
		voice.subosc2.type = voice.osc.type; 
	}

	//var env = 1 - (now * 2) % 1;
	//voice.env_value = env * 0.3 + voice.env_value * 0.7;
	//voice.envelope.gain.exponentialRampToValueAtTime( voice.env_value, now + dt );
}

function getNoteKeyNumber( note )
{
    var notes = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'],
        octave,
        keyNumber;

	note = note.toUpperCase();
    if (note.length === 3) {
        octave = note.charAt(2);
    } else {
        octave = note.charAt(1);
    }

    keyNumber = notes.indexOf(note.slice(0, -1));

    if (keyNumber < 3) {
        keyNumber = keyNumber + 12 + ((octave - 1) * 12) + 1; 
    } else {
        keyNumber = keyNumber + ((octave - 1) * 12) + 1; 
    }
	return keyNumber;
}

function getFrequency( key_number )
{
	var steps = (key_number - 69);
	var ratio = steps / 12;
    return 440 * Math.pow(2, ratio);
}

function getNote( freq )
{
	return (Math.log( freq / 440.0 ) / Math.log(2)) * 12 + 69; //69 is A4
}

function freqToLog( freq )
{
	return (Math.log( freq / 440.0 ) / Math.log(2));
}

function logToFreq( log )
{
	return Math.pow(2,log)*440;
}

function logToNote( log )
{
	return log * 12 + 69;
}

var JI_ratios = [1,25/24,9/8,6/5,5/4,4/3,45/32,3/2,8/5,5/3,9/5,15/8]; //,2
var ET_ratios = [1,1.05946,1.12246,1.18921,1.25992,1.33483,1.41421,1.49831,1.58740,1.68179,1.78180,1.88775]; //,2
var scale8 = [0,-1,0,0,-1,0,-1,0,0,-1,0,-1]; //starts at A4
//var scale8 = [0,-1,0,-1,0,0,-1,0,-1,0,-1,0];

function quantize( freq, mode )
{
	var log = freqToLog( freq );
	var note = Math.round( logToNote( log ) );
	var index = note % 12;
	if(mode == "8-ET" || mode == "8-JI" )
		note += scale8[ index ];
	freq = getFrequency( note );
	if(mode == "12-JI" || mode == "8-JI" )
	{
		//TODO
		//log = freqToLog( freq );
		//var logoctave = Math.floor( log );
	}

	return freq;
}

//https://gist.github.com/stuartmemo/3766449
function getNoteFrequency( note, offset ) {
	offset = offset || 0;
	var keyNumber = getNoteKeyNumber( note ) + offset;
    // Return frequency of note
	return getFrequency( keyNumber );
};

function remap(v, in_min, in_max, out_min, out_max ) {
	return (v - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

//******************************

Harm.prototype.draw = function ( ctx, x, y )
{
	var settings = this.settings;

	ctx.fillStyle = "#222";
	ctx.fillRect(x,y,1580,680);

	//oscillators
	for(var i = 0; i < 2; ++i )
	{
		var x1 = x + 450 + i * 300;
		var osc = settings.osc[i];

		var sidex = i == 0 ? x1 + 20: x1 + 200;		
		drawLabel("VCO "+(i+1)+" SHAPE",sidex,y+100,0.5);
		if( drawSwitch( sidex - 8,y+120,16,40, osc.shape == "square" ) )
			osc.shape = (osc.shape == "square") ? "sawtooth" : "square";

		drawLabel("VCO "+(i+1)+" FREQ",x1 + 110,y+70,1);
		osc.freq_factor = GUI.Knob( x1 + 60,y+90,100,100, osc.freq_factor, 0, 2 );

		drawLabel("SUB1 FREQ", x1 + 55,y+220,0.6);
		osc.subosc1_factor = GUI.Knob( x1 + 20,y+240,70,70, osc.subosc1_factor, 16, 1,1,19 );

		drawLabel("SUB2 FREQ",x1 + 180,y+220,0.6);
		osc.subosc2_factor = GUI.Knob( x1 + 140,y+240,70,70, osc.subosc2_factor, 16, 1,1,19 );

		drawLabel("SEQ "+(i+1)+" ASSIGN", x1 + 110,y+340,0.8);

		ctx.font = "14px " + font_name;
		if( drawButton( x1 + 30, y+350, 40, 30, "OSC 1", osc.osc1_assign ) )
			osc.osc1_assign = !osc.osc1_assign;

		if( drawButton( x1 + 90, y+350, 40, 30, "SUB 1", osc.sub1_assign ) )
			osc.sub1_assign = !osc.sub1_assign;
		if( drawButton( x1 + 150, y+350, 40, 30, "SUB 2", osc.sub2_assign ) )
			osc.sub2_assign = !osc.sub2_assign;

		drawLabel("VC0 1 LEVEL", x1 + 110,y+430,0.8);
		osc.amp = GUI.Knob( x1 + 70,y+440,80,80, osc.amp, 0, 1 );

		drawLabel("SUB 1 LEVEL", x1 + 40,y+550,0.8);
		osc.subosc1_amp = GUI.Knob( x1,y+560,80,80, osc.subosc1_amp, 0, 1 );

		drawLabel("SUB 2 LEVEL", x1 + 180,y+550,0.8);
		osc.subosc2_amp = GUI.Knob( x1 + 140,y+560,80,80, osc.subosc2_amp, 0, 1 );
	}

	//selectors
	var x1 = x + 650;
	ctx.font = "14px " + font_name;
	drawLed( x1 + 60, y+80, 10, settings.seq_oct == 5, "±5" );
	drawLed( x1 + 60, y+110, 10, settings.seq_oct == 2, "±2" );
	drawLed( x1 + 60, y+140, 10, settings.seq_oct == 1, "±1" );
	if( drawButton( x1 + 30, y+170, 60, 30, "SEQ OCT" ) )
	{
		switch( settings.seq_oct )
		{
			case 5: settings.seq_oct = 2; break;
			case 2: settings.seq_oct = 1; break;
			case 1: settings.seq_oct = 5; break;
		}
	}

	ctx.font = "14px " + font_name;
	drawLed( x1 + 60, y+320, 10, settings.quantize == "12-ET", "12-ET" );
	drawLed( x1 + 60, y+350, 10, settings.quantize == "8-ET", "8-ET" );
	drawLed( x1 + 60, y+380, 10, settings.quantize == "12-JI", "12-JI" );
	drawLed( x1 + 60, y+410, 10, settings.quantize == "8-JI", "8-JI" );
	if( drawButton( x1 + 30, y+440, 60, 30, "QUANTIZE" ) )
	{
		switch( settings.quantize )
		{
			case "12-ET": settings.quantize = "8-ET"; break;
			case "8-ET": settings.quantize = "12-JI"; break;
			case "12-JI": settings.quantize = "8-JI"; break;
			case "8-JI": settings.quantize = "12-ET"; break;
		}
	}

	var x1 = x + 950;

	drawLabel("CUTOFF",x1 + 110,y+40,1);
	settings.cutoff = GUI.Knob( x1 + 60,y+50,100,100, settings.cutoff, 0, 1 );
	drawLabel("RESONANCE",x1 + 110,y+200,1);
	settings.resonance = GUI.Knob( x1 + 60,y+210,100,100, settings.resonance, 0, 1 );
	drawLabel("VCF ATTACK",x1 + 110,y+370,1);
	settings.vcf_attack = GUI.Knob( x1 + 60,y+380,100,100, settings.vcf_attack, 0, 1 );
	drawLabel("VCA ATTACK",x1 + 110,y+540,1);
	settings.vca_attack = GUI.Knob( x1 + 60,y+550,100,100, settings.vca_attack, 0, 1 );

	drawLabel("VOLUME",x1 + 270,y+40,1);
	settings.volume = GUI.Knob( x1 + 220,y+50,100,100, settings.volume, 0, 1 );
	drawLabel("VCF EG AMT",x1 + 270,y+200,1);
	settings.vcf_eg_amt = GUI.Knob( x1 + 220,y+210,100,100, settings.vcf_eg_amt, -1, 1 );
	drawLabel("VCF DECAY",x1 + 270,y+370,1);
	settings.vcf_decay = GUI.Knob( x1 + 220,y+380,100,100, settings.vcf_decay, 0, 1 );
	drawLabel("VCA DECAY",x1 + 270,y+540,1);
	settings.vca_decay = GUI.Knob( x1 + 220,y+550,100,100, settings.vca_decay, 0, 1 );


	/*



	settings.osc[0].subosc1_detune = GUI.Knob( 400,250,50,50, settings.osc[0].subosc1_detune, -100, 100 );
	settings.osc[0].subosc2_detune = GUI.Knob( 600,250,50,50, settings.osc[0].subosc2_detune, -100, 100 );
	*/

	drawLabel("SEQUENCER 1",x+230,y+30,0.8);
	drawLabel("SEQUENCER 2",x+230,y+180,0.8);
	drawLabel("POLYRHYTHM",x+230,y+320,0.8);
	drawLabel("OSCILLATORS",x+720,y+30,1);

	for(var i = 0; i < 4; ++i)
	{
		var x1 = x + 50 + i * 100;

		drawLabel("STEP "+(i+1),x1 + 25,y+60,0.6);
		settings.seq[0][i] = GUI.Knob( x1,y+80,50,50, settings.seq[0][i], -12, 12,1,24 );
		drawLed( x1 + 25, y+150, 10, i == synth.current_seq[0] );

		drawLabel("STEP "+(i+1),x1 + 25,y+200,0.6);
		settings.seq[1][i] = GUI.Knob( x1,y+220,50,50, settings.seq[1][i], -12, 12,1,24 );
		drawLed( x1 + 25, y+290, 10, i == synth.current_seq[1] );

		drawLabel("RHYTHM "+(i+1),x1 + 25,y+340,0.6);
		settings.rhythm_sub[i] = GUI.Knob( x1,y+360,50,50, settings.rhythm_sub[i], 16, 1,1,16 );

		if( drawButton( x1, y+430, 50, 30, "SEQ1", settings.rhythm_seq1[i] ) )
			settings.rhythm_seq1[i] = !settings.rhythm_seq1[i];

		if( drawButton( x1, y+480, 50, 30, "SEQ2", settings.rhythm_seq2[i] ) )
			settings.rhythm_seq2[i] = !settings.rhythm_seq2[i];
	}

	var x1 = 70;
	drawLabel("TEMPO",x + 80,y+550,1);
	settings.tempo = GUI.Knob( x + 30,y+560,100,100, settings.tempo, 20, 3000 );

	ctx.font = "14px " + font_name;
	if( drawButton( x + 160, y+560, 40, 40, "RESET", false ) )
		synth.reset();

	if( drawButton( x + 220, y+560, 40, 40, "EG", settings.eg ) )
		settings.eg = !settings.eg;

	if( drawButton( x + 280, y+560, 40, 40, "NEXT", false ) )
		synth.next();

	if( drawButton( x + 160, y+620, 70, 40, "PLAY", synth.playing ) )
		synth.play();

	if( drawButton( x + 260, y+620, 70, 40, "TRIGGER", false ) )
		synth.trigger();


	var x1 = 1320;

	for(var j = 0; j < 8; ++j)
	{
		for(var i = 0; i < 4; ++i)
		{
			if( drawSocket(x1 + i * 70, y + 100 + j * 70, Harm.socket_names[j][i] ) )
			{
				//connecting
			}
		}
	}
}
