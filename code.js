// code.js
// Panel UI of the Subharmonicon replica: canvas drawing, immediate mode
// widgets (knobs, buttons, switches, LEDs), patch bay cables, toolbar and
// keyboard shortcuts. The synth engine is in harm.js / harm-worklet.js.

var canvas = document.getElementById("panel");
var ctx = canvas.getContext("2d");
var FONT = "Antonio, Oswald, 'Arial Narrow', sans-serif";
var PANEL_W = 1460, PANEL_H = 750;
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

// o: { label, exp, step, def, format, bipolar, size }
function knob( id, cx, cy, r, value, min, max, o )
{
	o = o || {};
	var range = o.exp ? Math.log( max / min ) : (max - min);
	var toN = function(v) { return o.exp ? Math.log( v / min ) / range : (v - min) / range; };
	var fromN = function(n) { return o.exp ? min * Math.exp( n * range ) : min + n * range; };

	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitCircle( cx, cy, r * 1.2 );
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
		if(o.step)
			value -= ui.wheel * o.step;
		else
			value = fromN( clamp( toN(value) - ui.wheel * (ui.shift ? 0.005 : 0.025), 0, 1 ) );
		ui.wheel = 0;
	}
	if(o.step)
		value = Math.round( value / o.step ) * o.step;
	value = clamp( value, min, max );

	var ticks = o.step ? Math.round( (max - min) / o.step ) + 1 : 11;
	drawKnob( cx, cy, r, clamp( toN(value), 0, 1 ), hover || ui.active === id, ticks, o.bipolar );
	if(o.label)
		drawLabel( o.label, cx, cy - r - 16, o.labelSize || 12 );
	if((hover || ui.active === id) && o.format)
		tooltips.push([ o.format( value ), cx, cy + r + 15 ]);
	return value;
}

function drawKnob( cx, cy, r, n, highlight, ticks, bipolar )
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

// o: { text, led, label }. returns { clicked, held }
function button( id, x, y, w, h, o )
{
	o = o || {};
	var hover = !cable_drag && (ui.active === null || ui.active === id) && hitRect( x, y, w, h );
	var clicked = false;
	if(hover && ui.pressed && ui.active === null)
	{
		ui.active = id;
		clicked = true;
	}
	var held = ui.active === id && ui.down;

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
	if(o.led !== undefined)
	{
		drawLed( x + 9, y + h * 0.5 + (held ? 1 : 0), 3.2, o.led );
		tx += 5;
	}
	if(o.text)
	{
		ctx.font = "12px " + FONT;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#151515";
		ctx.fillText( o.text, tx, y + h * 0.5 + 1 + (held ? 1 : 0) );
	}
	if(o.label)
		drawLabel( o.label, x + w * 0.5, y + h + 13, 11 );
	return { clicked: clicked, held: held };
}

// VCO wave switch: up = saw, down = square
function waveSwitch( id, x, y, value )
{
	var w = 16, h = 40;
	var hover = !cable_drag && ui.active === null && hitRect( x - 6, y - 14, w + 12, h + 28 );
	if(hover && ui.pressed)
	{
		ui.active = id;
		value = value == "saw" ? "square" : "saw";
	}
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( x, y, w, h, 3 ); ctx.fill();
	var up = value == "saw";
	var g = ctx.createLinearGradient( x, 0, x + w, 0 );
	g.addColorStop( 0, "#d8d8d2" );
	g.addColorStop( 1, "#8a8a84" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( x + 2, up ? y + 2 : y + h * 0.5, w - 4, h * 0.5 - 2, 2 ); ctx.fill();

	// saw icon above, square icon below
	ctx.strokeStyle = up ? TEXT_COLOR : DIM_COLOR;
	ctx.lineWidth = 1.5;
	var ix = x + w * 0.5 - 8, iy = y - 8;
	ctx.beginPath();
	ctx.moveTo( ix, iy + 4 ); ctx.lineTo( ix + 8, iy - 4 ); ctx.lineTo( ix + 8, iy + 4 ); ctx.lineTo( ix + 16, iy - 4 ); ctx.lineTo( ix + 16, iy + 4 );
	ctx.stroke();
	ctx.strokeStyle = up ? DIM_COLOR : TEXT_COLOR;
	iy = y + h + 9;
	ctx.beginPath();
	ctx.moveTo( ix, iy + 4 ); ctx.lineTo( ix, iy - 4 ); ctx.lineTo( ix + 8, iy - 4 ); ctx.lineTo( ix + 8, iy + 4 ); ctx.lineTo( ix + 16, iy + 4 ); ctx.lineTo( ix + 16, iy - 4 );
	ctx.stroke();
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

	if(type == "out")
		drawLabel( label, x, y - 25, 11, true );
	else
		drawLabel( label, x, y - 25, 11 );

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
		drawLed( x + 20, y - 12, 2.5, active, "#3bd16f" );
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
	var sag = 20 + d * 0.3;
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
// panel

function drawPanelBackground()
{
	// wooden cheeks
	[0, PANEL_W - 22].forEach(function(x){
		var g = ctx.createLinearGradient( x, 0, x + 22, 0 );
		g.addColorStop( 0, "#4a2c18" );
		g.addColorStop( 0.5, "#8a5a34" );
		g.addColorStop( 1, "#5a3620" );
		ctx.fillStyle = g;
		ctx.fillRect( x, 0, 22, PANEL_H );
		ctx.strokeStyle = "rgba(40,20,8,0.35)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for(var i = 0; i < 6; ++i)
		{
			var xx = x + 3 + i * 3.4;
			ctx.moveTo( xx, 0 );
			ctx.bezierCurveTo( xx + 2, PANEL_H * 0.3, xx - 2, PANEL_H * 0.6, xx + 1, PANEL_H );
		}
		ctx.stroke();
	});

	var g = ctx.createLinearGradient( 0, 0, 0, PANEL_H );
	g.addColorStop( 0, "#1c1c1b" );
	g.addColorStop( 1, "#121212" );
	ctx.fillStyle = g;
	ctx.fillRect( 22, 0, PANEL_W - 44, PANEL_H );

	// patch bay plate
	ctx.fillStyle = "#222220";
	ctx.beginPath(); ctx.roundRect( 1095, 18, 330, 712, 8 ); ctx.fill();
	ctx.strokeStyle = "#353532";
	ctx.lineWidth = 1;
	ctx.stroke();

	drawScrew( 36, 14 ); drawScrew( PANEL_W - 36, 14 );
	drawScrew( 36, PANEL_H - 14 ); drawScrew( PANEL_W - 36, PANEL_H - 14 );

	ctx.font = "26px " + FONT;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "SUBHARM", 50, PANEL_H - 24 );
	ctx.font = "12px " + FONT;
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( "POLYRHYTHMIC SUBHARMONIC SYNTHESIZER", 150, PANEL_H - 22 );
}

function drawOscillatorGroup( i, gx )
{
	var s = synth.settings;
	var osc = s.vco[i];
	var st = synth.state;
	var n = i + 1;

	drawSection( "VCO " + n, gx, gx + 340, 26 );

	osc.freq = knob( "vco" + n + "_freq", gx + 70, 118, 42, osc.freq, 32.70, 1046.5, {
		label: "VCO " + n + " FREQ", labelSize: 13, exp: true, def: i == 0 ? 130.81 : 196.0,
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
		if(button( "assign" + n + l[3], l[2] - 25, 310, 50, 20, { text: l[4], led: assign[ l[3] ] } ).clicked)
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

function drawClockSection( gx )
{
	var s = synth.settings;
	var st = synth.state;

	drawSection( "CLOCK", gx, gx + 340, 510 );
	s.tempo = knob( "tempo", gx + 70, 600, 38, s.tempo, 10, 1200, {
		label: "TEMPO", labelSize: 13, exp: true, def: 120,
		format: function(v){ return Math.round(v) + " BPM"; }
	});
	drawLed( gx + 122, 558, 4, st.clock && st.playing, "#ffb02f" );
	var src = st.clock_source == "internal" ? Math.round( s.tempo ) + " BPM" : (st.clock_source == "midi" ? "MIDI CLOCK" : "EXT CLOCK");
	drawLabel( src, gx + 70, 660, 11, false, DIM_COLOR );

	var bx = gx + 148, bw = 58, bh = 26;
	if(button( "play", bx, 566, bw, bh, { text: "PLAY", led: st.playing } ).clicked)
		act(function(){ synth.play(); });
	if(button( "reset", bx + 68, 566, bw, bh, { text: "RESET" } ).clicked)
		act(function(){ synth.reset(); });
	var trig = button( "trigger", bx + 136, 566, bw, bh, { text: "TRIGGER" } );
	if(trig.clicked)
		act(function(){ synth.trigger(true); });
	if((trigger_held || trig.clicked) && !trig.held)
		act(function(){ synth.trigger(false); });
	trigger_held = trig.held;

	if(button( "next", bx, 624, bw, bh, { text: "NEXT" } ).clicked)
		act(function(){ synth.next(); });
	if(button( "vca_eg", bx + 68, 624, bw, bh, { text: "VCA EG", led: s.vca_eg } ).clicked)
		s.vca_eg = !s.vca_eg;
	drawLabel( "EG OFF = DRONE", bx + 97, 664, 10, false, DIM_COLOR );
}

function drawPolyrhythm( gx )
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
		if(button( "r" + i + "s1", cx - 25, 626, 50, 20, { text: "SEQ 1", led: s.rhythm_seq1[i] } ).clicked)
			s.rhythm_seq1[i] = !s.rhythm_seq1[i];
		if(button( "r" + i + "s2", cx - 25, 656, 50, 20, { text: "SEQ 2", led: s.rhythm_seq2[i] } ).clicked)
			s.rhythm_seq2[i] = !s.rhythm_seq2[i];
	}
}

function drawFilterSection( gx )
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
	if(button( "seq_oct", gx + 20, 650, 70, 24, { text: "SEQ OCT" } ).clicked)
		synth.cycleSeqOct();

	var modes = [["12-ET","12-ET"],["8-ET","8-ET"],["12-JI","12-JI"],["8-JI","8-JI"],["SCL","SCALA"]];
	modes.forEach(function(m, k){
		var y = 548 + k * 22;
		var available = m[0] != "SCL" || synth.custom_scale;
		drawLed( gx + 170, y, 4.5, s.quantize == m[0] );
		drawLabel( m[1], gx + 200, y, 12, false, available ? TEXT_COLOR : "#55534e" );
	});
	if(button( "quantize", gx + 150, 666, 80, 24, { text: "QUANTIZE" } ).clicked)
		synth.cycleQuantize();
	if(s.quantize == "SCL" && synth.custom_scale)
	{
		var name = synth.custom_scale.file.replace(/\.scl$/, "");
		drawLabel( name.length > 22 ? name.substr(0, 21) + "…" : name, gx + 190, 708, 11, false, DIM_COLOR );
	}
	else if(s.quantize == "OFF")
		drawLabel( "OFF (NO QUANTIZE)", gx + 190, 708, 11, false, DIM_COLOR );
}

function drawPatchBay()
{
	jacks = {};
	for(var r = 0; r < Harm.JACKS.length; ++r)
		for(var c = 0; c < 4; ++c)
		{
			var j = Harm.JACKS[r][c];
			drawJack( j[2], 1140 + c * 80, 75 + r * 85, j[0], j[1] );
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
	view.scale = Math.min( w / PANEL_W, h / PANEL_H );
	view.ox = (w - PANEL_W * view.scale) * 0.5;
	view.oy = (h - PANEL_H * view.scale) * 0.5;

	ctx.setTransform( 1, 0, 0, 1, 0, 0 );
	ctx.fillStyle = "#0b0b0b";
	ctx.fillRect( 0, 0, canvas.width, canvas.height );
	ctx.setTransform( dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy );

	ui.hot = null;
	drawPanelBackground();
	drawOscillatorGroup( 0, 40 );
	drawOscillatorGroup( 1, 400 );
	drawClockSection( 40 );
	drawPolyrhythm( 400 );
	drawFilterSection( 765 );
	drawPatchBay();
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
