// code.js
// Rack UI: canvas drawing, immediate mode widgets (knobs, buttons, switches, LEDs), patch
// cables, the shared devices (keys, LFO, compressor, reverb, delay), toolbar and keyboard
// shortcuts. Each synth draws its own panel (synths/*.js) with these widgets; the rack
// controller is webrack.js and the DSP runs in rack-worklet.js + synths/*-worklet.js.

var canvas = document.getElementById("panel");
var ctx = canvas.getContext("2d");
var FONT = "Antonio, Oswald, 'Arial Narrow', sans-serif";
// two panel layouts: "hardware" mirrors the real front panels, "classic" is the original compact
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

// every row (the keys, each synth, the device rows) is drawn in its own coordinates: a frame
// is its offset and scale in the rack. Jacks and tooltips are stored in rack coordinates
var frame = { ox: 0, oy: 0, k: 1 };
// widget and jack ids get the id of the module being drawn in front ("dfam2." + "cutoff")
var id_prefix = "";

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

// tooltip at x, y of the current frame
function tip( text, x, y ) { tooltips.push([ text, rackX( x ), rackY( y ) ]); }

function clamp(v,a,b) { return v < a ? a : (v > b ? b : v); }

// ---------------------------------------------------------------------------
// audio start

function ensureAudio()
{
	if(!rack.context)
		return rack.init().then(updateToolbar, function(err){
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
	e.preventDefault();
}, { passive: false });
canvas.addEventListener("contextmenu", function(e){ e.preventDefault(); });

function hitCircle( cx, cy, r ) { var dx = ui.x - cx, dy = ui.y - cy; return dx*dx + dy*dy <= r*r; }
function hitRect( x, y, w, h ) { return ui.x >= x && ui.x <= x + w && ui.y >= y && ui.y <= y + h; }

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
	if(hover && ui.wheel && ui.active === null)
	{
		var dn = -ui.wheel * (o.step ? o.step / (max - min) : (ui.shift ? 0.005 : 0.025));
		value = fromN( clamp( toN(value) + dn, 0, 1 ) );
		ui.wheel = 0;
	}
	if(o.step)
		value = Math.round( value / o.step ) * o.step;
	value = clamp( value, min, max );

	var style = o.style || "ticks";
	var steps = o.step ? Math.round( (max - min) / o.step ) + 1 : 0;
	if(layout == "classic")
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

function drawKnob( cx, cy, r, n, highlight, ticks, bipolar, style )
{
	var a;
	// scale printed on the panel
	ctx.strokeStyle = "#d8d5ce";
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
	var held = ui.active === id && ui.down;
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

// ---------------------------------------------------------------------------
// patch bay

function jackCompatible( drag, j )
{
	return (drag.type == "out" && j.type == "in") || (drag.type == "in" && j.type == "out") ||
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

	if(type == "midiin")
	{
		// lights with incoming MIDI while the MIDI cable is plugged in
		var cabled = rack.settings.patches.some(function(p){ return p[1] == id; });
		var active = cabled && rack.midi.access && (performance.now() - rack.midi.activity) < 120;
		drawLed( x - 27, y - 24, 2.5, active, "#3bd16f" );
	}
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
			else if(j.type == "in" || j.type == "midiin")
			{
				// grab the cable plugged here, or start a new one
				var idx = patches.findIndex(function(p){ return p[1] == id; });
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
			if(cable_drag.type == "out" || cable_drag.type == "midiout")
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
// extra devices, in a row below the main panel: dual LFO and compressor

var DEVICE_GAP = 10, DEVICE_H = 200;
var LFO_SHAPE_LABELS = { sine: "SINE", tri: "TRI", saw: "SAW", ramp: "RAMP", square: "SQUARE", sh: "S&H" };

// wood cheeks + black panel, shared by the main panel and the devices
function drawCasing( x, y, w, h )
{
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

function drawLfoDevice( x, y, w, h )
{
	var s = rack.settings;
	var st = rack.state;
	drawDevicePanel( x, y, w, h, "DUAL LFO", ["LOW FREQUENCY", "OSCILLATORS"] );
	var px = drawDeviceJacks( x, y, w, h, WR.LFO_JACKS );
	var sw = (px - 10 - (x + 40)) / 2; // section width

	for(var i = 0; i < 2; ++i)
	{
		var lfo = s.lfo[i];
		var gx = x + 40 + i * sw;
		drawSection( "LFO " + (i + 1), gx, gx + sw - 16, y + 20 );

		lfo.rate = knob( "lfo" + i + "_rate", gx + 38, y + 92, 28, lfo.rate, 0.01, 100, {
			label: "RATE", style: "ring", exp: true, def: i ? 4 : 0.5, format: fmtRate
		});
		drawLed( gx + 72, y + 48, 3.5, (st.lfo[i] || 0) > 0.05, "#ffb02f" );
		lfo.level = knob( "lfo" + i + "_level", gx + 118, y + 96, 20, lfo.level, 0, 1, {
			label: "LEVEL", def: 1, format: function(v){ return fmtPct(v) + "  (\u00b1" + (v * 5).toFixed(1) + " V)"; }
		});
		drawLedColumn( gx + sw - 70, y + 40, WR.LFO_SHAPES.map(function(sh){ return LFO_SHAPE_LABELS[sh]; }),
			function(k){ return lfo.shape == WR.LFO_SHAPES[k]; } );
		if(button( "lfo" + i + "_shape", gx + sw - 80, y + 136, 58, 22, "SHAPE" ).clicked)
			lfo.shape = WR.LFO_SHAPES[ (WR.LFO_SHAPES.indexOf( lfo.shape ) + 1) % WR.LFO_SHAPES.length ];
	}
}

// small retro CRT oscilloscope: green phosphor trace of the SCOPE input (+-5V full scale) or,
// with nothing patched, the master output. Clicking the screen cycles the time base.
function fmtScopeTime( t ) { return t >= 1 ? t + " s" : Math.round( t * 1000 ) + " ms"; }

function drawScope( x, y, w, h, data )
{
	var scope = rack.settings.scope;
	var hover = !cable_drag && (ui.active === null || ui.active === "scope") && hitRect( x, y, w, h );
	if(hover)
	{
		ui.hot = "scope";
		tip( "CLICK: TIME BASE (" + fmtScopeTime( scope.time ) + ")", x + w * 0.5, y + h + 12 );
	}
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = "scope";
		var times = WR.SCOPE_TIMES;
		scope.time = times[ (times.indexOf( scope.time ) + 1) % times.length ];
	}

	// bezel and screen
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x - 3, y - 3, w + 6, h + 6, 8 ); ctx.fill();
	var g = ctx.createRadialGradient( x + w * 0.5, y + h * 0.5, 4, x + w * 0.5, y + h * 0.5, w * 0.7 );
	g.addColorStop( 0, "#0f2a14" );
	g.addColorStop( 1, "#04100a" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 6 ); ctx.fill();

	ctx.save();
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 6 ); ctx.clip();

	// graticule
	ctx.strokeStyle = "rgba(80,255,120,0.12)";
	ctx.lineWidth = 0.6;
	ctx.beginPath();
	for(var i = 1; i < 8; ++i) { ctx.moveTo( x + w * i / 8, y ); ctx.lineTo( x + w * i / 8, y + h ); }
	for(var i = 1; i < 6; ++i) { ctx.moveTo( x, y + h * i / 6 ); ctx.lineTo( x + w, y + h * i / 6 ); }
	ctx.stroke();
	ctx.strokeStyle = "rgba(80,255,120,0.25)";
	ctx.beginPath(); ctx.moveTo( x, y + h * 0.5 ); ctx.lineTo( x + w, y + h * 0.5 ); ctx.stroke();

	// trace, drawn twice: a wide soft glow and a thin bright core. Each column holds the min and
	// max of the samples it covers, so dense audio at long time bases shows as a band
	var mid = y + h * 0.5, amp = h * 0.45;
	var n = data && data.min ? data.min.length : 0;
	var Y = function(v) { return mid - clamp( v, -1.05, 1.05 ) * amp; };
	var trace = function(){
		ctx.beginPath();
		if(!n)
		{
			ctx.moveTo( x, mid ); ctx.lineTo( x + w, mid );
			return;
		}
		for(var i = 0; i < n; ++i)
		{
			var px = x + (i / (n - 1)) * w;
			var lo = Y( data.max[i] ), hi = Y( data.min[i] );
			if(i) ctx.lineTo( px, lo ); else ctx.moveTo( px, lo );
			if(hi - lo > 1) ctx.lineTo( px, hi );
		}
	};
	ctx.lineJoin = "round";
	ctx.strokeStyle = "rgba(60,255,110,0.18)";
	ctx.lineWidth = 4;
	trace(); ctx.stroke();
	ctx.strokeStyle = "#7dff9a";
	ctx.lineWidth = 1.2;
	trace(); ctx.stroke();

	// scanlines and glass reflection
	ctx.fillStyle = "rgba(0,0,0,0.18)";
	for(var yy = y; yy < y + h; yy += 3)
		ctx.fillRect( x, yy, w, 1 );
	g = ctx.createLinearGradient( x, y, x, y + h * 0.5 );
	g.addColorStop( 0, "rgba(255,255,255,0.07)" );
	g.addColorStop( 1, "rgba(255,255,255,0)" );
	ctx.fillStyle = g;
	ctx.fillRect( x, y, w, h * 0.5 );
	ctx.restore();

	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.font = "9px " + FONT;
	ctx.fillStyle = "rgba(125,255,154,0.6)";
	ctx.fillText( data && data.input ? "IN \u00b15V" : "OUT", x + 5, y + 8 );
	ctx.textAlign = "right";
	ctx.fillText( fmtScopeTime( scope.time ) + (scope.time > 0.2 ? " ROLL" : ""), x + w - 5, y + 8 );
}

function drawCompressor( x, y, w, h )
{
	var c = rack.settings.comp;
	var st = rack.state;
	drawDevicePanel( x, y, w, h, "COMPRESSOR", ["MASTER BUS", "DYNAMICS PROCESSOR"] );
	var px = drawDeviceJacks( x, y, w, h, WR.COMP_JACKS );
	drawScope( px + 12, y + 80, 146, h - 100, st.scope );

	// six knobs in a row, then the gain reduction meter and the ON button
	var mx = px - 62;
	var step = (mx - 10 - (x + 40)) / 6;
	var r = Math.min( 24, step * 0.3 );
	drawSection( "DYNAMICS", x + 40, mx - 14, y + 20 );
	var knobs = [
		["threshold", "THRESHOLD", -48, 0, { def: -12, format: fmtDb }],
		["ratio", "RATIO", 1, 20, { exp: true, def: 3, format: function(v){ return v.toFixed(1) + " : 1"; } }],
		["attack", "ATTACK", 0.0005, 0.2, { style: "ring", exp: true, def: 0.005, format: fmtTime }],
		["release", "RELEASE", 0.01, 2, { style: "ring", exp: true, def: 0.12, format: fmtTime }],
		["makeup", "MAKEUP", 0, 24, { def: 0, format: fmtDb }],
		["mix", "MIX", 0, 1, { def: 1, format: function(v){ return Math.round(v * 100) + "% WET"; } }]
	];
	knobs.forEach(function(k, i){
		k[4].label = k[1];
		c[ k[0] ] = knob( "comp_" + k[0], x + 40 + step * (i + 0.5), y + 96, r, c[ k[0] ], k[2], k[3], k[4] );
	});

	drawSection( "GR", mx, px - 12, y + 20 );
	var levels = [20, 15, 10, 6, 3, 1];
	drawLedColumn( mx + 14, y + 40, levels.map(function(db){ return "-" + db; }),
		function(k){ return c.on && st.comp_gr >= levels[k]; },
		function(k){ return k < 2 ? "#ff3b2f" : "#ffb02f"; } );
	if(button( "comp_on", mx + 2, y + 136, 44, 22, "ON", c.on ).clicked)
		c.on = !c.on;
}

// rows below the synths: LFO + compressor, then the post FX
function deviceRowsH()
{
	return [ Math.max( deviceH( "lfo", DEVICE_H ), deviceH( "comp", DEVICE_H ) ),
	         Math.max( deviceH( "reverb", FX_H ), deviceH( "delay", FX_H ) ) ];
}

function drawDevices()
{
	var rows = deviceRowsH();
	var w = (PANEL_W - DEVICE_GAP) * 0.5;
	var y = 0;
	drawDevice( "lfo", 0, y, w, DEVICE_H, "DUAL LFO", WR.LFO_JACKS, drawLfoDevice );
	drawDevice( "comp", w + DEVICE_GAP, y, w, DEVICE_H, "COMPRESSOR", WR.COMP_JACKS, drawCompressor );
	y += rows[0] + DEVICE_GAP;
	drawDevice( "reverb", 0, y, w, FX_H, "REVERB", null, drawReverbDevice );
	drawDevice( "delay", w + DEVICE_GAP, y, w, FX_H, "DELAY", null, drawDelayDevice );
}

// ---------------------------------------------------------------------------
// collapsible devices: a chevron button on the top left corner folds a device (and the others in its row) into a slim bar.
// Its jacks stay on the bar as small sockets so cables keep their ends and can still be patched.

var DEVICE_COLLAPSED_H = 26;
var FX_H = 150;
var collapsed = {};
try { collapsed = JSON.parse( localStorage.getItem("SUBHARM_collapsed") || "{}" ) || {}; } catch(err) {}

function deviceH( id, h ) { return collapsed[id] ? DEVICE_COLLAPSED_H : h; }

// devices sharing a row fold and unfold together
var DEVICE_ROWS = [["io"], ["keys"], ["lfo", "comp"], ["reverb", "delay"]];

function toggleCollapsed( id )
{
	var state = !collapsed[id];
	collapsed[id] = state; // synth modules have a row each
	DEVICE_ROWS.forEach(function(row){
		if(row.indexOf( id ) != -1)
			row.forEach(function(other){ collapsed[other] = state; });
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
	(jack_rows || []).forEach(function(row){ all = all.concat( row ); });
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
	draw( x, y, w, h );
	collapseButton( id, x + 36, y + 11 );
}

// ---------------------------------------------------------------------------
// synth modules, a row each between the keys and the device rows, scaled to the rack's width

var EMPTY_RACK_H = 60;

// panel size in its own coordinates and the scale that fits it in the rack
function moduleFit( def )
{
	var size = def.size( layout );
	return { w: size[0], h: size[1], k: PANEL_W / size[0] };
}

function moduleRowH( m )
{
	if(collapsed[ m.id ])
		return DEVICE_COLLAPSED_H;
	var fit = moduleFit( WR.types[ m.type ] );
	return fit.h * fit.k;
}

function modulesH()
{
	var mods = rack.settings.modules;
	if(!mods.length)
		return EMPTY_RACK_H + KB_GAP;
	return mods.reduce(function(h, m){ return h + moduleRowH( m ) + KB_GAP; }, 0);
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

function askRemoveModule( m )
{
	// after this frame: a dialog in the middle of the draw loop would lose the pointer release
	setTimeout(function(){
		ui.down = false;
		ui.active = null;
		var cables = rack.settings.patches.filter(function(p){ return p[0].indexOf( m.id + "." ) == 0 || p[1].indexOf( m.id + "." ) == 0; }).length;
		if(!window.confirm( "Remove " + m.def.title + " (" + m.id + ") from the rack?" + (cables ? " Its " + cables + " cable" + (cables > 1 ? "s" : "") + " will be unplugged." : "") ))
			return;
		rack.removeModule( m.id );
		delete collapsed[ m.id ];
		saveCollapsed();
		setStatus( "Removed " + m.def.title + " from the rack" );
	}, 0);
}

function drawEmptyRack( w )
{
	drawCasing( 0, 0, w, EMPTY_RACK_H );
	drawLabel( "THE RACK HAS NO SYNTHS: INSERT ONE WITH \u201cADD SYNTH\u201d IN THE TOOLBAR", w * 0.5, EMPTY_RACK_H * 0.5, 14, false, DIM_COLOR );
}

// draws the modules from y down; returns the height used
function drawModules( y0 )
{
	var mods = rack.modules();
	if(!mods.length)
	{
		beginFrame( 0, y0, 1 );
		drawEmptyRack( PANEL_W );
		endFrame();
		return EMPTY_RACK_H + KB_GAP;
	}
	var y = y0;
	mods.forEach(function(m, i){
		if(show_rear)
		{
			var fit = moduleFit( m.def );
			beginFrame( 0, y, collapsed[ m.id ] ? 1 : fit.k );
			drawRearDevice( m.id, 0, 0, collapsed[ m.id ] ? PANEL_W : fit.w, fit.h, m.def.title );
			endFrame();
		}
		else if(collapsed[ m.id ])
		{
			beginFrame( 0, y, 1 );
			id_prefix = m.id + ".";
			var end = drawCollapsedBar( m.id, 0, 0, PANEL_W, m.def.title, m.def.jacks );
			id_prefix = "";
			moduleButtons( m, i, mods.length, function(k){ return [ end + 22 + k * 22, DEVICE_COLLAPSED_H * 0.5 ]; } );
			endFrame();
		}
		else
		{
			var fit = moduleFit( m.def );
			beginFrame( 0, y, fit.k );
			id_prefix = m.id + ".";
			m.def.draw( m );
			id_prefix = "";
			collapseButton( m.id, 36, 11 );
			// on the right wood cheek
			moduleButtons( m, i, mods.length, function(k){ return [ fit.w - 11, 20 + k * 22 ]; } );
			endFrame();
		}
		y += moduleRowH( m ) + KB_GAP;
	});
	return y - y0;
}

// ---------------------------------------------------------------------------
// post FX devices (bottom row): reverb and delay on the master output

function drawReverbDevice( x, y, w, h )
{
	var fx = rack.settings.fx;
	var s = rack.settings;
	drawDevicePanel( x, y, w, h, "REVERB", ["CONVOLUTION", "SEND EFFECT"] );
	s.reverb = knob( "fx_reverb_mix", x + 100, y + 70, 28, s.reverb, 0, 1, {
		label: "MIX", def: 0.15, format: fmtPct
	});
	fx.reverb_predelay = knob( "fx_reverb_predelay", x + 210, y + 70, 24, fx.reverb_predelay, 0, 0.25, {
		label: "PRE-DELAY", style: "ring", def: 0.02, format: fmtTime
	});
	fx.reverb_tone = knob( "fx_reverb_tone", x + 310, y + 70, 24, fx.reverb_tone, 500, 16000, {
		label: "TONE", exp: true, def: 12000, format: fmtHz
	});
	// ROOM: name display with previous / next buttons
	var rooms = WR.REVERB_ROOMS, ri = WR.reverbRoomIndex( fx.reverb_room );
	drawLabel( "ROOM", x + 476, y + 30, 11 );
	var lx = x + 392, lw = 168, ly = y + 42;
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( lx - 3, ly - 3, lw + 6, 30, 5 ); ctx.fill();
	ctx.fillStyle = "#16240f";
	ctx.beginPath(); ctx.roundRect( lx, ly, lw, 24, 3 ); ctx.fill();
	ctx.font = "bold 13px 'Courier New', monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#b6f06a";
	ctx.fillText( (ri + 1) + "/" + rooms.length + " " + fx.reverb_room + (rack.reverbLoading() ? " \u2026" : ""), lx + lw * 0.5, ly + 13 );
	if(button( "fx_reverb_prev", lx, y + 84, 36, 22, "\u25c0" ).clicked)
		fx.reverb_room = rooms[ (ri - 1 + rooms.length) % rooms.length ][0];
	if(button( "fx_reverb_next", lx + 42, y + 84, 36, 22, "\u25b6" ).clicked)
		fx.reverb_room = rooms[ (ri + 1) % rooms.length ][0];
	if(button( "fx_reverb_on", lx + 92, y + 84, 76, 22, "ON", fx.reverb_on ).clicked)
		fx.reverb_on = !fx.reverb_on;
}

function drawDelayDevice( x, y, w, h )
{
	var fx = rack.settings.fx;
	drawDevicePanel( x, y, w, h, "DELAY", ["STEREO", "PING-PONG ECHO"] );
	if(fx.delay_sync)
		fx.delay_div = knob( "fx_delay_div", x + 100, y + 70, 28, fx.delay_div, 0, WR.DELAY_DIVS.length - 1, {
			label: "TIME", step: 1, def: 3, style: "ring",
			format: function(v){ return WR.DELAY_DIVS[v][0] + "  " + Math.round( rack.delayTime() * 1000 ) + " ms"; }
		});
	else
		fx.delay_time = knob( "fx_delay_time", x + 100, y + 70, 28, fx.delay_time, 0.01, 2, {
			label: "TIME", exp: true, def: 0.3, style: "ring", format: fmtTime
		});
	fx.delay_feedback = knob( "fx_delay_feedback", x + 200, y + 70, 24, fx.delay_feedback, 0, 0.95, {
		label: "FEEDBACK", def: 0.4, format: fmtPct
	});
	fx.delay_tone = knob( "fx_delay_tone", x + 290, y + 70, 24, fx.delay_tone, 500, 16000, {
		label: "TONE", exp: true, def: 5000, format: fmtHz
	});
	fx.delay_mix = knob( "fx_delay_mix", x + 380, y + 70, 24, fx.delay_mix, 0, 1, {
		label: "MIX", def: 0.3, format: fmtPct
	});
	if(button( "fx_delay_sync", x + 448, y + 40, 84, 22, "SYNC", fx.delay_sync ).clicked)
		fx.delay_sync = !fx.delay_sync;
	if(button( "fx_delay_pingpong", x + 448, y + 68, 84, 22, "PING-PONG", fx.delay_pingpong ).clicked)
		fx.delay_pingpong = !fx.delay_pingpong;
	if(button( "fx_delay_on", x + 448, y + 96, 84, 22, "ON", fx.delay_on ).clicked)
		fx.delay_on = !fx.delay_on;
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
// rear view (Tab): every device turned around, with its audio sockets and the cables of the
// fixed audio path: each synth -> compressor inputs -> delay -> reverb -> audio I/O main in.
// The front CV / gate cables are not shown here

var show_rear = false;
var rear_jacks = {}; // socket id -> { x, y, r, label, device }

// [socket, label, "in" | "out"] on the back of a device
function rearSockets( id )
{
	if(rack.settings.modules.some(function(m){ return m.id == id; }))
		return [["out", "AUDIO OUT", "out"]];
	switch(id)
	{
		case "io": return [["main_l", "MAIN IN L", "in"], ["main_r", "MAIN IN R", "in"], ["input_l", "INPUT L", "out"], ["input_r", "INPUT R", "out"]];
		case "comp":
			var list = [];
			for(var k = 1; k <= Math.max( 2, rack.settings.modules.length ); ++k)
				list.push([ "in" + k, "INPUT " + k, "in" ]);
			list.push([ "out", "OUTPUT", "out" ]);
			return list;
		case "delay": return [["in", "INPUT", "in"], ["out_l", "OUT L", "out"], ["out_r", "OUT R", "out"]];
		case "reverb": return [["in_l", "IN L", "in"], ["in_r", "IN R", "in"], ["out_l", "OUT L", "out"], ["out_r", "OUT R", "out"]];
	}
	return [];
}

// what the rear sticker says about the device's audio
function rearNote( id )
{
	var fx = rack.settings.fx;
	switch(id)
	{
		case "io": return "INPUT L / R GO TO IN L / IN R ON THE FRONT";
		case "keys": return "NO AUDIO: NOTES AND CV ON THE FRONT";
		case "lfo": return "NO AUDIO: CV ON THE FRONT";
		case "comp": return rack.settings.comp.on ? "INPUTS SUMMED, COMPRESSED" : "BYPASSED (OFF)";
		case "delay": return fx.delay_on ? "INSERT: DRY + ECHOES" : "BYPASSED (OFF): DRY THROUGH";
		case "reverb": return fx.reverb_on ? "DRY + REVERB SEND" : "BYPASSED (OFF): DRY THROUGH";
	}
	return "MONO AUDIO OUT, POST VOLUME";
}

var REAR_L = "#d8463a", REAR_R = "#e8e4dc", REAR_MONO = "#9a9a94";

function rearCables()
{
	var c = [];
	rack.settings.modules.forEach(function(m, k){
		c.push([ "rear:" + m.id + ":out", "rear:comp:in" + (k + 1), CABLE_COLORS[ (k + 2) % CABLE_COLORS.length ] ]);
	});
	c.push([ "rear:comp:out", "rear:delay:in", REAR_MONO ]);
	c.push([ "rear:delay:out_l", "rear:reverb:in_l", REAR_L ]);
	c.push([ "rear:delay:out_r", "rear:reverb:in_r", REAR_R ]);
	c.push([ "rear:reverb:out_l", "rear:io:main_l", REAR_L ]);
	c.push([ "rear:reverb:out_r", "rear:io:main_r", REAR_R ]);
	return c;
}

// 1/4" socket on the back
function drawRearSocket( id, x, y, label, dir, device, mini )
{
	var r = mini ? 6.5 : 15;
	rear_jacks[id] = { x: rackX( x ), y: rackY( y ), r: (r + 3) * frame.k, label: label, device: device };
	if(!mini)
		drawLabel( label, x, y - 27, 10, dir == "out" );
	var g = ctx.createLinearGradient( x - r, y - r, x + r, y + r );
	g.addColorStop( 0, "#d4d4ce" );
	g.addColorStop( 1, "#6d6d68" );
	ctx.fillStyle = g;
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
			drawRearSocket( "rear:" + id + ":" + sk[0], x + w - 22 - 20 - (sockets.length - 1 - k) * 24, cy, sk[1], sk[2], name, true );
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
	var vy = y + (h - vrows * 16) * 0.5 + 3;
	ctx.fillStyle = "#121214";
	for(var r = 0; r < vrows; ++r)
		for(var c = 0; c < Math.min( 10, Math.floor( (w * 0.28) / 26 ) ); ++c)
		{
			ctx.beginPath(); ctx.roundRect( vx + c * 26, vy + r * 16, 20, 7, 3.5 ); ctx.fill();
		}

	// sticker with the device name and what its audio does, clear of the socket plate
	var spacing = 64, pw = sockets.length * spacing + 16;
	var px = x + w - 22 - 14 - pw;
	var sh = Math.min( 56, h - 18 ), sw = 250;
	var sx = x + Math.max( 64 + Math.min( 10, Math.floor( (w * 0.28) / 26 ) ) * 26 + 30, w * 0.36 ), sy = y + (h - sh) * 0.5;
	if(sockets.length)
		sx = Math.min( sx, px - sw - 20 );
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
		var py = y + Math.max( 6, h * 0.5 - 40 ), ph = Math.min( h - 12, 80 );
		ctx.fillStyle = "#18181a";
		ctx.beginPath(); ctx.roundRect( px, py, pw, ph, 6 ); ctx.fill();
		sockets.forEach(function(sk, k){
			drawRearSocket( "rear:" + id + ":" + sk[0], px + 8 + spacing * (k + 0.5), py + ph * 0.5 + 12, sk[1], sk[2], name );
		});
	}
	collapseButton( id, x + 36, y + 11 );
}

function drawRearCables()
{
	var cables = rearCables();
	cables.forEach(function(c){
		var a = rear_jacks[ c[0] ], b = rear_jacks[ c[1] ];
		if(a && b)
			drawCable( a.x, a.y, b.x, b.y, c[2], 0.92, !show_wires );
	});
	// hovering a socket says where it goes
	for(var id in rear_jacks)
	{
		var j = rear_jacks[id];
		if((ui.px - j.x) * (ui.px - j.x) + (ui.py - j.y) * (ui.py - j.y) > j.r * j.r)
			continue;
		var other = cables.filter(function(c){ return c[0] == id || c[1] == id; }).map(function(c){
			var o = rear_jacks[ c[0] == id ? c[1] : c[0] ];
			return o ? (c[0] == id ? "\u2192 " : "\u2190 ") + o.device + " " + o.label : "";
		});
		tooltips.push([ j.device + " " + j.label + (other.length ? "  " + other.join(", ") : "  (not connected)"), j.x, j.y - j.r - 12 ]);
		ui.hot = id;
	}
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

	ui.hot = null;
	jacks = {}; // filled again by every row as it draws its jacks
	rear_jacks = {};
	beginFrame( 0, 0, 1 );
	drawDevice( "io", 0, 0, PANEL_W, IO_H, "AUDIO I/O", WR.IO_JACKS, drawIODevice );
	endFrame();
	var y = deviceH( "io", IO_H ) + KB_GAP;
	beginFrame( 0, y, 1 );
	drawDevice( "keys", 0, 0, PANEL_W, KB_H, "KEYS", WR.KB_JACKS, drawKeysDevice );
	endFrame();
	y += deviceH( "keys", KB_H ) + KB_GAP;
	y += drawModules( y );
	view.devices_y = y;
	beginFrame( 0, y, 1 );
	drawDevices();
	endFrame();
	if(show_rear)
		drawRearCables();
	else
	{
		updateCables();
		drawCables();
	}
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

// the wood cheeks on the sides of every row (and the middle ones of the two device rows), or
// outside the rack: dragging there scrolls the rack
function onRackSide( x, y )
{
	var cheek = 22;
	if(x < cheek || x > PANEL_W - cheek || y < 0 || y > PANEL_H)
		return true;
	var half = (PANEL_W - DEVICE_GAP) * 0.5;
	return y >= view.devices_y && x > half - cheek && x < half + DEVICE_GAP + cheek;
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
	switch(e.code)
	{
		case "Space": act(function(){ rack.transport( "play" ); }); break;
		case "KeyR": act(function(){ rack.transport( "reset" ); }); break;
		case "KeyN": act(function(){ rack.transport( "next" ); }); break;
		case "KeyT": act(function(){ rack.transport( "trigger", true ); }); break;
		default: return;
	}
	e.preventDefault();
});
window.addEventListener("keyup", function(e){
	if(e.code == "Space" && !isTextField( e.target ))
		e.preventDefault();
	if(piano.down[ e.code ] !== undefined)
		pianoNoteOff( e.code );
	else if(e.code == "KeyT")
		act(function(){ rack.transport( "trigger", false ); });
});
// keys released while the window is not focused never send keyup
window.addEventListener("blur", pianoAllOff);

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
	var rows = deviceRowsH();
	PANEL_H = deviceH( "io", IO_H ) + KB_GAP + deviceH( "keys", KB_H ) + KB_GAP + modulesH() + rows[0] + DEVICE_GAP + rows[1];
	if(show_rear)
		PANEL_H += 50; // room for the rear cables hanging below the bottom row
}

function setLayout( name )
{
	layout = name;
	PANEL_W = LAYOUTS[name].w;
	updatePanelHeight();
	jacks = {};
	cable_drag = null;
	$("layout").textContent = "Layout: " + LAYOUTS[name].name;
	try { localStorage.setItem( "SUBHARM_layout", name ); } catch(err) {}
}
setLayout( layout );

function setShowWires( show )
{
	show_wires = show;
	$("wires").textContent = show ? "Wires: shown" : "Wires: hidden";
	try { localStorage.setItem( "SUBHARM_wires", show ? "shown" : "hidden" ); } catch(err) {}
}
setShowWires( show_wires );
$("wires").addEventListener("click", function(){
	setShowWires( !show_wires );
});

$("zoom-out").addEventListener("click", function(){ setZoom( view.zoom / ZOOM_STEP ); });
$("zoom-in").addEventListener("click", function(){ setZoom( view.zoom * ZOOM_STEP ); });
$("zoom-reset").addEventListener("click", function(){ setZoom( 1 ); });
$("zoom-reset").textContent = Math.round( view.zoom * 100 ) + "%";

$("layout").addEventListener("click", function(){
	setLayout( layout == "hardware" ? "classic" : "hardware" );
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
	}
	else if(v.substr(0, 2) == "u:")
	{
		var name = v.substr(2);
		rack.setSettings( rack.getUserPatches()[ name ] );
		afterPatchLoad( name );
	}
	$("patch-delete").hidden = v.substr(0, 2) != "u:";
	e.target.blur();
});

$("randomize").addEventListener("click", function(){
	rack.randomize();
	refreshPatchList();
	setStatus( "Random sound on every synth in the rack (Save as\u2026 to keep it)" );
});

// inserts a new synth at the bottom of the rack
function refreshAddSynth()
{
	var html = '<option value="">Add synth\u2026</option>';
	WR.order.forEach(function(type){
		var def = WR.types[ type ];
		html += '<option value="' + type + '" title="' + def.description + '">' + def.title + '</option>';
	});
	$("add-synth").innerHTML = html;
}
refreshAddSynth();
$("add-synth").addEventListener("change", function(e){
	var type = e.target.value;
	e.target.value = "";
	e.target.blur();
	if(!WR.types[ type ])
		return;
	var m = rack.addModule( type );
	setStatus( "Added " + WR.types[ type ].title + " (" + m.id + ") at the bottom of the rack" + (WR.types[ type ].midi_in ? ", MIDI cabled from the keys" : "") );
});

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

$("patch-export").addEventListener("click", function(){
	var name = currentPatchName() || "subharm-patch";
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
