// code.js
// Panel UI of the Subharmonicon replica: canvas drawing, immediate mode
// widgets (knobs, buttons, switches, LEDs), patch bay cables, toolbar and
// keyboard shortcuts. The synth engine is in harm.js / harm-worklet.js.

var canvas = document.getElementById("panel");
var ctx = canvas.getContext("2d");
var FONT = "Antonio, Oswald, 'Arial Narrow', sans-serif";
// two panel layouts: "hardware" mirrors the real front panel (60HP, ~2.37:1, plus wood
// cheeks), "classic" is the original compact layout of this replica
var LAYOUTS = {
	hardware: { w: 1568, h: 596, name: "Hardware" },
	classic: { w: 1460, h: 750, name: "Classic" }
};
var layout = "hardware";
try { if(LAYOUTS[ localStorage.getItem("SUBHARM_layout") ]) layout = localStorage.getItem("SUBHARM_layout"); } catch(err) {}
var PANEL_W, PANEL_H, MAIN_H; // set by setLayout(); PANEL_H includes the device row
var KNOB_A0 = Math.PI * 0.75, KNOB_SWEEP = Math.PI * 1.5;
var CABLE_COLORS = ["#e8c547","#e05a47","#4fa3e0","#6cc070","#c77dd8","#ececec","#f08c3a"];
var TEXT_COLOR = "#e8e4dc", DIM_COLOR = "#8c8a84";

var synth = new Harm();

var view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
var ui = {
	x: -1, y: -1, down: false, pressed: false, released: false, rpressed: false, dbl: false,
	shift: false, wheel: 0, active: null, hot: null,
	startY: 0, startN: 0, dragShift: false, lastDownTime: 0, lastDownPos: [0,0]
};
var tooltips = [];
var jacks = {};          // jack id -> { x, y, type, label }
var cable_drag = null;   // { from: jack id, type: "out"|"in", color }
var next_color = 0;
var trigger_held = false;

function clamp(v,a,b) { return v < a ? a : (v > b ? b : v); }

// ---------------------------------------------------------------------------
// audio start

function ensureAudio()
{
	if(!synth.context)
		return synth.init().then(updateToolbar, function(err){
			console.error(err);
			setStatus("Audio engine failed to start: " + err.message);
		});
	return synth._initializing;
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
	ui.x = (e.clientX - r.left - view.ox) / view.scale;
	ui.y = (e.clientY - r.top - view.oy) / view.scale;
	ui.shift = e.shiftKey;
}

canvas.addEventListener("pointerdown", function(e){
	toPanel(e);
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
canvas.addEventListener("pointermove", toPanel);
function onPointerUp(e) {
	toPanel(e);
	if(e.button == 2 || !ui.down)
		return;
	ui.down = false;
	ui.released = true;
}
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("wheel", function(e){
	toPanel(e);
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
		tooltips.push([ o.format( value ), cx, cy + r + 16 ]);
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

	// machined aluminium cap: muted metal with concentric turning rings and a dark centre
	var cr = r * 0.62;
	g = ctx.createRadialGradient( cx, cy, 0, cx, cy, cr );
	g.addColorStop( 0, "#3a3a38" );
	g.addColorStop( 0.18, "#5c5c58" );
	g.addColorStop( 0.6, highlight ? "#8e8e88" : "#80807b" );
	g.addColorStop( 0.92, highlight ? "#9a9a94" : "#8c8c86" );
	g.addColorStop( 1, "#5a5a55" );
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
		tooltips.push([ ["SQUARE", "PULSE + SAW SUBS (PWM)", "SAW"][pos], cx, y + h + 14 ]);
	return value;
}

// ---------------------------------------------------------------------------
// patch bay

function jackCompatible( drag, j )
{
	return (drag.type == "out" && j.type == "in") || (drag.type == "in" && j.type == "out");
}

function drawJack( id, x, y, label, type )
{
	jacks[id] = { x: x, y: y, type: type, label: label };
	var hover = hitCircle( x, y, 17 );

	drawLabel( label, x, y - 24, 10, type == "out" );

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

	if(type == "midi")
	{
		var active = synth.midi.access && (performance.now() - synth.midi.activity) < 120;
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
	var patches = synth.settings.patches;
	if(ui.rpressed)
	{
		var id = jackAt( ui.x, ui.y );
		if(id)
			synth.disconnect( id );
	}
	if(ui.pressed && ui.active === null && !cable_drag)
	{
		var id = jackAt( ui.x, ui.y );
		if(id)
		{
			ui.active = "jack";
			var j = jacks[id];
			if(j.type == "midi")
				($("midi-enable").hidden ? $("midi-input") : $("midi-enable")).focus();
			else if(ui.dbl)
				synth.disconnect( id );
			else if(j.type == "in")
			{
				// grab the cable plugged here, or start a new one
				var idx = patches.findIndex(function(p){ return p[1] == id; });
				if(idx != -1)
				{
					var p = patches.splice( idx, 1 )[0];
					cable_drag = { from: p[0], type: "out", color: p[2] };
				}
				else
					cable_drag = { from: id, type: "in", color: next_color++ % CABLE_COLORS.length };
			}
			else
				cable_drag = { from: id, type: "out", color: next_color++ % CABLE_COLORS.length };
		}
	}
	if(cable_drag && !ui.down)
	{
		var target = jackAt( ui.x, ui.y );
		if(target && jackCompatible( cable_drag, jacks[target] ))
		{
			if(cable_drag.type == "out")
				synth.connect( cable_drag.from, target, cable_drag.color );
			else
				synth.connect( target, cable_drag.from, cable_drag.color );
		}
		cable_drag = null;
	}
}

function drawCable( x1, y1, x2, y2, color, alpha )
{
	var d = Math.hypot( x2 - x1, y2 - y1 );
	var sag = Math.min( 20 + d * 0.3, 90 ); // long cables between rows would hang off the panel
	// quadratic curve: the lowest point hangs `sag` below the midpoint
	var mx = (x1 + x2) * 0.5, my = (y1 + y2) * 0.5 + sag;
	ctx.save();
	ctx.globalAlpha = alpha || 0.92;
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
	synth.settings.patches.forEach(function(p){
		var a = jacks[p[0]], b = jacks[p[1]];
		if(a && b)
			drawCable( a.x, a.y, b.x, b.y, CABLE_COLORS[ p[2] % CABLE_COLORS.length ] );
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
// panel, laid out like the hardware (60HP Eurorack panel between wood cheeks):
// sequencers / polyrhythm / transport | VCO 1 | SEQ OCT + QUANTIZE | VCO 2 | VCF + EGs | patch bay

var SEQ_COLS = [100, 180, 260, 340];
var VCO_COLS = [[455, 545, 635], [785, 875, 965]]; // SUB 1, VCO, SUB 2 columns
var CENTER_X = 710;
var FILTER_COLS = [1082, 1192];
var FILTER_ROWS = [100, 228, 356, 484];
var JACK_COLS = [1292, 1357, 1422, 1487];

function drawPanelBackground()
{
	drawCasing( 0, 0, PANEL_W, MAIN_H );

	drawScrew( 36, 12 ); drawScrew( PANEL_W - 36, 12 );
	drawScrew( 36, MAIN_H - 12 ); drawScrew( PANEL_W - 36, MAIN_H - 12 );
	drawScrew( 690, MAIN_H - 12 ); drawScrew( 690, 12 );

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
	var s = synth.settings;
	var st = synth.state;
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
	var s = synth.settings;
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
	var s = synth.settings;
	var st = synth.state;

	s.tempo = knob( "tempo", 84, 446, 38, s.tempo, Harm.TEMPO_MIN, Harm.TEMPO_MAX, {
		label: "TEMPO", labelSize: 13, style: "ring", exp: true, def: 120,
		format: function(v){
			if(st.clock_source == "midi") return "MIDI CLOCK";
			if(st.clock_source == "patch") return "EXT CLOCK";
			return Math.round(v) + " BPM";
		}
	});

	if(button( "reset", 160, 410, 54, 26, "RESET" ).clicked)
		act(function(){ synth.reset(); });
	// EG is lit normally and blinks while the envelopes are held open
	var blink = (performance.now() % 600) < 300;
	if(button( "eg", 222, 410, 54, 26, "EG", s.eg_hold ? blink : true ).clicked)
		s.eg_hold = !s.eg_hold;
	if(button( "next", 284, 410, 54, 26, "NEXT" ).clicked)
		act(function(){ synth.next(); });

	if(button( "play", 160, 450, 84, 28, "PLAY", st.playing ).clicked)
		act(function(){ synth.play(); });
	var trig = button( "trigger", 254, 450, 84, 28, "TRIGGER", trigger_held );
	if(trig.clicked)
		act(function(){ synth.trigger(true); });
	if((trigger_held || trig.clicked) && !trig.held)
		act(function(){ synth.trigger(false); });
	trigger_held = trig.held;
}

function drawOscillators()
{
	var s = synth.settings;
	var st = synth.state;

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

		osc.freq = knob( "vco" + n + "_freq", cols[1], 100, 38, osc.freq, Harm.VCO_MIN_FREQ, Harm.VCO_MAX_FREQ, {
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
	var s = synth.settings;
	var x = CENTER_X;
	ctx.strokeStyle = "#a9a69e";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo( x, 34 ); ctx.lineTo( x, 62 );
	ctx.moveTo( x, 170 ); ctx.lineTo( x, 232 );
	ctx.moveTo( x, 424 ); ctx.lineTo( x, MAIN_H - 40 );
	ctx.stroke();

	[[5, "±5"], [2, "±2"], [1, "±1"]].forEach(function(o, k){
		drawLed( x - 8, 78 + k * 22, 4.5, s.seq_oct == o[0] );
		drawLabel( o[1], x + 12, 78 + k * 22, 11 );
	});
	if(button( "seq_oct", x - 30, 142, 60, 24, "SEQ OCT" ).clicked)
		synth.cycleSeqOct();

	var modes = [["12-ET","12-ET"], ["8-ET","8-ET"], ["12-JI","12-JI"], ["8-JI","8-JI"], ["SCL","SCALA"]];
	modes.forEach(function(m, k){
		var y = 248 + k * 22;
		var available = m[0] != "SCL" || synth.custom_scale;
		drawLed( x - 16, y, 4.5, s.quantize == m[0] );
		ctx.textAlign = "left";
		ctx.font = "11px " + FONT;
		ctx.fillStyle = available ? TEXT_COLOR : "#55534e";
		ctx.fillText( m[1], x - 6, y + 1 );
	});
	if(button( "quantize", x - 34, 364, 68, 24, "QUANTIZE" ).clicked)
		synth.cycleQuantize();
	if(s.quantize == "SCL" && synth.custom_scale)
	{
		var name = synth.custom_scale.file.replace(/\.scl$/, "");
		drawLabel( name.length > 14 ? name.substr(0, 13) + "…" : name, x, 404, 10, false, DIM_COLOR );
	}
}

function drawFilterSection()
{
	var s = synth.settings;
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
	jacks = {};
	var x = JACK_COLS[0] - 30;
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( x, 14, JACK_COLS[3] - x + 30, MAIN_H - 28, 6 ); ctx.fill();
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

	for(var r = 0; r < Harm.JACKS.length; ++r)
		for(var c = 0; c < 4; ++c)
		{
			var j = Harm.JACKS[r][c];
			drawJack( j[2], JACK_COLS[c], 74 + r * 69, j[0], j[1] );
		}
}

// ---------------------------------------------------------------------------
// classic layout: the original compact arrangement of this replica (toolbar "Layout" button)

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

function classicBackground()
{
	drawCasing( 0, 0, PANEL_W, MAIN_H );

	// patch bay plate
	ctx.fillStyle = "#222220";
	ctx.beginPath(); ctx.roundRect( 1095, 18, 330, 712, 8 ); ctx.fill();
	ctx.strokeStyle = "#353532";
	ctx.lineWidth = 1;
	ctx.stroke();

	drawScrew( 36, 14 ); drawScrew( PANEL_W - 36, 14 );
	drawScrew( 36, MAIN_H - 14 ); drawScrew( PANEL_W - 36, MAIN_H - 14 );

	ctx.font = "26px " + FONT;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "SUBHARM", 50, MAIN_H - 24 );
	ctx.font = "12px " + FONT;
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( "POLYRHYTHMIC SUBHARMONIC SYNTHESIZER", 150, MAIN_H - 22 );
}

function classicOscillatorGroup( i, gx )
{
	var s = synth.settings;
	var osc = s.vco[i];
	var st = synth.state;
	var n = i + 1;

	drawSection( "VCO " + n, gx, gx + 340, 26 );

	osc.freq = knob( "vco" + n + "_freq", gx + 70, 118, 42, osc.freq, Harm.VCO_MIN_FREQ, Harm.VCO_MAX_FREQ, {
		label: "VCO " + n + " FREQ", labelSize: 13, exp: true, def: i == 0 ? 261.63 : 392,
		format: function(){ return freqToNoteName( st.freq[i] ); }
	});
	drawLabel( fmtHz( st.freq[i] || osc.freq ), gx + 70, 180, 11, false, DIM_COLOR );

	var subs = [["sub1", "SUB 1 FREQ", gx + 175], ["sub2", "SUB 2 FREQ", gx + 262]];
	subs.forEach(function(sub, k){
		osc[ sub[0] ] = knob( "vco" + n + "_" + sub[0], sub[2], 118, 29, osc[ sub[0] ], 1, 16, {
			label: sub[1], step: 1, def: k == 0 ? 2 : 4, format: fmtDiv
		});
		var div = st.div[i][k] || osc[ sub[0] ];
		drawLabel( fmtDiv( div ) + "  " + fmtHz( (st.freq[i] || osc.freq) / div ), sub[2], 180, 11, false, DIM_COLOR );
	});

	drawLabel( "WAVE", gx + 322, 72, 11 );
	osc.wave = waveSwitch( "vco" + n + "_wave", gx + 314, 98, osc.wave );

	// mixer + sequencer assign
	drawSection( "MIXER", gx, gx + 340, 214 );
	var levels = [["level", "VCO " + n + " LEVEL", gx + 70, "osc", "OSC " + n],
	              ["sub1_level", "SUB 1 LEVEL", gx + 175, "sub1", "SUB 1"],
	              ["sub2_level", "SUB 2 LEVEL", gx + 262, "sub2", "SUB 2"]];
	var assign = s.seq_assign[i];
	levels.forEach(function(l){
		osc[ l[0] ] = knob( "vco" + n + "_" + l[0], l[2], 268, 24, osc[ l[0] ], 0, 1, {
			label: l[1], def: 0, format: fmtPct
		});
		if(button( "assign" + n + l[3], l[2] - 25, 310, 50, 20, l[4], assign[ l[3] ] ).clicked)
			assign[ l[3] ] = !assign[ l[3] ];
	});
	drawLabel( "SEQ " + n + " ASSIGN", gx + 166, 345, 11, false, DIM_COLOR );

	// sequencer
	drawSection( "SEQUENCER " + n, gx, gx + 340, 376 );
	var steps = s.seq[i];
	for(var k = 0; k < 4; ++k)
	{
		var cx = gx + 40 + k * 86;
		steps[k] = knob( "seq" + n + "_" + k, cx, 432, 22, steps[k], -1, 1, {
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
		drawLed( cx, 476, 4.5, st.step[i] == k );
	}
}

function classicClockSection( gx )
{
	var s = synth.settings;
	var st = synth.state;

	drawSection( "CLOCK", gx, gx + 340, 510 );
	s.tempo = knob( "tempo", gx + 70, 600, 38, s.tempo, Harm.TEMPO_MIN, Harm.TEMPO_MAX, {
		label: "TEMPO", labelSize: 13, exp: true, def: 120,
		format: function(v){ return Math.round(v) + " BPM"; }
	});
	drawLed( gx + 122, 558, 4, st.clock && st.playing, "#ffb02f" );
	var src = st.clock_source == "internal" ? Math.round( s.tempo ) + " BPM" : (st.clock_source == "midi" ? "MIDI CLOCK" : "EXT CLOCK");
	drawLabel( src, gx + 70, 660, 11, false, DIM_COLOR );

	var bx = gx + 148, bw = 58, bh = 26;
	if(button( "play", bx, 566, bw, bh, "PLAY", st.playing ).clicked)
		act(function(){ synth.play(); });
	if(button( "reset", bx + 68, 566, bw, bh, "RESET" ).clicked)
		act(function(){ synth.reset(); });
	var trig = button( "trigger", bx + 136, 566, bw, bh, "TRIGGER" );
	if(trig.clicked)
		act(function(){ synth.trigger(true); });
	if((trigger_held || trig.clicked) && !trig.held)
		act(function(){ synth.trigger(false); });
	trigger_held = trig.held;

	if(button( "next", bx, 624, bw, bh, "NEXT" ).clicked)
		act(function(){ synth.next(); });
	if(button( "eg", bx + 68, 624, bw, bh, "EG HOLD", s.eg_hold ).clicked)
		s.eg_hold = !s.eg_hold;
	drawLabel( "HOLD = DRONE", bx + 97, 664, 10, false, DIM_COLOR );
}

function classicPolyrhythm( gx )
{
	var s = synth.settings;
	var st = synth.state;

	drawSection( "POLYRHYTHM", gx, gx + 340, 510 );
	for(var i = 0; i < 4; ++i)
	{
		var cx = gx + 40 + i * 86;
		s.rhythm[i] = knob( "rhythm" + i, cx, 578, 24, s.rhythm[i], 1, 16, {
			label: "RHYTHM " + (i + 1), step: 1, def: 1, format: fmtDiv
		});
		drawLed( cx + 36, 538, 3.5, st.rhythm[i] && st.playing, "#ffb02f" );
		if(button( "r" + i + "s1", cx - 25, 626, 50, 20, "SEQ 1", s.rhythm_seq1[i] ).clicked)
			s.rhythm_seq1[i] = !s.rhythm_seq1[i];
		if(button( "r" + i + "s2", cx - 25, 656, 50, 20, "SEQ 2", s.rhythm_seq2[i] ).clicked)
			s.rhythm_seq2[i] = !s.rhythm_seq2[i];
	}
}

function classicFilterSection( gx )
{
	var s = synth.settings;
	var st = synth.state;

	drawSection( "VCF", gx, gx + 310, 26 );
	s.cutoff = knob( "cutoff", gx + 70, 118, 42, s.cutoff, 20, 20000, {
		label: "CUTOFF", labelSize: 13, exp: true, def: 900, format: fmtHz
	});
	s.resonance = knob( "resonance", gx + 215, 118, 34, s.resonance, 0, 1, {
		label: "RESONANCE", labelSize: 13, def: 0, format: fmtPct
	});

	drawSection( "VCF EG", gx, gx + 310, 214 );
	s.vcf_eg_amt = knob( "vcf_eg_amt", gx + 50, 268, 25, s.vcf_eg_amt, -1, 1, {
		label: "VCF EG AMT", bipolar: true, def: 0, format: fmtSigned
	});
	s.vcf_attack = knob( "vcf_attack", gx + 155, 268, 25, s.vcf_attack, 0.001, 10, {
		label: "VCF ATTACK", exp: true, def: 0.001, format: fmtTime
	});
	s.vcf_decay = knob( "vcf_decay", gx + 260, 268, 25, s.vcf_decay, 0.01, 10, {
		label: "VCF DECAY", exp: true, def: 0.3, format: fmtTime
	});
	drawLed( gx + 302, 228, 3.5, st.vcf_eg > 0.05, "#ffb02f" );

	drawSection( "VCA", gx, gx + 310, 376 );
	s.vca_attack = knob( "vca_attack", gx + 50, 432, 25, s.vca_attack, 0.001, 10, {
		label: "VCA ATTACK", exp: true, def: 0.001, format: fmtTime
	});
	s.vca_decay = knob( "vca_decay", gx + 155, 432, 25, s.vca_decay, 0.01, 10, {
		label: "VCA DECAY", exp: true, def: 0.5, format: fmtTime
	});
	s.volume = knob( "volume", gx + 260, 432, 29, s.volume, 0, 1, {
		label: "VOLUME", def: 0.7, format: fmtPct
	});
	drawLed( gx + 197, 392, 3.5, st.vca_eg > 0.05, "#ffb02f" );

	drawSection( "SEQ / QUANTIZE", gx, gx + 310, 510 );
	[[5,"±5"],[2,"±2"],[1,"±1"]].forEach(function(o, k){
		drawLed( gx + 50, 562 + k * 24, 4.5, s.seq_oct == o[0] );
		drawLabel( o[1], gx + 72, 562 + k * 24, 12 );
	});
	if(button( "seq_oct", gx + 20, 650, 70, 24, "SEQ OCT" ).clicked)
		synth.cycleSeqOct();

	var modes = [["12-ET","12-ET"],["8-ET","8-ET"],["12-JI","12-JI"],["8-JI","8-JI"],["SCL","SCALA"]];
	modes.forEach(function(m, k){
		var y = 548 + k * 22;
		var available = m[0] != "SCL" || synth.custom_scale;
		drawLed( gx + 170, y, 4.5, s.quantize == m[0] );
		drawLabel( m[1], gx + 200, y, 12, false, available ? TEXT_COLOR : "#55534e" );
	});
	if(button( "quantize", gx + 150, 666, 80, 24, "QUANTIZE" ).clicked)
		synth.cycleQuantize();
	if(s.quantize == "SCL" && synth.custom_scale)
	{
		var name = synth.custom_scale.file.replace(/\.scl$/, "");
		drawLabel( name.length > 22 ? name.substr(0, 21) + "…" : name, gx + 190, 708, 11, false, DIM_COLOR );
	}
	else if(s.quantize == "OFF")
		drawLabel( "OFF (NO QUANTIZE)", gx + 190, 708, 11, false, DIM_COLOR );
}

function classicPatchBay()
{
	jacks = {};
	for(var r = 0; r < Harm.JACKS.length; ++r)
		for(var c = 0; c < 4; ++c)
		{
			var j = Harm.JACKS[r][c];
			drawJack( j[2], 1140 + c * 80, 75 + r * 85, j[0], j[1] );
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
		row.forEach(function(j, c){
			drawJack( j[2], px + 45 + c * 80, y + 50 + r * 58, j[0], j[1] );
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
	var s = synth.settings;
	var st = synth.state;
	drawDevicePanel( x, y, w, h, "DUAL LFO", ["LOW FREQUENCY", "OSCILLATORS"] );
	var px = drawDeviceJacks( x, y, w, h, Harm.LFO_JACKS );
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
		drawLedColumn( gx + sw - 70, y + 40, Harm.LFO_SHAPES.map(function(sh){ return LFO_SHAPE_LABELS[sh]; }),
			function(k){ return lfo.shape == Harm.LFO_SHAPES[k]; } );
		if(button( "lfo" + i + "_shape", gx + sw - 80, y + 136, 58, 22, "SHAPE" ).clicked)
			lfo.shape = Harm.LFO_SHAPES[ (Harm.LFO_SHAPES.indexOf( lfo.shape ) + 1) % Harm.LFO_SHAPES.length ];
	}
}

// small retro CRT oscilloscope: green phosphor trace of the master output
function drawScope( x, y, w, h, data )
{
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

	// trace, drawn twice: a wide soft glow and a thin bright core
	var mid = y + h * 0.5, amp = h * 0.45;
	var n = data ? data.length : 0;
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
			var py = mid - clamp( data[i], -1.05, 1.05 ) * amp;
			if(i) ctx.lineTo( px, py ); else ctx.moveTo( px, py );
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
	ctx.fillText( "OUT", x + 5, y + 8 );
}

function drawCompressor( x, y, w, h )
{
	var c = synth.settings.comp;
	var st = synth.state;
	drawDevicePanel( x, y, w, h, "COMPRESSOR", ["MASTER BUS", "DYNAMICS PROCESSOR"] );
	var px = drawDeviceJacks( x, y, w, h, Harm.COMP_JACKS );
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

function drawDevices()
{
	var y = MAIN_H + DEVICE_GAP;
	var w = (PANEL_W - DEVICE_GAP) * 0.5;
	drawLfoDevice( 0, y, w, DEVICE_H );
	drawCompressor( w + DEVICE_GAP, y, w, DEVICE_H );
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
	view.scale = Math.min( w / PANEL_W, h / PANEL_H );
	view.ox = (w - PANEL_W * view.scale) * 0.5;
	view.oy = (h - PANEL_H * view.scale) * 0.5;

	ctx.setTransform( 1, 0, 0, 1, 0, 0 );
	ctx.fillStyle = "#0b0b0b";
	ctx.fillRect( 0, 0, canvas.width, canvas.height );
	ctx.setTransform( dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy );

	ui.hot = null;
	if(layout == "classic")
		drawClassicPanel();
	else
		drawHardwarePanel();
	drawDevices();
	updateCables();
	drawCables();
	drawTooltips();

	canvas.style.cursor = cable_drag ? "grabbing" : (ui.hot || jackAt( ui.x, ui.y ) ? "pointer" : "default");
}

function loop()
{
	requestAnimationFrame( loop );
	draw();
	synth.sync();
	updateToolbarFrame();

	ui.pressed = ui.released = ui.rpressed = ui.dbl = false;
	ui.wheel = 0;
	if(!ui.down && ui.active !== null)
		ui.active = null;
}

// ---------------------------------------------------------------------------
// keyboard

function isTextField( el )
{
	return el && el.closest && !!el.closest("input:not([type=range]),select,textarea");
}

// computer keyboard as a piano (toolbar "Keys" button), by physical key position:
// home row = white keys starting at C, row above = black keys, Z / X = octave down / up
var PIANO_KEYS = {
	KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
	KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17
};
var piano = { enabled: false, octave: 0, down: {} }; // down: key code -> MIDI note

function pianoNoteOff( code )
{
	var note = piano.down[ code ];
	if(note === undefined)
		return;
	delete piano.down[ code ];
	act(function(){ synth.onMIDIMessage([ 0x80, note, 0 ]); });
}

function pianoAllOff()
{
	Object.keys( piano.down ).forEach( pianoNoteOff );
}

function setPiano( enabled )
{
	pianoAllOff();
	piano.enabled = enabled;
	updatePianoButton();
	setStatus( enabled ? "Keyboard piano on: A-' white keys, W E T Y U O P black keys, Z / X octave" : "Keyboard piano off" );
}

function updatePianoButton()
{
	var btn = $("piano");
	btn.classList.toggle( "on", piano.enabled );
	btn.textContent = piano.enabled ? "Keys: C" + (4 + piano.octave) : "Keys";
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
			piano.octave = clamp( piano.octave + (e.code == "KeyX" ? 1 : -1), -3, 3 );
			updatePianoButton();
			return;
		}
		var note = 60 + piano.octave * 12 + PIANO_KEYS[ e.code ];
		piano.down[ e.code ] = note;
		act(function(){ synth.onMIDIMessage([ 0x90, note, 100 ]); });
		return;
	}
	if(e.repeat)
	{
		if(e.code == "Space")
			e.preventDefault();
		return;
	}
	switch(e.code)
	{
		case "Space": act(function(){ synth.play(); }); break;
		case "KeyR": act(function(){ synth.reset(); }); break;
		case "KeyN": act(function(){ synth.next(); }); break;
		case "KeyT": act(function(){ synth.trigger(true); }); break;
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
		act(function(){ synth.trigger(false); });
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
	var running = synth.context && synth.context.state == "running";
	$("power").textContent = running ? "Audio on" : "Audio off";
	$("power").classList.toggle( "on", !!running );
}

function updateToolbarFrame()
{
	if(document.activeElement != $("reverb"))
		$("reverb").value = synth.settings.reverb;
}

$("power").addEventListener("click", function(){
	if(!synth.context)
		ensureAudio();
	else if(synth.context.state == "running")
		synth.context.suspend().then( updateToolbar );
	else
		synth.context.resume().then( updateToolbar );
});
function setLayout( name )
{
	layout = name;
	PANEL_W = LAYOUTS[name].w;
	MAIN_H = LAYOUTS[name].h;
	PANEL_H = MAIN_H + DEVICE_GAP + DEVICE_H;
	jacks = {};
	cable_drag = null;
	$("layout").textContent = "Layout: " + LAYOUTS[name].name;
	try { localStorage.setItem( "SUBHARM_layout", name ); } catch(err) {}
}
setLayout( layout );

$("layout").addEventListener("click", function(){
	setLayout( layout == "hardware" ? "classic" : "hardware" );
});

$("piano").addEventListener("click", function(){
	ensureAudio();
	setPiano( !piano.enabled );
});
// patches: factory ones from data/patches.json plus the user's, saved in this browser
var factory_patches = [];

function refreshPatchList( selected )
{
	var sel = $("patch-select");
	var esc = function(t){ return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); };
	var html = '<option value="" disabled>Choose a patch\u2026</option><optgroup label="Factory">';
	factory_patches.forEach(function(p, i){ html += '<option value="f:' + i + '">' + esc(p.name) + '</option>'; });
	html += '</optgroup>';
	var user = Object.keys( synth.getUserPatches() ).sort();
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
	.then(function(list){ factory_patches = list; refreshPatchList(); })
	.catch(function(){ refreshPatchList(); });

$("patch-select").addEventListener("change", function(e){
	var v = e.target.value;
	if(v.substr(0, 2) == "f:")
	{
		var p = factory_patches[ v.substr(2) ];
		synth.setSettings( p.settings );
		afterPatchLoad( p.name );
	}
	else if(v.substr(0, 2) == "u:")
	{
		var name = v.substr(2);
		synth.setSettings( synth.getUserPatches()[ name ] );
		afterPatchLoad( name );
	}
	$("patch-delete").hidden = v.substr(0, 2) != "u:";
	e.target.blur();
});

$("randomize").addEventListener("click", function(){
	synth.randomize();
	refreshPatchList();
	setStatus( "Random patch: " + synth.settings.quantize + ", " + Math.round( synth.settings.tempo ) + " BPM (Save as\u2026 to keep it)" );
});

$("patch-save").addEventListener("click", function(){
	var name = window.prompt( "Save patch as:", $("patch-select").value.substr(0, 2) == "u:" ? currentPatchName() : "" );
	if(name === null)
		return;
	name = name.trim();
	if(!name)
		return;
	if(synth.getUserPatches()[ name ] && !window.confirm( "Replace the saved patch \"" + name + "\"?" ))
		return;
	if(synth.saveUserPatch( name ))
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
	synth.deleteUserPatch( name );
	refreshPatchList();
	setStatus( "Deleted patch: " + name );
});

$("patch-export").addEventListener("click", function(){
	var name = currentPatchName() || "subharm-patch";
	var blob = new Blob([ synth.exportPatch( name ) ], { type: "application/json" });
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
		var name = synth.importPatch( text ) || file.name.replace(/\.json$/i, "");
		refreshPatchList();
		afterPatchLoad( name + " (from file, use Save as\u2026 to keep it)" );
	}).catch(function(err){
		setStatus( "Could not import " + file.name + ": " + err.message );
	});
});

$("reverb").addEventListener("input", function(e){
	synth.settings.reverb = parseFloat( e.target.value );
});

// MIDI
$("midi-enable").addEventListener("click", function(){
	synth.initMIDI();
});
$("midi-input").addEventListener("change", function(e){
	synth.selectMIDIInput( e.target.value );
});
synth.onmidichange = function( midi ){
	var sel = $("midi-input");
	if(!midi.access)
	{
		setStatus( midi.status, true );
		return;
	}
	$("midi-enable").hidden = true;
	sel.hidden = false;
	var html = '<option value="all">All MIDI inputs (' + midi.inputs.length + ')</option>';
	midi.inputs.forEach(function(input){
		html += '<option value="' + input.id.replace(/"/g, "&quot;") + '">' + (input.name || input.id).replace(/</g, "&lt;") + '</option>';
	});
	sel.innerHTML = html;
	sel.value = midi.selected;
	if(sel.value != midi.selected)
		sel.value = "all";
};

// Scala scales
var scale_index = null;

function syncScaleInput()
{
	$("scale").value = synth.settings.scale_file || "";
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
		synth.clearScale();
		return;
	}
	if(scale_index && !(file in scale_index))
	{
		setStatus( "Unknown scale: " + file );
		return;
	}
	synth.loadScale( file ).then(function(scale){
		setStatus( "Scale: " + (scale.description || file) + " (" + (scale.degrees.length) + " notes)" );
		e.target.blur();
	}, function(err){
		setStatus( "Could not load " + file + ": " + err.message );
	});
});
$("scale-clear").addEventListener("click", function(){
	synth.clearScale();
	syncScaleInput();
});

loop();
