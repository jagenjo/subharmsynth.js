// devices/mixer.js
// 6 channel mixer module, in the same panel style as the synths: per channel AUX send, PAN,
// MUTE / SOLO, a fader and a level meter; MASTER with the AUX SEND / AUX RETURN levels and the
// main meters. Audio comes in and out on the back (Tab); the front has LEVEL CV inputs per
// channel and the MIX output (mono, +-5V) for the CV patch bay. DSP in mixer-worklet.js.

(function(){

var SIZE = [1568, 460];
var CHANNELS = 6;

// front patch bay: level CV per channel (a VCA: 5V = the fader's level) and the mix as a signal
var JACKS = [
	[["CV 1","in","cv1"], ["CV 2","in","cv2"], ["CV 3","in","cv3"]],
	[["CV 4","in","cv4"], ["CV 5","in","cv5"], ["CV 6","in","cv6"]],
	[["MIX","out","mix"]]
];
// back: line level audio
var REAR_JACKS = [];
for(var k = 1; k <= CHANNELS; ++k)
	REAR_JACKS.push([ "IN " + k, "ain", "in" + k ]);
REAR_JACKS.push( ["AUX SEND", "aout", "aux_send"], ["AUX RET L", "ain", "aux_ret_l"], ["AUX RET R", "ain", "aux_ret_r"],
	["MAIN L", "aout", "main_l"], ["MAIN R", "aout", "main_r"] );

var M = null; // the module being drawn

function clampTo( v, a, b ) { return v < a ? a : (v > b ? b : v); } // validate() runs without code.js too

function defaults()
{
	var ch = [];
	for(var i = 0; i < CHANNELS; ++i)
		ch.push({ level: 0.75, pan: 0, aux: 0, mute: false, solo: false }); // fader 0.75 = 0 dB
	return { ch: ch, master: 0.75, aux_send: 0.75, aux_return: 0.75 };
}

function validate( s )
{
	s.ch.forEach(function(c){
		c.level = clampTo( c.level, 0, 1 );
		c.pan = clampTo( c.pan, -1, 1 );
		c.aux = clampTo( c.aux, 0, 1 );
	});
	["master", "aux_send", "aux_return"].forEach(function(k){ s[k] = clampTo( s[k], 0, 1 ); });
}

function initialState()
{
	return { level: [0,0,0,0,0,0], main: [0,0] };
}

// fader 0..1 -> gain (as in the DSP): 0.75 is 0 dB, the top +7.5 dB
function faderDb( pos ) { return pos > 0 ? 60 * Math.log10( pos / 0.75 ) : -Infinity; }
function knobDb( v ) { return v > 0 ? 40 * Math.log10( v / 0.75 ) : -Infinity; }
function fmtDbVal( db ) { return db == -Infinity ? "-inf dB" : (db > 0 ? "+" : "") + db.toFixed(1) + " dB"; }
var FADER_SCALE = [[1, "+7.5"], [0.75 * Math.pow( 10, 3 / 60 ), "+3"], [0.75, "0"], [0.75 * Math.pow( 10, -6 / 60 ), "-6"],
	[0.75 * Math.pow( 10, -12 / 60 ), "-12"], [0.75 * Math.pow( 10, -24 / 60 ), "-24"], [0.75 * Math.pow( 10, -48 / 60 ), "-48"], [0, "-∞"]];

// smoothed meter levels per module, falling slowly
var meters = {};

function meterLevels( st )
{
	var m = meters[ M.id ] || (meters[ M.id ] = { level: [0,0,0,0,0,0], main: [0,0] });
	for(var i = 0; i < CHANNELS; ++i)
		m.level[i] = Math.max( st.level[i] || 0, m.level[i] * 0.9 );
	for(var c = 0; c < 2; ++c)
		m.main[c] = Math.max( st.main[c] || 0, m.main[c] * 0.9 );
	return m;
}

// vertical LED meter, -48..+6 dB
function drawMeter( x, y, h, level )
{
	var db = level > 0 ? 20 * Math.log10( level ) : -100;
	var n = clamp( (db + 48) / 54, 0, 1 );
	var segs = 18, sh = h / segs;
	ctx.fillStyle = "#050505";
	ctx.fillRect( x - 1, y - 1, 8, h + 2 );
	for(var i = 0; i < segs; ++i)
	{
		var t = (i + 0.5) / segs, sdb = -48 + t * 54;
		var lit = t <= n;
		ctx.fillStyle = sdb > 0 ? (lit ? "#ff3b2f" : "#3a1512") : (sdb > -12 ? (lit ? "#ffb02f" : "#3a2a10") : (lit ? "#3bd16f" : "#10301a"));
		ctx.fillRect( x, y + h - (i + 1) * sh + 1, 6, sh - 2 );
	}
}

// what is patched into a channel (on the back), for its label
function sourceName( k )
{
	var dst = WR.jackId( M.id, "in" + (k + 1) );
	var src = rack.settings.patches.filter(function(p){ return p[1] == dst; });
	if(!src.length)
		return "—";
	if(src.length > 1)
		return src.length + " SOURCES";
	return jackDevice( src[0][0] );
}

var STRIP_X0 = 110, STRIP_DX = 150, FADER_Y = 252, FADER_H = 150;
var MASTER_X = 1010;
var JACK_COLS = [1350, 1420, 1490];

function drawBackground()
{
	var w = SIZE[0], h = SIZE[1];
	drawCasing( 0, 0, w, h );
	drawScrew( 36, 12 ); drawScrew( w - 36, 12 );
	drawScrew( 36, h - 12 ); drawScrew( w - 36, h - 12 );

	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = "bold 30px " + FONT;
	ctx.fillStyle = TEXT_COLOR;
	ctx.fillText( "MIXER", 46, h - 18 );
	var tw = ctx.measureText( "MIXER" ).width;
	ctx.fillRect( 54 + tw, h - 44, 1.5, 28 );
	ctx.font = "11px " + FONT;
	ctx.fillText( "6 CHANNEL LINE MIXER", 62 + tw, h - 32 );
	ctx.fillText( "AUX SEND / RETURN", 62 + tw, h - 19 );
}

function drawStrips( levels )
{
	var s = M.settings;
	for(var i = 0; i < CHANNELS; ++i)
	{
		var c = s.ch[i];
		var cx = STRIP_X0 + i * STRIP_DX;
		// strip separators
		if(i)
		{
			ctx.strokeStyle = "#3a3936";
			ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo( cx - STRIP_DX * 0.5, 30 ); ctx.lineTo( cx - STRIP_DX * 0.5, 410 ); ctx.stroke();
		}
		drawLabel( "CH " + (i + 1), cx, 22, 13 );
		var name = sourceName( i );
		ctx.fillStyle = "#050505";
		ctx.beginPath(); ctx.roundRect( cx - 58, 34, 116, 18, 3 ); ctx.fill();
		drawLabel( name.length > 18 ? name.substr( 0, 17 ) + "…" : name, cx, 43, 10, false, name == "—" ? DIM_COLOR : "#b6f06a" );

		c.aux = knob( "aux" + i, cx, 104, 20, c.aux, 0, 1, {
			label: "AUX", def: 0, format: function(v){ return "AUX " + fmtDbVal( knobDb( v ) ) + " (POST FADER)"; }
		});
		c.pan = knob( "pan" + i, cx, 172, 20, c.pan, -1, 1, {
			label: "PAN", bipolar: true, def: 0, format: function(v){ return Math.abs( v ) < 0.005 ? "CENTRE" : (v < 0 ? "L " : "R ") + Math.round( Math.abs( v ) * 100 ); }
		});
		if(button( "mute" + i, cx - 52, 206, 48, 22, "MUTE", c.mute ).clicked)
			c.mute = !c.mute;
		if(button( "solo" + i, cx + 4, 206, 48, 22, "SOLO", c.solo ).clicked)
			c.solo = !c.solo;
		c.level = fader( "level" + i, cx, FADER_Y, FADER_H, c.level, {
			def: 0.75, scale: i == 0 ? FADER_SCALE : FADER_SCALE.map(function(m){ return [ m[0], "" ]; }),
			format: function(v){ return fmtDbVal( faderDb( v ) ); }
		});
		drawMeter( cx + 28, FADER_Y, FADER_H, levels.level[i] );
	}
}

function drawMaster( levels )
{
	var s = M.settings;
	drawSection( "MASTER", MASTER_X - 60, MASTER_X + 190, 22 );
	s.aux_send = knob( "aux_send", MASTER_X, 104, 22, s.aux_send, 0, 1, {
		label: "AUX SEND", def: 0.75, format: function(v){ return fmtDbVal( knobDb( v ) ); }
	});
	s.aux_return = knob( "aux_return", MASTER_X + 110, 104, 22, s.aux_return, 0, 1, {
		label: "AUX RETURN", def: 0.75, format: function(v){ return fmtDbVal( knobDb( v ) ); }
	});
	var solo = s.ch.some(function(c){ return c.solo; });
	drawLed( MASTER_X + 40, 214, 4, solo, "#ffb02f" );
	drawLabel( "SOLO", MASTER_X + 64, 214, 10, false, solo ? TEXT_COLOR : DIM_COLOR );
	s.master = fader( "master", MASTER_X + 40, FADER_Y, FADER_H, s.master, {
		def: 0.75, scale: FADER_SCALE, format: function(v){ return "MAIN " + fmtDbVal( faderDb( v ) ); }
	});
	drawMeter( MASTER_X + 72, FADER_Y, FADER_H, levels.main[0] );
	drawMeter( MASTER_X + 84, FADER_Y, FADER_H, levels.main[1] );
	drawLabel( "L", MASTER_X + 75, FADER_Y + FADER_H + 12, 9 );
	drawLabel( "R", MASTER_X + 87, FADER_Y + FADER_H + 12, 9 );
}

function drawPatchBay()
{
	var x = JACK_COLS[0] - 38, h = SIZE[1];
	ctx.fillStyle = "#1f1f1e";
	ctx.beginPath(); ctx.roundRect( x, 14, JACK_COLS[2] - x + 38, h - 28, 6 ); ctx.fill();
	drawLabel( "LEVEL CV", JACK_COLS[1], 31, 12 );
	JACKS.forEach(function(row, r){
		row.forEach(function(j, c){
			drawJack( j[2], JACK_COLS[c], 92 + r * 76, j[0], j[1] );
		});
	});
	ctx.font = "10px " + FONT;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = DIM_COLOR;
	ctx.fillText( "AUDIO IN / OUT ON THE BACK (TAB)", JACK_COLS[1], h - 34 );
}

WR.registerSynth( "mixer", {
	title: "MIXER",
	description: "6 channel mixer with aux send and return",
	about: "Six mono channels with level, pan, mute / solo and an aux send / return, into the main stereo out.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^(mute|solo)\\d$", 2]],
	// a knob's sockets, lit when the mouse is over it (code.js: controlJacks)
	knob_jacks: [["^level(\\d)$", function(m){ return ["cv" + (+m[1] + 1)]; }]],
	worklet: "devices/mixer-worklet.js",
	jacks: JACKS,
	rear_jacks: REAR_JACKS,
	category: "Mixing",
	midi_in: null,
	audio_out: null,
	mixer: true,
	channels: CHANNELS,
	defaults: defaults,
	validate: validate,
	size: function() { return SIZE; },
	draw: function( mod ) {
		M = mod;
		var levels = meterLevels( M.state || initialState() );
		drawBackground();
		drawStrips( levels );
		drawMaster( levels );
		drawPatchBay();
		M = null;
	}
});

})();
