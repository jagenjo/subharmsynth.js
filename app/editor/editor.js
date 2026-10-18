// editor/editor.js
// SYNTH EDITOR: builds the custom synths (editor/custom.js). A full-screen overlay over the rack:
//   FRONT PANEL: the device as it looks in the rack (drawn by its own code, with the rack's widgets
//     made inert); drag items from the palette onto it, move them, resize sections, sliders, buttons.
//   INSIDE: every item with inputs or outputs, and the modules (oscillators, filters...), as nodes with
//     ports; drag a wire from an output to an input (an input takes one wire; dragging a wired input
//     takes the wire off it). The panel's items keep their places, a little further apart.
// The design is the device's settings, edited live: the synth plays while it is being built.
// My synths: designs saved in this browser, added from ADD DEVICE (Custom).

(function(){

var CS = WR.CustomSynth, CAT = CS.CAT;
var SPREAD = 1.5, SNAP = 5, LIB_KEY = "GASFREE_synths";
var ed = { mid: null, view: "front", sel: null, drag: null, hover: null, pan: { x: 40, y: 40 }, zoom: 0.75, fitted: false, raf: 0, fit: null, suppress: false };
var el = {};

function $e( tag, cls, html ) { var d = document.createElement( tag ); if(cls) d.className = cls; if(html !== undefined) d.innerHTML = html; return d; }
function esc( t ) { return String( t ).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
function mod() { return rack.settings.modules.find(function(m){ return m.id == ed.mid; }); }
function S() { var m = mod(); return m ? m.settings : null; }
function def() { var m = mod(); return m ? WR.types[ m.type ] : null; }
function snap( v ) { return Math.round( v / SNAP ) * SNAP; }
function hint( t ) { el.hint.textContent = t; }
function byId( id ) { var s = S(); return s.items.find(function(i){ return i.id == id; }) || s.nodes.find(function(n){ return n.id == id; }); }
function newId( kind ) { var s = S(); var id; do { id = kind + (s.next++); } while(byId( id )); return id; }
function titleOf( x ) { var sp = CAT.specOf( x.kind ); return sp ? sp.title : x.kind; }
function nameOf( x ) { return x.label || x.text || x.title || titleOf( x ); }

// ---------------------------------------------------------------------------
// building the overlay (once)

function build()
{
	if(el.root) return;
	var root = el.root = $e( "div" ); root.id = "se"; root.hidden = true;
	var top = $e( "div", "se-top" );
	top.innerHTML = '<span class="se-logo">SYNTH EDITOR</span>' +
		'<input class="se-name" maxlength="24" title="The synth\'s name" />' +
		'<label>Width <select data-f="width"><option value="full">Full</option><option value="half">Half</option></select></label>' +
		'<label>Height <select data-f="height">' + CS.HEIGHTS.map(function(h, i){ return '<option value="' + i + '">' + (i + 1) + ' unit' + (i ? 's' : '') + '</option>'; }).join("") + '</select></label>' +
		'<label>Panel <select data-f="color">' + Object.keys( CS.COLORS ).map(function(k){ return '<option value="' + k + '">' + CS.COLORS[k].name + '</option>'; }).join("") + '</select></label>' +
		'<label>Knobs <select data-f="knob_skin">' + WR.KNOB_SKINS.filter(function(k){ return k; }).map(function(k){ return '<option value="' + k + '">' + k + '</option>'; }).join("") + '</select></label>' +
		'<label><input type="checkbox" data-f="wood" /> Wood sides</label>' +
		'<div class="se-tabs"><button data-view="front">FRONT PANEL</button><button data-view="inside">INSIDE</button></div>' +
		'<span class="se-spacer"></span>' +
		'<button class="se-save" title="Keep this design in My synths (ADD DEVICE, Custom)">Save to My synths</button>' +
		'<button class="se-done" title="Back to the rack (Escape)">Done</button>';
	var body = $e( "div", "se-body" );
	el.palette = $e( "div", "se-palette" );
	el.stage = $e( "div", "se-stage" );
	el.front = $e( "canvas", "se-front" );
	el.inside = $e( "div", "se-inside" );
	el.world = $e( "div", "se-world" );
	el.svg = document.createElementNS( "http://www.w3.org/2000/svg", "svg" ); el.svg.setAttribute( "class", "se-wires" );
	el.nodes = $e( "div", "se-nodes" );
	el.world.appendChild( el.svg ); el.world.appendChild( el.nodes ); el.inside.appendChild( el.world );
	el.stage.appendChild( el.front ); el.stage.appendChild( el.inside );
	el.props = $e( "div", "se-props" );
	body.appendChild( el.palette ); body.appendChild( el.stage ); body.appendChild( el.props );
	el.hint = $e( "div", "se-hint" );
	root.appendChild( top ); root.appendChild( body ); root.appendChild( el.hint );
	document.body.appendChild( root );
	el.top = top; el.name = top.querySelector( ".se-name" );

	// the top bar
	el.name.addEventListener("input", function(){
		var s = S(), old = s.name, nu = el.name.value.toUpperCase().substr( 0, 24 );
		// the panel's title label follows the name, while it shows the name
		var title = s.items.find(function(i){ return i.kind == "label" && i.text == old; });
		if(title) title.text = nu;
		s.name = nu;
	});
	top.querySelectorAll( "[data-f]" ).forEach(function(f){
		f.addEventListener("change", function(){
			var s = S(), k = f.getAttribute( "data-f" );
			if(k == "width") mod().type = f.value == "half" ? "custom_half" : "custom";
			else if(k == "height") s.height = +f.value;
			else if(k == "wood") s.wood = f.checked;
			else s[k] = f.value;
		});
	});
	top.querySelectorAll( "[data-view]" ).forEach(function(b){ b.addEventListener("click", function(){ setView( b.getAttribute( "data-view" ) ); }); });
	top.querySelector( ".se-done" ).addEventListener("click", close);
	top.querySelector( ".se-save" ).addEventListener("click", saveToLibrary);

	frontEvents();
	insideEvents();
	window.addEventListener("keydown", onKey, true);
	window.addEventListener("resize", function(){ if(!el.root.hidden && ed.view == "inside") drawWires(); });
}

// ---------------------------------------------------------------------------
// open / close / views

function open( mid )
{
	if(ed.suppress) return;
	build();
	ed.mid = mid; ed.sel = null; ed.fitted = false;
	if(!mod()) return;
	el.root.hidden = false;
	refreshTop();
	setView( "front" );
	renderProps();
	if(!ed.raf) loop();
	if(window.gfTrack) gfTrack( "synth-editor", null, true );
}

function close()
{
	if(!el.root || el.root.hidden) return;
	el.root.hidden = true;
	cancelAnimationFrame( ed.raf ); ed.raf = 0;
	ed.drag = null;
}

function refreshTop()
{
	var s = S(), m = mod();
	el.name.value = s.name || "";
	el.top.querySelector( '[data-f="width"]' ).value = m.type == "custom_half" ? "half" : "full";
	el.top.querySelector( '[data-f="height"]' ).value = s.height;
	el.top.querySelector( '[data-f="color"]' ).value = s.color;
	el.top.querySelector( '[data-f="knob_skin"]' ).value = s.knob_skin || "lm";
	el.top.querySelector( '[data-f="wood"]' ).checked = !!s.wood;
}

function setView( v )
{
	ed.view = v;
	el.top.querySelectorAll( "[data-view]" ).forEach(function(b){ b.classList.toggle( "on", b.getAttribute( "data-view" ) == v ); });
	el.front.hidden = v != "front";
	el.inside.hidden = v != "inside";
	renderPalette();
	if(v == "inside") { renderInside(); if(!ed.fitted) { fitInside(); ed.fitted = true; } }
	hint( v == "front"
		? "Drag items from the left onto the panel (or click them). Drag to move; drag the corner of a section, slider or button to resize it. Delete removes; arrows nudge; Ctrl+D duplicates. Play the keys to hear the synth."
		: "Drag from an output (right) to an input (left) to wire them; drag a wired input to move or remove its wire. Drag a node by its title; drag the background to pan, the wheel zooms. A knob takes the range of the first input it is wired to." );
}

// ---------------------------------------------------------------------------
// the palette

function renderPalette()
{
	var h = "";
	if(ed.view == "front")
	{
		var items = [ ["knob:s", "KNOB SMALL"], ["knob:m", "KNOB"], ["knob:l", "KNOB LARGE"], ["slider", "SLIDER"], ["button", "BUTTON", "momentary: a gate while held"],
			["toggle", "SWITCH", "on / off"], ["led", "LED", "lights with its input"], ["jackin", "JACK IN", "a socket: signals from the rack"], ["jackout", "JACK OUT", "a socket: signals to the rack"],
			["label", "LABEL", "text"], ["section", "SECTION", "a panel area with a title"], ["screw", "SCREW"] ];
		h += "<h4>PANEL ITEMS</h4>";
		items.forEach(function(it){ h += '<button class="se-pal" draggable="true" data-add="' + it[0] + '">' + it[1] + (it[2] ? '<small>' + it[2] + '</small>' : '') + '</button>'; });
	}
	else
	{
		var cats = {};
		Object.keys( CAT.MODULES ).forEach(function(k){ var m = CAT.MODULES[k]; if(m.fixed) return; (cats[ m.cat ] = cats[ m.cat ] || []).push( k ); });
		Object.keys( cats ).forEach(function(c){
			h += "<h4>" + c.toUpperCase() + "</h4>";
			cats[c].forEach(function(k){ var m = CAT.MODULES[k]; h += '<button class="se-pal" draggable="true" data-add="' + k + '" title="' + esc( m.about || "" ) + '">' + m.title + '</button>'; });
		});
		h += '<h4>PANEL ITEMS</h4><p style="color:#8c8a84;font:12px system-ui;margin:0">Knobs, buttons, LEDs and jacks are added on the FRONT PANEL; they appear here with their ports.</p>';
	}
	el.palette.innerHTML = h;
	el.palette.querySelectorAll( "[data-add]" ).forEach(function(b){
		b.addEventListener("click", function(){ add( b.getAttribute( "data-add" ), null ); });
		b.addEventListener("dragstart", function(e){ e.dataTransfer.setData( "text/plain", b.getAttribute( "data-add" ) ); e.dataTransfer.effectAllowed = "copy"; });
	});
}

// adds a panel item ("knob:m", "led"...) or a module ("osc"...); at: where (panel or inside coordinates)
function add( what, at )
{
	var s = S(), kind = what.split( ":" )[0], sub = what.split( ":" )[1];
	if(CAT.MODULES[ kind ])
	{
		var c = at || insideCenter();
		var n = { id: newId( kind ), kind: kind, x: snap( c.x - 84 ), y: snap( c.y - 30 ) };
		s.nodes.push( n );
		select({ type: "node", id: n.id });
		renderInside();
		return n;
	}
	var size = def().size( layout, s ), p = at || freeSpot( size );
	var it = { id: newId( kind ), kind: kind, x: snap( p.x ), y: snap( p.y ) };
	var count = s.items.filter(function(i){ return i.kind == kind; }).length + 1;
	switch(kind)
	{
		case "knob": it.size = sub || "m"; it.label = "KNOB " + count; break;
		case "slider": it.h = 120; it.label = "SLIDER " + count; break;
		case "button": it.w = 70; it.h = 26; it.label = "BUTTON"; break;
		case "toggle": it.w = 70; it.h = 26; it.label = "SWITCH"; break;
		case "led": it.color = "red"; break;
		case "jackin": case "jackout":
			var used = s.items.filter(function(i){ return i.kind == kind; }).map(function(i){ return i.slot; });
			var slot = 1; while(used.indexOf( slot ) >= 0) slot++;
			if(slot > CAT.SLOTS) { hint( "No more " + (kind == "jackin" ? "input" : "output") + " jacks: " + CAT.SLOTS + " at most" ); return null; }
			it.slot = slot; it.mode = "cv"; it.label = (kind == "jackin" ? "IN " : "OUT ") + slot; break;
		case "label": it.text = "LABEL"; it.size = 16; break;
		case "section": it.w = 240; it.h = 150; it.title = "SECTION"; it.x = snap( p.x - 120 ); it.y = snap( p.y - 75 ); break;
	}
	s.items.push( it );
	select({ type: "item", id: it.id });
	if(ed.view == "inside") renderInside();
	return it;
}

// a place on the panel: the middle, moved along until nothing is there
function freeSpot( size )
{
	var x = size[0] / 2, y = size[1] / 2, tries = 0;
	while(tries++ < 40 && hitItem({ x: x, y: y }, true)) { x += 60; if(x > size[0] - 60) { x = 120; y += 60; if(y > size[1] - 30) y = 60; } }
	return { x: x, y: y };
}

function remove( sel )
{
	var s = S();
	if(!sel) return;
	if(sel.type == "wire") s.wires.splice( sel.index, 1 );
	else
	{
		var x = byId( sel.id );
		if(!x) return;
		if(x.kind == "out") { hint( "The AUDIO OUT stays: it is where the synth's sound leaves" ); return; }
		s.items = s.items.filter(function(i){ return i.id != sel.id; });
		s.nodes = s.nodes.filter(function(n){ return n.id != sel.id; });
		s.wires = s.wires.filter(function(w){ return w.from[0] != sel.id && w.to[0] != sel.id; });
	}
	ed.sel = null;
	renderProps();
	if(ed.view == "inside") renderInside();
}

function duplicate( id )
{
	var s = S(), x = byId( id );
	if(!x || x.kind == "out") return;
	if(x.kind == "jackin" || x.kind == "jackout") { var it = add( x.kind, { x: x.x + 50, y: x.y } ); if(it) { it.mode = x.mode; } return; }
	var c = JSON.parse( JSON.stringify( x ) );
	c.id = newId( x.kind ); c.x += 30; c.y += 30; delete c.ix; delete c.iy;
	(CAT.MODULES[ x.kind ] ? s.nodes : s.items).push( c );
	select({ type: CAT.MODULES[ x.kind ] ? "node" : "item", id: c.id });
	if(ed.view == "inside") renderInside();
}

function select( sel ) { ed.sel = sel; renderProps(); if(ed.view == "inside") markSelection(); }

// ---------------------------------------------------------------------------
// FRONT PANEL: drawn by the device's own code, the rack's widgets made inert

function loop()
{
	ed.raf = requestAnimationFrame( loop );
	if(el.root.hidden) return;
	if(!mod()) { close(); return; } // the device was removed
	if(ed.view == "front") renderFront();
	else if(ed.leds) updateInsideLeds();
}

function renderFront()
{
	var cv = el.front, c = cv.getContext( "2d" ), dpr = window.devicePixelRatio || 1;
	var W = el.stage.clientWidth, H = el.stage.clientHeight;
	if(cv.width != Math.round( W * dpr ) || cv.height != Math.round( H * dpr )) { cv.width = Math.round( W * dpr ); cv.height = Math.round( H * dpr ); }
	var m = mod(), d = def(), size = d.size( layout, m.settings );
	var ext = [ size[0], size[1] ];
	m.settings.items.forEach(function(it){ var b = CS.box( it ); ext[0] = Math.max( ext[0], b.x + b.w + 10 ); ext[1] = Math.max( ext[1], b.y + b.h + 10 ); });
	var k = Math.min( (W - 60) / ext[0], (H - 60) / ext[1], 1.5 ), ox = (W - ext[0] * k) / 2, oy = (H - ext[1] * k) / 2;
	ed.fit = { k: k, ox: ox, oy: oy, w: size[0], h: size[1] };
	c.setTransform( 1, 0, 0, 1, 0, 0 );
	c.clearRect( 0, 0, cv.width, cv.height );
	c.setTransform( dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy );
	var keep = { ctx: ctx, ui: ui, jacks: jacks, id_prefix: id_prefix, tooltips: tooltips, cable_drag: cable_drag, knob_skin: knob_skin, learn: midictl.learn, hover: hover_control, frame: frame };
	ctx = c; jacks = {}; id_prefix = "__se__."; tooltips = []; cable_drag = null; midictl.learn = false; frame = { ox: 0, oy: 0, k: 1 };
	ui = { px: -1e9, py: -1e9, x: -1e9, y: -1e9, down: false, pressed: false, released: false, rpressed: false, dbl: false, shift: false, wheel: 0, wheel_x: 0,
		active: "__se__", hot: null, startY: 0, startN: 0, dragShift: false, lastDownTime: 0, lastDownPos: [0, 0] };
	knob_skin = m.settings.knob_skin || d.knob_skin || null;
	try { CS.draw({ id: m.id, type: m.type, def: d, settings: m.settings, state: rack.module_state[ m.id ] || {}, post: function(){}, editing: true }); }
	finally {
		ctx = keep.ctx; ui = keep.ui; jacks = keep.jacks; id_prefix = keep.id_prefix; tooltips = keep.tooltips; cable_drag = keep.cable_drag;
		knob_skin = keep.knob_skin; midictl.learn = keep.learn; hover_control = keep.hover; frame = keep.frame; casing_wood = false;
	}
	// items left outside the panel (it was made smaller): outlined in red, they are not seen in the rack
	var outside = 0;
	m.settings.items.forEach(function(it){
		var b = CS.box( it );
		if(b.x + b.w > 4 && b.y + b.h > 4 && b.x < size[0] - 4 && b.y < size[1] - 4) return;
		outside++;
		c.strokeStyle = "#ff4a3a"; c.lineWidth = 2 / k; c.setLineDash([ 4 / k, 3 / k ]); c.strokeRect( b.x, b.y, b.w, b.h ); c.setLineDash([]);
	});
	if(outside != ed.outside) { ed.outside = outside; if(outside) hint( outside + " item" + (outside > 1 ? "s are" : " is") + " outside the panel (outlined in red): drag them in, or make the panel bigger" ); }
	// the selection, the item under the mouse, the resize corner
	var sel = ed.sel && ed.sel.type == "item" ? byId( ed.sel.id ) : null;
	if(ed.hover && ed.hover !== sel) { var hb = CS.box( ed.hover ); c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1 / k; c.strokeRect( hb.x, hb.y, hb.w, hb.h ); }
	if(sel)
	{
		var b = CS.box( sel );
		c.strokeStyle = "#e2574c"; c.lineWidth = 2 / k; c.setLineDash([ 6 / k, 4 / k ]); c.strokeRect( b.x - 2, b.y - 2, b.w + 4, b.h + 4 ); c.setLineDash([]);
		if(resizable( sel )) { var hs = 10 / k; c.fillStyle = "#e2574c"; c.fillRect( b.x + b.w + 2 - hs / 2, b.y + b.h + 2 - hs / 2, hs, hs ); }
	}
}

function resizable( it ) { return it.kind == "section" || it.kind == "slider" || it.kind == "button" || it.kind == "toggle"; }

function toPanel( e )
{
	var r = el.front.getBoundingClientRect(), f = ed.fit;
	return { x: (e.clientX - r.left - f.ox) / f.k, y: (e.clientY - r.top - f.oy) / f.k };
}

// the item at p: the controls over the sections they are on
function hitItem( p, any )
{
	var items = S().items, inside = function(it){ var b = CS.box( it ); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; };
	for(var i = items.length - 1; i >= 0; --i) if(items[i].kind != "section" && inside( items[i] )) return items[i];
	for(var i = items.length - 1; i >= 0; --i) if(items[i].kind == "section" && inside( items[i] )) return any ? items[i] : items[i];
	return null;
}

function frontEvents()
{
	var cv = el.front;
	cv.addEventListener("pointerdown", function(e){
		if(!ed.fit) return;
		var p = toPanel( e ), sel = ed.sel && ed.sel.type == "item" ? byId( ed.sel.id ) : null;
		if(sel && resizable( sel ))
		{
			var b = CS.box( sel ), hs = 12 / ed.fit.k;
			if(Math.abs( p.x - (b.x + b.w) ) < hs && Math.abs( p.y - (b.y + b.h) ) < hs)
			{
				ed.drag = { mode: "resize", it: sel, sx: p.x, sy: p.y, w0: sel.w || (sel.kind == "section" ? 200 : 70), h0: sel.h || (sel.kind == "section" ? 120 : sel.kind == "slider" ? 120 : 26) };
				cv.setPointerCapture( e.pointerId );
				return;
			}
		}
		var hit = hitItem( p );
		if(hit)
		{
			select({ type: "item", id: hit.id });
			ed.drag = { mode: "move", it: hit, dx: p.x - hit.x, dy: p.y - hit.y };
			cv.setPointerCapture( e.pointerId );
		}
		else select( null );
	});
	cv.addEventListener("pointermove", function(e){
		if(!ed.fit) return;
		var p = toPanel( e ), d = ed.drag, f = ed.fit;
		if(d && d.mode == "move")
		{
			d.it.x = Math.max( 0, Math.min( f.w, snap( p.x - d.dx ) ) );
			d.it.y = Math.max( 0, Math.min( f.h, snap( p.y - d.dy ) ) );
			delete d.it.ix; delete d.it.iy; // inside, it follows its new place
		}
		else if(d && d.mode == "resize")
		{
			var it = d.it;
			if(it.kind == "slider") it.h = Math.max( 40, snap( d.h0 + p.y - d.sy ) );
			else { it.w = Math.max( 30, snap( d.w0 + p.x - d.sx ) ); it.h = Math.max( 16, snap( d.h0 + p.y - d.sy ) ); }
		}
		else { ed.hover = hitItem( p ); cv.style.cursor = ed.hover ? "move" : "default"; }
	});
	var up = function(){ if(ed.drag) { ed.drag = null; renderProps(); } };
	cv.addEventListener("pointerup", up);
	cv.addEventListener("pointercancel", up);
	cv.addEventListener("pointerleave", function(){ ed.hover = null; });
	cv.addEventListener("dragover", function(e){ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
	cv.addEventListener("drop", function(e){
		e.preventDefault();
		var what = e.dataTransfer.getData( "text/plain" );
		if(what && !CAT.MODULES[ what.split( ":" )[0] ]) add( what, toPanel( e ) );
	});
}

// ---------------------------------------------------------------------------
// INSIDE: nodes and wires

var OUT_KIND = { gate: "gate", on: "gate", pitch: "pitch", cv: "pitch", vel: "cv", value: "cv", env: "cv", out: "cv" };
function wireColor( src, out )
{
	var k = src ? src.kind : "";
	if(out == "gate" || out == "on") return "#e8c547";
	if(out == "pitch" || k == "quant" || (k == "seq" && out == "cv")) return "#4fa3e0";
	if(["osc", "noise", "filter", "vca", "mix", "drive", "delay"].indexOf( k ) >= 0) return "#e05a47";
	return "#6cc070";
}

function innerPos( x )
{
	if(CAT.MODULES[ x.kind ]) return { x: x.x, y: x.y };
	return { x: x.ix !== undefined ? x.ix : snap( x.x * SPREAD ), y: x.iy !== undefined ? x.iy : snap( x.y * SPREAD ) };
}

function wiredInto( id, key ) { return S().wires.find(function(w){ return w.to[0] == id && w.to[1] == key; }); }

function renderInside()
{
	var s = S();
	el.nodes.innerHTML = "";
	ed.ports = {}; ed.leds = [];
	var all = s.items.filter(function(i){ var sp = CAT.specOf( i.kind ); return sp && !sp.deco; }).concat( s.nodes );
	all.forEach(function(x){
		var sp = CAT.specOf( x.kind ), isCtl = !CAT.MODULES[ x.kind ], p = innerPos( x );
		var n = $e( "div", "se-node" + (isCtl ? " ctl" : "") );
		n.setAttribute( "data-id", x.id );
		n.style.left = p.x + "px"; n.style.top = p.y + "px";
		var head = $e( "div", "se-head", esc( sp.title ) + (isCtl && nameOf( x ) != sp.title ? '<small>' + esc( nameOf( x ) ) + '</small>' : '') );
		head.setAttribute( "data-drag", x.id );
		n.appendChild( head );
		var ports = $e( "div", "se-ports" ), ci = $e( "div", "se-col in" ), co = $e( "div", "se-col out" );
		sp.ins.forEach(function(inp){
			var w = wiredInto( x.id, inp[0] ), row = $e( "div", "se-row" ), dot = $e( "span", "se-port in" + (w ? " on" : "") );
			dot.setAttribute( "data-node", x.id ); dot.setAttribute( "data-port", inp[0] ); dot.setAttribute( "data-dir", "in" );
			dot.title = inp[1] + (w ? "" : ": " + CAT.fmt( { min: inp[2], max: inp[3], unit: inp[5] }, constOf( x, inp ) ));
			row.appendChild( dot );
			row.appendChild( document.createTextNode( inp[1] ) );
			if(!w && inp[5] != "audio" && inp[5] != "gate") { var c = $e( "i", "", esc( CAT.fmt( { min: inp[2], max: inp[3], unit: inp[5] }, constOf( x, inp ) ) ) ); row.appendChild( c ); }
			ci.appendChild( row );
			ed.ports[ x.id + "|in|" + inp[0] ] = dot;
		});
		sp.outs.forEach(function(o){
			var row = $e( "div", "se-row" ), dot = $e( "span", "se-port out" + (s.wires.some(function(w){ return w.from[0] == x.id && w.from[1] == o; }) ? " on" : "") );
			dot.setAttribute( "data-node", x.id ); dot.setAttribute( "data-port", o ); dot.setAttribute( "data-dir", "out" );
			row.appendChild( document.createTextNode( o.toUpperCase() ) );
			row.appendChild( dot );
			co.appendChild( row );
			ed.ports[ x.id + "|out|" + o ] = dot;
		});
		ports.appendChild( ci ); ports.appendChild( co );
		n.appendChild( ports );
		if(x.kind == "led") ed.leds.push({ id: x.id, el: head });
		el.nodes.appendChild( n );
	});
	markSelection();
	applyWorld();
	drawWires();
}

function constOf( x, inp ) { var c = x.consts && x.consts[ inp[0] ]; return c !== undefined ? c : inp[4]; }

function applyWorld() { el.world.style.transform = "translate(" + ed.pan.x + "px," + ed.pan.y + "px) scale(" + ed.zoom + ")"; }

function portPos( key )
{
	var p = ed.ports[ key ];
	if(!p) return null;
	var r = p.getBoundingClientRect(), wr = el.world.getBoundingClientRect();
	return { x: (r.left + r.width / 2 - wr.left) / ed.zoom, y: (r.top + r.height / 2 - wr.top) / ed.zoom };
}

function curve( a, b )
{
	var o = 2000, dx = Math.max( 40, Math.abs( b.x - a.x ) * 0.5 );
	return "M" + (a.x + o) + "," + (a.y + o) + " C" + (a.x + o + dx) + "," + (a.y + o) + " " + (b.x + o - dx) + "," + (b.y + o) + " " + (b.x + o) + "," + (b.y + o);
}

function drawWires()
{
	var s = S(), h = "";
	s.wires.forEach(function(w, i){
		var a = portPos( w.from[0] + "|out|" + w.from[1] ), b = portPos( w.to[0] + "|in|" + w.to[1] );
		if(!a || !b) return;
		var sel = ed.sel && ed.sel.type == "wire" && ed.sel.index == i;
		h += '<path data-wire="' + i + '" class="' + (sel ? "sel" : "") + '" stroke="' + wireColor( byId( w.from[0] ), w.from[1] ) + '" d="' + curve( a, b ) + '"/>';
	});
	if(ed.drag && ed.drag.mode == "wire" && ed.drag.at)
	{
		var d = ed.drag, fixed = portPos( d.from ? d.from[0] + "|out|" + d.from[1] : d.to[0] + "|in|" + d.to[1] );
		if(fixed) h += '<path class="temp" stroke="#f2efe8" d="' + (d.from ? curve( fixed, d.at ) : curve( d.at, fixed )) + '"/>';
	}
	el.svg.innerHTML = h;
}

function markSelection()
{
	el.nodes.querySelectorAll( ".se-node" ).forEach(function(n){ n.classList.toggle( "sel", !!ed.sel && ed.sel.type != "wire" && ed.sel.id == n.getAttribute( "data-id" ) ); });
}

function updateInsideLeds()
{
	var st = rack.module_state[ ed.mid ] || {}, leds = st.leds || {};
	ed.leds.forEach(function(l){ var v = leds[ l.id ] || 0; l.el.style.boxShadow = v > 0.05 ? "inset 0 0 0 999px rgba(255,59,47," + (0.15 + v * 0.5) + ")" : ""; });
}

function insideCenter()
{
	var r = el.stage.getBoundingClientRect();
	return { x: (r.width / 2 - ed.pan.x) / ed.zoom, y: (r.height / 2 - ed.pan.y) / ed.zoom };
}
function toWorld( e )
{
	var r = el.inside.getBoundingClientRect();
	return { x: (e.clientX - r.left - ed.pan.x) / ed.zoom, y: (e.clientY - r.top - ed.pan.y) / ed.zoom };
}

// zoom and pan so that every node is in view
function fitInside()
{
	var s = S(), xs = [], ys = [];
	s.items.concat( s.nodes ).forEach(function(x){ var sp = CAT.specOf( x.kind ); if(!sp || sp.deco) return; var p = innerPos( x ); xs.push( p.x, p.x + 170 ); ys.push( p.y, p.y + 40 + 20 * Math.max( sp.ins.length, sp.outs.length ) ); });
	if(!xs.length) return;
	var r = el.stage.getBoundingClientRect(), x0 = Math.min.apply( null, xs ), x1 = Math.max.apply( null, xs ), y0 = Math.min.apply( null, ys ), y1 = Math.max.apply( null, ys );
	ed.zoom = Math.max( 0.25, Math.min( 1, (r.width - 60) / (x1 - x0), (r.height - 60) / (y1 - y0) ) );
	ed.pan = { x: (r.width - (x1 - x0) * ed.zoom) / 2 - x0 * ed.zoom, y: (r.height - (y1 - y0) * ed.zoom) / 2 - y0 * ed.zoom };
	applyWorld(); drawWires();
}

function connect( from, to )
{
	var s = S(), src = byId( from[0] );
	if(!src || !byId( to[0] )) return;
	var firstWire = !s.wires.some(function(w){ return w.from[0] == from[0]; });
	s.wires = s.wires.filter(function(w){ return !(w.to[0] == to[0] && w.to[1] == to[1]); });
	s.wires.push({ from: [ from[0], from[1] ], to: [ to[0], to[1] ] });
	// a knob or slider wired for the first time takes its input's range: it starts at the input's default
	if(firstWire && (src.kind == "knob" || src.kind == "slider") && !(src.range && src.range.min !== undefined))
	{
		var r = CAT.controlRange( s, src );
		src.value = CAT.toN( r, r.def );
	}
}

function insideEvents()
{
	var ins = el.inside;
	ins.addEventListener("pointerdown", function(e){
		var t = e.target;
		var port = t.closest ? t.closest( ".se-port" ) : null, head = t.closest ? t.closest( "[data-drag]" ) : null, node = t.closest ? t.closest( ".se-node" ) : null;
		if(t.getAttribute && t.getAttribute( "data-wire" ) !== null) { select({ type: "wire", index: +t.getAttribute( "data-wire" ) }); drawWires(); return; }
		if(port)
		{
			var id = port.getAttribute( "data-node" ), key = port.getAttribute( "data-port" ), dir = port.getAttribute( "data-dir" );
			if(dir == "out") ed.drag = { mode: "wire", from: [ id, key ] };
			else
			{
				var w = wiredInto( id, key );
				if(w) { S().wires.splice( S().wires.indexOf( w ), 1 ); ed.drag = { mode: "wire", from: w.from.slice() }; renderInside(); }
				else ed.drag = { mode: "wire", to: [ id, key ] };
			}
			ed.drag.at = toWorld( e );
			ins.setPointerCapture( e.pointerId );
			drawWires();
			return;
		}
		if(head)
		{
			var x = byId( head.getAttribute( "data-drag" ) ), p0 = innerPos( x ), w0 = toWorld( e );
			select({ type: CAT.MODULES[ x.kind ] ? "node" : "item", id: x.id });
			ed.drag = { mode: "node", x: x, ox: p0.x - w0.x, oy: p0.y - w0.y, el: node };
			ins.setPointerCapture( e.pointerId );
			return;
		}
		if(node) { var xx = byId( node.getAttribute( "data-id" ) ); select({ type: CAT.MODULES[ xx.kind ] ? "node" : "item", id: xx.id }); return; }
		ed.drag = { mode: "pan", sx: e.clientX, sy: e.clientY, px: ed.pan.x, py: ed.pan.y };
		ins.classList.add( "panning" );
		ins.setPointerCapture( e.pointerId );
		if(ed.sel) { select( null ); drawWires(); }
	});
	ins.addEventListener("pointermove", function(e){
		var d = ed.drag;
		if(!d) return;
		if(d.mode == "pan") { ed.pan.x = d.px + e.clientX - d.sx; ed.pan.y = d.py + e.clientY - d.sy; applyWorld(); }
		else if(d.mode == "node")
		{
			var w = toWorld( e ), nx = snap( w.x + d.ox ), ny = snap( w.y + d.oy );
			if(CAT.MODULES[ d.x.kind ]) { d.x.x = nx; d.x.y = ny; } else { d.x.ix = nx; d.x.iy = ny; }
			d.el.style.left = nx + "px"; d.el.style.top = ny + "px";
			drawWires();
		}
		else if(d.mode == "wire")
		{
			d.at = toWorld( e );
			var over = document.elementFromPoint( e.clientX, e.clientY ), p = over && over.closest ? over.closest( ".se-port" ) : null;
			el.nodes.querySelectorAll( ".se-port.hot" ).forEach(function(q){ q.classList.remove( "hot" ); });
			if(p && p.getAttribute( "data-dir" ) == (d.from ? "in" : "out")) p.classList.add( "hot" );
			drawWires();
		}
	});
	var up = function(e){
		var d = ed.drag;
		ed.drag = null;
		ins.classList.remove( "panning" );
		if(d && d.mode == "wire")
		{
			var over = document.elementFromPoint( e.clientX, e.clientY ), p = over && over.closest ? over.closest( ".se-port" ) : null;
			if(p && p.getAttribute( "data-dir" ) == (d.from ? "in" : "out"))
			{
				var other = [ p.getAttribute( "data-node" ), p.getAttribute( "data-port" ) ];
				connect( d.from || other, d.from ? other : d.to );
			}
			renderInside();
			renderProps();
		}
	};
	ins.addEventListener("pointerup", up);
	ins.addEventListener("pointercancel", up);
	ins.addEventListener("dblclick", function(e){
		var t = e.target;
		if(t.getAttribute && t.getAttribute( "data-wire" ) !== null) { S().wires.splice( +t.getAttribute( "data-wire" ), 1 ); ed.sel = null; renderInside(); renderProps(); }
	});
	ins.addEventListener("wheel", function(e){
		e.preventDefault();
		var r = ins.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
		var z = Math.max( 0.2, Math.min( 2, ed.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1) ) );
		ed.pan.x = mx - (mx - ed.pan.x) * z / ed.zoom; ed.pan.y = my - (my - ed.pan.y) * z / ed.zoom; ed.zoom = z;
		applyWorld();
	}, { passive: false });
	ins.addEventListener("dragover", function(e){ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
	ins.addEventListener("drop", function(e){
		e.preventDefault();
		var what = e.dataTransfer.getData( "text/plain" );
		if(what && CAT.MODULES[ what ]) { var p = toWorld( e ); add( what, { x: p.x + 84, y: p.y + 20 } ); }
	});
}

// ---------------------------------------------------------------------------
// properties of the selection

function field( label, input ) { var l = $e( "label", "se-field" ); l.appendChild( document.createTextNode( label ) ); l.appendChild( input ); return l; }
function textIn( v, fn ) { var i = $e( "input" ); i.value = v || ""; i.addEventListener("input", function(){ fn( i.value ); }); return i; }
function numIn( v, fn, min, max ) { var i = $e( "input" ); i.type = "number"; i.value = v; if(min !== undefined) i.min = min; if(max !== undefined) i.max = max; i.addEventListener("change", function(){ var n = +i.value; if(isFinite( n )) fn( n ); }); return i; }
function selIn( v, opts, fn ) { var s = $e( "select" ); opts.forEach(function(o){ var op = $e( "option" ); op.value = o[0]; op.textContent = o[1]; s.appendChild( op ); }); s.value = v; s.addEventListener("change", function(){ fn( s.value ); }); return s; }
function btn( label, fn, cls ) { var b = $e( "button", cls || "" ); b.textContent = label; b.addEventListener("click", fn); return b; }

function renderProps()
{
	var p = el.props, s = S();
	p.innerHTML = "";
	if(!s) return;
	var sel = ed.sel;
	if(!sel) { renderDesignInfo( p ); return; }
	if(sel.type == "wire")
	{
		var w = s.wires[ sel.index ];
		if(!w) { ed.sel = null; return renderProps(); }
		p.appendChild( $e( "h3", "", "WIRE" ) );
		p.appendChild( $e( "p", "", esc( nameOf( byId( w.from[0] ) ) + " " + w.from[1].toUpperCase() + "  →  " + nameOf( byId( w.to[0] ) ) + " " + w.to[1].toUpperCase() ) ) );
		var b = $e( "div", "se-btns" ); b.appendChild( btn( "Delete wire", function(){ remove( sel ); }, "se-danger" ) ); p.appendChild( b );
		return;
	}
	var x = byId( sel.id );
	if(!x) { ed.sel = null; return renderProps(); }
	var sp = CAT.specOf( x.kind ), isMod = !!CAT.MODULES[ x.kind ];
	p.appendChild( $e( "h3", "", esc( sp.title ) ) );
	if(sp.about) p.appendChild( $e( "p", "", esc( sp.about ) ) );
	var refreshInside = function(){ if(ed.view == "inside") renderInside(); };
	if(!isMod)
	{
		if("label" in x || ["knob", "slider", "button", "toggle", "jackin", "jackout", "led"].indexOf( x.kind ) >= 0)
			p.appendChild( field( "Label", textIn( x.label, function(v){ x.label = v.toUpperCase().substr( 0, 20 ); refreshInside(); } ) ) );
		switch(x.kind)
		{
			case "knob":
				p.appendChild( field( "Size", selIn( x.size, [["s", "Small"], ["m", "Medium"], ["l", "Large"]], function(v){ x.size = v; } ) ) );
				rangeFields( p, x );
				break;
			case "slider":
				p.appendChild( field( "Length", numIn( x.h || 120, function(v){ x.h = Math.max( 40, v ); }, 40, 600 ) ) );
				rangeFields( p, x );
				break;
			case "button": case "toggle":
				p.appendChild( field( "Width", numIn( x.w || 70, function(v){ x.w = Math.max( 30, v ); }, 30, 400 ) ) );
				p.appendChild( field( "Height", numIn( x.h || 26, function(v){ x.h = Math.max( 16, v ); }, 16, 200 ) ) );
				p.appendChild( $e( "p", "", x.kind == "button" ? "Its output is 1 while it is held (a gate), 0 otherwise." : "Its output is 1 when on, 0 when off. Clicked in the rack, it switches." ) );
				break;
			case "led":
				p.appendChild( field( "Colour", selIn( x.color || "red", Object.keys( CS.LED_COLORS ).map(function(k){ return [ k, k ]; }), function(v){ x.color = v; } ) ) );
				break;
			case "jackin": case "jackout":
				var used = s.items.filter(function(i){ return i.kind == x.kind && i !== x; }).map(function(i){ return i.slot; });
				var opts = []; for(var k = 1; k <= CAT.SLOTS; ++k) if(used.indexOf( k ) < 0) opts.push([ String( k ), "Socket " + k ]);
				p.appendChild( field( "Socket", selIn( String( x.slot ), opts, function(v){ x.slot = +v; } ) ) );
				p.appendChild( field( "Signal", selIn( x.mode || "cv", [["cv", "CV / audio: ±5 V ↔ ±1"], ["pitch", "Pitch: 1 V / octave"], ["gate", "Gate: 5 V ↔ 1"]], function(v){ x.mode = v; } ) ) );
				break;
			case "label":
				p.appendChild( field( "Text", textIn( x.text, function(v){ x.text = v; } ) ) );
				p.appendChild( field( "Size", numIn( x.size || 16, function(v){ x.size = Math.max( 8, Math.min( 80, v ) ); }, 8, 80 ) ) );
				var dim = $e( "input" ); dim.type = "checkbox"; dim.checked = !!x.dim; dim.addEventListener("change", function(){ x.dim = dim.checked; });
				var dl = field( "Dim", dim ); dl.classList.add( "check" ); p.appendChild( dl );
				break;
			case "section":
				p.appendChild( field( "Title", textIn( x.title, function(v){ x.title = v.toUpperCase(); } ) ) );
				p.appendChild( field( "Width", numIn( x.w || 200, function(v){ x.w = Math.max( 40, v ); }, 40, 1600 ) ) );
				p.appendChild( field( "Height", numIn( x.h || 120, function(v){ x.h = Math.max( 30, v ); }, 30, 700 ) ) );
				break;
		}
	}
	// the inputs: their wire, or their constant
	if(sp.ins.length && (isMod || x.kind == "led" || x.kind == "jackout"))
	{
		p.appendChild( $e( "h4", "", "INPUTS" ) );
		sp.ins.forEach(function(inp){
			var w = wiredInto( x.id, inp[0] ), box = $e( "div", "se-const" + (w ? " wired" : "") );
			if(w) box.textContent = inp[1] + "  ←  " + nameOf( byId( w.from[0] ) ) + " " + w.from[1].toUpperCase();
			else
			{
				var r = { min: inp[2], max: inp[3], unit: inp[5] }, val = constOf( x, inp );
				var head = $e( "div", "se-cv", esc( inp[1] ) + ' <b>' + esc( CAT.fmt( r, val ) ) + '</b>' );
				var sl = $e( "input" ); sl.type = "range"; sl.min = 0; sl.max = 1000; sl.value = Math.round( CAT.toN( r, val ) * 1000 );
				sl.addEventListener("input", function(){
					var v = CAT.fromN( r, sl.value / 1000 );
					x.consts = x.consts || {}; x.consts[ inp[0] ] = Math.round( v * 10000 ) / 10000;
					head.innerHTML = esc( inp[1] ) + ' <b>' + esc( CAT.fmt( r, v ) ) + '</b>';
				});
				sl.addEventListener("change", refreshInside);
				box.appendChild( head ); box.appendChild( sl );
			}
			p.appendChild( box );
		});
	}
	var outs = s.wires.filter(function(w){ return w.from[0] == x.id; });
	if(sp.outs.length)
		p.appendChild( $e( "p", "", outs.length ? "Wired to: " + outs.map(function(w){ return esc( nameOf( byId( w.to[0] ) ) + " " + w.to[1].toUpperCase() ); }).join( ", " ) : "Its output is not wired yet: see INSIDE." ) );
	var b = $e( "div", "se-btns" );
	if(x.kind != "out") { b.appendChild( btn( "Duplicate", function(){ duplicate( x.id ); } ) ); b.appendChild( btn( "Delete", function(){ remove( sel ); }, "se-danger" ) ); }
	p.appendChild( b );
}

// a knob's or slider's range: automatic (its first wire's input), or its own
function rangeFields( p, x )
{
	var s = S(), r = CAT.controlRange( s, x ), auto = !(x.range && x.range.min !== undefined);
	var cb = $e( "input" ); cb.type = "checkbox"; cb.checked = auto;
	cb.addEventListener("change", function(){ if(cb.checked) delete x.range; else x.range = { min: r.min, max: r.max, def: r.def, unit: r.unit }; renderProps(); });
	var l = field( "Automatic range (from its wire)", cb ); l.classList.add( "check" ); p.appendChild( l );
	if(auto) p.appendChild( $e( "p", "", "Range: " + esc( CAT.fmt( r, r.min ) ) + " to " + esc( CAT.fmt( r, r.max ) ) ) );
	else
	{
		var set = function(k, v){ x.range[k] = v; if(CAT.isExp( x.range.unit ) && x.range.min <= 0) x.range.min = 0.001; };
		p.appendChild( field( "Minimum", numIn( r.min, function(v){ set( "min", v ); } ) ) );
		p.appendChild( field( "Maximum", numIn( r.max, function(v){ set( "max", v ); } ) ) );
		p.appendChild( field( "Default", numIn( r.def, function(v){ set( "def", v ); } ) ) );
		p.appendChild( field( "Unit", selIn( r.unit, [["lvl", "0..1 (%)"], ["bi", "-1..1"], ["oct", "Octaves (pitch)"], ["hz", "Hz (exponential)"], ["s", "Seconds (exponential)"], ["bpm", "BPM"], ["int", "Whole numbers"], ["x", "Number"]], function(v){ set( "unit", v ); } ) ) );
	}
}

// nothing selected: the design, My synths
function renderDesignInfo( p )
{
	var s = S();
	p.appendChild( $e( "h3", "", esc( s.name || "CUSTOM SYNTH" ) ) );
	p.appendChild( $e( "p", "", s.items.length + " panel items, " + s.nodes.length + " modules, " + s.wires.length + " wires. Select something to edit it." ) );
	p.appendChild( $e( "p", "", "Every module has inputs on its left and outputs on its right. An input with no wire uses its own value (set it here when the module is selected). Audio is -1..1, gates 0 or 1, pitch in octaves from C4." ) );
	// start again: an empty panel (MIDI IN and AUDIO OUT inside), or the example synth; a second click confirms
	p.appendChild( $e( "h4", "", "START AGAIN" ) );
	var row0 = $e( "div", "se-btns" );
	[ ["Empty panel", function(){ var d = CS.defaults(); applyDesign({ name: "NEW SYNTH", height: S().height, color: S().color, knob_skin: S().knob_skin, wood: S().wood, width: mod().type == "custom_half" ? "half" : "full",
			items: [], nodes: [ { id: "midi", kind: "midi", x: 0, y: 300 }, { id: "out", kind: "out", x: 700, y: 300 } ], wires: [], next: 1 }); hint( "An empty panel: add items on the FRONT PANEL, modules INSIDE" ); } ],
	  ["Example synth", function(){ var d = CS.defaults(); d.width = mod().type == "custom_half" ? "half" : "full"; applyDesign( d ); hint( "The example synth: MIDI, oscillator, filter, envelope, VCA" ); } ] ].forEach(function(o){
		var b = btn( o[0], function(){
			if(b.getAttribute( "data-sure" )) o[1]();
			else { b.setAttribute( "data-sure", "1" ); b.textContent = o[0] + ": sure? click again"; b.classList.add( "se-danger" ); }
		});
		row0.appendChild( b );
	});
	p.appendChild( row0 );
	var lib = loadLibrary(), names = Object.keys( lib );
	p.appendChild( $e( "h4", "", "MY SYNTHS" ) );
	if(!names.length) p.appendChild( $e( "p", "", "None yet: Save to My synths keeps this design in the browser, to add it again from ADD DEVICE." ) );
	names.forEach(function(n){
		var row = $e( "div", "se-btns" );
		row.appendChild( $e( "span", "", esc( n ) ) );
		row.appendChild( btn( "Load here", function(){ applyDesign( lib[n] ); hint( n + " loaded into this synth" ); } ) );
		row.appendChild( btn( "Delete", function(){ delete lib[n]; storeLibrary( lib ); renderProps(); hint( n + " deleted from My synths" ); }, "se-danger" ) );
		p.appendChild( row );
	});
}

// ---------------------------------------------------------------------------
// keys

function onKey( e )
{
	if(!el.root || el.root.hidden) return;
	var t = e.target, typing = t && t.closest && t.closest( "input, select, textarea" );
	if(e.key == "Escape") { if(typing) t.blur(); else if(ed.sel) select( null ); else close(); e.stopImmediatePropagation(); e.preventDefault(); return; }
	if(typing) return;
	if((e.key == "Delete" || e.key == "Backspace") && ed.sel) { remove( ed.sel ); e.stopImmediatePropagation(); e.preventDefault(); return; }
	if((e.ctrlKey || e.metaKey) && e.code == "KeyD" && ed.sel && ed.sel.id) { duplicate( ed.sel.id ); e.stopImmediatePropagation(); e.preventDefault(); return; }
	var arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
	if(arrows[ e.key ] && ed.view == "front" && ed.sel && ed.sel.type == "item")
	{
		var it = byId( ed.sel.id ), st = e.shiftKey ? 10 : 1;
		it.x += arrows[ e.key ][0] * st; it.y += arrows[ e.key ][1] * st; delete it.ix; delete it.iy;
		e.stopImmediatePropagation(); e.preventDefault();
	}
	// other keys go on to the rack: the computer keyboard plays the synth while it is built
}

// ---------------------------------------------------------------------------
// MY SYNTHS: designs kept in this browser

function loadLibrary() { try { return JSON.parse( localStorage.getItem( LIB_KEY ) || "{}" ) || {}; } catch(err) { return {}; } }
function storeLibrary( lib ) { try { localStorage.setItem( LIB_KEY, JSON.stringify( lib ) ); } catch(err) {} }

function designOf( s, type )
{
	var d = JSON.parse( JSON.stringify( s ) );
	delete d.midi_channel; delete d.midi_master;
	d.width = type == "custom_half" ? "half" : "full";
	return d;
}

function saveToLibrary()
{
	var s = S(), lib = loadLibrary(), name = (s.name || "MY SYNTH").toUpperCase();
	lib[ name ] = designOf( s, mod().type );
	storeLibrary( lib );
	hint( name + " saved to My synths: ADD DEVICE › Custom adds it again" );
	if(!ed.sel) renderProps();
	if(window.gfTrack) gfTrack( "save-synth" );
}

// a design into this synth (keeps its MIDI settings)
function applyDesign( d )
{
	var m = mod(), s = m.settings, keep = { midi_channel: s.midi_channel, midi_master: s.midi_master };
	Object.keys( s ).forEach(function(k){ delete s[k]; });
	var c = JSON.parse( JSON.stringify( d ) );
	m.type = c.width == "half" ? "custom_half" : "custom";
	delete c.width;
	Object.keys( c ).forEach(function(k){ s[k] = c[k]; });
	Object.keys( keep ).forEach(function(k){ if(keep[k] !== undefined) s[k] = keep[k]; });
	WR.types[ m.type ].validate( s, s );
	ed.sel = null; ed.fitted = false;
	refreshTop(); setView( ed.view ); renderProps();
}

// ADD DEVICE: My synths as cards in the Custom category
WR.addPanelCards = function( cat )
{
	if(cat != "Custom") return "";
	var lib = loadLibrary();
	return Object.keys( lib ).map(function(n){
		var d = lib[n];
		return '<button class="add-card" data-extra="1" data-lib="' + esc( n ) + '" data-search="' + esc( (n + " my synth custom").toLowerCase() ) + '">' +
			'<div class="add-img missing"><span class="add-ph">' + esc( n ) + '</span></div>' +
			'<div class="add-text"><div class="add-title">' + esc( n ) + '</div><div class="add-desc">My synth</div>' +
			'<div class="add-about">' + (d.items || []).length + ' panel items, ' + (d.nodes || []).length + ' modules, ' + (d.wires || []).length + ' wires</div>' +
			'<div class="add-tags"><span>' + (d.width == "half" ? "HALF WIDTH" : "FULL WIDTH") + '</span><span>MIDI</span></div></div></button>';
	}).join( "" );
};
WR.onAddPanelCard = function( card )
{
	var name = card.getAttribute( "data-lib" ), d = loadLibrary()[ name ];
	if(!d) return;
	ed.suppress = true;
	var m;
	try { m = addDevice( d.width == "half" ? "custom_half" : "custom" ); }
	finally { ed.suppress = false; }
	if(!m) return;
	var keep = ed.mid; ed.mid = m.id;
	applyDesignTo( m, d );
	ed.mid = keep;
	setStatus( "Added " + name + " (" + m.id + ") at the bottom of the rack" );
};
function applyDesignTo( m, d )
{
	var s = m.settings, c = JSON.parse( JSON.stringify( d ) );
	m.type = c.width == "half" ? "custom_half" : "custom"; delete c.width;
	Object.keys( c ).forEach(function(k){ s[k] = c[k]; });
	WR.types[ m.type ].validate( s, s );
}

window.SynthEditor = { open: open, close: close, add: add, connect: connect, select: select, remove: remove, setView: setView, applyDesign: applyDesign,
	state: function(){ return ed; }, isOpen: function(){ return !!el.root && !el.root.hidden; } };

})();
