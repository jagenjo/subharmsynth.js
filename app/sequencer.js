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
var ROW_H = 12, KEYS_W = 44, RULER_H = 20, TRACKS_W = 250, TRACK_H = 44;
var NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
var COLORS = ["#e2574c","#f0a43a","#e8c547","#6cc070","#4fa3e0","#c77dd8","#ececec","#f08c3a"];
var FONT = "Antonio, Oswald, 'Arial Narrow', sans-serif";

var view = {
	open: false, h: 320, top_note: 76, // highest note shown in the piano roll
	px: -1, py: -1, down: false, drag: null, hot: null, resize: null,
	sel: [],       // the selected notes of the track
	menu: null,    // the track options menu: { i, x, y }
	clip: null,    // a copied track
	rename: null   // the track name being edited
};
try {
	var saved = JSON.parse( localStorage.getItem("SUBHARM_seq") || "{}" ) || {};
	view.open = !!saved.open;
	if(saved.h > 120) view.h = saved.h;
} catch(err) {}

var play = { on: false, rec: false, t0: 0, beat0: 0, sched: 0, sounding: [], pending: {}, last_beat: 0 };

// DETACHED: the sequencer's canvas in a window of its own (see detach()); its window and document
var pop = null;
function W() { return pop ? pop.win : window; }
function D() { return pop ? pop.win.document : document; }

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

// ---------------------------------------------------------------------------
// CV TRACKS: a knob's (or fader's) movements over the song, [beat, 0..1] points. Turned while the song
// plays with REC on, a knob gets its CV track (made then if it has none); playing, the tracks turn
// their knobs (unless the hand is on one). "+ CV" makes a track for the next knob touched

function isCv( t ) { return !!t && t.type == "cv"; }

function cvValue( t, b )
{
	var p = t.points;
	if(!p.length) return null;
	if(b <= p[0][0]) return p[0][1];
	for(var i = 1; i < p.length; ++i)
		if(b < p[i][0])
		{
			var a = p[i - 1], c = p[i];
			return c[0] > a[0] ? a[1] + (c[1] - a[1]) * (b - a[0]) / (c[0] - a[0]) : c[1];
		}
	return p[ p.length - 1 ][1];
}

function cvTrackFor( id, make )
{
	var s = song(), t = s.tracks.find(function(o){ return isCv( o ) && o.target == id; });
	if(!t && make && s.tracks.length < 16)
	{
		t = { type: "cv", name: (typeof controlName == "function" ? controlName( id ) : id).substr( 0, 24 ), target: id, channel: 1, mute: false, solo: false, notes: [], points: [] };
		s.tracks.push( t );
	}
	return t;
}

// writes v at beat b, the points since the last one written (from) replaced: a recorded or drawn stroke
function cvWrite( t, from, b, v )
{
	var p = t.points;
	if(from !== null && b >= from)
	{
		t.points = p = p.filter(function(q){ return !(q[0] > from && q[0] <= b); });
		var last = p.find(function(q){ return q[0] == from; });
		if(last && b - from < 1 / 48) { last[1] = v; return from; } // close together: the last one moves
	}
	var i = 0;
	while(i < p.length && p[i][0] < b) ++i;
	if(p[i] && p[i][0] == b) p[i][1] = v;
	else p.splice( i, 0, [ b, v ] );
	return b;
}

var cvrec = {};   // control id -> { beat, time } of its last point recorded
var cvsent = {};  // control id -> the value last sent
WR.knobMoved = function( id, n )
{
	if(view.cvlearn) // + CV: this knob
	{
		view.cvlearn = false;
		var nt = cvTrackFor( id, true );
		if(nt) { song().sel = song().tracks.indexOf( nt ); view.sel = []; }
		return;
	}
	if(!play.on || !play.rec) return;
	var t = cvTrackFor( id, true );
	if(!t) return;
	var b = position(), r = cvrec[id], now = performance.now();
	var from = r && now - r.time < 150 && b >= r.beat ? r.beat : null; // a new touch, or the loop came round
	cvrec[id] = { beat: cvWrite( t, from, b, Math.round( n * 10000 ) / 10000 ), time: now };
};

// the knobs follow their CV tracks while the song plays
function applyCv()
{
	if(!play.on || typeof midictl == "undefined") return;
	var b = position(), now = performance.now();
	song().tracks.forEach(function(t){
		if(!isCv( t ) || t.mute || !t.points.length) return;
		var r = cvrec[ t.target ];
		if(window.ui && window.ui.active === t.target) return;        // the hand on it
		if(play.rec && r && now - r.time < 300) return;               // just recorded
		var v = cvValue( t, b );
		if(cvsent[ t.target ] !== undefined && Math.abs( v - cvsent[ t.target ] ) < 1e-4) return;
		cvsent[ t.target ] = v;
		midictl.pending[ t.target ] = v;
	});
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
var sched_timer = setInterval( scheduler, TICK );

function start()
{
	if(window.gfTrack) gfTrack( "song-play", null, true );
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

// ---------------------------------------------------------------------------
// EXPORT WAV: the song played once from the start, recorded from the master output (real time), its
// tail kept until it is silent (at most 10 s more), saved as a stereo 16-bit WAV file

var wav = null; // { rec, start, end, stopped }

function wavSeconds() { return wav && rack.context ? Math.max( 0, ctxTime() - wav.start ).toFixed( 1 ) + " s" : ""; }

function exportWav()
{
	if(wav) { finishWav(); return; } // a second click: stop and save what is there
	if(window.gfTrack) gfTrack( "export-wav" );
	act(function(){
		if(!rack.node || !rack.recordStart) return;
		if(play.on) stop();
		play.rec = false;
		wav = { rec: rack.recordStart(), start: ctxTime(), end: 0, stopped: 0 };
		start();
		wav.timer = setInterval( wavTick, 50 );
		setStatus( "Recording the song (" + (loopBeats() * 60 / song().bpm).toFixed( 1 ) + " s and its tail)…", true );
	});
}

function wavTick()
{
	if(!wav) return;
	var now = ctxTime(), r = wav.rec, sr = rack.context.sampleRate;
	if(!wav.end) // the song starts (start() waits for the audio)
	{
		if(!play.on || play.t0 < wav.start) return;
		wav.end = play.t0 + loopBeats() * 60 / song().bpm;
	}
	if(play.on && now >= wav.end) stop();
	if(play.on) return;
	if(!wav.stopped) wav.stopped = now;
	var songFrames = (Math.min( wav.end, wav.stopped ) - wav.start) * sr;
	var quiet = r.frames > songFrames && (r.frames - r.lastLoud) / sr > 0.5;
	if(quiet || now - wav.stopped > 10)
		finishWav();
}

function finishWav()
{
	var w = wav;
	if(!w) return;
	wav = null;
	clearInterval( w.timer );
	if(play.on) stop();
	var sr = rack.context.sampleRate;
	rack.recordStop( Math.round( (Math.min( w.end || ctxTime(), w.stopped || ctxTime() ) - w.start) * sr ) ).then(function(res){
		if(!res.L.length) { setStatus( "Nothing recorded" ); return; }
		var blob = new Blob([ WR.encodeWav( res.L, res.R, res.sampleRate ) ], { type: "audio/wav" });
		var d = new Date(), p2 = function(v){ return (v < 10 ? "0" : "") + v; };
		var a = D().createElement( "a" );
		a.href = URL.createObjectURL( blob );
		a.download = "song " + d.getFullYear() + "-" + p2( d.getMonth() + 1 ) + "-" + p2( d.getDate() ) + " " + p2( d.getHours() ) + "-" + p2( d.getMinutes() ) + ".wav";
		D().body.appendChild( a ); a.click(); a.remove();
		setTimeout(function(){ URL.revokeObjectURL( a.href ); }, 2000);
		var db = res.peak > 0 ? 20 * Math.log10( res.peak ) : -Infinity;
		setStatus( a.download + ": " + (res.L.length / res.sampleRate).toFixed( 1 ) + " s, peak " + (isFinite( db ) ? db.toFixed( 1 ) + " dB" : "silent") + (res.peak >= 1 ? " (clipped: turn MASTER down)" : "") );
	});
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
	if(pop)
		btn( x, 5, 118, 20, "⇲ ATTACH", false, attach, "Put the sequencer back in the main window" );
	else
		btn( x, 5, 118, 20, (view.open ? "▼" : "▲") + " SEQUENCER", view.open, function(){ view.open = !view.open; if(view.open) fitView(); save(); },
			view.open ? "Lower the sequencer" : "Raise the sequencer: tracks and piano roll" );
	x += 128;
	btn( x, 5, 54, 20, play.on ? "■ STOP" : "▶ PLAY", play.on, function(){ play.on ? stop() : start(); }, "Play / stop the song", "#2f6b3a" );
	btn( x + 60, 5, 46, 20, "● REC", play.rec, function(){ play.rec = !play.rec; if(!play.rec) finishRecording(); },
		"Record while playing: the keys and MIDI into the selected track, the knobs turned into their CV tracks" );
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
	btn( x, 5, 96, 20, wav ? "■ WAV " + wavSeconds() : "EXPORT WAV", !!wav, exportWav,
		wav ? "Recording the song: click to stop and save now" : "Play the song once from the start and save it as a WAV file", "#8a2a7a" );
	x += 106;
	if(!pop)
	{
		btn( x, 5, 80, 20, "⇱ WINDOW", false, detach, "The sequencer in a window of its own (closing it brings it back)" );
		x += 90;
	}
	if(view.hot_tip)
		text( view.hot_tip, Math.max( x, w - 10 ), 15, 11, "#8c8a84", "right" );
}

function drawTracks( y0, h )
{
	var s = song();
	rect( 0, y0, TRACKS_W, h, "#141413" );
	s.tracks.forEach(function(t, i){
		var y = y0 + i * TRACK_H, by = y + (TRACK_H - 20) * 0.5;
		if(y + TRACK_H > y0 + h - 30)
			return;
		var sel = i == s.sel;
		rect( 0, y, TRACKS_W, TRACK_H - 1, sel ? "#2a2a28" : "#1b1b1a" );
		rect( 0, y, 4, TRACK_H - 1, COLORS[ i % COLORS.length ] );
		ui.buttons.push({ x: 0, y: y, w: 110, h: TRACK_H, fn: function(){ if(s.sel != i) { s.sel = i; view.sel = []; fitView(); } }, dbl: function(){
			renameTrack( i, 8, y + TRACK_H * 0.5 - 17 );
		}, tip: "Select (double-click: rename)" });
		if(!(view.rename && view.rename.i == i))
		{
			g.font = (sel ? "bold " : "") + "13px " + FONT;
			var nm = t.name;
			while(nm.length > 3 && g.measureText( nm ).width > 96) nm = nm.slice( 0, -1 );
			text( nm == t.name ? nm : nm.slice( 0, -1 ) + "…", 12, y + TRACK_H * 0.5 - 6, 13, sel ? "#fff" : "#c8c5bd", "left", sel );
			var gone = isCv( t ) && !rack.settings.modules.some(function(m){ return t.target.indexOf( m.id + "." ) == 0; });
			text( isCv( t ) ? t.points.length + " points" + (gone ? " · DEVICE GONE" : "") : t.notes.length + " notes", 12, y + TRACK_H * 0.5 + 10, 9, gone ? "#c0574c" : "#6d6b66" );
		}
		if(isCv( t ))
		{
			g.fillStyle = "#3a2f4a"; g.beginPath(); g.roundRect( 112, by, 78, 20, 4 ); g.fill();
			text( "CV", 151, by + 10, 12, "#d9c4ff", "center", true );
			ui.buttons.push({ x: 112, y: by, w: 78, h: 20, fn: function(){ s.sel = i; view.sel = []; }, tip: "Knob automation: " + t.target.toUpperCase() });
		}
		else
		{
			btn( 112, by, 52, 20, "CH " + t.channel, false, function(){
				t.channel = (t.channel - 1 + (view.shift ? 15 : 1)) % 16 + 1; reschedule();
			}, "MIDI channel of the track (Shift: previous). Set the synths' CH on the back (Tab)" );
			btn( 168, by, 22, 20, "M", t.mute, function(){ t.mute = !t.mute; reschedule(); }, "Mute", "#6b5a1c" );
		}
		if(isCv( t ))
			btn( 194, by, 22, 20, "M", t.mute, function(){ t.mute = !t.mute; }, "Mute: the knob is left alone", "#6b5a1c" );
		else
			btn( 194, by, 22, 20, "S", t.solo, function(){ t.solo = !t.solo; reschedule(); }, "Solo", "#2f5a6b" );
		btn( 220, by, 22, 20, "⋮", !!(view.menu && view.menu.i == i), function(){
			view.menu = view.menu && view.menu.i == i ? null : { i: i, x: 132, y: by + 22 };
		}, "Track options: copy, paste, delete, move up / down", "#4a4a45" );
		ui.buttons[ ui.buttons.length - 1 ].menu = true; // it toggles the menu itself
	});
	var by = y0 + h - 26;
	btn( 8, by, 58, 20, "+ TRACK", false, function(){
		if(s.tracks.length >= 16) return;
		var used = s.tracks.map(function(t){ return t.channel; });
		var ch = 1; while(used.indexOf( ch ) != -1 && ch < 16) ch++;
		s.tracks.push({ name: "TRACK " + (s.tracks.length + 1), channel: ch, mute: false, solo: false, notes: [] });
		s.sel = s.tracks.length - 1; view.sel = [];
	}, "Add a track on the next free channel" );
	btn( 70, by, 40, 20, "+ CV", !!view.cvlearn, function(){
		if(s.tracks.length >= 16) return;
		view.cvlearn = !view.cvlearn;
		if(view.cvlearn && window.setStatus) setStatus( "+ CV: turn the knob (or fader) the new CV track moves", true );
	}, view.cvlearn ? "Now turn a knob in the rack (click again: cancel)" : "A CV track for a knob: click, then turn the knob", "#5a3f86" );
	btn( 114, by, 48, 20, "CLEAR", false, function(){
		var t = track(), n = isCv( t ) ? t.points.length : t.notes.length;
		if(n && W().confirm( "Clear the " + n + (isCv( t ) ? " points" : " notes") + " of " + t.name + "?" )) { t.notes = []; if(isCv( t )) t.points = []; view.sel = []; reschedule(); }
	}, "Remove the notes (or CV points) of the selected track" );
	btn( 166, by, 76, 20, "MIDI FILE", false, function(){ midiFileInput().click(); },
		"Load a standard MIDI file (.mid): its tracks replace the song's" );
}

// the track options menu, drawn over everything (a click elsewhere closes it)
function drawMenu( H )
{
	var m = view.menu, s = song();
	if(!m) return;
	if(m.i >= s.tracks.length) { view.menu = null; return; }
	var items = [
		[ "COPY", true, function(){ view.clip = JSON.parse( JSON.stringify( s.tracks[ m.i ] ) ); } ],
		[ "PASTE", !!view.clip && s.tracks.length < 16, function(){
			var t = JSON.parse( JSON.stringify( view.clip ) );
			t.name = (t.name.substr( 0, 19 ) + " COPY").trim();
			t.solo = false;
			s.tracks.splice( m.i + 1, 0, t ); s.sel = m.i + 1; view.sel = []; reschedule();
		} ],
		[ "DELETE", true, function(){
			var t = s.tracks[ m.i ];
			if(t.notes.length && !W().confirm( "Delete " + t.name + " and its " + t.notes.length + " notes?" ))
				return;
			s.tracks.splice( m.i, 1 );
			if(!s.tracks.length) s.tracks.push({ name: "TRACK 1", channel: 1, mute: false, solo: false, notes: [] });
			s.sel = Math.min( s.sel > m.i ? s.sel - 1 : s.sel, s.tracks.length - 1 ); view.sel = [];
			reschedule();
		} ],
		[ "MOVE UP", m.i > 0, function(){ moveTrack( m.i, -1 ); } ],
		[ "MOVE DOWN", m.i < s.tracks.length - 1, function(){ moveTrack( m.i, 1 ); } ]
	];
	var w = 110, ih = 24, mh = items.length * ih + 6, x = m.x, y = m.y + mh > H ? Math.max( BAR_H, m.y - 24 - mh ) : m.y;
	g.fillStyle = "#262624"; g.strokeStyle = "#55554f"; g.lineWidth = 1;
	g.beginPath(); g.roundRect( x, y, w, mh, 5 ); g.fill(); g.stroke();
	ui.buttons.push({ x: x, y: y, w: w, h: mh, menu: true, fn: function(){} }); // its gaps: no click through
	items.forEach(function(it, k){
		var iy = y + 3 + k * ih, hover = it[1] && view.px >= x && view.px <= x + w && view.py >= iy && view.py < iy + ih;
		if(hover) rect( x + 3, iy, w - 6, ih, "#3d3d39" );
		text( it[0], x + 12, iy + ih * 0.5, 12, it[1] ? (it[0] == "DELETE" ? "#f08070" : "#e8e4dc") : "#5d5b56" );
		ui.buttons.push({ x: x, y: iy, w: w, h: ih, menu: true, fn: function(){ if(!it[1]) return; view.menu = null; it[2](); } });
	});
}

function moveTrack( i, d )
{
	var s = song(), j = i + d;
	if(j < 0 || j >= s.tracks.length) return;
	var t = s.tracks[i]; s.tracks[i] = s.tracks[j]; s.tracks[j] = t;
	if(s.sel == i) s.sel = j; else if(s.sel == j) s.sel = i;
}

// double-click a track's name: edit it in place (Enter or a click elsewhere keeps it, Escape does not)
function renameTrack( i, x, y )
{
	var t = song().tracks[i], r = cv.getBoundingClientRect(), inp = D().createElement( "input" );
	inp.value = t.name; inp.maxLength = 24; inp.spellcheck = false;
	inp.style.cssText = "position:fixed;z-index:50;left:" + (r.left + x) + "px;top:" + (r.top + y) + "px;width:100px;height:22px;box-sizing:border-box;" +
		"font:bold 13px " + FONT + ";text-transform:uppercase;background:#0e0e0d;color:#fff;border:1px solid #b6f06a;border-radius:3px;padding:0 4px;outline:none";
	var done = false;
	function finish( ok )
	{
		if(done) return;
		done = true;
		if(ok && inp.value.trim()) t.name = inp.value.trim().substr( 0, 24 ).toUpperCase();
		view.rename = null;
		if(inp.parentNode) inp.parentNode.removeChild( inp );
	}
	view.rename = { i: i, input: inp, finish: finish };
	inp.addEventListener("keydown", function(e){
		e.stopPropagation();
		if(e.key == "Enter") finish( true );
		else if(e.key == "Escape") finish( false );
	});
	inp.addEventListener("blur", function(){ finish( true ); });
	D().body.appendChild( inp );
	inp.focus(); inp.select();
}

// ---------------------------------------------------------------------------
// MIDI files: every channel of every track with notes becomes a track (up to 16), the first tempo
// sets the BPM, and the song gets as many bars as the notes need (up to 64)

function parseMidi( buf )
{
	var d = new Uint8Array( buf ), p = 0;
	function u32() { var v = (d[p] << 24 | d[p+1] << 16 | d[p+2] << 8 | d[p+3]) >>> 0; p += 4; return v; }
	function u16() { var v = d[p] << 8 | d[p+1]; p += 2; return v; }
	function str4() { var v = String.fromCharCode( d[p], d[p+1], d[p+2], d[p+3] ); p += 4; return v; }
	function vlq() { var v = 0, b; do { b = d[p++]; v = v * 128 + (b & 0x7F); } while(b & 0x80 && p < d.length); return v; }
	if(d.length < 14 || str4() != "MThd")
		throw new Error( "not a MIDI file" );
	var hlen = u32(), hstart = p; u16(); var ntrks = u16(), div = u16();
	p = hstart + hlen;
	var ppq = div & 0x8000 ? 96 : (div || 96), tempo = 0, out = [];
	for(var k = 0; k < ntrks && p + 8 <= d.length; ++k)
	{
		var id = str4(), len = u32(), end = Math.min( d.length, p + len );
		if(id != "MTrk") { p = end; continue; }
		var tick = 0, run = 0, name = "", open = {}, byCh = {};
		while(p < end)
		{
			tick += vlq();
			var st = d[p];
			if(st & 0x80) p++; else st = run;
			if(st == 0xFF)
			{
				var type = d[p++], l = vlq();
				if(type == 0x51 && l == 3 && !tempo) tempo = 60000000 / (d[p] << 16 | d[p+1] << 8 | d[p+2]);
				if(type == 0x03 && !name) for(var c = 0; c < l; ++c) name += String.fromCharCode( d[p + c] );
				p += l;
				if(type == 0x2F) break;
				continue;
			}
			if(st == 0xF0 || st == 0xF7) { p += vlq(); continue; }
			if(!(st & 0x80)) break; // corrupt: data without a status
			run = st;
			var cmd = st & 0xF0, ch = st & 0x0F, a = d[p++], b = cmd == 0xC0 || cmd == 0xD0 ? 0 : d[p++];
			if(cmd == 0x90 && b > 0)
			{
				var key = ch * 128 + a;
				(open[key] = open[key] || []).push([ tick, b ]);
			}
			else if(cmd == 0x80 || cmd == 0x90)
			{
				var o = open[ ch * 128 + a ];
				if(o && o.length)
				{
					var on = o.shift();
					(byCh[ch] = byCh[ch] || []).push([ on[0] / ppq, Math.max( 1 / 64, (tick - on[0]) / ppq ), a, on[1] / 127 ]);
				}
			}
		}
		p = end;
		Object.keys( byCh ).forEach(function(ch){
			var notes = byCh[ch].sort(function(x, y){ return x[0] - y[0]; });
			out.push({ name: name.replace( /[^\x20-\x7E]/g, "" ).trim() || "MIDI " + (out.length + 1), channel: +ch + 1, mute: false, solo: false, notes: notes });
		});
	}
	return { bpm: tempo || 120, tracks: out };
}

function loadMidiFile( buf )
{
	var m = parseMidi( buf ), s = song();
	if(!m.tracks.length)
		throw new Error( "no notes in the MIDI file" );
	var tracks = m.tracks.slice( 0, 16 ), last = 0;
	tracks.forEach(function(t){
		t.notes = t.notes.filter(function(n){ return n[0] < 64 * 4; });
		t.notes.forEach(function(n){ last = Math.max( last, n[0] + n[1] ); });
	});
	rack.settings.song = WR.validateSong({ bpm: Math.round( m.bpm ), bars: Math.max( 1, Math.min( 64, Math.ceil( last / 4 - 1e-9 ) ) ),
		loop: s.loop, grid: s.grid, clock: s.clock, sel: 0, tracks: tracks });
	return rack.settings.song;
}

var midi_input = null;
function midiFileInput()
{
	if(midi_input && midi_input.ownerDocument === D())
		return midi_input;
	if(midi_input && midi_input.parentNode) midi_input.parentNode.removeChild( midi_input );
	midi_input = D().createElement( "input" );
	midi_input.type = "file"; midi_input.accept = ".mid,.midi,audio/midi"; midi_input.style.display = "none";
	midi_input.addEventListener("change", function(){
		var f = midi_input.files && midi_input.files[0];
		midi_input.value = "";
		if(!f) return;
		var notes = song().tracks.reduce(function(a, t){ return a + t.notes.length; }, 0);
		if(notes && !W().confirm( "Replace the song (" + notes + " notes) with " + f.name + "?" ))
			return;
		f.arrayBuffer().then(function(buf){
			var sg = loadMidiFile( buf );
			if(window.gfTrack) gfTrack( "midi-file", { tracks: sg.tracks.length } );
			if(window.setStatus) setStatus( f.name + ": " + sg.tracks.length + " tracks, " + sg.bars + " bars at " + Math.round( sg.bpm ) + " BPM" );
		}).catch(function(err){ W().alert( "Could not load " + f.name + ": " + err.message ); });
	});
	D().body.appendChild( midi_input );
	return midi_input;
}

// piano roll geometry
function roll( x0, y0, w, h )
{
	var L = loopBeats();
	return { x: x0 + KEYS_W, y: y0 + RULER_H, w: w - KEYS_W, h: h - RULER_H, bw: (w - KEYS_W) / L, L: L };
}
function noteY( r, n ) { return r.y + (view.top_note - n) * ROW_H; }
function beatX( r, b ) { return r.x + b * r.bw; }

// a CV track: its curve over the loop, the points to drag
function laneY( r, v ) { return r.y + 10 + (1 - v) * (r.h - 20); }
function drawLane( x0, y0, w, h )
{
	var s = song(), r = roll( x0, y0, w, h ), t = track(), gb = gridBeats(), color = COLORS[ s.sel % COLORS.length ];
	g.save();
	g.beginPath(); g.rect( x0, y0, w, h ); g.clip();
	rect( x0, r.y, w, r.h, "#181817" );
	for(var b = 0; b <= r.L + 1e-9; b += gb)
	{
		var bar = Math.abs( b % 4 ) < 1e-9, beat = Math.abs( b % 1 ) < 1e-9;
		rect( beatX( r, b ), r.y, 1, r.h, bar ? "#4a4945" : (beat ? "#2f2e2c" : "#222221") );
	}
	[0, 0.25, 0.5, 0.75, 1].forEach(function(v){
		rect( r.x, Math.round( laneY( r, v ) ), r.w, 1, v == 0.5 ? "#3a3936" : "#2a2a28" );
		text( Math.round( v * 100 ) + "%", x0 + KEYS_W - 4, laneY( r, v ), 9, "#8c8a84", "right" );
	});
	rect( r.x, y0, r.w, RULER_H, "#232322" );
	for(var bar = 0; bar < s.bars; ++bar)
		text( String( bar + 1 ), beatX( r, bar * 4 ) + 4, y0 + RULER_H * 0.5, 10, "#b8b5ad" );
	text( "CV  " + t.target.toUpperCase(), r.x + 8, r.y + 12, 11, "#d9c4ff", "left", true );
	var p = t.points;
	if(p.length)
	{
		g.beginPath();
		g.moveTo( r.x, laneY( r, p[0][1] ) );
		p.forEach(function(q){ g.lineTo( beatX( r, q[0] ), laneY( r, q[1] ) ); });
		g.lineTo( r.x + r.w, laneY( r, p[ p.length - 1 ][1] ) );
		g.strokeStyle = t.mute ? "#5d5b56" : color; g.lineWidth = 2; g.stroke();
		g.lineTo( r.x + r.w, r.y + r.h ); g.lineTo( r.x, r.y + r.h ); g.closePath();
		g.globalAlpha = 0.12; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
		if(p.length < 400) // the points, where they can be told apart
			p.forEach(function(q){
				g.fillStyle = q === view.cvpt ? "#fff" : color;
				g.beginPath(); g.arc( beatX( r, q[0] ), laneY( r, q[1] ), 3.5, 0, Math.PI * 2 ); g.fill();
			});
	}
	else
		text( "TURN THE KNOB WHILE PLAYING WITH REC ON, OR CLICK HERE TO ADD POINTS", r.x + r.w / 2, r.y + r.h / 2, 11, "#6d6b66", "center" );
	if(play.on || play.last_beat > 0)
		rect( beatX( r, position() ), y0, 2, h, play.on ? "#e8e4dc" : "#6d6b66" );
	g.restore();
	view.roll = r;
}

function cvPointAt( r, x, y )
{
	var p = track().points;
	for(var i = p.length - 1; i >= 0; --i)
		if(Math.abs( beatX( r, p[i][0] ) - x ) < 7 && Math.abs( laneY( r, p[i][1] ) - y ) < 7)
			return p[i];
	return null;
}

function drawRoll( x0, y0, w, h )
{
	if(isCv( track() ))
		return drawLane( x0, y0, w, h );
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
		if(view.sel.indexOf( n ) != -1)
		{
			g.strokeStyle = "#fff"; g.lineWidth = 1.5;
			g.strokeRect( x + 0.5, y + 1.5, nw - 1, ROW_H - 3 );
		}
	});
	// the selection rectangle
	var d = view.drag;
	if(d && d.mode == "rect")
	{
		g.fillStyle = "rgba(182,240,106,0.08)"; g.fillRect( Math.min( d.x0, d.x1 ), Math.min( d.y0, d.y1 ), Math.abs( d.x1 - d.x0 ), Math.abs( d.y1 - d.y0 ) );
		g.strokeStyle = "#b6f06a"; g.lineWidth = 1; g.setLineDash([ 4, 3 ]);
		g.strokeRect( Math.min( d.x0, d.x1 ) + 0.5, Math.min( d.y0, d.y1 ) + 0.5, Math.abs( d.x1 - d.x0 ), Math.abs( d.y1 - d.y0 ) );
		g.setLineDash([]);
	}
	// play head
	if(play.on || play.last_beat > 0)
	{
		var px = beatX( r, position() );
		rect( px, y0, 2, h, play.on ? "#e8e4dc" : "#6d6b66" );
	}
	g.restore();
	view.roll = r;
}

// the drawing loop, on the frames of the sequencer's window (a new token stops the old loop)
var loop_token = 0;
function loop( token )
{
	if(token !== loop_token) return;
	(pop ? pop.win.requestAnimationFrame.bind( pop.win ) : requestAnimationFrame)(function(){ loop( token ); });
	draw();
}

function draw()
{
	var w = cv.clientWidth, h = pop ? pop.win.innerHeight : (view.open ? view.h : BAR_H);
	if(parseInt( cv.style.height ) != h)
		cv.style.height = h + "px";
	var dpr = (pop ? pop.win.devicePixelRatio : window.devicePixelRatio) || 1;
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
		if(!view.hot_tip && view.roll && view.px > view.roll.x && view.py > view.roll.y && isCv( track() ))
			view.hot_tip = "CLICK: ADD A POINT · DRAG: MOVE IT · SHIFT+DRAG: DRAW · RIGHT-CLICK: DELETE";
		if(!view.hot_tip && view.roll && view.px > view.roll.x && view.py > view.roll.y)
			view.hot_tip = "CLICK: ADD A NOTE · DRAG: SELECT · DRAG NOTES: MOVE · DRAG THE END: LENGTH · RIGHT-CLICK: DELETE · WHEEL: SCROLL";
	}
	drawBar( w );
	if(view.open)
		drawMenu( h );
	// the cursor: resize grip on the top edge, a note's end, a note, dragging
	var cur = "default", r = view.roll, d = view.drag;
	if(view.resize || (view.open && view.py < 4 && !view.menu && !pop)) cur = "ns-resize";
	else if(d) cur = d.mode == "length" ? "ew-resize" : (d.mode == "move" ? "grabbing" : "crosshair");
	else if(view.open && r && !view.menu && view.px > r.x && view.py > r.y && isCv( track() ))
		cur = cvPointAt( r, view.px, view.py ) ? "move" : "crosshair";
	else if(view.open && r && !view.menu && view.px > r.x && view.py > r.y)
	{
		var hit = noteAt( r, view.px, view.py );
		cur = hit ? (hit.edge ? "ew-resize" : "grab") : "default";
	}
	cv.style.cursor = cur;
	applyCv();
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

// the CV lane: a point to drag, a new one, Shift: a stroke drawn; right-click deletes
function cvDown( e, r )
{
	var t = track(), hit = cvPointAt( r, view.px, view.py );
	var b = Math.max( 0, Math.min( r.L, (view.px - r.x) / r.bw ) ), v = Math.max( 0, Math.min( 1, 1 - (view.py - r.y - 10) / (r.h - 20) ) );
	if(e.button == 2)
	{
		if(hit) t.points.splice( t.points.indexOf( hit ), 1 );
		return;
	}
	cv.setPointerCapture( e.pointerId );
	if(e.shiftKey) { view.drag = { mode: "cvdraw", from: cvWrite( t, null, b, v ) }; return; }
	if(!hit) { hit = [ b, v ]; cvWrite( t, null, b, v ); hit = t.points.find(function(q){ return q[0] == b; }); }
	view.cvpt = hit;
	view.drag = { mode: "cvpt", pt: hit };
}

var last_click = 0;
cv.addEventListener("pointerdown", function(e){
	local( e );
	ensureAudio();
	var now = performance.now(), dbl = now - last_click < 350;
	last_click = now;
	if(view.rename)
		view.rename.finish( true );
	if(view.open && view.py < 4 && !view.menu && !pop)
	{
		view.resize = { y: e.clientY, h: view.h };
		cv.setPointerCapture( e.pointerId );
		return;
	}
	var menu = view.menu;
	for(var i = ui.buttons.length - 1; i >= 0; --i)
	{
		var b = ui.buttons[i];
		if(view.px >= b.x && view.px <= b.x + b.w && view.py >= b.y && view.py <= b.y + b.h)
		{
			if(e.button == 0)
				(dbl && b.dbl ? b.dbl : b.fn)();
			if(menu && view.menu === menu && !b.menu)
				view.menu = null; // another button: the menu closes
			return;
		}
	}
	if(menu) { view.menu = null; return; } // a click outside the menu only closes it
	var r = view.roll;
	if(!view.open || !r)
		return;
	if(isCv( track() ))
	{
		if(view.px >= r.x && view.py >= r.y) cvDown( e, r );
		return;
	}
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
	var t = track();
	if(e.button == 2) // right-click: the note (or the selection it is in) goes
	{
		if(hit)
		{
			var del = view.sel.indexOf( hit.note ) != -1 ? view.sel : [ hit.note ];
			t.notes = t.notes.filter(function(n){ return del.indexOf( n ) == -1; });
			view.sel = [];
			reschedule();
		}
		return;
	}
	cv.setPointerCapture( e.pointerId );
	var beat = (view.px - r.x) / r.bw, pitch = view.top_note - Math.floor( (view.py - r.y) / ROW_H );
	if(hit)
	{
		if(e.shiftKey) // Shift: add to / take out of the selection
		{
			var k = view.sel.indexOf( hit.note );
			if(k == -1) view.sel.push( hit.note ); else view.sel.splice( k, 1 );
			return;
		}
		if(view.sel.indexOf( hit.note ) == -1)
			view.sel = [ hit.note ];
		// the whole selection moves, or gets longer, with the note dragged
		view.drag = hit.edge ? { mode: "length", b0: beat, len: view.sel.map(function(n){ return n[1]; }) } :
			{ mode: "move", b0: beat, p0: pitch, pos: view.sel.map(function(n){ return [ n[0], n[2] ]; }) };
		return;
	}
	// empty space: a click adds a note, a drag selects the notes in its rectangle (Shift: adds them)
	view.drag = { mode: "pending", x0: view.px, y0: view.py, x1: view.px, y1: view.py, beat: beat, pitch: pitch,
		base: e.shiftKey ? view.sel.slice() : [] };
	if(!e.shiftKey)
		view.sel = [];
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
	var gb = gridBeats(), sel = view.sel, beat = (view.px - r.x) / r.bw;
	if(d.mode == "cvpt" || d.mode == "cvdraw")
	{
		var t = track(), cb = Math.max( 0, Math.min( r.L, beat ) ), v = Math.max( 0, Math.min( 1, 1 - (view.py - r.y - 10) / (r.h - 20) ) );
		if(d.mode == "cvpt")
		{
			d.pt[0] = cb; d.pt[1] = v;
			t.points.sort(function(a, b){ return a[0] - b[0]; });
		}
		else if(cb >= d.from) d.from = cvWrite( t, d.from, cb, v );
		else d.from = cvWrite( t, null, cb, v ); // drawn backwards: point by point
		return;
	}
	if(d.mode == "pending" && Math.abs( view.px - d.x0 ) + Math.abs( view.py - d.y0 ) > 4)
		d.mode = "rect";
	if(d.mode == "rect")
	{
		d.x1 = view.px; d.y1 = view.py;
		var b0 = (Math.min( d.x0, d.x1 ) - r.x) / r.bw, b1 = (Math.max( d.x0, d.x1 ) - r.x) / r.bw;
		var p1 = view.top_note - (Math.min( d.y0, d.y1 ) - r.y) / ROW_H + 1, p0 = view.top_note - (Math.max( d.y0, d.y1 ) - r.y) / ROW_H + 1;
		view.sel = d.base.concat( track().notes.filter(function(n){
			return d.base.indexOf( n ) == -1 && n[0] < b1 && n[0] + n[1] > b0 && n[2] + 1 > p0 && n[2] < p1;
		}) );
	}
	else if(d.mode == "length")
	{
		var db = Math.round( (beat - d.b0) / gb ) * gb;
		sel.forEach(function(n, k){ n[1] = Math.max( gb, d.len[k] + db ); });
	}
	else if(d.mode == "move")
	{
		var dt = Math.round( (beat - d.b0) / gb ) * gb, dp = view.top_note - Math.floor( (view.py - r.y) / ROW_H ) - d.p0;
		// all of them kept inside the loop and the MIDI notes
		d.pos.forEach(function(p){ dt = Math.min( Math.max( dt, -p[0] ), r.L - gb - p[0] ); dp = Math.min( Math.max( dp, -p[1] ), 127 - p[1] ); });
		sel.forEach(function(n, k){ n[0] = d.pos[k][0] + dt; n[2] = d.pos[k][1] + dp; });
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
	var d = view.drag;
	if(d && d.mode == "pending" && view.roll) // a click on empty space: a new note, as long as the grid
	{
		var gb = gridBeats(), t = track(), nn = [ Math.floor( d.beat / gb ) * gb, gb, Math.max( 0, Math.min( 127, d.pitch ) ), 0.8 ];
		t.notes.push( nn );
		view.sel = [ nn ];
		var ch = t.channel, note = nn[2];
		act(function(){ rack.post({ type: "note", channel: ch, note: note, on: true, vel: 0.8 }); });
		setTimeout(function(){ rack.post({ type: "note", channel: ch, note: note, on: false }); }, 200);
	}
	if(d)
	{
		view.drag = null;
		if(d.mode != "rect") reschedule();
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

// Delete / Backspace removes the selected notes; Ctrl+A selects all of them; Escape: none
window.addEventListener("keydown", function(e){
	if(!view.open || isTextField( e.target ))
		return;
	if((e.code == "Delete" || e.code == "Backspace") && view.sel.length)
	{
		var t = track(), sel = view.sel;
		t.notes = t.notes.filter(function(n){ return sel.indexOf( n ) == -1; });
		view.sel = [];
		reschedule();
		e.preventDefault();
	}
	else if(e.code == "KeyA" && (e.ctrlKey || e.metaKey) && view.roll && view.px > view.roll.x && view.py > view.roll.y)
	{
		view.sel = track().notes.slice();
		e.preventDefault();
	}
	else if(e.code == "Escape" && (view.sel.length || view.menu))
	{
		view.sel = []; view.menu = null;
	}
});

// ---------------------------------------------------------------------------
// DETACH: the canvas moves into a window of its own (same page: the code, its handlers and the audio
// stay here). Its keys are passed on to this window (QWERTY notes, Delete...). The scheduler runs on
// that window's timers, so this one can be hidden. Closing it puts the sequencer back

function detach()
{
	if(pop) return;
	var w = window.open( "", "synths_sequencer", "popup,width=" + Math.max( 900, Math.round( cv.clientWidth * 0.85 ) ) + ",height=" + Math.max( 360, view.h ) );
	if(!w) { if(window.setStatus) setStatus( "The browser blocked the window: allow pop-ups for this page" ); return; }
	if(window.gfTrack) gfTrack( "detach-sequencer" );
	var links = Array.prototype.map.call( document.querySelectorAll( "link[rel=stylesheet], link[rel=preconnect]" ), function(l){ return l.outerHTML; } ).join( "" );
	var d = w.document;
	d.open();
	d.write( '<!doctype html><html><head><meta charset="utf-8"><title>GASFREE \u00b7 SEQUENCER</title>' + links +
		'<style>html, body { margin: 0; height: 100%; background: #111110; overflow: hidden; } canvas { display: block; width: 100%; }</style></head><body></body></html>' );
	d.close();
	pop = { win: w, parent: cv.parentNode, next: cv.nextSibling, open: view.open };
	view.open = true;
	d.body.appendChild( d.adoptNode ? d.adoptNode( cv ) : cv );
	["keydown", "keyup"].forEach(function(type){
		w.addEventListener( type, function(e){
			if(isTextField( e.target )) return; // renaming a track
			if(e.code == "Backspace" || e.code == "Space" || (e.code == "KeyA" && (e.ctrlKey || e.metaKey))) e.preventDefault();
			window.dispatchEvent( new KeyboardEvent( type, { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat } ) );
		});
	});
	w.addEventListener( "pagehide", attach ); // closed (or reloaded): back home
	clearInterval( sched_timer );
	sched_timer = w.setInterval( scheduler, TICK );
	loop( ++loop_token );
	window.dispatchEvent( new Event( "resize" ) ); // the rack takes the room
	w.focus();
}

function attach()
{
	if(!pop) return;
	var p = pop;
	pop = null;
	if(view.rename) view.rename.finish( true );
	view.open = p.open;
	view.menu = null;
	p.parent.insertBefore( document.adoptNode ? document.adoptNode( cv ) : cv, p.next && p.next.parentNode === p.parent ? p.next : null );
	if(!p.win.closed) { try { p.win.clearInterval( sched_timer ); } catch(err) {} }
	sched_timer = setInterval( scheduler, TICK );
	loop( ++loop_token );
	if(!p.win.closed) p.win.close();
	window.dispatchEvent( new Event( "resize" ) );
}
window.addEventListener( "pagehide", function(){ if(pop && !pop.win.closed) pop.win.close(); } );

// a patch loaded while playing: start over with its song
var last_song = null;
setInterval(function(){
	if(song() !== last_song)
	{
		if(last_song && play.on) { stop(); }
		last_song = song();
		view.sel = []; view.menu = null;
		fitView();
	}
}, 100);

loop( loop_token );

// for the tests
window.SEQ = { view: view, play: play, detach: detach, attach: attach, detached: function(){ return !!pop; }, applyCv: applyCv, cvValue: cvValue, exportWav: exportWav, wavTick: wavTick, wav: function(){ return wav; }, parseMidi: parseMidi, loadMidiFile: loadMidiFile, start: start, stop: stop, scheduleRange: scheduleRange, position: position, roll: function(){ return view.roll; } };

})();
