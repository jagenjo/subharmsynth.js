// devices/mystic.js
// MYSTIC module, a replica of the ASM Hydrasynth (simplified to one panel): settings, a small CV patch
// bay and the panel: OSC 1 / OSC 2 with their two mutators each, FILTER 1 / FILTER 2, the amp and
// filter envelopes, OSC 3, the mixer, the mod envelope, the LFO, the arpeggiator and a display with
// the mutated waves. Polyphonic (8 voices): it plays every note of its MIDI channel, so it has no
// sequencer of its own; the song or the keys play it. DSP in mystic-worklet.js.

(function(){

var SIZE = [1568, 596];
var WAVE_NAMES = ["SINE", "TRIANGLE", "SAW", "SQUARE", "PULSE", "ORGAN", "VOX", "DIGITAL"];
var MUT_MODES = [["off", "OFF"], ["fm", "FM-LIN"], ["stack", "WAVSTACK"], ["sync", "OSC SYNC"], ["pw", "PW-ASM"], ["harmonic", "HARMONIC"], ["phazdist", "PHAZDIST"]];
var F1_TYPES = [["lp24", "LP LADDER 24"], ["lp12", "LP 12"], ["bp", "BAND PASS"], ["hp", "HIGH PASS"], ["vowel", "VOWEL"], ["comb", "COMB"]];
var LFO_SHAPES = [["sine", "SINE"], ["tri", "TRIANGLE"], ["saw", "SAW"], ["square", "SQUARE"], ["sh", "S&H"]];
var ARP_MODES = [["up", "UP"], ["down", "DOWN"], ["updown", "UP/DOWN"], ["random", "RANDOM"], ["order", "AS PLAYED"]];
var ARP_DIVS = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];

var JACKS = [
	[["PITCH CV","in","pitch_in"], ["GATE","in","gate_in"], ["MOD 1","in","mod1_in"]],
	[["MOD 2","in","mod2_in"], ["CLOCK","in","clock_in"], ["GATE","out","gate_out"]],
	[["ENV 1","out","env1_out"], ["MOD ENV","out","menv_out"], ["LFO","out","lfo_out"]]
];

var M = null;

function defaults()
{
	return {
		osc: [{ wave: 2, semi: 0, cent: 0 }, { wave: 3, semi: 0, cent: 7 }, { wave: 0, semi: -12, cent: 0 }], // OSC 3: wave index
		mut: [{ mode: "fm", ratio: 2, depth: 0, wet: 1 }, { mode: "pw", ratio: 1, depth: 0, wet: 1 },     // OSC 1
		      { mode: "stack", ratio: 1, depth: 0, wet: 1 }, { mode: "sync", ratio: 2, depth: 0, wet: 1 }], // OSC 2
		mix: { osc1: 0.7, osc2: 0.5, osc3: 0, ring: 0, noise: 0 },
		f1: { type: "lp24", cutoff: 2500, res: 0.25, drive: 0.1, env: 0.35, key: 0.5 },
		f2: { morph: 0, cutoff: 16000, res: 0.1 },
		route: "series",
		env1: { a: 0.005, d: 0.4, s: 0.3, r: 0.4 },   // filter
		env2: { a: 0.005, d: 0.3, s: 0.8, r: 0.5 },   // amp
		env3: { a: 0.001, d: 0.5 },                   // mod (AD)
		menv: { mut: 0, scan: 0 },
		lfo: { rate: 5, shape: "sine", pitch: 0, scan: 0, cutoff: 0, mut: 0 },
		vel: 0.5, volume: 0.7, voice_mode: "poly", glide: 0,
		arp: { on: false, mode: "up", div: 3, oct: 1, gate: 0.5, latch: false, tempo: 120 }
	};
}

function enumOf( list, v, def ) { return list.some(function(o){ return o[0] === v; }) ? v : def; }

function validate( s )
{
	var d = defaults();
	s.mut.forEach(function(m){ m.mode = enumOf( MUT_MODES, m.mode, "fm" ); m.ratio = Math.min( 8, Math.max( 0.25, m.ratio ) ); });
	s.f1.type = enumOf( F1_TYPES, s.f1.type, "lp24" );
	s.lfo.shape = enumOf( LFO_SHAPES, s.lfo.shape, "sine" );
	s.arp.mode = enumOf( ARP_MODES, s.arp.mode, "up" );
	s.arp.div = Math.min( ARP_DIVS.length - 1, Math.max( 0, Math.round( s.arp.div ) ) );
	s.arp.oct = Math.min( 4, Math.max( 1, Math.round( s.arp.oct ) ) );
	if(s.route != "series" && s.route != "parallel") s.route = "series";
	if(s.voice_mode != "poly" && s.voice_mode != "mono") s.voice_mode = "poly";
	s.osc.forEach(function(o, i){ o.wave = Math.min( 7, Math.max( 0, i == 2 ? Math.round( o.wave ) : o.wave ) ); });
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var expRnd = function(a, b) { return a * Math.pow( b / a, Math.random() ); };
	var pick = function(l) { return l[ Math.floor( Math.random() * l.length ) ]; };
	var chance = function(p) { return Math.random() < p; };
	s.osc[0].wave = rnd( 0, 7 ); s.osc[1].wave = rnd( 0, 7 ); s.osc[2].wave = Math.floor( rnd( 0, 8 ) );
	s.osc[1].semi = pick([0, 0, 7, 12, -12, 5]); s.osc[1].cent = rnd( -12, 12 );
	s.mut.forEach(function(m){
		m.mode = pick( MUT_MODES.slice( 1 ) )[0];
		m.ratio = pick([0.5, 1, 1.5, 2, 3, 4, 5, 7]);
		m.depth = chance(0.7) ? rnd( 0, 0.7 ) : 0;
		m.wet = rnd( 0.5, 1 );
	});
	s.mix.osc1 = rnd( 0.4, 0.9 ); s.mix.osc2 = rnd( 0, 0.7 ); s.mix.osc3 = chance(0.3) ? rnd( 0, 0.5 ) : 0;
	s.mix.ring = chance(0.25) ? rnd( 0, 0.5 ) : 0; s.mix.noise = chance(0.2) ? rnd( 0, 0.3 ) : 0;
	s.f1.type = pick( F1_TYPES )[0]; s.f1.cutoff = expRnd( 300, 8000 ); s.f1.res = rnd( 0, 0.7 ); s.f1.env = rnd( -0.2, 0.7 );
	s.f2.morph = chance(0.6) ? 0 : rnd( 0, 1 ); s.f2.cutoff = expRnd( 2000, 20000 );
	s.env2.a = chance(0.7) ? expRnd( 0.001, 0.02 ) : expRnd( 0.05, 1 ); s.env2.d = expRnd( 0.1, 1.5 ); s.env2.s = rnd( 0, 1 ); s.env2.r = expRnd( 0.05, 1.5 );
	s.env1.a = expRnd( 0.001, 0.3 ); s.env1.d = expRnd( 0.05, 1.5 ); s.env1.s = rnd( 0, 0.7 ); s.env1.r = expRnd( 0.05, 1 );
	s.env3.d = expRnd( 0.05, 2 ); s.menv.mut = chance(0.5) ? rnd( -0.5, 0.7 ) : 0; s.menv.scan = chance(0.4) ? rnd( -0.5, 0.5 ) : 0;
	s.lfo.rate = expRnd( 0.1, 8 ); s.lfo.shape = pick( LFO_SHAPES )[0];
	s.lfo.pitch = chance(0.2) ? rnd( 0, 0.3 ) : 0; s.lfo.scan = chance(0.4) ? rnd( 0, 0.5 ) : 0; s.lfo.mut = chance(0.3) ? rnd( 0, 0.4 ) : 0;
}

// an LCD with ◀ ▶ to step through options [[value, label], ...]
function selector( id, x, y, w, value, options, tooltip )
{
	var i = Math.max( 0, options.findIndex(function(o){ return o[0] === value; }) );
	drawLcd( x, y, w, 18, options[i][1], "center" );
	if(tinyButton( id + "_prev", x + w + 6, y + 2, 18, 14, "◀", false, tooltip ))
		i = (i - 1 + options.length) % options.length;
	if(tinyButton( id + "_next", x + w + 27, y + 2, 18, 14, "▶", false, tooltip ))
		i = (i + 1) % options.length;
	return options[i][0];
}

var amt = function( label, def ) { return { label: label, bipolar: true, def: def || 0, labelSize: 10, format: fmtSigned }; };
var pct = function( label, def ) { return { label: label, def: def, labelSize: 10, format: fmtPct }; };
var time = function( label, def ) { return { label: label, style: "ring", exp: true, def: def, labelSize: 10, format: fmtTime }; };

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
	ctx.fillText( "MYSTIC", 46, 560 );
	var tw = ctx.measureText( "MYSTIC" ).width;
	ctx.fillRect( 54 + tw, 534, 1.5, 28 );
	ctx.font = "11px " + FONT;
	ctx.fillText( "POLYPHONIC WAVE MORPHING", 62 + tw, 546 );
	ctx.fillText( "SYNTHESIZER · 8 VOICES", 62 + tw, 559 );
}

function drawOsc( k, y, title )
{
	var o = M.settings.osc[k];
	drawSection( title, 40, 232, y - 78 );
	if(k < 2)
		o.wave = knob( "wave" + k, 85, y, 24, o.wave, 0, 7, { label: "WAVSCAN", style: "ring", ticks: 8, def: k ? 3 : 2, labelSize: 10,
			format: function(v){ var i = Math.floor( v ), f = v - i; return f < 0.02 || i >= 7 ? WAVE_NAMES[ Math.min( 7, i ) ] : WAVE_NAMES[i] + " → " + WAVE_NAMES[i + 1] + " " + Math.round( f * 100 ) + "%"; } } );
	else
		o.wave = knob( "wave" + k, 85, y, 22, o.wave, 0, 7, { label: "WAVE", style: "ring", step: 1, def: 0, labelSize: 10,
			format: function(v){ return WAVE_NAMES[ v | 0 ]; } } );
	o.semi = knob( "semi" + k, 158, y + 4, 16, o.semi, -24, 24, { label: "SEMI", step: 1, bipolar: true, def: 0, labelSize: 10,
		format: function(v){ return (v > 0 ? "+" : "") + v + " st"; } } );
	o.cent = knob( "cent" + k, 210, y + 4, 16, o.cent, -50, 50, { label: "CENT", bipolar: true, def: 0, labelSize: 10,
		format: function(v){ return (v > 0 ? "+" : "") + Math.round( v ) + " c"; } } );
}

function drawMutator( i, x, y )
{
	var m = M.settings.mut[i];
	drawSection( "MUTATOR " + (i + 1), x, x + 180, y - 78 );
	m.mode = selector( "mut" + i, x + 8, y - 56, 112, m.mode, MUT_MODES, "MUTATOR MODE" );
	var ratioFmt = function(v){
		switch(m.mode) {
			case "fm": return "FM RATIO " + v.toFixed(2);
			case "stack": return "SPREAD x" + v.toFixed(2);
			case "sync": case "harmonic": return "RANGE x" + v.toFixed(2);
			default: return "RATIO " + v.toFixed(2) + " (NOT USED)";
		}
	};
	m.ratio = knob( "ratio" + i, x + 35, y + 12, 15, m.ratio, 0.25, 8, { label: "RATIO", exp: true, def: 2, labelSize: 10, format: ratioFmt } );
	m.depth = knob( "depth" + i, x + 90, y + 12, 15, m.depth, 0, 1, pct( "DEPTH", 0 ) );
	m.wet = knob( "wet" + i, x + 145, y + 12, 15, m.wet, 0, 1, { label: "DRY/WET", def: 1, labelSize: 10, format: function(v){ return Math.round( v * 100 ) + "% WET"; } } );
}

function drawControls()
{
	var s = M.settings, A = 100, B = 225, C = 345;
	drawOsc( 0, A, "OSC 1" ); drawMutator( 0, 245, A ); drawMutator( 1, 435, A );
	drawOsc( 1, B, "OSC 2" ); drawMutator( 2, 245, B ); drawMutator( 3, 435, B );
	drawOsc( 2, C, "OSC 3" );

	// filter 1, filter 2, routing, volume
	var f1 = s.f1, f2 = s.f2;
	drawSection( "FILTER 1", 635, 935, A - 78 );
	f1.type = selector( "f1type", 642, A - 56, 120, f1.type, F1_TYPES, "FILTER 1 TYPE" );
	f1.cutoff = knob( "f1cut", 680, A + 18, 22, f1.cutoff, 20, 20000, { label: "CUTOFF", exp: true, def: 2500, labelSize: 10, format: fmtHz } );
	f1.res = knob( "f1res", 745, A + 18, 16, f1.res, 0, 1, pct( f1.type == "comb" ? "FEEDBACK" : "RESONANCE", 0 ) );
	f1.drive = knob( "f1drive", 800, A + 18, 16, f1.drive, 0, 1, pct( "DRIVE", 0 ) );
	f1.env = knob( "f1env", 855, A + 18, 16, f1.env, -1, 1, amt( "ENV 1 AMT" ) );
	f1.key = knob( "f1key", 910, A + 18, 16, f1.key, 0, 1, pct( "KEYTRACK", 0.5 ) );
	drawSection( "FILTER 2", 950, 1140, A - 78 );
	f2.morph = knob( "f2morph", 985, A + 4, 18, f2.morph, 0, 1, { label: "MORPH", def: 0, labelSize: 10,
		format: function(v){ return v < 0.02 ? "LOW PASS" : (Math.abs( v - 0.5 ) < 0.02 ? "BAND PASS" : (v > 0.98 ? "HIGH PASS" : (v < 0.5 ? "LP → BP" : "BP → HP"))); } } );
	f2.cutoff = knob( "f2cut", 1045, A + 4, 18, f2.cutoff, 20, 20000, { label: "CUTOFF", exp: true, def: 16000, labelSize: 10, format: fmtHz } );
	f2.res = knob( "f2res", 1100, A + 4, 16, f2.res, 0, 1, pct( "RESONANCE", 0 ) );
	s.route = leverSwitch( "route", 1155, A - 26, s.route, [["series", "SERIES"], ["parallel", "PARALLEL"]], "ROUTING" );
	s.volume = knob( "volume", 1260, A + 4, 22, s.volume, 0, 1, pct( "VOLUME", 0.7 ) );

	// envelopes and voice
	var e2 = s.env2, e1 = s.env1;
	drawSection( "AMP ENV", 635, 935, B - 78 );
	e2.a = knob( "e2a", 670, B + 6, 16, e2.a, 0.001, 10, time( "ATTACK", 0.005 ) );
	e2.d = knob( "e2d", 725, B + 6, 16, e2.d, 0.002, 10, time( "DECAY", 0.3 ) );
	e2.s = knob( "e2s", 780, B + 6, 16, e2.s, 0, 1, pct( "SUSTAIN", 0.8 ) );
	e2.r = knob( "e2r", 835, B + 6, 16, e2.r, 0.002, 10, time( "RELEASE", 0.5 ) );
	s.vel = knob( "vel", 895, B + 6, 16, s.vel, 0, 1, pct( "VELOCITY", 0.5 ) );
	drawSection( "FILTER ENV (ENV 1)", 950, 1180, B - 78 );
	e1.a = knob( "e1a", 985, B + 6, 16, e1.a, 0.001, 10, time( "ATTACK", 0.005 ) );
	e1.d = knob( "e1d", 1040, B + 6, 16, e1.d, 0.002, 10, time( "DECAY", 0.4 ) );
	e1.s = knob( "e1s", 1095, B + 6, 16, e1.s, 0, 1, pct( "SUSTAIN", 0.3 ) );
	e1.r = knob( "e1r", 1150, B + 6, 16, e1.r, 0.002, 10, time( "RELEASE", 0.4 ) );
	s.voice_mode = leverSwitch( "voice_mode", 1200, B - 26, s.voice_mode, [["poly", "POLY"], ["mono", "MONO"]], "VOICE" );
	s.glide = knob( "glide", 1265, B + 6, 16, s.glide, 0, 2, { label: "GLIDE", def: 0, labelSize: 10, format: function(v){ return v < 0.001 ? "OFF" : fmtTime( v ); } } );

	// mixer, mod envelope, LFO
	var mx = s.mix;
	drawSection( "MIXER", 245, 615, C - 78 );
	[["osc1", "OSC 1", 0.7], ["osc2", "OSC 2", 0.5], ["osc3", "OSC 3", 0], ["ring", "RING MOD", 0], ["noise", "NOISE", 0]].forEach(function(c, k){
		mx[ c[0] ] = knob( "mix_" + c[0], 285 + k * 70, C + 4, 18, mx[ c[0] ], 0, 1, pct( c[1], c[2] ) );
	});
	var e3 = s.env3, me = s.menv, l = s.lfo;
	drawSection( "MOD ENV (ENV 3)", 635, 860, C - 78 );
	e3.a = knob( "e3a", 665, C + 4, 16, e3.a, 0.001, 10, time( "ATTACK", 0.001 ) );
	e3.d = knob( "e3d", 720, C + 4, 16, e3.d, 0.002, 10, time( "DECAY", 0.5 ) );
	me.mut = knob( "menv_mut", 775, C + 4, 16, me.mut, -1, 1, amt( "→ MUTATORS" ) );
	me.scan = knob( "menv_scan", 830, C + 4, 16, me.scan, -1, 1, amt( "→ WAVSCAN" ) );
	drawSection( "LFO", 875, 1285, C - 78 );
	l.rate = knob( "lfo_rate", 905, C + 4, 18, l.rate, 0.01, 50, { label: "RATE", style: "ring", exp: true, def: 5, labelSize: 10, format: fmtRate } );
	drawLed( 930, C - 30, 3.5, M.state.lfo > 0.3, "#ffb02f" );
	l.shape = selector( "lfo_shape", 940, C - 6, 78, l.shape, LFO_SHAPES, "LFO SHAPE" );
	l.pitch = knob( "lfo_pitch", 1105, C + 4, 15, l.pitch, 0, 1, { label: "→ PITCH", def: 0, labelSize: 10, format: function(v){ return "±" + (v * 2).toFixed(2) + " st"; } } );
	l.scan = knob( "lfo_scan", 1155, C + 4, 15, l.scan, 0, 1, pct( "→ WAVSCAN", 0 ) );
	l.cutoff = knob( "lfo_cut", 1205, C + 4, 15, l.cutoff, 0, 1, { label: "→ CUTOFF", def: 0, labelSize: 10, format: function(v){ return "±" + (v * 4).toFixed(1) + " oct"; } } );
	l.mut = knob( "lfo_mut", 1255, C + 4, 15, l.mut, 0, 1, pct( "→ MUTATORS", 0 ) );
}

function drawArp()
{
	var a = M.settings.arp, D = 465;
	drawSection( "ARPEGGIATOR", 40, 640, D - 70 );
	if(button( "arp_on", 50, D - 14, 60, 26, "ARP", a.on ).clicked) a.on = !a.on;
	drawLabel( "MODE", 182, D - 30, 10 );
	a.mode = selector( "arp_mode", 125, D - 18, 100, a.mode, ARP_MODES, "ARPEGGIATOR MODE" );
	a.div = knob( "arp_div", 330, D, 16, a.div, 0, ARP_DIVS.length - 1, { label: "DIVISION", step: 1, def: 3, style: "ring", labelSize: 10, format: function(v){ return ARP_DIVS[v]; } } );
	a.oct = knob( "arp_oct", 390, D, 16, a.oct, 1, 4, { label: "OCTAVES", step: 1, def: 1, style: "ring", labelSize: 10, format: function(v){ return v + " OCT"; } } );
	a.gate = knob( "arp_gate", 450, D, 16, a.gate, 0.05, 1, pct( "GATE", 0.5 ) );
	if(button( "arp_latch", 490, D - 14, 60, 26, "LATCH", a.latch ).clicked) a.latch = !a.latch;
	a.tempo = knob( "arp_tempo", 600, D, 18, a.tempo, 30, 300, { label: "TEMPO", style: "ring", exp: true, def: 120, labelSize: 10,
		format: function(v){ return Math.round( v ) + " BPM (MIDI CLOCK / CLOCK IN WIN)"; } } );
}

// the display: OSC 1 and OSC 2 after their mutators, the voices playing and the arpeggio
function drawDisplay()
{
	var st = M.state, x = 680, y = 410, w = 600, h = 120;
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x - 4, y - 4, w + 8, h + 8, 6 ); ctx.fill();
	ctx.fillStyle = "#06090c";
	ctx.fillRect( x, y, w, h );
	var trace = function( pts, x0, color ) {
		if(!pts) return;
		var tw = w * 0.5 - 20, mid = y + h * 0.5 + 6, amp = h * 0.32;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		pts.forEach(function(v, i){ var px = x0 + i / (pts.length - 1) * tw, py = mid - Math.max( -1.2, Math.min( 1.2, v ) ) * amp; i ? ctx.lineTo( px, py ) : ctx.moveTo( px, py ); });
		ctx.stroke();
	};
	var wv = st.wave || [];
	trace( wv[0], x + 10, "#9fd8ff" );
	trace( wv[1], x + w * 0.5 + 10, "#c9a4ff" );
	ctx.font = "bold 10px 'Courier New', monospace";
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#9fd8ff";
	var s = M.settings;
	var mutName = function(i){ var m = s.mut[i]; return m.depth > 0.0005 && m.mode != "off" ? (MUT_MODES.find(function(o){ return o[0] == m.mode; }) || ["", ""])[1] : "-"; };
	ctx.fillText( "OSC 1  " + mutName( 0 ) + " / " + mutName( 1 ), x + 10, y + 12 );
	ctx.fillStyle = "#c9a4ff";
	ctx.fillText( "OSC 2  " + mutName( 2 ) + " / " + mutName( 3 ), x + w * 0.5 + 10, y + 12 );
	ctx.fillStyle = "#7f8c96";
	ctx.textAlign = "right";
	var notes = (st.gates || []).filter(function(n){ return n >= 0; }).map( noteName );
	ctx.fillText( (st.voices || 0) + "/8 VOICES" + (notes.length ? "  " + notes.slice( 0, 6 ).join(" ") : "") +
		(s.arp.on ? "  ARP " + ((st.arp || []).length ? st.arp.map( noteName ).join(" ") : "(HOLD KEYS)") : ""), x + w - 8, y + h - 10 );
}

function drawPatchBay()
{
	var cols = [1360, 1418, 1476], x = cols[0] - 40, h = SIZE[1];
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( x, 14, cols[2] - x + 40, h - 28, 6 ); ctx.fill();
	drawLabel( "CV / GATE", cols[1], 31, 12 );
	JACKS.forEach(function(row, r){
		row.forEach(function(j, c){ drawJack( j[2], cols[c], 92 + r * 72, j[0], j[1] ); });
	});
	ctx.font = "10px " + FONT;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = DIM_COLOR;
	["PITCH CV: 1V/OCT ON EVERY VOICE", "GATE: PLAYS C4 (+ PITCH CV)", "MOD 1: CUTOFF 1V/OCT", "MOD 2: WAVSCAN ±5V", "CLOCK: ARPEGGIATOR STEPS", "", "MIDI AND AUDIO ON THE BACK"].forEach(function(t, i){
		ctx.fillText( t, cols[1], 330 + i * 16 );
	});
}

WR.registerSynth( "mystic", {
	title: "MYSTIC",
	description: "MYSTIC: polyphonic wave morphing synthesizer with mutators",
	category: "Synths",
	worklet: "devices/mystic-worklet.js",
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
		M.state = M.state || { voices: 0, gates: [], lfo: 0, arp: [], wave: null };
		drawBackground();
		drawControls();
		drawArp();
		drawDisplay();
		drawPatchBay();
		M = null;
	},
	transport: function( mod, action, value ) {
		if(action == "trigger") mod.post({ type: "trigger", gate: value }); // T plays C4
	}
});

})();
