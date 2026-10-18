// editor/editor.js
// SYNTH EDITOR: builds the custom synths (editor/custom.js). A full-screen overlay over the rack:
//   FRONT PANEL / BACK PANEL: the device as it looks in the rack (drawn by its own code, with the rack's
//     widgets made inert). The palette shows each item as it will look; drag one onto the panel (it
//     follows the mouse at its real size) or click it. Move items, resize sections, rectangles, sliders
//     and buttons by their corner, lines by their ends. The back has the sockets: MAIN OUT, MIDI IN,
//     audio ins and outs.
//   INSIDE: every item with inputs or outputs, and the modules (oscillators, filters...), as nodes with
//     ports; drag a wire from an output to an input (an input takes one wire; dragging a wired input
//     takes the wire off it). The panel's items keep their places, a little further apart.
// The design is the device's settings, edited live: the synth plays while it is being built.
// My synths: designs saved in this browser, added from ADD DEVICE (Custom).

(function(){

var CS = WR.CustomSynth, CAT = CS.CAT;
var SPREAD = 1.5, SNAP = 5, LIB_KEY = "GASFREE_synths";
var ed = { mid: null, view: "front", sel: null, drag: null, hover: null, pan: { x: 40, y: 40 }, zoom: 0.75, fitted: false, raf: 0, fit: null, suppress: false, pal: null };
var el = {};

// the palettes: [what to add, name, note, a sample item drawn as its preview]
var FRONT_ITEMS = [
	["knob:s", "KNOB SMALL", "", { kind: "knob", size: "s", label: "KNOB" }],
	["knob:m", "KNOB", "", { kind: "knob", size: "m", label: "KNOB" }],
	["knob:l", "KNOB LARGE", "", { kind: "knob", size: "l", label: "KNOB" }],
	["knob:xl", "KNOB XL", "", { kind: "knob", size: "xl", label: "KNOB" }],
	["knob:h", "KNOB HUGE", "", { kind: "knob", size: "h", label: "KNOB" }],
	["slider", "SLIDER", "", { kind: "slider", h: 60, label: "SLIDER" }],
	["button", "BUTTON", "a gate while held", { kind: "button", w: 70, h: 26, label: "BUTTON" }],
	["toggle", "SWITCH", "on / off", { kind: "toggle", w: 70, h: 26, label: "SWITCH", on: true }],
	["led", "LED", "lights with its input", { kind: "led", color: "red" }],
	["jackin", "JACK IN", "signals from the rack", { kind: "jackin", label: "IN", slot: 1 }],
	["jackout", "JACK OUT", "signals to the rack", { kind: "jackout", label: "OUT", slot: 1 }],
	["label", "LABEL", "", { kind: "label", text: "LABEL", size: 18 }],
	["section", "SECTION", "an area with a title", { kind: "section", w: 150, h: 80, title: "SECTION" }],
	["rect", "RECTANGLE", "", { kind: "rect", w: 120, h: 60, color: "ink", width: 2, radius: 4 }],
	["line", "LINE", "", { kind: "line", x2: 120, y2: 0, color: "ink", width: 2 }],
	["screw", "SCREW", "", { kind: "screw" }]
];
var BACK_ITEMS = [
	["ain", "AUDIO IN", "audio from the rack", { kind: "ain", label: "AUDIO IN", slot: 1 }],
	["aout", "AUDIO OUT", "audio to the rack", { kind: "aout", label: "AUDIO OUT", slot: 1 }],
	["label", "LABEL", "", { kind: "label", text: "LABEL", size: 18 }],
	["rect", "RECTANGLE", "", { kind: "rect", w: 120, h: 60, color: "cream", fill: true, radius: 4 }],
	["line", "LINE", "", { kind: "line", x2: 120, y2: 0, color: "ink", width: 2 }],
	["vents", "VENTS", "", { kind: "vents", w: 150, h: 70 }],
	["screw", "SCREW", "", { kind: "screw" }]
];

function $e( tag, cls, html ) { var d = document.createElement( tag ); if(cls) d.className = cls; if(html !== undefined) d.innerHTML = html; return d; }
function esc( t ) { return String( t ).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
function mod() { return rack.settings.modules.find(function(m){ return m.id == ed.mid; }); }
function S() { var m = mod(); return m ? m.settings : null; }
function def() { var m = mod(); return m ? WR.types[ m.type ] : null; }
function snap( v ) { return Math.round( v / SNAP ) * SNAP; }
function hint( t ) { el.hint.textContent = t; }
function byId( id ) { var s = S(); return CAT.findItem( s, id ); }
function newId( kind ) { var s = S(); var id; do { id = kind + (s.next++); } while(byId( id )); return id; }
function titleOf( x ) { var sp = CAT.specOf( x.kind ); return sp ? sp.title : x.kind; }
function nameOf( x ) { return x.label || x.text || x.title || titleOf( x ); }
function isBackItem( x ) { return (S().back || []).indexOf( x ) >= 0; }
function panelList() { return ed.view == "back" ? S().back : S().items; }

// ---------------------------------------------------------------------------
// the rack's widgets made inert, drawing into another canvas (the panels, the previews, the ghost)

function inert( c, fn )
{
	var keep = { ctx: ctx, ui: ui, jacks: jacks, id_prefix: id_prefix, tooltips: tooltips, cable_drag: cable_drag, knob_skin: knob_skin, learn: midictl.learn, hover: hover_control, frame: frame };
	ctx = c; jacks = {}; id_prefix = "__se__."; tooltips = []; cable_drag = null; midictl.learn = false; frame = { ox: 0, oy: 0, k: 1 };
	ui = { px: -1e9, py: -1e9, x: -1e9, y: -1e9, down: false, pressed: false, released: false, rpressed: false, dbl: false, shift: false, wheel: 0, wheel_x: 0,
		active: "__se__", hot: null, startY: 0, startN: 0, dragShift: false, lastDownTime: 0, lastDownPos: [0, 0] };
	knob_skin = S().knob_skin || def().knob_skin || null;
	try { fn(); }
	finally {
		ctx = keep.ctx; ui = keep.ui; jacks = keep.jacks; id_prefix = keep.id_prefix; tooltips = keep.tooltips; cable_drag = keep.cable_drag;
		knob_skin = keep.knob_skin; midictl.learn = keep.learn; hover_control = keep.hover; frame = keep.frame; casing_wood = false;
	}
}
function fakeMod() { var m = mod(); return { id: m.id, type: m.type, def: def(), settings: m.settings, state: rack.module_state[ m.id ] || {}, post: function(){}, editing: true }; }

// an item alone, centred in a canvas (k: its scale; 0 = fit)
function drawSample( cv, item, back, k, bg, st )
{
	// the item at the origin (a line keeps its shape), then centred in the canvas
	var dpr = window.devicePixelRatio || 1, base = Object.assign( { id: "__pv" }, item );
	if(item.x2 !== undefined && item.x !== undefined) { base.x2 = item.x2 - item.x; base.y2 = item.y2 - item.y; }
	base.x = 0; base.y = 0;
	var b0 = CS.box( base ), W = cv.width / dpr, H = cv.height / dpr;
	k = k || Math.min( (W - 8) / b0.w, (H - 8) / b0.h, 1.3 );
	var it = Object.assign( {}, base );
	it.x = (W / k - b0.w) / 2 - b0.x; it.y = (H / k - b0.h) / 2 - b0.y;
	if(it.kind == "line") { it.x2 = it.x + (base.x2 || 0); it.y2 = it.y + (base.y2 || 0); }
	var c = cv.getContext( "2d" );
	c.setTransform( 1, 0, 0, 1, 0, 0 ); c.clearRect( 0, 0, cv.width, cv.height );
	if(bg) { c.fillStyle = bg; c.fillRect( 0, 0, cv.width, cv.height ); }
	c.setTransform( dpr * k, 0, 0, dpr * k, 0, 0 );
	inert( c, function(){ CS.drawPreview( fakeMod(), it, back, st ); } );
	return it;
}

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
		'<div class="se-tabs"><button data-view="front">FRONT PANEL</button><button data-view="back">BACK PANEL</button><button data-view="inside">INSIDE</button></div>' +
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
		// the titles that show the name follow it (front and back)
		s.items.concat( s.back ).forEach(function(i){ if(i.kind == "label" && i.text == old) i.text = nu; });
		s.name = nu;
	});
	top.querySelectorAll( "[data-f]" ).forEach(function(f){
		f.addEventListener("change", function(){
			var s = S(), k = f.getAttribute( "data-f" );
			if(k == "width") mod().type = f.value == "half" ? "custom_half" : "custom";
			else if(k == "height") s.height = +f.value;
			else if(k == "wood") s.wood = f.checked;
			else s[k] = f.value;
			if(k == "color" || k == "knob_skin") renderPalette(); // the previews in the new look
		});
	});
	top.querySelectorAll( "[data-view]" ).forEach(function(b){ b.addEventListener("click", function(){ setView( b.getAttribute( "data-view" ) ); }); });
	top.querySelector( ".se-done" ).addEventListener("click", close);
	top.querySelector( ".se-save" ).addEventListener("click", saveToLibrary);

	panelEvents();
	insideEvents();
	paletteEvents();
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
	ed.drag = null; endPaletteDrag();
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
	if(ed.view != v && ed.sel && ed.sel.type == "item") { var x = byId( ed.sel.id ); if(x && v != "inside" && (v == "back") != isBackItem( x )) ed.sel = null; }
	ed.view = v;
	el.top.querySelectorAll( "[data-view]" ).forEach(function(b){ b.classList.toggle( "on", b.getAttribute( "data-view" ) == v ); });
	el.front.hidden = v == "inside";
	el.inside.hidden = v != "inside";
	renderPalette();
	renderProps();
	if(v == "inside") { renderInside(); if(!ed.fitted) { fitInside(); ed.fitted = true; } }
	hint( v == "front" ? "Drag items from the left onto the panel (or click them). Drag to move; drag the corner of a section, rectangle, slider or button to resize it, the ends of a line to change it. Delete removes; arrows nudge; Ctrl+D duplicates. Play the keys to hear the synth."
		: v == "back" ? "The back: MAIN OUT L / R and MIDI IN are always there (move them where you like); add AUDIO IN and OUT sockets, labels, rectangles, lines, vents. Tab in the rack shows it."
		: "Drag from an output (right) to an input (left) to wire them; drag a wired input to move or remove its wire. Drag a node by its title; drag the background to pan, the wheel zooms. A knob takes the range of the first input it is wired to." );
}

// ---------------------------------------------------------------------------
// the palette: previews of the items; drag one out (it follows the mouse) or click it

function renderPalette()
{
	var h = "";
	if(ed.view != "inside")
	{
		h += "<h4>" + (ed.view == "back" ? "BACK PANEL" : "FRONT PANEL") + '</h4><div class="se-grid">';
		(ed.view == "back" ? BACK_ITEMS : FRONT_ITEMS).forEach(function(it, i){
			h += '<div class="se-pal se-pal-item" data-add="' + it[0] + '" data-i="' + i + '" title="' + esc( it[1] + (it[2] ? ": " + it[2] : "") + " (drag it onto the panel, or click)" ) + '">' +
				'<canvas class="se-thumb"></canvas><span>' + it[1] + '</span></div>';
		});
		h += '</div><p class="se-note">Drag an item onto the panel, or click it to add it in a free place.</p>';
	}
	else
	{
		var cats = {};
		Object.keys( CAT.MODULES ).forEach(function(k){ var m = CAT.MODULES[k]; if(m.fixed) return; (cats[ m.cat ] = cats[ m.cat ] || []).push( k ); });
		Object.keys( cats ).forEach(function(c){
			h += "<h4>" + c.toUpperCase() + "</h4>";
			cats[c].forEach(function(k){ var m = CAT.MODULES[k]; h += '<div class="se-pal se-pal-mod" data-add="' + k + '" title="' + esc( m.about || "" ) + '"><b>' + m.title + '</b><small>' + esc( m.about || "" ) + '</small></div>'; });
		});
		h += '<h4>PANEL ITEMS</h4><p class="se-note">Knobs, buttons, LEDs and jacks are added on the FRONT PANEL, audio sockets on the BACK PANEL; they appear here with their ports.</p>';
	}
	el.palette.innerHTML = h;
	// the previews, drawn by the rack's widgets in the panel's colours
	var dpr = window.devicePixelRatio || 1, s = S(), back = ed.view == "back";
	var bg = back ? CS.BACK.bg : (CS.COLORS[ s.color ] || CS.COLORS.dark).bg;
	el.palette.querySelectorAll( ".se-pal-item" ).forEach(function(p){
		var list = back ? BACK_ITEMS : FRONT_ITEMS, item = list[ +p.getAttribute( "data-i" ) ][3], cv = p.querySelector( "canvas" );
		cv.width = 72 * dpr; cv.height = 50 * dpr;
		drawSample( cv, item, back, 0, bg );
	});
}

function paletteEvents()
{
	el.palette.addEventListener("pointerdown", function(e){
		var p = e.target.closest ? e.target.closest( "[data-add]" ) : null;
		if(!p || e.button !== 0) return;
		e.preventDefault();
		var list = ed.view == "back" ? BACK_ITEMS : FRONT_ITEMS, i = p.getAttribute( "data-i" );
		ed.pal = { what: p.getAttribute( "data-add" ), sample: i !== null ? list[ +i ][3] : null, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
		document.addEventListener("pointermove", paletteMove);
		document.addEventListener("pointerup", paletteUp);
	});
}

function paletteMove( e )
{
	var d = ed.pal;
	if(!d) return;
	if(!d.moved && Math.abs( e.clientX - d.sx ) + Math.abs( e.clientY - d.sy ) > 5) { d.moved = true; makeGhost( d ); }
	if(d.ghost) placeGhost( d, e );
}

function paletteUp( e )
{
	var d = ed.pal;
	endPaletteDrag();
	if(!d) return;
	if(!d.moved) { add( d.what, null ); return; } // a click: in a free place
	var over = document.elementFromPoint( e.clientX, e.clientY );
	if(!over || !el.stage.contains( over )) return;
	if(CAT.MODULES[ d.what ]) { if(ed.view == "inside") { var w = toWorld( e ); add( d.what, { x: w.x + 84 - d.gx / ed.zoom, y: w.y + 20 - d.gy / ed.zoom } ); } }
	else if(ed.view != "inside" && ed.fit) add( d.what, toPanel( e ), true );
}

function endPaletteDrag()
{
	document.removeEventListener("pointermove", paletteMove);
	document.removeEventListener("pointerup", paletteUp);
	if(ed.pal && ed.pal.ghost) ed.pal.ghost.remove();
	ed.pal = null;
}

// the item following the mouse: at its real size on the panel (or a node, inside)
function makeGhost( d )
{
	var g = $e( "div", "se-ghost" );
	if(d.sample && ed.fit)
	{
		var k = ed.fit.k, b = CS.box( Object.assign( { x: 0, y: 0 }, d.sample ) ), dpr = window.devicePixelRatio || 1;
		var cv = $e( "canvas" ); cv.width = Math.ceil( b.w * k * dpr ) + 2; cv.height = Math.ceil( b.h * k * dpr ) + 2;
		cv.style.width = (cv.width / dpr) + "px"; cv.style.height = (cv.height / dpr) + "px";
		var it = drawSample( cv, d.sample, ed.view == "back", k, null );
		// where the item's own point (x, y) is in the ghost: it goes under the mouse
		d.gx = it.x * k; d.gy = it.y * k;
		g.appendChild( cv );
	}
	else
	{
		var m = CAT.MODULES[ d.what ];
		g.innerHTML = '<div class="se-node se-ghost-node"><div class="se-head">' + esc( m ? m.title : d.what ) + '</div><div class="se-ports"><small>' + esc( m && m.about || "" ) + '</small></div></div>';
		d.gx = 20; d.gy = 12;
	}
	document.body.appendChild( g );
	d.ghost = g;
}
function placeGhost( d, e ) { d.ghost.style.left = (e.clientX - d.gx) + "px"; d.ghost.style.top = (e.clientY - d.gy) + "px"; }

// adds a panel item ("knob:m", "led"...) to the panel in view, or a module ("osc"...) inside; at: where
function add( what, at, exact )
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
	var back = ed.view == "back" || kind == "ain" || kind == "aout" || kind == "vents";
	var list = back ? s.back : s.items;
	var size = def().size( layout, s ), p = at || freeSpot( size, list );
	var it = { id: newId( kind ), kind: kind, x: snap( p.x ), y: snap( p.y ) };
	var count = list.filter(function(i){ return i.kind == kind; }).length + 1;
	switch(kind)
	{
		case "knob": it.size = sub || "m"; it.label = "KNOB " + count; break;
		case "slider": it.h = 120; it.label = "SLIDER " + count; break;
		case "button": it.w = 70; it.h = 26; it.label = "BUTTON"; break;
		case "toggle": it.w = 70; it.h = 26; it.label = "SWITCH"; break;
		case "led": it.color = "red"; break;
		case "jackin": case "jackout": case "ain": case "aout":
			var max = kind == "ain" || kind == "aout" ? CAT.ASLOTS : CAT.SLOTS;
			var used = list.filter(function(i){ return i.kind == kind; }).map(function(i){ return i.slot; });
			var slot = 1; while(used.indexOf( slot ) >= 0) slot++;
			if(slot > max) { hint( "No more " + CAT.specOf( kind ).title + " sockets: " + max + " at most" ); return null; }
			it.slot = slot;
			if(kind == "jackin" || kind == "jackout") { it.mode = "cv"; it.label = (kind == "jackin" ? "IN " : "OUT ") + slot; }
			else it.label = (kind == "ain" ? "AUDIO IN " : "AUDIO OUT ") + slot;
			break;
		case "label": it.text = "LABEL"; it.size = 16; break;
		case "section": it.w = 240; it.h = 150; it.title = "SECTION"; break;
		case "rect": it.w = 200; it.h = 100; it.color = back ? "cream" : "ink"; it.width = 2; it.radius = 4; it.fill = back; break;
		case "line": it.x2 = it.x + 160; it.y2 = it.y; it.color = "ink"; it.width = 2; break;
		case "vents": it.w = 200; it.h = 100; break;
	}
	// areas added with a click are centred where they land
	if(!exact && (kind == "section" || kind == "rect" || kind == "vents")) { it.x = snap( p.x - it.w / 2 ); it.y = snap( p.y - it.h / 2 ); }
	if(!exact && kind == "line") { it.x = snap( p.x - 80 ); it.x2 = it.x + 160; }
	list.push( it );
	select({ type: "item", id: it.id });
	if(ed.view == "inside") renderInside();
	return it;
}

// a place on the panel: the middle, moved along until nothing is there
function freeSpot( size, list )
{
	var x = size[0] / 2, y = size[1] / 2, tries = 0;
	while(tries++ < 40 && hitItem({ x: x, y: y }, list)) { x += 60; if(x > size[0] - 60) { x = 120; y += 60; if(y > size[1] - 30) y = 60; } }
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
		var sp = CAT.specOf( x.kind );
		if(x.kind == "out") { hint( "The AUDIO OUT stays: it is where the synth's sound leaves" ); return; }
		if(sp && sp.fixed) { hint( sp.title + " stays on the back (move it where you like)" ); return; }
		s.items = s.items.filter(function(i){ return i.id != sel.id; });
		s.back = s.back.filter(function(i){ return i.id != sel.id; });
		s.nodes = s.nodes.filter(function(n){ return n.id != sel.id; });
		s.wires = s.wires.filter(function(w){ return w.from[0] != sel.id && w.to[0] != sel.id; });
	}
	ed.sel = null;
	renderProps();
	if(ed.view == "inside") renderInside();
}

function duplicate( id )
{
	var s = S(), x = byId( id ), sp = x && CAT.specOf( x.kind );
	if(!x || x.kind == "out" || (sp && sp.fixed)) return;
	if(["jackin", "jackout", "ain", "aout"].indexOf( x.kind ) >= 0) { var it = add( x.kind, { x: x.x + 50, y: x.y }, true ); if(it && x.mode) it.mode = x.mode; return; }
	var c = JSON.parse( JSON.stringify( x ) );
	c.id = newId( x.kind ); c.x += 30; c.y += 30; delete c.ix; delete c.iy;
	if(c.x2 !== undefined) { c.x2 += 30; c.y2 += 30; }
	var isMod = !!CAT.MODULES[ x.kind ];
	(isMod ? s.nodes : (isBackItem( x ) ? s.back : s.items)).push( c );
	select({ type: isMod ? "node" : "item", id: c.id });
	if(ed.view == "inside") renderInside();
}

function select( sel ) { ed.sel = sel; renderProps(); if(ed.view == "inside") markSelection(); }

// ---------------------------------------------------------------------------
// FRONT / BACK PANEL: drawn by the device's own code

function loop()
{
	ed.raf = requestAnimationFrame( loop );
	if(el.root.hidden) return;
	if(!mod()) { close(); return; } // the device was removed
	if(ed.view != "inside") renderPanel();
	else if((ed.frame = (ed.frame || 0) + 1) % 2 == 0) drawGadgets(); // live: values, LEDs
}

function renderPanel()
{
	var cv = el.front, c = cv.getContext( "2d" ), dpr = window.devicePixelRatio || 1, back = ed.view == "back";
	var W = el.stage.clientWidth, H = el.stage.clientHeight;
	if(cv.width != Math.round( W * dpr ) || cv.height != Math.round( H * dpr )) { cv.width = Math.round( W * dpr ); cv.height = Math.round( H * dpr ); }
	var m = mod(), d = def(), size = d.size( layout, m.settings ), list = panelList();
	var ext = [ size[0], size[1] ];
	list.forEach(function(it){ var b = CS.box( it ); ext[0] = Math.max( ext[0], b.x + b.w + 10 ); ext[1] = Math.max( ext[1], b.y + b.h + 10 ); });
	var k = Math.min( (W - 60) / ext[0], (H - 60) / ext[1], 1.5 ), ox = (W - ext[0] * k) / 2, oy = (H - ext[1] * k) / 2;
	ed.fit = { k: k, ox: ox, oy: oy, w: size[0], h: size[1] };
	c.setTransform( 1, 0, 0, 1, 0, 0 );
	c.clearRect( 0, 0, cv.width, cv.height );
	c.setTransform( dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy );
	inert( c, function(){ if(back) CS.drawRear( fakeMod(), size[0], size[1] ); else CS.draw( fakeMod() ); } );
	// items left outside the panel (it was made smaller): outlined in red, they are not seen in the rack
	var outside = 0;
	list.forEach(function(it){
		var b = CS.box( it );
		if(b.x + b.w > 4 && b.y + b.h > 4 && b.x < size[0] - 4 && b.y < size[1] - 4) return;
		outside++;
		c.strokeStyle = "#ff4a3a"; c.lineWidth = 2 / k; c.setLineDash([ 4 / k, 3 / k ]); c.strokeRect( b.x, b.y, b.w, b.h ); c.setLineDash([]);
	});
	if(outside != ed.outside) { ed.outside = outside; if(outside) hint( outside + " item" + (outside > 1 ? "s are" : " is") + " outside the panel (outlined in red): drag them in, or make the panel bigger" ); }
	// the selection, the item under the mouse, the handles
	var sel = ed.sel && ed.sel.type == "item" ? byId( ed.sel.id ) : null;
	if(sel && list.indexOf( sel ) < 0) sel = null;
	if(ed.hover && ed.hover !== sel) { var hb = CS.box( ed.hover ); c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1 / k; c.strokeRect( hb.x, hb.y, hb.w, hb.h ); }
	if(sel)
	{
		var b = CS.box( sel ), hs = 10 / k;
		c.strokeStyle = "#e2574c"; c.lineWidth = 2 / k; c.setLineDash([ 6 / k, 4 / k ]); c.strokeRect( b.x - 2, b.y - 2, b.w + 4, b.h + 4 ); c.setLineDash([]);
		c.fillStyle = "#e2574c";
		handles( sel ).forEach(function(h){ c.fillRect( h.x - hs / 2, h.y - hs / 2, hs, hs ); });
	}
}

function resizable( it ) { return ["section", "rect", "vents", "slider", "button", "toggle"].indexOf( it.kind ) >= 0; }
// the handles of an item: its corner (resize) or the ends of a line
function handles( it )
{
	if(it.kind == "line") return [ { x: it.x, y: it.y, end: 1 }, { x: it.x2, y: it.y2, end: 2 } ];
	if(!resizable( it )) return [];
	var b = CS.box( it );
	return [ { x: b.x + b.w + 2, y: b.y + b.h + 2, end: 0 } ];
}

function toPanel( e )
{
	var r = el.front.getBoundingClientRect(), f = ed.fit;
	return { x: (e.clientX - r.left - f.ox) / f.k, y: (e.clientY - r.top - f.oy) / f.k };
}

// the item at p: the small ones over the areas they are on
function hitItem( p, list )
{
	list = list || panelList();
	var area = function(it){ return it.kind == "section" || it.kind == "vents" || it.kind == "rect"; };
	var inside = function(it){
		if(it.kind == "line") { var dx = it.x2 - it.x, dy = it.y2 - it.y, l2 = dx * dx + dy * dy || 1, t = Math.max( 0, Math.min( 1, ((p.x - it.x) * dx + (p.y - it.y) * dy) / l2 ) );
			var qx = it.x + t * dx - p.x, qy = it.y + t * dy - p.y; return qx * qx + qy * qy < 64; }
		var b = CS.box( it ); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
	};
	for(var i = list.length - 1; i >= 0; --i) if(!area( list[i] ) && inside( list[i] )) return list[i];
	for(var i = list.length - 1; i >= 0; --i) if(area( list[i] ) && inside( list[i] )) return list[i];
	return null;
}

function panelEvents()
{
	var cv = el.front;
	cv.addEventListener("pointerdown", function(e){
		if(!ed.fit) return;
		var p = toPanel( e ), sel = ed.sel && ed.sel.type == "item" ? byId( ed.sel.id ) : null, hs = 12 / ed.fit.k;
		if(sel && panelList().indexOf( sel ) >= 0)
		{
			var h = handles( sel ).find(function(h){ return Math.abs( p.x - h.x ) < hs && Math.abs( p.y - h.y ) < hs; });
			if(h)
			{
				ed.drag = { mode: "handle", it: sel, end: h.end, sx: p.x, sy: p.y, w0: sel.w || (sel.kind == "slider" ? 120 : 70), h0: sel.h || (sel.kind == "slider" ? 120 : 26) };
				cv.setPointerCapture( e.pointerId );
				return;
			}
		}
		var hit = hitItem( p );
		if(hit)
		{
			select({ type: "item", id: hit.id });
			ed.drag = { mode: "move", it: hit, px: p.x, py: p.y, x0: hit.x, y0: hit.y, x20: hit.x2, y20: hit.y2 };
			cv.setPointerCapture( e.pointerId );
		}
		else select( null );
	});
	cv.addEventListener("pointermove", function(e){
		if(!ed.fit) return;
		var p = toPanel( e ), d = ed.drag, f = ed.fit;
		if(d && d.mode == "move")
		{
			var it = d.it;
			it.x = Math.max( 0, Math.min( f.w, snap( d.x0 + p.x - d.px ) ) );
			it.y = Math.max( 0, Math.min( f.h, snap( d.y0 + p.y - d.py ) ) );
			if(d.x20 !== undefined) { it.x2 = d.x20 + it.x - d.x0; it.y2 = d.y20 + it.y - d.y0; }
			delete it.ix; delete it.iy; // inside, it follows its new place
		}
		else if(d && d.mode == "handle")
		{
			var it2 = d.it;
			if(d.end == 1) { it2.x = snap( p.x ); it2.y = snap( p.y ); }
			else if(d.end == 2) { it2.x2 = snap( p.x ); it2.y2 = snap( p.y ); }
			else if(it2.kind == "slider") it2.h = Math.max( 40, snap( d.h0 + p.y - d.sy ) );
			else { it2.w = Math.max( 20, snap( d.w0 + p.x - d.sx ) ); it2.h = Math.max( 10, snap( d.h0 + p.y - d.sy ) ); }
		}
		else
		{
			ed.hover = hitItem( p );
			var sel = ed.sel && ed.sel.type == "item" ? byId( ed.sel.id ) : null, hs = 12 / f.k;
			var onHandle = sel && handles( sel ).some(function(h){ return Math.abs( p.x - h.x ) < hs && Math.abs( p.y - h.y ) < hs; });
			cv.style.cursor = onHandle ? "nwse-resize" : (ed.hover ? "move" : "default");
		}
	});
	var up = function(){ if(ed.drag) { ed.drag = null; renderProps(); } };
	cv.addEventListener("pointerup", up);
	cv.addEventListener("pointercancel", up);
	cv.addEventListener("pointerleave", function(){ ed.hover = null; });
}

// ---------------------------------------------------------------------------
// INSIDE: nodes and wires

function wireColor( src, out )
{
	var k = src ? src.kind : "";
	if(out == "gate" || out == "on") return "#e8c547";
	if(out == "pitch" || k == "quant" || (k == "seq" && out == "cv")) return "#4fa3e0";
	if(["osc", "noise", "filter", "vca", "mix", "drive", "delay", "ain"].indexOf( k ) >= 0) return "#e05a47";
	return "#6cc070";
}

function innerPos( x )
{
	if(CAT.MODULES[ x.kind ]) return { x: x.x, y: x.y };
	if(x.ix !== undefined) return { x: x.ix, y: x.iy };
	// the back's sockets below everything else
	if(isBackItem( x )) return { x: snap( x.x * SPREAD ), y: snap( 1000 + x.y * 0.6 ) };
	return { x: snap( x.x * SPREAD ), y: snap( x.y * SPREAD ) };
}

function wiredInto( id, key ) { return S().wires.find(function(w){ return w.to[0] == id && w.to[1] == key; }); }
function portItems() { var s = S(); return s.items.concat( s.back ).filter(function(i){ var sp = CAT.specOf( i.kind ); return sp && !sp.deco; }); }

function renderInside()
{
	var s = S();
	el.nodes.innerHTML = "";
	ed.ports = {}; ed.gadgets = [];
	portItems().concat( s.nodes ).forEach(function(x){
		var sp = CAT.specOf( x.kind ), isCtl = !CAT.MODULES[ x.kind ], p = innerPos( x );
		var n = $e( "div", "se-node" + (isCtl ? " ctl" : "") + (isBackItem( x ) ? " rear" : "") );
		n.setAttribute( "data-id", x.id );
		n.style.left = p.x + "px"; n.style.top = p.y + "px";
		var head = $e( "div", "se-head", esc( sp.title ) + (isCtl && nameOf( x ) != sp.title ? '<small>' + esc( nameOf( x ) ) + '</small>' : '') );
		head.setAttribute( "data-drag", x.id );
		n.appendChild( head );
		// the gadget itself, live: the knob at its value, the LED lit with its input...
		if(isCtl)
		{
			var b = CS.box( x ), cv = $e( "canvas", "se-gadget" ), dpr = window.devicePixelRatio || 1;
			var gh = Math.round( Math.max( 34, Math.min( 110, b.h * 0.8 ) ) );
			cv.width = 166 * dpr; cv.height = gh * dpr; cv.style.height = gh + "px";
			cv.setAttribute( "data-drag", x.id ); // dragging it moves the node
			n.appendChild( cv );
			ed.gadgets.push({ cv: cv, x: x });
		}
		var ports = $e( "div", "se-ports" ), ci = $e( "div", "se-col in" ), co = $e( "div", "se-col out" );
		sp.ins.forEach(function(inp){
			var w = wiredInto( x.id, inp[0] ), row = $e( "div", "se-row" ), dot = $e( "span", "se-port in" + (w ? " on" : "") );
			dot.setAttribute( "data-node", x.id ); dot.setAttribute( "data-port", inp[0] ); dot.setAttribute( "data-dir", "in" );
			dot.title = inp[1] + (w ? "" : ": " + CAT.fmt( CAT.rangeOf( inp ), constOf( x, inp ) ));
			row.appendChild( dot );
			row.appendChild( document.createTextNode( inp[1] ) );
			if(!w && inp[5] != "audio" && inp[5] != "gate") row.appendChild( $e( "i", "", esc( CAT.fmt( CAT.rangeOf( inp ), constOf( x, inp ) ) ) ) );
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
		el.nodes.appendChild( n );
	});
	markSelection();
	applyWorld();
	drawGadgets();
	drawWires();
}

// the gadgets in the nodes, in the panel's colours, with the synth's live state (its LEDs)
function drawGadgets()
{
	if(!ed.gadgets || !ed.gadgets.length) return;
	var st = rack.module_state[ ed.mid ] || {}, s = S();
	ed.gadgets.forEach(function(g){
		var back = isBackItem( g.x ), bg = back ? CS.BACK.bg : (CS.COLORS[ s.color ] || CS.COLORS.dark).bg;
		drawSample( g.cv, g.x, back, 0, bg, st );
	});
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
	portItems().concat( s.nodes ).forEach(function(x){ var sp = CAT.specOf( x.kind ), p = innerPos( x ); xs.push( p.x, p.x + 170 ); ys.push( p.y, p.y + 40 + 20 * Math.max( sp.ins.length, sp.outs.length ) ); });
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
}

// ---------------------------------------------------------------------------
// properties of the selection

function field( label, input ) { var l = $e( "label", "se-field" ); l.appendChild( document.createTextNode( label ) ); l.appendChild( input ); return l; }
function textIn( v, fn ) { var i = $e( "input" ); i.value = v || ""; i.addEventListener("input", function(){ fn( i.value ); }); return i; }
function numIn( v, fn, min, max ) { var i = $e( "input" ); i.type = "number"; i.value = Math.round( v * 100 ) / 100; if(min !== undefined) i.min = min; if(max !== undefined) i.max = max; i.addEventListener("change", function(){ var n = +i.value; if(isFinite( n )) fn( n ); }); return i; }
function selIn( v, opts, fn ) { var s = $e( "select" ); opts.forEach(function(o){ var op = $e( "option" ); op.value = o[0]; op.textContent = o[1]; s.appendChild( op ); }); s.value = v; s.addEventListener("change", function(){ fn( s.value ); }); return s; }
function check( label, v, fn ) { var c = $e( "input" ); c.type = "checkbox"; c.checked = !!v; c.addEventListener("change", function(){ fn( c.checked ); }); var l = field( label, c ); l.classList.add( "check" ); return l; }
function btn( label, fn, cls ) { var b = $e( "button", cls || "" ); b.textContent = label; b.addEventListener("click", fn); return b; }
function paintOpts() { return Object.keys( CS.PAINT ).map(function(k){ return [ k, CS.PAINT[k][0] == "#" ? k.charAt( 0 ).toUpperCase() + k.substr( 1 ) : CS.PAINT[k] ]; }); }

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
		if(["knob", "slider", "button", "toggle", "jackin", "jackout", "led", "ain", "aout", "mainl", "mainr"].indexOf( x.kind ) >= 0)
			p.appendChild( field( "Label", textIn( x.label, function(v){ x.label = v.toUpperCase().substr( 0, 20 ); refreshInside(); } ) ) );
		switch(x.kind)
		{
			case "knob":
				p.appendChild( field( "Size", selIn( x.size, [["s", "Small"], ["m", "Medium"], ["l", "Large"], ["xl", "XL"], ["h", "Huge"]], function(v){ x.size = v; } ) ) );
				rangeFields( p, x );
				scaleFields( p, x );
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
			case "jackin": case "jackout": case "ain": case "aout":
				var list = isBackItem( x ) ? s.back : s.items, max = x.kind == "ain" || x.kind == "aout" ? CAT.ASLOTS : CAT.SLOTS;
				var used = list.filter(function(i){ return i.kind == x.kind && i !== x; }).map(function(i){ return i.slot; });
				var opts = []; for(var k = 1; k <= max; ++k) if(used.indexOf( k ) < 0) opts.push([ String( k ), "Socket " + k ]);
				p.appendChild( field( "Socket", selIn( String( x.slot ), opts, function(v){ x.slot = +v; } ) ) );
				if(x.kind == "jackin" || x.kind == "jackout")
					p.appendChild( field( "Signal", selIn( x.mode || "cv", [["cv", "CV / audio: ±5 V ↔ ±1"], ["pitch", "Pitch: 1 V / octave"], ["gate", "Gate: 5 V ↔ 1"]], function(v){ x.mode = v; } ) ) );
				else p.appendChild( $e( "p", "", "Line level audio, -1..1, on the back (Tab in the rack)." ) );
				break;
			case "mainl": case "mainr": case "midiin":
				p.appendChild( $e( "p", "", x.kind == "midiin" ? "The synth's MIDI input, with its channel switches. It is always on the back: move it where you like." :
					"Where the AUDIO OUT module's sound leaves (cabled to the speakers when the synth is added). Always on the back." ) );
				break;
			case "label":
				p.appendChild( field( "Text", textIn( x.text, function(v){ x.text = v; } ) ) );
				p.appendChild( field( "Size", numIn( x.size || 16, function(v){ x.size = Math.max( 8, Math.min( 80, v ) ); }, 8, 80 ) ) );
				p.appendChild( field( "Colour", selIn( x.color || (x.dim ? "dim" : "ink"), paintOpts(), function(v){ x.color = v; delete x.dim; } ) ) );
				p.appendChild( check( "Bold", x.bold !== false, function(v){ x.bold = v; } ) );
				break;
			case "section":
				p.appendChild( field( "Title", textIn( x.title, function(v){ x.title = v.toUpperCase(); } ) ) );
				p.appendChild( field( "Width", numIn( x.w || 200, function(v){ x.w = Math.max( 40, v ); }, 40, 1600 ) ) );
				p.appendChild( field( "Height", numIn( x.h || 120, function(v){ x.h = Math.max( 30, v ); }, 30, 700 ) ) );
				break;
			case "rect":
				p.appendChild( field( "Colour", selIn( x.color || "ink", paintOpts(), function(v){ x.color = v; } ) ) );
				p.appendChild( check( "Filled", x.fill, function(v){ x.fill = v; renderProps(); } ) );
				if(!x.fill) p.appendChild( field( "Line width", numIn( x.width || 2, function(v){ x.width = Math.max( 0.5, Math.min( 20, v ) ); }, 0.5, 20 ) ) );
				p.appendChild( field( "Corner radius", numIn( x.radius || 0, function(v){ x.radius = Math.max( 0, Math.min( 100, v ) ); }, 0, 100 ) ) );
				p.appendChild( field( "Width", numIn( x.w || 200, function(v){ x.w = Math.max( 4, v ); }, 4, 1600 ) ) );
				p.appendChild( field( "Height", numIn( x.h || 100, function(v){ x.h = Math.max( 4, v ); }, 4, 700 ) ) );
				break;
			case "line":
				p.appendChild( field( "Colour", selIn( x.color || "ink", paintOpts(), function(v){ x.color = v; } ) ) );
				p.appendChild( field( "Width", numIn( x.width || 2, function(v){ x.width = Math.max( 0.5, Math.min( 20, v ) ); }, 0.5, 20 ) ) );
				p.appendChild( $e( "p", "", "Drag its ends to change it, or the line itself to move it." ) );
				break;
			case "vents":
				p.appendChild( field( "Width", numIn( x.w || 200, function(v){ x.w = Math.max( 26, v ); }, 26, 1600 ) ) );
				p.appendChild( field( "Height", numIn( x.h || 100, function(v){ x.h = Math.max( 16, v ); }, 16, 700 ) ) );
				break;
		}
	}
	// the inputs: their wire, or their constant
	if(sp.ins.length && (isMod || x.kind == "led" || x.kind == "jackout" || x.kind == "aout"))
	{
		p.appendChild( $e( "h4", "", "INPUTS" ) );
		sp.ins.forEach(function(inp){
			var w = wiredInto( x.id, inp[0] ), box = $e( "div", "se-const" + (w ? " wired" : "") );
			if(w) box.textContent = inp[1] + "  ←  " + nameOf( byId( w.from[0] ) ) + " " + w.from[1].toUpperCase();
			else
			{
				var r = CAT.rangeOf( inp ), val = constOf( x, inp );
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
	if(x.kind != "out" && !sp.fixed) { b.appendChild( btn( "Duplicate", function(){ duplicate( x.id ); } ) ); b.appendChild( btn( "Delete", function(){ remove( sel ); }, "se-danger" ) ); }
	p.appendChild( b );
}

// a knob's scale: where it starts and ends, its lines, continuous or in steps
function scaleFields( p, x )
{
	p.appendChild( $e( "h4", "", "SCALE" ) );
	var presets = [["std", "Standard (7 to 5 o'clock)", -135, 135], ["wide", "Wide (almost a full turn)", -165, 165], ["full", "Full turn", -180, 180],
		["top", "Top half (9 to 3 o'clock)", -90, 90], ["right", "Right quarter", 0, 90], ["left", "Left quarter", -90, 0]];
	var a0 = x.start === undefined ? -135 : x.start, a1 = x.end === undefined ? 135 : x.end;
	var cur = presets.find(function(q){ return q[2] == a0 && q[3] == a1; });
	p.appendChild( field( "Turn", selIn( cur ? cur[0] : "custom", presets.map(function(q){ return [ q[0], q[1] ]; }).concat( cur ? [] : [["custom", "Custom"]] ), function(v){
		var q = presets.find(function(q){ return q[0] == v; }); if(q) { x.start = q[2]; x.end = q[3]; renderProps(); } } ) ) );
	p.appendChild( field( "Starts at (degrees from 12 o'clock, -180..180)", numIn( a0, function(v){ x.start = Math.max( -180, Math.min( 179, v ) ); renderProps(); }, -180, 179 ) ) );
	p.appendChild( field( "Ends at", numIn( a1, function(v){ x.end = Math.max( -179, Math.min( 180, v ) ); renderProps(); }, -179, 180 ) ) );
	var cont = !(x.steps > 1);
	p.appendChild( check( "Continuous (off: it clicks through steps)", cont, function(v){ if(v) delete x.steps; else x.steps = 5; renderProps(); } ) );
	if(!cont) p.appendChild( field( "Steps (positions)", numIn( x.steps, function(v){ x.steps = Math.max( 2, Math.min( 64, Math.round( v ) ) ); renderProps(); }, 2, 64 ) ) );
	var auto = x.ticks === undefined;
	p.appendChild( check( "Scale lines: automatic", auto, function(v){ if(v) delete x.ticks; else x.ticks = cont ? 11 : x.steps; renderProps(); } ) );
	if(!auto) p.appendChild( field( "Lines (0: none)", numIn( x.ticks, function(v){ x.ticks = Math.max( 0, Math.min( 101, Math.round( v ) ) ); }, 0, 101 ) ) );
	else p.appendChild( $e( "p", "", cont ? "Automatic: 31 fine lines." : "Automatic: a line for each step." ) );
}

// a knob's or slider's range: automatic (its first wire's input), or its own
function rangeFields( p, x )
{
	var s = S(), r = CAT.controlRange( s, x ), auto = !(x.range && x.range.min !== undefined);
	p.appendChild( check( "Automatic range (from its wire)", auto, function(v){ if(v) delete x.range; else x.range = { min: r.min, max: r.max, def: r.def, unit: r.unit }; renderProps(); } ) );
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

// nothing selected: the design, start again, My synths
function renderDesignInfo( p )
{
	var s = S();
	p.appendChild( $e( "h3", "", esc( s.name || "CUSTOM SYNTH" ) ) );
	p.appendChild( $e( "p", "", s.items.length + " front panel items, " + s.back.length + " on the back, " + s.nodes.length + " modules, " + s.wires.length + " wires. Select something to edit it." ) );
	p.appendChild( $e( "p", "", "Every module has inputs on its left and outputs on its right. An input with no wire uses its own value (set it here when the module is selected). Audio is -1..1, gates 0 or 1, pitch in octaves from C4." ) );
	// start again: an empty panel (MIDI IN and AUDIO OUT inside), or the example synth; a second click confirms
	p.appendChild( $e( "h4", "", "START AGAIN" ) );
	var row0 = $e( "div", "se-btns" );
	[ ["Empty panel", function(){ applyDesign({ name: "NEW SYNTH", height: s.height, color: s.color, knob_skin: s.knob_skin, wood: s.wood, width: mod().type == "custom_half" ? "half" : "full",
			items: [], back: CS.defaultBack( "NEW SYNTH" ), nodes: [ { id: "midi", kind: "midi", x: 0, y: 300 }, { id: "out", kind: "out", x: 700, y: 300 } ], wires: [], next: 1 });
			hint( "An empty panel: add items on the FRONT PANEL, modules INSIDE" ); } ],
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
	if(arrows[ e.key ] && ed.view != "inside" && ed.sel && ed.sel.type == "item")
	{
		var it = byId( ed.sel.id ), st = e.shiftKey ? 10 : 1, dx = arrows[ e.key ][0] * st, dy = arrows[ e.key ][1] * st;
		it.x += dx; it.y += dy; if(it.x2 !== undefined) { it.x2 += dx; it.y2 += dy; } delete it.ix; delete it.iy;
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
	applyDesignTo( mod(), d );
	ed.sel = null; ed.fitted = false;
	refreshTop(); setView( ed.view );
}
function applyDesignTo( m, d )
{
	var s = m.settings, keep = { midi_channel: s.midi_channel, midi_master: s.midi_master };
	Object.keys( s ).forEach(function(k){ delete s[k]; });
	var c = JSON.parse( JSON.stringify( d ) );
	m.type = c.width == "half" ? "custom_half" : "custom";
	delete c.width;
	Object.keys( c ).forEach(function(k){ s[k] = c[k]; });
	Object.keys( keep ).forEach(function(k){ if(keep[k] !== undefined) s[k] = keep[k]; });
	WR.types[ m.type ].validate( s, s );
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
	applyDesignTo( m, d );
	setStatus( "Added " + name + " (" + m.id + ") at the bottom of the rack" );
};

window.SynthEditor = { open: open, close: close, add: add, connect: connect, select: select, remove: remove, setView: setView, applyDesign: applyDesign,
	state: function(){ return ed; }, isOpen: function(){ return !!el.root && !el.root.hidden; } };

})();
