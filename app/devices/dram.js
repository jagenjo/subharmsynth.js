// devices/dram.js
// DRAM module for the rack, an analog percussion synthesizer: settings, patch bay and panel,
// laid out like the hardware's front panel: two rows of synth controls, the 8-step sequencer
// with a PITCH and a VELOCITY knob per step, and the 24 point patch bay. DSP in dram-worklet.js.

(function(){

var SIZE = [1568, 596]; // same 60HP case as the SUBHARM
var VCO_MIN_FREQ = 10, VCO_MAX_FREQ = 10000; // ten octaves
var TEMPO_MIN = 10, TEMPO_MAX = 10000;      // BPM with a step per 16th: 0.7Hz..700Hz steps
var STEPS = 8;
var SEQ_VOLTS = 5;

// patch bay, 3 columns x 8 rows
var JACKS = [
	[["TRIGGER","in","trigger_in"], ["VCA CV","in","vca_cv"], ["VELOCITY","in","velocity_in"]],
	[["VCA DECAY","in","vca_decay_in"], ["EXT AUDIO","in","ext_audio"], ["VCA","out","vca"]],
	[["VCF DECAY","in","vcf_decay_in"], ["NOISE LEVEL","in","noise_level_in"], ["VCA EG","out","vca_eg"]],
	[["VCO DECAY","in","vco_decay_in"], ["VCF MOD","in","vcf_mod"], ["VCF EG","out","vcf_eg"]],
	[["VCO 1 CV","in","vco1_cv"], ["1→2 FM AMT","in","fm_amt_in"], ["VCO EG","out","vco_eg"]],
	[["VCO 2 CV","in","vco2_cv"], ["VCO 1","out","vco1"], ["VCO 2","out","vco2"]],
	[["TEMPO","in","tempo_in"], ["RUN / STOP","in","run_stop"], ["ADV / CLOCK","in","adv_clock"]],
	[["TRIGGER","out","trigger_out"], ["VELOCITY","out","velocity_out"], ["PITCH","out","pitch_out"]]
];

var ENUMS = {
	seq_pitch_mod: ["both", "off", "vco2"],
	vco1_wave: ["square", "tri"],
	vco2_wave: ["square", "tri"],
	vcf_mode: ["lp", "hp"],
	vca_attack: ["fast", "slow"]
};

var M = null;          // the module being drawn
var trigger_held = {}; // module id -> TRIGGER button held

function defaults()
{
	return {
		vco_decay: 0.25,
		seq_pitch_mod: "both",   // sequencer PITCH to VCO 1 & 2, off, or VCO 2 only
		vco1_eg_amt: 0.45,       // bipolar
		vco1_freq: 45,
		vco1_wave: "tri",
		vco2_eg_amt: 0.3,
		vco2_freq: 90,
		vco2_wave: "square",
		fm_amt: 0.15,            // 1->2 FM
		hard_sync: false,
		vco1_level: 0.85,
		noise_level: 0.15,       // NOISE / EXT LEVEL
		vco2_level: 0.25,
		vcf_mode: "lp",
		cutoff: 1200,
		resonance: 0.25,
		vcf_decay: 0.18,
		vcf_eg_amt: 0.45,        // bipolar
		noise_vcf_mod: 0,
		vca_attack: "fast",
		vca_decay: 0.35,
		volume: 0.7,
		tempo: 120,
		pitch: [0, 0, 0.1, 0, 0, 0, 0.2, 0],     // -1..1 = -5..+5V
		velocity: [1, 0, 0.6, 0, 0.9, 0.3, 0.7, 0] // 0..1 = 0..5V
	};
}

function initialState()
{
	return { playing: false, step: 0, trig: false, freq: [0, 0], vco_eg: 0, vcf_eg: 0, vca_eg: 0 };
}

function validate( s )
{
	for(var k in ENUMS)
		if(ENUMS[k].indexOf( s[k] ) == -1)
			s[k] = defaults()[k];
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var pick = function(list) { return list[ Math.floor( Math.random() * list.length ) ]; };
	var chance = function(p) { return Math.random() < p; };

	s.vco_decay = expRnd( 0.03, 0.8 );
	s.seq_pitch_mod = pick( ["both", "both", "off", "vco2"] );
	s.vco1_eg_amt = chance(0.8) ? rnd( 0, 0.7 ) : rnd( -0.4, 0 );
	s.vco1_freq = expRnd( 25, 400 );
	s.vco1_wave = pick( ENUMS.vco1_wave );
	s.vco2_eg_amt = rnd( -0.3, 0.6 );
	s.vco2_freq = expRnd( 30, 2000 );
	s.vco2_wave = pick( ENUMS.vco2_wave );
	s.fm_amt = chance(0.6) ? rnd( 0, 0.6 ) : 0;
	s.hard_sync = chance(0.2);
	s.vco1_level = rnd( 0.4, 1 );
	s.vco2_level = chance(0.7) ? rnd( 0.1, 0.8 ) : 0;
	s.noise_level = chance(0.6) ? rnd( 0.05, 0.6 ) : 0;
	s.vcf_mode = chance(0.8) ? "lp" : "hp";
	s.cutoff = expRnd( 150, 6000 );
	s.resonance = rnd( 0, 0.75 );
	s.vcf_decay = expRnd( 0.03, 0.8 );
	s.vcf_eg_amt = rnd( -0.2, 0.8 );
	s.noise_vcf_mod = chance(0.3) ? rnd( 0, 0.4 ) : 0;
	s.vca_attack = chance(0.85) ? "fast" : "slow";
	s.vca_decay = expRnd( 0.05, 1 );
	s.tempo = expRnd( 80, 180 );
	s.pitch = s.pitch.map(function(){ return chance(0.5) ? 0 : Math.round( rnd( -0.3, 0.3 ) * 60 ) / 60; });
	s.velocity = s.velocity.map(function(){ return chance(0.35) ? 0 : rnd( 0.3, 1 ); });
	s.velocity[0] = rnd( 0.7, 1 ); // the downbeat always plays
}

// message to the module's DSP (once the audio engine runs)
function send( msg )
{
	var m = M;
	act(function(){ m.post( msg ); });
}

function fmtVolts( v ) { return (v > 0 ? "+" : "") + v.toFixed(2) + " V"; }

// ---------------------------------------------------------------------------
// panel

var COLS = [85, 190, 295, 410, 525, 630, 740, 855, 970, 1080, 1185];
var ROWS = [105, 250];
var STEP_X0 = 345, STEP_DX = 120;
var JACK_COLS = [1340, 1410, 1480];

function drawBackground()
{
	var w = SIZE[0], h = SIZE[1];
	drawCasing( 0, 0, w, h );
	drawScrew( 36, 12 ); drawScrew( w - 36, 12 );
	drawScrew( 36, h - 12 ); drawScrew( w - 36, h - 12 );
	drawScrew( 690, h - 12 ); drawScrew( 690, 12 );

	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = "bold 30px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "DRAM", 46, 560 );
	var tw = ctx.measureText( "DRAM" ).width;
	ctx.fillRect( 54 + tw, 534, 1.5, 28 );
	ctx.font = "11px " + FONT;
	ctx.fillText( "SEMI-MODULAR ANALOG", 62 + tw, 546 );
	ctx.fillText( "PERCUSSION SYNTHESIZER", 62 + tw, 559 );
}

function drawSynthControls()
{
	var s = M.settings, st = M.state;
	var r1 = ROWS[0], r2 = ROWS[1];
	var time = { style: "ring", exp: true, format: fmtTime };
	var opts = function(o, extra) { var r = {}; for(var k in o) r[k] = o[k]; for(var k in extra) r[k] = extra[k]; return r; };
	var freqFmt = function(i){ return function(){ return freqToNoteName( st.freq[i] ) + "  " + fmtHz( st.freq[i] || (i ? s.vco2_freq : s.vco1_freq) ); }; };

	// first row
	s.vco_decay = knob( "vco_decay", COLS[0], r1, 26, s.vco_decay, 0.01, 10, opts( time, { label: "VCO DECAY", def: 0.25 } ) );
	s.seq_pitch_mod = leverSwitch( "seq_pitch_mod", COLS[1] - 14, r1 - 28, s.seq_pitch_mod,
		[["both", "VCO 1&2"], ["off", "OFF"], ["vco2", "VCO 2"]], "SEQ PITCH MOD" );
	s.vco1_eg_amt = knob( "vco1_eg_amt", COLS[2], r1, 26, s.vco1_eg_amt, -1, 1, {
		label: "VCO 1 EG AMOUNT", bipolar: true, def: 0, format: fmtSigned } );
	s.vco1_freq = knob( "vco1_freq", COLS[3], r1, 34, s.vco1_freq, VCO_MIN_FREQ, VCO_MAX_FREQ, {
		label: "VCO 1 FREQUENCY", style: "ring", exp: true, def: 45, format: freqFmt(0) } );
	s.vco1_wave = leverSwitch( "vco1_wave", COLS[4] - 14, r1 - 22, s.vco1_wave, [["square", "SQUARE"], ["tri", "TRIANGLE"]], "VCO 1 WAVE" );
	s.vco1_level = knob( "vco1_level", COLS[5], r1, 26, s.vco1_level, 0, 1, { label: "VCO 1 LEVEL", def: 0.85, format: fmtPct } );
	s.noise_level = knob( "noise_level", COLS[6], r1, 26, s.noise_level, 0, 1, { label: "NOISE / EXT LEVEL", def: 0, format: fmtPct } );
	s.cutoff = knob( "cutoff", COLS[7], r1, 34, s.cutoff, 20, 20000, { label: "CUTOFF", exp: true, def: 1200, format: fmtHz } );
	s.resonance = knob( "resonance", COLS[8], r1, 26, s.resonance, 0, 1, { label: "RESONANCE", def: 0, format: fmtPct } );
	s.vca_attack = leverSwitch( "vca_attack", COLS[9] - 14, r1 - 22, s.vca_attack, [["fast", "FAST"], ["slow", "SLOW"]], "VCA EG" );
	s.volume = knob( "volume", COLS[10], r1, 26, s.volume, 0, 1, { label: "VOLUME", def: 0.7, format: fmtPct } );

	// second row
	s.fm_amt = knob( "fm_amt", COLS[0], r2, 26, s.fm_amt, 0, 1, { label: "1→2 FM AMOUNT", def: 0, format: fmtPct } );
	s.hard_sync = leverSwitch( "hard_sync", COLS[1] - 14, r2 - 22, s.hard_sync, [[true, "ON"], [false, "OFF"]], "HARD SYNC" );
	s.vco2_eg_amt = knob( "vco2_eg_amt", COLS[2], r2, 26, s.vco2_eg_amt, -1, 1, {
		label: "VCO 2 EG AMOUNT", bipolar: true, def: 0, format: fmtSigned } );
	s.vco2_freq = knob( "vco2_freq", COLS[3], r2, 34, s.vco2_freq, VCO_MIN_FREQ, VCO_MAX_FREQ, {
		label: "VCO 2 FREQUENCY", style: "ring", exp: true, def: 90, format: freqFmt(1) } );
	s.vco2_wave = leverSwitch( "vco2_wave", COLS[4] - 14, r2 - 22, s.vco2_wave, [["square", "SQUARE"], ["tri", "TRIANGLE"]], "VCO 2 WAVE" );
	s.vco2_level = knob( "vco2_level", COLS[5], r2, 26, s.vco2_level, 0, 1, { label: "VCO 2 LEVEL", def: 0.25, format: fmtPct } );
	s.vcf_mode = leverSwitch( "vcf_mode", COLS[6] - 14, r2 - 22, s.vcf_mode, [["hp", "HIGH"], ["lp", "LOW"]], "VCF MODE" );
	s.vcf_decay = knob( "vcf_decay", COLS[7], r2, 26, s.vcf_decay, 0.01, 10, opts( time, { label: "VCF DECAY", def: 0.18 } ) );
	s.vcf_eg_amt = knob( "vcf_eg_amt", COLS[8], r2, 26, s.vcf_eg_amt, -1, 1, {
		label: "VCF EG AMOUNT", bipolar: true, def: 0, format: fmtSigned } );
	s.noise_vcf_mod = knob( "noise_vcf_mod", COLS[9], r2, 26, s.noise_vcf_mod, 0, 1, { label: "NOISE / VCF MOD", def: 0, format: fmtPct } );
	s.vca_decay = knob( "vca_decay", COLS[10], r2, 26, s.vca_decay, 0.01, 10, opts( time, { label: "VCA DECAY", def: 0.35 } ) );

	// envelope activity
	drawLed( COLS[0] + 34, r1 - 34, 3.5, st.vco_eg > 0.05, "#ffb02f" );
	drawLed( COLS[7] + 34, r2 - 34, 3.5, st.vcf_eg > 0.05, "#ffb02f" );
	drawLed( COLS[10] + 34, r2 - 34, 3.5, st.vca_eg > 0.05, "#ffb02f" );
}

function drawSequencer()
{
	var s = M.settings, st = M.state;

	s.tempo = knob( "tempo", 95, 430, 36, s.tempo, TEMPO_MIN, TEMPO_MAX, {
		label: "TEMPO", labelSize: 13, style: "ring", exp: true, def: 120,
		format: function(v){
			if(M.patchedAdv) return "EXT CLOCK";
			return Math.round(v) + " BPM  (" + (v * 4 / 60).toFixed(1) + " Hz)";
		}
	});
	drawLed( 140, 382, 4, st.trig && st.playing, "#ffb02f" );

	var bx = 165, bw = 82;
	if(button( "run", bx, 368, bw, 28, "RUN / STOP", st.playing ).clicked)
		send({ type: "play" });
	if(button( "advance", bx, 408, bw, 28, "ADVANCE" ).clicked)
		send({ type: "next" });
	var trig = button( "trigger", bx, 448, bw, 28, "TRIGGER", !!trigger_held[ M.id ] );
	if(trig.clicked)
		send({ type: "trigger", gate: true });
	if((trigger_held[ M.id ] || trig.clicked) && !trig.held)
		send({ type: "trigger", gate: false });
	trigger_held[ M.id ] = trig.held;

	drawSection( "SEQUENCER", STEP_X0 - 40, STEP_X0 + STEP_DX * (STEPS - 1) + 40, 318 );
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	ctx.font = "12px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "PITCH", STEP_X0 - 36, 412 );
	ctx.fillText( "VELOCITY", STEP_X0 - 36, 502 );
	for(var i = 0; i < STEPS; ++i)
	{
		var x = STEP_X0 + i * STEP_DX;
		drawLabel( String( i + 1 ), x - 16, 348, 11 );
		drawLed( x + 4, 348, 4.5, st.step == i );
		s.pitch[i] = knob( "pitch" + i, x, 410, 22, s.pitch[i], -1, 1, {
			bipolar: true, def: 0, ticks: 11,
			format: function(v){ var st_ = v * SEQ_VOLTS * 12; return (st_ > 0 ? "+" : "") + st_.toFixed(1) + " st  " + fmtVolts( v * SEQ_VOLTS ); }
		});
		s.velocity[i] = knob( "velocity" + i, x, 500, 22, s.velocity[i], 0, 1, {
			def: 1, ticks: 11, format: function(v){ return fmtPct(v) + "  " + (v * 5).toFixed(1) + " V"; }
		});
	}
}

function drawPatchBay()
{
	var h = SIZE[1];
	var x = JACK_COLS[0] - 38;
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( x, 14, JACK_COLS[2] - x + 38, h - 28, 6 ); ctx.fill();
	ctx.font = "13px " + FONT;
	var w1 = ctx.measureText( "IN / " ).width, w2 = ctx.measureText( "OUT" ).width + 6;
	var cx = JACK_COLS[1];
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "IN / ", cx - (w1 + w2) * 0.5, 31 );
	ctx.fillRect( cx - (w1 + w2) * 0.5 + w1, 23, w2, 16 );
	ctx.fillStyle = "#111";
	ctx.fillText( "OUT", cx - (w1 + w2) * 0.5 + w1 + 3, 32 );

	for(var r = 0; r < JACKS.length; ++r)
		for(var c = 0; c < 3; ++c)
		{
			var j = JACKS[r][c];
			drawJack( j[2], JACK_COLS[c], 74 + r * 69, j[0], j[1] );
		}
}

WR.registerSynth( "dram", {
	title: "DRAM",
	description: "DRAM: semi-modular analog percussion synthesizer",
	about: "An 8-step analog percussion voice, 2 VCOs, noise, a ladder filter and decays per step. Kicks, toms, clanks.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^(run|trigger|advance)$", 3], ["", 1]],
	// a knob's sockets, lit when the mouse is over it (code.js: controlJacks)
	knob_jacks: [["^vco_decay$", ["vco_decay_in"]], ["^vcf_eg_amt$", ["vcf_mod"]], ["^tempo$", ["tempo_in"]]],
	worklet: "devices/dram-worklet.js",
	jacks: JACKS,
	category: "Synths",
	wood: true, // wooden sides
	midi_in: null,
	rear_jacks: [["AUDIO OUT", "aout", "audio"]], // line level, on the back
	audio_out: "audio",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: function( mod ) {
		M = mod;
		M.state = M.state || initialState();
		M.patchedAdv = rack.settings.patches.some(function(p){ return p[1] == WR.jackId( mod.id, "adv_clock" ); });
		drawBackground();
		drawSynthControls();
		drawSequencer();
		drawPatchBay();
		M = null;
	},
	transport: function( mod, action, value ) {
		if(action == "play") mod.post({ type: "play", value: value });
		else if(action == "trigger") mod.post({ type: "trigger", gate: value });
		else mod.post({ type: action }); // reset, next (= ADVANCE)
	},
	tempo: function( s ) { return s.tempo; }
});

})();
