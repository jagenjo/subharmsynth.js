// devices/reroute.js
// REROUTE module: a thin row of 8 channels to tidy up long cables. Each channel has a front socket
// that goes to the back (TO BACK, an input) and one that comes from the back (FROM BACK, an output):
// patch a signal into one REROUTE's front, cable its back to another REROUTE's back, and take it
// out of that one's front, anywhere in the rack. DSP in reroute-worklet.js.

(function(){

var N = 8, H = 58;
var JACKS = [[]], REAR = [];
for(var i = 0; i < N; ++i)
{
	JACKS[0].push([ (i + 1) + " TO BACK", "in", "f_in" + i ], [ (i + 1) + " FROM BACK", "out", "f_out" + i ]);
	REAR.push([ (i + 1) + " OUT", "aout", "r_out" + i ], [ (i + 1) + " IN", "ain", "r_in" + i ]);
}

// a small socket, registered for the cables (out: a light ring)
function socket( id, cx, cy, type, label )
{
	var full = id_prefix + id;
	jacks[full] = { x: rackX( cx ), y: rackY( cy ), type: type, label: label };
	var hover = hitCircle( cx, cy, 12 );
	if(cable_drag && cable_drag.from != full && jackCompatible( cable_drag, jacks[full] ))
	{
		ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
		ctx.beginPath(); ctx.arc( cx, cy, 13, 0, Math.PI * 2 ); ctx.stroke();
	}
	var g = ctx.createLinearGradient( cx - 10, cy - 10, cx + 10, cy + 10 );
	g.addColorStop( 0, hover && !cable_drag ? "#e8e8e8" : "#c8c8c8" ); g.addColorStop( 1, "#5a5a5a" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, 10, 0, Math.PI * 2 ); ctx.fill();
	if(type == "out") { ctx.strokeStyle = "#f2eee6"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc( cx, cy, 12, 0, Math.PI * 2 ); ctx.stroke(); }
	ctx.fillStyle = "#151515"; ctx.beginPath(); ctx.arc( cx, cy, 6.5, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc( cx, cy, 4, 0, Math.PI * 2 ); ctx.fill();
	if(hover && !cable_drag) tip( label + (type == "in" ? ": GOES OUT ON THE BACK" : ": COMES FROM THE BACK"), cx, cy + 22 );
}

function draw( M )
{
	var size = M.def.size( layout ), w = size[0], h = size[1];
	drawCasing( 0, 0, w, h );
	var x0 = 90, step = (w - 180) / N;
	ctx.font = "bold 10px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
	for(var i = 0; i < N; ++i)
	{
		var cx = x0 + step * (i + 0.5);
		// the pair: a frame, its number between, arrows: in (to the back) and out (from the back)
		ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.roundRect( cx - 44, 6, 88, 30, 6 ); ctx.stroke();
		socket( "f_in" + i, cx - 24, 21, "in", (i + 1) + " TO BACK" );
		socket( "f_out" + i, cx + 24, 21, "out", (i + 1) + " FROM BACK" );
		ctx.fillStyle = TEXT_COLOR; ctx.fillText( String( i + 1 ), cx, 15 );
		ctx.fillStyle = DIM_COLOR; ctx.fillText( "⇄", cx, 27 );
	}
	ctx.font = "bold 11px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "3px";
	ctx.fillText( "REROUTE", w / 2, h - 11 );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
}

WR.registerSynth( "reroute", {
	title: "REROUTE",
	description: "REROUTE: 8 channels from the front to the back and back again, to tidy up long cables",
	about: "A thin row of 8 channel pairs: a front socket goes out on the back, a back socket comes out on the front. Cable one REROUTE's back to another's back to carry a signal across the rack without a long cable.",
	key_prio: [],
	category: "Utility",
	worklet: "devices/reroute-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR,
	midi_in: null,
	defaults: function(){ return {}; },
	size: function( layout ) { return [ LAYOUTS[ layout ].w, H ]; },
	draw: draw,
	rear_note: function(){ return "1-8 OUT: THE FRONT'S TO BACK · 1-8 IN: THE FRONT'S FROM BACK"; }
});

})();
