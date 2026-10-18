// analytics.js: anonymous, cookie-free usage statistics with Umami (https://umami.is).
// Shared by the app and the home page. Set UMAMI_SRC and UMAMI_ID to turn it on; while either is
// empty nothing is loaded and nothing is sent. Browsers asking not to be tracked (Do Not Track) aren't.
// gfTrack( name, data, once ) records an event; once: only the first time in this page load.
(function(){

var UMAMI_SRC = "";      // the tracker script, e.g. "https://umami.example.com/script.js" (Umami Cloud: "https://cloud.umami.is/script.js")
var UMAMI_ID = "";       // the website id, from the Umami dashboard (Settings > Websites)
var UMAMI_DOMAINS = "";  // optional: only these hosts are tracked, e.g. "gasfree.app" (comma separated); empty: every host

var queue = [], sent = {};

window.gfTrack = function( name, data, once )
{
	if(!UMAMI_SRC || !UMAMI_ID) return;
	if(once) { if(sent[ name ]) return; sent[ name ] = true; }
	if(window.umami && window.umami.track) window.umami.track( name, data );
	else if(queue.length < 50) queue.push([ name, data ]); // before the tracker has loaded
};

if(!UMAMI_SRC || !UMAMI_ID)
	return;
var s = document.createElement( "script" );
s.defer = true;
s.src = UMAMI_SRC;
s.setAttribute( "data-website-id", UMAMI_ID );
s.setAttribute( "data-do-not-track", "true" );
if(UMAMI_DOMAINS) s.setAttribute( "data-domains", UMAMI_DOMAINS );
s.onload = function(){
	queue.forEach(function(e){ if(window.umami) window.umami.track( e[0], e[1] ); });
	queue = [];
};
(document.head || document.documentElement).appendChild( s );

})();
