// devices/cosmos.js
// COSMOS module, a multi-algorithm stereo reverb (half rack width), laid out as a pedal: MIX with the PEAK / SIGNAL LEDs, DECAY, SIZE, DELAY, LOW, HIGH;
// the PRESET encoder (click: ALGORITHM mode) with TEMPO, XNOB, YNOB, FXMIX, CONTOUR and the EDITED
// LED; the 12 character display; the ACTIVE, HOTSWITCH (here: FREEZE) and TAP footswitches.
// 12 algorithms, each knob's meaning per algorithm as in the guide; presets from the factory list.
// Stereo audio on the back. DSP in cosmos-worklet.js.

(function(){

var NAMES = ["HALL", "ROOM", "PLATE", "SPRING", "DUALVERB", "REVERSE", "MODECHOVERB", "VOID", "WARPVERB", "TREMOLOVERB", "DYNAVERB", "SHIMMER"];
// the knobs: MIX, DECAY, SIZE, DELAY, LOW, HIGH, XNOB, YNOB, FXMIX, CONTOUR
var KNOBS = ["MIX", "DECAY", "SIZE", "DELAY", "LOW", "HIGH", "XNOB", "YNOB", "FXMIX", "CONTOUR"];
var NOTES = [["1/64", 1 / 16], ["1/32", 1 / 8], ["1/16T", 1 / 6], ["1/16", 1 / 4], ["1/8T", 1 / 3], ["1/16D", 3 / 8], ["1/8", 1 / 2], ["1/4T", 2 / 3], ["1/8D", 3 / 4], ["1/4", 1], ["1/2T", 4 / 3], ["1/4D", 3 / 2], ["1/2", 2], ["1/2D", 3], ["WHOLE", 4]];
var SHAPES = ["SINE", "TRIANGL", "PEAK", "RANDOM", "RAMP", "SQUARE", "SMP/HLD", "ENVELOP", "ADSR"];
var INF_AT = 0.965, FREEZE_AT = 0.985;
var M = null, S = null;

// ---- the parameters: display names and values (the worklet has the same conversions) ----
var r0 = function(v){ return String( Math.round( v ) ); };
var T = {
	pct: [function(v){ return r0( v * 100 ); }, function(x){ return x / 100; }],
	bip: [function(v){ return r0( (v - 0.5) * 200 ); }, function(x){ return x / 200 + 0.5; }],
	sec: [function(v){ var s = 0.1 * Math.pow( 500, v ); return s.toFixed( s < 10 ? 2 : 1 ) + "S"; }, function(x){ return Math.log( x / 0.1 ) / Math.log( 500 ); }],
	secif: [function(v){ return v >= FREEZE_AT ? "FREEZE" : (v >= INF_AT ? "INF" : T.sec[0]( v )); }, function(x){ return T.sec[1]( x ); }],
	ms: [function(v){ return tempoMode() ? NOTES[ Math.min( NOTES.length - 1, Math.floor( v * NOTES.length ) ) ][0] : r0( 2000 * v * v ) + " MS"; }, function(x){ return Math.sqrt( x / 2000 ); }],
	rms: [function(v){ return r0( (0.01 + 2 * v * v) * 1000 ) + " MS"; }, function(x){ return Math.sqrt( Math.max( 0, x / 1000 - 0.01 ) / 2 ); }],
	dcyx: [function(v){ return "DCYX" + (0.25 * Math.pow( 16, v )).toFixed(1); }, function(x){ return Math.log( x / 0.25 ) / Math.log( 16 ); }],
	hz: [function(v){ return r0( 1000 * Math.pow( 12, v ) ) + "HZ"; }, function(x){ return Math.log( x / 1000 ) / Math.log( 12 ); }],
	cents: [function(v){ return r0( (v - 0.5) * 4800 ) + "C"; }, function(x){ return x / 4800 + 0.5; }],
	spd: [function(v){ return (0.3 * Math.pow( 40, v )).toFixed(1) + "HZ"; }, function(x){ return Math.log( x / 0.3 ) / Math.log( 40 ); }],
	spdt: [function(v){ return (0.1 * Math.pow( 200, v )).toFixed(1) + "HZ"; }, function(x){ return Math.log( x / 0.1 ) / Math.log( 200 ); }],
	shape: [function(v){ return SHAPES[ Math.min( 8, Math.floor( v * 9 ) ) ]; }, function(x){ return (SHAPES.indexOf( x ) + 0.5) / 9; }],
	erlr: [function(v){ return Math.round( (1 - v) * 10 ) + "+" + Math.round( v * 10 ) + "LR"; }, function(x){ return x; }],
	nspr: [function(v){ return (1 + v * 2).toFixed(1); }, function(x){ return (x - 1) / 2; }],
	grav: [function(v){ return v < 0.5 ? "INV " + r0( (1 - v * 2) * 100 ) : "GRAV " + r0( (v * 2 - 1) * 100 ); }, function(x){ return x; }],
	abmix: [function(v){ return "A" + Math.round( (1 - v) * 10 ) + "+B" + Math.round( v * 10 ); }, function(x){ return x; }],
	mod3: [function(v){ var d = r0( ((v * 3) % 1) * 100 ); return (v < 1 / 3 ? "SWPT " : (v < 2 / 3 ? "FLNG " : "CHRS ")) + d; }, function(x){ return x; }],
	dist: [function(v){ return v < 0.5 ? "SOFT " + r0( v * 200 ) : "OVRD " + r0( (v - 0.5) * 200 ); }, function(x){ return x; }],
	outdb: [function(v){ return (-40 + v * 40).toFixed(1) + "DB"; }, function(x){ return (x + 40) / 40; }],
	thr: [function(v){ return (-80 + v * 80).toFixed(1) + "DB"; }, function(x){ return (x + 80) / 80; }],
	atk: [function(v){ return (0.0002 * Math.pow( 2500, v )).toFixed(3) + "S"; }, function(x){ return Math.log( x / 0.0002 ) / Math.log( 2500 ); }],
	rel: [function(v){ return (0.005 * Math.pow( 400, v )).toFixed(3) + "S"; }, function(x){ return Math.log( x / 0.005 ) / Math.log( 400 ); }],
	ratio: [function(v){ return v < 0.1 ? "GATE" : (v < 0.35 ? "EXP 1:" + (1 + (0.35 - v) * 16).toFixed(1) : (v < 0.75 ? (1 + (v - 0.35) * 47.5).toFixed(1) + ":1" : (v < 0.85 ? "LIMIT" : "NEG " + (-10 + (v - 0.85) * 60).toFixed(1)))); }, function(x){ return x; }],
	scmix: [function(v){ return "IN" + Math.round( (1 - v) * 10 ) + "+RV" + Math.round( v * 10 ); }, function(x){ return x; }],
	monost: [function(v){ return v < 0.5 ? "MONO " + r0( v * 200 ) : "ST " + r0( (v - 0.5) * 200 ); }, function(x){ return x; }],
	fbinf: [function(v){ return v >= FREEZE_AT ? "FREEZE" : (v >= INF_AT ? "INF" : r0( v * 100 )); }, function(x){ return x / 100; }],
	pdcy: [function(v){ return v >= FREEZE_AT ? "P+V FRZ" : (v >= INF_AT ? "PTCH FRZ" : r0( v * 100 )); }, function(x){ return x / 100; }],
	dcy0: [function(v){ return v < 0.02 ? "OFF" : T.secif[0]( v ); }, function(x){ return T.sec[1]( x ); }]
};
function tempoMode() { return S && S.tempo_mode; }
// per algorithm, per knob: [display name, type]
var A = [
	[["MIX","pct"],["DECAY","secif"],["SIZE","pct"],["PDLY","ms"],["LOW-LVL","bip"],["HI-LVL","bip"],["LODCY","dcyx"],["HIDCY","dcyx"],["MOD-LVL","pct"],["MID-LVL","bip"]],
	[["MIX","pct"],["DECAY","sec"],["SIZE","pct"],["PDLY","ms"],["LOW-LVL","bip"],["HI-LVL","bip"],["ER","erlr"],["DIFFUSION","pct"],["MOD-LVL","pct"],["HIFREQ","hz"]],
	[["MIX","pct"],["DECAY","secif"],["SIZE","pct"],["PDLY","ms"],["LO-DAMP","pct"],["HI-DAMP","pct"],["DISTANCE","pct"],["DIFFUSION","pct"],["MOD-LVL","pct"],["TONE","bip"]],
	[["VERBMIX","pct"],["DECAY","sec"],["TENSION","pct"],["NUMSPR","nspr"],["LO-DAMP","pct"],["HI-DAMP","pct"],["TREM-INT","pct"],["TR-SPD","spd"],["MOD-LVL","pct"],["RESONANCE","pct"]],
	[["MIX","pct"],["A-DCY","secif"],["SIZE","pct"],["A-PDLY","ms"],["A-TONE","bip"],["B-TONE","bip"],["B-DCY","secif"],["B-PDLY","ms"],["ABMIX","abmix"],["RESN","pct"]],
	[["MIX","pct"],["DECAY","rms"],["SIZE","fbinf"],["FEEDBACK","pct"],["LOW-LVL","bip"],["HI-LVL","bip"],["LATE DRY","pct"],["DIFFUSION","pct"],["MOD-LVL","pct"],["CONTOUR","pct"]],
	[["MIX","pct"],["DECAY","dcy0"],["SIZE","pct"],["ECHO","ms"],["LOW-LVL","bip"],["HI-LVL","bip"],["ECHO-FBK","pct"],["MODRATE","pct"],["MOD","mod3"],["ECHTONE","bip"]],
	[["MIX","pct"],["GRAVITY","grav"],["SIZE","pct"],["PDLY","ms"],["LOW-LVL","bip"],["HI-LVL","bip"],["MOD-DPTH","pct"],["MODRATE","pct"],["FEEDBACK","fbinf"],["RESONANCE","pct"]],
	[["MIX","pct"],["DECAY","pct"],["SIZE","pct"],["PDLY","ms"],["LOW-LVL","bip"],["HI-LVL","bip"],["DRIVE","dist"],["OUTPUT","outdb"],["WOBBLE","pct"],["MID-LVL","bip"]],
	[["MIX","pct"],["DECAY","secif"],["SIZE","pct"],["PDLY","ms"],["LOW-LVL","bip"],["HI-LVL","bip"],["SHP","shape"],["SPEED","spdt"],["DEPTH","monost"],["HIFREQ","hz"]],
	[["MIX","pct"],["DECAY","secif"],["SIZE","pct"],["ATK","atk"],["LOW-LVL","bip"],["HI-LVL","bip"],["OMRATIO","ratio"],["REL","rel"],["THRSH","thr"],["SC","scmix"]],
	[["MIX","pct"],["DECAY","pct"],["SIZE","pct"],["DELAY","ms"],["LOW-DCY","pct"],["HI-DCY","pct"],["A-PCH","cents"],["B-PCH","cents"],["PITCH-DCY","pdcy"],["MID-DCY","pct"]]
];
function fmt( a, k, v ) { var p = A[a][k]; return p[0] + " " + T[ p[1] ][0]( v ); }
function inv( a, k, x ) { return Math.min( 1, Math.max( 0, T[ A[a][k][1] ][1]( x ) ) ); }

// factory presets (the ones without tempo), in display units: MIX, DECAY,
// SIZE, DELAY, LOW, HIGH, XNOB, YNOB, FXMIX, CONTOUR
var PRESETS = [
	["HALL", 0, [39, 1.42, 52, 99, -100, -100, 2.1, 2.0, 17, 18]],
	["ROOM", 1, [32, 0.59, 74, 0, 50, -16, 0.5, 0, 0, 3240]],
	["PLATE", 2, [26, 2.48, 84, 32, 73, 73, 79, 88, 0, -32]],
	["SPRING", 3, [19, 7.24, 40, 3.0, 85, 7, 0, 6.9, 7, 45]],
	["DUALVERB", 4, [45, 3.2, 70, 40, 32, 83, 2.75, 120, 0.5, 30]],
	["REVERSE", 5, [100, 819, 61, 6, 1, -100, 100, 83, 13, 100]],
	["MODECHOVERB", 6, [100, 10.0, 90, 0, -8, 75, 0, 50, 0.87, -29]],
	["VOID", 7, [31, 0.93, 92, 0, 1, 0, 0, 36, 18, 0]],
	["WARPVERB", 8, [39, 49, 74, 250, 70, -42, 0.35, -16.5, 34, 73]],
	["TREMOLOVERB", 9, [51, 10.0, 54, 0, 10, 19, "SINE", 4.1, 0.31, 1690]],
	["DYNAVERB", 10, [60, 20.1, 100, 0.08, -13, -9, 0.2, 0.34, -57.7, 0]],
	["SHIMMER", 11, [39, 97, 30, 20, 100, 80, 1204, 1193, 37, 100]],
	["EARTH HALL", 0, [27, 1.61, 49, 15, 4, -18, 0.8, 0.5, 1, 26]],
	["RW TANK", 3, [31, 4.31, 40, 2.9, 44, 29, 0, 3.8, 0, 44]],
	["GUITPLATE", 2, [17, 2.23, 90, 9, 57, 70, 64, 29, 24, -19]],
	["OILDRUM", 2, [50, 2.80, 33, 0, 7, 57, 24, 13, 18, -61]],
	["QUASAR", 11, [50, 70, 90, 50, 86, 72, 1208, 2392, 45, 0]],
	["DARKMATTER", 7, [30, 1.0, 66, 318, 34, -61, 36, 32, 58, 2]],
	["NEBULA", 7, [100, 0.09, 79, 102, -19, 54, 8, 53, 52, 2]],
	["SPRINGTHEORY", 3, [41, 20.0, 100, 1.8, 12, 70, 65, 6.3, 0, 88]],
	["EKOSPACE-GOD", 6, [78, 37.8, 98, 529, -43, -11, 85, 0, 0, -54]],
	["HELLS GATE", 11, [69, 100, 95, 50, 90, 34, -15, -29, 80, 100]],
	["NEUTRINO", 7, [24, 0.825, 42, 0, -19, 73, 0, 63, 47, 85]],
	["RADIO STATIC", 10, [51, 50.0, 100, 0.002, 9, -31, 0.9, 0.005, -58.8, 1]],
	["AMBIENCE", 6, [100, 1.05, 19, 0, 6, -18, 0, 31, 0.23, 0]],
	["BOXY ROOM", 1, [40, 0.71, 10, 0, -100, -100, 0.5, 71, 0, 1000]],
	["SPINDIZZY", 5, [68, 369, 87, 65, 25, -36, 0, 28, 0, 31]],
	["CONTINUUM", 5, [50, 825, 61, 65, -62, -100, 100, 50, 13, 100]],
	["CIGAROOS", 7, [100, 0.705, 80, 0, 30, 42, 10, 19, 87, 53]],
	["SPICY SPRING", 3, [100, 11.0, 100, 2.9, 72, 70, 50, 8.0, 49, 35]]
];
function presetParams( p )
{
	var a = p[1];
	return p[2].map(function(x, k){
		var type = A[a][k][1];
		if(type == "grav") return x;           // already a knob position
		if(type == "secif" || type == "sec" || type == "dcy0") return inv( a, k, x );
		return inv( a, k, x );
	});
}
function defaultParams()
{
	var params = [];
	for(var a = 0; a < 12; ++a)
		params.push( presetParams( PRESETS[a] ) );
	return params;
}
function defaults()
{
	return { algo: 0, preset: 0, params: defaultParams(), active: true, hot: false, tempo: 120, tempo_mode: false, edited: false, algo_mode: false };
}
function validate( s, raw )
{
	var d = defaultParams();
	var src = raw && Array.isArray( raw.params ) ? raw.params : null;
	s.params = d.map(function(row, a){
		return row.map(function(v, k){ var x = src && Array.isArray( src[a] ) ? +src[a][k] : v; return isFinite( x ) ? Math.min( 1, Math.max( 0, x ) ) : v; });
	});
	s.algo = Math.min( 11, Math.max( 0, Math.round( s.algo ) ) );
	s.preset = Math.min( PRESETS.length - 1, Math.max( 0, Math.round( s.preset ) ) );
	s.tempo = Math.min( 300, Math.max( 30, s.tempo ) );
}
function randomize( s )
{
	s.algo = Math.floor( Math.random() * 12 );
	s.params[ s.algo ] = s.params[ s.algo ].map(function(v, k){ return k == 0 ? 0.3 + Math.random() * 0.4 : (k == 1 ? Math.random() * 0.9 : Math.random()); });
	s.edited = true;
}
function loadPreset( s, i )
{
	var p = PRESETS[i];
	s.preset = i; s.algo = p[1]; s.params[ p[1] ] = presetParams( p ); s.edited = false;
}

// ---- the display: 12 characters of 14 segments ----
// segments (bits): A top, B top right, C bottom right, D bottom, E bottom left, F top left, G1 middle
// left, G2 middle right, H diagonal top left, J top middle, K diagonal top right, L diagonal bottom
// left, M bottom middle, N diagonal bottom right, DP
var SEG14 = {
	"0":0x0C3F, "1":0x0006, "2":0x00DB, "3":0x008F, "4":0x00E6, "5":0x2069, "6":0x00FD, "7":0x0007, "8":0x00FF, "9":0x00EF,
	"A":0x00F7, "B":0x128F, "C":0x0039, "D":0x120F, "E":0x00F9, "F":0x0071, "G":0x00BD, "H":0x00F6, "I":0x1209, "J":0x001E,
	"K":0x2470, "L":0x0038, "M":0x0536, "N":0x2136, "O":0x003F, "P":0x00F3, "Q":0x203F, "R":0x20F3, "S":0x00ED, "T":0x1201,
	"U":0x003E, "V":0x0C30, "W":0x2836, "X":0x2D00, "Y":0x1500, "Z":0x0C09, "-":0x00C0, "+":0x12C0, "/":0x0C00, "%":0x0C24,
	"=":0x00C8, "_":0x0008, "'":0x0200, "*":0x3FC0, "&":0x235D, " ":0, ":":0x1200, "<":0x2400, ">":0x0900
};
function seg14( text, x, y, cw, ch, n )
{
	text = String( text ).toUpperCase();
	// dots join the character before them
	var chars = [];
	for(var i = 0; i < text.length; ++i)
	{
		if(text[i] == "." && chars.length) { chars[ chars.length - 1 ].dp = true; continue; }
		chars.push({ c: text[i], dp: false });
	}
	ctx.lineCap = "round";
	for(var k = 0; k < n; ++k)
	{
		var g = chars[k] ? (SEG14[ chars[k].c ] || 0) | (chars[k].dp ? 0x4000 : 0) : 0;
		var x0 = x + k * cw + cw * 0.18, w = cw * 0.6, y0 = y + ch * 0.12, h = ch * 0.76, m = y0 + h / 2, sl = w * 0.12;
		var X = function(px, py) { return px + (m - py) / h * sl * 2; }; // a slant
		var segs = [
			[x0, y0, x0 + w, y0], [x0 + w, y0, x0 + w, m], [x0 + w, m, x0 + w, y0 + h], [x0, y0 + h, x0 + w, y0 + h], [x0, m, x0, y0 + h], [x0, y0, x0, m],
			[x0, m, x0 + w / 2, m], [x0 + w / 2, m, x0 + w, m], [x0, y0, x0 + w / 2, m], [x0 + w / 2, y0, x0 + w / 2, m], [x0 + w, y0, x0 + w / 2, m],
			[x0 + w / 2, m, x0, y0 + h], [x0 + w / 2, m, x0 + w / 2, y0 + h], [x0 + w / 2, m, x0 + w, y0 + h]
		];
		for(var s = 0; s < 15; ++s)
		{
			var on = (g >> s) & 1;
			ctx.strokeStyle = on ? "#ff3a22" : "rgba(255,40,20,0.07)";
			ctx.lineWidth = Math.max( 1.6, cw * 0.11 );
			if(s == 14) { ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc( X( x0 + w + cw * 0.12, y0 + h ), y0 + h, cw * 0.07, 0, Math.PI * 2 ); ctx.fill(); continue; }
			var q = segs[s], gap = 0.08;
			var ax = q[0] + (q[2] - q[0]) * gap, ay = q[1] + (q[3] - q[1]) * gap, bx = q[2] - (q[2] - q[0]) * gap, by = q[3] - (q[3] - q[1]) * gap;
			ctx.beginPath(); ctx.moveTo( X( ax, ay ), ay ); ctx.lineTo( X( bx, by ), by ); ctx.stroke();
		}
	}
	ctx.lineCap = "butt";
}

// ---- widgets in the pedal's style ----
var P_FONT = "Arial, Helvetica, sans-serif";
var KX = 1, X0 = 278, Y0 = 248;
var X = function(x){ return 22 + (x - X0) * KX; }, Y = function(y){ return 8 + (y - Y0) * KX; };
function t( text, x, y, size, color, align, bold )
{
	ctx.font = (bold === false ? "" : "bold ") + Math.round( size * KX ) + "px " + P_FONT;
	ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
	ctx.fillStyle = color || "#e8ebf0";
	ctx.fillText( text, X(x), Y(y) );
}
function hot( id, x, y, w, h )
{
	var full = id_prefix + id;
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitRect( x, y, w, h );
	if(hover) ui.hot = full;
	var clicked = false;
	if(hover && ui.pressed && ui.active === null) { ui.active = full; clicked = true; }
	var kb = keyButton( full, x, y, w, h );
	return { hover: hover, clicked: clicked || kb.pressed, held: (ui.active === full && ui.down) || kb.held };
}
function led( x, y, color, on )
{
	var cx = X(x), cy = Y(y), r = 4.5 * KX;
	if(on) { ctx.fillStyle = color; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc( cx, cy, r * 2.4, 0, Math.PI * 2 ); ctx.fill(); ctx.globalAlpha = 1; }
	ctx.fillStyle = "#050505"; ctx.beginPath(); ctx.arc( cx, cy, r + 1.5, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = on ? color : "#2a2a2e"; ctx.beginPath(); ctx.arc( cx, cy, r, 0, Math.PI * 2 ); ctx.fill();
}
function footswitch( id, x, y, tooltip )
{
	var cx = X(x), cy = Y(y), R = 26 * KX, h = hot( id, cx - R, cy - R, R * 2, R * 2 );
	ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.arc( cx + 2, cy + 3, R + 4, 0, Math.PI * 2 ); ctx.fill();
	var g = ctx.createLinearGradient( cx - R, cy - R, cx + R, cy + R );
	g.addColorStop( 0, "#f2f3f5" ); g.addColorStop( 0.5, "#8d9198" ); g.addColorStop( 1, "#d4d7db" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy, R, 0, Math.PI * 2 ); ctx.fill();
	g = ctx.createRadialGradient( cx - 5, cy - 6, 2, cx, cy, R * 0.62 );
	g.addColorStop( 0, "#ffffff" ); g.addColorStop( 0.6, h.held ? "#9ea3aa" : "#bcc0c6" ); g.addColorStop( 1, "#62666d" );
	ctx.fillStyle = g; ctx.beginPath(); ctx.arc( cx, cy + (h.held ? 1 : 0), R * 0.62, 0, Math.PI * 2 ); ctx.fill();
	if(h.hover && tooltip) tip( tooltip, cx, cy + R + 14 );
	return h;
}
// a knob with the pedal's grey ring (top row) or plain
function pknob( k, x, y, ring )
{
	var a = S.algo, P = S.params[a];
	if(ring)
	{
		ctx.fillStyle = "#4a5466"; ctx.beginPath(); ctx.arc( X(x), Y(y), 31 * KX, 0, Math.PI * 2 ); ctx.fill();
		ctx.fillStyle = "#232833"; ctx.beginPath(); ctx.arc( X(x), Y(y), 27 * KX, 0, Math.PI * 2 ); ctx.fill();
	}
	var v = knob( "k" + k, X(x), Y(y), (k == 0 ? 21 : 22) * KX, P[k], 0, 1, { ticks: 1, def: 0.5, format: function(v){ return fmt( a, k, v ); } } );
	if(v !== P[k])
	{
		P[k] = v; S.edited = true;
		var st = shown[ M.id ] = shown[ M.id ] || {};
		st.text = fmt( a, k, v ); st.t = performance.now();
	}
}
var shown = {}; // module id -> what the display shows for a while (a knob turned)
var taps = {};

function draw( mod )
{
	M = mod; S = mod.settings;
	var size = M.def.size( layout ), w = size[0], h = size[1], st = M.state || {};
	KX = (w - 44) / (848 - X0);
	// the enclosure on a dark rack shelf
	ctx.fillStyle = "#101012"; ctx.fillRect( 0, 0, w, h );
	var g = ctx.createLinearGradient( 0, 0, 0, h );
	g.addColorStop( 0, "#2a2f3a" ); g.addColorStop( 1, "#171a21" );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.roundRect( X(280), Y(252), (846 - 280) * KX, (626 - 252) * KX, 14 * KX ); ctx.fill();
	ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1.5; ctx.stroke();
	// the footswitch area, a shade lighter, and the screws
	ctx.fillStyle = "rgba(255,255,255,0.03)";
	ctx.beginPath(); ctx.roundRect( X(286), Y(490), (554) * KX, (130) * KX, 10 * KX ); ctx.fill();
	[[293, 348], [825, 348], [293, 518], [822, 518]].forEach(function(p){
		ctx.fillStyle = "#8a8f98"; ctx.beginPath(); ctx.arc( X(p[0]), Y(p[1]), 4.5 * KX, 0, Math.PI * 2 ); ctx.fill();
		ctx.strokeStyle = "#3a3f48"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo( X(p[0] - 3), Y(p[1]) ); ctx.lineTo( X(p[0] + 3), Y(p[1]) ); ctx.stroke();
	});
	knob_scale_color = null;
	// MIX, PEAK / SIGNAL; the top row
	pknob( 0, 330, 312, false ); t( "Mix", 330, 347, 9 );
	t( "Peak", 368, 285, 6.5, "#c8ccd4", "right" );
	led( 384, 285, "#ff3a22", st.peak ); led( 384, 302, "#3ce05a", (st.level || 0) > 0.01 );
	[[1, 424, "Decay"], [2, 517, "Size"], [3, 607, "Delay"], [4, 690, "Low"], [5, 782, "High"]].forEach(function(k){ pknob( k[0], k[1], 312, true ); t( k[2], k[1], 348, 9 ); });
	t( "EQ", 742, 336, 8 );
	// the second row
	[[6, 470, "Xnob"], [7, 563, "Ynob"], [8, 650, "FxMix"], [9, 737, "Contour"]].forEach(function(k){ pknob( k[0], k[1], 375, false ); t( k[2], k[1], 405, 9 ); });
	led( 790, 370, "#3ce05a", S.edited ); t( "Edited", 802, 370, 6.5, "#c8ccd4", "left" );
	// TEMPO: a small switch and its LED (blinking with the tapped tempo)
	var beat = (performance.now() / (60000 / S.tempo)) % 1 < 0.15;
	var tb = hot( "tempo", X(334), Y(359), 18 * KX, 18 * KX );
	led( 343, 368, "#ff3a22", S.tempo_mode && beat );
	if(tb.hover) tip( "TEMPO ON / OFF: THE DELAY KNOBS IN NOTE VALUES OF THE TAPPED TEMPO (" + Math.round( S.tempo ) + " BPM)", X(343), Y(384) );
	if(tb.clicked) S.tempo_mode = !S.tempo_mode;
	t( "Tempo", 316, 362, 6, "#c8ccd4", "center" ); t( "on/off", 316, 371, 6, "#c8ccd4", "center", false );
	// PRESET: the encoder (turn: presets, or algorithms in ALGORITHM mode; click: ALGORITHM mode)
	encoder( 380, 368 );
	t( "Preset", 372, 403, 8, "#e8ebf0", "right" ); t( "hold to Save", 376, 403, 6, "#9aa0aa", "left", false );
	t( "Algorithm", 300, 403, 6, "#c8ccd4" );
	led( 303, 432, "#ff9a22", S.algo_mode );
	// the display
	var dx = X(318), dy = Y(425), dw = (810 - 318) * KX, dh = (478 - 425) * KX;
	ctx.fillStyle = "#050505"; ctx.beginPath(); ctx.roundRect( dx - 4, dy - 4, dw + 8, dh + 8, 6 ); ctx.fill();
	ctx.fillStyle = "#120404"; ctx.fillRect( dx, dy, dw, dh );
	var sh = shown[ M.id ], text;
	if(sh && performance.now() - sh.t < 1500) text = sh.text;
	else if(S.algo_mode) text = (S.algo + 1) + "." + NAMES[ S.algo ];
	else text = (PRESETS[ S.preset ][1] == S.algo ? PRESETS[ S.preset ][0] : NAMES[ S.algo ]) + (S.edited ? "*" : "");
	if(!S.active && !(sh && performance.now() - sh.t < 1500)) text = "BYPASSED";
	seg14( text, dx + 6, dy + 3, (dw - 12) / 12, dh - 6, 12 );
	// the footswitches and their LEDs
	led( 340, 505, "#ff8a22", S.active ); t( "Active", 352, 505, 7, "#e8ebf0", "left" );
	t( "HotSwitch", 545, 505, 7, "#e8ebf0", "right" ); t( "▼", 534, 518, 7, "#9aa0aa" ); led( 566, 505, S.hot ? "#ff3a22" : "#3ce05a", true );
	t( "Tap", 770, 505, 7, "#e8ebf0", "right" ); t( "▲", 762, 518, 7, "#9aa0aa" ); led( 786, 505, "#ff3a22", beat );
	if(footswitch( "fs_active", 338, 565, S.active ? "ACTIVE: PRESS TO BYPASS (THE TAILS RING ON)" : "BYPASSED: PRESS FOR ACTIVE" ).clicked) S.active = !S.active;
	if(footswitch( "fs_hot", 560, 565, S.hot ? "HOTSWITCH: FROZEN, PRESS TO RELEASE" : "HOTSWITCH: FREEZE THE REVERB" ).clicked) S.hot = !S.hot;
	if(footswitch( "fs_tap", 787, 565, "TAP TEMPO: " + Math.round( S.tempo ) + " BPM" ).clicked)
	{
		var now = performance.now(), tl = (taps[ M.id ] || []).filter(function(x){ return now - x < 2500; });
		tl.push( now ); taps[ M.id ] = tl;
		if(tl.length >= 2) { S.tempo = Math.min( 300, Math.max( 30, Math.round( 60000 / ((now - tl[0]) / (tl.length - 1)) ) ) ); shown[ M.id ] = { text: "TEMPO " + S.tempo, t: now }; }
	}
	t( "hold for PLAY / PRESET mode", 840, 610, 5, "#7a808a", "right", false );
	// the name, where the pedal has its logos
	ctx.font = "bold " + Math.round( 26 * KX ) + "px " + P_FONT;
	ctx.textAlign = "center"; ctx.textBaseline = "middle";
	ctx.fillStyle = "#e8ebf0";
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = Math.round( 4 * KX ) + "px";
	ctx.fillText( "COSMOS", X(673), Y(565) );
	if(ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
	t( "12 REVERBS · STEREO", 465, 565, 8, "#9aa0aa" );
	M = null; S = null;
}

// the PRESET encoder: drag or wheel steps the presets (or the algorithms in ALGORITHM mode); a click
// without turning switches ALGORITHM mode
var enc = {};
function encoder( x, y )
{
	var cx = X(x), cy = Y(y), R = 22 * KX, full = id_prefix + "encoder", e = enc[ M.id ] = enc[ M.id ] || { a: 0 };
	var hover = !cable_drag && (ui.active === null || ui.active === full) && hitCircle( cx, cy, R + 4 );
	var step = function(d) {
		if(S.algo_mode) { S.algo = (S.algo + d + 12) % 12; S.edited = true; shown[ M.id ] = { text: (S.algo + 1) + "." + NAMES[ S.algo ], t: performance.now() }; }
		else { loadPreset( S, (S.preset + d + PRESETS.length) % PRESETS.length ); shown[ M.id ] = { text: String( S.preset + 1 ).padStart( 2, "0" ) + " " + PRESETS[ S.preset ][0], t: performance.now() }; }
		e.a += d * 0.06;
	};
	if(hover) { ui.hot = full; tip( S.algo_mode ? "ALGORITHM: TURN TO CHOOSE, CLICK FOR THE PRESETS" : "PRESET: TURN TO CHOOSE, CLICK FOR THE ALGORITHMS", cx, cy + R + 14 ); }
	if(hover && ui.pressed && ui.active === null) { ui.active = full; e.y = ui.y; e.moved = false; }
	if(ui.active === full && ui.down) { var d = Math.trunc( (e.y - ui.y) / 12 ); if(d) { step( d ); e.y -= d * 12; e.moved = true; } }
	if(ui.active === full && ui.released && !e.moved) S.algo_mode = !S.algo_mode;
	if(hover && ui.wheel && ui.active === null) { step( ui.wheel > 0 ? -1 : 1 ); ui.wheel = 0; }
	if(keyButton( full, cx - R, cy - R, R * 2, R * 2 ).pressed) S.algo_mode = !S.algo_mode;
	ctx.fillStyle = "#4a5466"; ctx.beginPath(); ctx.arc( cx, cy, R + 5 * KX, 0, Math.PI * 2 ); ctx.fill();
	drawSkinKnob( "lm", cx, cy, R, ((e.a % 1) + 1) % 1, hover );
}

WR.registerSynth( "cosmos", {
	title: "COSMOS",
	description: "COSMOS: 12 stereo reverbs, from halls and springs to shimmer and endless voids",
	about: "Hall, Room, Plate, Spring, DualVerb, Reverse, ModEchoVerb, Void, WarpVerb, TremoloVerb, DynaVerb, Shimmer; 10 knobs per algorithm, presets, freeze. Half width.",
	// keys: 3 played / triggered, 2 often, 1 sometimes, 0 no key (code.js: keyAssign)
	key_prio: [["^fs_", 3], ["^encoder$", 2], ["", 1]],
	category: "Effects",
	half: true,
	insert: true,
	worklet: "devices/cosmos-worklet.js",
	jacks: [],
	rear_jacks: [["IN L","ain","in_l"], ["IN R","ain","in_r"], ["OUT L","aout","out_l"], ["OUT R","aout","out_r"]],
	midi_in: null,
	knob_skin: "lm",
	defaults: defaults,
	validate: validate,
	randomize: randomize,
	size: function( layout ) { var w = (LAYOUTS[ layout ].w - DEVICE_GAP) * 0.5; return [ w, Math.round( 16 + (628 - 248) * (w - 44) / (848 - 278) ) ]; },
	draw: draw,
	rear_note: function( s ) { return (s.active ? "" : "BYPASSED · ") + NAMES[ s.algo ]; }
});

})();
