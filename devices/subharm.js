// devices/subharm.js
// SUBHARM module for the rack (a polyrhythmic subharmonic synthesizer): its settings, patch bay and panel, in two layouts
// ("hardware" is the full front panel, "classic" is the first compact layout of this
// version). The panel is drawn with the widgets of code.js; the DSP is in subharm-worklet.js.

(function(){

var VCO_MIN_FREQ = 261.63; // VCO FREQ knob range is C4..C8
var VCO_MAX_FREQ = 4186.0;
var TEMPO_MIN = 20;        // 0.333Hz..50Hz at 1 ppq
var TEMPO_MAX = 3000;
// panel size per layout: a 60HP panel (~2.37:1) plus wood cheeks
var SIZES = { hardware: [1568, 596], classic: [1460, 640] };
var QUANTIZE_MODES = ["OFF","12-ET","8-ET","12-JI","8-JI","SCL"];

// patch bay, 4 columns x 8 rows, same layout as the hardware
var JACKS = [
	[["VCO 1","in","vco1_in"], ["VCO 1 SUB","in","vco1_sub_in"], ["VCO 1 PWM","in","vco1_pwm"], ["VCA","out","vca"]],
	[["VCO 1","out","vco1"], ["VCO 1 SUB 1","out","vco1_sub1"], ["VCO 1 SUB 2","out","vco1_sub2"], ["VCA","in","vca_in"]],
	[["VCO 2","in","vco2_in"], ["VCO 2 SUB","in","vco2_sub_in"], ["VCO 2 PWM","in","vco2_pwm"], ["VCA EG","out","vca_eg"]],
	[["VCO 2","out","vco2"], ["VCO 2 SUB 1","out","vco2_sub1"], ["VCO 2 SUB 2","out","vco2_sub2"], ["CUTOFF","in","cutoff_in"]],
	[["PLAY","in","play_in"], ["RESET","in","reset_in"], ["TRIGGER","in","trigger_in"], ["VCF EG","out","vcf_eg"]],
	[["RHYTHM 1","in","rhythm1_in"], ["RHYTHM 2","in","rhythm2_in"], ["RHYTHM 3","in","rhythm3_in"], ["RHYTHM 4","in","rhythm4_in"]],
	[["SEQ 1","out","seq1"], ["SEQ 1 CLK","out","seq1_clk"], ["SEQ 2","out","seq2"], ["SEQ 2 CLK","out","seq2_clk"]],
	[null, ["CLOCK","in","clock_in"], ["CLOCK","out","clock_out"], ["TRIGGER","out","trigger_out"]] // MIDI IN is on the back
];

var M = null;          // the module being drawn: { id, settings, state, post }
var W = 0, H = 0;      // its panel size
var trigger_held = {}; // module id -> TRIGGER button held

function defaults()
{
	return {
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
		quantize: "12-ET",  // OFF, 12-ET, 8-ET, 12-JI, 8-JI, SCL (the rack's Scala scale)
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
		eg_hold: false      // EG button: envelopes locked at maximum (drone)
	};
}

function initialState()
{
	return { playing: false, step: [0,0], rhythm: [false,false,false,false], clock: false,
		clock_source: "internal", freq: [0,0], div: [[1,1],[1,1]], vca_eg: 0, vcf_eg: 0 };
}

// s: defaults merged with the loaded data; data: what was loaded
function validate( s, data )
{
	if(QUANTIZE_MODES.indexOf( s.quantize ) == -1)
		s.quantize = "12-ET";
	if([1,2,5].indexOf( s.seq_oct ) == -1)
		s.seq_oct = 1;
	// saves from before the hardware-accurate ranges
	if(data.vca_eg === false && data.eg_hold === undefined)
		s.eg_hold = true;
	s.vco.forEach(function(v){
		while(v.freq < VCO_MIN_FREQ - 0.01)
			v.freq *= 2;
	});
}

// new random sound; volume is kept
function randomize( s, rack )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var pick = function(list) { return list[ Math.floor( Math.random() * list.length ) ]; };
	var chance = function(p) { return Math.random() < p; };

	s.vco.forEach(function(v){
		v.freq = expRnd( VCO_MIN_FREQ, 1046.5 );
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
	if(rack.custom_scale)
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
}

function cycleQuantize( s )
{
	// hardware order: 12-ET, 8-ET, 12-JI, 8-JI, off (no LED). SCL only if a scale is loaded
	var order = ["12-ET","8-ET","12-JI","8-JI"];
	if(rack.custom_scale)
		order.push("SCL");
	order.push("OFF");
	var i = order.indexOf( s.quantize );
	s.quantize = order[ (i + 1) % order.length ];
}

function cycleSeqOct( s )
{
	s.seq_oct = s.seq_oct == 1 ? 2 : (s.seq_oct == 2 ? 5 : 1);
}

// message to the module's DSP (once the audio engine runs)
function send( msg )
{
	var m = M;
	act(function(){ m.post( msg ); });
}

// ---------------------------------------------------------------------------
// panel, laid out like the hardware (a 60HP panel between wood cheeks):
// sequencers / polyrhythm / transport | VCO 1 | SEQ OCT + QUANTIZE | VCO 2 | VCF + EGs | patch bay

var SEQ_COLS = [100, 180, 260, 340];
var VCO_COLS = [[455, 545, 635], [785, 875, 965]]; // SUB 1, VCO, SUB 2 columns
var CENTER_X = 710;
var FILTER_COLS = [1082, 1192];
var FILTER_ROWS = [100, 228, 356, 484];
var JACK_COLS = [1292, 1357, 1422, 1487];

function drawPanelBackground()
{
	drawCasing( 0, 0, W, H );

	drawScrew( 36, 12 ); drawScrew( W - 36, 12 );
	drawScrew( 36, H - 12 ); drawScrew( W - 36, H - 12 );
	drawScrew( 690, H - 12 ); drawScrew( 690, 12 );

	// name, bottom left
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = "bold 30px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "SUBHARM", 46, 560 );
	var w = ctx.measureText( "SUBHARM" ).width;
	ctx.fillRect( 54 + w, 534, 1.5, 28 );
	ctx.font = "11px " + FONT;
	ctx.fillText( "SEMI-MODULAR ANALOG", 62 + w, 546 );
	ctx.fillText( "POLYRHYTHMIC SYNTHESIZER", 62 + w, 559 );
}

function drawSequencers()
{
	var s = M.settings;
	var st = M.state;
	for(var i = 0; i < 2; ++i)
	{
		var y = 72 + i * 100;
		drawLabel( "SEQUENCER " + (i + 1), 220, y - 50, 13 );
		var assign = s.seq_assign[i];
		for(var k = 0; k < 4; ++k)
		{
			var cx = SEQ_COLS[k];
			s.seq[i][k] = knob( "seq" + i + "_" + k, cx, y, 13, s.seq[i][k], -1, 1, {
				label: "STEP " + (k + 1), style: "small", ticks: 9, bipolar: true, def: 0, labelSize: 10,
				format: (function(a){ return function(v){
					var semis = v * s.seq_oct * 12;
					var txt = (semis > 0 ? "+" : "") + semis.toFixed(1) + " st";
					if(a.sub1 || a.sub2)
					{
						var d = Math.round( v * s.seq_oct * 3 );
						txt += "  ÷" + (d >= 0 ? "+" : "") + d;
					}
					return txt;
				}; })( assign )
			});
			drawLed( cx, y + 30, 4.5, st.step[i] == k );
		}
	}
}

function drawPolyrhythm()
{
	var s = M.settings;
	drawLabel( "POLYRHYTHM", 220, 228, 13 );
	for(var i = 0; i < 4; ++i)
	{
		var cx = SEQ_COLS[i];
		ctx.strokeStyle = "#8a877f";
		ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo( cx, 272 ); ctx.lineTo( cx, 330 ); ctx.stroke();
		s.rhythm[i] = knob( "rhythm" + i, cx, 272, 14, s.rhythm[i], 1, 16, {
			label: "RHYTHM " + (i + 1), style: "ring", step: 1, def: 1, labelSize: 10, format: fmtDiv
		});
		if(button( "r" + i + "s1", cx - 24, 300, 48, 20, "SEQ 1", s.rhythm_seq1[i] ).clicked)
			s.rhythm_seq1[i] = !s.rhythm_seq1[i];
		if(button( "r" + i + "s2", cx - 24, 326, 48, 20, "SEQ 2", s.rhythm_seq2[i] ).clicked)
			s.rhythm_seq2[i] = !s.rhythm_seq2[i];
	}
}

function drawTransport()
{
	var s = M.settings;
	var st = M.state;

	s.tempo = knob( "tempo", 84, 446, 38, s.tempo, TEMPO_MIN, TEMPO_MAX, {
		label: "TEMPO", labelSize: 13, style: "ring", exp: true, def: 120,
		format: function(v){
			if(st.clock_source == "midi") return "MIDI CLOCK";
			if(st.clock_source == "patch") return "EXT CLOCK";
			return Math.round(v) + " BPM";
		}
	});

	if(button( "reset", 160, 410, 54, 26, "RESET" ).clicked)
		send({ type: "reset" });
	// EG is lit normally and blinks while the envelopes are held open
	var blink = (performance.now() % 600) < 300;
	if(button( "eg", 222, 410, 54, 26, "EG", s.eg_hold ? blink : true ).clicked)
		s.eg_hold = !s.eg_hold;
	if(button( "next", 284, 410, 54, 26, "NEXT" ).clicked)
		send({ type: "next" });

	if(button( "play", 160, 450, 84, 28, "PLAY", st.playing ).clicked)
		send({ type: "play" });
	var trig = button( "trigger", 254, 450, 84, 28, "TRIGGER", trigger_held[ M.id ] );
	if(trig.clicked)
		send({ type: "trigger", gate: true });
	if((trigger_held[ M.id ] || trig.clicked) && !trig.held)
		send({ type: "trigger", gate: false });
	trigger_held[ M.id ] = trig.held;
}

function drawOscillators()
{
	var s = M.settings;
	var st = M.state;

	// OSCILLATORS header with the 1 / 2 boxes
	var x1 = VCO_COLS[0][0] - 45, x2 = VCO_COLS[1][2] + 45;
	drawSection( "OSCILLATORS", x1 + 30, x2 - 30, 26 );
	[[x1, "1"], [x2 - 22, "2"]].forEach(function(b){
		ctx.strokeStyle = TEXT_COLOR;
		ctx.lineWidth = 1.2;
		ctx.strokeRect( b[0], 17, 22, 18 );
		drawLabel( b[1], b[0] + 11, 26, 12 );
	});

	for(var i = 0; i < 2; ++i)
	{
		var osc = s.vco[i];
		var n = i + 1;
		var cols = VCO_COLS[i];
		var assign = s.seq_assign[i];

		osc.freq = knob( "vco" + n + "_freq", cols[1], 100, 38, osc.freq, VCO_MIN_FREQ, VCO_MAX_FREQ, {
			label: "VCO " + n + " FREQ", labelSize: 12, style: "ring", exp: true, def: i == 0 ? 261.63 : 392,
			format: (function(i){ return function(){ return freqToNoteName( st.freq[i] ) + "  " + fmtHz( st.freq[i] ); }; })(i)
		});
		var wx = i == 0 ? cols[0] - 7 : cols[2] - 7;
		drawLabel( "VCO " + n + " WAVE", wx + 7, 57, 10 );
		osc.wave = waveSwitch( "vco" + n + "_wave", wx, 74, osc.wave, i == 0 );

		[["sub1", "SUB 1 FREQ", cols[0], 0], ["sub2", "SUB 2 FREQ", cols[2], 1]].forEach(function(sub){
			osc[ sub[0] ] = knob( "vco" + n + "_" + sub[0], sub[2], 200, 28, osc[ sub[0] ], 1, 16, {
				label: sub[1], style: "ring", step: 1, reverse: true, def: sub[3] ? 4 : 2,
				format: (function(i, k){ return function(v){
					var div = st.div[i][k] || v;
					return "÷" + div + "  " + fmtHz( st.freq[i] / div );
				}; })(i, sub[3])
			});
		});

		// SEQ ASSIGN bracket with the three buttons
		ctx.strokeStyle = "#a9a69e";
		ctx.lineWidth = 1;
		ctx.strokeRect( cols[0] - 2, 252, cols[2] - cols[0] + 4, 30 );
		ctx.fillStyle = "#1a1a19";
		ctx.fillRect( cols[1] - 46, 246, 92, 12 );
		drawLabel( "SEQ " + n + " ASSIGN", cols[1], 252, 10 );
		[["osc", "OSC " + n, cols[0]], ["sub1", "SUB 1", cols[1]], ["sub2", "SUB 2", cols[2]]].forEach(function(b){
			if(button( "assign" + n + b[0], b[2] - 26, 270, 52, 22, b[1], assign[ b[0] ] ).clicked)
				assign[ b[0] ] = !assign[ b[0] ];
		});

		// mixer: VCO level above, sub levels below, in the same columns
		osc.level = knob( "vco" + n + "_level", cols[1], 362, 26, osc.level, 0, 1, {
			label: "VCO " + n + " LEVEL", def: 0, format: fmtPct
		});
		osc.sub1_level = knob( "vco" + n + "_sub1_level", cols[0], 462, 26, osc.sub1_level, 0, 1, {
			label: "SUB 1 LEVEL", def: 0, format: fmtPct
		});
		osc.sub2_level = knob( "vco" + n + "_sub2_level", cols[2], 462, 26, osc.sub2_level, 0, 1, {
			label: "SUB 2 LEVEL", def: 0, format: fmtPct
		});
	}
}

function drawCenterStrip()
{
	var s = M.settings;
	var x = CENTER_X;
	ctx.strokeStyle = "#a9a69e";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo( x, 34 ); ctx.lineTo( x, 62 );
	ctx.moveTo( x, 170 ); ctx.lineTo( x, 232 );
	ctx.moveTo( x, 424 ); ctx.lineTo( x, H - 40 );
	ctx.stroke();

	[[5, "±5"], [2, "±2"], [1, "±1"]].forEach(function(o, k){
		drawLed( x - 8, 78 + k * 22, 4.5, s.seq_oct == o[0] );
		drawLabel( o[1], x + 12, 78 + k * 22, 11 );
	});
	if(button( "seq_oct", x - 30, 142, 60, 24, "SEQ OCT" ).clicked)
		cycleSeqOct( s );

	var modes = [["12-ET","12-ET"], ["8-ET","8-ET"], ["12-JI","12-JI"], ["8-JI","8-JI"], ["SCL","SCALA"]];
	modes.forEach(function(m, k){
		var y = 248 + k * 22;
		var available = m[0] != "SCL" || rack.custom_scale;
		drawLed( x - 16, y, 4.5, s.quantize == m[0] );
		ctx.textAlign = "left";
		ctx.font = "11px " + FONT;
		ctx.fillStyle = available ? TEXT_COLOR : "#55534e";
		ctx.fillText( m[1], x - 6, y + 1 );
	});
	if(button( "quantize", x - 34, 364, 68, 24, "QUANTIZE" ).clicked)
		cycleQuantize( s );
	if(s.quantize == "SCL" && rack.custom_scale)
	{
		var name = rack.custom_scale.file.replace(/\.scl$/, "");
		drawLabel( name.length > 14 ? name.substr(0, 13) + "…" : name, x, 404, 10, false, DIM_COLOR );
	}
}

function drawFilterSection()
{
	var s = M.settings;
	var A = FILTER_COLS[0], B = FILTER_COLS[1], R = FILTER_ROWS;

	s.cutoff = knob( "cutoff", A, R[0], 38, s.cutoff, 20, 20000, {
		label: "CUTOFF", labelSize: 13, exp: true, def: 900, format: fmtHz
	});
	s.volume = knob( "volume", B, R[0], 38, s.volume, 0, 1, {
		label: "VOLUME", labelSize: 13, def: 0.7, format: fmtPct
	});
	s.resonance = knob( "resonance", A, R[1], 38, s.resonance, 0, 1, {
		label: "RESONANCE", labelSize: 13, def: 0, format: fmtPct
	});
	s.vcf_eg_amt = knob( "vcf_eg_amt", B, R[1], 38, s.vcf_eg_amt, -1, 1, {
		label: "VCF EG AMT", labelSize: 13, bipolar: true, def: 0, format: fmtSigned
	});
	s.vcf_attack = knob( "vcf_attack", A, R[2], 38, s.vcf_attack, 0.001, 10, {
		label: "VCF ATTACK", labelSize: 13, style: "ring", exp: true, def: 0.001, format: fmtTime
	});
	s.vcf_decay = knob( "vcf_decay", B, R[2], 38, s.vcf_decay, 0.01, 10, {
		label: "VCF DECAY", labelSize: 13, style: "ring", exp: true, def: 0.3, format: fmtTime
	});
	s.vca_attack = knob( "vca_attack", A, R[3], 38, s.vca_attack, 0.001, 10, {
		label: "VCA ATTACK", labelSize: 13, style: "ring", exp: true, def: 0.001, format: fmtTime
	});
	s.vca_decay = knob( "vca_decay", B, R[3], 38, s.vca_decay, 0.01, 10, {
		label: "VCA DECAY", labelSize: 13, style: "ring", exp: true, def: 0.5, format: fmtTime
	});
}

function drawPatchBay()
{
	var x = JACK_COLS[0] - 30;
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( x, 14, JACK_COLS[3] - x + 30, H - 28, 6 ); ctx.fill();
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

	for(var r = 0; r < JACKS.length; ++r)
		for(var c = 0; c < 4; ++c)
		{
			var j = JACKS[r][c];
			if(!j) { drawLabel( "MIDI: BACK", JACK_COLS[c], 74 + r * 69, 9, false, DIM_COLOR ); continue; } // MIDI IN is on the back
			drawJack( j[2], JACK_COLS[c], 74 + r * 69, j[0], j[1] );
		}
}

// ---------------------------------------------------------------------------
// classic layout: the first compact arrangement (toolbar "Layout" button)



function classicBackground()
{
	drawCasing( 0, 0, W, H );

	// patch bay plate
	ctx.fillStyle = "#222220";
	ctx.beginPath(); ctx.roundRect( 1095, 14, 330, H - 28, 8 ); ctx.fill();
	ctx.strokeStyle = "#353532";
	ctx.lineWidth = 1;
	ctx.stroke();

	drawScrew( 36, 14 ); drawScrew( W - 36, 14 );
	drawScrew( 36, H - 14 ); drawScrew( W - 36, H - 14 );

	ctx.font = "26px " + FONT;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "SUBHARM", 50, H - 24 );
	ctx.font = "12px " + FONT;
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( "POLYRHYTHMIC SUBHARMONIC SYNTHESIZER", 150, H - 22 );
}

function classicOscillatorGroup( i, gx )
{
	var s = M.settings;
	var osc = s.vco[i];
	var st = M.state;
	var n = i + 1;

	drawSection( "VCO " + n, gx, gx + 340, 22 );

	osc.freq = knob( "vco" + n + "_freq", gx + 70, 108, 42, osc.freq, VCO_MIN_FREQ, VCO_MAX_FREQ, {
		label: "VCO " + n + " FREQ", labelSize: 13, exp: true, def: i == 0 ? 261.63 : 392,
		format: function(){ return freqToNoteName( st.freq[i] ); }
	});
	drawLabel( fmtHz( st.freq[i] || osc.freq ), gx + 70, 166, 11, false, DIM_COLOR );

	var subs = [["sub1", "SUB 1 FREQ", gx + 175], ["sub2", "SUB 2 FREQ", gx + 262]];
	subs.forEach(function(sub, k){
		osc[ sub[0] ] = knob( "vco" + n + "_" + sub[0], sub[2], 108, 29, osc[ sub[0] ], 1, 16, {
			label: sub[1], step: 1, def: k == 0 ? 2 : 4, format: fmtDiv
		});
		var div = st.div[i][k] || osc[ sub[0] ];
		drawLabel( fmtDiv( div ) + "  " + fmtHz( (st.freq[i] || osc.freq) / div ), sub[2], 166, 11, false, DIM_COLOR );
	});

	drawLabel( "WAVE", gx + 322, 62, 11 );
	osc.wave = waveSwitch( "vco" + n + "_wave", gx + 314, 84, osc.wave );

	// mixer + sequencer assign
	drawSection( "MIXER", gx, gx + 340, 186 );
	var levels = [["level", "VCO " + n + " LEVEL", gx + 70, "osc", "OSC " + n],
	              ["sub1_level", "SUB 1 LEVEL", gx + 175, "sub1", "SUB 1"],
	              ["sub2_level", "SUB 2 LEVEL", gx + 262, "sub2", "SUB 2"]];
	var assign = s.seq_assign[i];
	levels.forEach(function(l){
		osc[ l[0] ] = knob( "vco" + n + "_" + l[0], l[2], 248, 24, osc[ l[0] ], 0, 1, {
			label: l[1], def: 0, format: fmtPct
		});
		if(button( "assign" + n + l[3], l[2] - 25, 287, 50, 20, l[4], assign[ l[3] ] ).clicked)
			assign[ l[3] ] = !assign[ l[3] ];
	});
	drawLabel( "SEQ " + n + " ASSIGN", gx + 166, 318, 11, false, DIM_COLOR );

	// sequencer
	drawSection( "SEQUENCER " + n, gx, gx + 340, 334 );
	var steps = s.seq[i];
	for(var k = 0; k < 4; ++k)
	{
		var cx = gx + 40 + k * 86;
		steps[k] = knob( "seq" + n + "_" + k, cx, 390, 22, steps[k], -1, 1, {
			label: "STEP " + (k + 1), bipolar: true, def: 0,
			format: function(v){
				var semis = v * s.seq_oct * 12;
				var txt = (semis > 0 ? "+" : "") + semis.toFixed(1) + " st";
				if(assign.sub1 || assign.sub2)
				{
					var d = Math.round( v * s.seq_oct * 3 );
					txt += "  ÷" + (d >= 0 ? "+" : "") + d;
				}
				return txt;
			}
		});
		drawLed( cx, 424, 4.5, st.step[i] == k );
	}
}

function classicClockSection( gx )
{
	var s = M.settings;
	var st = M.state;

	drawSection( "CLOCK", gx, gx + 340, 442 );
	s.tempo = knob( "tempo", gx + 70, 510, 38, s.tempo, TEMPO_MIN, TEMPO_MAX, {
		label: "TEMPO", labelSize: 13, exp: true, def: 120,
		format: function(v){ return Math.round(v) + " BPM"; }
	});
	drawLed( gx + 122, 468, 4, st.clock && st.playing, "#ffb02f" );
	var src = st.clock_source == "internal" ? Math.round( s.tempo ) + " BPM" : (st.clock_source == "midi" ? "MIDI CLOCK" : "EXT CLOCK");
	drawLabel( src, gx + 70, 566, 11, false, DIM_COLOR );

	var bx = gx + 148, bw = 58, bh = 26;
	if(button( "play", bx, 476, bw, bh, "PLAY", st.playing ).clicked)
		send({ type: "play" });
	if(button( "reset", bx + 68, 476, bw, bh, "RESET" ).clicked)
		send({ type: "reset" });
	var trig = button( "trigger", bx + 136, 476, bw, bh, "TRIGGER" );
	if(trig.clicked)
		send({ type: "trigger", gate: true });
	if((trigger_held[ M.id ] || trig.clicked) && !trig.held)
		send({ type: "trigger", gate: false });
	trigger_held[ M.id ] = trig.held;

	if(button( "next", bx, 520, bw, bh, "NEXT" ).clicked)
		send({ type: "next" });
	if(button( "eg", bx + 68, 520, bw, bh, "EG HOLD", s.eg_hold ).clicked)
		s.eg_hold = !s.eg_hold;
	drawLabel( "HOLD = DRONE", bx + 97, 558, 10, false, DIM_COLOR );
}

function classicPolyrhythm( gx )
{
	var s = M.settings;
	var st = M.state;

	drawSection( "POLYRHYTHM", gx, gx + 340, 442 );
	for(var i = 0; i < 4; ++i)
	{
		var cx = gx + 40 + i * 86;
		s.rhythm[i] = knob( "rhythm" + i, cx, 496, 24, s.rhythm[i], 1, 16, {
			label: "RHYTHM " + (i + 1), step: 1, def: 1, format: fmtDiv
		});
		drawLed( cx + 36, 456, 3.5, st.rhythm[i] && st.playing, "#ffb02f" );
		if(button( "r" + i + "s1", cx - 25, 534, 50, 20, "SEQ 1", s.rhythm_seq1[i] ).clicked)
			s.rhythm_seq1[i] = !s.rhythm_seq1[i];
		if(button( "r" + i + "s2", cx - 25, 560, 50, 20, "SEQ 2", s.rhythm_seq2[i] ).clicked)
			s.rhythm_seq2[i] = !s.rhythm_seq2[i];
	}
}

function classicFilterSection( gx )
{
	var s = M.settings;
	var st = M.state;

	drawSection( "VCF", gx, gx + 310, 22 );
	s.cutoff = knob( "cutoff", gx + 70, 108, 42, s.cutoff, 20, 20000, {
		label: "CUTOFF", labelSize: 13, exp: true, def: 900, format: fmtHz
	});
	s.resonance = knob( "resonance", gx + 215, 108, 34, s.resonance, 0, 1, {
		label: "RESONANCE", labelSize: 13, def: 0, format: fmtPct
	});

	drawSection( "VCF EG", gx, gx + 310, 186 );
	s.vcf_eg_amt = knob( "vcf_eg_amt", gx + 50, 248, 25, s.vcf_eg_amt, -1, 1, {
		label: "VCF EG AMT", bipolar: true, def: 0, format: fmtSigned
	});
	s.vcf_attack = knob( "vcf_attack", gx + 155, 248, 25, s.vcf_attack, 0.001, 10, {
		label: "VCF ATTACK", exp: true, def: 0.001, format: fmtTime
	});
	s.vcf_decay = knob( "vcf_decay", gx + 260, 248, 25, s.vcf_decay, 0.01, 10, {
		label: "VCF DECAY", exp: true, def: 0.3, format: fmtTime
	});
	drawLed( gx + 302, 207, 3.5, st.vcf_eg > 0.05, "#ffb02f" );

	drawSection( "VCA", gx, gx + 310, 334 );
	s.vca_attack = knob( "vca_attack", gx + 50, 390, 25, s.vca_attack, 0.001, 10, {
		label: "VCA ATTACK", exp: true, def: 0.001, format: fmtTime
	});
	s.vca_decay = knob( "vca_decay", gx + 155, 390, 25, s.vca_decay, 0.01, 10, {
		label: "VCA DECAY", exp: true, def: 0.5, format: fmtTime
	});
	s.volume = knob( "volume", gx + 260, 392, 29, s.volume, 0, 1, {
		label: "VOLUME", def: 0.7, format: fmtPct
	});
	drawLed( gx + 197, 349, 3.5, st.vca_eg > 0.05, "#ffb02f" );

	drawSection( "SEQ / QUANTIZE", gx, gx + 310, 442 );
	[[5,"±5"],[2,"±2"],[1,"±1"]].forEach(function(o, k){
		drawLed( gx + 50, 478 + k * 22, 4.5, s.seq_oct == o[0] );
		drawLabel( o[1], gx + 72, 478 + k * 22, 12 );
	});
	if(button( "seq_oct", gx + 20, 552, 70, 24, "SEQ OCT" ).clicked)
		cycleSeqOct( s );

	var modes = [["12-ET","12-ET"],["8-ET","8-ET"],["12-JI","12-JI"],["8-JI","8-JI"],["SCL","SCALA"]];
	modes.forEach(function(m, k){
		var y = 464 + k * 20;
		var available = m[0] != "SCL" || rack.custom_scale;
		drawLed( gx + 170, y, 4.5, s.quantize == m[0] );
		drawLabel( m[1], gx + 200, y, 12, false, available ? TEXT_COLOR : "#55534e" );
	});
	if(button( "quantize", gx + 150, 566, 80, 24, "QUANTIZE" ).clicked)
		cycleQuantize( s );
	if(s.quantize == "SCL" && rack.custom_scale)
	{
		var name = rack.custom_scale.file.replace(/\.scl$/, "");
		drawLabel( name.length > 22 ? name.substr(0, 21) + "…" : name, gx + 190, 604, 11, false, DIM_COLOR );
	}
	else if(s.quantize == "OFF")
		drawLabel( "OFF (NO QUANTIZE)", gx + 190, 604, 11, false, DIM_COLOR );
}

function classicPatchBay()
{
	for(var r = 0; r < JACKS.length; ++r)
		for(var c = 0; c < 4; ++c)
		{
			var j = JACKS[r][c];
			if(!j) { drawLabel( "MIDI: BACK", 1158 + c * 68, 62 + r * 70, 9, false, DIM_COLOR ); continue; } // MIDI IN is on the back
			drawJack( j[2], 1158 + c * 68, 62 + r * 70, j[0], j[1] );
		}
}

function drawClassicPanel()
{
	classicBackground();
	classicOscillatorGroup( 0, 40 );
	classicOscillatorGroup( 1, 400 );
	classicClockSection( 40 );
	classicPolyrhythm( 400 );
	classicFilterSection( 765 );
	classicPatchBay();
}

function drawHardwarePanel()
{
	drawPanelBackground();
	drawSequencers();
	drawPolyrhythm();
	drawTransport();
	drawOscillators();
	drawCenterStrip();
	drawFilterSection();
	drawPatchBay();
}

WR.registerSynth( "subharm", {
	title: "SUBHARM",
	description: "SUBHARM: polyrhythmic subharmonic synthesizer",
	about: "A polyrhythmic synthesizer: 2 VCOs with 4 subharmonics, 2 four-step sequencers and 4 polyrhythmic clock dividers. Polyrhythms that lock together.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^(play|trigger|reset|next)$", 3], ["^r\\ds\\d$", 2], ["^assign", 2], ["^(quantize|seq_oct|eg)$", 1]],
	// a knob's sockets, lit when the mouse is over it (code.js: controlJacks)
	knob_jacks: [["^rhythm(\\d)$", function(m){ return ["rhythm" + (+m[1] + 1) + "_in"]; }], ["^tempo$", ["clock_in"]], ["^vco(\\d)_pw", function(m){ return ["vco" + m[1] + "_pwm"]; }]],
	worklet: "devices/subharm-worklet.js",
	jacks: JACKS,
	category: "Synths",
	wood: true, // wooden sides
	midi_in: "midi_in",
	rear_jacks: [["AUDIO OUT", "aout", "audio"]], // line level, on the back
	audio_out: "audio",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return SIZES[ layout ] || SIZES.hardware; },
	draw: function( mod ) {
		M = mod;
		M.state = M.state || initialState();
		var size = SIZES[ layout ] || SIZES.hardware;
		W = size[0];
		H = size[1];
		if(layout == "classic")
			drawClassicPanel();
		else
			drawHardwarePanel();
		M = null;
	},
	transport: function( mod, action, value ) {
		if(action == "play") mod.post({ type: "play", value: value });
		else if(action == "trigger") mod.post({ type: "trigger", gate: value });
		else mod.post({ type: action }); // reset, next
	},
	tempo: function( s ) { return s.tempo; },
	onScale: function( s, loaded ) {
		if(loaded)
			s.quantize = "SCL";
		else if(s.quantize == "SCL")
			s.quantize = "12-ET";
	}
});

})();
