// devices/lunar.js
// LUNAR 21 module, an ambient drone machine, its panel laid out as
// the original's (cream, black print, red and blue knobs): drone voices 1, 2, 6, 7 (5 oscillators
// each), voices 3, 8 (oscillator, modulator, divider, noise, S&H), voices 4, 5 (VCO 1 / 2 with EG
// VCA 1 / 2), the DUAL EFFECTOR with its cartridges, FILTER L / R, the mixer, LFO A / B, the JOYSTICK,
// the 5 STEP SEQUENCER, PREAMP, ENVELOPE FOLLOWER, the touch plates and the DRONE VOICES buttons.
// Coordinates are the original render's (1169 px wide), scaled by X() / Y(). DSP in lunar-worklet.js.

(function(){

var K = 1568 / 1169, SIZE = [1568, Math.round( 756 * K )];
var CREAM = "#ede6d8", INK = "#111111", RED = "#e3261d", BLUE = "#1f72b8", P_FONT = "Arial, Helvetica, sans-serif";
var X = function(x){ return x * K; }, Y = X, Rr = X;
var DRONES = [1, 2, 6, 7];
var FOOT = ["LO", "64'", "32'", "16'", "8'", "4'", "2'", "1'"];
var MIX_ORDER = [[0, "VOICE 1"], [1, "VOICE 2"], [2, "VOICE 3"], [8, "EXT.AUDIO"], [3, "VOICE 4"], [4, "VOICE 5"], [9, "PREAMP"], [5, "VOICE 6"], [6, "VOICE 7"], [7, "VOICE 8"]];
var CARTRIDGES = [
	["CATHEDRAL", [["SHIMMER", "OCT UP", "OCT DOWN", "DECAY"], ["OCT UP DELAY", "FEEDBACK", "DELAY", "REVERB"], ["SPACE REVERB", "FEEDBACK", "DELAY", "REVERB"]]],
	["TIME", [["DELAY REVERB", "FEEDBACK", "DELAY", "REVERB"], ["DELAY CHORUS", "FEEDBACK", "DELAY", "MOD DEPTH"], ["DELAY VIBRATO", "FEEDBACK", "DELAY / RATE", "MOD DEPTH"]]],
	["MAGIC", [["PITCH DELAY", "FEEDBACK", "DELAY", "PITCH"], ["REVERSE DELAY", "FEEDBACK", "DELAY", "PITCH"], ["BELL DELAY", "FEEDBACK", "DELAY", "PITCH"]]],
	["INFINITY", [["RESONANCE REVERB", "PRE DELAY", "PRE DELAY MOD", "DECAY"], ["O.D.D.", "FEEDBACK", "DELAY", "PITCH"], ["RESONANCE DELAY", "FEEDBACK", "DELAY", "PITCH"]]],
	["VIBROTREM", [["TREMOLO", "DEPTH", "RATE", "REVERB"], ["VIBRATO", "DEPTH", "RATE", "REVERB"], ["CHORUS", "DEPTH", "RATE", "REVERB"]]],
	["VIBE", [["PHASER", "DEPTH", "RATE", "REVERB"], ["FLANGER", "DEPTH", "RATE", "REVERB"], ["RESONANCE", "RESONANCE", "RATE", "MOD DEPTH"]]],
	["PITCH SHIFTER", [["SYNTHTAVER", "OCT DOWN", "OCT UP", "DIRECT"], ["OCTAVER", "OCT DOWN", "OCT UP", "DIRECT"], ["HARMONIZER", "PITCH 1", "PITCH 2", "VOICE MIX"]]],
	["STRING RINGER", [["SYNTHETIC RING", "FREQUENCY", "RESONANCE", "SUB"], ["RING MOD", "FREQUENCY", "RATE", "REVERB"], ["S&H RING MOD", "PITCH SPEED", "S&H RATE", "FREQ"]]],
	["DIGITAL", [["FILTER DAC", "FILTER", "SAMPLE RATE", "INPUT GAIN"], ["LFO DAC", "SAMPLE RATE", "LFO SPEED", "LFO AMOUNT"], ["ENVELOPE CRUSHER", "SAMPLE RATE", "ENV AMOUNT", "INPUT GAIN"]]],
	["FILTER", [["AUTO WAH", "FILTER", "ENVELOPE", "REVERB"], ["LFO WAH", "FILTER", "RATE", "RESONANCE"], ["DUAL FILTER", "CUT 1", "CUT 2", "RESONANCE"]]]
];
var PLATES = [[204, 580, 705], [262, 563, 690], [320, 545, 655], [377, 563, 680], [434, 580, 700], [492, 600, 715],
	[636, 600, 715], [693, 580, 700], [750, 563, 680], [808, 545, 655], [866, 563, 690], [924, 580, 705]];
var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// the CV / gate jacks (front); audio on the back
var JACKS = [
	[["V1 GATE","in","v1_gate"], ["V1 CV","in","v1_cv"], ["V1 ENV","out","v1_env"], ["V2 GATE","in","v2_gate"], ["V2 CV","in","v2_cv"], ["V2 ENV","out","v2_env"]],
	[["V6 GATE","in","v6_gate"], ["V6 CV","in","v6_cv"], ["V6 ENV","out","v6_env"], ["V7 GATE","in","v7_gate"], ["V7 CV","in","v7_cv"], ["V7 ENV","out","v7_env"]],
	[["V3 GATE","in","v3_gate"], ["V3 FM","in","v3_fm"], ["V3 MOD","out","v3_mod"], ["V3 ENV","out","v3_env"], ["V3 S&H IN","in","v3_sh_in"], ["V3 S&H CLK","in","v3_sh_clk"], ["V3 S&H","out","v3_sh"]],
	[["V8 GATE","in","v8_gate"], ["V8 FM","in","v8_fm"], ["V8 MOD","out","v8_mod"], ["V8 ENV","out","v8_env"], ["V8 S&H IN","in","v8_sh_in"], ["V8 S&H CLK","in","v8_sh_clk"], ["V8 S&H","out","v8_sh"]],
	[["VCO1 V/OCT","in","v4_voct"], ["VCO1 FM","in","v4_fm"], ["VCO1 SHAPE","in","v4_shape"], ["VCO1 OUT","out","v4_out"], ["VCO2 V/OCT","in","v5_voct"], ["VCO2 FM","in","v5_fm"], ["VCO2 SHAPE","in","v5_shape"], ["VCO2 SYNC","in","v5_sync"], ["VCO2 OUT","out","v5_out"]],
	[["EG1 GATE","in","eg1_gate"], ["EG1 OUT","out","eg1_out"], ["VCA1 CV","in","vca1_cv"], ["EG2 GATE","in","eg2_gate"], ["EG2 OUT","out","eg2_out"], ["VCA2 CV","in","vca2_cv"]],
	[["CV X","in","fx_cvx"], ["CV Y","in","fx_cvy"], ["CV Z","in","fx_cvz"], ["CV FREQ","in","filt_cv"], ["LFO A","out","lfoa_out"], ["LFO B","out","lfob_out"], ["JOY X","out","joy_x"], ["JOY Y","out","joy_y"]],
	[["PULSER","out","pulser_out"], ["SEQ CLOCK","in","seq_clock"], ["SEQ CV","out","seq_cv"], ["SEQ GATE","out","seq_gate"], ["EXT SOURCE","in","preamp_cv"], ["ENVELOPE","out","envf_out"], ["ENV GATE","out","envf_gate"]],
	[["KB V/OCT","out","kb_voct"], ["KB GATE","out","kb_gate"], ["KB V/OCT 2","out","kb_voct2"], ["KB GATE 2","out","kb_gate2"]]
];
var REAR_JACKS = [["OUT L","aout","out_l"], ["OUT R","aout","out_r"], ["DRY OUT 4","aout","dry4"], ["DRY OUT 5","aout","dry5"], ["EXT AUDIO","ain","ext_audio"], ["PREAMP IN","ain","preamp_in"]];

var M = null, S = null, ST = null;
var pressed = {}; // module id -> what was held last frame (buttons, pads, plates)

function drone( tunes, volt )
{
	return { osc: tunes.map(function(t){ return { on: true, tune: t, mod: 0.3 }; }), volt: volt, att: 1.5, rls: 3, hold: false, latched: false };
}
function noiseVoice( pitch ) { return { rate: 0.3, x10: false, fm: true, am: false, fm_amt: 0.2, divider: 2, range: "lo", pitch: pitch, noise: 0.15, att: 1, rls: 2, hold: false, latched: false }; }

function defaults()
{
	var mix = [];
	var pans = [-0.6, -0.3, -0.8, 0, -0.15, 0.15, 0, 0.3, 0.6, 0.8];
	for(var c = 0; c < 10; ++c) mix.push({ vol: c >= 8 ? 0 : 0.6, pan: pans[c] });
	return {
		drones: [ drone( [0, 7, 12, 16, 19], 0 ), drone( [0, 7, 12, 15, 19], 7 ), drone( [0, 5, 12, 17, 24], 12 ), drone( [0, 7, 14, 19, 24], -5 ) ],
		noises: [ noiseVoice( 0.35 ), noiseVoice( 0.55 ) ],
		vcos: [ { octave: 4, tune: 0, fine: 0, shape: 0.6, pw: 0.5, fm: 0.3 }, { octave: 3, tune: 0, fine: 0.05, shape: 0.9, pw: 0.4, fm: 0.3 } ],
		egs: [ { hold: false, loop: false, a: 0.01, d: 0.4, s: 0.6, r: 0.8 }, { hold: false, loop: false, a: 0.3, d: 0.8, s: 0.7, r: 2 } ],
		mix: mix,
		filt: { l: { freq: 0.75, res: 0.2 }, r: { freq: 0.75, res: 0.2 }, link: false, cv: 0.5 },
		fx: { ch: [ { cart: 0, prog: 0, x: 0.5, y: 0.4, z: 0.6 }, { cart: 1, prog: 0, x: 0.45, y: 0.5, z: 0.4 } ], edit: 0, blend: 0.45, master: 0.7, phones: 0.6 },
		lfo: [ { wave: 0, rate: 0.3 }, { wave: 0.5, rate: 0.45 } ],
		joy: { x: 0, y: 0, offx: 0.5, offy: 0.5 },
		seq: { pulser: 0.35, stages: 5, steps: [0.2, 0.5, 0.35, 0.8, 0.6].map(function(v){ return { v: v, gate: true }; }) },
		preamp: { gain: 0.3 }, envf: { att: 0.01, rls: 0.3 },
		kb: { octave: 0, mode: "unison", hold: false }
	};
}

function validate( s )
{
	var cl = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	s.drones.forEach(function(d){ d.volt = cl( d.volt, -24, 36, 0 ); d.osc.forEach(function(o){ o.tune = cl( o.tune, -12, 24, 0 ); o.mod = cl( o.mod, 0, 1, 0 ); }); });
	s.noises.forEach(function(n){ n.divider = Math.round( cl( n.divider, 1, 8, 2 ) ); if(n.range != "hi") n.range = "lo"; });
	s.vcos.forEach(function(v){ v.octave = Math.round( cl( v.octave, 0, 7, 4 ) ); });
	s.fx.ch.forEach(function(c){ c.cart = Math.round( cl( c.cart, 0, CARTRIDGES.length - 1, 0 ) ); c.prog = Math.round( cl( c.prog, 0, 2, 0 ) ); });
	s.fx.edit = s.fx.edit ? 1 : 0;
	s.seq.stages = s.seq.stages == 4 ? 4 : 5;
	s.kb.octave = Math.round( cl( s.kb.octave, -3, 3, 0 ) );
	if(s.kb.mode != "duo") s.kb.mode = "unison";
}

function randomize( s )
{
	var rnd = function(a, b) { return a + Math.random() * (b - a); };
	var chords = [[0, 7, 12, 16, 19], [0, 5, 12, 17, 24], [0, 7, 10, 14, 19], [0, 3, 7, 12, 15], [0, 7, 12, 14, 19], [0, 6.86, 12, 15.86, 19.02]];
	s.drones.forEach(function(d){ var c = chords[ Math.floor( Math.random() * chords.length ) ]; d.osc.forEach(function(o, j){ o.tune = c[j] + rnd( -0.15, 0.15 ); o.mod = rnd( 0, 0.7 ); o.on = Math.random() < 0.85; }); d.volt = Math.round( rnd( -12, 19 ) ); d.att = rnd( 0.2, 4 ); d.rls = rnd( 1, 8 ); });
	s.fx.ch.forEach(function(c){ c.cart = Math.floor( Math.random() * CARTRIDGES.length ); c.prog = Math.floor( Math.random() * 3 ); c.x = rnd( 0.2, 0.8 ); c.y = rnd( 0.2, 0.8 ); c.z = rnd( 0.2, 0.8 ); });
	s.fx.blend = rnd( 0.3, 0.7 );
	s.filt.l.freq = rnd( 0.5, 0.95 ); s.filt.r.freq = rnd( 0.5, 0.95 ); s.filt.l.res = rnd( 0, 0.6 ); s.filt.r.res = rnd( 0, 0.6 );
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }

// ---------------------------------------------------------------------------
// widgets in the Solar's style (hardware coordinates)

function T( t, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + Math.round( size * K ) + "px " + P_FONT;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = color || INK;
	ctx.fillText( t, X(x), Y(y) );
}

// a black bar with white text (the sections' names)
function tag( t, x, y, w, h, size )
{
	ctx.fillStyle = INK;
	ctx.fillRect( X(x), Y(y), w * K, (h || 10) * K );
	T( t, x + w / 2, y + (h || 10) / 2 + 0.5, size || 7, "#ffffff" );
}
// a vertical black tag (MUTE, TUNE, MOD, HOLD, GATE, FILTER L)
function vtag( t, x, y, w, h )
{
	ctx.fillStyle = INK;
	ctx.fillRect( X(x), Y(y), w * K, h * K );
	ctx.save();
	ctx.translate( X(x + w / 2), Y(y + h / 2) );
	ctx.rotate( -Math.PI / 2 );
	ctx.font = "bold " + Math.round( 6.5 * K ) + "px " + P_FONT;
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	ctx.fillStyle = "#ffffff";
	ctx.fillText( t, 0, 0.5 );
	ctx.restore();
}

function frame( x1, y1, x2, y2 )
{
	ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
	ctx.strokeRect( X(x1) + 0.5, Y(y1) + 0.5, (x2 - x1) * K, (y2 - y1) * K );
}

function kn( id, x, y, r, value, min, max, o, tint, label, labelDy )
{
	knob_tint = tint || null;
	o = o || {};
	o.ticks = o.ticks || 11;
	value = knob( id, X(x), Y(y), Rr(r), value, min, max, o );
	knob_tint = null;
	if(label) T( label, x, y + r * 1.3 + 5, 7 ); // under the printed scale
	return value;
}

// a mini jack: a ring and a black hole; registered for the cables
function mj( id, x, y, type, label, labelDy )
{
	var full = id_prefix + id, cx = X(x), cy = Y(y);
	jacks[full] = { x: rackX( cx ), y: rackY( cy ), type: type, label: label || id };
	var hover = hitCircle( cx, cy, 11 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[full] ))
	{
		ctx.strokeStyle = hover ? INK : "rgba(0,0,0,0.3)"; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( cx, cy, 12, 0, Math.PI * 2 ); ctx.stroke();
	}
	ctx.fillStyle = type == "out" ? "#2a2a2a" : "#9a968c";
	ctx.beginPath(); ctx.arc( cx, cy, 8.5, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = hover && !cable_drag ? "#3a3a3a" : "#0a0a0a";
	ctx.beginPath(); ctx.arc( cx, cy, 5.5, 0, Math.PI * 2 ); ctx.fill();
	if(type == "out") { ctx.strokeStyle = "#e9e3d6"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc( cx, cy, 7, 0, Math.PI * 2 ); ctx.stroke(); }
	if(hover && label) tip( label + (type == "out" ? " (OUT)" : " (IN)"), cx, cy + 18 );
}

function hot( id, x, y, w, h )
{
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	if(padSlide( full, id_prefix + "pad", x, y, w, h )) { hover = true; clicked = true; ui.hot = full; } // sliding over from another pad
	var kb = keyButton( full, x, y, w, h ); // its key on the computer keyboard
	return { hover: hover, clicked: clicked || kb.pressed, held: (ui.active === full && ui.down) || kb.held };
}

// a small metal toggle (up: on)
function toggle( id, x, y, on, tooltip )
{
	var cx = X(x), cy = Y(y), h = hot( id, cx - 8, cy - 11, 16, 22 );
	ctx.fillStyle = "#6c6a66";
	ctx.beginPath(); ctx.arc( cx, cy, 5.5, 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createLinearGradient( cx - 3, 0, cx + 3, 0 );
	g.addColorStop( 0, "#f2f2f2" ); g.addColorStop( 1, "#8c8c8c" );
	ctx.strokeStyle = g; ctx.lineWidth = 3.5; ctx.lineCap = "round";
	ctx.beginPath(); ctx.moveTo( cx, cy ); ctx.lineTo( cx, cy + (on ? -9 : 9) ); ctx.stroke();
	ctx.lineCap = "butt";
	if(h.hover && tooltip) tip( tooltip, cx, cy + 20 );
	return h.clicked;
}

function led( x, y, on, color, r )
{
	r = (r || 2.6) * K;
	if(on > 0)
	{
		ctx.globalAlpha = Math.min( 1, on ) * 0.4;
		ctx.fillStyle = color;
		ctx.beginPath(); ctx.arc( X(x), Y(y), r * 2.4, 0, Math.PI * 2 ); ctx.fill();
		ctx.globalAlpha = 1;
	}
	ctx.fillStyle = on > 0 ? color : "#5a5650";
	ctx.beginPath(); ctx.arc( X(x), Y(y), r, 0, Math.PI * 2 ); ctx.fill();
}

// a momentary (or, with HOLD, latching) voice button / pad: the drone voices' gates
function gateButton( id, held, voice, index, tooltip )
{
	var map = pressed[ M.id ] = pressed[ M.id ] || {};
	var was = !!map[id];
	if(voice.hold)
	{
		if(held && !was) voice.latched = !voice.latched;
	}
	else if(held != was) send({ type: "drone", index: index, on: held });
	map[id] = held;
}
// the voices behind the six buttons: v1, v2, v3, v6, v7, v8
function voiceOf( index ) { return [S.drones[0], S.drones[1], S.noises[0], S.drones[2], S.drones[3], S.noises[1]][ index ]; }

// ---------------------------------------------------------------------------
// the sections

function drawDrone( k, x0, y0 )
{
	var d = S.drones[k], num = DRONES[k], idx = [0, 1, 3, 4][k], lit = ST && ST.drones ? ST.drones[ idx ] : 0;
	frame( x0, y0, x0 + 192, y0 + 150 );
	vtag( "MUTE", x0 + 2, y0 + 12, 11, 18 ); vtag( "TUNE", x0 + 2, y0 + 33, 11, 22 ); vtag( "MOD", x0 + 2, y0 + 58, 11, 22 );
	for(var j = 0; j < 5; ++j)
	{
		var o = d.osc[j], cx = x0 + 28 + j * 26;
		T( String( j + 1 ), cx, y0 + 7, 7 );
		// MUTE: the oscillator on (black) or muted (grey)
		var h = hot( "mute" + k + "_" + j, X(cx) - 9, Y(y0 + 21) - 9, 18, 18 );
		ctx.fillStyle = o.on ? INK : "#b9b4a8";
		ctx.beginPath(); ctx.arc( X(cx), Y(y0 + 21), 6.5 * K, 0, Math.PI * 2 ); ctx.fill();
		if(!o.on) { ctx.strokeStyle = RED; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo( X(cx) - 4, Y(y0 + 21) - 4 ); ctx.lineTo( X(cx) + 4, Y(y0 + 21) + 4 ); ctx.stroke(); }
		if(h.hover) tip( "OSCILLATOR " + (j + 1) + (o.on ? ": ON (CLICK: MUTE)" : ": MUTED"), X(cx), Y(y0 + 21) + 16 );
		if(h.clicked) o.on = !o.on;
		o.tune = kn( "tune" + k + "_" + j, cx, y0 + 44, 8.5, o.tune, -12, 24, { def: [0, 7, 12, 16, 19][j], format: function(v){ return "TUNE " + (v > 0 ? "+" : "") + v.toFixed(2) + " SEMITONES"; } } );
		o.mod = kn( "mod" + k + "_" + j, cx, y0 + 69, 7.5, o.mod, 0, 1, { def: 0.3, format: function(v){ return "MOD (DRIFT) " + fmtPct( v ); } }, "#b9b4a8" );
	}
	// the red bars: which oscillators sound
	ctx.fillStyle = INK; ctx.fillRect( X(x0 + 156), Y(y0 + 5), 36 * K, 24 * K );
	for(j = 0; j < 5; ++j)
	{
		ctx.fillStyle = d.osc[j].on ? (lit > 0.02 ? "rgba(255,60,40," + (0.35 + lit * 0.65) + ")" : "#7a1a14") : "#3a3a3a";
		ctx.fillRect( X(x0 + 158 + j * 6.8), Y(y0 + 7), 5 * K, 15 * K );
		T( String( j + 1 ), x0 + 160.5 + j * 6.8, y0 + 26, 4.5, "#ffffff" );
	}
	d.volt = kn( "volt" + k, x0 + 175, y0 + 60, 13, d.volt, -24, 36, { def: [0, 7, 12, -5][k], format: function(v){ var n = Math.round( v ) + 24; return "VOLT: " + NOTE_NAMES[ ((n % 12) + 12) % 12 ] + (Math.floor( n / 12 ) + 0) + (Math.abs( v - Math.round( v ) ) > 0.05 ? " " + (v - Math.round( v ) > 0 ? "+" : "") + Math.round( (v - Math.round( v )) * 100 ) + "c" : ""); } }, BLUE, "VOLT", 5 );
	// HOLD, GATE, ATT, RLS, CV, ENV OUT, the pad
	vtag( "HOLD", x0 + 2, y0 + 88, 11, 24 ); vtag( "GATE", x0 + 2, y0 + 116, 11, 26 );
	var hh = hot( "hold" + k, X(x0 + 16), Y(y0 + 92), 14 * K, 16 * K );
	led( x0 + 23, y0 + 100, d.hold ? 1 : 0, "#f5b400", 3.2 );
	if(hh.hover) tip( "HOLD: THE BUTTON / PAD LATCHES THE VOICE", X(x0 + 23), Y(y0 + 112) );
	if(hh.clicked) { d.hold = !d.hold; if(!d.hold) d.latched = false; }
	mj( "v" + num + "_gate", x0 + 26, y0 + 130, "in", "VOICE " + num + " GATE" );
	d.att = kn( "att" + k, x0 + 54, y0 + 99, 10, d.att, 0.005, 10, { exp: true, def: 1.5, format: function(v){ return "ATTACK " + fmtTime( v ); } }, null, "ATT", 4 );
	d.rls = kn( "rls" + k, x0 + 86, y0 + 99, 10, d.rls, 0.005, 15, { exp: true, def: 3, format: function(v){ return "RELEASE " + fmtTime( v ); } }, null, "RLS", 4 );
	mj( "v" + num + "_cv", x0 + 117, y0 + 99, "in", "VOICE " + num + " CV (1 V/OCT)" );
	T( "CV", x0 + 117, y0 + 115, 7 );
	T( "θ", x0 + 56, y0 + 131, 9 ); T( "env", x0 + 70, y0 + 127, 6, INK, "center", false ); T( "out", x0 + 70, y0 + 135, 6, INK, "center", false );
	mj( "v" + num + "_env", x0 + 88, y0 + 131, "out", "VOICE " + num + " ENV" );
	// the touch pad
	var px = X(x0 + 163), py = Y(y0 + 114), pr = 24 * K;
	var ph = hot( "pad" + k, px - pr, py - pr, pr * 2, pr * 2 );
	ctx.fillStyle = (d.latched || lit > 0.05) ? "#c9c3b5" : "#d8d3c8";
	ctx.beginPath(); ctx.arc( px, py, pr, 0, Math.PI * 2 ); ctx.fill();
	if(lit > 0.02) { ctx.strokeStyle = "rgba(227,38,29," + lit + ")"; ctx.lineWidth = 2; ctx.stroke(); }
	ctx.fillStyle = INK; ctx.fillRect( X(x0 + 180), Y(y0 + 137), 11 * K, 11 * K );
	T( String( num ), x0 + 185.5, y0 + 143, 8, "#ffffff" );
	if(ph.hover) tip( "VOICE " + num + (d.hold ? ": TOUCH TO LATCH" : ": TOUCH TO PLAY"), px, py + pr + 12 );
	gateButton( "pad" + k, ph.held, d, idx );
}

function drawNoise( k, x0, y0 )
{
	var n = S.noises[k], num = k ? 8 : 3, idx = k ? 5 : 2, lit = ST && ST.drones ? ST.drones[ idx ] : 0;
	frame( x0, y0, x0 + 192, y0 + 154 );
	tag( "VOICE " + num, x0 + 146, y0 + 2, 44 );
	T( "x10", x0 + 36, y0 + 10, 7 ); T( "x1", x0 + 36, y0 + 22, 7 );
	if(toggle( "x10_" + k, x0 + 50, y0 + 16, n.x10, "MODULATOR RATE x10 (UP) / x1" )) n.x10 = !n.x10;
	T( "fm", x0 + 86, y0 + 10, 8 );
	if(toggle( "fm_" + k, x0 + 100, y0 + 16, n.fm, "THE MODULATOR DOES FM (UP)" )) n.fm = !n.fm;
	T( "am", x0 + 124, y0 + 10, 8 );
	if(toggle( "am_" + k, x0 + 138, y0 + 18, n.am, "THE MODULATOR DOES AM (UP)" )) n.am = !n.am;
	n.rate = kn( "rate" + k, x0 + 20, y0 + 46, 10, n.rate, 0, 1, { def: 0.3, format: function(v){ return "MODULATOR " + (0.03 * Math.pow( 600, v ) * (n.x10 ? 10 : 1)).toFixed(2) + " Hz"; } }, null, "rate", 4 );
	mj( "v" + num + "_mod", x0 + 54, y0 + 40, "out", "VOICE " + num + " MODULATOR OUT" );
	T( "out", x0 + 54, y0 + 54, 7, INK, "center", false );
	n.fm_amt = kn( "fm_amt" + k, x0 + 88, y0 + 46, 10, n.fm_amt, 0, 1, { def: 0.2, format: fmtPct }, null, "fm amt", 4 );
	n.divider = kn( "divider" + k, x0 + 122, y0 + 46, 10, n.divider, 1, 8, { step: 1, def: 2, format: function(v){ return v < 1.5 ? "DIVIDER OFF" : "SUB ÷" + v; } }, null, "divider", 4 );
	n.pitch = kn( "pitch" + k, x0 + 172, y0 + 46, 13, n.pitch, 0, 1, { def: k ? 0.55 : 0.35, format: function(v){ return Math.round( (n.range == "hi" ? 80 : 20) * Math.pow( n.range == "hi" ? 60 : 30, v ) ) + " Hz"; } }, BLUE, "PITCH", 5 );
	T( "range", x0 + 132, y0 + 74, 7, INK, "center", false );
	if(toggle( "range_" + k, x0 + 150, y0 + 76, n.range == "hi", "RANGE: HIGH (UP) / LOW" )) n.range = n.range == "hi" ? "lo" : "hi";
	mj( "v" + num + "_fm", x0 + 90, y0 + 82, "in", "VOICE " + num + " FM IN" );
	T( "fm in", x0 + 72, y0 + 82, 7, INK, "center", false );
	n.noise = kn( "noise" + k, x0 + 120, y0 + 100, 9, n.noise, 0, 1, { def: 0.15, format: function(v){ return "NOISE " + fmtPct( v ); } }, null, "NOISE", 3 );
	// S&H lights
	for(var j = 0; j < 4; ++j) led( x0 + 164 + (j % 2) * 9, y0 + 88 + Math.floor( j / 2 ) * 9, lit > 0.02 && (j + Math.floor( (performance.now() / 300) )) % 3 == 0 ? 1 : 0, j % 2 ? "#ffffff" : RED, 2.2 );
	tag( "S&H", x0 + 170, y0 + 107, 20, 9, 6 );
	vtag( "HOLD", x0 + 2, y0 + 88, 11, 24 ); vtag( "GATE", x0 + 2, y0 + 118, 11, 30 );
	var hh = hot( "nhold" + k, X(x0 + 16), Y(y0 + 92), 14 * K, 16 * K );
	led( x0 + 23, y0 + 100, n.hold ? 1 : 0, "#f5b400", 3.2 );
	if(hh.hover) tip( "HOLD: THE BUTTON LATCHES THE VOICE", X(x0 + 23), Y(y0 + 112) );
	if(hh.clicked) { n.hold = !n.hold; if(!n.hold) n.latched = false; }
	n.att = kn( "natt" + k, x0 + 50, y0 + 104, 9, n.att, 0.005, 10, { exp: true, def: 1, format: function(v){ return "ATTACK " + fmtTime( v ); } }, null, "ATT", 3 );
	n.rls = kn( "nrls" + k, x0 + 82, y0 + 104, 9, n.rls, 0.005, 15, { exp: true, def: 2, format: function(v){ return "RELEASE " + fmtTime( v ); } }, null, "RLS", 3 );
	mj( "v" + num + "_gate", x0 + 26, y0 + 136, "in", "VOICE " + num + " GATE" );
	[["_env", "env out", "out", 84], ["_sh_in", "in", "in", 116], ["_sh_clk", "clock", "in", 146], ["_sh", "out", "out", 176]].forEach(function(jk){
		mj( "v" + num + jk[0], x0 + jk[3], y0 + 136, jk[2], "VOICE " + num + " " + (jk[0] == "_env" ? "ENV" : "S&H " + jk[1].toUpperCase()) );
		T( jk[1], x0 + jk[3], y0 + 148, 6.5, INK, "center", false );
	});
}

function drawVco( k, x0, y0 )
{
	var v = S.vcos[k], num = 4 + k;
	frame( x0, y0, x0 + 190, y0 + 154 );
	tag( "VOICE " + num, x0 + 146, y0 + 2, 44 );
	T( "VCO " + (k + 1), x0 + 168, y0 + 20, 7 );
	T( "octave", x0 + 46, y0 + 10, 8, INK, "center", false );
	v.fine = kn( "fine" + k, x0 + 32, y0 + 46, 12, v.fine, -1, 1, { def: 0, format: function(x){ return "FINE " + (x > 0 ? "+" : "") + Math.round( x * 100 ) + " CENTS"; } } );
	v.octave = kn( "octave" + k, x0 + 90, y0 + 46, 14, v.octave, 0, 7, { step: 1, def: 4, format: function(x){ return "OCTAVE " + FOOT[x]; } } );
	FOOT.forEach(function(f, i){
		var a = KNOB_A0 + i / 7 * KNOB_SWEEP;
		T( f, x0 + 90 + Math.cos(a) * 26, y0 + 46 + Math.sin(a) * 26, 6.5 );
	});
	v.tune = kn( "tune" + k, x0 + 155, y0 + 46, 13, v.tune, -7, 7, { def: 0, format: function(x){ return "TUNE " + (x > 0 ? "+" : "") + x.toFixed(2) + " SEMITONES"; } }, BLUE, "tune", 4 );
	v.fm = kn( "fm" + k, x0 + 32, y0 + 102, 11, v.fm, 0, 1, { def: 0.3, format: function(x){ return "FM IN AMOUNT " + fmtPct( x ); } } );
	v.shape = kn( "shape" + k, x0 + 90, y0 + 104, 17, v.shape, 0, 1, { def: 0.6, format: function(x){ var n = ["SINE", "TRIANGLE", "SAW", "SQUARE"], i = Math.min( 2, Math.floor( x * 3 ) ), f = x * 3 - i; return f < 0.05 ? n[i] : (f > 0.95 ? n[i + 1] : n[i] + " → " + n[i + 1]); } } );
	// the wave icons around SHAPE
	ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
	[[-30, -10, "sine"], [-14, -26, "tri"], [14, -26, "saw"], [30, -10, "sq"]].forEach(function(wv){
		var cx = X(x0 + 90 + wv[0]), cy = Y(y0 + 104 + wv[1]), w = 9;
		ctx.beginPath();
		for(var i = 0; i <= 12; ++i)
		{
			var t = i / 12, yv = wv[2] == "sine" ? Math.sin( t * Math.PI * 2 ) : (wv[2] == "tri" ? 1 - 4 * Math.abs( t - 0.5 ) : (wv[2] == "saw" ? 1 - 2 * t : (t < 0.5 ? 1 : -1)));
			var px = cx - w + t * 2 * w, py = cy - yv * 4;
			i ? ctx.lineTo( px, py ) : ctx.moveTo( px, py );
		}
		ctx.stroke();
	});
	v.pw = kn( "pw" + k, x0 + 155, y0 + 100, 11, v.pw, 0, 1, { def: 0.5, format: function(x){ return "PULSE WIDTH " + Math.round( 5 + x * 90 ) + "%"; } }, null, "pw", 3 );
	var jk = k ? [["_voct", "volt oct", "in", 26], ["_fm", "fm", "in", 64], ["_shape", "shape", "in", 100], ["_sync", "sync", "in", 136], ["_out", "vco out", "out", 172]]
		: [["_voct", "volt oct", "in", 26], ["_fm", "fm", "in", 72], ["_shape", "shape", "in", 116], ["_out", "vco out", "out", 166]];
	jk.forEach(function(j){
		mj( "v" + num + j[0], x0 + j[3], y0 + 136, j[2], "VCO " + (k + 1) + " " + j[1].toUpperCase() );
		T( j[1], x0 + j[3], y0 + 148, 6.5, INK, "center", false );
	});
}

function drawEg( k, x0, y0 )
{
	var e = S.egs[k], lit = ST && ST.eg ? ST.eg[k] : 0;
	frame( x0, y0, x0 + 162, y0 + 80 );
	T( "EG VCA " + (k + 1), x0 + 138, y0 + 8, 7 );
	led( x0 + 116, y0 + 8, lit, "#f5b400", 2.6 );
	T( "hold", x0 + 22, y0 + 8, 7, INK, "center", false );
	if(toggle( "eghold" + k, x0 + 36, y0 + 12, e.hold, "HOLD: THE GATE STAYS OPEN (A DRONE)" )) e.hold = !e.hold;
	T( "loop", x0 + 64, y0 + 8, 7, INK, "center", false );
	if(toggle( "egloop" + k, x0 + 78, y0 + 12, e.loop, "LOOP: ATTACK / DECAY OVER AND OVER" )) e.loop = !e.loop;
	e.a = kn( "ega" + k, x0 + 18, y0 + 40, 11, e.a, 0.001, 10, { exp: true, def: 0.01, format: function(v){ return "ATTACK " + fmtTime( v ); } }, null, "attack", 3 );
	e.d = kn( "egd" + k, x0 + 56, y0 + 40, 11, e.d, 0.002, 10, { exp: true, def: 0.4, format: function(v){ return "DECAY " + fmtTime( v ); } }, null, "decay", 3 );
	e.s = kn( "egs" + k, x0 + 95, y0 + 40, 11, e.s, 0, 1, { def: 0.6, format: function(v){ return "SUSTAIN " + fmtPct( v ); } }, null, "sustain", 3 );
	e.r = kn( "egr" + k, x0 + 134, y0 + 40, 11, e.r, 0.002, 15, { exp: true, def: 0.8, format: function(v){ return "RELEASE " + fmtTime( v ); } }, null, "release", 3 );
	[["eg" + (k + 1) + "_gate", "gate in", "in", 18], ["eg" + (k + 1) + "_out", "eg out", "out", 56], ["vca" + (k + 1) + "_cv", "vca cv", "in", 95]].forEach(function(j){
		mj( j[0], x0 + j[3], y0 + 68, j[2], "EG VCA " + (k + 1) + " " + j[1].toUpperCase() );
		T( j[1], x0 + j[3] + 18, y0 + 72, 6, INK, "center", false );
	});
}

function drawMixer()
{
	frame( 392, 258, 778, 348 );
	MIX_ORDER.forEach(function(m, i){
		var cx = 411 + i * 38.6, c = S.mix[ m[0] ];
		T( "pan", cx, y0p( 262 ), 5.5, INK, "center", false );
		c.pan = kn( "pan" + m[0], cx, 276, 7.5, c.pan, -1, 1, { def: 0, bipolar: true, format: function(v){ return m[1] + " PAN " + (Math.abs( v ) < 0.03 ? "CENTRE" : (v < 0 ? "L " : "R ") + Math.round( Math.abs( v ) * 100 ) + "%"); } } );
		tag( m[1], cx - 18, 293, 36, 9, 6 );
		c.vol = kn( "vol" + m[0], cx, 322, 12, c.vol, 0, 1, { def: 0.6, format: function(v){ return m[1] + " VOL " + fmtPct( v ); } } );
		T( "vol", cx, 340, 6, INK, "center", false );
	});
}
function y0p( y ) { return y; }

function drawEffector()
{
	var f = S.fx, ed = f.ch[ f.edit ], cart = CARTRIDGES[ ed.cart ], prog = cart[1][ ed.prog ];
	frame( 392, 100, 778, 258 );
	tag( "DUAL EFFECTOR", 510, 98, 140, 9, 7 );
	[["fx_cvx", "cv x", 410], ["fx_cvy", "cv y", 463], ["fx_cvz", "cv z", 516]].forEach(function(j){
		T( "▶ " + j[1], j[2], 114, 7, INK, "center", false );
		mj( j[0], j[2], 128, "in", j[1].toUpperCase() + " (BOTH SIDES)" );
	});
	["x", "y", "z"].forEach(function(p, i){
		var cx = 410 + i * 54;
		ed[p] = kn( "fx_" + p, cx, 172, 13, ed[p], 0, 1, { def: 0.5, format: function(v){ return (f.edit ? "R" : "L") + " " + prog[ i + 1 ] + " " + fmtPct( v ); } }, RED );
		T( p.toUpperCase(), cx, 194, 9 );
		T( prog[ i + 1 ], cx, 203, 5.5, INK, "center", false );
	});
	// the cartridge slot: the cartridge of the side edited, its program, L / R
	T( "cartridge slot", 589, 118, 7, INK, "center", false );
	var sx = X(553), sy = Y(124), sw = 72 * K, sh = 26 * K;
	ctx.fillStyle = INK; ctx.fillRect( sx - 3, sy - 3, sw + 6, sh + 6 );
	var g = ctx.createLinearGradient( sx, sy, sx, sy + sh );
	g.addColorStop( 0, "#d9b86a" ); g.addColorStop( 1, "#a8822e" );
	ctx.fillStyle = g; ctx.fillRect( sx, sy, sw, sh );
	T( cart[0], 589, 131, 7.5, "#2a1c04" );
	T( prog[0], 589, 141, 6, "#2a1c04", "center", false );
	var ch = hot( "cart", sx, sy, sw, sh );
	if(ch.hover) tip( "THE " + (f.edit ? "RIGHT" : "LEFT") + " SIDE'S CARTRIDGE: CLICK FOR THE NEXT", sx + sw / 2, sy + sh + 14 );
	if(ch.clicked) { ed.cart = (ed.cart + 1) % CARTRIDGES.length; ed.prog = 0; }
	// program 1-2-3 of the edited side, L / R
	for(var p = 0; p < 3; ++p)
	{
		var bx = X(560 + p * 10), by = Y(165), h = hot( "prog" + p, bx - 6, by - 6, 12, 12 );
		ctx.fillStyle = ed.prog == p ? RED : "#bdb7aa";
		ctx.beginPath(); ctx.arc( bx, by, 4 * K, 0, Math.PI * 2 ); ctx.fill();
		T( String( p + 1 ), 560 + p * 10, 157, 6 );
		if(h.hover) tip( "PROGRAM " + (p + 1) + ": " + cart[1][p][0], bx, by + 14 );
		if(h.clicked) ed.prog = p;
	}
	T( "L/R", 610, 157, 6 );
	if(toggle( "fx_edit", 610, 168, f.edit == 1, "THE X / Y / Z KNOBS, CARTRIDGE AND PROGRAM: LEFT (DOWN) OR RIGHT (UP) SIDE" )) f.edit = f.edit ? 0 : 1;
	T( "L", 568, 188, 7 ); T( "R", 610, 188, 7 );
	led( 568, 197, f.edit == 0 ? 1 : 0, RED, 3 ); led( 610, 197, f.edit == 1 ? 1 : 0, RED, 3 );
	T( "L: " + CARTRIDGES[ f.ch[0].cart ][0].substr( 0, 9 ) + " " + (f.ch[0].prog + 1), 589, 210, 5.5, INK, "center", false );
	T( "R: " + CARTRIDGES[ f.ch[1].cart ][0].substr( 0, 9 ) + " " + (f.ch[1].prog + 1), 589, 218, 5.5, INK, "center", false );
	T( "BLEND", 641, 140, 7 );
	f.blend = kn( "blend", 641, 172, 12, f.blend, 0, 1, { def: 0.45, format: function(v){ return Math.round( (1 - v) * 100 ) + " DRY / " + Math.round( v * 100 ) + " WET"; } } );
	T( "MASTER", 692, 132, 7 ); T( "VOLUME", 692, 141, 7 );
	f.master = kn( "master", 692, 174, 17, f.master, 0, 1, { def: 0.7, format: fmtPct }, RED );
	// headphones
	ctx.strokeStyle = INK; ctx.lineWidth = 2;
	ctx.beginPath(); ctx.arc( X(757), Y(124), 8 * K, Math.PI, 0 ); ctx.stroke();
	ctx.fillStyle = INK; ctx.fillRect( X(748), Y(123), 4 * K, 8 * K ); ctx.fillRect( X(762), Y(123), 4 * K, 8 * K );
	f.phones = kn( "phones", 757, 170, 12, f.phones, 0, 1, { def: 0.6, format: function(v){ return "HEADPHONES " + fmtPct( v ) + " (NOT IN THE RACK)"; } }, BLUE );
	// FILTER L / R
	var fl = S.filt;
	ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
	ctx.strokeRect( X(392), Y(214), 386 * K, 44 * K );
	vtag( "FILTER L", 393, 216, 10, 40 ); vtag( "FILTER R", 767, 216, 10, 40 );
	fl.l.freq = kn( "fl_freq", 430, 232, 12, fl.l.freq, 0, 1, { def: 0.75, format: function(v){ return "FILTER L " + fmtHz( 30 * Math.pow( 600, v ) ); } }, null, "freq", 2 );
	fl.l.res = kn( "fl_res", 486, 232, 12, fl.l.res, 0, 1, { def: 0.2, format: function(v){ return "FILTER L RESONANCE " + fmtPct( v ); } }, null, "res", 2 );
	mj( "filt_cv", 535, 236, "in", "FILTERS CV FREQ (1 V/OCT x CV FREQ)" );
	ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo( X(546), Y(236) ); ctx.lineTo( X(568), Y(236) ); ctx.stroke();
	fl.cv = kn( "filt_cvamt", 583, 236, 11, fl.cv, 0, 1, { def: 0.5, format: function(v){ return "CV FREQ AMOUNT " + fmtPct( v ); } }, "#f4f1ea" );
	T( "cv freq", 583, 252, 6.5, INK, "center", false );
	if(toggle( "link", 630, 234, fl.link, "LINK: FILTER R FOLLOWS FILTER L" )) fl.link = !fl.link;
	T( "link", 630, 252, 6.5, INK, "center", false );
	fl.r.freq = kn( "fr_freq", 682, 232, 12, fl.r.freq, 0, 1, { def: 0.75, format: function(v){ return "FILTER R " + fmtHz( 30 * Math.pow( 600, v ) ) + (fl.link ? " (LINKED: L SETS IT)" : ""); } }, null, "freq", 2 );
	fl.r.res = kn( "fr_res", 738, 232, 12, fl.r.res, 0, 1, { def: 0.2, format: function(v){ return "FILTER R RESONANCE " + fmtPct( v ); } }, null, "res", 2 );
}

function drawBottomRow()
{
	var y0 = 430, st = ST || {};
	// LFO A / B
	[[8, 0], [1025, 1]].forEach(function(l){
		var x0 = l[0], k = l[1], o = S.lfo[k];
		frame( x0, y0, x0 + 138, y0 + 70 );
		tag( k ? "LFO B" : "LFO A", x0 + 2, y0 + 60, 134, 9, 7 );
		o.wave = kn( "lfowave" + k, x0 + 28, y0 + 26, 12, o.wave, 0, 1, { def: k ? 0.5 : 0, format: function(v){ return v < 0.05 ? "TRIANGLE" : (v > 0.95 ? "SQUARE" : "TRIANGLE → SQUARE " + fmtPct( v )); } } );
		T( "Λ", x0 + 12, y0 + 44, 7 ); T( "Π", x0 + 44, y0 + 44, 7 ); T( "wave", x0 + 28, y0 + 52, 6.5, INK, "center", false );
		mj( k ? "lfob_out" : "lfoa_out", x0 + 70, y0 + 16, "out", k ? "LFO B (0..10 V)" : "LFO A (0..10 V)" );
		T( "out", x0 + 70, y0 + 6, 6.5, INK, "center", false );
		led( x0 + 70, y0 + 40, st.lfo ? (st.lfo[k] + 1) / 2 : 0, "#4aa8ff", 3.5 );
		o.rate = kn( "lforate" + k, x0 + 110, y0 + 26, 13, o.rate, 0, 1, { def: 0.3, format: function(v){ var hz = 0.02 * Math.pow( 1000, v ); return hz < 1 ? hz.toFixed(3) + " Hz (" + (1 / hz).toFixed(1) + " s)" : hz.toFixed(2) + " Hz"; } }, null, "rate", 3 );
	});
	// JOYSTICK offsets and outputs
	var j = S.joy;
	frame( 148, y0, 292, y0 + 70 );
	tag( "JOYSTICK", 150, y0 + 60, 140, 9, 7 );
	j.offx = kn( "offx", 175, y0 + 26, 12, j.offx, 0, 1, { def: 0.5, format: function(v){ return "OFFSET X " + ((v - 0.5) * 10).toFixed(1) + " V"; } }, null, "offset x", 3 );
	j.offy = kn( "offy", 264, y0 + 26, 12, j.offy, 0, 1, { def: 0.5, format: function(v){ return "OFFSET Y " + ((v - 0.5) * 10).toFixed(1) + " V"; } }, null, "offset y", 3 );
	mj( "joy_x", 219, y0 + 14, "out", "JOYSTICK X" ); mj( "joy_y", 219, y0 + 40, "out", "JOYSTICK Y" );
	T( "x", 205, y0 + 14, 7 ); T( "y", 205, y0 + 40, 7 );
	// 5 STEP SEQUENCER
	var q = S.seq;
	frame( 292, y0, 748, y0 + 70 );
	tag( "5 STEP SEQ.  VOLTAGE", 294, y0 + 60, 452, 9, 7 );
	q.pulser = kn( "pulser", 318, y0 + 26, 12, q.pulser, 0, 1, { def: 0.35, format: function(v){ var hz = 0.1 * Math.pow( 200, v ); return "PULSER " + hz.toFixed(2) + " Hz (" + Math.round( hz * 60 ) + " STEPS / MIN)"; } }, null, "pulser", 3 );
	mj( "pulser_out", 352, y0 + 14, "out", "PULSER OUT" ); T( "out", 366, y0 + 14, 6, INK, "center", false );
	mj( "seq_clock", 352, y0 + 40, "in", "CLOCK IN (THE PULSER OTHERWISE)" ); T( "clock", 352, y0 + 52, 6.5, INK, "center", false );
	T( "4", 388, y0 + 14, 7 ); T( "5", 388, y0 + 40, 7 );
	if(toggle( "stages", 388, y0 + 27, q.stages == 5, "STAGES: 5 (UP) / 4" )) q.stages = q.stages == 5 ? 4 : 5;
	T( "stages", 388, y0 + 52, 6.5, INK, "center", false );
	q.steps.forEach(function(sp, i){
		var cx = 425 + i * 58;
		sp.v = kn( "step" + i, cx, y0 + 26, 12, sp.v, 0, 1, { def: 0.5, format: function(v){ return "STEP " + (i + 1) + ": " + (v * 5).toFixed(2) + " V"; } }, RED, "step " + (i + 1), 3 );
		led( cx + 24, y0 + 14, st.seq == i ? 1 : 0, RED, 3 );
		if(toggle( "stepgate" + i, cx + 24, y0 + 34, sp.gate, "STEP " + (i + 1) + ": A GATE (UP) / NONE" )) sp.gate = !sp.gate;
		T( "gate", cx + 24, y0 + 52, 5.5, INK, "center", false );
	});
	mj( "seq_cv", 722, y0 + 14, "out", "SEQUENCER CV (0..5 V)" ); T( "cv", 708, y0 + 14, 6.5, INK, "center", false );
	mj( "seq_gate", 722, y0 + 40, "out", "SEQUENCER GATE" ); T( "gate out", 722, y0 + 52, 6, INK, "center", false );
	// PREAMP
	frame( 748, y0, 842, y0 + 70 );
	tag( "PREAMP", 750, y0 + 60, 90, 9, 7 );
	mj( "preamp_cv", 770, y0 + 26, "in", "EXT. SOURCE (A CV-LEVEL SIGNAL; AUDIO: PREAMP IN ON THE BACK)" );
	T( "ext.", 770, y0 + 42, 6.5, INK, "center", false ); T( "source", 770, y0 + 49, 6.5, INK, "center", false );
	S.preamp.gain = kn( "gain", 804, y0 + 26, 12, S.preamp.gain, 0, 1, { def: 0.3, format: function(v){ return "PREAMP GAIN +" + Math.round( 20 * Math.log10( 1 + v * 20 ) ) + " dB"; } }, null, "gain", 3 );
	led( 830, y0 + 26, st.sig ? 1 : 0, "#4aa8ff", 3 );
	// ENVELOPE FOLLOWER
	var e = S.envf;
	frame( 842, y0, 1025, y0 + 70 );
	tag( "ENVELOPE FOLLOWER", 844, y0 + 60, 179, 9, 7 );
	e.att = kn( "ef_att", 866, y0 + 26, 12, e.att, 0.001, 1, { exp: true, def: 0.01, format: function(v){ return "ATTACK " + fmtTime( v ); } }, null, "attack", 3 );
	e.rls = kn( "ef_rls", 920, y0 + 26, 12, e.rls, 0.01, 4, { exp: true, def: 0.3, format: function(v){ return "RELEASE " + fmtTime( v ); } }, null, "release", 3 );
	led( 950, y0 + 26, st.envf ? Math.min( 1, st.envf * 6 ) : 0, RED, 3 );
	mj( "envf_out", 975, y0 + 26, "out", "ENVELOPE (0..10 V)" ); T( "envelope", 975, y0 + 42, 6.5, INK, "center", false );
	led( 992, y0 + 26, st.envf > 0.05 ? 1 : 0, "#3cc04a", 3 );
	mj( "envf_gate", 1010, y0 + 26, "out", "ENVELOPE GATE" ); T( "gate", 1010, y0 + 42, 6.5, INK, "center", false );
}

// the joystick: drag the stick; double-click centres it
function drawJoystick()
{
	var cx = X(88), cy = Y(630), j = S.joy, R = 38 * K;
	["▲", "▼", "◀", "▶"].forEach(function(a, i){
		var dx = [0, 0, -1, 1][i], dy = [-1, 1, 0, 0][i];
		T( a, 88 + dx * 52, 630 + dy * 52, 12 );
	});
	var full = id_prefix + "joystick";
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitCircle( cx, cy, R );
	if(hover) { ui.hot = full; tip( "JOYSTICK X " + (j.x * 5).toFixed(1) + " V, Y " + (j.y * 5).toFixed(1) + " V (DOUBLE-CLICK: CENTRE)", cx, cy + R + 30 ); }
	if(hover && ui.pressed && ui.active === null) { ui.active = full; if(ui.dbl) { j.x = 0; j.y = 0; } }
	if(ui.active === full && ui.down)
	{
		j.x = Math.max( -1, Math.min( 1, (ui.x - cx) / R ) );
		j.y = Math.max( -1, Math.min( 1, (cy - ui.y) / R ) );
	}
	ctx.fillStyle = "#cfc9bc";
	ctx.beginPath(); ctx.arc( cx, cy, R, 0, Math.PI * 2 ); ctx.fill();
	var sx = cx + j.x * R * 0.6, sy = cy - j.y * R * 0.6;
	ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc( sx + 3, sy + 4, 21 * K, 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createRadialGradient( sx - 6, sy - 7, 2, sx, sy, 22 * K );
	g.addColorStop( 0, "#4a4a4a" ); g.addColorStop( 1, "#0c0c0c" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( sx, sy, 21 * K, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#3a3a3a"; ctx.beginPath(); ctx.arc( sx, sy, 9 * K, 0, Math.PI * 2 ); ctx.fill();
}

function drawController()
{
	T( "TOUCH SENSITIVE CONTROLLER", 880, 525, 9 );
	ctx.fillStyle = "#1b1b1b";
	ctx.beginPath(); ctx.roundRect( X(195), Y(535), 780 * K, 193 * K, 4 ); ctx.fill();
	// the plates: notes of the octave, left to right; HOLD (the white button) latches them
	var kb = S.kb, map = pressed[ M.id ] = pressed[ M.id ] || {};
	PLATES.forEach(function(p, i){
		var x = X(p[0]), y = Y(p[1]), w = 36 * K, h = (p[2] - p[1]) * K;
		var r = hot( "plate" + i, x, y, w, h );
		var on = kb.hold ? !!(kb.latched || [])[i] : r.held;
		ctx.fillStyle = on ? "#ffd9a8" : "#f4f2ee";
		ctx.fillRect( x, y, w, h );
		ctx.fillStyle = "#1b1b1b";
		for(var l = 0; l < Math.floor( h / (6 * K) ); ++l) ctx.fillRect( x + 3, y + 3 + l * 6 * K + 3 * K, w - 6, 1.6 );
		if(r.hover) tip( NOTE_NAMES[i] + (3 + kb.octave) + (kb.hold ? " (HOLD: CLICK TO LATCH)" : ""), x + w / 2, y + h + 12 );
		if(kb.hold)
		{
			if(r.clicked) { kb.latched = kb.latched || []; kb.latched[i] = !kb.latched[i]; send({ type: "plate", note: i, on: kb.latched[i] }); }
		}
		else if(r.held != !!map["plate" + i]) send({ type: "plate", note: i, on: r.held });
		map["plate" + i] = kb.hold ? false : r.held;
	});
	// triangles
	ctx.strokeStyle = "#f4f2ee"; ctx.lineWidth = 3;
	[340, 840].forEach(function(tx){ ctx.beginPath(); ctx.moveTo( X(tx), Y(672) ); ctx.lineTo( X(tx + 20), Y(710) ); ctx.lineTo( X(tx - 20), Y(710) ); ctx.closePath(); ctx.stroke(); });
	// the plates' CV / gates
	[["kb_voct", "V/OCT", 432], ["kb_gate", "GATE", 456], ["kb_voct2", "V/OCT 2", 706], ["kb_gate2", "GATE 2", 730]].forEach(function(j){
		mj( j[0], j[2], 553, "out", "PLATES " + j[1] );
		T( j[1], j[2], 567, 5.5, "#cccccc", "center", false );
	});
	// octave down / up, HOLD, the display (click: UNISON / DUO), the sun
	var ob = function(id, x, label, d) {
		var r = hot( id, X(x) - 12, Y(580) - 12, 24, 24 );
		ctx.fillStyle = r.held ? "#ff5a48" : "#e04a3a";
		ctx.beginPath(); ctx.arc( X(x), Y(580), 9 * K, 0, Math.PI * 2 ); ctx.fill();
		T( label, x, 566, 7, "#f4f2ee" );
		if(r.hover) tip( d > 0 ? "OCTAVE UP" : "OCTAVE DOWN", X(x), Y(580) + 18 );
		if(r.clicked) kb.octave = Math.max( -3, Math.min( 3, kb.octave + d ) );
	};
	ob( "oct_dn", 533, "▽", -1 ); ob( "oct_up", 633, "△", 1 );
	var hb = hot( "kbhold", X(583) - 14, Y(580) - 14, 28, 28 );
	ctx.fillStyle = "#f4f2ee"; ctx.beginPath(); ctx.arc( X(583), Y(580), 13 * K, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = kb.hold ? "#ff7a2a" : "#1b1b1b"; ctx.beginPath(); ctx.arc( X(583), Y(580), 7 * K, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#f4f2ee"; ctx.beginPath(); ctx.arc( X(583), Y(580), 4 * K, 0, Math.PI * 2 ); ctx.fill();
	if(hb.hover) tip( "HOLD: THE PLATES LATCH", X(583), Y(580) + 20 );
	if(hb.clicked)
	{
		kb.hold = !kb.hold;
		if(!kb.hold) { (kb.latched || []).forEach(function(on, i){ if(on) send({ type: "plate", note: i, on: false }); }); kb.latched = []; }
	}
	var lx = X(551), ly = Y(606), lw = 64 * K, lh = 20 * K;
	ctx.fillStyle = "#2f4bd8"; ctx.fillRect( lx, ly, lw, lh );
	T( "OCT " + (kb.octave >= 0 ? "+" : "") + kb.octave, 583, 612, 6.5, "#e8f0ff" );
	T( kb.mode == "duo" ? "TWIN: 2 NOTES" : "SINGLE", 583, 620, 5.5, "#e8f0ff", "center", false );
	var lc = hot( "kbmode", lx, ly, lw, lh );
	if(lc.hover) tip( "SINGLE: BOTH VCOS ON THE LAST NOTE; TWIN: VCO 1 AND 2 ON THE LAST TWO", lx + lw / 2, ly + lh + 12 );
	if(lc.clicked) kb.mode = kb.mode == "duo" ? "unison" : "duo";
	// the sun
	var sx = X(583), sy = Y(668);
	ctx.strokeStyle = "#f4f2ee"; ctx.lineWidth = 1.4;
	for(var r2 = 4; r2 <= 18; r2 += 3.5) { ctx.beginPath(); ctx.arc( sx, sy, r2 * K, 0, Math.PI * 2 ); ctx.stroke(); }
	ctx.beginPath();
	for(var i = 0; i < 24; ++i) { var a = i / 24 * Math.PI * 2, r1 = 21 * K, rr = (i % 2 ? 29 : 34) * K; ctx.moveTo( sx + Math.cos(a) * r1, sy + Math.sin(a) * r1 ); ctx.lineTo( sx + Math.cos(a) * rr, sy + Math.sin(a) * rr ); }
	ctx.stroke();
}

function drawDroneButtons()
{
	T( "DRONE VOICES", 1088, 525, 9 );
	[[1, 0, 0], [6, 1, 0], [2, 0, 1], [7, 1, 1], [3, 0, 2], [8, 1, 2]].forEach(function(b){
		var num = b[0], index = [1, 2, 3, 6, 7, 8].indexOf( num ), v = voiceOf( index );
		var x = 1033 + b[1] * 55, y = 555 + b[2] * 62, lit = ST && ST.drones ? ST.drones[ index ] : 0;
		T( String( num ), x + 17, y - 9, 8 );
		var r = hot( "dv" + num, X(x), Y(y), 36 * K, 36 * K );
		ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect( X(x) + 2, Y(y) + 3, 36 * K, 36 * K );
		var g = ctx.createLinearGradient( 0, Y(y), 0, Y(y + 36) );
		g.addColorStop( 0, r.held ? "#2a2a2a" : "#3a3a3a" ); g.addColorStop( 1, "#0e0e0e" );
		ctx.fillStyle = g; ctx.fillRect( X(x), Y(y) + (r.held ? 1 : 0), 36 * K, 36 * K );
		if(v.latched || lit > 0.05) { ctx.strokeStyle = "rgba(255,90,60," + Math.max( v.latched ? 0.8 : 0, lit ) + ")"; ctx.lineWidth = 2; ctx.strokeRect( X(x) - 1, Y(y) - 1, 36 * K + 2, 36 * K + 2 ); }
		if(r.hover) tip( "VOICE " + num + (v.hold ? ": CLICK TO LATCH" : ": HOLD TO PLAY (HOLD ON THE VOICE: LATCH)"), X(x + 18), Y(y + 36) + 14 );
		gateButton( "dv" + num, r.held, v, index );
	});
}

function draw( mod )
{
	M = mod; S = mod.settings; ST = mod.state;
	var w = SIZE[0], h = SIZE[1];
	ctx.fillStyle = CREAM;
	ctx.fillRect( 0, 0, w, h );
	// the name: LUNAR in black, 21 in red, and what it is
	ctx.font = "bold " + Math.round( 66 * K ) + "px " + P_FONT;
	ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
	ctx.fillStyle = INK; ctx.fillText( "LUNAR", X(24), Y(106) );
	var lw = ctx.measureText( "LUNAR " ).width;
	ctx.fillStyle = RED; ctx.fillText( "21", X(24) + lw, Y(106) );
	T( "AMBIENT", 925, 72, 24, INK, "center" );
	T( "MACHINE", 925, 96, 24, INK, "center" );
	knob_scale_color = "#2a2a2a";
	drawDrone( 0, 8, 122 ); drawDrone( 1, 200, 122 ); drawDrone( 2, 778, 122 ); drawDrone( 3, 970, 122 );
	drawEffector();
	drawNoise( 0, 8, 274 ); drawVco( 0, 202, 274 );
	drawMixer();
	drawEg( 0, 392, 348 );
	// VOICE MIXER, the spiral
	frame( 554, 348, 616, 428 );
	tag( "VOICE", 566, 351, 38, 8, 6 ); tag( "MIXER", 566, 359, 38, 8, 6 );
	ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
	ctx.beginPath();
	for(var i = 0; i <= 80; ++i) { var a = i / 80 * Math.PI * 4.5, rr = (3 + i * 0.22) * K; var px = X(585) + Math.cos(a) * rr, py = Y(397) + Math.sin(a) * rr; i ? ctx.lineTo( px, py ) : ctx.moveTo( px, py ); }
	ctx.stroke();
	drawEg( 1, 616, 348 );
	drawVco( 1, 778, 274 ); drawNoise( 1, 970, 274 );
	drawBottomRow();
	drawJoystick();
	drawController();
	drawDroneButtons();
	knob_scale_color = null;
	M = null; S = null; ST = null;
}

WR.registerSynth( "lunar", {
	title: "LUNAR 21",
	description: "LUNAR 21: ambient drone machine: 8 voices, dual effector, filters, sequencer",
	about: "An ambient drone machine: six drone voices, two VCOs on touch plates, aggressive resonant filters and a dual effector with cartridges. Ambient machine.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^dv\\d$", 3], ["^plate\\d+$", 3], ["^pad\\d$", 0], ["^(hold\\d|nhold\\d|kbhold|oct_dn|oct_up)$", 2], ["^(stages|link|kbmode|fx_edit)$", 0], ["", 1]],
	// a knob's sockets, lit when the mouse is over it (code.js: controlJacks)
	knob_jacks: [["^volt(\\d)$", function(m){ return ["v" + [1, 2, 6, 7][+m[1]] + "_cv"]; }], ["^pitch(\\d)$", function(m){ return ["v" + [3, 8][+m[1]] + "_fm"]; }], ["^fl_freq$|^fr_freq$", ["filt_cv"]], ["^fx_([xyz])$", function(m){ return ["fx_cv" + m[1]]; }], ["^shape(\\d)$", function(m){ return ["v" + (4 + +m[1]) + "_shape"]; }], ["^fm(\\d)$", function(m){ return ["v" + (4 + +m[1]) + "_fm"]; }], ["^tune(\\d)$", function(m){ return ["v" + (4 + +m[1]) + "_voct"]; }]],
	category: "Synths",
	worklet: "devices/lunar-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	audio_out: "out_l",
	audio_out_r: "out_r",
	midi_in: "midi_in",
	knob_skin: "flat",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function() { return SIZE; },
	draw: draw,
	rear_note: function( s ) { return "STEREO OUT · L: " + CARTRIDGES[ s.fx.ch[0].cart ][0] + " · R: " + CARTRIDGES[ s.fx.ch[1].cart ][0]; },
	transport: function( mod, action, value ) {
		if(action == "trigger") mod.post({ type: "plate", note: 0, on: !!value });
	}
});

})();
