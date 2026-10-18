// sessions.js
// Sessions: the whole rack (devices, settings, cables, song) saved automatically in this browser,
// a few seconds after every change and when the page is left. Every visit is a new session (or,
// with "Reopen the last session at start", continues the last one). The Sessions panel lists them,
// newest first, to load, rename or delete. Patches (Save as...) are separate and unchanged.
//   localStorage: SUBHARM_sessions = [{ id, name, created, updated, summary }], newest first
//                 SUBHARM_session_<id> = the rack settings (JSON)
//                 SUBHARM_session_opts = { reopen }

(function(){

if(window.PREVIEW_MODE) // a device's picture is being taken: no sessions
	return;

var INDEX_KEY = "SUBHARM_sessions", DATA_KEY = "SUBHARM_session_", OPTS_KEY = "SUBHARM_session_opts";
var MAX_SESSIONS = 30;
var AUTOSAVE_MS = 3000;

var current = null;     // id of the session being saved into
var last_saved = null;  // JSON of the settings last saved
var opts = { reopen: true };
try { var o = JSON.parse( localStorage.getItem( OPTS_KEY ) || "{}" ) || {}; if(o.reopen === false) opts.reopen = false; } catch(err) {}

function list()
{
	try { return JSON.parse( localStorage.getItem( INDEX_KEY ) || "[]" ) || []; } catch(err) { return []; }
}

function writeList( l )
{
	localStorage.setItem( INDEX_KEY, JSON.stringify( l ) );
}

// what a session holds, in a few words: its devices and its song
function summary( s )
{
	var counts = {}, order = [];
	(s.modules || []).forEach(function(m){
		var t = WR.types[ m.type ] ? WR.types[ m.type ].title : m.type;
		if(!counts[t]) { counts[t] = 0; order.push( t ); }
		counts[t]++;
	});
	var devices = order.map(function(t){ return (counts[t] > 1 ? counts[t] + "× " : "") + t; }).join(", ") || "EMPTY RACK";
	var notes = s.song ? s.song.tracks.reduce(function(n, t){ return n + t.notes.length; }, 0) : 0;
	var tracks = s.song ? s.song.tracks.length : 0;
	return devices + (notes ? "  ·  " + tracks + " track" + (tracks > 1 ? "s" : "") + ", " + notes + " notes" : "");
}

function newId() { return "s" + Date.now().toString(36) + Math.random().toString(36).substr( 2, 4 ); }

function defaultName( t ) {
	var d = new Date( t );
	var pad = function(n){ return (n < 10 ? "0" : "") + n; };
	return "Session " + d.getFullYear() + "-" + pad( d.getMonth() + 1 ) + "-" + pad( d.getDate() ) + " " + pad( d.getHours() ) + ":" + pad( d.getMinutes() );
}

// saves the rack into the current session when it changed; old sessions go when storage runs short
function save( force )
{
	var json = JSON.stringify( rack.settings );
	if(!force && json === last_saved)
		return true;
	var now = Date.now();
	var l = list();
	if(!current)
		current = newId();
	var entry = l.find(function(e){ return e.id == current; });
	if(!entry)
	{
		entry = { id: current, name: defaultName( now ), created: now };
		l.unshift( entry );
	}
	entry.updated = now;
	entry.summary = summary( rack.settings );
	// the current one first, then the others by date
	l = [entry].concat( l.filter(function(e){ return e !== entry; }).sort(function(a, b){ return b.updated - a.updated; }) );
	while(l.length > MAX_SESSIONS)
		dropData( l.pop().id );
	for(;;)
	{
		try {
			localStorage.setItem( DATA_KEY + current, json );
			writeList( l );
			last_saved = json;
			return true;
		} catch(err) {
			// storage full: the oldest session goes, unless there is nothing else to drop
			if(l.length <= 1)
			{
				setStatus( "Could not save the session: browser storage is full" );
				return false;
			}
			dropData( l.pop().id );
		}
	}
}

function dropData( id )
{
	try { localStorage.removeItem( DATA_KEY + id ); } catch(err) {}
}

function load( id )
{
	var json = null;
	try { json = localStorage.getItem( DATA_KEY + id ); } catch(err) {}
	if(!json)
	{
		setStatus( "That session is no longer stored" );
		remove( id, true );
		return false;
	}
	save(); // keep what is on screen first
	rack.setSettings( JSON.parse( json ) );
	current = id;
	last_saved = JSON.stringify( rack.settings );
	if(window.afterPatchLoad)
		afterPatchLoad( (list().find(function(e){ return e.id == id; }) || {}).name || "session" );
	refreshPatchList();
	return true;
}

function remove( id, silent )
{
	var l = list().filter(function(e){ return e.id != id; });
	dropData( id );
	try { writeList( l ); } catch(err) {}
	if(id == current) // what is on screen goes on in a new session
	{
		current = null;
		last_saved = null;
	}
}

function rename( id, name )
{
	var l = list();
	var e = l.find(function(e){ return e.id == id; });
	if(!e || !name.trim())
		return;
	e.name = name.trim().substr( 0, 60 );
	try { writeList( l ); } catch(err) {}
}

// a fresh rack in a new session (the one on screen stays saved)
function newSession()
{
	save();
	rack.setSettings( WRContext.defaultSettings() );
	current = newId();
	last_saved = null;
	save( true );
	refreshPatchList();
	setStatus( "New session" );
}

function setReopen( on )
{
	opts.reopen = on;
	try { localStorage.setItem( OPTS_KEY, JSON.stringify( opts ) ); } catch(err) {}
}

// ---------------------------------------------------------------------------
// the panel

var panel = document.getElementById("sessions-panel");

function ago( t )
{
	var s = Math.round( (Date.now() - t) / 1000 );
	if(s < 60) return "just now";
	if(s < 3600) return Math.round( s / 60 ) + " min ago";
	if(s < 86400) return Math.round( s / 3600 ) + " h ago";
	var d = Math.round( s / 86400 );
	return d + " day" + (d > 1 ? "s" : "") + " ago";
}

function esc( t ) { return String( t ).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

function render()
{
	var l = list();
	var html = '<div class="row head"><span>Sessions are saved in this browser as you play.</span>' +
		'<button data-act="new" title="Start a new session with a fresh rack (this one stays saved)">New session</button></div>' +
		'<label class="reopen"><input type="checkbox" data-act="reopen"' + (opts.reopen ? " checked" : "") + ' /> Reopen the last session at start</label>' +
		'<div class="list">';
	if(!l.length)
		html += '<div class="empty">No sessions yet.</div>';
	l.forEach(function(e){
		var cur = e.id == current;
		html += '<div class="item' + (cur ? " current" : "") + '">' +
			'<div class="info"><div class="name">' + esc( e.name ) + (cur ? ' <span class="tag">NOW</span>' : "") + '</div>' +
			'<div class="meta">' + esc( ago( e.updated ) ) + ' · ' + esc( new Date( e.updated ).toLocaleString() ) + '</div>' +
			'<div class="sum">' + esc( e.summary || "" ) + '</div></div>' +
			'<div class="acts">' + (cur ? "" : '<button data-act="load" data-id="' + e.id + '">Load</button>') +
			'<button data-act="rename" data-id="' + e.id + '" title="Rename">✎</button>' +
			'<button data-act="delete" data-id="' + e.id + '" title="Delete">×</button></div></div>';
	});
	panel.innerHTML = html + '</div>';
}

panel.addEventListener("click", function(e){
	e.stopPropagation();
	var b = e.target.closest ? e.target.closest("[data-act]") : null;
	if(!b)
		return;
	var id = b.getAttribute("data-id"), act_ = b.getAttribute("data-act");
	if(act_ == "load")
	{
		if(load( id ))
			panel.hidden = true;
	}
	else if(act_ == "rename")
	{
		var e_ = list().find(function(x){ return x.id == id; });
		var name = window.prompt( "Session name:", e_ ? e_.name : "" );
		if(name !== null)
			rename( id, name );
		render();
	}
	else if(act_ == "delete")
	{
		var e2 = list().find(function(x){ return x.id == id; });
		if(window.confirm( "Delete the session \"" + (e2 ? e2.name : "") + "\"?" ))
			remove( id );
		render();
	}
	else if(act_ == "new")
	{
		newSession();
		panel.hidden = true;
	}
	else if(act_ == "reopen")
		setReopen( b.checked );
});

document.getElementById("sessions").addEventListener("click", function(e){
	e.stopPropagation();
	if(panel.hidden)
	{
		save(); // the list shows this session up to date
		render();
	}
	panel.hidden = !panel.hidden;
	document.getElementById("options-panel").hidden = true;
	var ap = document.getElementById("add-panel");
	if(ap && !ap.hidden) { ap.hidden = true; document.getElementById("add-device").classList.remove("on"); }
});
document.addEventListener("click", function(){ panel.hidden = true; });
canvas.addEventListener("pointerdown", function(){ panel.hidden = true; });

// ---------------------------------------------------------------------------
// start: reopen the last session, or start a new one

(function(){
	var l = list();
	if(opts.reopen && l.length)
	{
		var json = null;
		try { json = localStorage.getItem( DATA_KEY + l[0].id ); } catch(err) {}
		if(json)
		{
			try {
				rack.setSettings( JSON.parse( json ) );
				current = l[0].id;
				last_saved = JSON.stringify( rack.settings );
				if(window.syncScaleInput) syncScaleInput();
				setStatus( "Reopened " + l[0].name + " (Sessions lists the others)" );
				return;
			} catch(err) { console.warn( "session not reopened", err ); }
		}
	}
	current = newId();
	if(l.length)
		setStatus( l.length + " saved session" + (l.length > 1 ? "s" : "") + " in Sessions" );
})();

setInterval(function(){ save(); }, AUTOSAVE_MS);
window.addEventListener("pagehide", function(){ save(); });
window.addEventListener("beforeunload", function(){ save(); });

window.SESSIONS = { save: save, list: list, load: load, remove: remove, rename: rename, newSession: newSession,
	current: function(){ return current; }, render: render, setReopen: setReopen };

})();
