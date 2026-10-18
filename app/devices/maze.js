// devices/maze.js
// Maze module, a generative semi-modular synthesizer: settings, the 32 point patch bay and the panel: two rows of voice controls
// (oscillators, mixer, wavefolder, filter, blend and envelopes), the two generative bit sequencers
// below with their buttons, CORRUPT and CV RANGE, and the transport, quantizer and ORDER switch.
// Bits can also be clicked directly to flip them. DSP in maze-worklet.js.

(function(){

var SIZE = [1568, 500]; // 60HP, more compact than the other panels
var BITS = 8;
var SCALE_NAMES = ["UNQUANTIZED", "CHROMATIC", "MAJOR", "PENTATONIC", "MELODIC MINOR", "HARMONIC MINOR", "DIMINISHED 6TH",
	"WHOLE TONE", "HIRAJOSHI", "7 SUS 4", "MAJOR 7TH", "MINOR", "MINOR 7TH", "DORIAN", "HANG DRUM"];

// patch bay, 4 columns x 8 rows, in the order of the manual (inputs, outputs with inverted labels)
var JACKS = [
	[["VCO 1V/OCT","in","vco_pitch"], ["M VCO SYNC","in","mvco_sync"], ["M VCO 1V/OCT","in","mvco_pitch"], ["VCA","out","vca"]],
	[["BLEND","in","blend_in"], ["M VCO","out","mvco"], ["NOISE","out","noise"], ["MIXER","out","mixer"]],
	[["VCW IN","in","vcw_in"], ["VCW FOLD","in","fold_in"], ["VCW VCA CV","in","vcw_vca"], ["EG1","out","eg1"]],
	[["VCF IN","in","vcf_in"], ["CUTOFF","in","cutoff_in"], ["VCF VCA CV","in","vcf_vca"], ["EG2","out","eg2"]],
	[["U MIX 1 (RING)","in","umix1"], ["U MIX 2","in","umix2"], ["EG2 TRIG","in","eg2_trig"], ["U MIX 1+2","out","umix_out"]],
	[["CLOCK 1","in","clock1"], ["BIT FLIP 1","in","bit_flip1"], ["SEQ1 CV","out","seq1_cv"], ["SEQ1 TRIG","out","seq1_trig"]],
	[["CLOCK 2","in","clock2"], ["BIT FLIP 2","in","bit_flip2"], ["SEQ2 CV","out","seq2_cv"], ["SEQ2 TRIG","out","seq2_trig"]],
	[null, ["TRIGGER","in","trigger_in"], ["RESET","in","reset_in"], ["CLOCK","out","clock_out"]]
];

var M = null;
var ui_state = {}; // module id -> { buffer_down: time the BUFFER button went down, saved: flash until }

function newId() { return "p" + Math.random().toString(36).substr(2, 8); }

function pattern( bits, cvs, length )
{
	return { bits: bits.map(function(b){ return !!b; }), cv: cvs.slice(), length: length };
}

function defaults()
{
	return {
		vco_freq: 261.63, vco_eg1: 0, vco_seq1: 1, fm_amt: 0,
		mvco_freq: 3, mvco_eg1: 0, mvco_seq2: 0,
		vco_lvl: 0.5, mvco_lvl: 0, ring_lvl: 0, noise_lvl: 0, noise_tone: 0.5,
		fold: 0.15, bias: 0, vcw_eg1: 0.35, vcw_seq1: 0,
		cutoff: 1200, resonance: 0.3, filter_type: 0, vcf_eg1: 0.35, vcf_seq2: 0,
		blend: 0.5, order: "parallel",            // "parallel" | "vcw_vcf" | "vcf_vcw"
		eg1_decay: 0.25, eg2_decay: 0.5, eg_trig_mix: 0.5, volume: 0.7, umix1_lvl: 0.5,
		tempo: 120, quantize: 2, chain: false,    // quantize: index in SCALE_NAMES (2 = major)
		corrupt: [0, 0], cv_range: [0.35, 0.2],
		seq: [pattern([1,0,1,1,0,1,0,0], [0, 1.2, -2.5, 0.7, 3.1, -0.4, 1.9, -1.6], 8),
		      pattern([1,0,0,1,0,0,1,0], [-1, 2.2, 0.4, -3, 1.4, 4, -0.8, 0.9], 8)],
		buffer: null,
		seq_id: ""                                // new on every load: the DSP adopts `seq` then
	};
}

var ORDERS = ["parallel", "vcw_vcf", "vcf_vcw"];

function validate( s, data )
{
	if(ORDERS.indexOf( s.order ) == -1)
		s.order = "parallel";
	s.quantize = Math.max( 0, Math.min( SCALE_NAMES.length - 1, Math.round( s.quantize ) ) );
	s.seq.forEach(function(q){ q.length = Math.max( 1, Math.min( BITS, Math.round( q.length ) ) ); });
	// the buffer is a pattern or nothing
	var b = data && data.buffer;
	s.buffer = b && Array.isArray(b) && b.length == 2 ? WR.mergeValid( defaults().seq, b ) : null;
	s.seq_id = newId();
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var chance = function(p) { return Math.random() < p; };
	s.vco_freq = expRnd( 80, 800 );
	s.vco_eg1 = chance(0.5) ? rnd( -0.3, 0.6 ) : 0;
	s.fm_amt = chance(0.4) ? rnd( 0, 0.5 ) : 0;
	s.mvco_freq = expRnd( 0.5, 900 );
	s.vco_lvl = rnd( 0.3, 0.8 );
	s.mvco_lvl = chance(0.4) ? rnd( 0, 0.5 ) : 0;
	s.ring_lvl = chance(0.3) ? rnd( 0, 0.6 ) : 0;
	s.noise_lvl = chance(0.3) ? rnd( 0, 0.5 ) : 0;
	s.fold = rnd( 0, 0.6 );
	s.bias = rnd( -0.4, 0.4 );
	s.vcw_eg1 = rnd( -0.3, 0.7 );
	s.cutoff = expRnd( 200, 5000 );
	s.resonance = rnd( 0, 0.8 );
	s.filter_type = rnd( 0, 1 );
	s.vcf_eg1 = rnd( -0.3, 0.7 );
	s.blend = rnd( 0, 1 );
	s.order = ORDERS[ Math.floor( Math.random() * 3 ) ];
	s.eg1_decay = expRnd( 0.03, 1.5 );
	s.eg2_decay = expRnd( 0.05, 2 );
	s.eg_trig_mix = rnd( 0, 1 );
	s.quantize = Math.floor( rnd( 1, SCALE_NAMES.length ) );
	s.cv_range = [ rnd( 0.1, 0.6 ), rnd( 0, 0.5 ) ];
	s.seq.forEach(function(q){
		for(var i = 0; i < BITS; ++i) { q.bits[i] = chance(0.5); q.cv[i] = rnd( -5, 5 ); }
		q.length = chance(0.6) ? 8 : Math.floor( rnd( 3, 8 ) );
	});
	s.seq_id = newId();
}

function send( msg )
{
	var m = M;
	act(function(){ m.post( msg ); });
}

function clone( o ) { return JSON.parse( JSON.stringify( o ) ); }

// ---------------------------------------------------------------------------
// panel

var COLS = [85, 180, 272, 364, 456, 548, 650, 742, 834, 926, 1020, 1112, 1204];
var ROWS = [90, 208];
var JACK_COLS = [1292, 1357, 1422, 1487];
var BIT_X0 = 380, BIT_DX = 50, SEQ_Y = [306, 372];

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
	ctx.fillText( "MAZE", 46, h - 30 );
	var tw = ctx.measureText( "MAZE" ).width;
	ctx.fillRect( 54 + tw, h - 56, 1.5, 28 );
	ctx.font = "11px " + FONT;
	ctx.fillText( "PARALLEL GENERATIVE", 62 + tw, h - 44 );
	ctx.fillText( "ANALOG SYNTHESIZER", 62 + tw, h - 31 );
}

function drawVoice()
{
	var s = M.settings, st = M.state;
	var A = ROWS[0], B = ROWS[1];
	var amt = function(label) { return { label: label, bipolar: true, def: 0, format: fmtSigned, labelSize: 10 }; };
	var lvl = function(label, def) { return { label: label, def: def, labelSize: 10,
		format: function(v){ return fmtPct(v) + (v > 0.5 ? "  (OVERDRIVE)" : ""); } }; };
	var hz = function(i, def) { return function(){ var f = st.freq ? st.freq[i] : 0; return (i ? "" : freqToNoteName( f ) + "  ") + fmtHz( f || def ); }; };

	drawSection( "OSCILLATORS", 40, 400, 22 );
	drawSection( "MIXER", 420, 590, 22 );
	drawSection( "VCW / VCF", 610, 970, 22 );
	drawSection( "OUTPUT / EG", 985, 1245, 22 );

	s.vco_freq = knob( "vco_freq", COLS[0], A, 30, s.vco_freq, 20, 5000, { label: "VCO FREQUENCY", style: "ring", exp: true, def: 261.63, labelSize: 10, format: hz( 0, s.vco_freq ) } );
	s.vco_eg1 = knob( "vco_eg1", COLS[1], A, 20, s.vco_eg1, -1, 1, amt( "VCO EG1 AMT" ) );
	s.vco_seq1 = knob( "vco_seq1", COLS[2], A, 20, s.vco_seq1, 0, 1, { label: "SEQ1 AMT", def: 0, labelSize: 10,
		format: function(v){ return v > 0.995 ? "QTZ (1V/OCT)" : fmtPct( v ); } } );
	s.fm_amt = knob( "fm_amt", COLS[3], A, 20, s.fm_amt, 0, 1, { label: "M VCO FM AMT", def: 0, labelSize: 10, format: fmtPct } );
	s.mvco_freq = knob( "mvco_freq", COLS[0], B, 30, s.mvco_freq, 0.05, 1300, { label: "MOD VCO FREQUENCY", style: "ring", exp: true, def: 3, labelSize: 10, format: hz( 1, s.mvco_freq ) } );
	s.mvco_eg1 = knob( "mvco_eg1", COLS[1], B, 20, s.mvco_eg1, -1, 1, amt( "M VCO EG1 AMT" ) );
	s.mvco_seq2 = knob( "mvco_seq2", COLS[2], B, 20, s.mvco_seq2, 0, 1, { label: "SEQ2 AMT", def: 0, labelSize: 10,
		format: function(v){ return v > 0.995 ? "QTZ (1V/OCT)" : fmtPct( v ); } } );
	s.noise_tone = knob( "noise_tone", COLS[3], B, 20, s.noise_tone, 0, 1, { label: "NOISE TONE", def: 0.5, labelSize: 10,
		format: function(v){ return v < 0.4 ? "DARK" : (v > 0.6 ? "BRIGHT" : "WHITE"); } } );

	s.vco_lvl = knob( "vco_lvl", COLS[4], A, 20, s.vco_lvl, 0, 1, lvl( "VCO LVL", 0.5 ) );
	s.ring_lvl = knob( "ring_lvl", COLS[5], A, 20, s.ring_lvl, 0, 1, lvl( "RING MOD LVL", 0 ) );
	s.mvco_lvl = knob( "mvco_lvl", COLS[4], B, 20, s.mvco_lvl, 0, 1, lvl( "MOD VCO LVL", 0 ) );
	s.noise_lvl = knob( "noise_lvl", COLS[5], B, 20, s.noise_lvl, 0, 1, lvl( "NOISE LVL", 0 ) );

	s.fold = knob( "fold", COLS[6], A, 24, s.fold, 0, 1, { label: "VCW FOLD", def: 0, labelSize: 10, format: fmtPct } );
	s.bias = knob( "bias", COLS[7], A, 20, s.bias, -1, 1, amt( "VCW BIAS" ) );
	s.vcw_eg1 = knob( "vcw_eg1", COLS[8], A, 20, s.vcw_eg1, -1, 1, amt( "EG1/CV AMT" ) );
	s.vcw_seq1 = knob( "vcw_seq1", COLS[9], A, 20, s.vcw_seq1, 0, 1, { label: "VCW SEQ1 AMT", def: 0, labelSize: 10, format: fmtPct } );
	s.cutoff = knob( "cutoff", COLS[6], B, 24, s.cutoff, 20, 20000, { label: "VCF CUTOFF", exp: true, def: 1200, labelSize: 10, format: fmtHz } );
	s.resonance = knob( "resonance", COLS[7], B, 20, s.resonance, 0, 1, { label: "RESONANCE", def: 0, labelSize: 10, format: fmtPct } );
	s.vcf_eg1 = knob( "vcf_eg1", COLS[8], B, 20, s.vcf_eg1, -1, 1, amt( "EG1/CV AMT" ) );
	s.vcf_seq2 = knob( "vcf_seq2", COLS[9], B, 20, s.vcf_seq2, 0, 1, { label: "VCF SEQ2 AMT", def: 0, labelSize: 10, format: fmtPct } );

	s.blend = knob( "blend", COLS[10], A, 24, s.blend, 0, 1, { label: "BLEND", def: 0.5, labelSize: 10,
		format: function(v){ return Math.round( (1 - v) * 100 ) + "% VCW / " + Math.round( v * 100 ) + "% VCF"; } } );
	s.filter_type = knob( "filter_type", COLS[10], B, 20, s.filter_type, 0, 1, { label: "FILTER TYPE", def: 0, labelSize: 10,
		format: function(v){ return v < 0.02 ? "LOW PASS" : (v > 0.98 ? "BAND PASS" : Math.round( (1 - v) * 100 ) + "% LP / " + Math.round( v * 100 ) + "% BP"); } } );
	s.eg1_decay = knob( "eg1_decay", COLS[11], A, 20, s.eg1_decay, 0.01, 6, { label: "EG1 DECAY", style: "ring", exp: true, def: 0.25, labelSize: 10, format: fmtTime } );
	drawLed( COLS[11] + 26, A - 30, 3.5, st.eg && st.eg[0] > 0.05, "#ffb02f" );
	s.eg2_decay = knob( "eg2_decay", COLS[11], B, 20, s.eg2_decay, 0.01, 6, { label: "EG2 (VCA) DECAY", style: "ring", exp: true, def: 0.5, labelSize: 10, format: fmtTime } );
	drawLed( COLS[11] + 26, B - 30, 3.5, st.eg && st.eg[1] > 0.05, "#ffb02f" );
	s.volume = knob( "volume", COLS[12], A, 22, s.volume, 0, 1, { label: "VOLUME", def: 0.7, labelSize: 10, format: fmtPct } );
	s.eg_trig_mix = knob( "eg_trig_mix", COLS[12], B, 20, s.eg_trig_mix, 0, 1, { label: "EG TRIG MIX", def: 0.5, labelSize: 10,
		format: function(v){ return v < 0.02 ? "SEQ1 ONLY" : (v > 0.98 ? "SEQ2 ONLY" : "SEQ1 " + Math.round( Math.min( 1, 2 * (1 - v) ) * 100 ) + "% / SEQ2 " + Math.round( Math.min( 1, 2 * v ) * 100 ) + "%"); } } );
}

function drawSequencers()
{
	var s = M.settings, st = M.state, u = ui_state[ M.id ] || (ui_state[ M.id ] = { buffer_down: 0, saved: 0 });
	var live = st.seq || s.seq;
	drawSection( "GENERATIVE SEQUENCER", 300, 1245, 266 );

	// transport, BUFFER, CHAIN SEQ on the left
	s.tempo = knob( "tempo", 95, 330, 28, s.tempo, 20, 600, { label: "TEMPO", style: "ring", exp: true, def: 120, labelSize: 11,
		format: function(v){ return Math.round( v ) + " BPM"; } } );
	drawLed( 130, 296, 3.5, st.clock && st.playing, "#ffb02f" );
	if(button( "run", 160, 292, 100, 24, "RUN / STOP", st.playing ).clicked) send({ type: "play" });
	if(button( "reset", 160, 320, 100, 24, "RESET" ).clicked) send({ type: "reset" });
	if(button( "advance", 160, 348, 100, 24, "ADVANCE" ).clicked) send({ type: "next" });
	var trig = button( "trigger", 50, 380, 100, 24, "TRIGGER" );
	if(trig.clicked) send({ type: "trigger", gate: true });
	// BUFFER: a short press recalls the saved pattern, holding it for a second saves the current one
	var now = performance.now();
	var buf = button( "buffer", 160, 380, 100, 24, now < u.saved ? "SAVED" : "BUFFER", now < u.saved || (u.buffer_down && now - u.buffer_down > 1000) );
	if(buf.clicked)
		u.buffer_down = now;
	if(u.buffer_down && buf.held && now - u.buffer_down > 1000 && u.saved < u.buffer_down)
	{
		s.buffer = clone( live.map(function(q){ return { bits: q.bits, cv: q.cv, length: q.length }; }) );
		u.saved = now + 1200;
		setStatus( "Maze: pattern saved in the buffer (a short press on BUFFER recalls it)" );
	}
	if(u.buffer_down && !buf.held)
	{
		if(now - u.buffer_down <= 1000)
		{
			if(s.buffer) send({ type: "pattern", pattern: s.buffer });
			else setStatus( "Maze: the buffer is empty (hold BUFFER for a second to save the pattern)" );
		}
		u.buffer_down = 0;
	}
	if(button( "chain", 160, 408, 100, 24, "CHAIN SEQ", s.chain ).clicked) s.chain = !s.chain;

	for(var k = 0; k < 2; ++k)
	{
		var q = live[k], y = SEQ_Y[k];
		drawLabel( "SEQ" + (k + 1), 330, y, 13 );
		var head = st.head ? st.head[k] : -1;
		for(var i = 0; i < BITS; ++i)
		{
			var bx = BIT_X0 + i * BIT_DX;
			var inside = i < q.length;
			var id = id_prefix + "bit" + k + "_" + i;
			var hover = !cable_drag && ui.active === null && hitCircle( bx, y, 16 );
			if(hover)
			{
				ui.hot = id;
				tip( "BIT " + (i + 1) + (q.bits[i] ? "  ON  " + (q.cv[i] > 0 ? "+" : "") + q.cv[i].toFixed(2) + " V" : "  OFF") + "  (CLICK: FLIP)", bx, y - 26 );
			}
			var kb = keyButton( id, bx - 16, y - 16, 32, 32 ); // every frame: the keys keep their order
			if(hover && ui.pressed)
			{
				ui.active = id;
				send({ type: "flip", seq: k, bit: i });
			}
			else if(kb.pressed)
				send({ type: "flip", seq: k, bit: i });
			// bit LED: red when on, green ring on the play head, dim beyond the length
			ctx.fillStyle = "#050505";
			ctx.beginPath(); ctx.arc( bx, y, 14, 0, Math.PI * 2 ); ctx.fill();
			if(st.playing && head == i)
			{
				ctx.strokeStyle = "#3bd16f";
				ctx.lineWidth = 3;
				ctx.beginPath(); ctx.arc( bx, y, 12.5, 0, Math.PI * 2 ); ctx.stroke();
			}
			drawLed( bx, y, 6, q.bits[i] && inside, "#ff3b2f" );
			if(!inside)
			{
				ctx.fillStyle = "rgba(0,0,0,0.6)";
				ctx.beginPath(); ctx.arc( bx, y, 12, 0, Math.PI * 2 ); ctx.fill();
			}
			// stored voltage as a small bar under the bit
			if(q.bits[i] && inside)
			{
				var v = clamp( q.cv[i] / 5, -1, 1 ) * s.cv_range[k];
				ctx.fillStyle = "#b6f06a";
				ctx.fillRect( bx - 1, y + 22 - Math.max( 0, v ) * 10, 2, Math.abs( v ) * 10 + 1 );
			}
		}
		var bx0 = BIT_X0 + 8 * BIT_DX + 4;
		if(button( "length" + k, bx0, y - 12, 70, 24, "LENGTH" ).clicked) send({ type: "length", seq: k });
		if(button( "flip" + k, bx0 + 78, y - 12, 70, 24, "BIT FLIP" ).clicked) send({ type: "flip", seq: k });
		if(button( "shift" + k, bx0 + 156, y - 12, 70, 24, "BIT SHIFT" ).clicked) send({ type: "shift", seq: k });
		s.corrupt[k] = knob( "corrupt" + k, 1110, y, 17, s.corrupt[k], 0, 1, { label: "CORRUPT", def: 0, labelSize: 10,
			format: function(v){ return v < 0.01 ? "LOCKED" : (v <= 0.5 ? "VOLTAGES " + Math.round( v * 200 ) + "%" : "VOLTAGES + BITS " + Math.round( (v - 0.5) * 200 ) + "%"); } } );
		s.cv_range[k] = knob( "cv_range" + k, 1200, y, 17, s.cv_range[k], 0, 1, { label: "SEQ" + (k + 1) + " CV RANGE", def: 0.35, labelSize: 10,
			format: function(v){ return "±" + (v * 5).toFixed(2) + " V"; } } );
	}

	// quantizer, ORDER, U MIX
	var qy = 440;
	drawLabel( "QUANTIZE", 470, qy - 16, 10 );
	drawLcd( 380, qy - 4, 180, 24, SCALE_NAMES[ s.quantize ], "center" );
	if(button( "qprev", 568, qy - 3, 30, 22, "◀" ).clicked) s.quantize = (s.quantize - 1 + SCALE_NAMES.length) % SCALE_NAMES.length;
	if(button( "qnext", 602, qy - 3, 30, 22, "▶" ).clicked) s.quantize = (s.quantize + 1) % SCALE_NAMES.length;
	s.order = leverSwitch( "order", 760, qy - 30, s.order, [["vcw_vcf", "VCW → VCF"], ["parallel", "PARALLEL"], ["vcf_vcw", "VCF → VCW"]], "ORDER" );
	s.umix1_lvl = knob( "umix1_lvl", 1000, qy + 4, 20, s.umix1_lvl, 0, 1, { label: "U MIX 1 LVL", def: 0.5, labelSize: 10, format: fmtPct } );

	// the live pattern goes into the settings, so patches save it (seq_id is kept: no reload)
	if(st.seq && JSON.stringify( st.seq ) != JSON.stringify( s.seq ))
		s.seq = clone( st.seq );
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
			if(!j) { drawLabel( "MIDI: BACK", JACK_COLS[c], 68 + r * 55, 9, false, DIM_COLOR ); continue; } // MIDI is on the back
			drawJack( j[2], JACK_COLS[c], 68 + r * 55, j[0], j[1] ); // rows closer than on the other panels
		}
}

WR.registerSynth( "maze", {
	title: "MAZE",
	description: "Maze: parallel generative synthesizer with two bit sequencers",
	about: "Two parallel bit-shift sequencers, two VCOs, a wavefolder and a state-variable filter. Generative patterns.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^(run|reset|advance|trigger)$", 3], ["^bit\\d_\\d$", 3], ["^(length|flip|shift)\\d$", 2], ["", 1]],
	category: "Synths",
	wood: true, // wooden sides
	worklet: "devices/maze-worklet.js",
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
		M.state = M.state || { playing: false, head: [0, 0], eg: [0, 0], freq: [0, 0], clock: false };
		drawBackground();
		drawVoice();
		drawSequencers();
		drawPatchBay();
		M = null;
	},
	transport: function( mod, action, value ) {
		if(action == "play") mod.post({ type: "play", value: value });
		else if(action == "trigger") mod.post({ type: "trigger", gate: value });
		else mod.post({ type: action }); // reset, next (ADVANCE)
	},
	tempo: function( s ) { return s.tempo; }
});

})();
