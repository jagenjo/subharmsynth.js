// editor/custom.js
// CUSTOM SYNTH module: a synth built in the Synth Editor (editor/editor.js). Its settings are its
// design: the front panel (size, colour, knob style, the items placed on it), the back panel (its
// sockets: MAIN OUT, MIDI IN, audio ins and outs; and decoration) and the inside (the modules and the
// wires). The panels are drawn with the rack's widgets (knobs, faders, buttons, jacks, rear sockets),
// so MIDI learn, CV tracks and the computer keyboard work on it as on any device. Two types share this
// code: "custom" (full rack width) and "custom_half" (half). DSP in editor/custom-worklet.js.

(function(){

var CAT = WR_DSP.custom.CATALOG;
var HEIGHTS = [130, 260, 390, 520, 650];          // 1 to 5 units
var KNOB_R = { s: 14, m: 20, l: 28, xl: 40, h: 56 };
var COLORS = {
	dark:   { name: "Dark",   bg: "#1d1d1c", ink: "#e8e4dc", dim: "#8c8a84", section: "#262624", line: "#3a3936" },
	black:  { name: "Black",  bg: "#0f0f0f", ink: "#f2f2ee", dim: "#8a8a86", section: "#191919", line: "#2e2e2e" },
	grey:   { name: "Grey",   bg: "#45474b", ink: "#f0f0ec", dim: "#b4b5b2", section: "#3a3c40", line: "#5c5e62" },
	silver: { name: "Silver", bg: "#b8babd", ink: "#1b1c1e", dim: "#4d4f52", section: "#a6a8ab", line: "#8e9093" },
	cream:  { name: "Cream",  bg: "#e3d9c3", ink: "#1e1a14", dim: "#6a6150", section: "#d6cbb2", line: "#b8ac92" },
	navy:   { name: "Navy",   bg: "#1d2b40", ink: "#e9eef6", dim: "#93a3ba", section: "#24354f", line: "#3b5070" },
	red:    { name: "Red",    bg: "#5a1d1a", ink: "#f6e8e3", dim: "#c79a92", section: "#6a2420", line: "#86352f" },
	green:  { name: "Green",  bg: "#1f3a2c", ink: "#e6f2ea", dim: "#93b3a0", section: "#264636", line: "#3a5e4a" }
};
// the back: brushed metal, its print light
var BACK = { name: "Back", bg: "#2e2f33", ink: "#e8e4dc", dim: "#8c8a84", section: "#26272a", line: "#46474c" };
var LED_COLORS = { red: "#ff3b2f", green: "#6cdc5a", amber: "#ffb02f", blue: "#4fa3ff", white: "#f4f4f0" };
// colours for labels, lines and rectangles: the panel's print, or a fixed one
var PAINT = { ink: "Print", dim: "Print, dim", line: "Panel line", red: "#e2574c", orange: "#f0a43a", yellow: "#e8c547", green: "#6cc070",
	blue: "#4fa3e0", white: "#f2efe8", black: "#111111", cream: "#e3d9c3" };
function paint( name, col ) { return name == "dim" ? col.dim : (name == "line" ? col.line : (PAINT[ name ] && PAINT[ name ][0] == "#" ? PAINT[ name ] : col.ink)); }

var M = null, S = null, ST = null;
var held = {};    // module id -> { item id: held } (momentary buttons)

function defaultBack( name )
{
	return [
		{ id: "vents", kind: "vents", x: 60, y: 40, w: 300, h: 180 },
		{ id: "sticker", kind: "rect", x: 430, y: 85, w: 280, h: 90, color: "cream", fill: true, radius: 4 },
		{ id: "sticker_t", kind: "label", x: 570, y: 118, text: name || "MY SYNTH", size: 24, color: "black" },
		{ id: "sticker_s", kind: "label", x: 570, y: 150, text: "SYNTH EDITOR", size: 11, color: "black", bold: false },
		{ id: "main_l", kind: "mainl", x: 1250, y: 150 },
		{ id: "main_r", kind: "mainr", x: 1320, y: 150 },
		{ id: "rear_midi", kind: "midiin", x: 1430, y: 120 }
	];
}

// ---- the starter design: a mono synth, MIDI -> OSC -> FILTER -> VCA -> OUT, with an envelope ----
function defaults()
{
	var items = [
		{ id: "name", kind: "label", x: 150, y: 46, text: "MY SYNTH", size: 30 },
		{ id: "sec_f", kind: "section", x: 300, y: 24, w: 330, h: 212, title: "FILTER" },
		{ id: "sec_e", kind: "section", x: 660, y: 24, w: 560, h: 212, title: "ENVELOPE" },
		{ id: "k_wave", kind: "knob", x: 150, y: 160, size: "m", label: "TUNE" },
		{ id: "k_cut", kind: "knob", x: 390, y: 140, size: "l", label: "CUTOFF", value: 0.65 },
		{ id: "k_res", kind: "knob", x: 540, y: 140, size: "m", label: "RESONANCE" },
		{ id: "k_a", kind: "knob", x: 740, y: 140, size: "m", label: "ATTACK" },
		{ id: "k_d", kind: "knob", x: 860, y: 140, size: "m", label: "DECAY" },
		{ id: "k_s", kind: "knob", x: 980, y: 140, size: "m", label: "SUSTAIN" },
		{ id: "k_r", kind: "knob", x: 1100, y: 140, size: "m", label: "RELEASE" },
		{ id: "led_env", kind: "led", x: 940, y: 60, color: "red" },
		{ id: "j_env", kind: "jackout", x: 1300, y: 140, label: "ENV", slot: 1, mode: "cv" },
		{ id: "k_vol", kind: "knob", x: 1430, y: 140, size: "m", label: "VOLUME" }
	];
	var nodes = [
		{ id: "midi", kind: "midi", x: 0, y: 420 },
		{ id: "osc", kind: "osc", x: 280, y: 420 },
		{ id: "flt", kind: "filter", x: 600, y: 460 },
		{ id: "env", kind: "adsr", x: 1000, y: 440 },
		{ id: "vca", kind: "vca", x: 1380, y: 460 },
		{ id: "out", kind: "out", x: 1700, y: 460 }
	];
	var W = function(a, b, c, d) { return { from: [a, b], to: [c, d] }; };
	var wires = [
		W( "midi", "pitch", "osc", "pitch" ), W( "k_wave", "value", "osc", "fm" ), W( "osc", "saw", "flt", "in" ),
		W( "k_cut", "value", "flt", "cutoff" ), W( "k_res", "value", "flt", "res" ), W( "flt", "lp", "vca", "in" ),
		W( "midi", "gate", "env", "gate" ), W( "k_a", "value", "env", "a" ), W( "k_d", "value", "env", "d" ), W( "k_s", "value", "env", "s" ), W( "k_r", "value", "env", "r" ),
		W( "env", "env", "vca", "gain" ), W( "env", "env", "led_env", "in" ), W( "env", "env", "j_env", "in" ),
		W( "vca", "out", "out", "l" ), W( "k_vol", "value", "out", "vol" )
	];
	return { name: "MY SYNTH", height: 1, color: "dark", wood: false, knob_skin: "lm", items: items, back: defaultBack(), nodes: nodes, wires: wires, next: 1 };
}

function validate( s, raw )
{
	var num = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	// the arrays as saved (when there are), else the defaults
	var pick = function(k){ return raw && Array.isArray( raw[k] ) ? raw[k] : (Array.isArray( s[k] ) ? s[k] : null); };
	var ok = function(x){ return x && typeof x == "object" && typeof x.id == "string" && x.id.length < 40; };
	s.items = (pick( "items" ) || []).filter(function(i){ return ok( i ) && CAT.specOf( i.kind ); }).slice( 0, 200 );
	s.back = (pick( "back" ) || defaultBack( s.name )).filter(function(i){ return ok( i ) && CAT.specOf( i.kind ); }).slice( 0, 100 );
	// the back's own sockets are always there
	var dflt = defaultBack();
	["mainl", "mainr", "midiin"].forEach(function(k){ if(!s.back.some(function(i){ return i.kind == k; })) s.back.push( dflt.find(function(i){ return i.kind == k; }) ); });
	s.nodes = (pick( "nodes" ) || []).filter(function(n){ return ok( n ) && CAT.MODULES[ n.kind ]; }).slice( 0, 200 );
	if(!s.nodes.some(function(n){ return n.kind == "out"; })) s.nodes.push({ id: "out", kind: "out", x: 900, y: 300 });
	var ids = {};
	s.items.concat( s.back, s.nodes ).forEach(function(x){ ids[ x.id ] = x; });
	s.wires = (pick( "wires" ) || []).filter(function(w){
		return w && Array.isArray( w.from ) && Array.isArray( w.to ) && ids[ w.from[0] ] && ids[ w.to[0] ];
	}).slice( 0, 600 );
	s.height = Math.round( num( s.height, 0, HEIGHTS.length - 1, 1 ) );
	if(!COLORS[ s.color ]) s.color = "dark";
	s.name = String( s.name || "CUSTOM" ).substr( 0, 24 );
	s.next = Math.max( 1, s.next | 0 );
}

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }

// the area an item takes on its panel (the editor selects and moves by it)
function box( it )
{
	switch(it.kind)
	{
		case "knob": var r = KNOB_R[ it.size ] || 20; return { x: it.x - r - 16, y: it.y - r - 30, w: 2 * r + 32, h: 2 * r + 48 };
		case "slider": return { x: it.x - 22, y: it.y - 30, w: 44, h: (it.h || 120) + 48 };
		case "button": case "toggle": var w = it.w || 70, h = it.h || 26; return { x: it.x - w / 2, y: it.y - h / 2, w: w, h: h };
		case "led": return { x: it.x - 9, y: it.y - 9, w: 18, h: 18 };
		case "jackin": case "jackout": return { x: it.x - 20, y: it.y - 34, w: 40, h: 54 };
		case "ain": case "aout": case "mainl": case "mainr": return { x: it.x - 22, y: it.y - 36, w: 44, h: 56 };
		case "midiin": return { x: it.x - 26, y: it.y - 36, w: 52, h: 96 };
		case "label":
			var fs = it.size || 14, tw = String( it.text || "" ).length * fs * 0.55 + 8;
			return { x: it.x - tw / 2, y: it.y - fs * 0.7, w: tw, h: fs * 1.4 };
		case "section": case "rect": case "vents": return { x: it.x, y: it.y, w: it.w || 200, h: it.h || 120 };
		case "line":
			var x0 = Math.min( it.x, it.x2 ), y0 = Math.min( it.y, it.y2 );
			return { x: x0 - 6, y: y0 - 6, w: Math.abs( it.x2 - it.x ) + 12, h: Math.abs( it.y2 - it.y ) + 12 };
		default: return { x: it.x - 8, y: it.y - 8, w: 16, h: 16 };
	}
}

function knobRange( it ) { return CAT.controlRange( S, it ); }

// ---- the items (front and back) ----
function drawItem( it, col )
{
	var full = id_prefix + it.id;
	switch(it.kind)
	{
		case "section":
			ctx.fillStyle = col.section;
			ctx.beginPath(); ctx.roundRect( it.x, it.y, it.w || 200, it.h || 120, 6 ); ctx.fill();
			ctx.strokeStyle = col.line; ctx.lineWidth = 1; ctx.stroke();
			if(it.title)
			{
				ctx.font = "bold 12px " + FONT; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = col.dim;
				ctx.fillText( it.title, it.x + 12, it.y + 14 );
			}
			break;
		case "rect":
			ctx.beginPath(); ctx.roundRect( it.x, it.y, it.w || 200, it.h || 120, it.radius || 0 );
			if(it.fill) { ctx.fillStyle = paint( it.color, col ); ctx.fill(); }
			else { ctx.strokeStyle = paint( it.color, col ); ctx.lineWidth = it.width || 2; ctx.stroke(); }
			break;
		case "line":
			ctx.strokeStyle = paint( it.color, col ); ctx.lineWidth = it.width || 2; ctx.lineCap = "round";
			ctx.beginPath(); ctx.moveTo( it.x, it.y ); ctx.lineTo( it.x2, it.y2 ); ctx.stroke();
			ctx.lineCap = "butt";
			break;
		case "vents":
			var vw = it.w || 200, vh = it.h || 120, rows = Math.max( 1, Math.floor( vh / 16 ) ), cols = Math.max( 1, Math.floor( vw / 26 ) );
			ctx.fillStyle = "#121214";
			for(var r = 0; r < rows; ++r)
				for(var c = 0; c < cols; ++c) { ctx.beginPath(); ctx.roundRect( it.x + c * 26, it.y + r * 16, 20, 7, 3.5 ); ctx.fill(); }
			break;
		case "label":
			ctx.font = (it.bold === false ? "" : "bold ") + (it.size || 14) + "px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
			ctx.fillStyle = it.color ? paint( it.color, col ) : (it.dim ? col.dim : col.ink);
			ctx.fillText( it.text || "", it.x, it.y );
			break;
		case "screw": drawScrew( it.x, it.y ); break;
		case "knob":
			// its own scale: where it starts and ends (degrees from 12 o'clock), its lines, continuous or in steps
			var r = knobRange( it ), dn = CAT.toN( r, r.def ), n0 = it.value === undefined ? dn : it.value;
			var steps = it.steps > 1 ? Math.round( it.steps ) : 0, keepA = [ KNOB_A0, KNOB_SWEEP ];
			var a0 = it.start === undefined ? -135 : +it.start, a1 = it.end === undefined ? 135 : +it.end;
			if(a1 <= a0) a1 = a0 + 10;
			KNOB_A0 = (a0 - 90) * Math.PI / 180; KNOB_SWEEP = (a1 - a0) * Math.PI / 180;
			if(steps) dn = Math.round( dn * (steps - 1) ) / (steps - 1);
			try {
				var v = knob( it.id, it.x, it.y, KNOB_R[ it.size ] || 20, n0, 0, 1, { label: it.label, def: dn, style: "small", labelSize: it.size == "h" || it.size == "xl" ? 13 : 11,
					bipolar: r.min < 0 && r.max > 0, ticks: it.ticks > 1 ? Math.round( it.ticks ) : undefined, noScale: it.ticks === 0, step: steps ? 1 / (steps - 1) : undefined,
					format: function(n){ return (it.label ? it.label + " " : "") + CAT.fmt( r, CAT.fromN( r, n ) ); } } );
			}
			finally { KNOB_A0 = keepA[0]; KNOB_SWEEP = keepA[1]; }
			if(v !== n0) it.value = v;
			break;
		case "slider":
			var r2 = knobRange( it ), dn2 = CAT.toN( r2, r2.def ), m0 = it.value === undefined ? dn2 : it.value;
			if(it.label) drawLabel( it.label, it.x, it.y - 20, 11, false, col.ink );
			var v2 = fader( it.id, it.x, it.y, it.h || 120, m0, { def: dn2 } );
			if(v2 !== m0) it.value = v2;
			if(ui.active === full || ui.hot === full) tip( (it.label ? it.label + " " : "") + CAT.fmt( r2, CAT.fromN( r2, v2 ) ), it.x, it.y + (it.h || 120) + 22 );
			break;
		case "button":
			var hb = held[ M.id ] = held[ M.id ] || {};
			var b = button( it.id, it.x - (it.w || 70) / 2, it.y - (it.h || 26) / 2, it.w || 70, it.h || 26, it.label || "", !!hb[ it.id ] );
			if(b.held != !!hb[ it.id ]) { hb[ it.id ] = b.held; send({ type: "btn", id: it.id, on: b.held }); }
			break;
		case "toggle":
			if(button( it.id, it.x - (it.w || 70) / 2, it.y - (it.h || 26) / 2, it.w || 70, it.h || 26, it.label || "", !!it.on ).clicked) it.on = !it.on;
			break;
		case "led":
			var lv = ST && ST.leds ? ST.leds[ it.id ] || 0 : 0, c = LED_COLORS[ it.color ] || LED_COLORS.red;
			ctx.fillStyle = "#050505"; ctx.beginPath(); ctx.arc( it.x, it.y, 7, 0, Math.PI * 2 ); ctx.fill();
			ctx.fillStyle = c; ctx.globalAlpha = 0.18 + 0.82 * lv; ctx.beginPath(); ctx.arc( it.x, it.y, 5.5, 0, Math.PI * 2 ); ctx.fill();
			if(lv > 0.05) { ctx.globalAlpha = lv * 0.5; ctx.beginPath(); ctx.arc( it.x, it.y, 14, 0, Math.PI * 2 ); ctx.fill(); }
			ctx.globalAlpha = 1;
			if(it.label) drawLabel( it.label, it.x, it.y - 16, 10, false, col.ink );
			break;
		case "jackin": case "jackout":
			drawJack( (it.kind == "jackin" ? "in" : "out") + (it.slot || 1), it.x, it.y, it.label || (it.kind == "jackin" ? "IN" : "OUT"), it.kind == "jackin" ? "in" : "out" );
			break;
		// the back's sockets: the rack's rear sockets
		case "ain": case "aout":
			drawRearSocket( WR.jackId( M.id, it.kind + (it.slot || 1) ), it.x, it.y, it.label || ((it.kind == "ain" ? "AUDIO IN " : "AUDIO OUT ") + (it.slot || 1)), it.kind, M.def.title );
			break;
		case "mainl": case "mainr":
			drawRearSocket( WR.jackId( M.id, it.kind == "mainl" ? "audio_l" : "audio_r" ), it.x, it.y, it.label || (it.kind == "mainl" ? "AUDIO L" : "AUDIO R"), "aout", M.def.title );
			break;
		case "midiin":
			var mid = WR.jackId( M.id, "midi_in" );
			drawRearSocket( mid, it.x, it.y, "MIDI IN", "midiin", M.def.title );
			if(!M.editing) midiInSwitches( M.id, mid, it.x, it.y );
			break;
	}
}

function drawItems( list, col )
{
	var keep = [ TEXT_COLOR, DIM_COLOR, knob_scale_color ];
	TEXT_COLOR = col.ink; DIM_COLOR = col.dim; knob_scale_color = col.ink;
	// the areas first (sections, filled rectangles, vents), then the rest in order
	var under = function(it){ return it.kind == "section" || it.kind == "vents" || (it.kind == "rect" && it.fill); };
	list.filter( under ).concat( list.filter(function(it){ return !under( it ); }) ).forEach(function(it){ drawItem( it, col ); });
	TEXT_COLOR = keep[0]; DIM_COLOR = keep[1]; knob_scale_color = keep[2];
}

function draw( mod )
{
	M = mod; S = mod.settings; ST = mod.state || {};
	var size = M.def.size( layout, S ), w = size[0], h = size[1], col = COLORS[ S.color ] || COLORS.dark;
	casing_wood = !!S.wood;
	drawCasing( 0, 0, w, h );
	ctx.fillStyle = col.bg;
	ctx.fillRect( 23, 0, w - 46, h );
	drawItems( S.items, col );
	// EDIT, on the left ear
	if(!PREVIEW_MODE && !M.editing)
	{
		var ex = 11, ey = h / 2, full = id_prefix + "edit";
		var hov = !cable_drag && (ui.active === null || ui.active === full) && hitCircle( ex, ey, 9 );
		if(hov) { ui.hot = full; tip( "SYNTH EDITOR: CHANGE THIS SYNTH", ex + 60, ey ); }
		if(hov && ui.pressed && ui.active === null) { ui.active = full; if(window.SynthEditor) SynthEditor.open( M.id ); }
		ctx.fillStyle = hov ? "#e2574c" : "#3a3936"; ctx.beginPath(); ctx.arc( ex, ey, 8, 0, Math.PI * 2 ); ctx.fill();
		ctx.font = "bold 10px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.fillText( "✎", ex, ey + 1 );
	}
	M = null; S = null; ST = null;
}

// the back (Tab): the metal plate and the back's items
function drawRear( mod, w, h )
{
	M = mod; S = mod.settings; ST = mod.state || {};
	casing_wood = !!S.wood;
	drawCasing( 0, 0, w, h );
	var g = ctx.createLinearGradient( 0, 0, 0, h );
	g.addColorStop( 0, "#37383c" ); g.addColorStop( 1, "#222326" );
	ctx.fillStyle = g;
	ctx.fillRect( 22, 2, w - 44, h - 4 );
	ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
	ctx.strokeRect( 26.5, 6.5, w - 53, h - 13 );
	drawItems( S.back || [], BACK );
	casing_wood = false;
	M = null; S = null; ST = null;
}

// one item alone, for the editor's palette (the rack's globals are made inert by the caller)
function drawPreview( mod, it, back, st )
{
	M = mod; S = mod.settings; ST = st || { leds: {} };
	if(!st) ST.leds[ it.id ] = 1; // an LED lit, to be seen (unless the state is given: live)
	drawItems([ it ], back ? BACK : (COLORS[ S.color ] || COLORS.dark) );
	M = null; S = null; ST = null;
}

// the generic sockets: the panels show the ones placed on them
var JACKS = [[]];
for(var i = 1; i <= CAT.SLOTS; ++i) JACKS[0].push([ "IN " + i, "in", "in" + i ], [ "OUT " + i, "out", "out" + i ]);
var REAR = [["AUDIO L", "aout", "audio_l"], ["AUDIO R", "aout", "audio_r"]];
for(var i = 1; i <= CAT.ASLOTS; ++i) REAR.push([ "AUDIO IN " + i, "ain", "ain" + i ], [ "AUDIO OUT " + i, "aout", "aout" + i ]);

function jacksOf( s )
{
	return [ (s.items || []).filter(function(i){ return i.kind == "jackin" || i.kind == "jackout"; }).map(function(i){
		return [ i.label || i.kind, i.kind == "jackin" ? "in" : "out", (i.kind == "jackin" ? "in" : "out") + (i.slot || 1) ];
	}) ];
}
function rearJacksOf( s )
{
	var out = [];
	(s.back || []).forEach(function(i){
		if(i.kind == "mainl") out.push([ i.label || "AUDIO L", "aout", "audio_l" ]);
		else if(i.kind == "mainr") out.push([ i.label || "AUDIO R", "aout", "audio_r" ]);
		else if(i.kind == "ain" || i.kind == "aout") out.push([ i.label || i.kind, i.kind, i.kind + (i.slot || 1) ]);
		else if(i.kind == "midiin") out.push([ "MIDI IN", "midiin", "midi_in" ]);
	});
	return out;
}

function register( type, half )
{
	WR.registerSynth( type, {
		title: "CUSTOM SYNTH",
		description: "CUSTOM SYNTH: your own synth, built in the Synth Editor",
		about: "Design a panel (knobs, sliders, buttons, LEDs, jacks) and wire modules behind it: oscillators, filters, envelopes, LFOs, sequencers, effects.",
		category: "Custom",
		hidden: half,          // one card in ADD DEVICE; the editor switches the width
		half: half,
		knob_skin: "lm",
		worklet: "editor/custom-worklet.js",
		jacks: JACKS,
		jacksOf: jacksOf,
		rear_jacks: REAR,
		rearJacksOf: rearJacksOf,
		audio_out: "audio_l",
		audio_out_r: "audio_r",
		midi_in: "midi_in",
		key_prio: [["", 1]],
		defaults: defaults,
		validate: validate,
		size: function( layout, s ) {
			var w = half ? (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5 : LAYOUTS[ layout ].w;
			return [ w, HEIGHTS[ s ? s.height : 1 ] || HEIGHTS[1] ];
		},
		draw: draw,
		drawRear: drawRear,
		onAdd: function( m ) { if(window.SynthEditor && !PREVIEW_MODE) SynthEditor.open( m.id ); },
		rear_note: function( s ) { return (s.name || "CUSTOM") + " · " + s.nodes.length + " MODULES · " + s.wires.length + " WIRES"; },
		transport: function( mod, action, value ) { if(action == "trigger") mod.post({ type: "trigger", gate: value }); }
	});
}
register( "custom", false );
register( "custom_half", true );

WR.CustomSynth = { CAT: CAT, HEIGHTS: HEIGHTS, KNOB_R: KNOB_R, COLORS: COLORS, BACK: BACK, LED_COLORS: LED_COLORS, PAINT: PAINT,
	box: box, defaults: defaults, defaultBack: defaultBack, draw: draw, drawRear: drawRear, drawPreview: drawPreview };

})();
