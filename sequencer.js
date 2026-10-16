// sequencer.js
// The song sequencer in the bottom bar: tracks of notes, each on a MIDI channel, edited in a piano
// roll, played (and recorded) in a loop of whole bars. The song is rack.settings.song (saved with the
// patch, see WR.validateSong). Notes are scheduled ahead into the rack processor with their sample
// frame ({ type: "sched" }), so their timing doesn't depend on the page's frame rate. With SYNC on,
// the song also sends MIDI clock and start / stop to the synths the MIDI reaches.
// Drawn on its own canvas under the rack: a bar that raises into the sequencer panel.

(function(){

var cv = document.getElementById("seq");
var g = cv.getContext("2d");
var BAR_H = 30;
var LOOKAHEAD = 0.15, TICK = 25; // seconds scheduled ahead, ms between scheduler runs
var ROW_H = 12, KEYS_W = 44, RULER_H = 20, TRACKS_W = 250, TRACK_H = 30;
var NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
var COLORS = ["#e2574c","#f0a43a","#e8c547","#6cc070","#4fa3e0","#c77dd8","#ececec","#f08c3a"];
var FONT = "Antonio, Oswald, 'Arial Narrow', sans-serif";

var view = {
	open: false, h: 320, top_note: 76, // highest note shown in the piano roll
	px: -1, py: -1, down: false, drag: null, hot: null, sel_note: null, resize: null
};
try {
	var saved = JSON.parse( localStorage.getItem("SUBHARM_seq") || "{}" ) || {};
	view.open = !!saved.open;
	if(saved.h > 120) view.h = saved.h;
} catch(err) {}

var play = { on: false, rec: false, t0: 0, beat0: 0, sched: 0, sounding: [], pending: {}, last_beat: 0 };

function song() { return rack.settings.song; }
function track() { var s = song(); return s.tracks[ s.sel ]; }
function loopBeats() { return song().bars * 4; }
function gridBeats() { return 1 / song().grid; }
function noteName( n ) { return NOTE_NAMES[ n % 12 ] + (Math.floor( n / 12 ) - 1); }
// scrolls the piano roll to the selected track's notes
function fitView()
{
	var t = track(), rows = Math.floor( (view.h - BAR_H - RULER_H) / ROW_H );
	if(!t || !t.notes.length)
		return;
	var hi = Math.max.apply( null, t.notes.map(function(n){ return n[2]; }) );
	var lo = Math.min.apply( null, t.notes.map(function(n){ return n[2]; }) );
	view.top_note = Math.max( 20, Math.min( 127, Math.round( (hi + lo) / 2 + rows / 2 ), hi + Math.max( 2, rows - 2 ) ) );
	if(view.top_note - lo >= rows) // too wide to fit: the top notes stay in view
		view.top_note = Math.min( 127, hi + 2 );
}

function save() { try { localStorage.setItem( "SUBHARM_seq", JSON.stringify({ open: view.open, h: view.h }) ); } catch(err) {} }

// ---------------------------------------------------------------------------
// transport and scheduling

function ctxTime() { return rack.context ? rack.context.currentTime : 0; }
function beatAt( t ) { return play.beat0 + (t - play.t0) * song().bpm / 60; }
function timeAt( beat ) { return play.t0 + (beat - play.beat0) * 60 / song().bpm; }
function frameAt( beat ) { return Math.round( timeAt( beat ) * rack.context.sampleRate ); }

// the current position in the loop (beats)
function position()
{
	if(!play.on)
		return play.last_beat;
	var b = Math.max( 0, beatAt( ctxTime() ) );
	return song().loop ? b % loopBeats() : Math.min( b, loopBeats() );
}

function playable( t )
{
	var solo = song().tracks.some(function(o){ return o.solo; });
	return !t.mute && (!solo || t.solo);
}

function send( msg, beat )
{
	rack.post({ type: "sched", frame: frameAt( beat ), tag: "song", msg: msg });
}

// schedules the notes (and clock) of [from, to) beats
function scheduleRange( from, to )
{
	var s = song(), L = loopBeats();
	var first = Math.floor( from / L ), last = s.loop ? Math.floor( (to - 1e-9) / L ) : 0;
	for(var k = first; k <= last; ++k)
	{
		var base = k * L;
		s.tracks.forEach(function(t){
			if(!playable( t ))
				return;
			t.notes.forEach(function(n){
				if(n[0] >= L)
					return;
				var on = base + n[0];
				if(on < from || on >= to)
					return;
				var off = on + Math.min( n[1], L - n[0] );
				send({ type: "note", channel: t.channel, note: n[2], on: true, vel: n[3] }, on);
				send({ type: "note", channel: t.channel, note: n[2], on: false }, off - 0.001);
				play.sounding.push({ channel: t.channel, note: n[2], on: timeAt( on ), off: timeAt( off ) });
			});
		});
	}
	if(s.clock) // MIDI clock, 24 per beat
		for(var c = Math.ceil( from * 24 ); c < to * 24; ++c)
			send({ type: "midiClock" }, c / 24);
}

function scheduler()
{
	if(!play.on || !rack.context)
		return;
	var now = ctxTime();
	var to = beatAt( now + LOOKAHEAD );
	if(!song().loop)
	{
		to = Math.min( to, loopBeats() );
		if(beatAt( now ) >= loopBeats())
		{
			stop();
			return;
		}
	}
	if(to > play.sched)
	{
		scheduleRange( play.sched, to );
		play.sched = to;
	}
	play.sounding = play.sounding.filter(function(n){ return n.off > now - 0.5; });
}
setInterval( scheduler, TICK );

function start()
{
	act(function(){
		var now = ctxTime() + 0.05;
		play.t0 = now;
		play.beat0 = 0;
		play.sched = 0;
		play.on = true;
		play.sounding = [];
		if(song().clock)
			send({ type: "midiStart" }, 0);
		scheduler();
	});
}

// drops what is scheduled after now and releases the notes still sounding
function silence()
{
	var now = ctxTime();
	rack.post({ type: "unsched", tag: "song" });
	play.sounding.forEach(function(n){
		if(n.on <= now + LOOKAHEAD && n.off > now)
			rack.post({ type: "note", channel: n.channel, note: n.note, on: false });
	});
	play.sounding = [];
}

function stop()
{
	if(!play.on)
		return;
	play.last_beat = position();
	play.on = false;
	silence();
	if(song().clock)
		rack.post({ type: "midiStop" });
	finishRecording();
}

// after an edit while playing: what was scheduled ahead is scheduled again from now
function reschedule()
{
	if(!play.on)
		return;
	var now = ctxTime();
	var b = beatAt( now );
	silence();
	play.t0 = now;
	play.beat0 = b;
	play.sched = b;
	scheduler();
}

// ---------------------------------------------------------------------------
// recording: the keys and MIDI notes go into the selected track while playing with REC on

rack.onnote = function( note, on, channel, vel ) {
	if(!play.on || !play.rec)
		return;
	var b = beatAt( ctxTime() );
	if(on)
		play.pending[ note ] = { beat: b, vel: vel === undefined ? 1 : vel };
	else if(play.pending[ note ])
		addRecorded( note, play.pending[ note ], b );
};

function addRecorded( note, p, end )
{
	delete play.pending[ note ];
	var L = loopBeats(), gb = gridBeats();
	var start = Math.round( p.beat / gb ) * gb; // snapped to the grid
	var len = Math.max( gb / 2, Math.round( (end - p.beat) / gb ) * gb || gb );
	start = song().loop ? ((start % L) + L) % L : start;
	if(start >= L)
		return;
	track().notes.push([ start, Math.min( len, L ), note, p.vel ]);
}

function finishRecording()
{
	var b = play.on ? beatAt( ctxTime() ) : play.last_beat;
	Object.keys( play.pending ).forEach(function(n){ addRecorded( Number(n), play.pending[n], b ); });
}

// ---------------------------------------------------------------------------
// drawing

var ui = { buttons: [] }; // clickable rectangles of this frame: { x, y, w, h, fn, tip }

function rect( x, y, w, h, fill ) { g.fillStyle = fill; g.fillRect( x, y, w, h ); }

function text( t, x, y, size, color, align, bold )
{
	g.font = (bold ? "bold " : "") + (size || 12) + "px " + FONT;
	g.fillStyle = color || "#e8e4dc";
	g.textAlign = align || "left";
	g.textBaseline = "middle";
	g.fillText( t, x, y + 1 );
}

function btn( x, y, w, h, label, lit, fn, tip, color )
{
	var hover = view.px >= x && view.px <= x + w && view.py >= y && view.py <= y + h;
	g.fillStyle = lit ? (color || "#a33a2e") : (hover ? "#3a3a37" : "#2b2b29");
	g.beginPath(); g.roundRect( x, y, w, h, 4 ); g.fill();
	g.strokeStyle = lit ? "#c9483a" : "#44443f";
	g.lineWidth = 1;
	g.stroke();
	text( label, x + w * 0.5, y + h * 0.5, 12, lit ? "#fff" : "#e8e4dc", "center" );
	ui.buttons.push({ x: x, y: y, w: w, h: h, fn: fn, tip: tip });
	if(hover && tip)
		view.hot_tip = tip;
}

function drawBar( w )
{
	var s = song();
	rect( 0, 0, w, BAR_H, "#1a1a19" );
	rect( 0, 0, w, 1, "#2c2c2a" );
	var x = 10;
	btn( x, 5, 118, 20, (view.open ? "▼" : "▲") + " SEQUENCER", view.open, function(){ view.open = !view.open; if(view.open) fitView(); save(); },
		view.open ? "Lower the sequencer" : "Raise the sequencer: tracks and piano roll" );
	x += 128;
	btn( x, 5, 54, 20, play.on ? "■ STOP" : "▶ PLAY", play.on, function(){ play.on ? stop() : start(); }, "Play / stop the song", "#2f6b3a" );
	btn( x + 60, 5, 46, 20, "● REC", play.rec, function(){ play.rec = !play.rec; if(!play.rec) finishRecording(); },
		"Record the keys and MIDI into the selected track while playing" );
	btn( x + 112, 5, 46, 20, "LOOP", s.loop, function(){ s.loop = !s.loop; reschedule(); }, "Loop the song" );
	x += 170;
	var p = position();
	text( "BAR " + (Math.floor( p / 4 ) + 1) + "." + (Math.floor( p % 4 ) + 1), x, 15, 13, "#b6f06a", "left", true );
	x += 70;
	text( "BPM", x, 15, 11, "#8c8a84" );
	btn( x + 28, 5, 20, 20, "−", false, function(){ s.bpm = Math.max( 20, Math.round( s.bpm ) - (view.shift ? 1 : 5) ); reschedule(); }, "Slower (Shift: by 1)" );
	text( String( Math.round( s.bpm ) ), x + 66, 15, 13, "#e8e4dc", "center", true );
	btn( x + 84, 5, 20, 20, "+", false, function(){ s.bpm = Math.min( 300, Math.round( s.bpm ) + (view.shift ? 1 : 5) ); reschedule(); }, "Faster (Shift: by 1)" );
	x += 116;
	text( "BARS", x, 15, 11, "#8c8a84" );
	btn( x + 32, 5, 20, 20, "−", false, function(){ s.bars = Math.max( 1, s.bars - 1 ); reschedule(); }, "Shorter loop" );
	text( String( s.bars ), x + 66, 15, 13, "#e8e4dc", "center", true );
	btn( x + 80, 5, 20, 20, "+", false, function(){ s.bars = Math.min( 64, s.bars + 1 ); reschedule(); }, "Longer loop" );
	x += 112;
	btn( x, 5, 62, 20, "GRID 1/" + (s.grid * 4), false, function(){
		var i = WR.SONG_GRIDS.indexOf( s.grid );
		s.grid = WR.SONG_GRIDS[ (i + 1) % WR.SONG_GRIDS.length ];
	}, "Grid for new notes, moving and recording" );
	btn( x + 68, 5, 50, 20, "SYNC", s.clock, function(){ s.clock = !s.clock; if(!s.clock && play.on) rack.post({ type: "midiStop" }); },
		"Send MIDI clock and start / stop to the synths the MIDI reaches, so their sequencers follow the song" );
	x += 128;
	if(view.hot_tip)
		text( view.hot_tip, Math.max( x, w - 10 ), 15, 11, "#8c8a84", "right" );
}

function drawTracks( y0, h )
{
	var s = song();
	rect( 0, y0, TRACKS_W, h, "#141413" );
	s.tracks.forEach(function(t, i){
		var y = y0 + i * TRACK_H;
		if(y + TRACK_H > y0 + h - 30)
			return;
		var sel = i == s.sel;
		rect( 0, y, TRACKS_W, TRACK_H - 1, sel ? "#2a2a28" : "#1b1b1a" );
		rect( 0, y, 4, TRACK_H - 1, COLORS[ i % COLORS.length ] );
		ui.buttons.push({ x: 0, y: y, w: 110, h: TRACK_H, fn: function(){ s.sel = i; view.sel_note = null; fitView(); }, dbl: function(){
			var name = window.prompt( "Track name:", t.name );
			if(name && name.trim()) t.name = name.trim().substr( 0, 24 ).toUpperCase();
		}, tip: "Select (double-click: rename)" });
		text( t.name, 12, y + TRACK_H * 0.5, 12, sel ? "#fff" : "#c8c5bd", "left", sel );
		text( t.notes.length + " notes", 12, y + TRACK_H * 0.5 + 9, 8, "#6d6b66" );
		btn( 112, y + 5, 52, 20, "CH " + t.channel, false, function(){
			t.channel = (t.channel - 1 + (view.shift ? 15 : 1)) % 16 + 1; reschedule();
		}, "MIDI channel of the track (Shift: previous). Set the synths' CH on the back (Tab)" );
		btn( 168, y + 5, 22, 20, "M", t.mute, function(){ t.mute = !t.mute; reschedule(); }, "Mute", "#6b5a1c" );
		btn( 194, y + 5, 22, 20, "S", t.solo, function(){ t.solo = !t.solo; reschedule(); }, "Solo", "#2f5a6b" );
		btn( 220, y + 5, 22, 20, "×", false, function(){
			if(t.notes.length && !window.confirm( "Delete " + t.name + " and its " + t.notes.length + " notes?" ))
				return;
			s.tracks.splice( i, 1 );
			if(!s.tracks.length) s.tracks.push({ name: "TRACK 1", channel: 1, mute: false, solo: false, notes: [] });
			s.sel = Math.min( s.sel, s.tracks.length - 1 );
			reschedule();
		}, "Delete the track" );
	});
	var by = y0 + h - 26;
	btn( 8, by, 74, 20, "+ TRACK", false, function(){
		if(s.tracks.length >= 16) return;
		var used = s.tracks.map(function(t){ return t.channel; });
		var ch = 1; while(used.indexOf( ch ) != -1 && ch < 16) ch++;
		s.tracks.push({ name: "TRACK " + (s.tracks.length + 1), channel: ch, mute: false, solo: false, notes: [] });
		s.sel = s.tracks.length - 1;
	}, "Add a track on the next free channel" );
	btn( 88, by, 64, 20, "CLEAR", false, function(){
		var t = track();
		if(t.notes.length && window.confirm( "Clear the " + t.notes.length + " notes of " + t.name + "?" )) { t.notes = []; reschedule(); }
	}, "Remove the notes of the selected track" );
}

// piano roll geometry
function roll( x0, y0, w, h )
{
	var L = loopBeats();
	return { x: x0 + KEYS_W, y: y0 + RULER_H, w: w - KEYS_W, h: h - RULER_H, bw: (w - KEYS_W) / L, L: L };
}
function noteY( r, n ) { return r.y + (view.top_note - n) * ROW_H; }
function beatX( r, b ) { return r.x + b * r.bw; }

function drawRoll( x0, y0, w, h )
{
	var s = song(), r = roll( x0, y0, w, h ), t = track(), gb = gridBeats();
	var rows = Math.ceil( r.h / ROW_H );
	g.save();
	g.beginPath(); g.rect( x0, y0, w, h ); g.clip();
	// rows: black keys darker
	for(var i = 0; i <= rows; ++i)
	{
		var n = view.top_note - i, y = r.y + i * ROW_H;
		var black = [1,3,6,8,10].indexOf( n % 12 ) != -1;
		rect( r.x, y, r.w, ROW_H, black ? "#161615" : "#1d1d1c" );
		if(n % 12 == 0) rect( r.x, y + ROW_H - 1, r.w, 1, "#3a3936" );
		// keyboard strip
		rect( x0, y, KEYS_W - 1, ROW_H - 1, black ? "#2a2a28" : "#8f8c85" );
		if(n % 12 == 0) text( noteName( n ), x0 + 3, y + ROW_H * 0.5, 9, "#111" );
	}
	// grid lines: grid, beats, bars
	for(var b = 0; b <= r.L + 1e-9; b += gb)
	{
		var bar = Math.abs( b % 4 ) < 1e-9, beat = Math.abs( b % 1 ) < 1e-9;
		rect( beatX( r, b ), r.y, 1, r.h, bar ? "#4a4945" : (beat ? "#2f2e2c" : "#242423") );
	}
	// ruler
	rect( r.x, y0, r.w, RULER_H, "#232322" );
	for(var bar = 0; bar < s.bars; ++bar)
		text( String( bar + 1 ), beatX( r, bar * 4 ) + 4, y0 + RULER_H * 0.5, 10, "#b8b5ad" );
	// the other tracks' notes, faint
	s.tracks.forEach(function(o, k){
		if(o === t) return;
		g.globalAlpha = 0.18;
		o.notes.forEach(function(n){ rect( beatX( r, n[0] ), noteY( r, n[2] ) + 2, Math.max( 2, n[1] * r.bw ), ROW_H - 4, COLORS[ k % COLORS.length ] ); });
		g.globalAlpha = 1;
	});
	// this track's notes
	var color = COLORS[ s.sel % COLORS.length ];
	t.notes.forEach(function(n){
		var x = beatX( r, n[0] ), y = noteY( r, n[2] ), nw = Math.max( 3, n[1] * r.bw - 1 );
		g.globalAlpha = 0.45 + 0.55 * n[3];
		rect( x, y + 1, nw, ROW_H - 2, n[0] >= r.L ? "#555" : color );
		g.globalAlpha = 1;
		if(n === view.sel_note)
		{
			g.strokeStyle = "#fff"; g.lineWidth = 1.5;
			g.strokeRect( x + 0.5, y + 1.5, nw - 1, ROW_H - 3 );
		}
	});
	// play head
	if(play.on || play.last_beat > 0)
	{
		var px = beatX( r, position() );
		rect( px, y0, 2, h, play.on ? "#e8e4dc" : "#6d6b66" );
	}
	g.restore();
	view.roll = r;
}

function draw()
{
	requestAnimationFrame( draw );
	var w = cv.clientWidth, h = view.open ? view.h : BAR_H;
	if(parseInt( cv.style.height ) != h)
		cv.style.height = h + "px";
	var dpr = window.devicePixelRatio || 1;
	if(cv.width != Math.round( w * dpr ) || cv.height != Math.round( h * dpr ))
	{
		cv.width = Math.round( w * dpr );
		cv.height = Math.round( h * dpr );
	}
	g.setTransform( dpr, 0, 0, dpr, 0, 0 );
	ui.buttons = [];
	view.hot_tip = null;
	rect( 0, 0, w, h, "#111110" );
	if(view.open)
	{
		drawTracks( BAR_H, h - BAR_H );
		drawRoll( TRACKS_W, BAR_H, w - TRACKS_W, h - BAR_H );
		if(!view.hot_tip && view.roll && view.px > view.roll.x && view.py > view.roll.y)
			view.hot_tip = "CLICK: ADD A NOTE · DRAG: MOVE · DRAG THE END: LENGTH · RIGHT-CLICK: DELETE · WHEEL: SCROLL NOTES";
	}
	drawBar( w );
	// the resize grip on the top edge
	cv.style.cursor = view.resize ? "ns-resize" : (view.open && view.py < 4 ? "ns-resize" : (view.drag ? "grabbing" : "default"));
}

// ---------------------------------------------------------------------------
// input

function local( e )
{
	var r = cv.getBoundingClientRect();
	view.px = e.clientX - r.left;
	view.py = e.clientY - r.top;
	view.shift = e.shiftKey;
}

function noteAt( r, x, y )
{
	var t = track();
	for(var i = t.notes.length - 1; i >= 0; --i)
	{
		var n = t.notes[i], nx = beatX( r, n[0] ), ny = noteY( r, n[2] ), nw = Math.max( 3, n[1] * r.bw - 1 );
		if(x >= nx && x <= nx + nw && y >= ny && y <= ny + ROW_H)
			return { note: n, edge: x > nx + nw - 6 };
	}
	return null;
}

var last_click = 0;
cv.addEventListener("pointerdown", function(e){
	local( e );
	ensureAudio();
	var now = performance.now(), dbl = now - last_click < 350;
	last_click = now;
	if(view.open && view.py < 4)
	{
		view.resize = { y: e.clientY, h: view.h };
		cv.setPointerCapture( e.pointerId );
		return;
	}
	for(var i = ui.buttons.length - 1; i >= 0; --i)
	{
		var b = ui.buttons[i];
		if(view.px >= b.x && view.px <= b.x + b.w && view.py >= b.y && view.py <= b.y + b.h)
		{
			if(e.button == 0)
				(dbl && b.dbl ? b.dbl : b.fn)();
			return;
		}
	}
	var r = view.roll;
	if(!view.open || !r)
		return;
	if(view.px < r.x && view.py > r.y) // keyboard strip: hear the note
	{
		var n = view.top_note - Math.floor( (view.py - r.y) / ROW_H );
		var ch = track().channel;
		act(function(){ rack.post({ type: "note", channel: ch, note: n, on: true, vel: 1 }); });
		view.preview = { channel: ch, note: n };
		return;
	}
	if(view.px < r.x || view.py < r.y)
		return;
	var hit = noteAt( r, view.px, view.py );
	var t = track(), gb = gridBeats();
	if(e.button == 2)
	{
		if(hit) { t.notes.splice( t.notes.indexOf( hit.note ), 1 ); view.sel_note = null; reschedule(); }
		return;
	}
	cv.setPointerCapture( e.pointerId );
	if(hit)
	{
		view.sel_note = hit.note;
		view.drag = hit.edge ? { mode: "length", note: hit.note } :
			{ mode: "move", note: hit.note, db: (view.px - beatX( r, hit.note[0] )) / r.bw, n0: hit.note[2] };
		return;
	}
	// a new note on the grid, as long as the grid; dragging sets its length
	var b = Math.floor( (view.px - r.x) / r.bw / gb ) * gb;
	var note = view.top_note - Math.floor( (view.py - r.y) / ROW_H );
	var nn = [ b, gb, note, 0.8 ];
	t.notes.push( nn );
	view.sel_note = nn;
	view.drag = { mode: "length", note: nn };
	var ch = t.channel;
	act(function(){ rack.post({ type: "note", channel: ch, note: note, on: true, vel: 0.8 }); });
	view.preview = { channel: ch, note: note };
});

cv.addEventListener("pointermove", function(e){
	local( e );
	if(view.resize)
	{
		view.h = Math.max( 140, Math.min( window.innerHeight - 160, view.resize.h - (e.clientY - view.resize.y) ) );
		return;
	}
	var d = view.drag, r = view.roll;
	if(!d || !r)
		return;
	var gb = gridBeats(), n = d.note;
	if(d.mode == "length")
		n[1] = Math.max( gb, Math.round( ((view.px - r.x) / r.bw - n[0]) / gb ) * gb );
	else
	{
		n[0] = Math.max( 0, Math.min( r.L - gb, Math.round( ((view.px - r.x) / r.bw - d.db) / gb ) * gb ) );
		n[2] = Math.max( 0, Math.min( 127, view.top_note - Math.floor( (view.py - r.y) / ROW_H ) ) );
	}
});

function release()
{
	if(view.preview)
	{
		var p = view.preview;
		rack.post({ type: "note", channel: p.channel, note: p.note, on: false });
		view.preview = null;
	}
	if(view.drag)
	{
		view.drag = null;
		reschedule();
	}
	if(view.resize)
	{
		view.resize = null;
		save();
	}
}
cv.addEventListener("pointerup", function(e){ local( e ); release(); });
cv.addEventListener("pointercancel", release);
cv.addEventListener("pointerleave", function(){ view.px = view.py = -1; });
cv.addEventListener("contextmenu", function(e){ e.preventDefault(); });
cv.addEventListener("wheel", function(e){
	if(!view.open)
		return;
	view.top_note = Math.max( 20, Math.min( 127, view.top_note - Math.sign( e.deltaY ) * 3 ) );
	e.preventDefault();
}, { passive: false });

// Delete / Backspace removes the selected note
window.addEventListener("keydown", function(e){
	if(!view.open || !view.sel_note || isTextField( e.target ))
		return;
	if(e.code == "Delete" || e.code == "Backspace")
	{
		var t = track(), i = t.notes.indexOf( view.sel_note );
		if(i != -1) { t.notes.splice( i, 1 ); reschedule(); }
		view.sel_note = null;
		e.preventDefault();
	}
});

// a patch loaded while playing: start over with its song
var last_song = null;
setInterval(function(){
	if(song() !== last_song)
	{
		if(last_song && play.on) { stop(); }
		last_song = song();
		view.sel_note = null;
		fitView();
	}
}, 100);

draw();

// for the tests
window.SEQ = { view: view, play: play, start: start, stop: stop, scheduleRange: scheduleRange, position: position, roll: function(){ return view.roll; } };

})();
