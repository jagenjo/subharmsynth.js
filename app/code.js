// code.js
// Rack UI: canvas drawing, immediate mode widgets (knobs, buttons, switches, LEDs), patch
// cables, the shared devices (keys, LFO, compressor, reverb, delay), toolbar and keyboard
// shortcuts. Each synth draws its own panel (synths/*.js) with these widgets; the rack
// controller is webrack.js and the DSP runs in rack-worklet.js + synths/*-worklet.js.

var canvas = document.getElementById("panel");
var ctx = canvas.getContext("2d");
var FONT = "Antonio, Oswald, 'Arial Narrow', sans-serif";
// two panel layouts: "hardware" is the full front panels, "classic" is the first compact
// layout of the Subharm. The rack is as wide as the Subharm's panel; other synths are scaled to fit
var LAYOUTS = {
	hardware: { w: 1568, name: "Hardware" },
	classic: { w: 1460, name: "Classic" }
};
var layout = "hardware";
try { if(LAYOUTS[ localStorage.getItem("SUBHARM_layout") ]) layout = localStorage.getItem("SUBHARM_layout"); } catch(err) {}
var PANEL_W, PANEL_H; // set by setLayout() / updatePanelHeight(): the whole rack
var KNOB_A0 = Math.PI * 0.75, KNOB_SWEEP = Math.PI * 1.5;
var CABLE_COLORS = ["#e8c547","#e05a47","#4fa3e0","#6cc070","#c77dd8","#ececec","#f08c3a"];
var TEXT_COLOR = "#e8e4dc", DIM_COLOR = "#8c8a84";

var rack = new WR.Context();

// the rack's scale is the window width times the zoom (toolbar - / +), so by default it fills the
// width and more devices make it scroll. sx / sy: scroll in screen pixels, with scrollbars
// on the right and the bottom when the rack is taller / wider than the window
var view = { scale: 1, zoom: 1, ox: 0, oy: 0, dpr: 1, sx: 0, sy: 0, max_sx: 0, max_sy: 0, drag: null };
var SCROLLBAR_W = 12;
var ZOOM_MIN = 0.4, ZOOM_MAX = 3, ZOOM_STEP = 1.15;
try { view.zoom = clamp( parseFloat( localStorage.getItem("SUBHARM_zoom") ) || 1, ZOOM_MIN, ZOOM_MAX ); } catch(err) {}
// pointer state. px / py are in rack coordinates, x / y in the coordinates of the row being drawn
var ui = {
	px: -1, py: -1,
	x: -1, y: -1, down: false, pressed: false, released: false, rpressed: false, dbl: false,
	shift: false, wheel: 0, wheel_x: 0, active: null, hot: null,
	startY: 0, startN: 0, dragShift: false, lastDownTime: 0, lastDownPos: [0,0]
};
var tooltips = [];
var jacks = {};          // jack id -> { x, y, type, label }, in rack coordinates
var cable_drag = null;   // { from: jack id, type: "out"|"in", color }
var next_color = 0;
var show_wires = true;
try { show_wires = localStorage.getItem("SUBHARM_wires") != "hidden"; } catch(err) {}
// Options: the mouse wheel turns the knob (or fader) under the cursor; off, it always scrolls the rack
var wheel_knobs = true;
try { wheel_knobs = localStorage.getItem("SUBHARM_wheel") != "scroll"; } catch(err) {}

// every row (the keys, each synth, the device rows) is drawn in its own coordinates: a frame
// is its offset and scale in the rack. Jacks and tooltips are stored in rack coordinates
var frame = { ox: 0, oy: 0, k: 1 };
// widget and jack ids get the id of the module being drawn in front ("dram2." + "cutoff")
var id_prefix = "";
// index.html?preview=<type>: draw only that device (tools/make-previews.sh takes the pictures)
var PREVIEW_TYPE = (function(){ var m = /[?&]preview=([a-z0-9_]+)/.exec( typeof location != "undefined" ? location.search : "" ); return m && WR.types[ m[1] ] ? m[1] : null; })();
window.PREVIEW_MODE = !!PREVIEW_TYPE;
// knob style of the device being drawn (its settings.knob_skin, else its type's, else the layout's)
var knob_skin = null;
var KNOB_SKIN_NAMES = { "": "DEVICE DEFAULT", aluminium: "ALUMINIUM CAP", classic: "CLASSIC", lm: "BLACK SKIRT", chrome: "CHROME", cream: "CREAM", soft: "SOFT TOUCH", ledring: "LED RING", greycap: "GREY CAP", flat: "FLAT" };
// the cap colour for the FLAT knobs (a panel with coloured knobs sets it per knob)
var knob_tint = null;
// the colour of the knobs' printed scale (a light panel sets it dark while it draws)
var knob_scale_color = null;

function beginFrame( ox, oy, k )
{
	frame = { ox: ox, oy: oy, k: k || 1 };
	ctx.save();
	ctx.translate( ox, oy );
	ctx.scale( frame.k, frame.k );
	ui.x = (ui.px - ox) / frame.k;
	ui.y = (ui.py - oy) / frame.k;
}

function endFrame()
{
	ctx.restore();
	frame = { ox: 0, oy: 0, k: 1 };
	ui.x = ui.px;
	ui.y = ui.py;
}

function rackX( x ) { return frame.ox + x * frame.k; }
function rackY( y ) { return frame.oy + y * frame.k; }

// ---------------------------------------------------------------------------
// KEYBOARD CONTROL: the device in the middle of the screen gets its buttons (not its knobs) on the
// computer keyboard. Each button has a priority (the device's key_prio table: 3 played / triggered,
// 2 often, 1 sometimes, 0 never: no key); the most used pick first, each taking the free key nearest
// to where the button is on the device, so the keyboard is a map of the panel. What does not fit goes
// to the next bank (` switches). Holding SHIFT shows the keys on the buttons. Every button widget calls
// keyButton(): it registers the button and gets the key's press (a click) and hold (held down)

// the keys by row, with their offsets on a staggered keyboard (in key widths)
var KEY_ROWS = [
	[0, ["Digit1","Digit2","Digit3","Digit4","Digit5","Digit6","Digit7","Digit8","Digit9","Digit0","Minus","Equal"]],
	[0.5, ["KeyQ","KeyW","KeyE","KeyR","KeyT","KeyY","KeyU","KeyI","KeyO","KeyP","BracketLeft","BracketRight"]],
	[0.75, ["KeyA","KeyS","KeyD","KeyF","KeyG","KeyH","KeyJ","KeyK","KeyL","Semicolon","Quote","Backslash"]],
	[1.25, ["KeyZ","KeyX","KeyC","KeyV","KeyB","KeyN","KeyM","Comma","Period","Slash"]]
];
var KEY_CODES = [], KEY_POS = {};
KEY_ROWS.forEach(function(row, r){ row[1].forEach(function(code, c){ KEY_CODES.push( code ); KEY_POS[ code ] = [ row[0] + c, r ]; }); });
// a button's priority: the device's key_prio [[regex, priority], ...] (first match), else 1
var KEY_PRIO_DEVICES = { keys: [["^kb_qwerty$", 2], ["^kb_oct", 2]], io: [["", 0]] };
function keyPriority( device, id )
{
	var m = rack.settings.modules.find(function(m){ return m.id == device; });
	var def = m ? WR.types[ m.type ] : null;
	var table = (def && def.key_prio) || KEY_PRIO_DEVICES[ device ] || [];
	var local = id.indexOf( device + "." ) == 0 ? id.substr( device.length + 1 ) : id;
	for(var i = 0; i < table.length; ++i)
		if(new RegExp( table[i][0] ).test( local ))
			return table[i][1];
	return 1;
}
// the keys for the buttons drawn: { map: [bank] -> code -> id, keyOf: id -> { bank, code } }
function keyAssign( device, buttons )
{
	var list = buttons.map(function(b){ return { id: b.id, cx: b.x + b.w / 2, cy: b.y + b.h / 2, prio: keyPriority( device, b.id ) }; })
		.filter(function(b){ return b.prio > 0; });
	var map = [], keyOf = {};
	if(!list.length)
		return { map: map, keyOf: keyOf };
	// the buttons' positions over the keyboard (12 keys by 4 rows), from their bounding box on the panel
	var xs = list.map(function(b){ return b.cx; }), ys = list.map(function(b){ return b.cy; });
	var x0 = Math.min.apply( null, xs ), x1 = Math.max.apply( null, xs ), y0 = Math.min.apply( null, ys ), y1 = Math.max.apply( null, ys );
	list.forEach(function(b){
		b.kx = x1 > x0 ? (b.cx - x0) / (x1 - x0) * 11.5 : 5.5;
		b.ky = y1 > y0 ? (b.cy - y0) / (y1 - y0) * 3 : 1.5;
	});
	var left = list.slice(), bank = 0;
	while(left.length && bank < 8)
	{
		var free = {};
		KEY_CODES.forEach(function(c){ free[c] = true; });
		map[bank] = {};
		// the most used first; within a priority, the closest button / key pairs first
		[3, 2, 1].forEach(function(prio){
			var group = left.filter(function(b){ return b.prio == prio; }), pairs = [];
			group.forEach(function(b){
				KEY_CODES.forEach(function(c){
					var dx = KEY_POS[c][0] - b.kx, dy = (KEY_POS[c][1] - b.ky) * 1.8;
					pairs.push([ dx * dx + dy * dy, b, c ]);
				});
			});
			pairs.sort(function(a, b){ return a[0] - b[0]; });
			pairs.forEach(function(p){
				if(!free[ p[2] ] || keyOf[ p[1].id ]) return;
				free[ p[2] ] = false;
				keyOf[ p[1].id ] = { bank: bank, code: p[2] };
				map[bank][ p[2] ] = p[1].id;
			});
		});
		left = left.filter(function(b){ return !keyOf[ b.id ]; });
		bank++;
	}
	return { map: map, keyOf: keyOf };
}
var KEY_LABELS = { Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backslash: "\\" };
function keyLabel( code ) { return KEY_LABELS[ code ] || code.replace( /^(Key|Digit)/, "" ); }
var keyctl = {
	target: null,      // the device the keys go to (a module id, "io" or "keys")
	device: null,      // the device being drawn now
	list: [],          // the target's buttons drawn this frame: { id, x, y, w, h } (rack coordinates)
	ids: [],           // ... the last complete frame's ids
	map: [],           // [bank] -> key code -> button id
	keyOf: {},         // button id -> { bank, code }
	sig: "",           // the buttons the keys were assigned for
	pressed: {},       // button id -> pressed (a click this frame)
	held: {},          // button id -> its key is down
	down: {},          // key code -> the button id it pressed
	flash: {},         // button id -> time of the last key press (a highlight)
	bank: 0,
	overlay: false,    // SHIFT held: show the keys
	rects: []          // the devices' rectangles this frame: the target is the one in the middle
};
// usage statistics (analytics.js); nothing when it is not configured or not there
var gfTrack = window.gfTrack || function(){};

var NOKEY = { pressed: false, held: false };

// ---------------------------------------------------------------------------
// MIDI LEARN: a CC or a note mapped to a knob, fader or button (rack.settings.midi_map: [kind,
// channel, number, control id]). Options > MIDI learn: click a control, then move a controller or
// press a key / pad. Knobs and faders take the CC over their range; buttons are pressed by a CC over
// 63 or a note, and held while it lasts
var midictl = {
	learn: false, target: null,
	kind: {},          // control id -> "knob" / "fader" / "button" (seen while drawing)
	pending: {},       // knob / fader id -> 0..1 from MIDI, taken by the widget
	pressed: {}, held: {}, ccHigh: {},
	drawn: []          // in learn mode: the controls drawn this frame { id, kind, x, y, w, h } (rack coordinates)
};
function midiNote( id, x, y, w, h, kind )
{
	midictl.kind[ id ] = kind;
	if(midictl.learn && !show_rear)
		midictl.drawn.push({ id: id, kind: kind, x: rackX( x ), y: rackY( y ), w: w * frame.k, h: h * frame.k });
}
function controlName( id )
{
	var dot = id.indexOf( "." ), dev = id.substr( 0, dot ), m = rack.settings.modules.find(function(o){ return o.id == dev; });
	return ((m && WR.types[ m.type ] ? WR.types[ m.type ].title : dev) + " " + id.substr( dot + 1 ).replace( /_/g, " " )).toUpperCase();
}
function mapLabel( m ) { return (m[0] == "cc" ? "CC" : "NOTE ") + m[2] + (m[1] != 1 ? " CH" + m[1] : ""); }
WR.midiControl = function( cmd, ch, num, val )
{
	var kind = cmd == 0xB0 ? "cc" : "note", on = cmd == 0x90 && val > 0;
	var map = rack.settings.midi_map = rack.settings.midi_map || [];
	if(midictl.learn && midictl.target && (kind == "cc" || on))
	{
		var t = midictl.target;
		rack.settings.midi_map = map.filter(function(m){ return m[3] != t && !(m[0] == kind && m[1] == ch && m[2] == num); });
		rack.settings.midi_map.push([ kind, ch, num, t ]);
		setStatus( "MIDI learn: " + mapLabel([ kind, ch, num ]) + " \u2192 " + controlName( t ), true );
		midictl.target = null;
		renderMidiMap();
		return true;
	}
	var m = map.find(function(e){ return e[0] == kind && e[1] == ch && e[2] == num; });
	if(!m)
		return false;
	var id = m[3], k = midictl.kind[ id ];
	if(k == "knob" || k == "fader")
	{
		if(kind == "cc" || on) midictl.pending[ id ] = val / 127;
	}
	else
	{
		var key = kind + ch + "_" + num, down = kind == "cc" ? val >= 64 : on;
		if(down && !midictl.ccHigh[ key ]) { midictl.pressed[ id ] = true; midictl.held[ id ] = true; }
		if(!down) delete midictl.held[ id ];
		midictl.ccHigh[ key ] = down;
	}
	act(function(){});
	return true;
};
// learn mode: every control outlined, the mapped ones labelled, the one waiting for MIDI pulsing
function drawMidiLearn()
{
	if(!midictl.learn)
		return;
	var map = rack.settings.midi_map || [], t = (performance.now() % 800) / 800;
	ctx.font = "bold 11px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
	midictl.drawn.forEach(function(c){
		var m = map.find(function(e){ return e[3] == c.id; }), sel = midictl.target == c.id;
		ctx.strokeStyle = sel ? "rgba(255,214,90," + (0.5 + 0.5 * Math.sin( t * Math.PI * 2 )) + ")" : (m ? "#5ad1ff" : "rgba(90,209,255,0.35)");
		ctx.lineWidth = sel ? 3 : 1.5;
		ctx.beginPath();
		if(c.kind == "knob") ctx.arc( c.x, c.y, c.w + 4, 0, Math.PI * 2 ); else ctx.rect( c.x - 2, c.y - 2, c.w + 4, c.h + 4 );
		ctx.stroke();
		if(m)
		{
			var label = mapLabel( m ), lx = c.kind == "knob" ? c.x : c.x + c.w / 2, ly = c.kind == "knob" ? c.y - c.w - 10 : c.y - 8, tw = ctx.measureText( label ).width + 8;
			ctx.fillStyle = "#5ad1ff"; ctx.beginPath(); ctx.roundRect( lx - tw / 2, ly - 7, tw, 14, 3 ); ctx.fill();
			ctx.fillStyle = "#06222c"; ctx.fillText( label, lx, ly + 1 );
		}
	});
	midictl.drawn = [];
}
function setMidiLearn( on )
{
	midictl.learn = on; midictl.target = null;
	$("opt-midilearn").classList.toggle( "on", on );
	$("opt-midilearn").textContent = on ? "MIDI learn: ON" : "MIDI learn";
	setStatus( on ? "MIDI learn: click a knob, fader or button, then move a controller (or press a key / pad)" : "MIDI learn off", on );
}
function renderMidiMap()
{
	var el = $("opt-midimap");
	if(!el) return;
	var map = rack.settings.midi_map || [];
	el.innerHTML = map.length ? map.map(function(m, i){ return '<div class="mm"><span>' + mapLabel( m ) + '</span><span>\u2192 ' + controlName( m[3] ) + '</span><button data-i="' + i + '" title="Remove">\u00d7</button></div>'; }).join("") +
		'<button data-i="all">Clear all</button>' : '<div class="mm none">No MIDI mappings</div>';
}
function keyButton( full, x, y, w, h )
{
	midiNote( full, x, y, w, h, "button" );
	var mp = !!midictl.pressed[ full ], mh = !!midictl.held[ full ];
	delete midictl.pressed[ full ];
	if(keyctl.device === null || keyctl.device !== keyctl.target || show_rear)
		return mp || mh ? { pressed: mp, held: mh } : NOKEY;
	keyctl.list.push({ id: full, x: rackX( x ), y: rackY( y ), w: w * frame.k, h: h * frame.k });
	var pressed = !!keyctl.pressed[ full ];
	delete keyctl.pressed[ full ];
	return { pressed: pressed || mp, held: !!keyctl.held[ full ] || mh };
}
// a device starts / ends drawing (its rectangle in rack coordinates: the target is chosen from them)
function keyDeviceBegin( id, x, y, w, h ) { keyctl.device = id; keyctl.rects.push({ id: id, x: x, y: y, w: w, h: h }); }
function keyDeviceEnd() { keyctl.device = null; }
// after a frame: the buttons it drew are the keys' targets; the device in the middle is next
function keyFrameEnd( cx, cy )
{
	keyctl.ids = keyctl.list.map(function(b){ return b.id; });
	keyctl.drawn = keyctl.list;
	// the keys again only when the target or its buttons change: they stay where they are
	var sig = keyctl.target + ":" + keyctl.ids.join( "," );
	if(sig != keyctl.sig)
	{
		var a = keyAssign( keyctl.target, keyctl.list );
		keyctl.map = a.map; keyctl.keyOf = a.keyOf; keyctl.sig = sig;
	}
	keyctl.list = [];
	keyctl.pressed = {};
	var best = null, bd = Infinity;
	keyctl.rects.forEach(function(r){
		var dx = cx < r.x ? r.x - cx : (cx > r.x + r.w ? cx - r.x - r.w : 0);
		var dy = cy < r.y ? r.y - cy : (cy > r.y + r.h ? cy - r.y - r.h : 0);
		var d = dx * 0.25 + dy; // the row first, then the side
		if(d < bd) { bd = d; best = r; }
	});
	var t = best ? best.id : null;
	if(t !== keyctl.target) { keyReleaseAll(); keyctl.bank = 0; }
	keyctl.target = t;
	keyctl.targetRect = best;
	keyctl.rects = [];
}
function keyReleaseAll() { keyctl.held = {}; keyctl.down = {}; }
// a key: press the button it is mapped to; true when it was taken
function keyDown( code )
{
	var banks = Math.max( 1, keyctl.map.length );
	if(code == "Backquote")
	{
		if(banks > 1) { keyctl.bank = (keyctl.bank + 1) % banks; setStatus( "Keys: bank " + (keyctl.bank + 1) + " of " + banks + " (hold SHIFT to see them)" ); }
		return banks > 1;
	}
	if(KEY_CODES.indexOf( code ) < 0)
		return false;
	var id = (keyctl.map[ keyctl.bank ] || {})[ code ];
	if(!id)
		return true; // no button on that key: still ours, not the browser's
	keyctl.pressed[ id ] = true;
	keyctl.held[ id ] = true;
	keyctl.down[ code ] = id;
	keyctl.flash[ id ] = performance.now();
	return true;
}
function keyUp( code )
{
	var id = keyctl.down[ code ];
	if(id === undefined)
		return false;
	delete keyctl.down[ code ];
	delete keyctl.held[ id ];
	return true;
}
// SHIFT: the keys over the buttons, the target outlined (rack coordinates, the rack's transform)
function drawKeyOverlay()
{
	var now = performance.now(), r = keyctl.targetRect;
	(keyctl.drawn || []).forEach(function(b, i){
		var f = keyctl.flash[ b.id ];
		if(f && now - f < 180)
		{
			ctx.strokeStyle = "rgba(255,214,90," + (1 - (now - f) / 180) + ")"; ctx.lineWidth = 3;
			ctx.strokeRect( b.x - 2, b.y - 2, b.w + 4, b.h + 4 );
		}
	});
	if(r && !show_rear) // the device the keys go to: a thin line on its left
	{
		ctx.fillStyle = keyctl.overlay ? "#ffd65a" : "rgba(255,214,90,0.75)";
		ctx.fillRect( r.x > 6 ? r.x - 5 : r.x + 1, r.y + 4, 3, r.h - 8 );
	}
	if(!keyctl.overlay || !r || show_rear)
		return;
	ctx.strokeStyle = "#ffd65a"; ctx.lineWidth = 3;
	ctx.setLineDash && ctx.setLineDash([ 10, 6 ]);
	ctx.strokeRect( r.x + 2, r.y + 2, r.w - 4, r.h - 4 );
	ctx.setLineDash && ctx.setLineDash([]);
	var banks = Math.max( 1, keyctl.map.length ), mapped = 0;
	ctx.font = "bold 13px " + FONT;
	ctx.textBaseline = "middle"; ctx.textAlign = "center";
	(keyctl.drawn || []).forEach(function(b){
		var k = keyctl.keyOf[ b.id ];
		if(!k) return;
		mapped++;
		if(k.bank != keyctl.bank)
			return;
		var label = keyLabel( k.code ), cx = b.x + b.w / 2, cy = b.y + b.h / 2, w = Math.max( 18, ctx.measureText( label ).width + 8 );
		ctx.fillStyle = keyctl.held[ b.id ] ? "#ffd65a" : "rgba(10,10,10,0.88)";
		ctx.beginPath(); ctx.roundRect( cx - w / 2, cy - 10, w, 20, 4 ); ctx.fill();
		ctx.strokeStyle = "#ffd65a"; ctx.lineWidth = 1.5; ctx.stroke();
		ctx.fillStyle = keyctl.held[ b.id ] ? "#111" : "#ffd65a";
		ctx.fillText( label, cx, cy + 1 );
	});
	var name = r.id == "io" ? "AUDIO I/O" : (r.id == "keys" ? "KEYS" : ((rack.modules().find(function(m){ return m.id == r.id; }) || {}).def || { title: r.id }).title);
	var tag = "KEYS \u2192 " + name + " (" + mapped + " OF " + (keyctl.drawn || []).length + " BUTTONS" + (banks > 1 ? ", BANK " + (keyctl.bank + 1) + "/" + banks + ": ` NEXT" : "") + ")";
	ctx.font = "bold 14px " + FONT;
	var tw = ctx.measureText( tag ).width + 20;
	ctx.fillStyle = "#ffd65a";
	ctx.fillRect( r.x + 8, r.y + 8, tw, 22 );
	ctx.fillStyle = "#111"; ctx.textAlign = "left";
	ctx.fillText( tag, r.x + 18, r.y + 19 );
}

// tooltip at x, y of the current frame
function tip( text, x, y ) { tooltips.push([ text, rackX( x ), rackY( y ) ]); }

function clamp(v,a,b) { return v < a ? a : (v > b ? b : v); }

// ---------------------------------------------------------------------------
// audio start

function ensureAudio()
{
	if(!rack.context)
		return rack.init().then(function(){ gfTrack( "audio-on", null, true ); updateToolbar(); }, function(err){
			console.error(err);
			setStatus("Audio engine failed to start: " + err.message);
		});
	return rack._initializing;
}

function act( fn )
{
	ensureAudio().then( fn );
}

// ---------------------------------------------------------------------------
// input

function toPanel( e )
{
	var r = canvas.getBoundingClientRect();
	ui.cx = e.clientX - r.left; // kept to map the pointer again after a scroll
	ui.cy = e.clientY - r.top;
	ui.x = ui.px = (ui.cx - view.ox) / view.scale;
	ui.y = ui.py = (ui.cy - view.oy) / view.scale;
	ui.shift = e.shiftKey;
}

function setScroll( x, y )
{
	view.sx = clamp( x, 0, view.max_sx );
	view.sy = clamp( y, 0, view.max_sy );
}

// "x" / "y" when the pointer is on a scrollbar
function scrollbarHit( e )
{
	var r = canvas.getBoundingClientRect();
	var x = e.clientX - r.left, y = e.clientY - r.top;
	if(view.max_sy > 0 && x >= canvas.clientWidth - SCROLLBAR_W - 4)
		return "y";
	if(view.max_sx > 0 && y >= canvas.clientHeight - SCROLLBAR_W - 4)
		return "x";
	return null;
}

canvas.addEventListener("pointerdown", function(e){
	toPanel(e);
	var bar = e.button == 0 && scrollbarHit( e );
	if(bar)
	{
		// dragging a scrollbar: the thumb follows the pointer
		view.drag = { axis: bar, x: e.clientX, y: e.clientY, sx: view.sx, sy: view.sy };
		canvas.setPointerCapture( e.pointerId );
		e.preventDefault();
		return;
	}
	if(e.button == 2)
	{
		ui.rpressed = true;
		return;
	}
	if(e.button != 0)
		return;
	ensureAudio();
	var now = performance.now();
	ui.dbl = (now - ui.lastDownTime) < 350 && Math.hypot( ui.x - ui.lastDownPos[0], ui.y - ui.lastDownPos[1] ) < 8;
	ui.lastDownTime = now;
	ui.lastDownPos = [ui.x, ui.y];
	ui.down = true;
	ui.pressed = true;
	canvas.setPointerCapture( e.pointerId );
	e.preventDefault();
});
canvas.addEventListener("pointermove", function(e){
	toPanel(e);
	var d = view.drag;
	if(d)
	{
		var w = canvas.clientWidth, h = canvas.clientHeight;
		if(d.axis == "y")
			setScroll( view.sx, d.sy + (e.clientY - d.y) * (view.max_sy + h) / h );
		else
			setScroll( d.sx + (e.clientX - d.x) * (view.max_sx + w) / w, view.sy );
	}
});
function onPointerUp(e) {
	toPanel(e);
	if(view.drag)
	{
		view.drag = null;
		return;
	}
	if(e.button == 2 || !ui.down)
		return;
	ui.down = false;
	ui.released = true;
}
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("wheel", function(e){
	toPanel(e);
	// shift + wheel (or a sideways wheel) scrolls horizontally, unless a knob takes it
	if(Math.abs( e.deltaX ) > Math.abs( e.deltaY ))
		ui.wheel_x += Math.sign( e.deltaX );
	else
		ui.wheel += Math.sign( e.deltaY );
	ui.wheel_ctrl = e.ctrlKey || e.metaKey; // Ctrl (Cmd) + wheel turns the knob even with the option off
	e.preventDefault();
}, { passive: false });
canvas.addEventListener("contextmenu", function(e){ e.preventDefault(); });

function hitCircle( cx, cy, r ) { var dx = ui.x - cx, dy = ui.y - cy; return dx*dx + dy*dy <= r*r; }
function hitRect( x, y, w, h ) { return ui.x >= x && ui.x <= x + w && ui.y >= y && ui.y <= y + h; }

// pads you can slide across: with the mouse held down since a pad of the group (ids: group + a
// digit...), moving over another one presses it, and the one left is let go
function padSlide( full, group, x, y, w, h )
{
	var a = ui.active;
	if(ui.down && !cable_drag && typeof a == "string" && a !== full && a.indexOf( group ) == 0 && /\d/.test( a.charAt( group.length ) ) && hitRect( x, y, w, h ))
	{
		ui.active = full;
		return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// drawing primitives

function drawLabel( text, x, y, size, inverted, color )
{
	ctx.font = (size || 12) + "px " + FONT;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	if(inverted)
	{
		var w = ctx.measureText( text ).width + 8;
		var h = (size || 12) + 4;
		ctx.fillStyle = TEXT_COLOR;
		ctx.fillRect( x - w * 0.5, y - h * 0.5, w, h );
		ctx.fillStyle = "#111";
	}
	else
		ctx.fillStyle = color || TEXT_COLOR;
	ctx.fillText( text, x, y + 1 );
}

function drawSection( text, x1, x2, y )
{
	ctx.font = "15px " + FONT;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	var w = ctx.measureText( text ).width + 16;
	var cx = (x1 + x2) * 0.5;
	ctx.strokeStyle = "#5a5852";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo( x1, y ); ctx.lineTo( cx - w * 0.5, y );
	ctx.moveTo( cx + w * 0.5, y ); ctx.lineTo( x2, y );
	ctx.stroke();
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( text, cx, y + 1 );
}

function drawLed( x, y, r, on, color )
{
	color = color || "#ff3b2f";
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.arc( x, y, r + 1.5, 0, Math.PI * 2 ); ctx.fill();
	if(on)
	{
		var g = ctx.createRadialGradient( x, y, 0, x, y, r * 3 );
		g.addColorStop( 0, color + "aa" );
		g.addColorStop( 1, color + "00" );
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.arc( x, y, r * 3, 0, Math.PI * 2 ); ctx.fill();
	}
	ctx.fillStyle = on ? color : "#3a1512";
	ctx.beginPath(); ctx.arc( x, y, r, 0, Math.PI * 2 ); ctx.fill();
	if(on)
	{
		ctx.fillStyle = "rgba(255,255,255,0.5)";
		ctx.beginPath(); ctx.arc( x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2 ); ctx.fill();
	}
}

function drawScrew( x, y )
{
	var g = ctx.createRadialGradient( x - 2, y - 2, 1, x, y, 7 );
	g.addColorStop( 0, "#9a9a96" );
	g.addColorStop( 1, "#3c3c3a" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( x, y, 6, 0, Math.PI * 2 ); ctx.fill();
	ctx.strokeStyle = "#222";
	ctx.lineWidth = 1.5;
	ctx.beginPath(); ctx.moveTo( x - 4, y - 1 ); ctx.lineTo( x + 4, y + 1 ); ctx.stroke();
}

// ---------------------------------------------------------------------------
// widgets

// o: { label, exp, step, def, format, bipolar, reverse, style: "ticks" | "ring" | "small", ticks }
function knob( id, cx, cy, r, value, min, max, o )
{
	o = o || {};
	id = id_prefix + id;
	var range = o.exp ? Math.log( max / min ) : (max - min);
	// n is the knob rotation 0..1; reversed knobs (SUB FREQ) read min fully clockwise
	var toN = function(v) { var n = o.exp ? Math.log( v / min ) / range : (v - min) / range; return o.reverse ? 1 - n : n; };
	var fromN = function(n) { if(o.reverse) n = 1 - n; return o.exp ? min * Math.exp( n * range ) : min + n * range; };

	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitCircle( cx, cy, Math.max( r * 1.2, 16 ) );
	if(hover)
		ui.hot = id;
	if(hover || ui.active === id)
		hover_control = id; // its sockets light up
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = id;
		if(ui.dbl && o.def !== undefined)
			value = o.def;
		ui.startY = ui.y;
		ui.startN = toN( value );
		ui.dragShift = ui.shift;
	}
	if(ui.active === id && ui.down)
	{
		if(ui.shift != ui.dragShift) // switching fine mode mid-drag must not jump
		{
			ui.startN = toN( value );
			ui.startY = ui.y;
			ui.dragShift = ui.shift;
		}
		var travel = (o.step ? 260 : 220) * (ui.shift ? 5 : 1);
		value = fromN( clamp( ui.startN + (ui.startY - ui.y) / travel, 0, 1 ) );
	}
	var wheeled = false;
	if(hover && ui.wheel && ui.active === null && (wheel_knobs || ui.wheel_ctrl))
	{
		var dn = -ui.wheel * (o.step ? o.step / (max - min) : (ui.shift ? 0.005 : 0.025));
		value = fromN( clamp( toN(value) + dn, 0, 1 ) );
		ui.wheel = 0;
		wheeled = true;
	}
	if(WR.knobMoved && ((ui.active === id && ui.down) || wheeled)) // the song's CV tracks record it
		WR.knobMoved( id, clamp( toN( value ), 0, 1 ) );
	if(midictl.pending[ id ] !== undefined) // MIDI learn: a CC over the knob's range
	{
		value = fromN( clamp( midictl.pending[ id ], 0, 1 ) );
		delete midictl.pending[ id ];
	}
	midiNote( id, cx, cy, r, r, "knob" );
	if(o.step)
		value = Math.round( value / o.step ) * o.step;
	value = clamp( value, min, max );

	var style = o.style || "ticks";
	var steps = o.step ? Math.round( (max - min) / o.step ) + 1 : 0;
	var skin = knob_skin || (layout == "classic" ? "classic" : "aluminium");
	if(skin != "classic" && skin != "aluminium")
	{
		var tk = o.ticks || steps || (style == "ring" ? 11 : 31);
		if(skin != "ledring" && !o.noScale) // the LED ring is its own scale; noScale: no printed scale
			drawKnobScale( cx, cy, r, tk, o.bipolar, style == "small" ? "small" : style );
		drawSkinKnob( skin, cx, cy, r, clamp( toN(value), 0, 1 ), hover || ui.active === id, o.bipolar );
		if(o.label)
			drawLabel( o.label, cx, cy - (style == "small" ? r + 15 : (style == "ring" ? r * 1.2 + 16 : r * 1.12 + 18)), o.labelSize || 11 );
	}
	else if(skin == "classic")
	{
		classicDrawKnob( cx, cy, r, clamp( toN(value), 0, 1 ), hover || ui.active === id, steps || 11, o.bipolar );
		if(o.label)
			drawLabel( o.label, cx, cy - r - 16, o.labelSize || 12 );
	}
	else
	{
		var ticks = o.ticks || steps || (style == "ring" ? 11 : 31);
		drawKnob( cx, cy, r, clamp( toN(value), 0, 1 ), hover || ui.active === id, ticks, o.bipolar, style );
		if(o.label) // clear of the printed scale
			drawLabel( o.label, cx, cy - (style == "small" ? r + 15 : (style == "ring" ? r * 1.2 + 16 : r * 1.12 + 18)), o.labelSize || 11 );
	}
	if((hover || ui.active === id) && o.format)
		tip( o.format( value ), cx, cy + r + 16 );
	return value;
}

function drawKnobScale( cx, cy, r, ticks, bipolar, style )
{
	var a;
	// scale printed on the panel
	ctx.strokeStyle = knob_scale_color || "#d8d5ce";
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	if(style == "ring")
	{
		var rr = r * 1.2 + 2;
		ctx.arc( cx, cy, rr, KNOB_A0, KNOB_A0 + KNOB_SWEEP );
		for(var i = 0; i < ticks; ++i)
		{
			a = KNOB_A0 + (i / (ticks - 1)) * KNOB_SWEEP;
			ctx.moveTo( cx + Math.cos(a) * rr, cy + Math.sin(a) * rr );
			ctx.lineTo( cx + Math.cos(a) * (rr + 5), cy + Math.sin(a) * (rr + 5) );
		}
	}
	else
	{
		var r1 = style == "small" ? r + 3 : r * 1.12 + 2;
		for(var i = 0; i < ticks; ++i)
		{
			a = KNOB_A0 + (i / (ticks - 1)) * KNOB_SWEEP;
			var major = i == 0 || i == ticks - 1 || (bipolar && i == (ticks - 1) / 2) || (style != "small" && i % 5 == 0);
			var len = style == "small" ? 5 : (major ? 8 : 5);
			ctx.moveTo( cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 );
			ctx.lineTo( cx + Math.cos(a) * (r1 + len), cy + Math.sin(a) * (r1 + len) );
		}
	}
	ctx.stroke();
	if(bipolar && style != "small")
	{
		drawLabel( "(-)", cx + Math.cos(KNOB_A0) * (r * 1.5), cy + Math.sin(KNOB_A0) * (r * 1.5) + 4, 10 );
		drawLabel( "(+)", cx + Math.cos(KNOB_A0 + KNOB_SWEEP) * (r * 1.5), cy + Math.sin(KNOB_A0 + KNOB_SWEEP) * (r * 1.5) + 4, 10 );
	}
}

// the other knob styles: LM (black skirt, black cap), CHROME, CREAM (ivory cap), SOFT (rubber, coloured cap)
function drawSkinKnob( skin, cx, cy, r, n, highlight, bipolar )
{
	var a = KNOB_A0 + n * KNOB_SWEEP, g, i;
	var pointer = function(color, r0, r1, wd) {
		ctx.strokeStyle = color;
		ctx.lineWidth = wd;
		ctx.lineCap = "round";
		ctx.beginPath();
		ctx.moveTo( cx + Math.cos(a) * r * r0, cy + Math.sin(a) * r * r0 );
		ctx.lineTo( cx + Math.cos(a) * r * r1, cy + Math.sin(a) * r * r1 );
		ctx.stroke();
		ctx.lineCap = "butt";
	};
	var ridges = function(color, r0, r1, count) {
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.beginPath();
		for(i = 0; i < count; ++i)
		{
			var b = (i / count) * Math.PI * 2;
			ctx.moveTo( cx + Math.cos(b) * r * r0, cy + Math.sin(b) * r * r0 );
			ctx.lineTo( cx + Math.cos(b) * r * r1, cy + Math.sin(b) * r * r1 );
		}
		ctx.stroke();
	};
	var disc = function(rad, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc( cx, cy, rad, 0, Math.PI * 2 ); ctx.fill(); };
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.beginPath(); ctx.arc( cx + 2, cy + 4, r, 0, Math.PI * 2 ); ctx.fill();
	if(skin == "lm")
	{
		// a knurled black skirt, a smooth black cap, a white line across both
		g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r );
		g.addColorStop( 0, highlight ? "#3a3a3a" : "#2a2a2a" ); g.addColorStop( 1, "#060606" );
		disc( r, g );
		ridges( "rgba(150,150,150,0.35)", 0.74, 0.98, Math.max( 24, Math.round( r * 1.6 ) ) );
		g = ctx.createRadialGradient( cx - r * 0.2, cy - r * 0.25, r * 0.05, cx, cy, r * 0.68 );
		g.addColorStop( 0, highlight ? "#444" : "#333" ); g.addColorStop( 0.7, "#151515" ); g.addColorStop( 1, "#0a0a0a" );
		disc( r * 0.68, g );
		ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.arc( cx, cy, r * 0.68, Math.PI * 1.05, Math.PI * 1.7 ); ctx.stroke();
		pointer( "#f4f1ea", 0.1, 0.96, Math.max( 1.8, r * 0.09 ) );
	}
	else if(skin == "chrome")
	{
		g = ctx.createRadialGradient( cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r );
		g.addColorStop( 0, "#ffffff" ); g.addColorStop( 0.45, highlight ? "#d8dadc" : "#c4c7ca" ); g.addColorStop( 1, "#5d6064" );
		disc( r, g );
		ridges( "rgba(40,40,45,0.35)", 0.8, 0.99, Math.max( 20, Math.round( r * 1.4 ) ) );
		g = ctx.createLinearGradient( cx - r, cy - r, cx + r, cy + r );
		g.addColorStop( 0, "#f6f7f8" ); g.addColorStop( 0.5, "#a9adb2" ); g.addColorStop( 1, "#e8eaec" );
		disc( r * 0.74, g );
		pointer( "#151515", 0.2, 0.95, Math.max( 2, r * 0.1 ) );
	}
	else if(skin == "cream")
	{
		disc( r, highlight ? "#2a2622" : "#1a1714" );
		g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r * 0.86 );
		g.addColorStop( 0, "#fffaf0" ); g.addColorStop( 0.6, highlight ? "#f1e6cc" : "#e6d9bb" ); g.addColorStop( 1, "#b7a780" );
		disc( r * 0.86, g );
		ctx.strokeStyle = "rgba(90,70,40,0.35)"; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.arc( cx, cy, r * 0.86, 0, Math.PI * 2 ); ctx.stroke();
		pointer( "#1c1a17", 0.12, 0.84, Math.max( 2, r * 0.11 ) );
	}
	else if(skin == "flat")
	{
		// a flat moulded knob, black or coloured, a white line
		var base = knob_tint || "#16161a";
		// the colour, lighter towards the light and darker at the edge
		var mixc = function(hex, t) { // t > 0: towards white, < 0: towards black
			var n = parseInt( hex.slice( 1 ), 16 ), c = [n >> 16, (n >> 8) & 255, n & 255];
			return "rgb(" + c.map(function(v){ return Math.round( t > 0 ? v + (255 - v) * t : v * (1 + t) ); }).join(",") + ")";
		};
		disc( r, "#050506" );
		g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r * 0.92 );
		g.addColorStop( 0, mixc( base, highlight ? 0.38 : 0.25 ) ); g.addColorStop( 0.5, base ); g.addColorStop( 1, mixc( base, -0.35 ) );
		disc( r * 0.92, g );
		pointer( "#f6f4ee", 0.15, 0.9, Math.max( 1.6, r * 0.11 ) );
	}
	else if(skin == "greycap")
	{
		// a tall black knurled knob with a light grey top, its pointer a dark line on the top
		g = ctx.createLinearGradient( cx - r, cy, cx + r, cy );
		g.addColorStop( 0, "#2a2c33" ); g.addColorStop( 0.35, highlight ? "#4a4d57" : "#3a3d46" ); g.addColorStop( 1, "#0c0d10" );
		disc( r, g );
		ridges( "rgba(0,0,0,0.55)", 0.82, 0.99, Math.max( 22, Math.round( r * 1.7 ) ) );
		g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r * 0.8 );
		g.addColorStop( 0, "#f4f5f7" ); g.addColorStop( 0.7, highlight ? "#dfe2e7" : "#cfd3d9" ); g.addColorStop( 1, "#a9aeb6" );
		disc( r * 0.8, g );
		pointer( "#22252d", 0.25, 0.78, Math.max( 1.8, r * 0.09 ) );
	}
	else if(skin == "ledring")
	{
		// white LEDs around the knob, lit up to the value (from the centre when bipolar), and a
		// machined silver knob
		var leds = 15, rr = r + 6;
		for(i = 0; i < leds; ++i)
		{
			var t = i / (leds - 1), b = KNOB_A0 + t * KNOB_SWEEP;
			var on = bipolar ? (n >= 0.5 ? t >= 0.5 - 1e-6 && t <= n + 0.02 : t <= 0.5 + 1e-6 && t >= n - 0.02) : t <= n + 0.02;
			var lx = cx + Math.cos(b) * rr, ly = cy + Math.sin(b) * rr;
			if(on)
			{
				ctx.fillStyle = "rgba(220,235,255,0.25)";
				ctx.beginPath(); ctx.arc( lx, ly, 3.6, 0, Math.PI * 2 ); ctx.fill();
			}
			ctx.fillStyle = on ? "#f4f8ff" : "#2a2b2d";
			ctx.beginPath(); ctx.arc( lx, ly, 1.7, 0, Math.PI * 2 ); ctx.fill();
		}
		g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r );
		g.addColorStop( 0, "#ffffff" ); g.addColorStop( 0.5, highlight ? "#d4d6d8" : "#bfc2c5" ); g.addColorStop( 1, "#55585c" );
		disc( r, g );
		ridges( "rgba(30,30,32,0.45)", 0.84, 0.99, Math.max( 24, Math.round( r * 2 ) ) );
		if(ctx.createConicGradient)
		{
			g = ctx.createConicGradient( -Math.PI * 0.25, cx, cy );
			[[0, "#f2f3f4"], [0.25, "#9a9da1"], [0.5, "#eceef0"], [0.75, "#8e9195"], [1, "#f2f3f4"]].forEach(function(st){ g.addColorStop( st[0], st[1] ); });
		}
		else g = "#c8cacc";
		disc( r * 0.78, g );
		pointer( "#1a1a1a", 0.35, 0.74, Math.max( 1.6, r * 0.08 ) );
	}
	else // soft
	{
		g = ctx.createRadialGradient( cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r );
		g.addColorStop( 0, highlight ? "#56595e" : "#474a4f" ); g.addColorStop( 1, "#24262a" );
		disc( r, g );
		g = ctx.createRadialGradient( cx - r * 0.15, cy - r * 0.2, r * 0.02, cx, cy, r * 0.42 );
		g.addColorStop( 0, "#ffb07a" ); g.addColorStop( 1, highlight ? "#ff7a35" : "#e8642a" );
		disc( r * 0.42, g );
		ctx.fillStyle = "#f4f1ea";
		ctx.beginPath(); ctx.arc( cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72, Math.max( 1.6, r * 0.09 ), 0, Math.PI * 2 ); ctx.fill();
	}
}

function drawKnob( cx, cy, r, n, highlight, ticks, bipolar, style )
{
	var a;
	drawKnobScale( cx, cy, r, ticks, bipolar, style );

	// shadow
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.beginPath(); ctx.arc( cx + 2, cy + 4, r, 0, Math.PI * 2 ); ctx.fill();

	// black knurled skirt
	var g = ctx.createRadialGradient( cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r );
	g.addColorStop( 0, highlight ? "#3c3c3a" : "#2c2c2a" );
	g.addColorStop( 1, "#050505" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
	a = KNOB_A0 + n * KNOB_SWEEP;

	if(style == "small")
	{
		// small sequencer / rhythm knobs: plain black with a white line
		ctx.strokeStyle = "#f2efe8";
		ctx.lineWidth = 2;
		ctx.lineCap = "round";
		ctx.beginPath();
		ctx.moveTo( cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.15 );
		ctx.lineTo( cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9 );
		ctx.stroke();
		ctx.lineCap = "butt";
		return;
	}

	ctx.strokeStyle = "rgba(0,0,0,0.7)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	var ridges = Math.max( 12, Math.round( r * 0.7 ) );
	for(var i = 0; i < ridges; ++i)
	{
		var b = (i / ridges) * Math.PI * 2;
		ctx.moveTo( cx + Math.cos(b) * r * 0.72, cy + Math.sin(b) * r * 0.72 );
		ctx.lineTo( cx + Math.cos(b) * r * 0.99, cy + Math.sin(b) * r * 0.99 );
	}
	ctx.stroke();

	// pointer line on the skirt
	ctx.strokeStyle = "#f2efe8";
	ctx.lineWidth = Math.max( 2, r * 0.08 );
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo( cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7 );
	ctx.lineTo( cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97 );
	ctx.stroke();
	ctx.lineCap = "butt";

	// machined aluminium cap: a conic gradient fakes the anisotropic reflection of the circular
	// turning marks (bright wedges facing the light), then a dark centre and edge on top
	var cr = r * 0.62;
	if(ctx.createConicGradient)
	{
		g = ctx.createConicGradient( -Math.PI * 0.25, cx, cy );
		var lit = highlight ? 1.08 : 1;
		var shade = function(v) { v = Math.min( 255, Math.round( v * lit ) ); return "rgb(" + v + "," + v + "," + Math.round( v * 0.96 ) + ")"; };
		[[0, 150], [0.1, 104], [0.22, 82], [0.36, 112], [0.5, 156], [0.6, 106], [0.72, 84], [0.86, 116], [1, 150]].forEach(function(st){
			g.addColorStop( st[0], shade( st[1] ) );
		});
	}
	else
	{
		g = ctx.createRadialGradient( cx, cy, 0, cx, cy, cr );
		g.addColorStop( 0, "#5c5c58" );
		g.addColorStop( 1, highlight ? "#9a9a94" : "#8c8c86" );
	}
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( cx, cy, cr, 0, Math.PI * 2 ); ctx.fill();
	g = ctx.createRadialGradient( cx, cy, 0, cx, cy, cr );
	g.addColorStop( 0, "rgba(20,20,19,0.85)" );
	g.addColorStop( 0.16, "rgba(20,20,19,0.35)" );
	g.addColorStop( 0.3, "rgba(20,20,19,0)" );
	g.addColorStop( 0.85, "rgba(0,0,0,0)" );
	g.addColorStop( 1, "rgba(0,0,0,0.35)" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( cx, cy, cr, 0, Math.PI * 2 ); ctx.fill();
	ctx.lineWidth = 0.6;
	var rings = Math.max( 4, Math.round( cr / 2.5 ) );
	for(var i = 1; i < rings; ++i)
	{
		ctx.strokeStyle = i % 2 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
		ctx.beginPath(); ctx.arc( cx, cy, cr * i / rings, 0, Math.PI * 2 ); ctx.stroke();
	}
	ctx.strokeStyle = "rgba(0,0,0,0.45)";
	ctx.lineWidth = 1;
	ctx.beginPath(); ctx.arc( cx, cy, cr, 0, Math.PI * 2 ); ctx.stroke();
}

// rubber button that lights up red when `lit` (classic layout: LED dot, none if lit is undefined). returns { clicked, held }
function button( id, x, y, w, h, text, lit )
{
	id = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitRect( x, y, w, h );
	var clicked = false;
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = id;
		clicked = true;
	}
	var kb = keyButton( id, x, y, w, h );
	clicked = clicked || kb.pressed;
	var held = (ui.active === id && ui.down) || kb.held;
	if(layout == "classic")
	{
		classicButtonFace( x, y, w, h, text, lit, hover, held );
		return { clicked: clicked, held: held };
	}
	var dy = held ? 1 : 0;

	ctx.fillStyle = "rgba(0,0,0,0.65)";
	ctx.beginPath(); ctx.roundRect( x + 1, y + 3, w, h, 3 ); ctx.fill();
	if(lit)
	{
		ctx.fillStyle = "rgba(255,70,70,0.25)";
		ctx.beginPath(); ctx.roundRect( x - 4, y - 4 + dy, w + 8, h + 8, 6 ); ctx.fill();
	}
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	if(lit)
	{
		g.addColorStop( 0, hover ? "#ff9a96" : "#f58a86" );
		g.addColorStop( 1, "#d9504f" );
	}
	else
	{
		g.addColorStop( 0, hover ? "#c4c4be" : "#b2b2ac" );
		g.addColorStop( 1, "#86867f" );
	}
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x, y + dy, w, h, 3 ); ctx.fill();
	if(held)
	{
		ctx.fillStyle = "rgba(0,0,0,0.15)";
		ctx.beginPath(); ctx.roundRect( x, y + dy, w, h, 3 ); ctx.fill();
	}
	if(text)
	{
		ctx.font = "11px " + FONT;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#1a1a1a";
		ctx.fillText( text, x + w * 0.5, y + h * 0.5 + 1 + dy );
	}
	return { clicked: clicked, held: held };
}

// classic layout knob and button faces (toolbar "Layout" button)

function classicDrawKnob( cx, cy, r, n, highlight, ticks, bipolar )
{
	// scale
	ctx.strokeStyle = "#a9a69e";
	ctx.lineWidth = 1.4;
	ctx.beginPath();
	for(var i = 0; i < ticks; ++i)
	{
		var a = KNOB_A0 + (i / (ticks - 1)) * KNOB_SWEEP;
		var major = i == 0 || i == ticks - 1 || (bipolar && i == (ticks - 1) / 2);
		var r1 = r * 1.12 + 2, r2 = r * 1.12 + (major ? 9 : 6);
		ctx.moveTo( cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 );
		ctx.lineTo( cx + Math.cos(a) * r2, cy + Math.sin(a) * r2 );
	}
	ctx.stroke();

	// shadow
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.beginPath(); ctx.arc( cx + 2, cy + 4, r, 0, Math.PI * 2 ); ctx.fill();

	// skirt
	var g = ctx.createRadialGradient( cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r );
	g.addColorStop( 0, highlight ? "#4a4a48" : "#3a3a38" );
	g.addColorStop( 1, "#0a0a0a" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();

	// grip ridges
	ctx.strokeStyle = "rgba(0,0,0,0.6)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	var ridges = Math.max( 16, Math.round( r * 1.2 ) );
	for(var i = 0; i < ridges; ++i)
	{
		var a = (i / ridges) * Math.PI * 2;
		ctx.moveTo( cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8 );
		ctx.lineTo( cx + Math.cos(a) * r * 0.98, cy + Math.sin(a) * r * 0.98 );
	}
	ctx.stroke();

	// cap
	g = ctx.createLinearGradient( cx, cy - r, cx, cy + r );
	g.addColorStop( 0, "#2e2e2c" );
	g.addColorStop( 1, "#121212" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( cx, cy, r * 0.74, 0, Math.PI * 2 ); ctx.fill();

	// pointer
	var a = KNOB_A0 + n * KNOB_SWEEP;
	ctx.strokeStyle = "#f2efe8";
	ctx.lineWidth = Math.max( 2, r * 0.09 );
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo( cx + Math.cos(a) * r * 0.22, cy + Math.sin(a) * r * 0.22 );
	ctx.lineTo( cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93 );
	ctx.stroke();
	ctx.lineCap = "butt";
}

function classicButtonFace( x, y, w, h, text, lit, hover, held )
{
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	ctx.beginPath(); ctx.roundRect( x + 1, y + 3, w, h, 3 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	if(held)
	{
		g.addColorStop( 0, "#5c5c58" );
		g.addColorStop( 1, "#6c6c68" );
	}
	else
	{
		g.addColorStop( 0, hover ? "#b0b0aa" : "#9c9c96" );
		g.addColorStop( 1, hover ? "#7e7e78" : "#6c6c67" );
	}
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x, y + (held ? 1 : 0), w, h, 3 ); ctx.fill();

	var tx = x + w * 0.5;
	if(lit !== undefined)
	{
		drawLed( x + 9, y + h * 0.5 + (held ? 1 : 0), 3.2, lit );
		tx += 5;
	}
	if(text)
	{
		ctx.font = "12px " + FONT;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#151515";
		ctx.fillText( text, tx, y + h * 0.5 + 1 + (held ? 1 : 0) );
	}
}

function drawWaveIcon( kind, x, y )
{
	ctx.beginPath();
	if(kind == "square")
	{
		ctx.moveTo( x, y + 3 ); ctx.lineTo( x, y - 3 ); ctx.lineTo( x + 5, y - 3 ); ctx.lineTo( x + 5, y + 3 ); ctx.lineTo( x + 10, y + 3 ); ctx.lineTo( x + 10, y - 3 );
	}
	else if(kind == "pwm")
	{
		ctx.moveTo( x, y + 3 ); ctx.lineTo( x, y - 3 ); ctx.lineTo( x + 2, y - 3 ); ctx.lineTo( x + 2, y + 3 ); ctx.lineTo( x + 4, y + 3 );
		ctx.moveTo( x + 6, y + 3 ); ctx.lineTo( x + 11, y - 3 ); ctx.lineTo( x + 11, y + 3 );
	}
	else
	{
		ctx.moveTo( x, y + 3 ); ctx.lineTo( x + 5, y - 3 ); ctx.lineTo( x + 5, y + 3 ); ctx.lineTo( x + 10, y - 3 ); ctx.lineTo( x + 10, y + 3 );
	}
	ctx.stroke();
}

// 3 position VCO wave switch: up = square, middle = pulse + saw subs (PWM), down = saw
var WAVE_POSITIONS = ["square", "pwm", "saw"];
function waveSwitch( id, x, y, value, icons_left )
{
	id = id_prefix + id;
	var w = 14, h = 48;
	var pos = Math.max( 0, WAVE_POSITIONS.indexOf( value ) );
	var hover = !cable_drag && ui.active === null && hitRect( x - 18, y - 4, w + 36, h + 8 );
	if(hover && ui.pressed)
	{
		ui.active = id;
		pos = clamp( Math.floor( (ui.y - y) / (h / 3) ), 0, 2 );
		value = WAVE_POSITIONS[ pos ];
	}
	if(hover)
		ui.hot = id;

	// hex nut + bat lever
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 3 ); ctx.fill();
	var cx = x + w * 0.5, cy = y + h * 0.5;
	var g = ctx.createRadialGradient( cx - 2, cy - 2, 1, cx, cy, 7 );
	g.addColorStop( 0, "#e6e6e0" );
	g.addColorStop( 1, "#7a7a74" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( cx, cy, 6, 0, Math.PI * 2 ); ctx.fill();
	var ty = y + 5 + pos * (h - 10) / 2;
	ctx.strokeStyle = "#d0d0ca";
	ctx.lineWidth = 4;
	ctx.lineCap = "round";
	ctx.beginPath(); ctx.moveTo( cx, cy ); ctx.lineTo( cx, ty ); ctx.stroke();
	ctx.lineCap = "butt";
	ctx.fillStyle = "#f0f0ea";
	ctx.beginPath(); ctx.arc( cx, ty, 3.5, 0, Math.PI * 2 ); ctx.fill();

	ctx.lineWidth = 1.3;
	for(var i = 0; i < 3; ++i)
	{
		ctx.strokeStyle = i == pos ? TEXT_COLOR : DIM_COLOR;
		drawWaveIcon( WAVE_POSITIONS[i], icons_left ? x - 16 : x + w + 5, y + 8 + i * (h - 16) / 2 );
	}
	if(hover)
		tip( ["SQUARE", "PULSE + SAW SUBS (PWM)", "SAW"][pos], cx, y + h + 14 );
	return value;
}

// toggle switch with 2 or 3 positions, top to bottom, labelled on its right. options: [[value, label], ...].
// Clicking a position selects it. Returns the value
function leverSwitch( id, x, y, value, options, label )
{
	id = id_prefix + id;
	var n = options.length;
	var w = 14, h = n == 3 ? 56 : 42;
	var pos = Math.max( 0, options.findIndex(function(o){ return o[0] === value; }) );
	var hover = !cable_drag && ui.active === null && hitRect( x - 6, y - 4, w + 62, h + 8 );
	if(hover)
		ui.hot = id;
	if(hover && ui.pressed)
	{
		ui.active = id;
		pos = clamp( Math.floor( (ui.y - y) / (h / n) ), 0, n - 1 );
		value = options[ pos ][0];
	}
	if(keyButton( id, x - 6, y - 4, w + 62, h + 8 ).pressed) // a key: the next position
	{
		pos = (pos + 1) % n;
		value = options[ pos ][0];
	}
	if(label)
		drawLabel( label, x + w * 0.5 + 18, y - 16, 11 );

	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 3 ); ctx.fill();
	var cx = x + w * 0.5, cy = y + h * 0.5;
	var g = ctx.createRadialGradient( cx - 2, cy - 2, 1, cx, cy, 7 );
	g.addColorStop( 0, "#e6e6e0" );
	g.addColorStop( 1, "#7a7a74" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( cx, cy, 6, 0, Math.PI * 2 ); ctx.fill();
	var py = function(i) { return y + 6 + i * (h - 12) / (n - 1); };
	ctx.strokeStyle = "#d0d0ca";
	ctx.lineWidth = 4;
	ctx.lineCap = "round";
	ctx.beginPath(); ctx.moveTo( cx, cy ); ctx.lineTo( cx, py( pos ) ); ctx.stroke();
	ctx.lineCap = "butt";
	ctx.fillStyle = "#f0f0ea";
	ctx.beginPath(); ctx.arc( cx, py( pos ), 3.5, 0, Math.PI * 2 ); ctx.fill();

	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.font = "10px " + FONT;
	options.forEach(function(o, i){
		ctx.fillStyle = i == pos ? TEXT_COLOR : DIM_COLOR;
		ctx.fillText( o[1], x + w + 6, py( i ) + 1 );
	});
	return value;
}

// vertical fader, value 0..1 (top = 1). x is the centre of the slot, y its top.
// o: { def, format, scale: [[position, label], ...] printed on the left }
function fader( id, x, y, h, value, o )
{
	id = id_prefix + id;
	o = o || {};
	var capW = 34, capH = 24;
	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitRect( x - capW * 0.5, y - capH * 0.5, capW, h + capH );
	if(hover)
		ui.hot = id;
	if(hover || ui.active === id)
		hover_control = id;
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = id;
		if(ui.dbl && o.def !== undefined)
			value = o.def;
		ui.startY = ui.y;
		ui.startN = value;
		ui.dragShift = ui.shift;
	}
	if(ui.active === id && ui.down)
	{
		if(ui.shift != ui.dragShift) // fine mode switched mid-drag: no jump
		{
			ui.startN = value;
			ui.startY = ui.y;
			ui.dragShift = ui.shift;
		}
		value = clamp( ui.startN + (ui.startY - ui.y) / (h * (ui.shift ? 5 : 1)), 0, 1 );
	}
	var wheeled = false;
	if(hover && ui.wheel && ui.active === null && (wheel_knobs || ui.wheel_ctrl))
	{
		value = clamp( value - ui.wheel * (ui.shift ? 0.005 : 0.02), 0, 1 );
		ui.wheel = 0;
		wheeled = true;
	}
	if(WR.knobMoved && ((ui.active === id && ui.down) || wheeled)) // the song's CV tracks record it
		WR.knobMoved( id, value );
	if(midictl.pending[ id ] !== undefined) { value = clamp( midictl.pending[ id ], 0, 1 ); delete midictl.pending[ id ]; }
	midiNote( id, x - capW * 0.5, y - capH * 0.5, capW, h + capH, "fader" );

	// printed scale
	ctx.strokeStyle = "#a9a69e";
	ctx.lineWidth = 1;
	ctx.beginPath();
	(o.scale || []).forEach(function(m){
		var my = y + (1 - m[0]) * h;
		ctx.moveTo( x - 24, my ); ctx.lineTo( x - 14, my );
	});
	ctx.stroke();
	(o.scale || []).forEach(function(m){
		ctx.font = "9px " + FONT;
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";
		ctx.fillStyle = DIM_COLOR;
		ctx.fillText( m[1], x - 27, y + (1 - m[0]) * h + 1 );
	});
	// slot
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x - 3, y - 4, 6, h + 8, 3 ); ctx.fill();
	// cap: black with a white line, like the knobs
	var cy = y + (1 - value) * h;
	ctx.fillStyle = "rgba(0,0,0,0.55)";
	ctx.beginPath(); ctx.roundRect( x - capW * 0.5 + 2, cy - capH * 0.5 + 4, capW, capH, 3 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, cy - capH * 0.5, 0, cy + capH * 0.5 );
	g.addColorStop( 0, hover || ui.active === id ? "#4a4a48" : "#3a3a38" );
	g.addColorStop( 0.5, "#1c1c1b" );
	g.addColorStop( 1, "#2c2c2a" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x - capW * 0.5, cy - capH * 0.5, capW, capH, 3 ); ctx.fill();
	ctx.fillStyle = "#f2efe8";
	ctx.fillRect( x - capW * 0.5 + 3, cy - 1, capW - 6, 2 );
	if((hover || ui.active === id) && o.format)
		tip( o.format( value ), x, y + h + 22 );
	return value;
}

// ---------------------------------------------------------------------------
// patch bay

function jackCompatible( drag, j )
{
	return (drag.type == "out" && j.type == "in") || (drag.type == "in" && j.type == "out") ||
		(drag.type == "aout" && j.type == "ain") || (drag.type == "ain" && j.type == "aout") ||
		(drag.type == "midiout" && j.type == "midiin") || (drag.type == "midiin" && j.type == "midiout");
}

function drawJack( id, x, y, label, type )
{
	id = id_prefix + id;
	jacks[id] = { x: rackX( x ), y: rackY( y ), type: type, label: label };
	var hover = hitCircle( x, y, 17 );

	drawLabel( label, x, y - 24, 10, type == "out" || type == "midiout" );

	if(cable_drag && cable_drag.from != id && jackCompatible( cable_drag, jacks[id] ))
	{
		ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.25)";
		ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( x, y, 18, 0, Math.PI * 2 ); ctx.stroke();
	}

	// hex nut
	var g = ctx.createLinearGradient( x - 14, y - 14, x + 14, y + 14 );
	g.addColorStop( 0, hover && !cable_drag ? "#e0e0da" : "#c9c9c3" );
	g.addColorStop( 1, "#6d6d68" );
	ctx.fillStyle = g;
	ctx.beginPath();
	for(var i = 0; i < 6; ++i)
	{
		var a = Math.PI / 6 + i * Math.PI / 3;
		ctx.lineTo( x + Math.cos(a) * 13, y + Math.sin(a) * 13 );
	}
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = "#2a2a28";
	ctx.beginPath(); ctx.arc( x, y, 8, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#000";
	ctx.beginPath(); ctx.arc( x, y, 5.5, 0, Math.PI * 2 ); ctx.fill();
}

// a tiny switch (MASTER MIDI and the channels, on the back next to the MIDI sockets); returns true when clicked
function tinyButton( id, x, y, w, h, text, on, tooltip )
{
	id = id_prefix + id;
	var hover = !cable_drag && ui.active === null && hitRect( x, y, w, h );
	if(hover)
	{
		ui.hot = id;
		if(tooltip)
			tip( tooltip, x + w * 0.5, y + h + 10 );
	}
	var clicked = hover && ui.pressed;
	if(clicked)
		ui.active = id;
	if(keyButton( id, x, y, w, h ).pressed)
		clicked = true;
	ctx.fillStyle = on ? "#c9483a" : (hover ? "#4a4a46" : "#2c2c2a");
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 3 ); ctx.fill();
	ctx.font = "bold 8px " + FONT;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = on ? "#fff" : TEXT_COLOR;
	ctx.fillText( text, x + w * 0.5, y + h * 0.5 + 1 );
	return clicked;
}

function jackAt( x, y )
{
	for(var id in jacks)
	{
		var j = jacks[id];
		if((x - j.x) * (x - j.x) + (y - j.y) * (y - j.y) < 18 * 18)
			return id;
	}
	return null;
}

function updateCables()
{
	var patches = rack.settings.patches;
	if(ui.rpressed)
	{
		var id = jackAt( ui.x, ui.y );
		if(id)
			rack.disconnect( id );
	}
	if(ui.pressed && ui.active === null && !cable_drag)
	{
		var id = jackAt( ui.x, ui.y );
		if(id)
		{
			ui.active = "jack";
			var j = jacks[id];
			if(ui.dbl)
				rack.disconnect( id );
			else if(j.type == "in" || j.type == "midiin" || j.type == "ain")
			{
				// grab the cable plugged here (the newest one, on an audio input with several), or start a new one
				var idx = -1;
				patches.forEach(function(p, i){ if(p[1] == id) idx = i; });
				if(idx != -1)
				{
					var p = patches.splice( idx, 1 )[0];
					cable_drag = { from: p[0], type: jacks[ p[0] ].type, color: p[2] };
				}
				else
					cable_drag = { from: id, type: j.type, color: next_color++ % CABLE_COLORS.length };
			}
			else
				cable_drag = { from: id, type: j.type, color: next_color++ % CABLE_COLORS.length };
		}
	}
	if(cable_drag && !ui.down)
	{
		var target = jackAt( ui.x, ui.y );
		if(target && jackCompatible( cable_drag, jacks[target] ))
		{
			if(cable_drag.type == "out" || cable_drag.type == "midiout" || cable_drag.type == "aout")
				rack.connect( cable_drag.from, target, cable_drag.color );
			else
				rack.connect( target, cable_drag.from, cable_drag.color );
		}
		cable_drag = null;
	}
}

// plugs_only: just the plugs on the jacks (toolbar "Wires" hidden)
function drawCable( x1, y1, x2, y2, color, alpha, plugs_only )
{
	var d = Math.hypot( x2 - x1, y2 - y1 );
	var sag = Math.min( 20 + d * 0.3, 90 ); // long cables between rows would hang off the panel
	// quadratic curve: the lowest point hangs `sag` below the midpoint
	var mx = (x1 + x2) * 0.5, my = (y1 + y2) * 0.5 + sag;
	ctx.save();
	ctx.globalAlpha = alpha || 0.92;
	if(!plugs_only)
	{
		ctx.lineCap = "round";
		ctx.strokeStyle = "rgba(0,0,0,0.35)";
		ctx.lineWidth = 8;
		ctx.beginPath(); ctx.moveTo( x1 + 3, y1 + 6 ); ctx.quadraticCurveTo( mx + 3, my + sag + 6, x2 + 3, y2 + 6 ); ctx.stroke();
		ctx.strokeStyle = color;
		ctx.lineWidth = 6;
		ctx.beginPath(); ctx.moveTo( x1, y1 ); ctx.quadraticCurveTo( mx, my + sag, x2, y2 ); ctx.stroke();
		ctx.strokeStyle = "rgba(255,255,255,0.3)";
		ctx.lineWidth = 1.5;
		ctx.beginPath(); ctx.moveTo( x1 - 1, y1 - 1.5 ); ctx.quadraticCurveTo( mx - 1, my + sag - 1.5, x2 - 1, y2 - 1.5 ); ctx.stroke();
	}
	[[x1,y1],[x2,y2]].forEach(function(p){
		ctx.fillStyle = "#111";
		ctx.beginPath(); ctx.arc( p[0], p[1], 9.5, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = color;
		ctx.beginPath(); ctx.arc( p[0], p[1], 7.5, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,0.35)";
		ctx.beginPath(); ctx.arc( p[0] - 2, p[1] - 2, 2.5, 0, Math.PI * 2 ); ctx.fill();
	});
	ctx.restore();
}

function drawCables()
{
	rack.settings.patches.forEach(function(p){
		var a = jacks[p[0]], b = jacks[p[1]];
		if(a && b)
			drawCable( a.x, a.y, b.x, b.y, CABLE_COLORS[ p[2] % CABLE_COLORS.length ], 0.92, !show_wires );
	});
	if(cable_drag)
	{
		var a = jacks[ cable_drag.from ];
		drawCable( a.x, a.y, ui.x, ui.y, CABLE_COLORS[ cable_drag.color ], 0.8 );
	}
}

// ---------------------------------------------------------------------------
// formatting

function fmtHz( f ) { return f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(f < 100 ? 1 : 0) + " Hz"; }
function fmtTime( t ) { return t >= 1 ? t.toFixed(2) + " s" : (t * 1000).toFixed(t < 0.01 ? 1 : 0) + " ms"; }
function fmtPct( v ) { return Math.round( v * 100 ) + "%"; }
function fmtSigned( v ) { return (v > 0 ? "+" : "") + Math.round( v * 100 ) + "%"; }
function fmtDiv( v ) { return "÷" + v; }


// ---------------------------------------------------------------------------
// shared drawing for the devices (the half width ones: LFO, compressor, reverb, delay, ...)

var DEVICE_GAP = 10; // between two half width devices in a row

// wood cheeks + black panel, shared by the main panel and the devices
// whether the device being drawn has wooden sides (the classic synths: its def.wood); the others fill the
// rack's whole width, their ends as rack ears with screws
var casing_wood = false;
function drawCasing( x, y, w, h )
{
	if(!casing_wood)
	{
		var gp = layout == "classic" ? ctx.createLinearGradient( 0, y, 0, y + h ) : ctx.createLinearGradient( x, y, x + w, y + h );
		gp.addColorStop( 0, layout == "classic" ? "#1c1c1b" : "#1f1f1e" );
		gp.addColorStop( 1, layout == "classic" ? "#121212" : "#151515" );
		ctx.fillStyle = gp;
		ctx.fillRect( x, y, w, h );
		ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
		ctx.strokeRect( x + 0.5, y + 0.5, w - 1, h - 1 );
		ctx.beginPath(); ctx.moveTo( x + 22.5, y ); ctx.lineTo( x + 22.5, y + h ); ctx.moveTo( x + w - 22.5, y ); ctx.lineTo( x + w - 22.5, y + h ); ctx.stroke();
		[x + 11, x + w - 11].forEach(function(cx){ // the rack screws in the ears
			[y + 12, y + h - 12].forEach(function(cy){
				if(h < 40 && cy != y + 12) return;
				ctx.fillStyle = "#0a0a0a"; ctx.beginPath(); ctx.roundRect( cx - 6, cy - 4, 12, 8, 4 ); ctx.fill();
				ctx.fillStyle = "#8c8c88"; ctx.beginPath(); ctx.arc( cx, cy, 3.2, 0, Math.PI * 2 ); ctx.fill();
			});
		});
		return;
	}
	[x, x + w - 22].forEach(function(cx){
		var g = ctx.createLinearGradient( cx, 0, cx + 22, 0 );
		g.addColorStop( 0, "#4a2c18" );
		g.addColorStop( 0.5, "#8a5a34" );
		g.addColorStop( 1, "#5a3620" );
		ctx.fillStyle = g;
		ctx.fillRect( cx, y, 22, h );
		ctx.strokeStyle = "rgba(40,20,8,0.35)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for(var i = 0; i < 6; ++i)
		{
			var xx = cx + 3 + i * 3.4;
			ctx.moveTo( xx, y );
			ctx.bezierCurveTo( xx + 2, y + h * 0.3, xx - 2, y + h * 0.6, xx + 1, y + h );
		}
		ctx.stroke();
	});
	var g = layout == "classic" ? ctx.createLinearGradient( 0, y, 0, y + h ) : ctx.createLinearGradient( x, y, x + w, y + h );
	g.addColorStop( 0, layout == "classic" ? "#1c1c1b" : "#1d1d1c" );
	g.addColorStop( 1, layout == "classic" ? "#121212" : "#141414" );
	ctx.fillStyle = g;
	ctx.fillRect( x + 22, y, w - 44, h );
}

function drawDevicePanel( x, y, w, h, name, subtitle )
{
	drawCasing( x, y, w, h );
	drawScrew( x + 36, y + 12 ); drawScrew( x + w - 36, y + 12 );
	drawScrew( x + 36, y + h - 12 ); drawScrew( x + w - 36, y + h - 12 );

	// name bottom left, styled like the main panel's
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = "bold 20px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( name, x + 44, y + h - 14 );
	var nw = ctx.measureText( name ).width;
	ctx.fillRect( x + 52 + nw, y + h - 32, 1.5, 20 );
	ctx.font = "10px " + FONT;
	ctx.fillText( subtitle[0], x + 60 + nw, y + h - 24 );
	ctx.fillText( subtitle[1], x + 60 + nw, y + h - 13 );
}

function drawDeviceJacks( x, y, w, h, rows )
{
	var px = x + w - 22 - 182;
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( px, y + 10, 170, h - 20, 6 ); ctx.fill();
	rows.forEach(function(row, r){
		var spacing = row.length > 2 ? 50 : 80; // centred on the plate
		row.forEach(function(j, c){
			drawJack( j[2], px + 85 + (c - (row.length - 1) * 0.5) * spacing, y + 50 + r * 58, j[0], j[1] );
		});
	});
	return px;
}

function fmtRate( v ) { return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + " Hz" + (v < 1 ? "  (" + (1 / v).toFixed(1) + " s)" : ""); }
function fmtDb( v ) { return (v > 0 ? "+" : "") + v.toFixed(1) + " dB"; }

// a column of LEDs with labels, used for LFO shapes and the GR meter
function drawLedColumn( x, y, labels, lit, colors )
{
	labels.forEach(function(label, k){
		var ly = y + k * 16;
		drawLed( x, ly, 4, lit(k), colors ? colors(k) : null );
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.font = "10px " + FONT;
		ctx.fillStyle = TEXT_COLOR;
		ctx.fillText( label, x + 9, ly + 1 );
	});
}







// ---------------------------------------------------------------------------
// collapsible devices: a chevron button on the top left corner folds a device (and the others in its row) into a slim bar.
// Its jacks stay on the bar as small sockets so cables keep their ends and can still be patched.

var DEVICE_COLLAPSED_H = 26;
var collapsed = {};
try { collapsed = JSON.parse( localStorage.getItem("SUBHARM_collapsed") || "{}" ) || {}; } catch(err) {}

function deviceH( id, h ) { return collapsed[id] ? DEVICE_COLLAPSED_H : h; }

// devices sharing a row (two half width ones) fold and unfold together
function toggleCollapsed( id )
{
	var state = !collapsed[id];
	collapsed[id] = state;
	rackRows().forEach(function(row){
		if(row.mods.some(function(m){ return m.id == id; }))
			row.mods.forEach(function(m){ collapsed[ m.id ] = state; });
	});
	saveCollapsed();
}

function saveCollapsed()
{
	try { localStorage.setItem( "SUBHARM_collapsed", JSON.stringify( collapsed ) ); } catch(err) {}
}

function collapseButton( id, cx, cy )
{
	var hover = !cable_drag && ui.active === null && hitCircle( cx, cy, 9 );
	if(hover)
	{
		ui.hot = "collapse_" + id;
		tip( collapsed[id] ? "EXPAND" : "COLLAPSE", cx + 30, cy + 2 );
	}
	if(hover && ui.pressed)
	{
		ui.active = "collapse_" + id;
		toggleCollapsed( id );
	}
	ctx.fillStyle = hover ? "#4a4a46" : "#2c2c2a";
	ctx.beginPath(); ctx.arc( cx, cy, 8, 0, Math.PI * 2 ); ctx.fill();
	ctx.strokeStyle = TEXT_COLOR;
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	if(collapsed[id]) { ctx.moveTo( cx - 2, cy - 4 ); ctx.lineTo( cx + 2.5, cy ); ctx.lineTo( cx - 2, cy + 4 ); } // ▸
	else { ctx.moveTo( cx - 4, cy - 2 ); ctx.lineTo( cx, cy + 2.5 ); ctx.lineTo( cx + 4, cy - 2 ); }           // ▾
	ctx.stroke();
}

function drawMiniJack( id, x, y, label, type )
{
	id = id_prefix + id;
	jacks[id] = { x: rackX( x ), y: rackY( y ), type: type, label: label };
	var hover = hitCircle( x, y, 9 );
	if(hover)
		tip( label, x, y - 16 );
	if(cable_drag && cable_drag.from != id && jackCompatible( cable_drag, jacks[id] ))
	{
		ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.3)";
		ctx.lineWidth = 1.5;
		ctx.beginPath(); ctx.arc( x, y, 9, 0, Math.PI * 2 ); ctx.stroke();
	}
	ctx.fillStyle = hover ? "#d8d8d2" : "#9a9a94";
	ctx.beginPath(); ctx.arc( x, y, 6.5, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#000";
	ctx.beginPath(); ctx.arc( x, y, 3.5, 0, Math.PI * 2 ); ctx.fill();
}

// a device folded into a slim bar: name and its jacks as small sockets. Returns the x after the name
function drawCollapsedBar( id, x, y, w, name, jack_rows )
{
	drawCasing( x, y, w, DEVICE_COLLAPSED_H );
	var cy = y + DEVICE_COLLAPSED_H * 0.5;
	collapseButton( id, x + 36, cy );
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.font = "bold 14px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( name, x + 52, cy + 1 );
	var end = x + 52 + ctx.measureText( name ).width;
	var all = [];
	(jack_rows || []).forEach(function(row){ all = all.concat( row.filter(function(j){ return j; }) ); });
	all.forEach(function(j, k){
		drawMiniJack( j[2], x + w - 22 - 20 - (all.length - 1 - k) * 24, cy, j[0], j[1] );
	});
	return end;
}

// draws a device, or its collapsed bar. draw(x, y, w, h) draws the expanded device
function drawDevice( id, x, y, w, h, name, jack_rows, draw )
{
	if(show_rear)
	{
		drawRearDevice( id, x, y, w, h, name );
		return;
	}
	if(collapsed[id])
	{
		drawCollapsedBar( id, x, y, w, name, jack_rows );
		return;
	}
	keyDeviceBegin( id, rackX( x ), rackY( y ), w * frame.k, h * frame.k );
	draw( x, y, w, h );
	keyDeviceEnd();
	collapseButton( id, x + 36, y + 11 );
}

// ---------------------------------------------------------------------------
// modules below the keys: a full width row each, or two half width devices side by side when they
// are next to each other in the rack. Panels are scaled to fit the rack's width

var EMPTY_RACK_H = 60;

// width a module gets in the rack
function slotW( def ) { return def.half ? (PANEL_W - DEVICE_GAP) * 0.5 : PANEL_W; }

// panel size in its own coordinates and the scale that fits it in the rack (m: a device whose size
// depends on its settings, as the custom synths)
function moduleFit( def, m )
{
	var size = def.size( layout, m && m.settings );
	return { w: size[0], h: size[1], k: slotW( def ) / size[0] };
}

function moduleRowH( m )
{
	if(collapsed[ m.id ])
		return DEVICE_COLLAPSED_H;
	var fit = moduleFit( WR.types[ m.type ], m );
	return fit.h * fit.k;
}

// [{ mods: [module] or [left, right], half, h }] in rack order. mods: settings.modules (default) or rack.modules()
function rackRows( mods )
{
	var rows = WR.rows( mods || rack.settings.modules );
	rows.forEach(function(r){ r.h = Math.max.apply( null, r.mods.map( moduleRowH ) ); });
	return rows;
}

function modulesH()
{
	if(!rack.settings.modules.length)
		return EMPTY_RACK_H + KB_GAP;
	return rackRows().reduce(function(h, r){ return h + r.h + KB_GAP; }, 0);
}

// small round button of the rack (move / remove a module). kind: "up", "down", "remove"
function rackButton( id, cx, cy, kind, text, enabled )
{
	var hover = enabled && !cable_drag && ui.active === null && hitCircle( cx, cy, 9 );
	if(hover)
	{
		ui.hot = id;
		tip( text, cx - 12 - text.length * 3.5, cy + 1 );
	}
	var clicked = hover && ui.pressed;
	if(clicked)
		ui.active = id;
	ctx.save();
	ctx.globalAlpha = enabled ? 1 : 0.35;
	ctx.fillStyle = hover ? (kind == "remove" ? "#8a2c24" : "#4a4a46") : "#2c2c2a";
	ctx.beginPath(); ctx.arc( cx, cy, 8, 0, Math.PI * 2 ); ctx.fill();
	ctx.strokeStyle = TEXT_COLOR;
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	if(kind == "up") { ctx.moveTo( cx - 4, cy + 2 ); ctx.lineTo( cx, cy - 2.5 ); ctx.lineTo( cx + 4, cy + 2 ); }
	else if(kind == "down") { ctx.moveTo( cx - 4, cy - 2 ); ctx.lineTo( cx, cy + 2.5 ); ctx.lineTo( cx + 4, cy - 2 ); }
	else if(kind == "skin") { ctx.moveTo( cx + 3.5, cy ); ctx.arc( cx, cy, 3.5, 0, Math.PI * 2 ); ctx.moveTo( cx, cy ); ctx.lineTo( cx + 2.5, cy - 2.5 ); }
	else { ctx.moveTo( cx - 3, cy - 3 ); ctx.lineTo( cx + 3, cy + 3 ); ctx.moveTo( cx + 3, cy - 3 ); ctx.lineTo( cx - 3, cy + 3 ); }
	ctx.stroke();
	ctx.restore();
	return clicked;
}

// move up / move down / remove. pos(k) gives the centre of the k-th button
function moduleButtons( m, index, count, pos )
{
	var p = pos(0);
	if(rackButton( "mod_up_" + m.id, p[0], p[1], "up", "MOVE UP", index > 0 ))
		rack.moveModule( m.id, -1 );
	p = pos(1);
	if(rackButton( "mod_down_" + m.id, p[0], p[1], "down", "MOVE DOWN", index < count - 1 ))
		rack.moveModule( m.id, 1 );
	p = pos(2);
	if(rackButton( "mod_remove_" + m.id, p[0], p[1], "remove", "REMOVE FROM RACK", true ))
		askRemoveModule( m );
}

// on the right cheek, under the move / remove buttons: the device's knob style, click for the next
function skinButton( m, cx, cy )
{
	var ids = WR.KNOB_SKINS, cur = m.settings.knob_skin || "";
	var name = KNOB_SKIN_NAMES[ cur ] + (cur ? "" : " (" + KNOB_SKIN_NAMES[ m.def.knob_skin || (layout == "classic" ? "classic" : "aluminium") ] + ")");
	if(rackButton( "mod_skin_" + m.id, cx, cy, "skin", "KNOBS: " + name, true ))
	{
		m.settings.knob_skin = ids[ (ids.indexOf( cur ) + 1) % ids.length ];
		setStatus( m.def.title + " knobs: " + KNOB_SKIN_NAMES[ m.settings.knob_skin ] );
	}
}

function askRemoveModule( m )
{
	// after this frame: a dialog in the middle of the draw loop would lose the pointer release
	setTimeout(function(){
		ui.down = false;
		ui.active = null;
		var cables = rack.settings.patches.filter(function(p){ return p[0].indexOf( m.id + "." ) == 0 || p[1].indexOf( m.id + "." ) == 0; }).length;
		var thru = WR.audioThru( m.def );
		if(!window.confirm( "Remove " + m.def.title + " (" + m.id + ") from the rack?" + (cables ? " Its " + cables + " cable" + (cables > 1 ? "s" : "") + " will be unplugged" + (thru ? ", and the audio that went through it cabled around it." : ".") : "") ))
			return;
		rack.removeModule( m.id );
		delete collapsed[ m.id ];
		saveCollapsed();
		setStatus( "Removed " + m.def.title + " from the rack" + (thru && cables ? " (audio cabled around it)" : "") );
	}, 0);
}

function drawEmptyRack( w )
{
	drawCasing( 0, 0, w, EMPTY_RACK_H );
	drawLabel( "THE RACK IS EMPTY: INSERT DEVICES WITH \u201cADD DEVICE\u201d IN THE TOOLBAR", w * 0.5, EMPTY_RACK_H * 0.5, 14, false, DIM_COLOR );
}

// draws the modules from y down; returns the height used
function drawModules( y0 )
{
	var mods = rack.modules();
	view.half_rows = [];
	if(!mods.length)
	{
		beginFrame( 0, y0, 1 );
		drawEmptyRack( PANEL_W );
		endFrame();
		return EMPTY_RACK_H + KB_GAP;
	}
	var y = y0;
	rackRows( mods ).forEach(function(row){
		if(row.half)
			view.half_rows.push([ y, y + row.h ]);
		row.mods.forEach(function(m, col){
			var i = mods.indexOf( m );
			var x = col ? (PANEL_W + DEVICE_GAP) * 0.5 : 0, w = slotW( m.def );
			var fit = moduleFit( m.def, m );
			if(show_rear)
			{
				beginFrame( x, y, collapsed[ m.id ] ? 1 : fit.k );
				if(m.def.drawRear && !collapsed[ m.id ]) // a device drawing its own back (the custom synths)
				{
					id_prefix = m.id + ".";
					m.def.drawRear( m, fit.w, fit.h );
					id_prefix = "";
					collapseButton( m.id, 36, 11 );
				}
				else
					drawRearDevice( m.id, 0, 0, collapsed[ m.id ] ? w : fit.w, fit.h, m.def.title );
				endFrame();
			}
			else if(collapsed[ m.id ])
			{
				beginFrame( x, y, 1 );
				id_prefix = m.id + ".";
				var end = drawCollapsedBar( m.id, 0, 0, w, m.def.title, m.def.jacksOf ? m.def.jacksOf( m.settings ) : m.def.jacks );
				id_prefix = "";
				moduleButtons( m, i, mods.length, function(k){ return [ end + 22 + k * 22, DEVICE_COLLAPSED_H * 0.5 ]; } );
				endFrame();
			}
			else
			{
				beginFrame( x, y, fit.k );
				id_prefix = m.id + ".";
				knob_skin = m.settings.knob_skin || m.def.knob_skin || null;
				keyDeviceBegin( m.id, x, y, fit.w * fit.k, fit.h * fit.k );
				casing_wood = !!m.def.wood;
				m.def.draw( m );
				casing_wood = false;
				keyDeviceEnd();
				knob_skin = null;
				id_prefix = "";
				collapseButton( m.id, 36, 11 );
				// on the right wood cheek
				moduleButtons( m, i, mods.length, function(k){ return [ fit.w - 11, 20 + k * 22 ]; } );
				endFrame();
			}
		});
		y += row.h + KB_GAP;
	});
	return y - y0;
}





// ---------------------------------------------------------------------------
// audio I/O device, the thin row at the top: output and input devices, input gain, the audio
// input as IN L / IN R jacks, master volume with level meters. Settings are per browser (rack.io)

var IO_H = 70;

// one line green LCD
function drawLcd( x, y, w, h, text, align )
{
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x - 3, y - 3, w + 6, h + 6, 5 ); ctx.fill();
	ctx.fillStyle = "#16240f";
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 3 ); ctx.fill();
	ctx.font = "bold 13px 'Courier New', monospace";
	ctx.textAlign = align || "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#b6f06a";
	var max = Math.floor( (w - 16) / 8 );
	if(text.length > max)
		text = text.substr( 0, max - 1 ) + "\u2026";
	ctx.fillText( text, align == "center" ? x + w * 0.5 : x + 8, y + h * 0.5 + 1 );
}

function drawIODevice( x, y, w, h )
{
	var io = rack.io, dev = rack.io_devices;
	drawCasing( x, y, w, h );
	drawScrew( x + w - 36, y + 10 ); drawScrew( x + 36, y + h - 10 ); drawScrew( x + w - 36, y + h - 10 );
	var report = function(p){ p.catch(function(err){ setStatus( "Audio I/O: " + err.message ); }); };

	// output device (browsers with AudioContext.setSinkId)
	var lx = x + 60, lw = 230, ly = y + 30;
	drawSection( "OUTPUT", lx, lx + lw, y + 14 );
	var out = !rack.canSelectOutput() ? "DEFAULT (BROWSER)" : rack.deviceLabel( dev.outputs, io.output_id );
	drawLcd( lx, ly, lw, 24, out );
	if(button( "io_out_prev", lx + lw + 10, ly + 1, 28, 22, "\u25c0" ).clicked)
		act(function(){ outputChange( -1 ); });
	if(button( "io_out_next", lx + lw + 42, ly + 1, 28, 22, "\u25b6" ).clicked)
		act(function(){ outputChange( 1 ); });

	// input device: microphone or line in, off until enabled
	var ix = lx + lw + 100;
	drawSection( "INPUT", ix, ix + lw, y + 14 );
	drawLcd( ix, ly, lw, 24, rack.input ? rack.deviceLabel( dev.inputs, io.input_id ) : "INPUT OFF" );
	if(button( "io_in_prev", ix + lw + 10, ly + 1, 28, 22, "\u25c0" ).clicked)
		act(function(){ report( rack.cycleInput( -1 ) ); });
	if(button( "io_in_next", ix + lw + 42, ly + 1, 28, 22, "\u25b6" ).clicked)
		act(function(){ report( rack.cycleInput( 1 ) ); });
	if(button( "io_in_on", ix + lw + 78, ly + 1, 48, 22, "ON", !!rack.input ).clicked)
		act(function(){
			if(rack.input)
				rack.setInput( null );
			else
				report( rack.setInput( io.input_id ).then(function(){ setStatus( "Audio input on: patch IN L / IN R into the synths" ); }) );
		});
	var gx = ix + lw + 170;
	io.input_gain = knob( "io_gain", gx, y + 44, 15, io.input_gain, 0, 1, {
		label: "GAIN", labelSize: 10, def: 0.5, format: function(v){ var g = 4 * v * v; return g > 0 ? (20 * Math.log10( g )).toFixed(1) + " dB" : "-inf dB"; }
	});

	// IN L / IN R jacks
	var px = gx + 34, pw = 2 * 58 + 20;
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( px, y + 6, pw, h - 12, 6 ); ctx.fill();
	WR.IO_JACKS[0].forEach(function(j, c){
		drawJack( j[2], px + 39 + c * 58, y + 46, j[0], j[1] );
	});

	// name, master volume and meters on the right
	var mx = x + w - 22 - 250;
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	ctx.font = "bold 20px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "AUDIO I/O", mx - 40, y + h * 0.5 + 1 );
	io.master = knob( "io_master", mx, y + 42, 18, io.master, 0, 1, {
		label: "MASTER", labelSize: 10, def: 0.8,
		format: function(v){ var g = WRContext.masterGain( v ); return g > 0 ? (20 * Math.log10( g )).toFixed(1) + " dB" : "-inf dB"; }
	});
	var meter = rack.updateMeter();
	var bx = mx + 40, bw = x + w - 22 - 24 - bx;
	["L", "R"].forEach(function(name, c){
		var by = y + 24 + c * 16;
		drawLabel( name, bx - 8, by + 4, 10 );
		ctx.fillStyle = "#050505";
		ctx.fillRect( bx, by, bw, 9 );
		// -48..+3 dB, green / yellow above -12 / red above -3
		var db = meter[c] > 0 ? 20 * Math.log10( meter[c] ) : -100;
		var n = clamp( (db + 48) / 51, 0, 1 );
		var segs = 34;
		for(var i = 0; i < segs; ++i)
		{
			var t = (i + 0.5) / segs, sdb = -48 + t * 51;
			var lit = t <= n;
			ctx.fillStyle = sdb > -3 ? (lit ? "#ff3b2f" : "#3a1512") : (sdb > -12 ? (lit ? "#ffb02f" : "#3a2a10") : (lit ? "#3bd16f" : "#10301a"));
			ctx.fillRect( bx + 1 + i * (bw - 2) / segs, by + 1, (bw - 2) / segs - 1, 7 );
		}
	});
	drawLabel( "-48", bx + 6, y + 60, 8, false, DIM_COLOR );
	drawLabel( "-12", bx + bw * 36 / 51, y + 60, 8, false, DIM_COLOR );
	drawLabel( "0", bx + bw * 48 / 51, y + 60, 8, false, DIM_COLOR );
}

function outputChange( dir )
{
	if(!rack.canSelectOutput())
	{
		setStatus( "This browser can't choose the output device (Chrome and Edge can): it plays on the system default" );
		return;
	}
	rack.refreshDevices().then(function(){
		if(rack.io_devices.outputs.length < 2)
			setStatus( "No other output devices (turn the audio input ON once so the browser lists them by name)" );
		return rack.cycleOutput( dir );
	}).catch(function(err){ setStatus( "Audio output: " + err.message ); });
}

// ---------------------------------------------------------------------------
// rear view (Tab): every device turned around, with its audio sockets (line level). They are patched
// like the front jacks, with the same cable code, but only with each other; an audio input adds up
// every cable plugged into it. The front CV / gate cables are not shown here

var show_rear = false;
var device_names = { io: "AUDIO I/O", keys: "KEYS" };

// [label, "ain" | "aout", jack id] on the back of a device, ids as in the patches
function rearSockets( id )
{
	var m = rack.settings.modules.find(function(m){ return m.id == id; });
	if(m)
	{
		var def = WR.types[ m.type ];
		return ((def.rearJacksOf ? def.rearJacksOf( m.settings ) : def.rear_jacks) || []).map(function(j){ return [ j[0], j[1], WR.jackId( id, j[2] ) ]; });
	}
	return WR.REAR_JACKS[id] || [];
}

// name of the device a jack belongs to, for tooltips and the mixer's channel labels
function jackDevice( id )
{
	var dot = id.indexOf(".");
	if(dot > 0)
	{
		var mid = id.substr( 0, dot );
		var m = rack.settings.modules.find(function(m){ return m.id == mid; });
		var same = m && rack.settings.modules.filter(function(o){ return o.type == m.type; }).length > 1;
		return m ? WR.types[ m.type ].title + (same ? " (" + mid + ")" : "") : mid;
	}
	for(var dev in WR.REAR_JACKS)
		if(WR.REAR_JACKS[dev].some(function(j){ return j[2] == id; }))
			return device_names[dev];
	return "";
}

// what the rear sticker says about the device's audio
function rearNote( id )
{
	switch(id)
	{
		case "io": return "MAIN IN TO THE SPEAKERS \u00b7 INPUT FROM THE INTERFACE";
		case "keys": return "NO AUDIO: NOTES AND CV ON THE FRONT";
	}
	var m = rack.settings.modules.find(function(m){ return m.id == id; });
	var def = m && WR.types[ m.type ];
	if(def && def.rear_note)
		return def.rear_note( m.settings );
	if(def && def.mixer)
		return "LINE INPUTS, AUX SEND / RETURN, STEREO MAIN";
	return "MONO AUDIO OUT, POST VOLUME";
}

// 1/4" socket on the back, registered as a jack so cables can be patched to it
function drawRearSocket( id, x, y, label, type, device, mini )
{
	var r = mini ? 6.5 : 15;
	jacks[id] = { x: rackX( x ), y: rackY( y ), type: type, label: label, device: device };
	var hover = hitCircle( x, y, r + 3 );
	if(!mini)
		drawLabel( label, x, y - 27, 10, type == "aout" );
	if(cable_drag && cable_drag.from != id && jackCompatible( cable_drag, jacks[id] ))
	{
		ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.25)";
		ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( x, y, r + 4, 0, Math.PI * 2 ); ctx.stroke();
	}
	var g = ctx.createLinearGradient( x - r, y - r, x + r, y + r );
	g.addColorStop( 0, hover && !cable_drag ? "#ececE6" : "#d4d4ce" );
	g.addColorStop( 1, "#6d6d68" );
	ctx.fillStyle = g;
	if(type == "midiin" || type == "midiout")
	{
		// 5 pin DIN socket: round shell, black face, pins in an arc and the key notch
		ctx.beginPath(); ctx.arc( x, y, r * 1.05, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = "#0a0a0a";
		ctx.beginPath(); ctx.arc( x, y, r * 0.8, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = "#b8b8b2";
		if(!mini)
			for(var i = 0; i < 5; ++i)
			{
				var a = Math.PI * (0.75 + i * 0.25) + Math.PI * 0.25;
				ctx.beginPath(); ctx.arc( x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, 1.6, 0, Math.PI * 2 ); ctx.fill();
			}
		ctx.fillStyle = "#6d6d68";
		ctx.fillRect( x - r * 0.12, y + r * 0.62, r * 0.24, r * 0.2 );
	}
	else
	{
		ctx.beginPath();
		for(var i = 0; i < 6; ++i)
		{
			var a = Math.PI / 6 + i * Math.PI / 3;
			ctx.lineTo( x + Math.cos(a) * r, y + Math.sin(a) * r );
		}
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = "#2a2a28";
		ctx.beginPath(); ctx.arc( x, y, r * 0.62, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = "#000";
		ctx.beginPath(); ctx.arc( x, y, r * 0.42, 0, Math.PI * 2 ); ctx.fill();
	}
	// hovering says where it goes
	if(hover && !cable_drag)
	{
		var links = rack.settings.patches.filter(function(p){ return p[0] == id || p[1] == id; }).map(function(p){
			var other = p[0] == id ? p[1] : p[0];
			return (p[0] == id ? "\u2192 " : "\u2190 ") + jackDevice( other ) + " " + jackLabel( other );
		});
		tip( device + " " + label + "  " + (links.length ? links.join(", ") : "(not connected)"), x, y - r - 14 );
	}
}

// MIDI channel names: 0 = OMNI (every channel)
function channelName( c ) { return c ? "CH " + c : "OMNI"; }

// under a module's MIDI IN socket: MASTER MIDI (the keys' MIDI without a cable) and the channel it
// listens to (click: next, Shift + click: previous)
function midiInSwitches( module_id, jack, x, y )
{
	var m = rack.settings.modules.find(function(m){ return m.id == module_id; });
	if(!m)
		return;
	var s = m.settings;
	if(s.midi_master)
	{
		// a plug with no wire
		ctx.fillStyle = "#111";
		ctx.beginPath(); ctx.arc( x, y, 9.5, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = CABLE_COLORS[5];
		ctx.beginPath(); ctx.arc( x, y, 7.5, 0, Math.PI * 2 ); ctx.fill();
	}
	var active = (s.midi_master || rack.settings.patches.some(function(p){ return p[1] == jack; })) &&
		rack.midi.access && (performance.now() - rack.midi.activity) < 120;
	drawLed( x + 22, y - 12, 2.5, active, "#3bd16f" );
	if(tinyButton( module_id + ".midi_master", x - 28, y + 19, 56, 13, "MASTER MIDI", s.midi_master,
		s.midi_master ? "CLICK: CABLE INSTEAD" : "CLICK: THE KEYS' MIDI WITHOUT A CABLE" ))
	{
		rack.setMidiMaster( module_id, !s.midi_master );
		setStatus( s.midi_master ? "MASTER MIDI on: the keys' MIDI reaches it without a cable" : "MASTER MIDI off: cable the keys' MIDI OUT into MIDI IN" );
	}
	var ch = channelSelector( module_id + ".midi_channel", x - 28, y + 35, s.midi_channel, true,
		"LISTENS TO " + (s.midi_channel ? "CHANNEL " + s.midi_channel : "EVERY CHANNEL (OMNI)") );
	if(ch != s.midi_channel)
	{
		s.midi_channel = ch;
		rack.allNotesOff();
	}
}

// under the keys' MIDI OUT: the channel of the on-screen and QWERTY keys
function keysChannelSwitch( x, y )
{
	var kb = rack.settings.kb;
	var ch = channelSelector( "kb_channel", x - 28, y + 19, kb.channel, false,
		"THE ON-SCREEN AND QWERTY KEYS PLAY ON CHANNEL " + kb.channel );
	if(ch != kb.channel)
	{
		rack.allNotesOff();
		kb.channel = ch;
	}
}

// 7 segment digits: segments a b c d e f g (top, top right, bottom right, bottom, bottom left, top left, middle)
var SEVEN_SEG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
	"7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "" };

// a red LED 7 segment display: unlit segments faintly visible, slanted like the real ones
function drawSevenSeg( x, y, text, h, color )
{
	var w = h * 0.52, t = Math.max( 1.6, h * 0.13 ), gap = h * 0.22;
	var lit = color || "#ff3b2f", off = "rgba(255,60,40,0.09)";
	ctx.save();
	ctx.translate( x, y );
	ctx.transform( 1, 0, -0.12, 1, 0, 0 ); // slant
	for(var i = 0; i < text.length; ++i)
	{
		var on = SEVEN_SEG[ text[i] ] || "";
		var ox = i * (w + gap), m = h * 0.5;
		// [segment, x, y, horizontal]
		[["a", 0, 0, 1], ["g", 0, m, 1], ["d", 0, h, 1], ["f", 0, 0, 0], ["b", w, 0, 0], ["e", 0, m, 0], ["c", w, m, 0]].forEach(function(sg){
			ctx.fillStyle = on.indexOf( sg[0] ) != -1 ? lit : off;
			var sx = ox + sg[1], sy = sg[2];
			ctx.beginPath();
			if(sg[3]) // horizontal: a long hexagon
			{
				ctx.moveTo( sx + t * 0.6, sy ); ctx.lineTo( sx + t * 1.1, sy - t * 0.5 ); ctx.lineTo( sx + w - t * 1.1, sy - t * 0.5 );
				ctx.lineTo( sx + w - t * 0.6, sy ); ctx.lineTo( sx + w - t * 1.1, sy + t * 0.5 ); ctx.lineTo( sx + t * 1.1, sy + t * 0.5 );
			}
			else
			{
				ctx.moveTo( sx, sy + t * 0.6 ); ctx.lineTo( sx + t * 0.5, sy + t * 1.1 ); ctx.lineTo( sx + t * 0.5, sy + m - t * 1.1 );
				ctx.lineTo( sx, sy + m - t * 0.6 ); ctx.lineTo( sx - t * 0.5, sy + m - t * 1.1 ); ctx.lineTo( sx - t * 0.5, sy + t * 1.1 );
			}
			ctx.closePath();
			ctx.fill();
		});
	}
	ctx.restore();
}

// MIDI channel selector on the back: a 2 digit LED display (-- = OMNI when allowed) with up / down
// buttons; the mouse wheel over the display also changes it. Returns the (new) channel
function channelSelector( id, x, y, value, omni, tooltip )
{
	var min = omni ? 0 : 1, n = 17 - min;
	var step = function(d) { value = min + ((value - min + d) % n + n) % n; };
	// display: dark red glass in a black bezel
	var dw = 34, dh = 17;
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x - 2, y - 2, dw + 4, dh + 4, 3 ); ctx.fill();
	var g = ctx.createLinearGradient( 0, y, 0, y + dh );
	g.addColorStop( 0, "#1c0606" );
	g.addColorStop( 1, "#0d0303" );
	ctx.fillStyle = g;
	ctx.fillRect( x, y, dw, dh );
	drawSevenSeg( x + 11, y + 3.5, value ? (value < 10 ? "0" : "") + value : "--", 10 );
	ctx.fillStyle = "rgba(255,255,255,0.06)"; // glass sheen
	ctx.fillRect( x, y, dw, dh * 0.45 );
	var hover = !cable_drag && ui.active === null && hitRect( x, y, dw, dh );
	if(hover)
	{
		ui.hot = id;
		tip( tooltip + "  (WHEEL OR \u25b2\u25bc)", x + 28, y + dh + 10 );
		if(ui.wheel)
		{
			step( -ui.wheel );
			ui.wheel = 0;
		}
	}
	// up / down rubber buttons on the right
	[[-1, "up", y - 1], [1, "down", y + 9]].forEach(function(b){
		var bx = x + dw + 5, by = b[2], bw = 16, bh = 9;
		var bid = id + "_" + b[1];
		var hb = !cable_drag && ui.active === null && hitRect( bx, by, bw, bh );
		if(hb)
			ui.hot = bid;
		if(hb && ui.pressed)
		{
			ui.active = bid;
			step( -b[0] );
		}
		var held = ui.active === bid && ui.down;
		var gg = ctx.createLinearGradient( 0, by, 0, by + bh );
		gg.addColorStop( 0, hb ? "#5a5a56" : "#4a4a46" );
		gg.addColorStop( 1, "#2a2a28" );
		ctx.fillStyle = "rgba(0,0,0,0.6)";
		ctx.beginPath(); ctx.roundRect( bx, by + 1.5, bw, bh, 2 ); ctx.fill();
		ctx.fillStyle = gg;
		ctx.beginPath(); ctx.roundRect( bx, by + (held ? 1 : 0), bw, bh, 2 ); ctx.fill();
		ctx.fillStyle = "#d8d5ce";
		ctx.beginPath();
		var cx = bx + bw * 0.5, cy = by + bh * 0.5 + (held ? 1 : 0);
		if(b[0] < 0) { ctx.moveTo( cx - 3, cy + 1.5 ); ctx.lineTo( cx + 3, cy + 1.5 ); ctx.lineTo( cx, cy - 2 ); }
		else { ctx.moveTo( cx - 3, cy - 1.5 ); ctx.lineTo( cx + 3, cy - 1.5 ); ctx.lineTo( cx, cy + 2 ); }
		ctx.closePath();
		ctx.fill();
	});
	return value;
}

// label of a jack id that may not be on screen (rear sockets)
function jackLabel( id )
{
	if(jacks[id])
		return jacks[id].label;
	var list = [];
	for(var dev in WR.REAR_JACKS)
		list = list.concat( WR.REAR_JACKS[dev] );
	var dot = id.indexOf("."), local = dot > 0 ? id.substr( dot + 1 ) : id;
	if(dot > 0)
	{
		var m = rack.settings.modules.find(function(m){ return m.id == id.substr( 0, dot ); });
		if(m)
			list = (WR.types[ m.type ].rear_jacks || []);
	}
	var j = list.find(function(j){ return j[2] == local; });
	return j ? j[0] : local;
}

function drawRearDevice( id, x, y, w, h, name )
{
	var sockets = rearSockets( id );
	if(collapsed[id])
	{
		drawCasing( x, y, w, DEVICE_COLLAPSED_H );
		var cy = y + DEVICE_COLLAPSED_H * 0.5;
		ctx.fillStyle = "#2b2c30";
		ctx.fillRect( x + 22, y + 2, w - 44, DEVICE_COLLAPSED_H - 4 );
		collapseButton( id, x + 36, cy );
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.font = "bold 14px " + FONT;
		ctx.fillStyle = TEXT_COLOR;
		ctx.fillText( name + "  (REAR)", x + 52, cy + 1 );
		sockets.forEach(function(sk, k){
			drawRearSocket( sk[2], x + w - 22 - 20 - (sockets.length - 1 - k) * 24, cy, sk[0], sk[1], name, true );
		});
		return;
	}
	drawCasing( x, y, w, h );
	// back plate: brushed dark metal
	var g = ctx.createLinearGradient( 0, y, 0, y + h );
	g.addColorStop( 0, "#37383c" );
	g.addColorStop( 1, "#222326" );
	ctx.fillStyle = g;
	ctx.fillRect( x + 22, y + 2, w - 44, h - 4 );
	ctx.strokeStyle = "rgba(255,255,255,0.06)";
	ctx.lineWidth = 1;
	ctx.strokeRect( x + 26.5, y + 6.5, w - 53, h - 13 );
	drawScrew( x + w - 36, y + 12 ); drawScrew( x + 36, y + h - 12 ); drawScrew( x + w - 36, y + h - 12 );

	// ventilation slots on the left
	var vx = x + 64, vrows = Math.min( 8, Math.floor( (h - 30) / 16 ) );
	var vcols = Math.min( 10, Math.floor( (w * 0.28) / 26 ) );
	var vy = y + (h - vrows * 16) * 0.5 + 3;
	ctx.fillStyle = "#121214";
	for(var r = 0; r < vrows; ++r)
		for(var c = 0; c < vcols; ++c)
		{
			ctx.beginPath(); ctx.roundRect( vx + c * 26, vy + r * 16, 20, 7, 3.5 ); ctx.fill();
		}

	// sticker with the device name and what its audio does, clear of the socket plate
	var spacing = 64, pw = sockets.length * spacing + 16;
	var px = x + w - 22 - 14 - pw;
	var sh = Math.min( 56, h - 18 ), sw = 250;
	var sx = x + Math.max( 64 + vcols * 26 + 30, w * 0.36 ), sy = y + (h - sh) * 0.5;
	if(sockets.length)
		sx = Math.max( x + 40, Math.min( sx, px - sw - 20 ) );
	ctx.fillStyle = "#dcd8cc";
	ctx.beginPath(); ctx.roundRect( sx, sy, sw, sh, 4 ); ctx.fill();
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#1a1a1a";
	ctx.font = "bold " + (sh > 40 ? 18 : 14) + "px " + FONT;
	ctx.fillText( name, sx + 10, sy + (sh > 40 ? 16 : sh * 0.32) );
	ctx.font = "9px " + FONT;
	ctx.fillStyle = "#3a3a38";
	ctx.fillText( rearNote( id ), sx + 10, sy + (sh > 40 ? 34 : sh * 0.72) );
	if(sh > 40)
		ctx.fillText( "WEBRACK \u00b7 " + id.toUpperCase(), sx + 10, sy + 47 );

	// audio sockets on the right
	if(sockets.length)
	{
		// MIDI sockets have their switches under them: a taller plate
		var midi = sockets.some(function(sk){ return sk[1] == "midiin" || sk[1] == "midiout"; });
		var ph = Math.min( h - 12, midi ? 100 : 80 ), py = y + Math.max( 6, (h - ph) * 0.5 );
		var sy = midi ? py + 44 : py + ph * 0.5 + 12;
		ctx.fillStyle = "#18181a";
		ctx.beginPath(); ctx.roundRect( px, py, pw, ph, 6 ); ctx.fill();
		sockets.forEach(function(sk, k){
			var sx = px + 8 + spacing * (k + 0.5);
			drawRearSocket( sk[2], sx, sy, sk[0], sk[1], name );
			if(sk[1] == "midiin")
				midiInSwitches( id, sk[2], sx, sy );
			else if(sk[1] == "midiout" && id == "keys")
				keysChannelSwitch( sx, sy );
		});
	}
	collapseButton( id, x + 36, y + 11 );
}

// ---------------------------------------------------------------------------
// keys device, in a row above the main panel: MIDI input selection, on-screen keyboard,
// computer keyboard (QWERTY), split keyboard, GATE / KEY outputs per zone and a MIDI output

var KB_H = 100, KB_GAP = 10;
var KB_OCTAVES = 3;
var KB_ZONE_COLORS = ["#e2574c", "#f0a43a"];
var kb_mouse_note = null; // note held with the pointer on the on-screen keys
var NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function noteName( n ) { return NOTE_NAMES[ ((n % 12) + 12) % 12 ] + (Math.floor( n / 12 ) - 1); }

function kbNoteOn( note ) { act(function(){ rack.noteOn( note ); }); }
function kbNoteOff( note ) { act(function(){ rack.noteOff( note ); }); }

function drawKeysDevice( x, y, w, h )
{
	var s = rack.settings;
	var kb = s.kb;
	var midi = rack.midi;
	drawCasing( x, y, w, h );
	drawScrew( x + 36, y + 10 ); drawScrew( x + w - 36, y + 10 );
	drawScrew( x + 36, y + h - 10 ); drawScrew( x + w - 36, y + h - 10 );

	// MIDI input: one line LCD with the selected device, held notes when playing
	var lx = x + 44, ly = y + 26, lw = 240, lh = 26;
	drawSection( "MIDI IN", lx, lx + lw, y + 14 );
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( lx - 3, ly - 3, lw + 6, lh + 6, 5 ); ctx.fill();
	ctx.fillStyle = "#16240f";
	ctx.beginPath(); ctx.roundRect( lx, ly, lw, lh, 3 ); ctx.fill();
	var held = Object.keys( rack.keys.held ).map(Number).sort(function(a,b){ return a - b; });
	var text = held.length ? held.slice(-5).map( noteName ).join(" ") : rack.midiInputName();
	ctx.font = "bold 13px 'Courier New', monospace";
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#b6f06a";
	ctx.fillText( text.length > 26 ? text.substr(0, 25) + "\u2026" : text, lx + 8, ly + lh * 0.5 + 1 );
	drawLed( lx + lw - 10, ly + lh * 0.5, 3, midi.access && (performance.now() - midi.activity) < 120, "#3bd16f" );

	var by = y + 62;
	if(button( "midi_prev", lx, by, 36, 22, "\u25c0" ).clicked && midi.access)
		rack.cycleMIDIInput( -1 );
	if(button( "midi_next", lx + 42, by, 36, 22, "\u25b6" ).clicked && midi.access)
		rack.cycleMIDIInput( 1 );
	if(button( "midi_enable", lx + 84, by, 72, 22, midi.access ? "MIDI ON" : "ENABLE", !!midi.access ).clicked && !midi.access)
		rack.initMIDI().then(function(ok){ if(!ok) setStatus( rack.midi.status ); });
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	ctx.font = "bold 20px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "KEYS", lx + lw, by + 12 );

	// keyboard controls: octave on the first row, QWERTY and SPLIT on the second
	var cx = x + 304;
	drawSection( "KEYBOARD", cx, cx + 120, y + 14 );
	if(button( "kb_oct_down", cx, y + 26, 56, 22, "OCT -" ).clicked)
		setKbOctave( kb.octave - 1 );
	if(button( "kb_oct_up", cx + 64, y + 26, 56, 22, "OCT +" ).clicked)
		setKbOctave( kb.octave + 1 );
	if(button( "kb_qwerty", cx, y + 56, 56, 22, "QWERTY", piano.enabled ).clicked)
		setPiano( !piano.enabled );
	if(button( "kb_split", cx + 64, y + 56, 56, 22, "SPLIT", kb.split ).clicked)
	{
		rack.allNotesOff();
		kb.split = !kb.split;
	}
	var first = 48 + kb.octave * 12;
	drawLabel( noteName( first ) + "\u2013" + noteName( first + KB_OCTAVES * 12 ) + (kb.split ? "  SPLIT " + noteName( kb.split_note ) : ""),
		cx + 60, y + 89, 10, false, DIM_COLOR );

	// outputs
	var njacks = WR.KB_JACKS[0].length;
	var pw = njacks * 58 + 24, px = x + w - 22 - 10 - pw;
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( px, y + 8, pw, h - 16, 6 ); ctx.fill();
	WR.KB_JACKS[0].forEach(function(j, c){
		var jx = px + 41 + c * 58, jy = y + 58;
		drawJack( j[2], jx, jy, j[0], j[1] );
		if(c < 4 && kb.split) // zone colour under the jack
		{
			ctx.fillStyle = KB_ZONE_COLORS[ c < 2 ? 0 : 1 ];
			ctx.fillRect( jx - 12, jy + 17, 24, 3 );
		}
	});

	drawKeyboard( cx + 136, y + 22, px - 14 - (cx + 136), h - 30 );
}

function setKbOctave( octave )
{
	var kb = rack.settings.kb;
	octave = clamp( octave, -2, 2 );
	if(octave == kb.octave)
		return;
	if(kb_mouse_note !== null)
	{
		kbNoteOff( kb_mouse_note );
		kb_mouse_note = null;
	}
	kb.octave = octave;
}

function drawKeyboard( x, y, w, h )
{
	var kb = rack.settings.kb;
	var first = 48 + kb.octave * 12;
	var WHITE = [0, 2, 4, 5, 7, 9, 11];
	var whites = KB_OCTAVES * 7 + 1;
	var ww = w / whites;
	var keys = [];
	for(var i = 0; i < whites; ++i)
		keys.push({ note: first + Math.floor( i / 7 ) * 12 + WHITE[ i % 7 ], x: x + i * ww, y: y, w: ww, h: h, black: false });
	var blacks = [];
	for(var i = 0; i < whites - 1; ++i)
		if(i % 7 != 2 && i % 7 != 6) // no black key after E and B
			blacks.push({ note: keys[i].note + 1, x: x + (i + 1) * ww - ww * 0.3, y: y, w: ww * 0.6, h: h * 0.62, black: true });

	var keyAt = function( px, py ) {
		if(px < x || px > x + w || py < y || py > y + h)
			return null;
		for(var i = 0; i < blacks.length; ++i)
			if(px >= blacks[i].x && px <= blacks[i].x + blacks[i].w && py <= blacks[i].y + blacks[i].h)
				return blacks[i].note;
		var i = clamp( Math.floor( (px - x) / ww ), 0, whites - 1 );
		return keys[i].note;
	};
	// x position of the split marker: left edge of the split note's key
	var splitX = function( note ) {
		var all = keys.concat( blacks );
		for(var i = 0; i < all.length; ++i)
			if(all[i].note == note)
				return all[i].black ? all[i].x + all[i].w * 0.5 : all[i].x;
		return note < first ? x : x + w;
	};

	// split marker drag
	var sx = splitX( kb.split_note );
	var onHandle = kb.split && !cable_drag && ui.x > sx - 9 && ui.x < sx + 9 && ui.y > y - 12 && ui.y < y + 6;
	if(onHandle)
		ui.hot = "kb_split_handle";
	if(onHandle && ui.pressed && ui.active === null)
		ui.active = "kb_split_handle";
	if(ui.active === "kb_split_handle" && ui.down)
	{
		var n = keyAt( clamp( ui.x, x + 1, x + w - 1 ), y + h - 2 );
		if(n !== null && n != kb.split_note)
		{
			rack.allNotesOff();
			kb_mouse_note = null;
			kb.split_note = n;
		}
		tip( "SPLIT AT " + noteName( kb.split_note ), sx, y - 22 );
	}

	// playing with the pointer, sliding across keys glides between notes
	var hover = !cable_drag && ui.active !== "kb_split_handle" && hitRect( x, y, w, h );
	if(hover)
		ui.hot = "kb_keys";
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = "kb_keys";
		kb_mouse_note = keyAt( ui.x, ui.y );
		if(kb_mouse_note !== null)
			kbNoteOn( kb_mouse_note );
	}
	if(ui.active === "kb_keys" && ui.down)
	{
		var n = keyAt( ui.x, ui.y );
		if(n !== kb_mouse_note)
		{
			if(kb_mouse_note !== null) kbNoteOff( kb_mouse_note );
			kb_mouse_note = n;
			if(n !== null) kbNoteOn( n );
		}
	}
	else if(kb_mouse_note !== null)
	{
		kbNoteOff( kb_mouse_note );
		kb_mouse_note = null;
	}

	var held = rack.keys.held;
	var zoneColor = function( note ) { return KB_ZONE_COLORS[ kb.split && note >= kb.split_note ? 1 : 0 ]; };
	ctx.fillStyle = "#050505";
	ctx.fillRect( x - 2, y - 2, w + 4, h + 4 );
	keys.forEach(function(k){
		ctx.fillStyle = held[ k.note ] !== undefined ? zoneColor( k.note ) : "#e9e6de";
		ctx.fillRect( k.x + 0.5, k.y, k.w - 1, k.h );
	});
	blacks.forEach(function(k){
		ctx.fillStyle = held[ k.note ] !== undefined ? zoneColor( k.note ) : "#1a1a19";
		ctx.fillRect( k.x, k.y, k.w, k.h );
	});

	// zone bars above the keys and the split handle
	if(kb.split)
	{
		ctx.fillStyle = KB_ZONE_COLORS[0];
		ctx.fillRect( x, y - 6, clamp( sx, x, x + w ) - x, 3 );
		ctx.fillStyle = KB_ZONE_COLORS[1];
		ctx.fillRect( clamp( sx, x, x + w ), y - 6, x + w - clamp( sx, x, x + w ), 3 );
		if(sx >= x && sx <= x + w)
		{
			ctx.strokeStyle = "rgba(255,255,255,0.7)";
			ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.moveTo( sx, y ); ctx.lineTo( sx, y + h ); ctx.stroke();
			ctx.fillStyle = onHandle || ui.active === "kb_split_handle" ? "#ffffff" : "#d8d5ce";
			ctx.beginPath(); ctx.moveTo( sx - 6, y - 12 ); ctx.lineTo( sx + 6, y - 12 ); ctx.lineTo( sx, y - 2 ); ctx.closePath(); ctx.fill();
		}
	}
}


function drawTooltips()
{
	tooltips.forEach(function(t){
		ctx.font = "12px " + FONT;
		var w = ctx.measureText( t[0] ).width + 12;
		ctx.fillStyle = "rgba(240,236,228,0.95)";
		ctx.beginPath(); ctx.roundRect( t[1] - w * 0.5, t[2] - 9, w, 18, 4 ); ctx.fill();
		ctx.fillStyle = "#111";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText( t[0], t[1], t[2] + 1 );
	});
	tooltips.length = 0;
}

function draw()
{
	if(PREVIEW_TYPE)
		return drawPreview();
	var w = canvas.clientWidth, h = canvas.clientHeight;
	var dpr = window.devicePixelRatio || 1;
	if(canvas.width != Math.round( w * dpr ) || canvas.height != Math.round( h * dpr ))
	{
		canvas.width = Math.round( w * dpr );
		canvas.height = Math.round( h * dpr );
	}
	view.dpr = dpr;
	updatePanelHeight();
	// scale from the width alone (minus the vertical scrollbar when there is one)
	view.scale = w / PANEL_W * view.zoom;
	if(PANEL_H * view.scale > h)
		view.scale = (w - SCROLLBAR_W) / PANEL_W * view.zoom;
	var vw = w - (PANEL_H * view.scale > h ? SCROLLBAR_W : 0);
	var vh = h - (PANEL_W * view.scale > vw + 0.5 ? SCROLLBAR_W : 0);
	view.vw = vw;
	view.vh = vh;
	view.max_sx = Math.max( 0, PANEL_W * view.scale - vw );
	view.max_sy = Math.max( 0, PANEL_H * view.scale - vh );
	// dragging a cable near an edge scrolls
	if(cable_drag && ui.cx !== undefined)
		setScroll( view.sx + (ui.cx < 40 ? -12 : (ui.cx > vw - 40 ? 12 : 0)), view.sy + (ui.cy < 40 ? -12 : (ui.cy > vh - 40 ? 12 : 0)) );
	setScroll( view.sx, view.sy );
	view.ox = view.max_sx ? -view.sx : (vw - PANEL_W * view.scale) * 0.5;
	view.oy = view.max_sy ? -view.sy : 0;
	if(ui.cx !== undefined)
	{
		ui.x = ui.px = (ui.cx - view.ox) / view.scale;
		ui.y = ui.py = (ui.cy - view.oy) / view.scale;
	}

	ctx.setTransform( 1, 0, 0, 1, 0, 0 );
	ctx.fillStyle = "#0b0b0b";
	ctx.fillRect( 0, 0, canvas.width, canvas.height );
	ctx.setTransform( dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy );
	drawRackRails();

	ui.hot = null;
	jacks = {}; // filled again by every row as it draws its jacks
	beginFrame( 0, 0, 1 );
	drawDevice( "io", 0, 0, PANEL_W, IO_H, "AUDIO I/O", WR.IO_JACKS, drawIODevice );
	endFrame();
	var y = deviceH( "io", IO_H ) + KB_GAP;
	beginFrame( 0, y, 1 );
	drawDevice( "keys", 0, 0, PANEL_W, KB_H, "KEYS", WR.KB_JACKS, drawKeysDevice );
	endFrame();
	y += deviceH( "keys", KB_H ) + KB_GAP;
	y += drawModules( y );
	updateCables(); // front or rear: only the jacks of the side shown are registered
	drawCables();
	drawControlJacks();
	hover_control = null;
	drawKeyOverlay();
	// MIDI learn: the control clicked waits for its MIDI
	if(midictl.learn && ui.pressed && ui.active && midictl.kind[ ui.active ])
	{
		midictl.target = ui.active;
		setStatus( "MIDI learn: " + controlName( ui.active ) + " \u2014 now move a controller or press a key / pad", true );
	}
	drawMidiLearn();
	keyFrameEnd( (vw * 0.5 - view.ox) / view.scale, (vh * 0.5 - view.oy) / view.scale );
	drawTooltips();
	drawScrollbars( w, h );
	updatePan();
	// wheel steps no knob took scroll the rack (shift + wheel sideways)
	if(ui.wheel && ui.shift && view.max_sx)
		setScroll( view.sx + ui.wheel * 90, view.sy );
	else if(ui.wheel || ui.wheel_x)
		setScroll( view.sx + ui.wheel_x * 90, view.sy + ui.wheel * 90 );

	var grab = ui.active === "pan" ? "grabbing" : (ui.active === null && onRackSide( ui.px, ui.py ) && (view.max_sx || view.max_sy) ? "grab" : null);
	canvas.style.cursor = cable_drag ? "grabbing" : (grab || (ui.hot || jackAt( ui.x, ui.y ) ? "pointer" : "default"));
}

// ---------------------------------------------------------------------------
// a knob (or fader) under the mouse lights the sockets that modulate it: by name (cutoff ->
// cutoff_in, vco1_freq -> vco1_cv / vco1_pitch / vco1_in, resonance -> res_in, ...), or the device's
// knob_jacks table [[knob regex, [jack ids]], ...]
var hover_control = null;
var JACK_ALIASES = { resonance: ["res"], volume: ["vca"], level: ["vca", "level"] };
function controlJacks( device, kid, ids )
{
	var m = rack.settings.modules.find(function(o){ return o.id == device; });
	var def = m ? WR.types[ m.type ] : null;
	var table = (def && def.knob_jacks) || [];
	for(var i = 0; i < table.length; ++i)
	{
		var mm = new RegExp( table[i][0] ).exec( kid );
		if(mm)
			return (typeof table[i][1] == "function" ? table[i][1]( mm ) : table[i][1]).filter(function(j){ return ids.indexOf( j ) >= 0; });
	}
	var names = [ kid ], plain = kid.replace( /\d+$/, "" );
	if(plain != kid && plain.length > 2) names.push( plain );
	(JACK_ALIASES[ kid ] || []).forEach(function(a){ names.push( a ); });
	var out = ids.filter(function(j){
		return names.some(function(n){ return j == n || j == n + "_in" || j == n + "_cv" || j == n + "_ctrl" || j == n + "_mod"; });
	});
	var base = kid.replace( /_?freq$/, "" );
	if(base != kid) // a frequency: the pitch inputs
		ids.forEach(function(j){ if((j == base + "_cv" || j == base + "_pitch" || j == base + "_in") && out.indexOf( j ) < 0) out.push( j ); });
	return out;
}
function drawControlJacks()
{
	var id = hover_control;
	if(!id || show_rear || cable_drag)
		return;
	var dot = id.indexOf( "." );
	if(dot < 0)
		return;
	var device = id.substr( 0, dot ), kid = id.substr( dot + 1 ), prefix = device + ".";
	var ids = Object.keys( jacks ).filter(function(j){ return j.indexOf( prefix ) == 0; }).map(function(j){ return j.substr( prefix.length ); });
	var t = (performance.now() % 1000) / 1000;
	controlJacks( device, kid, ids ).forEach(function(j){
		var p = jacks[ prefix + j ];
		ctx.strokeStyle = "rgba(255,214,90," + (0.55 + 0.45 * Math.sin( t * Math.PI * 2 )) + ")";
		ctx.lineWidth = 3;
		ctx.beginPath(); ctx.arc( p.x, p.y, 17, 0, Math.PI * 2 ); ctx.stroke();
		ctx.fillStyle = "rgba(255,214,90,0.18)";
		ctx.beginPath(); ctx.arc( p.x, p.y, 17, 0, Math.PI * 2 ); ctx.fill();
	});
}

// the rack behind the devices: the two rails with their holes, the whole height
function drawRackRails()
{
	var h = PANEL_H, y0 = Math.max( 0, -view.oy / view.scale - 20 ), y1 = Math.min( h, y0 + view.vh / view.scale + 40 );
	ctx.fillStyle = "#070707";
	ctx.fillRect( 0, 0, PANEL_W, h );
	[0, PANEL_W - 22].forEach(function(x){
		var g = ctx.createLinearGradient( x, 0, x + 22, 0 );
		g.addColorStop( 0, "#3a3b3e" ); g.addColorStop( 0.5, "#57585c" ); g.addColorStop( 1, "#2e2f32" );
		ctx.fillStyle = g;
		ctx.fillRect( x, 0, 22, h );
		ctx.fillStyle = "#0a0a0a";
		// rack holes: three to a unit (44.45 mm here 26 px), only where they show
		for(var u = Math.floor( y0 / 26 ) * 26; u < y1; u += 26)
			[3, 13, 22].forEach(function(o){ ctx.beginPath(); ctx.roundRect( x + 7, u + o, 8, 4, 2 ); ctx.fill(); });
	});
}

// the wood cheeks on the sides of every row (and the middle ones of the two device rows), or
// outside the rack: dragging there scrolls the rack
function onRackSide( x, y )
{
	var cheek = 22;
	if(x < cheek || x > PANEL_W - cheek || y < 0 || y > PANEL_H)
		return true;
	var half = (PANEL_W - DEVICE_GAP) * 0.5;
	return x > half - cheek && x < half + DEVICE_GAP + cheek && (view.half_rows || []).some(function(r){ return y >= r[0] && y <= r[1]; });
}

// after the widgets had their chance: a press nothing took, on the sides, grabs the rack
function updatePan()
{
	if(ui.pressed && ui.active === null && !cable_drag && !jackAt( ui.px, ui.py ) && onRackSide( ui.px, ui.py ))
	{
		ui.active = "pan";
		view.pan = { cx: ui.cx, cy: ui.cy, sx: view.sx, sy: view.sy };
	}
	if(ui.active === "pan" && ui.down && view.pan)
		setScroll( view.pan.sx - (ui.cx - view.pan.cx), view.pan.sy - (ui.cy - view.pan.cy) );
}

function drawScrollbars( w, h )
{
	ctx.setTransform( view.dpr, 0, 0, view.dpr, 0, 0 );
	var vw = view.vw, vh = view.vh;
	if(view.max_sy)
	{
		var th = Math.max( 30, vh * vh / (view.max_sy + vh) ), ty = (view.sy / view.max_sy) * (vh - th);
		ctx.fillStyle = "#151514";
		ctx.fillRect( w - SCROLLBAR_W, 0, SCROLLBAR_W, h );
		ctx.fillStyle = view.drag && view.drag.axis == "y" ? "#77756f" : "#4a4945";
		ctx.beginPath(); ctx.roundRect( w - SCROLLBAR_W + 2, ty + 2, SCROLLBAR_W - 4, th - 4, 4 ); ctx.fill();
	}
	if(view.max_sx)
	{
		var tw = Math.max( 30, vw * vw / (view.max_sx + vw) ), tx = (view.sx / view.max_sx) * (vw - tw);
		ctx.fillStyle = "#151514";
		ctx.fillRect( 0, h - SCROLLBAR_W, vw, SCROLLBAR_W );
		ctx.fillStyle = view.drag && view.drag.axis == "x" ? "#77756f" : "#4a4945";
		ctx.beginPath(); ctx.roundRect( tx + 2, h - SCROLLBAR_W + 2, tw - 4, SCROLLBAR_W - 4, 4 ); ctx.fill();
	}
}

// zoom from the toolbar, keeping the middle of the window in place
function setZoom( z )
{
	z = clamp( z, ZOOM_MIN, ZOOM_MAX );
	if(Math.abs( z - 1 ) < 0.02)
		z = 1;
	var ratio = z / view.zoom;
	var w = canvas.clientWidth, h = canvas.clientHeight;
	view.zoom = z;
	view.max_sx = view.max_sy = Infinity; // the next draw clamps the scroll
	setScroll( (view.sx + w * 0.5) * ratio - w * 0.5, (view.sy + h * 0.5) * ratio - h * 0.5 );
	$("zoom-reset").textContent = Math.round( z * 100 ) + "%";
	try { localStorage.setItem( "SUBHARM_zoom", String( z ) ); } catch(err) {}
}

function loop()
{
	requestAnimationFrame( loop );
	draw();
	rack.sync();
	updateToolbarFrame();

	ui.pressed = ui.released = ui.rpressed = ui.dbl = false;
	ui.wheel = ui.wheel_x = 0;
	ui.wheel_ctrl = false;
	if(!ui.down && ui.active !== null)
		ui.active = null;
}

// ---------------------------------------------------------------------------
// keyboard

function isTextField( el )
{
	return el && el.closest && !!el.closest("input:not([type=range]),select,textarea");
}

// computer keyboard as a piano (QWERTY button on the keys device), by physical key position:
// home row = white keys starting at C, row above = black keys, Z / X = octave down / up
var PIANO_KEYS = {
	KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
	KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17
};
var piano = { enabled: false, down: {} }; // down: key code -> MIDI note

function pianoNoteOff( code )
{
	var note = piano.down[ code ];
	if(note === undefined)
		return;
	delete piano.down[ code ];
	kbNoteOff( note );
}

function pianoAllOff()
{
	Object.keys( piano.down ).forEach( pianoNoteOff );
}

function setPiano( enabled )
{
	pianoAllOff();
	piano.enabled = enabled;
	setStatus( enabled ? "Keyboard piano on: A-' white keys, W E T Y U O P black keys, Z / X octave" : "Keyboard piano off" );
}

window.addEventListener("keydown", function(e){
	if(isTextField( e.target ) || e.ctrlKey || e.metaKey || e.altKey)
		return;
	// a focused toolbar button would otherwise swallow Space as a click
	if(e.target.closest && e.target.closest("button,input"))
		e.target.blur();
	if(piano.enabled && (e.code in PIANO_KEYS || e.code == "KeyZ" || e.code == "KeyX"))
	{
		e.preventDefault();
		if(e.repeat || piano.down[ e.code ] !== undefined)
			return;
		if(e.code == "KeyZ" || e.code == "KeyX")
		{
			pianoAllOff();
			setKbOctave( rack.settings.kb.octave + (e.code == "KeyX" ? 1 : -1) );
			return;
		}
		var note = 60 + rack.settings.kb.octave * 12 + PIANO_KEYS[ e.code ];
		piano.down[ e.code ] = note;
		kbNoteOn( note );
		return;
	}
	if(e.repeat)
	{
		if(e.code == "Space")
			e.preventDefault();
		return;
	}
	if(e.code == "Tab" && !e.shiftKey)
	{
		e.preventDefault();
		setRear( !show_rear );
		return;
	}
	if(e.code == "Space")
	{
		act(function(){ rack.transport( "play" ); });
		e.preventDefault();
		return;
	}
	// the buttons of the device in the middle of the screen
	if(keyDown( e.code ))
	{
		act(function(){});
		e.preventDefault();
	}
});
window.addEventListener("keyup", function(e){
	if(e.code == "Space" && !isTextField( e.target ))
		e.preventDefault();
	if(piano.down[ e.code ] !== undefined)
		pianoNoteOff( e.code );
	else
		keyUp( e.code );
	if(e.key == "Shift")
		keyctl.overlay = false;
});
// SHIFT shows the keys on the buttons (not while typing)
window.addEventListener("keydown", function(e){
	if(e.key == "Shift" && !isTextField( e.target ))
		keyctl.overlay = true;
});
// keys released while the window is not focused never send keyup
window.addEventListener("blur", function(){ pianoAllOff(); keyReleaseAll(); keyctl.overlay = false; });

// ---------------------------------------------------------------------------
// toolbar

var $ = function(id){ return document.getElementById(id); };
var status_timer = null;

function setStatus( text, sticky )
{
	$("status").textContent = text;
	clearTimeout( status_timer );
	if(!sticky)
		status_timer = setTimeout(function(){ $("status").textContent = ""; }, 3000);
}

function updateToolbar()
{
	var running = rack.context && rack.context.state == "running";
	$("power").textContent = running ? "Audio on" : "Audio off";
	$("power").classList.toggle( "on", !!running );
}

function updateToolbarFrame()
{
	rack.updateIO();
}

// front / rear of the rack (Tab)
function setRear( rear )
{
	show_rear = rear;
	cable_drag = null;
	$("rear").textContent = rear ? "Front (Tab)" : "Rear (Tab)";
	$("rear").classList.toggle( "on", rear );
	setStatus( rear ? "Rear view: the audio connections between the devices (Tab for the front)" : "Front view" );
}
$("rear").addEventListener("click", function(e){ setRear( !show_rear ); e.target.blur(); });

$("power").addEventListener("click", function(){
	if(!rack.context)
		ensureAudio();
	else if(rack.context.state == "running")
		rack.context.suspend().then( updateToolbar );
	else
		rack.context.resume().then( updateToolbar );
});
function updatePanelHeight()
{
	PANEL_H = deviceH( "io", IO_H ) + KB_GAP + deviceH( "keys", KB_H ) + KB_GAP + modulesH() - KB_GAP;
	if(show_rear)
		PANEL_H += 50; // room for the rear cables hanging below the bottom row
	if(!PREVIEW_TYPE && canvas.clientHeight) // half a screen of empty rack after the last device
		PANEL_H += canvas.clientHeight * 0.5 / (view.scale || 1);
}

function setLayout( name )
{
	layout = name;
	PANEL_W = LAYOUTS[name].w;
	updatePanelHeight();
	jacks = {};
	cable_drag = null;
	document.querySelectorAll('input[name="opt-layout"]').forEach(function(r){ r.checked = r.value == name; });
	try { localStorage.setItem( "SUBHARM_layout", name ); } catch(err) {}
}
setLayout( layout );

function setShowWires( show )
{
	show_wires = show;
	$("opt-wires").checked = show;
	try { localStorage.setItem( "SUBHARM_wires", show ? "shown" : "hidden" ); } catch(err) {}
}
setShowWires( show_wires );
$("opt-wires").addEventListener("change", function(e){ setShowWires( e.target.checked ); });

function setWheelKnobs( on )
{
	wheel_knobs = on;
	$("opt-wheel").checked = on;
	try { localStorage.setItem( "SUBHARM_wheel", on ? "knobs" : "scroll" ); } catch(err) {}
}
setWheelKnobs( wheel_knobs );
$("opt-wheel").addEventListener("change", function(e){ setWheelKnobs( e.target.checked ); });

// the Options panel opens under its button and closes on a click anywhere else
$("options").addEventListener("click", function(e){
	$("options-panel").hidden = !$("options-panel").hidden;
	if($("sessions-panel")) $("sessions-panel").hidden = true;
	if(!$("add-panel").hidden) closeAddPanel();
	e.stopPropagation();
});
$("options-panel").addEventListener("click", function(e){ e.stopPropagation(); });
document.addEventListener("click", function(){ $("options-panel").hidden = true; });
canvas.addEventListener("pointerdown", function(){ $("options-panel").hidden = true; });

$("zoom-out").addEventListener("click", function(){ setZoom( view.zoom / ZOOM_STEP ); });
$("zoom-in").addEventListener("click", function(){ setZoom( view.zoom * ZOOM_STEP ); });
$("zoom-reset").addEventListener("click", function(){ setZoom( 1 ); });
$("zoom-reset").textContent = Math.round( view.zoom * 100 ) + "%";

document.querySelectorAll('input[name="opt-layout"]').forEach(function(r){
	r.addEventListener("change", function(){ if(r.checked) setLayout( r.value ); });
});

// patches: factory ones from data/patches.json plus the user's, saved in this browser
var factory_patches = [];

function refreshPatchList( selected )
{
	var sel = $("patch-select");
	var esc = function(t){ return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); };
	var html = '<option value="" disabled>Choose a patch\u2026</option>';
	// factory patches grouped by their "group" (the synths in the rack)
	var groups = [];
	factory_patches.forEach(function(p){ if(groups.indexOf( p.group ) == -1) groups.push( p.group ); });
	groups.forEach(function(g){
		html += '<optgroup label="' + esc(g) + '">';
		factory_patches.forEach(function(p, i){ if(p.group == g) html += '<option value="f:' + i + '">' + esc(p.name) + '</option>'; });
		html += '</optgroup>';
	});
	var user = Object.keys( rack.getUserPatches() ).sort();
	if(user.length)
	{
		html += '<optgroup label="My patches">';
		user.forEach(function(name){ html += '<option value="u:' + esc(name) + '">' + esc(name) + '</option>'; });
		html += '</optgroup>';
	}
	sel.innerHTML = html;
	sel.value = selected || "";
	if(sel.value != (selected || ""))
		sel.value = "";
	$("patch-delete").hidden = sel.value.substr(0, 2) != "u:";
}

function currentPatchName()
{
	var v = $("patch-select").value;
	if(v.substr(0, 2) == "u:")
		return v.substr(2);
	if(v.substr(0, 2) == "f:" && factory_patches[ v.substr(2) ])
		return factory_patches[ v.substr(2) ].name;
	return "";
}

function afterPatchLoad( name )
{
	pianoAllOff();
	syncScaleInput();
	setStatus( "Loaded patch: " + name );
}

fetch("data/patches.json")
	.then(function(r){ return r.json(); })
	.then(function(list){
		factory_patches = list;
		list.forEach(function(p){ p.group = p.group || "Factory"; });
		refreshPatchList();
	})
	.catch(function(){ refreshPatchList(); });

$("patch-select").addEventListener("change", function(e){
	var v = e.target.value;
	if(v.substr(0, 2) == "f:")
	{
		var p = factory_patches[ v.substr(2) ];
		rack.setSettings( p.settings );
		afterPatchLoad( p.name );
		gfTrack( "load-patch", { patch: p.name, group: p.group || "" } );
	}
	else if(v.substr(0, 2) == "u:")
	{
		var name = v.substr(2);
		rack.setSettings( rack.getUserPatches()[ name ] );
		afterPatchLoad( name );
		gfTrack( "load-patch", { patch: "(user patch)" } ); // their own names stay private
	}
	$("patch-delete").hidden = v.substr(0, 2) != "u:";
	e.target.blur();
});

$("randomize").addEventListener("click", function(){
	rack.randomize();
	refreshPatchList();
	setStatus( "Random sound on every synth in the rack (Save as\u2026 to keep it)" );
});

// ---------------------------------------------------------------------------
// ADD DEVICE: a panel with every device by category: its preview (previews/<type>.jpg, made by
// tools/make-previews.sh), name, description and what it is; a search box. A click adds it

var DEVICE_CATEGORIES = ["Synths", "Modulation", "Mixing", "Effects", "Utility"];

function addDevice( type )
{
	var def = WR.types[ type ];
	if(!def)
		return null;
	var m = rack.addModule( type );
	if(m) gfTrack( "add-device", { device: def.title } );
	if(!m)
	{
		setStatus( "The rack can't hold more than " + def.max + " " + def.title + " devices" );
		return null;
	}
	var how = def.midi_in ? ", MIDI cabled from the keys" : "";
	if(def.mixer)
		how = ": the synths' audio now goes through it (Tab shows the cables)";
	else if(def.insert)
		how = ": inserted before the speakers";
	else if(def.rear_jacks && !def.audio_out)
		how = ": patch its audio on the back (Tab)";
	setStatus( "Added " + def.title + " (" + m.id + ") at the bottom of the rack" + how );
	// show it: scroll to the bottom
	view.sy = 1e9;
	if(def.onAdd) def.onAdd( m );
	return m;
}

function escHtml( t ) { return String( t ).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

function renderAddPanel()
{
	var cats = DEVICE_CATEGORIES.slice();
	WR.order.forEach(function(type){
		var c = WR.types[ type ].category || "Synths";
		if(cats.indexOf( c ) == -1) cats.push( c );
	});
	var html = '<div class="add-head"><input id="add-search" type="search" placeholder="Search devices\u2026" autocomplete="off" />' +
		'<span class="add-hint">Click a device to add it at the bottom of the rack</span></div>';
	cats.forEach(function(c){
		var types = WR.order.filter(function(type){ return (WR.types[ type ].category || "Synths") == c && !WR.types[ type ].hidden; });
		if(!types.length)
			return;
		html += '<div class="add-cat" data-cat="' + escHtml( c ) + '"><h3>' + escHtml( c ) + '</h3><div class="add-grid">';
		types.forEach(function(type){
			var def = WR.types[ type ], n = rack.settings.modules.filter(function(m){ return m.type == type; }).length;
			var desc = def.description.replace( new RegExp( "^" + def.title + ":\\s*", "i" ), "" );
			var tags = [ def.half ? "HALF WIDTH" : "FULL WIDTH" ];
			if(def.midi_in) tags.push( "MIDI" );
			if(def.insert) tags.push( "INSERT FX" );
			if(n) tags.push( n + " IN THE RACK" );
			html += '<button class="add-card" data-type="' + type + '" data-search="' + escHtml( (def.title + " " + def.description + " " + (def.about || "") + " " + c).toLowerCase() ) + '">' +
				'<div class="add-img' + (def.half ? " half" : "") + '"><img loading="lazy" src="previews/' + type + '.jpg?v=' + WR.VERSION + '" alt="" onerror="this.parentNode.classList.add(\'missing\')" />' +
				'<span class="add-ph">' + escHtml( def.title ) + '</span></div>' +
				'<div class="add-text"><div class="add-title">' + escHtml( def.title ) + '</div>' +
				'<div class="add-desc">' + escHtml( desc ) + '</div>' +
				(def.about ? '<div class="add-about">' + escHtml( def.about ) + '</div>' : '') +
				'<div class="add-tags">' + tags.map(function(t){ return '<span>' + t + '</span>'; }).join("") + '</div></div></button>';
		});
		// more cards for the category (the Synth Editor's saved synths): WR.addPanelCards( category ) -> HTML
		if(WR.addPanelCards) html += WR.addPanelCards( c );
		html += '</div></div>';
	});
	$("add-panel").innerHTML = html;
	$("add-search").addEventListener("input", filterAddPanel);
	$("add-search").addEventListener("keydown", function(e){
		if(e.key == "Enter") { var first = document.querySelector( ".add-card:not([hidden])" ); if(first) first.click(); }
		if(e.key == "Escape") closeAddPanel();
		e.stopPropagation();
	});
}

function filterAddPanel()
{
	var q = $("add-search").value.trim().toLowerCase().split(/\s+/).filter(function(w){ return w; });
	document.querySelectorAll( ".add-card" ).forEach(function(card){
		var t = card.getAttribute( "data-search" );
		card.hidden = !q.every(function(w){ return t.indexOf( w ) >= 0; });
	});
	document.querySelectorAll( ".add-cat" ).forEach(function(cat){
		cat.hidden = !cat.querySelector( ".add-card:not([hidden])" );
	});
}

function openAddPanel()
{
	renderAddPanel();
	$("add-panel").hidden = false;
	$("add-device").classList.add( "on" );
	["options-panel", "sessions-panel"].forEach(function(id){ var p = $(id); if(p) p.hidden = true; });
	setTimeout(function(){ var q = $("add-search"); if(q) q.focus(); }, 0);
}
function closeAddPanel() { $("add-panel").hidden = true; $("add-device").classList.remove( "on" ); }

$("add-device").addEventListener("click", function(e){
	e.stopPropagation();
	if($("add-panel").hidden) openAddPanel(); else closeAddPanel();
});
$("add-panel").addEventListener("click", function(e){
	e.stopPropagation();
	var card = e.target.closest ? e.target.closest( ".add-card" ) : null;
	if(!card)
		return;
	if(card.hasAttribute( "data-extra" )) { closeAddPanel(); if(WR.onAddPanelCard) WR.onAddPanelCard( card ); return; }
	if(addDevice( card.getAttribute( "data-type" ) ))
		closeAddPanel();
});
document.addEventListener("click", function(){ if(!$("add-panel").hidden) closeAddPanel(); });
document.addEventListener("keydown", function(e){ if(e.key == "Escape" && !$("add-panel").hidden) closeAddPanel(); });
canvas.addEventListener("pointerdown", function(){ if(!$("add-panel").hidden) closeAddPanel(); });

// MIDI LEARN in the Options panel: the button, the list of mappings (each removable)
$("opt-midilearn").addEventListener("click", function(e){ e.stopPropagation(); setMidiLearn( !midictl.learn ); });
$("opt-midimap").addEventListener("click", function(e){
	e.stopPropagation();
	var b = e.target.closest ? e.target.closest( "button[data-i]" ) : null;
	if(!b) return;
	var i = b.getAttribute( "data-i" );
	rack.settings.midi_map = i == "all" ? [] : (rack.settings.midi_map || []).filter(function(m, k){ return k != +i; });
	renderMidiMap();
});
$("options").addEventListener("click", function(){ renderMidiMap(); });

// HELP: a panel with everything above (in index.html)
$("help-btn").addEventListener("click", function(e){
	e.stopPropagation();
	var p = $("help-panel");
	p.hidden = !p.hidden;
	$("help-btn").classList.toggle( "on", !p.hidden );
	if(!p.hidden) { ["options-panel", "sessions-panel"].forEach(function(id){ if($(id)) $(id).hidden = true; }); if(!$("add-panel").hidden) closeAddPanel(); }
});
$("help-panel").addEventListener("click", function(e){ e.stopPropagation(); });
document.addEventListener("click", function(){ $("help-panel").hidden = true; $("help-btn").classList.remove( "on" ); });
document.addEventListener("keydown", function(e){ if(e.key == "Escape") { $("help-panel").hidden = true; $("help-btn").classList.remove( "on" ); } });
canvas.addEventListener("pointerdown", function(){ $("help-panel").hidden = true; $("help-btn").classList.remove( "on" ); });

// ---------------------------------------------------------------------------
// PREVIEW mode (index.html?preview=<type>): only that device, filling the window's width, on a
// magenta ground that tools/make-previews.sh trims away. No sessions, no audio

function drawPreview()
{
	var m = rack.modules()[0];
	if(!m)
		return;
	var w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
	if(canvas.width != Math.round( w * dpr ) || canvas.height != Math.round( h * dpr ))
	{
		canvas.width = Math.round( w * dpr );
		canvas.height = Math.round( h * dpr );
	}
	var size = m.def.size( layout, m.settings ), k = w / size[0];
	ctx.setTransform( 1, 0, 0, 1, 0, 0 );
	ctx.fillStyle = "#ff00ff";
	ctx.fillRect( 0, 0, canvas.width, canvas.height );
	ctx.setTransform( dpr * k, 0, 0, dpr * k, 0, 0 );
	view.scale = k; view.ox = 0; view.oy = 0; view.dpr = dpr;
	jacks = {}; ui.hot = null; tooltips = [];
	beginFrame( 0, 0, 1 );
	id_prefix = m.id + ".";
	knob_skin = m.settings.knob_skin || m.def.knob_skin || null;
	m.def.draw( m );
	knob_skin = null;
	id_prefix = "";
	endFrame();
	document.title = "PREVIEW " + m.type + " " + size[0] + "x" + Math.round( size[1] );
}

// index.html#add opens the panel
if(typeof location != "undefined" && location.hash == "#add" && !PREVIEW_TYPE)
	setTimeout( openAddPanel, 300 );

if(PREVIEW_TYPE)
{
	document.body.classList.add( "preview" );
	document.documentElement.style.background = document.body.style.background = "#ff00ff";
	rack.setSettings({ version: 5, modules: [{ id: PREVIEW_TYPE, type: PREVIEW_TYPE, settings: {} }], patches: [] });
}

$("patch-save").addEventListener("click", function(){
	var name = window.prompt( "Save patch as:", $("patch-select").value.substr(0, 2) == "u:" ? currentPatchName() : "" );
	if(name === null)
		return;
	name = name.trim();
	if(!name)
		return;
	if(rack.getUserPatches()[ name ] && !window.confirm( "Replace the saved patch \"" + name + "\"?" ))
		return;
	if(rack.saveUserPatch( name ))
	{
		refreshPatchList( "u:" + name );
		setStatus( "Saved patch: " + name );
	}
	else
		setStatus( "Could not save (browser storage blocked or full)" );
});

$("patch-delete").addEventListener("click", function(){
	var name = currentPatchName();
	if(!name || !window.confirm( "Delete the saved patch \"" + name + "\"?" ))
		return;
	rack.deleteUserPatch( name );
	refreshPatchList();
	setStatus( "Deleted patch: " + name );
});

$("patch-export").addEventListener("click", function(e){
	var name = currentPatchName() || "synths-patch";
	gfTrack( "export-patch", { to: e.shiftKey ? "clipboard" : "file" } );
	if(e.shiftKey) // SHIFT + EXPORT: the patch on the clipboard instead of a file
	{
		var json = rack.exportPatch( name );
		(navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText( json ) : Promise.reject())
			.then(function(){ setStatus( "Patch copied to the clipboard (" + Math.round( json.length / 1024 ) + " kB)" ); },
				function(){ setStatus( "Could not copy to the clipboard" ); });
		return;
	}
	var blob = new Blob([ rack.exportPatch( name ) ], { type: "application/json" });
	var a = document.createElement("a");
	a.href = URL.createObjectURL( blob );
	a.download = name.replace(/[^\w\- ]+/g, "_") + ".json";
	document.body.appendChild( a );
	a.click();
	a.remove();
	setTimeout(function(){ URL.revokeObjectURL( a.href ); }, 1000);
});

$("patch-import").addEventListener("click", function(){
	$("patch-file").click();
});
$("patch-file").addEventListener("change", function(e){
	var file = e.target.files[0];
	e.target.value = "";
	if(!file)
		return;
	file.text().then(function(text){
		var name = rack.importPatch( text ) || file.name.replace(/\.json$/i, "");
		gfTrack( "import-patch" );
		refreshPatchList();
		afterPatchLoad( name + " (from file, use Save as\u2026 to keep it)" );
	}).catch(function(err){
		setStatus( "Could not import " + file.name + ": " + err.message );
	});
});


// MIDI is selected on the keys device; only problems are reported here
rack.onmidichange = function( midi ){
	if(!midi.access)
		setStatus( midi.status, true );
	else if(!midi.inputs.length)
		setStatus( "MIDI on, no input devices connected" );
};

// Scala scales
var scale_index = null;

function syncScaleInput()
{
	$("scale").value = rack.settings.scale_file || "";
}

fetch("data/scales/index.json")
	.then(function(r){ return r.json(); })
	.then(function(list){
		scale_index = {};
		var html = "";
		list.forEach(function(s){
			scale_index[ s.f ] = s.d;
			html += '<option value="' + s.f + '">' + (s.d || "").replace(/</g, "&lt;").replace(/"/g, "&quot;") + '</option>';
		});
		$("scale-list").innerHTML = html;
		$("scale").placeholder = "search " + list.length + " Scala scales…";
	})
	.catch(function(){ $("scale").placeholder = "scale list unavailable"; });

$("scale").addEventListener("change", function(e){
	var file = e.target.value.trim();
	if(!file)
	{
		rack.clearScale();
		return;
	}
	if(scale_index && !(file in scale_index))
	{
		setStatus( "Unknown scale: " + file );
		return;
	}
	rack.loadScale( file ).then(function(scale){
		setStatus( "Scale: " + (scale.description || file) + " (" + (scale.degrees.length) + " notes)" );
		e.target.blur();
	}, function(err){
		setStatus( "Could not load " + file + ": " + err.message );
	});
});
$("scale-clear").addEventListener("click", function(){
	rack.clearScale();
	syncScaleInput();
});

loop();
