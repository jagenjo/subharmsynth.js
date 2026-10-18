// devices/b32.js
// Brother-32 module, a semi-modular synthesizer with a sequencer: settings, the 32 point patch bay and the panel, laid out like the
// hardware's front: oscillator and filter controls on the left, LFO, VCA, envelope and tempo on the
// right, the 32 step sequencer with its 13 key keyboard below, the patch bay on the right side.
// The real unit edits steps through button modes; here every step is a cell of the step grid
// (click to select, click again for a rest) and the keyboard writes notes in REC.
// DSP in b32-worklet.js.

(function(){

var SIZE = [1568, 500]; // 60HP, more compact than the Subharm and DRAM panels
var STEPS = 32;
var VCO_MIN = 32.70, VCO_MAX = 2093; // C1..C7
var ASSIGNS = [["accent", "ACCENT"], ["clock", "CLOCK"], ["ramp", "SEQ RAMP"]];

// patch bay: 4 columns x 8 rows like the hardware (inputs, outputs with inverted labels);
var JACKS = [
	[["EXT AUDIO","in","ext_audio"], ["MIX CV","in","mix_cv"], ["VCA CV","in","vca_cv"], ["VCA","out","vca"]],
	[["NOISE","out","noise"], ["VCF CUTOFF","in","cutoff_in"], ["VCF RES","in","res_in"], ["VCF","out","vcf"]],
	[["VCO 1V/OCT","in","pitch_in"], ["VCO LIN FM","in","lin_fm"], ["VCO MOD","in","vco_mod"], ["VCO SAW","out","saw"]],
	[["VCO PULSE","out","pulse"], ["LFO RATE","in","lfo_rate_in"], ["LFO TRI","out","lfo_tri"], ["LFO SQ","out","lfo_sq"]],
	[["MIX 1","in","mix1"], ["MIX 2","in","mix2"], ["VC MIX CTRL","in","vc_mix_ctrl"], ["VC MIX","out","vc_mix"]],
	[["MULT","in","mult_in"], ["MULT 1","out","mult1"], ["MULT 2","out","mult2"], ["ASSIGN","out","assign"]],
	[["GATE","in","gate_in"], ["EG","out","eg"], ["KB","out","kb"], ["GATE","out","gate"]],
	[["TEMPO","in","tempo_in"], ["RUN/STOP","in","run_stop"], ["RESET","in","reset_in"], ["HOLD","in","hold"]]
]; // MIDI IN is on the back

var M = null;
var ui_state = {}; // module id -> { sel: selected step, oct: keyboard octave, rec, key: note held with the pointer }

function defaults()
{
	// a bassline on the first 16 steps: [note, gate, accent, glide]
	var pattern = [[36,1,1,0],[36,1,0,0],[48,1,0,1],[36,0,0,0],[39,1,0,0],[36,1,1,0],[43,1,0,0],[36,1,0,0],
	               [36,1,1,0],[48,1,0,0],[36,0,0,0],[46,1,0,1],[41,1,0,0],[36,1,1,0],[43,1,0,0],[48,1,0,1]];
	var steps = [];
	for(var i = 0; i < STEPS; ++i)
	{
		var p = pattern[ i % 16 ];
		steps.push({ note: p[0], gate: !!p[1], accent: !!p[2], glide: !!p[3] });
	}
	return {
		freq: 261.63,          // FREQUENCY knob; sequence and keys add to it (C4 = 0V)
		pw: 0.5,
		vco_mod: 0,            // amount 0..1
		vco_mod_src: "lfo",    // "eg" | "lfo"
		vco_mod_dest: "freq",  // "freq" | "pw"
		wave: "saw",           // VCO WAVE into the mixer: "saw" | "pulse"
		mix: 0,                // VCO / NOISE MIX: 0 = VCO
		cutoff: 600,
		resonance: 0.45,
		vcf_mod: 0.5,          // bipolar
		vcf_mod_src: "eg",
		vcf_mode: "lp",        // "lp" | "hp"
		attack: 0.002,
		decay: 0.25,
		sustain: false,
		vca_mode: "eg",        // "eg" | "on"
		volume: 0.7,
		lfo_rate: 3,
		lfo_wave: "tri",       // "tri" | "sq"
		glide: 0,
		vc_mix: 0.5,
		tempo: 120,            // BPM, a step per 16th
		gate_length: 0.5,
		length: 16,
		assign: "accent",
		steps: steps
	};
}

var ENUMS = { vco_mod_src: ["eg","lfo"], vco_mod_dest: ["freq","pw"], wave: ["saw","pulse"], vcf_mod_src: ["eg","lfo"],
	vcf_mode: ["lp","hp"], vca_mode: ["eg","on"], lfo_wave: ["tri","sq"], assign: ["accent","clock","ramp"] };

function validate( s )
{
	var d = defaults();
	for(var k in ENUMS)
		if(ENUMS[k].indexOf( s[k] ) == -1)
			s[k] = d[k];
	s.length = Math.min( STEPS, Math.max( 1, Math.round( s.length ) ) );
	s.steps.forEach(function(st){ st.note = Math.min( 108, Math.max( 12, Math.round( st.note ) ) ); });
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var pick = function(list) { return list[ Math.floor( Math.random() * list.length ) ]; };
	var chance = function(p) { return Math.random() < p; };
	var scale = pick([ [0,3,5,7,10], [0,2,3,5,7,8,10], [0,2,4,7,9], [0,1,5,7,8] ]);
	var root = 36 + Math.floor( Math.random() * 7 );
	s.steps.forEach(function(st, i){
		st.note = root + pick( scale ) + (chance(0.25) ? 12 : 0);
		st.gate = i % 4 == 0 || chance(0.65);
		st.accent = chance(0.25);
		st.glide = chance(0.15);
	});
	s.length = pick([8, 16, 16, 16, 12, 32]);
	s.wave = pick( ENUMS.wave );
	s.pw = rnd( 0.2, 0.8 );
	s.mix = chance(0.2) ? rnd( 0.05, 0.4 ) : 0;
	s.cutoff = expRnd( 150, 3000 );
	s.resonance = rnd( 0.1, 0.8 );
	s.vcf_mod = rnd( 0.1, 0.8 );
	s.vcf_mod_src = chance(0.8) ? "eg" : "lfo";
	s.vco_mod = chance(0.3) ? rnd( 0, 0.4 ) : 0;
	s.attack = expRnd( 0.001, 0.05 );
	s.decay = expRnd( 0.08, 1.2 );
	s.sustain = chance(0.3);
	s.glide = chance(0.3) ? expRnd( 0.02, 0.3 ) : 0;
	s.lfo_rate = expRnd( 0.2, 12 );
	s.tempo = expRnd( 90, 150 );
	s.gate_length = rnd( 0.3, 0.9 );
}

function uiOf( id )
{
	return ui_state[id] || (ui_state[id] = { sel: 0, oct: 0, rec: false, key: null });
}

function send( msg )
{
	var m = M;
	act(function(){ m.post( msg ); });
}

function fmtFreq( v ) { return freqToNoteName( v ) + "  " + fmtHz( v ); }

// ---------------------------------------------------------------------------
// panel

var JACK_COLS = [1292, 1357, 1422, 1487];
var GRID_X = 300, GRID_Y = 280, CELL_W = 56, CELL_H = 30, CELL_GAP = 2;

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
	ctx.fillText( "BROTHER-32", 46, h - 30 );
	var tw = ctx.measureText( "BROTHER-32" ).width;
	ctx.fillRect( 54 + tw, h - 56, 1.5, 28 );
	ctx.font = "11px " + FONT;
	ctx.fillText( "SEMI-MODULAR ANALOG", 62 + tw, h - 44 );
	ctx.fillText( "SYNTHESIZER + SEQUENCER", 62 + tw, h - 31 );
}

function drawSynthControls()
{
	var s = M.settings, st = M.state;
	var A = 90, B = 212;
	var time = { style: "ring", exp: true, format: fmtTime };
	var with_ = function(o, extra) { var r = {}; for(var k in o) r[k] = o[k]; for(var k in extra) r[k] = extra[k]; return r; };

	drawSection( "VCO / MIXER", 40, 700, 22 );
	s.freq = knob( "freq", 95, A, 30, s.freq, VCO_MIN, VCO_MAX, { label: "FREQUENCY", style: "ring", exp: true, def: 261.63,
		format: function(){ return fmtFreq( st.freq || s.freq ); } } );
	s.pw = knob( "pw", 215, A, 24, s.pw, 0.03, 0.97, { label: "PULSE WIDTH", def: 0.5, format: fmtPct } );
	s.vco_mod = knob( "vco_mod", 315, A, 24, s.vco_mod, 0, 1, { label: "VCO MOD AMOUNT", def: 0, format: fmtPct } );
	s.vco_mod_src = leverSwitch( "vco_mod_src", 378, A - 20, s.vco_mod_src, [["eg", "EG"], ["lfo", "LFO"]], "VCO MOD" );
	s.vco_mod_dest = leverSwitch( "vco_mod_dest", 458, A - 20, s.vco_mod_dest, [["freq", "FREQ"], ["pw", "PW"]], "VCO MOD" );
	s.wave = leverSwitch( "wave", 538, A - 20, s.wave, [["saw", "SAW"], ["pulse", "PULSE"]], "VCO WAVE" );
	s.mix = knob( "mix", 650, A, 24, s.mix, 0, 1, { label: "VCO / NOISE", def: 0,
		format: function(v){ return v < 0.01 ? "VCO" : (v > 0.99 ? "NOISE" : Math.round( (1 - v) * 100 ) + "% VCO / " + Math.round( v * 100 ) + "% NOISE"); } } );

	drawSection( "VCF", 40, 700, 148 );
	s.cutoff = knob( "cutoff", 95, B, 28, s.cutoff, 20, 20000, { label: "CUTOFF", exp: true, def: 600, format: fmtHz } );
	s.resonance = knob( "resonance", 215, B, 24, s.resonance, 0, 1, { label: "RESONANCE", def: 0, format: fmtPct } );
	s.vcf_mod = knob( "vcf_mod", 315, B, 24, s.vcf_mod, -1, 1, { label: "VCF MOD AMOUNT", bipolar: true, def: 0, format: fmtSigned } );
	s.vcf_mod_src = leverSwitch( "vcf_mod_src", 378, B - 20, s.vcf_mod_src, [["eg", "EG"], ["lfo", "LFO"]], "VCF MOD" );
	s.vcf_mode = leverSwitch( "vcf_mode", 458, B - 20, s.vcf_mode, [["hp", "HIGH"], ["lp", "LOW"]], "VCF MODE" );
	s.glide = knob( "glide", 560, B, 22, s.glide, 0, 2, { label: "GLIDE", def: 0, format: function(v){ return v < 0.001 ? "OFF" : fmtTime( v ); } } );
	s.vc_mix = knob( "vc_mix", 650, B, 22, s.vc_mix, 0, 1, { label: "VC MIX", def: 0.5,
		format: function(v){ return Math.round( (1 - v) * 100 ) + "% MIX 1 / " + Math.round( v * 100 ) + "% MIX 2"; } } );

	drawSection( "LFO / VCA", 730, 1240, 22 );
	s.lfo_rate = knob( "lfo_rate", 780, A, 24, s.lfo_rate, 0.016, 600, { label: "LFO RATE", style: "ring", exp: true, def: 3, format: fmtRate } );
	drawLed( 812, A - 36, 3.5, st.lfo > 0.2, "#ffb02f" );
	s.lfo_wave = leverSwitch( "lfo_wave", 840, A - 20, s.lfo_wave, [["tri", "TRI"], ["sq", "SQUARE"]], "LFO WAVE" );
	s.volume = knob( "volume", 960, A, 28, s.volume, 0, 1, { label: "VOLUME", def: 0.7, format: fmtPct } );
	s.vca_mode = leverSwitch( "vca_mode", 1018, A - 20, s.vca_mode, [["eg", "EG"], ["on", "ON"]], "VCA MODE" );
	// ASSIGN output source
	drawLabel( "ASSIGN", 1158, A - 54, 11 );
	drawLedColumn( 1120, A - 34, ASSIGNS.map(function(a){ return a[1]; }), function(k){ return s.assign == ASSIGNS[k][0]; } );
	if(button( "assign", 1112, A + 16, 70, 22, "ASSIGN" ).clicked)
	{
		var k = ASSIGNS.findIndex(function(a){ return a[0] == s.assign; });
		s.assign = ASSIGNS[ (k + 1) % ASSIGNS.length ][0];
	}

	drawSection( "EG / TEMPO", 730, 1240, 148 );
	s.attack = knob( "attack", 780, B, 24, s.attack, 0.001, 10, with_( time, { label: "ATTACK", def: 0.002 } ) );
	s.decay = knob( "decay", 880, B, 24, s.decay, 0.002, 10, with_( time, { label: "DECAY", def: 0.25 } ) );
	drawLed( 912, B - 36, 3.5, st.eg > 0.05, "#ffb02f" );
	s.sustain = leverSwitch( "sustain", 940, B - 20, s.sustain, [[true, "ON"], [false, "OFF"]], "SUSTAIN" );
	s.tempo = knob( "tempo", 1060, B, 30, s.tempo, 10, 1000, { label: "TEMPO", style: "ring", exp: true, def: 120,
		format: function(v){ return Math.round( v ) + " BPM"; } } );
	drawLed( 1100, B - 40, 3.5, st.clock && st.playing, "#ffb02f" );
	s.gate_length = knob( "gate_length", 1170, B, 20, s.gate_length, 0.05, 1, { label: "GATE LENGTH", def: 0.5, format: fmtPct } );
}

function drawSequencer()
{
	var s = M.settings, st = M.state, u = uiOf( M.id );
	var len = s.length;
	drawSection( "SEQUENCER", GRID_X - 30, GRID_X + 16 * (CELL_W + CELL_GAP), 266 );

	// transport and MIDI IN on the left
	if(button( "run", 50, 280, 100, 26, "RUN / STOP", st.playing ).clicked)
		send({ type: "play" });
	if(button( "reset", 160, 280, 100, 26, "RESET" ).clicked)
		send({ type: "reset" });
	if(button( "next", 50, 314, 100, 26, "NEXT STEP" ).clicked)
		send({ type: "next" });

	// step grid: 2 rows of 16
	for(var i = 0; i < STEPS; ++i)
	{
		var step = s.steps[i];
		var cx = GRID_X + (i % 16) * (CELL_W + CELL_GAP), cy = GRID_Y + Math.floor( i / 16 ) * (CELL_H + CELL_GAP);
		var inside = i < len;
		var id = id_prefix + "step" + i;
		var hover = !cable_drag && ui.active === null && hitRect( cx, cy, CELL_W, CELL_H );
		if(hover)
		{
			ui.hot = id;
			tip( "STEP " + (i + 1) + "  " + noteName( step.note ) + (step.gate ? "" : "  REST") + (step.accent ? "  ACCENT" : "") + (step.glide ? "  GLIDE" : "") +
				(u.sel == i ? "  (CLICK: REST ON / OFF)" : "  (CLICK: SELECT)"), cx + CELL_W * 0.5, cy - 10 );
		}
		if((hover && ui.pressed) | keyButton( id, cx, cy, CELL_W, CELL_H ).pressed)
		{
			if(hover && ui.pressed) ui.active = id;
			if(u.sel == i)
				step.gate = !step.gate;
			else
				u.sel = i;
		}
		var playing = st.playing && st.step == i;
		ctx.fillStyle = !inside ? "#151514" : (step.gate ? (playing ? "#e2574c" : "#3a2a26") : (playing ? "#6b3a34" : "#1f1f1e"));
		ctx.beginPath(); ctx.roundRect( cx, cy, CELL_W, CELL_H, 3 ); ctx.fill();
		if(u.sel == i)
		{
			ctx.strokeStyle = "#f2efe8";
			ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.roundRect( cx + 0.75, cy + 0.75, CELL_W - 1.5, CELL_H - 1.5, 3 ); ctx.stroke();
		}
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.font = "8px " + FONT;
		ctx.fillStyle = inside ? DIM_COLOR : "#3a3936";
		ctx.fillText( String( i + 1 ), cx + 4, cy + 8 );
		drawLabel( step.gate ? noteName( step.note ) : "–", cx + CELL_W * 0.5, cy + CELL_H * 0.5 + 3, 11, false,
			!inside ? "#3a3936" : (step.gate ? TEXT_COLOR : DIM_COLOR) );
		if(step.accent && inside)
			drawLed( cx + CELL_W - 7, cy + 7, 2.5, true, "#ffb02f" );
		if(step.glide && inside)
		{
			ctx.strokeStyle = "#7dc4ff";
			ctx.lineWidth = 1.2;
			ctx.beginPath(); ctx.moveTo( cx + 8, cy + CELL_H - 5 ); ctx.quadraticCurveTo( cx + CELL_W * 0.5, cy + CELL_H - 11, cx + CELL_W - 8, cy + CELL_H - 5 ); ctx.stroke();
		}
	}

	drawKeyboard13( GRID_X, 356, 8 * 40, 60 );

	// step editing
	var sel = s.steps[ u.sel ];
	var bx = 660;
	if(button( "rest", bx, 356, 74, 24, "REST", !sel.gate ).clicked) sel.gate = !sel.gate;
	if(button( "accent", bx + 82, 356, 74, 24, "ACCENT", sel.accent ).clicked) sel.accent = !sel.accent;
	if(button( "glide_step", bx + 164, 356, 74, 24, "GLIDE", sel.glide ).clicked) sel.glide = !sel.glide;
	if(button( "rec", bx, 388, 74, 24, "REC", u.rec ).clicked) u.rec = !u.rec;
	if(button( "oct_down", bx + 82, 388, 74, 24, "OCT -" ).clicked) u.oct = Math.max( -2, u.oct - 1 );
	if(button( "oct_up", bx + 164, 388, 74, 24, "OCT +" ).clicked) u.oct = Math.min( 2, u.oct + 1 );
	drawLcd( bx, 424, 238, 22, "STEP " + (u.sel + 1) + "/" + len + "  " + (sel.gate ? noteName( sel.note ) : "REST") +
		(sel.accent ? " ACC" : "") + (sel.glide ? " GLD" : "") + (u.rec ? "  REC" : ""), "left" );
	s.length = knob( "length", 1000, 396, 24, s.length, 1, STEPS, { label: "LENGTH", step: 1, style: "ring", def: 16, ticks: 32,
		format: function(v){ return v + " STEPS"; } } );
}

// one octave and a C: plays the synth (and transposes a running sequence); in REC it also writes
// the selected step and moves to the next one
function drawKeyboard13( x, y, w, h )
{
	var s = M.settings, u = uiOf( M.id ), st = M.state;
	var first = 48 + u.oct * 12; // C3
	var WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
	var ww = w / 8;
	var keys = WHITE.map(function(n, i){ return { note: first + n, x: x + i * ww, y: y, w: ww, h: h, black: false }; });
	var blacks = [];
	[0, 1, 3, 4, 5].forEach(function(i){ blacks.push({ note: keys[i].note + 1, x: x + (i + 1) * ww - ww * 0.3, y: y, w: ww * 0.6, h: h * 0.6, black: true }); });
	var keyAt = function( px, py ) {
		if(px < x || px > x + w || py < y || py > y + h) return null;
		for(var i = 0; i < blacks.length; ++i)
			if(px >= blacks[i].x && px <= blacks[i].x + blacks[i].w && py <= blacks[i].y + blacks[i].h) return blacks[i].note;
		return keys[ clamp( Math.floor( (px - x) / ww ), 0, 7 ) ].note;
	};
	var id = id_prefix + "keys";
	var hover = !cable_drag && hitRect( x, y, w, h );
	if(hover) ui.hot = id;
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = id;
		var n = keyAt( ui.x, ui.y );
		if(n !== null)
		{
			u.key = n;
			send({ type: "key", note: n, gate: true });
			if(u.rec)
			{
				var step = s.steps[ u.sel ];
				step.note = n;
				step.gate = true;
				u.sel = (u.sel + 1) % s.length;
			}
		}
	}
	if(u.key !== null && !(ui.active === id && ui.down))
	{
		send({ type: "key", note: u.key, gate: false });
		u.key = null;
	}
	ctx.fillStyle = "#050505";
	ctx.fillRect( x - 2, y - 2, w + 4, h + 4 );
	var lit = function(n) { return u.key === n || st.key === n; };
	keys.forEach(function(k){
		ctx.fillStyle = lit( k.note ) ? "#e2574c" : "#8f8c85";
		ctx.fillRect( k.x + 0.5, k.y, k.w - 1, k.h );
	});
	blacks.forEach(function(k){
		ctx.fillStyle = lit( k.note ) ? "#e2574c" : "#262624";
		ctx.fillRect( k.x, k.y, k.w, k.h );
	});
	drawLabel( noteName( first ) + "–" + noteName( first + 12 ), x + w * 0.5, y + h + 12, 10, false, DIM_COLOR );
}

function drawPatchBay()
{
	var x = JACK_COLS[0] - 30, h = SIZE[1];
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( x, 14, JACK_COLS[3] - x + 30, h - 28, 6 ); ctx.fill();
	ctx.font = "13px " + FONT;
	var w1 = ctx.measureText( "IN / " ).width, w2 = ctx.measureText( "OUT" ).width + 6;
	var cx = (JACK_COLS[1] + JACK_COLS[2]) * 0.5;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "IN / ", cx - (w1 + w2) * 0.5, 31 );
	ctx.fillRect( cx - (w1 + w2) * 0.5 + w1, 23, w2, 16 );
	ctx.fillStyle = "#111";
	ctx.fillText( "OUT", cx - (w1 + w2) * 0.5 + w1 + 3, 32 );
	for(var r = 0; r < 8; ++r)
		for(var c = 0; c < 4; ++c)
		{
			var j = JACKS[r][c];
			drawJack( j[2], JACK_COLS[c], 68 + r * 55, j[0], j[1] ); // rows closer than on the Subharm
		}
}

WR.registerSynth( "brother32", {
	title: "BROTHER-32",
	description: "Brother-32: semi-modular synthesizer with a 32 step sequencer",
	about: "A mono semi-modular synth with a 32-step sequencer, ladder filter, envelope and a compact keyboard.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^(run|reset|next|rec)$", 3], ["^step\\d+$", 3], ["^(rest|accent|glide_step|oct_down|oct_up)$", 2], ["^(assign|sustain)$", 0], ["", 1]],
	// a knob's sockets, lit when the mouse is over it (code.js: controlJacks)
	knob_jacks: [["^freq$", ["pitch_in", "lin_fm"]], ["^mix$", ["mix_cv", "mix1", "mix2"]], ["^gate_length$", ["gate_in"]]],
	category: "Synths",
	wood: true, // wooden sides
	worklet: "devices/b32-worklet.js",
	jacks: JACKS,
	rear_jacks: [["AUDIO OUT", "aout", "audio"]],
	audio_out: "audio",
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: function( mod ) {
		M = mod;
		M.state = M.state || { playing: false, step: 0, freq: 0, eg: 0, gate: false, lfo: 0, clock: false, key: null };
		drawBackground();
		drawSynthControls();
		drawSequencer();
		drawPatchBay();
		M = null;
	},
	transport: function( mod, action, value ) {
		if(action == "play") mod.post({ type: "play", value: value });
		else if(action == "trigger") mod.post({ type: "trigger", gate: value });
		else mod.post({ type: action }); // reset, next
	},
	tempo: function( s ) { return s.tempo; }
});

})();
