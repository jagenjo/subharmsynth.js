// devices/grid.js
// GRID 32 module (half rack width, as the effects): a 32 x 32 LED matrix to draw note patterns on.
// Columns are steps, rows the notes of the SCALE from ROOT and OCTAVE up (the bottom row the lowest).
// Click a cell to light it, drag to paint (or to clear, starting on a lit cell). 8 patterns (A-H),
// LENGTH, DIVISION, GATE, SWING, CHANCE, DIRECTION, TIE (cells side by side hold the note), tools to
// clear, randomize, copy / paste, shift the pattern in time or pitch. KEY / GATE (the lowest note),
// KEY 2 / GATE 2 (the highest), TRIG, CLOCK OUT and EOC out; CLOCK, RESET, TRANSPOSE and RUN in;
// MIDI IN (MIDI clock, KBD: the keys transpose it). MIDI on: it also plays the rack's synths over MIDI.
// DSP in grid-worklet.js.

(function(){

var H = 452, N = 32, CELL = 11;
var SX = 40, SY = 50;                // the screen's first cell (top left)
var SCALE_NAMES = ["CHROMATIC", "MAJOR", "MINOR", "DORIAN", "PHRYGIAN", "LYDIAN", "MIXOLYDIAN", "PENTA MAJOR", "PENTA MINOR", "BLUES", "HARMONIC MINOR", "WHOLE TONE"];
var SCALES = [
	[0,1,2,3,4,5,6,7,8,9,10,11], [0,2,4,5,7,9,11], [0,2,3,5,7,8,10], [0,2,3,5,7,9,10], [0,1,3,5,7,8,10], [0,2,4,6,7,9,11],
	[0,2,4,5,7,9,10], [0,2,4,7,9], [0,3,5,7,10], [0,3,5,6,7,10], [0,2,3,5,7,8,11], [0,2,4,6,8,10]
];
var DIV_NAMES = ["1/4", "1/8", "1/16", "1/32", "1/8T", "1/16T"];
var DIRS = [["fwd", "→"], ["rev", "←"], ["ping", "↔"], ["rnd", "?"]];
var NOTE_N = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var LETTERS = "ABCDEFGH";
var JACKS = [[
	["KEY", "out", "key"], ["GATE", "out", "gate"], ["KEY 2", "out", "key2"], ["GATE 2", "out", "gate2"], ["TRIG", "out", "trig"],
	["CLOCK OUT", "out", "clock_out"], ["EOC", "out", "eoc"], ["CLOCK IN", "in", "clock_in"], ["RESET", "in", "reset_in"], ["TRANSPOSE", "in", "transpose_in"],
	["RUN", "in", "run_in"]
]];

var M = null, S = null, ST = null;
var paint = {};   // module id -> { on, last } while painting
var clip = null;  // a copied pattern (shared by every GRID 32)

function emptyPattern() { var c = []; for(var i = 0; i < N; ++i) c.push( 0 ); return { cols: c }; }

function defaults()
{
	var pats = [];
	for(var p = 0; p < 8; ++p) pats.push( emptyPattern() );
	// pattern A: a little minor pentatonic line, rows of the scale
	var line = [7, -1, 9, 7, 10, -1, 7, 5, 7, -1, 12, 10, 9, -1, 7, -1];
	line.forEach(function(r, i){ if(r >= 0) pats[0].cols[i] = pats[0].cols[i + 16] = (1 << r) >>> 0; });
	pats[0].cols[0] = (pats[0].cols[0] | (1 << 2)) >>> 0;   // and a low note under the first and the 17th
	pats[0].cols[16] = (pats[0].cols[16] | 1) >>> 0;
	return {
		patterns: pats, pat: 0, len: 32, tempo: 120, sync: false, div: 2, gate: 0.6, swing: 0, chance: 1,
		dir: "fwd", tie: true, scale: 8, root: 0, octave: -2, midi: false, channel: 1, kbd_tr: false
	};
}

function validate( s, raw )
{
	var num = function(v, a, b, d) { v = +v; return isFinite( v ) ? Math.min( b, Math.max( a, v ) ) : d; };
	var rp = raw && Array.isArray( raw.patterns ) ? raw.patterns : null, pats = [];
	for(var p = 0; p < 8; ++p)
	{
		var src = rp ? rp[p] : s.patterns[p], pat = emptyPattern();
		if(src && Array.isArray( src.cols ))
			for(var c = 0; c < N; ++c) pat.cols[c] = (num( src.cols[c], 0, 4294967295, 0 ) >>> 0);
		pats.push( pat );
	}
	s.patterns = pats;
	s.pat = Math.round( num( s.pat, 0, 7, 0 ) );
	s.len = Math.round( num( s.len, 1, 32, 32 ) );
	s.div = Math.round( num( s.div, 0, DIV_NAMES.length - 1, 2 ) );
	s.scale = Math.round( num( s.scale, 0, SCALES.length - 1, 1 ) );
	s.root = Math.round( num( s.root, 0, 11, 0 ) );
	s.octave = Math.round( num( s.octave, -4, 3, -2 ) );
	s.channel = Math.round( num( s.channel, 1, 16, 1 ) );
	s.tempo = num( s.tempo, 20, 400, 120 );
	s.gate = num( s.gate, 0.02, 1, 0.6 ); s.swing = num( s.swing, 0, 0.75, 0 ); s.chance = num( s.chance, 0, 1, 1 );
	if(!DIRS.some(function(d){ return d[0] == s.dir; })) s.dir = "fwd";
}

// a random line: a walk over the scale, rests, now and then a third above
function randomPattern( s, pat )
{
	var row = 6 + Math.floor( Math.random() * 10 );
	for(var c = 0; c < N; ++c)
	{
		pat.cols[c] = 0;
		if(Math.random() < 0.3) continue;
		row = Math.max( 0, Math.min( 26, row + [-2, -1, -1, 0, 1, 1, 2, 3, -3][ Math.floor( Math.random() * 9 ) ] ) );
		var v = 1 << row;
		if(Math.random() < 0.15) v |= 1 << (row + 2);
		if(Math.random() < 0.2) v |= 1 << Math.max( 0, row - 7 );
		pat.cols[c] = v >>> 0;
	}
}

function randomize( s ) { randomPattern( s, s.patterns[ s.pat ] ); s.scale = [1, 2, 7, 8, 3][ Math.floor( Math.random() * 5 ) ]; }

function send( msg ) { var m = M; act(function(){ m.post( msg ); }); }

function noteOf( row ) { var sc = SCALES[ S.scale ], n = sc.length; return 12 * (S.octave + 5) + S.root + 12 * Math.floor( row / n ) + sc[ row % n ]; }
function noteName( n ) { return NOTE_N[ ((n % 12) + 12) % 12 ] + (Math.floor( n / 12 ) - 1); }
function bit( pat, c, r ) { return (pat.cols[c] >>> r) & 1; }
function setBit( pat, c, r, on ) { pat.cols[c] = (on ? pat.cols[c] | (1 << r) : pat.cols[c] & ~(1 << r)) >>> 0; }

function txt( t, x, y, size, color, align, bold )
{
	ctx.font = (bold ? "bold " : "") + (size || 10) + "px " + FONT;
	ctx.fillStyle = color || TEXT_COLOR;
	ctx.textAlign = align || "center";
	ctx.textBaseline = "middle";
	ctx.fillText( t, x, y );
}

// ---------------------------------------------------------------------------
// the screen

function drawScreen()
{
	var pat = S.patterns[ S.pat ], w = N * CELL, sc = SCALES[ S.scale ];
	// bezel and glass
	ctx.fillStyle = "#050505";
	ctx.beginPath(); ctx.roundRect( SX - 26, SY - 10, w + 36, w + 20, 6 ); ctx.fill();
	ctx.fillStyle = "#0b0d0b"; ctx.fillRect( SX - 2, SY - 2, w + 4, w + 4 );
	// row labels: the roots of the scale
	for(var r = 0; r < N; ++r)
		if(r % sc.length == 0)
			txt( noteName( noteOf( r ) ), SX - 6, SY + (N - 1 - r) * CELL + CELL / 2 + 0.5, 7, "#7c8a6a", "right" );
	var playing = ST.playing && ST.pos >= 0, blink = (performance.now() % 600) < 300;
	for(var c = 0; c < N; ++c)
	{
		var out = c >= S.len, head = playing && c == ST.pos;
		if(head) { ctx.fillStyle = "rgba(160,255,140,0.10)"; ctx.fillRect( SX + c * CELL, SY, CELL, w ); }
		for(var r = 0; r < N; ++r)
		{
			var x = SX + c * CELL + 1, y = SY + (N - 1 - r) * CELL + 1, on = bit( pat, c, r );
			if(on)
			{
				var hot = head && ((ST.lit >>> r) & 1);
				ctx.fillStyle = hot ? "#f4ffe0" : (out ? "#4a5a2a" : (head ? "#d8ff7a" : "#9ee04a"));
				ctx.fillRect( x, y, CELL - 2, CELL - 2 );
				if(hot) { ctx.fillStyle = "rgba(220,255,160,0.35)"; ctx.fillRect( x - 2, y - 2, CELL + 2, CELL + 2 ); }
				// TIE: cells side by side joined
				if(S.tie && c + 1 < N && bit( pat, c + 1, r ) && c + 1 < S.len) { ctx.fillStyle = out ? "#4a5a2a" : "#7bbf32"; ctx.fillRect( x + CELL - 2, y + 3, 2, CELL - 8 ); }
			}
			else
			{
				ctx.fillStyle = out ? "#0e100d" : (r % sc.length == 0 ? "#1d2419" : (c % 4 == 0 ? "#171b15" : "#141713"));
				ctx.fillRect( x, y, CELL - 2, CELL - 2 );
			}
		}
	}
	// beat numbers under the screen, the end of the pattern
	for(var c = 0; c < N; c += 4) txt( String( c + 1 ), SX + c * CELL + CELL / 2, SY + w + 6, 7, "#7c8a6a" );
	if(S.len < N) { ctx.fillStyle = "#e2574c"; ctx.fillRect( SX + S.len * CELL - 1, SY - 4, 2, w + 8 ); }

	// painting: click lights or clears, the drag goes on doing the same
	var id = id_prefix + "screen", p = paint[ M.id ];
	var inside = !cable_drag && hitRect( SX, SY, w, w ) && (ui.active === null || ui.active === id);
	var cc = Math.floor( (ui.x - SX) / CELL ), rr = N - 1 - Math.floor( (ui.y - SY) / CELL );
	if(inside)
	{
		ui.hot = id;
		if(cc >= 0 && cc < N && rr >= 0 && rr < N)
		{
			tip( "STEP " + (cc + 1) + " · " + noteName( noteOf( rr ) ), SX + cc * CELL + CELL / 2, SY - 16 );
			ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1;
			ctx.strokeRect( SX + cc * CELL + 0.5, SY + (N - 1 - rr) * CELL + 0.5, CELL - 1, CELL - 1 );
		}
	}
	if(inside && ui.pressed && ui.active === null && cc >= 0 && cc < N && rr >= 0 && rr < N)
	{
		ui.active = id;
		p = paint[ M.id ] = { on: !bit( pat, cc, rr ), last: null };
	}
	if(p && ui.active === id && ui.down)
	{
		cc = Math.max( 0, Math.min( N - 1, cc ) ); rr = Math.max( 0, Math.min( N - 1, rr ) );
		var key = cc + "_" + rr;
		if(key != p.last)
		{
			// the cells between the last one and this one (a fast drag)
			var c0 = p.last ? +p.last.split( "_" )[0] : cc, r0 = p.last ? +p.last.split( "_" )[1] : rr, steps = Math.max( Math.abs( cc - c0 ), Math.abs( rr - r0 ), 1 );
			for(var k = 1; k <= steps; ++k) setBit( pat, Math.round( c0 + (cc - c0) * k / steps ), Math.round( r0 + (rr - r0) * k / steps ), p.on );
			p.last = key;
		}
	}
	else if(p && ui.active !== id)
		delete paint[ M.id ];
}

// ---------------------------------------------------------------------------

function draw( mod )
{
	M = mod; S = mod.settings;
	ST = M.state = M.state || { playing: false, pos: -1, lit: 0, gate: false, clock: "int" };
	var size = M.def.size( layout ), w = size[0], h = size[1];
	drawCasing( 0, 0, w, h );
	txt( "GRID 32", 34, 22, 20, TEXT_COLOR, "left", true );
	txt( "PATTERN MATRIX", 128, 24, 9, DIM_COLOR, "left" );
	drawScreen();

	var x0 = SX + N * CELL + 26, rw = w - x0 - 28, pat = S.patterns[ S.pat ];
	// the LCD
	drawLcd( x0, 14, rw, 22, "PAT " + LETTERS[ S.pat ] + "  " + S.len + " STEPS  " + DIV_NAMES[ S.div ] + "  " +
		(ST.clock == "jack" ? "EXT CLOCK" : (ST.clock == "midi" ? "MIDI CLOCK" : (S.sync ? "RACK TEMPO" : Math.round( S.tempo ) + " BPM"))), "left" );
	// transport and switches
	var bw = (rw - 5 * 5) / 6, by = 46;
	if(button( "play", x0, by, bw, 24, ST.playing ? "STOP" : "PLAY", ST.playing ).clicked) send({ type: "play" });
	if(button( "reset", x0 + (bw + 5), by, bw, 24, "RESET" ).clicked) send({ type: "reset" });
	if(button( "tie", x0 + (bw + 5) * 2, by, bw, 24, "TIE", S.tie ).clicked) S.tie = !S.tie;
	if(button( "sync", x0 + (bw + 5) * 3, by, bw, 24, "SYNC", S.sync ).clicked) S.sync = !S.sync;
	if(button( "kbd", x0 + (bw + 5) * 4, by, bw, 24, "KBD", S.kbd_tr ).clicked) S.kbd_tr = !S.kbd_tr;
	var mb = button( "midi", x0 + (bw + 5) * 5, by, bw, 24, S.midi ? "CH " + S.channel : "MIDI", S.midi );
	if(mb.clicked) { if(!S.midi) S.midi = true; else if(ui.shift) S.midi = false; else S.channel = S.channel % 16 + 1; }
	if(hitRect( x0 + (bw + 5) * 5, by, bw, 24 )) tip( S.midi ? "MIDI ON CH " + S.channel + ": CLICK FOR THE NEXT CHANNEL, SHIFT+CLICK: OFF" : "MIDI: PLAY THE RACK'S SYNTHS TOO (OVER THE KEYS' MIDI)", x0 + (bw + 5) * 5 + bw / 2, by + 36 );
	// patterns A-H
	var pw = (rw - 7 * 4) / 8, py = 78;
	for(var p = 0; p < 8; ++p)
	{
		var empty = S.patterns[p].cols.every(function(v){ return !v; });
		if(button( "pat" + p, x0 + p * (pw + 4), py, pw, 22, LETTERS[p] + (empty ? "" : "•"), p == S.pat ).clicked) S.pat = p;
	}

	// knobs
	var kx = function(i, n){ return x0 + rw * (i + 0.5) / n; };
	var k1 = 152, k2 = 228;
	if(S.sync) txt( "RACK TEMPO", kx( 0, 5 ), k1 + 34, 8, DIM_COLOR );
	S.tempo = knob( "tempo", kx( 0, 5 ), k1, 17, S.tempo, 20, 400, { label: "TEMPO", exp: true, def: 120, style: "small", format: function(v){ return Math.round( v ) + " BPM"; } } );
	S.len = knob( "len", kx( 1, 5 ), k1, 17, S.len, 1, 32, { label: "LENGTH", step: 1, def: 32, style: "small", format: function(v){ return v + " STEPS"; } } );
	S.div = knob( "div", kx( 2, 5 ), k1, 17, S.div, 0, DIV_NAMES.length - 1, { label: "DIVISION", step: 1, def: 2, style: "small", format: function(v){ return DIV_NAMES[v] + " A STEP"; } } );
	S.gate = knob( "gate", kx( 3, 5 ), k1, 17, S.gate, 0.02, 1, { label: "GATE", def: 0.6, style: "small", format: function(v){ return Math.round( v * 100 ) + "% OF THE STEP"; } } );
	S.swing = knob( "swing", kx( 4, 5 ), k1, 17, S.swing, 0, 0.75, { label: "SWING", def: 0, style: "small", format: function(v){ return Math.round( 50 + v * 33.3 ) + "%"; } } );
	S.chance = knob( "chance", kx( 0, 5 ), k2, 17, S.chance, 0, 1, { label: "CHANCE", def: 1, style: "small", format: function(v){ return Math.round( v * 100 ) + "% OF THE NOTES PLAY"; } } );
	S.scale = knob( "scale", kx( 1, 5 ), k2, 17, S.scale, 0, SCALES.length - 1, { label: "SCALE", step: 1, def: 1, style: "small", format: function(v){ return SCALE_NAMES[v]; } } );
	S.root = knob( "root", kx( 2, 5 ), k2, 17, S.root, 0, 11, { label: "ROOT", step: 1, def: 0, style: "small", format: function(v){ return NOTE_N[v]; } } );
	S.octave = knob( "octave", kx( 3, 5 ), k2, 17, S.octave, -4, 3, { label: "OCTAVE", step: 1, def: -2, style: "small", format: function(v){ return "BOTTOM ROW " + noteName( 12 * (v + 5) + S.root ); } } );
	txt( SCALE_NAMES[ S.scale ], kx( 1, 5 ), k2 + 30, 8, DIM_COLOR );
	txt( NOTE_N[ S.root ] + " · " + noteName( noteOf( 0 ) ), kx( 2.5, 5 ), k2 + 30, 8, DIM_COLOR );
	// DIRECTION
	var d = DIRS.findIndex(function(o){ return o[0] == S.dir; });
	if(button( "dir", kx( 4, 5 ) - 24, k2 - 12, 48, 24, DIRS[d][1] ).clicked) S.dir = DIRS[ (d + 1) % DIRS.length ][0];
	txt( "DIRECTION", kx( 4, 5 ), k2 - 22, 9 );
	txt( ["FORWARD", "BACKWARD", "PING-PONG", "RANDOM"][d], kx( 4, 5 ), k2 + 22, 8, DIM_COLOR );

	// tools
	var tools = [["clear", "CLEAR"], ["rand", "RANDOM"], ["copy", "COPY"], ["paste", "PASTE"], ["left", "◀"], ["right", "▶"], ["down", "▼"], ["up", "▲"]];
	var tw = (rw - 7 * 4) / 8, ty = 270;
	tools.forEach(function(t, i){
		if(!button( t[0], x0 + i * (tw + 4), ty, tw, 22, t[1], t[0] == "paste" && !!clip ).clicked) return;
		switch(t[0])
		{
			case "clear": pat.cols = pat.cols.map(function(){ return 0; }); break;
			case "rand": randomPattern( S, pat ); break;
			case "copy": clip = pat.cols.slice(); setStatus( "GRID 32: pattern " + LETTERS[ S.pat ] + " copied" ); break;
			case "paste": if(clip) pat.cols = clip.slice(); break;
			case "left": pat.cols.push( pat.cols.shift() ); break;   // a step earlier
			case "right": pat.cols.unshift( pat.cols.pop() ); break;
			case "up": pat.cols = pat.cols.map(function(v){ return (v << 1) >>> 0; }); break;
			case "down": pat.cols = pat.cols.map(function(v){ return v >>> 1; }); break;
		}
	});

	// sockets
	var J = JACKS[0], jy1 = 336, jy2 = 404;
	for(var i = 0; i < 6; ++i) drawJack( J[i][2], x0 + rw * (i + 0.5) / 6, jy1, J[i][0], J[i][1] );
	for(var i = 6; i < 11; ++i) drawJack( J[i][2], x0 + rw * (i - 6 + 0.5) / 5, jy2, J[i][0], J[i][1] );
	drawLed( x0 + rw * 1.5 / 6 + 18, jy1 - 22, ST.gate, "#9ee04a" );
	M = null; S = null; ST = null;
}

WR.registerSynth( "grid", {
	title: "GRID 32",
	description: "GRID 32: a 32 x 32 LED matrix to draw note patterns, KEY / GATE out",
	about: "Draw notes on a 32 x 32 LED matrix: columns are steps, rows the notes of a scale. Two KEY / GATE pairs (lowest and highest note), ties, chance, swing, directions, 8 patterns, and MIDI to play the rack's synths.",
	key_prio: [["^(play|reset)$", 3], ["^pat\\d$", 2], ["^(rand|clear|left|right|up|down|dir|tie)$", 1], ["", 0]],
	knob_jacks: [["^tempo$", ["clock_in"]], ["^(root|octave|scale)$", ["transpose_in"]]],
	category: "Modulation",
	half: true,
	worklet: "devices/grid-worklet.js",
	jacks: JACKS,
	midi_in: "midi_in",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { return [ (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5, H ]; },
	draw: draw,
	rear_note: function( s ) { return "PATTERN " + LETTERS[ s.pat ] + " · " + SCALE_NAMES[ s.scale ] + (s.midi ? " · MIDI CH " + s.channel : ""); },
	transport: function( mod, action, value ) {
		if(action == "play") mod.post({ type: "play", value: value });
		else if(action == "reset") mod.post({ type: "reset" });
	}
});

})();
