// the first version of the rack's polyrhythmic synthesizer

var canvas = document.querySelector("canvas");
var ctx = canvas.getContext("2d");
var bpm = 90;
var font_name = "Antonio"
ctx.font = "20px " + font_name;

var mouse = {
	mousex: 0,
	mousey: 0,
	position: [0,0],
	dragging: false,
	buttons: 0
}

var socket_dragged = null;

GUI.init( ctx );
var synth = new Harm();

function drawLed(x,y,radius,state,label)
{
	ctx.fillStyle = "black";
	ctx.beginPath();
	ctx.arc(x,y,radius*1.1,0,Math.PI*2);
	ctx.closePath();
	ctx.fill();

	{
		ctx.fillStyle = state ? "#F43" : "#111";
		ctx.beginPath();
		ctx.arc(x,y,radius,0,Math.PI*2);
		ctx.closePath();
		ctx.fill();
	}

	if(label)
	{
		ctx.fillStyle = "#AAA";
		ctx.font = "14px " + font_name;		
		ctx.textAlign = "left";
		ctx.fillText( label, x + radius*2,y + radius * 0.5 );
	}
}

function drawLabel(text,x,y,scale,reverse)
{
	scale = scale || 1;
	
	ctx.font = (20 * scale).toFixed(0) + "px " + font_name;
	ctx.textAlign = "center";
	ctx.fillStyle = reverse ? "#000" : "#BBB";

	if(reverse)
	{
		ctx.fillStyle = "#BBB";
		var h = (20 * scale);
		var info = ctx.measureText( text );
		var w = info.width + 10;
		ctx.fillRect(x-w*0.5,y-h-1,w,h*1.4);
		ctx.fillStyle = "#000";
		ctx.fillText(text,x,y);
	}
	else
	{
		ctx.fillStyle = "#BBB";
		ctx.fillText(text,x,y);
	}
}

function drawSwitch(x,y,w,h, up)
{
	var r = GUI.HoverArea(x,y,w,h);

	ctx.fillStyle = "black";
	ctx.fillRect(x-4,y-4,w+8,h+8);

	ctx.fillStyle = "#AAA";
	if( up )
		ctx.fillRect(x,y,w,h*0.6);
	else
		ctx.fillRect(x,y+h*0.4,w,h*0.6);

	return r == GLUI.CLICKED;
}

function drawButton(x,y,w,h,text,state)
{
	var r = GUI.HoverArea(x,y,w,h);

	ctx.fillStyle = "#222";
	ctx.beginPath();
	ctx.roundRect(x-2,y-2,w+4,h+4,[6]);
	ctx.fill();

	if( state || r == GLUI.CLICKED)
		ctx.fillStyle = "#A44";
	else
		ctx.fillStyle = r == GLUI.HOVER ? "#777" : "#66666A";

	ctx.beginPath();
	ctx.roundRect(x,y,w,h,[4]);
	ctx.fill();

	ctx.fillStyle = "black";
	ctx.textAlign = "center";
	if(text)
		ctx.fillText( text, x + w * 0.5, y + h * 0.7, w,h );

	return r == GLUI.CLICKED;
}

function drawSocket(x,y, label)
{
	var r = GUI.HoverArea(x-15,y-15,30,30);

	ctx.fillStyle = r == GLUI.HOVER ? "#AAA" : "#777";
	ctx.beginPath();
	ctx.arc(x,y,15,0,Math.PI*2);
	ctx.fill();
	ctx.fillStyle = "#111";
	ctx.beginPath();
	ctx.arc(x,y,10,0,Math.PI*2);
	ctx.fill();

	if(label)
	{
		if(label[0] == "!")
			drawLabel(label.substr(1), x,y - 30, 0.6, true );
		else
			drawLabel(label, x,y - 30, 0.6 );
	}

	if(r == GLUI.CLICKED)
		socket_dragged = {
			pos: [x,y],
			label: label
		};

	return r == GLUI.CLICKED;
}


//read this https://www.alanzucconi.com/2020/12/13/catenary-2/
function drawWire( start_slot, end_slot, color )
{
	var end_pos = null;
	if(!end_slot)
		end_pos = mouse.position;
	else
		end_pos = end_slot.pos;
	var start_pos = start_slot.pos;
	//var middle = [(start_pos[0] + end_pos[0]) * 0.5, (start_pos[1] + end_pos[1]) * 0.5 ];
	//middle[1] += 100;

	var segments = 16;
	var offset = 0;//Math.sin( performance.now() * 0.005 ) * 50;

	var diffx = end_pos[0] - start_pos[0];
	var diffy = end_pos[1] - start_pos[1];
	var length = Math.sqrt( diffx*diffx + diffy * diffy );

	var targetLength = length * 2;
	var l = targetLength;

	// Simple step method for finding 'a' from: https://www.alanzucconi.com/2020/12/13/catenary-2/

	var step = 0.001;
	var s = 0;
	do
		s += step;
	while (Math.sinh(s) / s < Math.sqrt(l * l - diffy * diffy) / diffx);

	var a = diffx / s / 2.0;
	var p = (diffx - a * Math.log((l + diffy) / (l - diffy))) / 2.0;
	var q = (diffy - l * Math.cosh(s)) / 2.0;	

	ctx.fillStyle = color || "#AEF";
	ctx.beginPath();
	ctx.arc(start_pos[0],start_pos[1], 10,0,Math.PI*2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(end_pos[0],end_pos[1], 10,0,Math.PI*2);
	ctx.fill();

	ctx.lineWidth = 10;
	ctx.strokeStyle = color || "#AEF";
	ctx.beginPath();

	ctx.moveTo(start_pos[0],start_pos[1]);
	//ctx.lineTo(end_pos[0],end_pos[1]);
	//ctx.bezierCurveTo( middle[0]+offset,middle[1]+50,middle[0]+offset,middle[1]+50,end_pos[0],end_pos[1]);

	for (var i = 0; i < segments + 1; i++)
	{
		var x = i / segments;
		var y = a * Math.cosh((x * diffx - p) / a) + q;
		ctx.lineTo(start_pos[0] + x, start_pos[1] + y);
}

	ctx.stroke();

/*
	public static void CreateCatenary(List<Vector3> points, in Vector3 p1, in Vector3 p2, int segments, float targetLength)
	{
		if (segments < 1)
			segments = 1;

		Vector3 diff = p2 - p1;

		// Fully taut
		if (segments == 1 || diff.magnitude > targetLength)
		{
			points.Clear();
			points.Add(p1);
			points.Add(p2);
			return;
		}

		float yDiff = diff.y;
		Vector3 planarDiff = diff;
		planarDiff.y = 0;
		float xDiff = planarDiff.magnitude;

		float l = targetLength;

		// Simple step method for finding 'a' from: https://www.alanzucconi.com/2020/12/13/catenary-2/

		const float step = 0.001f;
		float s = 0;
		do
			s += step;
		while (Sinh(s) / s < Mathf.Sqrt(l * l - yDiff * yDiff) / xDiff);

		float a = xDiff / s / 2.0f;
		float p = (xDiff - a * Mathf.Log((l + yDiff) / (l - yDiff))) / 2.0f;
		float q = (yDiff - l * Coth(s)) / 2.0f;

		points.Clear();

		for (int i = 0; i < segments + 1; i++)
		{
			float x = (float)i / segments;

			// from: https://en.wikipedia.org/wiki/Catenary#Determining_parameters
			float y = a * Cosh((x * xDiff - p) / a) + q;

			Vector3 point = planarDiff * x;
			point.y = y;
			points.Add(p1 + point);
		}
	}	
	*/
}

function drawTitlebar()
{
	var settings = synth.settings;

	ctx.fillStyle = "#444";
	ctx.fillRect(0,0,canvas.width,50);

	drawLabel("REVERB",460,35,1);
	settings.reverb = GUI.Knob( 500,10,35,35, settings.reverb, 0, 1 );
	//drawLabel("DELAY",600,35,1);
	//settings.delay = GUI.Knob( 640,10,35,35, settings.delay, 0, 1 );
	if( drawButton( 230,10,80,30, "SAVE" ) )
		localStorage.setItem( "SUBHARM_state", JSON.stringify( synth.settings ) );
	if( drawButton( 320,10,80,30, "LOAD" ) )
	{
		var data = localStorage.getItem( "SUBHARM_state" );
		if(data)
		{
			synth.init();
			synth.settings = JSON.parse( data );
		}
	}

	if( !synth.context )
	{
	}
	else
	{
		if( synth.context.state != "running" && drawButton( 10,10, 100,30, "Play" ) )
			synth.context.resume();
		else if( synth.context.state == "running" && drawButton( 10,10, 100,30, "Stop" ) )
			synth.context.suspend();
	}
}

function draw()
{
	GUI.resetGUI();
	ctx.fillStyle = "#333";
	ctx.fillRect(0,0,canvas.width, canvas.height);

	ctx.fillStyle = "#AAA";
	ctx.fillRect(mouse[0] - 5,mouse[1] - 5,10,10);

	drawTitlebar();

	synth.draw(ctx,0,60);

	/*
	if( socket_dragged )
		drawWire( socket_dragged, null );

	drawWire( { pos:[100,100] }, { pos:[500,100] } );
	*/

	GUI.finish();
}



var time_step = 10;
var time = performance.now();

function update()
{
	var now = performance.now();
	var dt = now - time;
	time = now;

	if(synth.context)
		synth.update(dt,time);

	if(!mouse.dragging)
		socket_dragged = null;
}

/*
function tick()
{
	var scale = ["A","B","C","D","E","F","G"]; 
	var octave = 4;
	var time = performance.now() * 0.001;
	//var note = scale[ Math.floor( scale.length * Math.random() ) ];
	var note = scale[ Math.floor( scale.length * ((time * 0.2) % 1) ) ];
	//synth.playNote( note + octave );

	synth.playNote( "A4" );
}
*/

function onMouse(e)
{
	mouse.position[0] = mouse.mousex = e.clientX;
	mouse.position[1] = mouse.mousey = e.clientY;
	mouse.buttons = e.buttons;
	GUI.onMouse(e);

	if(e.type == "mousedown")
	{
		mouse.dragging = true;
		if(!synth.context)
			synth.init();
	}
	else if(e.type == "mousemove")
	{
		
	}
	else if(e.type == "mouseup")
	{
		mouse.dragging = false;
	}
}


function loop()
{
	requestAnimationFrame( loop );
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	GUI.resetGUI();
	GUI.setMouse( mouse );
	draw();
}

canvas.addEventListener("mousedown", onMouse );
canvas.addEventListener("mousemove", onMouse );
canvas.addEventListener("mouseup", onMouse );

//launch loop
var update_interval = setInterval( update, time_step );
//var tick_interval = setInterval( tick, (60 / bpm) * 1000 );
//synth.run();
loop();


//from https://www.mathworks.com/matlabcentral/fileexchange/38550-catenary-hanging-rope-between-two-points
/*
function computeCatenary( a, b, r_length, N, sagInit )
{
	// given two points a=[ax ay] and b=[bx by] in the vertical plane,
	// rope length r_length, and the number of intermediate points N,
	// outputs the coordinates X and Y of the hanging rope from a to b
	// the optional input sagInit initializes the sag parameter for the
	// root-finding procedure.
	var maxIter	= 100;   // maximum number of iterations
	var minGrad	= 1e-10;     // minimum norm of gradient
	var minVal	= 1e-8;      // minimum norm of sag function
	var stepDec	= 0.5;       // factor for decreasing stepsize
	var minStep	= 1e-9;		 // minimum step size
	var minHoriz	= 1e-3;		 // minumum horizontal distance
	var sag;
	if (nargin < 5)
		sag = 1;
	else
		sag = sagInit;
	if (a[0] > b[0])
	{
		var tmp = b;
		b = a;
		a = temp;
	}
	var d = b[0]-a[0];
	var h = b[1]-a[1];
	if (Math.abs(d) < minHoriz) // almost perfectly vertical
	{
		X = ones(1,N)*(a[0]+b[0])/2;
		if r_length < abs(h) // rope is stretched
		{
			Y = linspace(a[1],b[1],N);
		}
		else
		{
			sag	= (r_length-Math.abs(h))/2;
			n_sag = Math.ceil( N * sag/r_length );
			y_max = max(a[1],b[1]);
			y_min = min(a[1],b[1]);
			Y		= linspace( y_max, y_min-sag, N-n_sag );
			Y		= [Y linspace(y_min-sag,y_min,n_sag)];
		}
		return;
	}

	X = linspace(a[0],b[0],N);

	if (r_length <= sqrt(d*d+h*h)) // rope is stretched: straight line
		Y = linspace(a[1],b[1],N);
	else
	{
		// find rope sag
		g  = function(s){ return 2*Math.sinh(s*d/2)/s - Math.sqrt(r_length*r_length-h*h); }
		dg = function(s){ return 2*Math.cosh(s*d/2)*d/(2*s) - 2*Math.sinh(s*d/2)/(s*s); }
		for (var iter = 1; iter < maxIter; ++iter)
		{
			val	= g(sag); 
			grad = dg(sag);
			if (Math.abs(val) < minVal || Math.abs(grad) < minGrad)
				break
			search	= -g(sag)/dg(sag);
			alpha		= 1;
			sag_new  = sag + alpha*search;
			
			while (sag_new < 0 || Math.abs( g(sag_new) ) > Math.abs(val) )
			{
				alpha = stepDec*alpha;
				if (alpha < minStep)
					break;
				sag_new	= sag + alpha*search;			
			}
			
			sag = sag_new;
		}
		// get location of rope minimum and vertical bias
		x_left	= 1/2*(Math.log((r_length+h)/(r_length-h))/sag-d);
		x_min		= a[0] - x_left;
		bias		= a[1] - Math.cosh(x_left*sag) / sag;
		Y			= Math.cosh( (X-x_min)*sag )/sag + bias;
	}
}
*/