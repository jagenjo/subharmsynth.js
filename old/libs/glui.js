//handles immediate gui stuff
//requires Canvas2DtoWebGL
var GLUI = {};

var DEG2RAD = 0.0174532925;
var RAD2DEG = 57.295779578552306;

GLUI.NONE = 0;
GLUI.HOVER = 1;
GLUI.CLICKED = 2;
GLUI.DBLCLICKED = 3;
GLUI.PRESSED = 4;

//cell position in the ICONS atlas texture
GLUI.icons = {
	x: [4,2],
	image: [3,0],
	search: [1,0],
	cursor: [6,3],
	cursor_empty: [7,3],
	copy: [8,3],
	paste: [9,3],
	trash: [10,0],
	plus: [0,6],
	minus: [1,6],
	left: [0,3],
	right: [1,3],
	up: [2,3],
	down: [3,3],
	left_arrow: [0,2],
	right_arrow: [1,2],
	up_arrow: [2,2],
	down_arrow: [3,2],
	left_thin: [4,3],
	right_thin: [5,3],
	up_thin: [12,3],
	down_thin: [13,3],
	play: [5,1],
	stop: [4,1],
	pause: [6,1],
	record: [0,1],
	note: [13,4],
	refresh: [12,0],
	circle: [0,1],
	circle_empty: [1,1],
	text: [14,2],
	fullscreen: [10,8]
};

function GLUIContext( options )
{
	this.options = options || {};
	this.ctx = null;
	this.icons = "data/icons.png";
	this.icon_size = 64;

	this.prev_click_pos = null; //click before current click
	this.last_click_pos = null; //current click
	this.last_pos = [0,0];
	this.last_noclick_time = 0; //used for dbl click
	this.last_mouseup_time = 0; //last time the mouse did a mouse up
	this.last_mouseup_pos = null; //last position where the mouse button was released
	this.last_mouse_event = null;

	this.prev_frame_blocked_areas = [];
	this.blocked_areas = [];
	this.disabled_area = [];
	this.viewport_area = null;
	this.drop_areas = [];
	this.prev_frame_drop_areas = [];

	this.active_widget_reference = null;
	this.prev_active_widget_reference = null;
	this.dragging_widget = null;
	this.input_enabled = true; //to block user interaction
	this.capture_keys = false; //in case key events are being captured
	this.wasShift = false;
	this.cancel_next_mouseup = false; //used to avoid a secondary click when a popup is closed
	this.tab_to_next = 0;
	this.wheel_delta = 0;
	this.value_changed = false;
	this.value_changed_from_reset = false; //this is only reseted on resetGUI
	this.dragged_item = null; //the element currently being dragged, must be set manually

	this.text_input_mode = ""; //"prompt", "html", or "" leave empty for immediate

	this.keys_buffer = [];

	this.mouse = {
		position: [0,0], //0,0 top-left corner
		buttons: 0,
		dragging: 0
	};

	this.value_changed = false;

	this.fontFamily = "Arial";
	this.tooltip = null;

	this.style = {
		color: [0.8,0.8,0.8,1],
		backgroundColor: [0.1,0.1,0.1,1],	
		backgroundColor_hover: [0.5,0.5,0.5],
		borderRadius: 10,
		panelBackgroundColor: [0.15,0.15,0.15,1],
		darkColor: [0.02,0.02,0.02,1.0],
		controllerColor: [0.4,0.4,0.4,1.0],
		controllerColor_hover: [0.5,0.5,0.5,1.0],
	};
	this.style_stack = [];
	this.cursor = "";

	//icon to avoid showing the whole canvas being dragged
	this.drag_image = new Image();
	this.drag_image.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABmJLR0QAAAAAAAD5Q7t/AAAACXBIWXMAAAsSAAALEgHS3X78AAAB/0lEQVRYw+VXvWoCQRD+ZgnHFREUFRQkgYBdAj6EIL6CtY29z2DhK/gGdilEEPIAEdJdoykkENHK4sDCA2/SuMfe5f72cqZIPlj2dPZmvvlmZ1eB/w6KMrRarefNZvMAAMwMIvLNAHzPErZtP+kQuIkyHI/HW9u2H9VA6iyJSbvruhBCgIg+mPk+LQERK8/F8fl8/jbLZ/m51+uBmTGbze6I6CMXAjo4HA5gZnS7XSwWi9QkYgkE65sW7XYb8/k8FYnEEmRFp9PBeDxOJHEVBSSGwyG2220siRsdh0kgIk+1QMfcGYbx7jhOU4uATgkKhQJKpZIvOACYpon9fo9yuXzY7XZ6CuiUYDqdRtou54MbastLgSQ/zBwaK7dzIA5xSqYmIDfYRU5vjhur1Up9P7QEqbvAMAwIITwyUZnJDcjM3vrL2tBkIwkEnZ9Op4wFyKhA8KodjUa+jJLAzBgMBigWi9kYN5vNFyJiCQDaw7IsZmYmIq7X669aCoRldA38ShsCyHYQBRxoD8uyVAX1ukAGlej3+17vK059a9WfbcyMarWamFhsG6oBJpPJ75Ygr3tASUj/LsiTxI834bWQeBQvl0u4rpvaYWiWQkSWIBKVSuWNiFgdQggOfqfa4uymaa7C4kQq0Gg0Ph3HMdISDvubpqJWq+3X6/WPlPyb+ALdmxdZHoGhsgAAAABJRU5ErkJggg==";

	this._modal_div = null;
}

GLUI.Context = GLUIContext;

GLUIContext.prototype.init = function(ctx)
{
	var that = this;
	this.context = ctx;

	if(!this._icons_texture)
	{
		if(this.context.webgl_version) //litegl
		{
			GL.blockable_keys["Tab"] = true;
			var params = { minFilter: GL.LINEAR_MIPMAP_LINEAR, anisotropic: 8 };
			if(this.icons)
			{
				var img = gl.textures[this.icons];
				if(!img)
					this._icons_texture = gl.textures[this.icons] = GL.Texture.fromURL( this.icons, params );
			}
		}
		else
		{
			this._icons_texture = new Image();
			this._icons_texture.src = this.icons;
		}
	}

	this.resetGUI();

	//if(!this.options.disable_draganddrop)
	//	this.enableDragAndDrop();
}

//mouse info must contain the mouse event or an object with similar structure
//{ mousex: int, mousey: int, buttons: int, dragging: bool }
GLUIContext.prototype.setMouse = function(mouse_info)
{
	//copy old
	this.last_pos[0] = this.mouse.position[0];
	this.last_pos[1] = this.mouse.position[1];
	//update new
	this.mouse.position[0] = mouse_info.mousex; 
	this.mouse.position[1] = mouse_info.mousey; //0 is top
	this.mouse.buttons = mouse_info.buttons;
	this.mouse.dragging = mouse_info.dragging;
}

//called at beginning of frame
GLUIContext.prototype.resetGUI = function(clear_all)
{
	var tmp = this.prev_frame_blocked_areas;
	this.prev_frame_blocked_areas = this.blocked_areas;
	this.blocked_areas = tmp;
	this.blocked_areas.length = 0;
	this.disabled_area.length = 0;
	tmp = this.prev_frame_drop_areas;
	this.prev_frame_drop_areas = this.drop_areas;
	this.drop_areas = tmp;
	this.drop_areas.length = 0;


	this.draggable_item = null;

	//this.keys_buffer.length = 0;
	this.capture_keys = false;
	this.tooltip = "";
	if(this.context && this.context.start2D) //for webgl
		this.context.start2D();
	this.value_changed = false;
	this.value_changed_from_reset = false;
	this._rendering_context_menu = false;
	this.cursor = "";
	if(clear_all)
	{
		this.last_context_menu = this.context_menu;
		this.context_menu = null;
	}
}

GLUIContext.prototype.pushStyle = function()
{
	var clone = JSON.parse( JSON.stringify( this.style ) );
	this.style_stack.push( clone );
}

GLUIContext.prototype.popStyle = function()
{
	if(this.style_stack.length);
		this.style = this.style_stack.pop();
}

//called at the end of frame
GLUIContext.prototype.finish = function()
{
	//render on top
	if( this.context_menu )
	{
		if( this.drawContextMenu( this.context_menu ) === true )
			this.context_menu = null;
	}
	
	this.wheel_delta = 0; //avoid acumulate
	this.last_mouseup_pos = null; //remove last
}

//blocks means the GUI is processing already this area so do not send to canvas
GLUIContext.prototype.blockArea = function(x,y,w,h,options)
{
	this.blocked_areas.push([x,y,w,h,options]);
}

//blocks means the GUI is processing already this area so do not send to canvas
GLUIContext.prototype.disableArea = function(x,y,w,h)
{
	var area = [x,y,w,h];
	this.disabled_area.push(area);
	return area;
}

//to reenable area
GLUIContext.prototype.enableArea = function(area)
{
	var index = this.disabled_area.indexOf(area);
	if(index != -1)
		this.disabled_area.splice(index,1);
}

//tells you if there is an area capturing the mouse
GLUIContext.prototype.isPositionBlocked = function(x,y,current)
{
	var areas = current ? this.blocked_areas : this.prev_frame_blocked_areas;
	var pos = x.length ? x : [x,y];
	for(var i = 0; i < this.prev_frame_blocked_areas.length; ++i)
	{
		var b = this.prev_frame_blocked_areas[i];
		if( this.isInsideRect( pos, b[0],b[1],b[2],b[3] ) )
			return true;
	}
	return false;
}

GLUIContext.prototype.isInsideRect = function (pos, x,y,w,h)
{
	if(!this.input_enabled) //in case input is disabled
		return false;

	if(x.length)
	{
		y = x[1];
		w = x[2];
		h = x[3];
		x = x[0];
	}

	//allows to limit the action to some area
	if( this.viewport_area )
	{
		var v = this.viewport_area;
		if( pos[0] < v[0] || pos[0] > (v[0] + v[2]) || pos[1] < v[1] || pos[1] > (v[1] + v[3]))
			return false;
	}

	var inside = pos[0] > x && pos[0] < (x + w) && pos[1] > y && pos[1] < (y + h);

	//check if this area is not valid for the mouse
	if(this.disabled_area.length)
	{
		for(var i = 0; i < this.disabled_area.length; ++i)
		{
			var b = this.disabled_area[i];
			if( pos[0] > b[0] && pos[0] < (b[0] + b[2]) && pos[1] > b[1] && pos[1] < (b[1] + b[3]) )
				return false;
		}
	}

	return inside;
}

//file drop on canvas, must be called from outside of the lib when a file is droped on the canvas
GLUIContext.prototype.onDropItem = function(e)
{
	var areas = this.prev_frame_drop_areas;
	var x = e.mousex;
	var y = e.mousey;
	var pos = [x,y];
	//reverse
	for(var i = areas.length - 1; i >= 0; --i)
	{
		var b = areas[i];
		if( b[4] && b[4].onDropItem && this.isInsideRect( pos, b[0],b[1],b[2],b[3] ) )
		{
			b[4].onDropItem( e, b[4].data );
			return true;
		}
	}
	return false;
}

//called when the mouse event is produced
GLUIContext.prototype.onMouse = function(e)
{
	var canvas = this.context.canvas;
	this.cursor = "";
	this.last_mouse_event = e;

	if(e.type == "mousedown" && e.button == 0)
	{
		if( this._modal_div && this._modal_div.autoclose )
			this._modal_div.close();

		this.last_noclick_time = getTime() - this.last_mouseup_time;
		this.last_click_time = 0;
		this.cancel_next_mouseup = false; //new click
		this.wasShift = e.shiftKey;
		this.prev_click_pos = this.mouse.position.concat();
		this.last_click_pos = this.mouse.position.concat();
		var b = this.active_widget_reference ? this.active_widget_reference.area : null;
		if(b && !this.isInsideRect( this.mouse.position, b))
		{
			this.prev_active_widget_reference = this.active_widget_reference;
			this.active_widget_reference = null;
		}
		if(this.draggable_item && this.isInsideRect( this.mouse.position, this.draggable_item.area ))
		{
			e.skip_preventDefault = true;
			this.dragged_item = this.draggable_item.item;
			this.draggable_item = null;
			canvas.draggable = true; //canvas
			//console.log("start drag?");
		}
		if (e.is_touch) {
			this.mouse.position[0] = e.surfaceX;
			this.mouse.position[1] = e.surfaceY;
		}
	}
	else if(e.type == "mouseup" && e.button == 0)
	{
		//process drop?
		canvas.draggable = false; //canvas
		this.dragged_item = null;
		this.mouse.dragging = false;
		this.last_mouseup_pos = this.mouse.position.concat();
		this.last_click_pos = null;
		this.last_click_time = e.click_time;
		this.last_mouseup_time = getTime();
		if( this.cancel_next_mouseup )
		{
			this.cancel_next_mouseup = false;
			return true;
		}

		GUI.CancelContextMenu();
	}
	else if( e.type == "mousemove" )
	{
		if(this.dragged_item)
		{
			e.skip_preventDefault = true;
			//console.log("trying to drag");
		}
	}
	else if(e.type == "mousewheel" || e.type == "wheel")
	{
		this.wheel_delta += (e.wheel > 0) ? 1 : -1;
	}
	else if( e.type == "dragstart" )
	{
		//console.log("DRAGSTART!!!",e);
		e.skip_preventDefault = true;

		//e.currentTarget.style.border = "2px solid red";
		if( this.dragged_item.callback )
			this.dragged_item.callback( e, this.dragged_item );
		else if( this.dragged_item.constructor === String )
			e.dataTransfer.setData("text/plain", this.dragged_item );

		//set icon
		if( this.dragged_item.image )
			e.dataTransfer.setDragImage( this.dragged_item.image, 0, 0 );
		else if(this.drag_image)
			e.dataTransfer.setDragImage( this.drag_image, 0, 0 );
	}
}

GLUIContext.prototype.wasMouseClicked = function()
{
	return this.prev_click_pos != null;
}

//blocks this mouse click from being reused
GLUIContext.prototype.consumeClick = function()
{
	//console.log("click consumed");
	this.last_click_pos = null;
	this.prev_click_pos = null;
	this.cancel_next_mouseup = true; //used to avoid a secondary click when a popup is closed
	this.last_context_menu = this.context_menu;
	this.last_mouseup_pos = null;
	this.context_menu = null;
}

GLUIContext.prototype.setDraggedItem = function(item, extra)
{
	if(!item)
		this.dragged_item = null;
	else
		this.dragged_item = {
			item: item,
			x: this.last_pos[0],
			y: this.last_pos[1],
			extra: extra
		};
}

//use it to cancel any window or panel open
GLUIContext.prototype.escape = function()
{
	var r = this.active_widget_reference || this.context_menu || this._modal_div;

	this.active_widget_reference = null;
	this.context_menu = null;
	this._last_assigned_text_input = null;
	this._last_selected_text_input_mousepos = null;
	if( this._modal_div )
		this._modal_div.close();

	return r;
}

GLUIContext.prototype.onKey = function(e)
{
	if( e.keyCode == "Escape" )
	{
		if( this.escape() )
			return true;
	}

	if( this.capture_keys )
		this.keys_buffer.push(e);
	return this.capture_keys;
}

GLUIContext.prototype.onPaste = function(e, text)
{
	if( this.capture_keys )
		this.keys_buffer.push(text);
	else
		return false;
	return true;
}

GLUIContext.prototype.Label = function(x,y,w,h,text,color,fontsize,mousable,align)
{
	var ctx = this.context;
	ctx.font = (fontsize || Math.floor(h*0.8)) + "px " + this.fontFamily;
	align = align || "left";
	ctx.textAlign = align;
	ctx.fillColor = color || [0.9,0.9,0.9,ctx.globalAlpha];
	if( align == "left" )
		ctx.fillText(String(text),x,y + h * 0.7);
	else if( align == "right" )
		ctx.fillText(String(text),x+w,y + h * 0.7);
	else //center
		ctx.fillText(String(text),x+w*0.5,y + h * 0.7);

	if(mousable)
		return this.HoverArea( x,y,w,h );
	ctx.textAlign = "left";
}

GLUIContext.prototype.Bullet = function( x,y,s, enabled, color, color_hover, on_up, drag_info )
{
	this.blocked_areas.push([x,y,s,s]);

	var r = this.HoverArea( x,y,s,s, drag_info );
	var hover = r == GLUI.HOVER;
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var ctx = this.context;
	if(hover)
		this.cursor = "arrow";

	ctx.fillColor = [1,1,1,0.2];
	ctx.beginPath();
	ctx.arc(x+s*0.5,y+s*0.5,s*0.4,0,Math.PI*2);
	ctx.fill();

	ctx.fillColor = color || [0.02,0.02,0.02,ctx.globalAlpha];
	if(hover)
		ctx.fillColor = color_hover || [0.5,0.5,0.5,ctx.globalAlpha];
	else if(enabled)
		ctx.fillColor = color_hover || [0.9,0.9,0.9,ctx.globalAlpha];

	ctx.beginPath();
	ctx.arc(x+s*0.5,y+s*0.5,s*0.3,0,Math.PI*2);
	ctx.fill();

	if( on_up )
	{
		if( this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,s,s ) )
		{
			this.last_mouseup_pos = this.prev_click_pos = null; //cancel it
			return true;
		}
	}
	else if( this.prev_click_pos && this.isInsideRect( this.prev_click_pos, x,y,s,s ) )
	{
		this.prev_click_pos = null; //cancel it
		return true;
	}
	return false;
}

GLUIContext.prototype.isHoverContextMenu = function(pos)
{
	if( !this.context_menu || this._rendering_context_menu )
		return false;

	var area = this.context_menu.area;
	if(!area)
		return false;
	return this.isInsideRect( pos, area[0], area[1], area[2], area[3] );
}

//tells you if the mouse clicked or hovered an area (and blocks it)
GLUIContext.prototype.HoverArea = function( x,y,w,h, drag_item )
{
	var area = [x,y,w,h];
	this.blocked_areas.push(area);
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	//blocked by context menu?
	if( hover && this.isHoverContextMenu(this.mouse.position) )
		hover = false;
	if(hover)
	{
		this.tooltip = this.next_tooltip;
		this.draggable_item = (!this.dragged_item && drag_item) ? { item: drag_item, area: area } : null;
	}
	this.next_tooltip = null;

	//changed from this.prev_click_pos
	var pressed = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	var clicked = !this.cancel_next_mouseup && this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,w,h );

	if( clicked ) //&& pressed )
	{
		this.last_mouseup_pos = null; //cancel it
		this.last_click_pos = null; 
		return GLUI.CLICKED;
	}
	else if( pressed )
	{
		this.last_click_pos = null; //cancel it
		this.cancel_next_mouseup = true;
		return GLUI.PRESSED;
	}

	return hover ? GLUI.HOVER : GLUI.NONE;
}

//returns if the button was pressed
GLUIContext.prototype.Button = function(x,y,w,h,content,enabled,color,color_hover,border)
{
	this.blocked_areas.push([x,y,w,h]);

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );

	//in case the context menu is over
	var blocked_by_context_menu = this.isHoverContextMenu(this.mouse.position);

	//do not display it as hover
	if( hover && blocked_by_context_menu)
		hover = false;

	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var ctx = this.context;
	if(hover)
		this.cursor = "pointer";

	if (color !== 0) //color 0 means no bg
	{
		ctx.fillColor = color || this.style.backgroundColor;
		if(hover)
			ctx.fillColor = color_hover || this.style.backgroundColor_hover;
		else if(enabled)
			ctx.fillColor = color_hover || [0.9,0.9,0.9,ctx.globalAlpha];

		if( ctx.fillColor[3] > 0)
		{
			if(border == -2 && content && content.constructor === Array ) //bg icon
			{
				if(this._icons_texture)
				{
					ctx.tintImages = true;
					ctx.drawImage( this._icons_texture, 0, 0, this.icon_size,this.icon_size, x, y, w, h );
					ctx.tintImages = false;
				}
			}
			else
			{
				ctx.beginPath();
				if(border == -1)
					ctx.arc(x+w*0.5,y+h*0.5,h*0.5,0,Math.PI*2);
				else if(border == 0)
					ctx.rect(x,y,w,h);
				else
					ctx.roundRect(x,y,w,h, [border || this.style.borderRadius]);
				ctx.fill();
			}
		}
	}

	if(content != null)
	{
		if(content.constructor === String)
		{
			ctx.textAlign = "center";
			ctx.font = ((h * 0.75)|0) + "px Arial";
			ctx.fillColor = enabled ? [ 1 - this.style.color[0],1 - this.style.color[1],1 - this.style.color[2] ] : this.style.color;
			ctx.fillText(content,x+w*0.5,y + h*0.75);
		}
		else 
		{
			this.DrawIcon(x+w*0.5,y+h*0.5,h/80,content,hover || enabled );
		}
	}

	if( !blocked_by_context_menu && !this.cancel_next_mouseup && this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,w,h ) )
	{
		this.consumeClick();
		return true;
	}
	return false;
}

//list of buttons
GLUIContext.prototype.Buttons = function(x,y,w,h,list,border,margin)
{
	if(!list || !list.length)
		return;

	margin = margin || 5;
	var ix = x;
	var iw = w / list.length - margin;
	for(var i = 0; i < list.length; ++i)
	{
		if( this.Button(ix,y,iw,h,list[i]) )
			return i;
		ix += iw + margin;
	}
	return -1;
}

GLUIContext.prototype.Number = function(x,y,w,h, value, delta_factor, border, color, color_hover)
{
	this.blocked_areas.push([x,y,w,h]);

	delta_factor = delta_factor || 0.001;
	this.value_changed = false;

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	var ctx = this.context;
	ctx.fillColor = color || this.style.backgroundColor;
	if(hover)
		ctx.fillColor = color_hover || this.style.backgroundColor_hover;

	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	ctx.beginPath();
	if(border == -1)
		ctx.arc(x+w*0.5,y+h*0.5,h*0.5,0,Math.PI*2);
	else if(border == 0)
		ctx.rect(x,y,w,h);
	else
		ctx.roundRect(x,y,w,h, [border || this.style.borderRadius]);
	ctx.fill();

	var str = value.toFixed( delta_factor == 1 ? 0 : 2);
	ctx.textAlign = "center";
	ctx.font = ((h * 0.75)|0) + "px Arial";
	ctx.fillColor = this.style.color;
	ctx.fillText(str,x+w*0.5,y + h*0.75);

	var clicked = false;
	clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	if(clicked)
	{
		var delta = this.mouse.position[0] - this.last_pos[0];
		if(this.wasShift) delta*=10;
		var old_value = value;
		value += delta * delta_factor;
		if( value != old_value )
			this.value_changed = true;
	}

	var fast_click = this.prev_click_pos && this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,w,h ) && this.last_click_time && this.last_click_time < 250;
	if(fast_click)
	{
		var old_value = value;
		var r = prompt();
		if(r != null)
			value = Number(r);
		this.last_click_time = 0;
		if( value != old_value )
			this.value_changed = true;
	}

	this.value_changed_from_reset |= this.value_changed;
	return value;
}

GLUIContext.prototype.Toggle = function(x,y,w,h,content,enabled,color,color_hover,border)
{
	this.blocked_areas.push([x,y,w,h]);
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;
	this.value_changed = false;

	var ctx = this.context;
	if(content != null)
	{
		if(content.constructor === String)
		{
			ctx.textAlign = "left";
			ctx.font = ((h * 0.75)|0) + "px Arial";
			ctx.fillStyle = "white";
			ctx.fillText(content,x,y + h*0.75);
		}
		else 
		{
			this.DrawIcon(x+h*0.5,y+h*0.5,h/this.icon_size,content,hover || enabled,[0,1,1,1] );
		}
	}

	if( this.Button( x + w - h,y,h,h, null, enabled, color, enabled ? [1,1,1,1] : color_hover, border ) )
	{
		enabled = !enabled;
		this.value_changed = true;
	}

	this.value_changed_from_reset |= this.value_changed;
	return enabled;
}

GLUIContext.prototype.Combo = function(x,y,w,h,selected_index,values)
{
	if(!values)
		throw("combo values missing");
	var old_value = selected_index;
	var item_height = h / values.length;
	this.value_changed = false;
	for(var i = 0; i < values.length; ++i)
	{
		var r = this.Toggle(x,y + item_height * i, w, item_height * 0.9, values[i], i==selected_index, null,null,-1);
		if(r)
			selected_index = i;
	}
	if( selected_index != old_value )
		this.value_changed = true;
	this.value_changed_from_reset |= this.value_changed;
	return selected_index;
}


GLUIContext.prototype.ComboLine = function( x,y,w,h, selected_index, values, id, labels )
{
	if(!values)
		throw("combo values missing");

	var old_value = selected_index;
	this.value_changed = false;
	labels = labels || (values.constructor === Array ? values : Object.values(values));
	var length = labels.length;

	//left button
	if( this.Button(x,y,h,h, GLUI.icons.left ) )
	{
		selected_index = (selected_index - 1) % length;
		if( selected_index == -1 )
			selected_index = length - 1;
		this.value_changed = true;
	}

	//big button
	if( this.Button(x + h,y,w - h*2,h, selected_index != -1 ? String( labels[selected_index] ) : "" )  )
	{
		//show menu
		this.ShowContextMenu(labels,{ id: id });
	}

	//this is a hack to make the context menu selection immediate
	//reads the last selected option from the context menu in case it changed
	if( this._prev_pending_assign && this._prev_pending_assign.id == (id || values) )
	{
		selected_index = this._prev_pending_assign.value;
		this.value_changed = true;
		this._prev_pending_assign = null;
	}

	//right button
	if( this.Button(x + w - h,y,h,h, GLUI.icons.right ) )
	{
		selected_index = (selected_index + 1) % length;
		this.value_changed = true;
	}

	this.value_changed_from_reset |= this.value_changed;
	return selected_index;
}

GLUIContext.prototype.Slider = function(x,y,w,h,value,min,max,step,marker)
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;
	var range = max - min;
	var f = Math.clamp( (value - min) / range, 0, 1 );
	this.value_changed = false;
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	var r = h*0.35; //ball radius

	var ctx = this.context;

	if( marker != null )
	{
		var marker_pos = (marker - min) / range;
		if(marker_pos >= 0 && marker_pos <= 1)
		{
			marker_pos = marker_pos * w;
			ctx.fillColor = [0.5,0.5,0.5,0.5];
			ctx.fillRect(x + marker_pos,y,h*0.1,h);
		}
	}

	//rail
	ctx.fillColor = this.style.darkColor;
	ctx.beginPath();
	ctx.roundRect(x + r,y + h*0.4,w-r*2,h*0.2,[2]);
	ctx.fill();

	//ball
	if( hover || clicked )
		ctx.fillColor = this.style.controllerColor_hover;
	else
		ctx.fillColor = this.style.controllerColor;
	ctx.beginPath();
	ctx.arc(x+r + f*(w-r*2),y + h*0.5,r,0,Math.PI*2);
	ctx.fill();

	//console.log( this.last_click_pos, this.mouse.dragging );

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		f = ((this.mouse.position[0] - (x+r)) / (w-r*2));
		f = Math.clamp(f,0,1);
		var old_value = value;
		value = f * range + min;
		if(step)
			value = Math.round(value / step) * step;
		var xpos = x + f * w;
		ctx.fillColor = [0.3,0.3,0.3,1];
		ctx.fillRect( xpos - 45, y - 40, 90, 30 );
		ctx.fillColor = [0.8,0.8,0.8,1];
		ctx.textAlign = "center";
		ctx.font = "24px Arial";
		ctx.fillText( value.toFixed(step >= 1 ? 0 : 2), xpos, y - 15 );
		if( value != old_value )
			this.value_changed = true;
	}
	
	this.value_changed_from_reset |= this.value_changed;
	return value;
}

GLUIContext.prototype.Knob = function(x,y,w,h,value,min,max,step, num_markers )
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;
	var range = max - min;
	var f = Math.clamp( (value - min) / range, 0, 1 );
	this.value_changed = false;
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	var r = h*0.4; //ball radius

	var ctx = this.context;
	var cx = x + w * 0.5;
	var cy = y + h * 0.5;
	var r = h * 0.5;

	var start_arc = 0.12 + 0.25; //percentaje of circle
	var range_arc = 0.75; 

	//ruler
	if( num_markers !== 0 )
	{
		ctx.fillColor = [0.3,0.3,0.3];
		ctx.save();
		ctx.translate(cx,cy);
		var num = num_markers || 2;
		for(var i = 0; i < num; ++i)
		{
			var ang = (start_arc + (i/(num-1)) * range_arc) * Math.PI * 2;
			ctx.save();
			ctx.rotate(ang);
			ctx.fillRect(r*1.15-2,0,10,4);
			ctx.restore();
		}
		ctx.restore();
	}

	//ball
	ctx.fillColor = [0.02,0.02,0.02,1.0];
	ctx.beginPath();
	ctx.arc(cx,cy,r,0,Math.PI * 2);
	ctx.fill();

	var main_color = [0.4,0.4,0.4,1.0];
	if( hover || clicked )
		main_color = [0.5,0.5,0.5,1.0];
	ctx.fillColor = main_color;

	//arc
	ctx.save();
	ctx.translate(cx,cy);
	ctx.rotate( start_arc * Math.PI * 2 );
	ctx.beginPath();
	ctx.moveTo(0,0);
	ctx.arc(0,0,r*0.9,0,f * range_arc * Math.PI * 2,false);
	ctx.fill();
	ctx.restore();

	//filling
	ctx.fillColor = [0.08,0.08,0.08,1.0];
	ctx.beginPath();
	ctx.arc(cx,cy,r*0.75,0,Math.PI * 2);
	ctx.fill();

	//marker
	var ang = (start_arc + f * range_arc) * Math.PI * 2;
	ctx.save();
	ctx.translate(cx,cy);
	ctx.rotate(ang);
	var main_color = [0.5,0.5,0.5,1.0];
	if( hover || clicked )
		main_color = [0.8,0.8,0.8,1.0];
	ctx.fillColor = main_color;
	ctx.beginPath();
	ctx.arc(r*0.6,0,r*0.1,0,Math.PI * 2);
	ctx.fill();
	ctx.restore();

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		var dx = this.mouse.position[0] - cx;
		var dy = this.mouse.position[1] - cy;
		var dist = Math.sqrt(dx*dx + dy*dy);
		if( dist > 10 ) //avoid suddent changes
		{
			var ang = Math.atan2( dy, dx ) - start_arc * Math.PI * 2;
			ang = ang % (Math.PI * 2);
			if( ang < 0 ) ang = Math.PI * (2.0) + ang;
			if(ang > (Math.PI * 2 * range_arc))
			{
				var dist = ang / (Math.PI * 2) - range_arc;
				f = dist > ((1-range_arc)*0.5) ? 0 : 1;
			}
			else
			{
				f = ang / (range_arc * Math.PI * 2);
				f = Math.clamp(f,0,1);
			}
			var old_value = value;
			value = f * range + min;
			if(step)
				value = Math.round(value / step) * step;
			var xpos = x + f * w;
			if( value != old_value )
				this.value_changed = true;
		}
	}
	
	this.value_changed_from_reset |= this.value_changed;
	return value;
}

GLUIContext.prototype.Rotary = function(x,y,radius,value)
{
	this.blocked_areas.push([x,y,radius,radius]);
	value = value || 0;
	var f = Math.clamp( value / 360, 0, 1 );
	this.value_changed = false;
	var hover = this.isInsideRect( this.mouse.position, x,y,radius,radius );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,radius,radius );
	var r = radius*0.4; //ball radius

	var ctx = this.context;
	var cx = x + radius * 0.5;
	var cy = y + radius * 0.5;

	var start_arc = 0;
	var range_arc = Math.PI; 

	//circle
	ctx.fillColor = this.style.backgroundColor;
	ctx.beginPath();
	ctx.arc(cx,cy,r,0,Math.PI * 2);
	ctx.fill();

	var main_color = [0.4,0.4,0.4,1.0];
	if( hover || clicked )
		main_color = [0.5,0.5,0.5,1.0];
	ctx.fillColor = main_color;

	//ball
	ctx.save();
	ctx.translate(cx,cy);
	ctx.rotate( f * Math.PI * 2 );
	ctx.beginPath();
	ctx.arc(0,r*-0.7,0.15*r,0,Math.PI * 2);
	ctx.closePath();
	ctx.fill();
	ctx.restore();

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		var dx = this.mouse.position[0] - cx;
		var dy = this.mouse.position[1] - cy;
		var dist = Math.sqrt(dx*dx + dy*dy);
		if( dist > 0.1 * r )
		{
			var ang = Math.atan2( dx, -dy );// - start_arc * Math.PI * 2;
			ang = ang % (Math.PI * 2);
			if( ang < 0)
				ang += (Math.PI * 2);
			var old_value = value;
			value = ang * RAD2DEG;
			//if(step)
			//	value = Math.round(value / step) * step;
			var xpos = x + f * radius;
			if( value != old_value )
				this.value_changed = true;
		}
	}
	
	this.value_changed_from_reset |= this.value_changed;
	return value;
}

GLUIContext.prototype.Pad2D = function(x,y,w,h,value,minx,maxx,miny,maxy)
{
	this.blocked_areas.push([x,y,w,h]);
	if(minx == null) minx = -1;
	if(miny == null) miny = -1;
	if(maxx == null) maxx = 1;
	if(maxy == null) maxy = 1;
	value = value || 0;
	var rangex = maxx - minx;
	var rangey = maxy - miny;
	var fx = Math.clamp( (value[0] - minx) / rangex, 0, 1 );
	var fy = Math.clamp( (value[1] - miny) / rangey, 0, 1 );
	this.value_changed = false;
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );
	var r = 10; //ball radius

	var ctx = this.context;

	ctx.fillColor = [0.02,0.02,0.02,1.0];
	ctx.beginPath();
	ctx.roundRect(x,y,w,h,[4]);
	ctx.fill();

	ctx.fillColor = [0.2,0.2,0.2,1];
	ctx.fillRect(x,y+h*0.5,w,2);
	ctx.fillRect(x+w*0.5,y,2,h);

	if( hover || clicked )
		ctx.fillColor = [0.5,0.5,0.5,1.0];
	else
		ctx.fillColor = [0.4,0.4,0.4,1.0];
	ctx.beginPath();
	ctx.arc(x+r + fx*(w-r*2),y+r + fy*(h-r*2),r,0,Math.PI*2);
	ctx.fill();

	//console.log( this.last_click_pos, this.mouse.dragging );

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		fx = ((this.mouse.position[0] - (x+r)) / (w-r*2));
		fy = ((this.mouse.position[1] - (y+r)) / (h-r*2));
		fx = Math.clamp(fx,0,1);
		fy = Math.clamp(fy,0,1);
		var old_valuex = value[0];
		var old_valuey = value[1];
		value[0] = fx * rangex + minx;
		value[1] = fy * rangey + miny;
		//if(step)
		//	value = Math.round(value / step) * step;
		if( value[0] != old_valuex || value[1] != old_valuey )
			this.value_changed = true;
	}
	
	this.value_changed_from_reset |= this.value_changed;
	return value;
}

GLUIContext.prototype.createScrollArea = function( total_height )
{
	return {
			total_height: total_height,
			scroll: 0,
			target: 0
		};
}

GLUIContext.prototype.ScrollableArea = function( scroll_area, x,y,w,h, callback, param, bgcolor, scrollbar_color )
{
	if(!scroll_area)
		throw("no scroll area");

	var ctx = this.context;

	scroll_area.scroll = Math.lerp( scroll_area.scroll, scroll_area.target, 0.1 );

	var size = 20;
	var margin = 4;
	var list_height = h;
	
	var starty = y;
	//bg
	ctx.fillColor = bgcolor || [0.1,0.1,0.1,0.9];
	ctx.beginPath();
	ctx.roundRect( x,starty,w,list_height, [5] );
	ctx.fill();

	//clip
	ctx.save();
	ctx.beginPath();
	ctx.rect(x,y,w,list_height);
	ctx.clip();

	if( callback )
		callback(x,y+10 - scroll_area.scroll,w,h-20,param);

	//scrollbar
	scroll_area.target = this.Scrollbar( x + w - 10, y+10, 8, h-20, scroll_area.target, scroll_area.total, h, scrollbar_color );

	ctx.restore();

	//process scroll wheel
	if( this.wheel_delta && this.isInsideRect( this.mouse.position, x,y,w,h ) )
	{
		scroll_area.target -= this.wheel_delta * 5;
		scroll_area.target = Math.clamp(scroll_area.target,0,scroll_area.total);
		this.wheel_delta = 0;
	}

	return y + h;
}

GLUIContext.prototype.Scrollbar = function(x,y,w,h,value,max,view_size,color)
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;

	view_size = view_size || h;
	var scroll_ratio = (view_size / max);
	var scroll_length = scroll_ratio * h;
	var scrollable_dist = h - scroll_length;
	var f = Math.clamp( value / (max - scroll_length), 0, 1 );

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var clicked = this.last_click_pos && this.isInsideRect( this.last_click_pos, x,y,w,h );

	var ctx = this.context;
	if(color)
		ctx.fillColor = hover ? [color[0]+0.1,color[1]+0.1,color[2]+0.1,color[3]+0.1] : color;
	else
		ctx.fillColor = hover ? [0.2,0.2,0.2,1] : [0.1,0.1,0.1,1];
	ctx.beginPath();
	if(w < 20)
		ctx.rect(x,y,w,h);
	else
		ctx.roundRect(x,y,w,h,[10]);
	ctx.fill();

	if( max < view_size )
		return value;

	ctx.fillColor = hover ? [0.8,0.8,0.8,1] : [0.5,0.5,0.5,1];
	ctx.beginPath();
	if(w < 20)
		ctx.rect(x,y + f * scrollable_dist,w,scroll_length);
	else
		ctx.roundRect(x,y + f * scrollable_dist,w,scroll_length,[10]);
	ctx.fill();

	if( this.last_click_pos && clicked && this.mouse.dragging )
	{
		//compute where it clicked
		f = (this.mouse.position[1] - y - 20) / (h - 40);
		f = Math.clamp(f,0,1);
		value = f * (max - scroll_length);
	}

	return value;
}


GLUIContext.prototype.Progress = function(x,y,w,h,value,min,max)
{
	this.blocked_areas.push([x,y,w,h]);
	value = value || 0;
	var range = max - min;
	var f = Math.clamp( (value - min) / range, 0, 1 );

	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var ctx = this.context;
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(x,y,w,h,[10]);
	ctx.clip();

	ctx.fillColor = [0.1,0.1,0.1,1];
	ctx.fillRect(x,y,w,h);

	ctx.fillColor = [0.6,0.8,1,1];
	ctx.fillRect(x,y,w * f,h);

	ctx.restore();

}

GLUIContext.prototype.DrawIcon = function(x,y,s,icon,reversed,color,image_url,mousable)
{
	var ctx = this.context;
	var canvas = ctx.canvas;
	var size = s*this.icon_size;
	var halfsize = s*this.icon_size*0.5;
	var r = null;
	if(mousable)
		r = this.HoverArea( x - halfsize,y - halfsize,size,size );

	if(color)
	{
		ctx.tintImages = true;
		ctx.fillColor = color;
	}
	var alpha = ctx.globalAlpha;
	if(mousable && r == GLUI.HOVER)
	{
		ctx.globalAlpha += 0.1;
		this.cursor = "pointer";
	}
	image_url = image_url || this.icons;
	var img = null;
	if(ctx.webgl_version)
	{
		img = gl.textures[image_url];
		if(!img)
			img = gl.textures[image_url] = GL.Texture.fromURL(image_url,{ minFilter: GL.LINEAR_MIPMAP_LINEAR, anisotropic: 8 });
	}
	else
		img = this._icons_texture;
	if(!img || !img.width)
		return;

	if(reversed)
		ctx.globalCompositeOperation = "difference";
	ctx.drawImage( img, icon[0]*this.icon_size, icon[1]*this.icon_size, this.icon_size,this.icon_size, x - halfsize, y - halfsize,size,size);
	ctx.globalCompositeOperation = "source-over";
	ctx.tintImages = false;

	ctx.globalAlpha = alpha;

	return r;
}

GLUIContext.prototype.TextField = function(x,y,w,h, text, border, editable, is_password, keep_focus_on_intro, on_intro )
{
	var that = this;
	if(this.tab_to_next == 1)
	{
		this.tab_to_next = 0;
		this.prev_click_pos = [x+1,y+1];
	}

	if( text == null )
		text = "";

	this.value_changed = false;
	this.blocked_areas.push([x,y,w,h]);
	var hover = this.isInsideRect( this.mouse.position, x,y,w,h );
	if( this.isHoverContextMenu( this.mouse.position ) )
		hover = false;
	if(hover)
		this.tooltip = this.next_tooltip;
	this.next_tooltip = null;

	var is_selected = !this.text_input_mode && editable && this.prev_click_pos && this.isInsideRect( this.prev_click_pos, x,y,w,h );
	var max_length = 100;

	var ctx = this.context;
	if(border == null)
		border = 6;
	ctx.fillColor = this.style.backgroundColor;
	ctx.beginPath();
	ctx.roundRect(x,y,w,h,[border]);
	ctx.fill();			
	
	ctx.textAlign = editable ? "left" : "center";
	ctx.font = ((h * 0.75)|0) + "px Arial";
	ctx.fillColor = hover ? [0.9,0.9,0.9,1] : this.style.color;

	this.pressed_enter = false;
	if(is_selected)
	{
		var keys = this.keys_buffer;
		for( var i = 0; i < keys.length; ++i )
		{
			var key = keys[i];
			if(key.constructor === String) //pasted text
			{
				text += key;
				continue;
			}

			if( key.keyCode == 86 && key.ctrlKey ) //paste
				continue;

			if(key.type == "keydown")
			switch(key.keyCode)
			{
				case 8: //tab
					text = text.substr(0, text.length - 1 ); break; //backspace
				case 9: this.tab_to_next = 1; break; 
				case 27: //esc
					this.prev_click_pos = null; 
					this.last_click_pos = null; break; 
				case 13: //return
					this.pressed_enter = true;
					if(!keep_focus_on_intro)
						this.prev_click_pos = null;
					if(on_intro)
					{
						var r = on_intro(text);
						if(r != null)
							text = r;
					}
					break; 
				case 32: //space
					if(text.length < max_length) text += " "; break; 
				default:
					if(text.length < max_length && key.key && key.key.length == 1) //length because control keys send a string like "Shift"
						text += key.key;
			}
			this.value_changed = true;
			//console.log(key.charCode, key.keyCode, key.character, key.which, key );
		}
		keys.length = 0; //consume them
	}

	//to read the last text written in the HTML input window
	if( this.text_input_mode == "html" && 
		this._last_selected_text_input_mousepos && 
		this.isInsideRect( this._last_selected_text_input_mousepos, x,y,w,h ))
	{
		if( this._last_assigned_text_input != null )
		{
			text = this._last_assigned_text_input;
			this._last_assigned_text_input = null;
			this._last_selected_text_input_mousepos = null;
			this.consumeClick();
		}
	}

	this.capture_keys = (this.capture_keys || is_selected);

	var cursor = "";
	if( is_selected && (((getTime() * 0.002)|0) % 2) == 0 )
		cursor = "|";

	var final_text = text;
	if(is_password)
	{
		final_text = "";
		for(var i = 0; i < text.length; ++i)
			final_text += "*";
	}

	if(!is_selected) //clip
	{
		ctx.save();
		ctx.beginPath();
		ctx.rect(x,y,w,h);
		ctx.clip();
	}

	ctx.fillText( final_text + cursor, x + (!editable ? w * 0.5 : 10), y + h * 0.8 );
	if(!is_selected)
		ctx.restore();

	//var clicked = this.prev_click_pos && this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,w,h );
	var clicked = this.last_mouseup_pos && this.isInsideRect( this.last_mouseup_pos, x,y,w,h );
	if(clicked && this.text_input_mode && !is_selected)
	{
		if( this.text_input_mode == "html")
		{
			var mouseup = this.last_mouseup_pos.concat();
			//delay to avoid the window consumes the mouse event
			setTimeout( function(){
				that._last_selected_text_input_mousepos = mouseup;
				var dialog = that.showTextInput( text, function(v){
					that._last_assigned_text_input = v;
					that.consumeClick();
				},null,[x,y,w,h,border], function(){ });
			},10);
			this.consumeClick();
		}
		else if( this.text_input_mode == "prompt")
		{
			var old_value = text;
			var r = prompt(text);
			if(r != null)
				text = r;
			this.last_click_time = 0;
			this.consumeClick();
			if( text != old_value )
				this.value_changed = true;
		}
	}

	this.value_changed_from_reset |= this.value_changed;
	return text;
}

//similar to text field but rounded, better for searchbox
GLUIContext.prototype.SearchBox = function(x,y,w,h, value )
{
	value = GUI.TextField( x, y, w, h, value || "", 15, true );
	if( !value )
		GUI.DrawIcon( x + w - h * 0.5, y + h * 0.5, 0.7 * h / 64, GLUI.icons.search, false, [1,1,1,0.5] );
	else
	{
		if( GUI.DrawIcon( x + w - h * 0.5, y + h * 0.5, 0.7 * h / 64, GLUI.icons.x, false, [1,1,1,0.5], null, true ) == GLUI.CLICKED )
			value = "";
	}

	return value;
}


GLUIContext.prototype.Vector = function(x,y,w,h, data, delta, border )
{
	var num = data.length;
	var iw = w / num;
	var margin = h * 0.2;
	var changed = false;
	this.value_changed = false;
	for(var i = 0; i < num; ++i)
	{
		//this.TextField(x + iw*i, y, iw - 10,h, data[i].toFixed(2) );
		data[i] = this.Number(x + iw*i, y, iw + (i < num - 1 ? -margin : 0 ),h, data[i], delta, border );
		changed = changed || this.value_changed;
	}

	this.value_changed = changed;
	this.value_changed_from_reset |= this.value_changed;
}

GLUIContext.prototype.Color3 = function( x,y,w,h, color, picker_area )
{
	var ctx = this.context;
	if(!color || !color.length || color.length < 3)
		return;
	this.value_changed = false;
	var canvas = ctx.canvas;
	ctx.fillColor = [0,0,0,1];
	ctx.beginPath();
	ctx.roundRect(x-4,y-4,w+8,h+8,[this.style.borderRadius]);
	ctx.fill();

	var picker_size = canvas.height * 0.6;
	if(!picker_area)
		picker_area = [(canvas.width - picker_size) * 0.5, (canvas.height - picker_size) * 0.5, picker_size,picker_size]

	if( this.Button(x,y,w,h,null,true,color,color) )
	{
		if( !this.active_widget_reference || (this.active_widget_reference && this.active_widget_reference.value != color) )
			this.active_widget_reference = {
				value: color,
				area: picker_area
			};
		else
		{
			this.active_widget_reference = this.prev_active_widget_reference = null;
		}
	}

	var edited = false;

	if( this.active_widget_reference && this.active_widget_reference.value == color )
	{
		ctx.fillColor = color;
		ctx.beginPath();
		ctx.roundRect(x,y,w,h,[6]);
		ctx.fill();
		edited = this.Color3Picker(picker_area[0],picker_area[1],picker_area[2],picker_area[3], color);		
		if(edited)
			this.value_changed = true;
	}

	this.value_changed_from_reset |= this.value_changed;
	return edited;
}

GLUIContext.prototype.Color3Picker = function( x,y,w,h, color )
{
	if(!this.context.webgl_version)
		return; //not supported in canvas mode (yet)

	if(!gl.shaders["palette"])
	{
		gl.shaders["palette"] = new GL.Shader( GL.Shader.SCREEN_VERTEX_SHADER, "\
		precision highp float;\n\
		varying vec3 v_wPosition;\n\
		varying vec3 v_wNormal;\n\
		varying vec2 v_coord;\n\
		\n\
		uniform int u_linear;\n\
		uniform float u_hue;\n\
		\n\
		vec3 hsv2rgb(vec3 c)\n\
		{\n\
			vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);\n\
			vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n\
			return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n\
		}\n\
		\n\
		void main() {\n\
			if(u_linear == 0)\n\
				gl_FragColor = vec4( hsv2rgb( vec3(v_coord.x,1.0,1.0 ) ), 1.0 );\n\
			else\n\
				gl_FragColor = vec4( hsv2rgb( vec3(u_hue, v_coord ) ), 1.0 );\n\
		}\n\
		");
	}
	var ctx = this.context;

	var shader = gl.shaders["palette"];
	var mouse_position = this.mouse.position;

	this.blocked_areas.push([x,y,w,h]);

	if(!this.palette)
	{
		this.palette = new GL.Texture(256,256);
		this.palette_hue = new GL.Texture(256,1);
		this.palette_hue.fill( shader.uniforms({u_linear:0}) );
	}

	var hue_sat_lum = vec3.create();
	var picker = vec2.create();

	RGBtoHSV(color, hue_sat_lum);
	picker[0] = hue_sat_lum[1];
	picker[1] = 1 - hue_sat_lum[2];

	//fills texture
	this.palette.fill( shader.uniforms({u_linear:1,u_hue: hue_sat_lum[0]}) );

	var size = w;

	ctx.fillStyle = "black";
	ctx.fillRect(x-4,y-4,w+8,h+8);

	ctx.drawImage(this.palette, x,y,w,h-20 );
	ctx.drawImage(this.palette_hue, x,y+h-20,w,20);
	ctx.globalAlpha = 1;
	ctx.fillStyle = "black";
	ctx.fillRect( x + picker[0] * w - 4,y + picker[1] * (h-20) - 4,8,8);
	ctx.fillStyle = "white";
	ctx.fillRect( x + picker[0] * w - 2,y + picker[1] * (h-20) - 2,4,4);

	ctx.fillRect( x + hue_sat_lum[0] * w - 2,y + (h-22),4,24);

	if( this.wasMouseClicked() && this.isInsideRect( mouse_position,x,y,w,h) )
		this.dragging_widget = "picker";
	if( this.wasMouseClicked() && this.isInsideRect( mouse_position,x,y + (h-20),w,20) )
		this.dragging_widget = "hue";

	if( !this.mouse.dragging )
		this.dragging_widget = null;

	if(this.dragging_widget == "picker" )
	{
		picker[0] = Math.clamp( (mouse_position[0] - x) / w,0,1);
		picker[1] = Math.clamp( (mouse_position[1] - y) / (h-20),0,1);
		var c = HSVtoRGB( hue_sat_lum[0], picker[0], 1 - picker[1] );
		color[0] = c[0]; color[1] = c[1]; color[2] = c[2];
	}

	if(this.dragging_widget == "hue" )
	{
		hue_sat_lum[0] = Math.clamp( (mouse_position[0] - x) / w,0,1);
		var c = HSVtoRGB( hue_sat_lum[0], picker[0], 1 - picker[1] );
		color[0] = c[0]; color[1] = c[1]; color[2] = c[2];
	}

	return !!this.dragging_widget;
}

GLUIContext.prototype.List = function( x,y,w,h, list, item_render_callback, scroll )
{
	var ctx = this.context;

	var starty = y;
	ctx.fillColor = [0.1,0.1,0.1,0.9];
	ctx.beginPath();
	ctx.roundRect( x,starty,w,h, [5] );
	ctx.fill();

	ctx.save();
	ctx.beginPath();
	ctx.rect(x,y,w,h);
	ctx.clip();

	var line_height = 24;

	y += 10;

	if( this.wheel_delta && this.isInsideRect( this.mouse.position, x,y,w,h ) )
	{
		scroll += this.wheel_delta * 0.5;
		this.wheel_delta = 0;
	}

	scroll = Math.clamp(scroll,0,list.length);
	if(scroll)
		y -= line_height * scroll;

	for(var i = 0; i < list.length; ++i)
	{
		var item = list[i];

		if( item_render_callback )
		{
			var dy = item_render_callback( x+10,y,w-20,20, item, i );
			y += (dy == null ? line_height : dy);
		}
		else if( item && item.constructor === String )
		{
			this.Label( x+10,y,w-20,20, item );
			y += line_height;
		}

		if(y > starty + h )
			break;
	}

	ctx.restore();

	return scroll;
}


GLUIContext.prototype.Panel = function(x,y,w,h, title, closable, border_radius, icon, bg_color )
{
	var ctx = this.context;
	ctx.fillColor = bg_color || this.style.panelBackgroundColor;//[0.15,0.15,0.15, 0.9 * ctx.globalAlpha ];
	var border_radius = border_radius != null ? border_radius : 20;
	if(border_radius > (h*0.5))
		border_radius = Math.floor(h*0.5);

	ctx.beginPath();
	if(border_radius)
		ctx.roundRect( x, y, w,h, [border_radius] );
	else
		ctx.rect( x, y, w,h );
	ctx.fill();

	this.blockArea(x,y,w,h);

	if( closable && this.Button(x + w - 40,y+10,30,30,[4,2], false, [0.1,0.1,0.1,0.9],null, 10 ) )
		return false;

	if(icon)
		this.DrawIcon( x + 26, y + h * 0.5, 0.5, icon );

	if(title)
		this.Label( x + 20 + (icon ? 20 : 1), y + 15, w - 40, 30, title );

	return true;
}

//defines an area where a classic drop event can be dropped (like a file, etc)
GLUIContext.prototype.DropArea = function(x,y,w,h, callback, data )
{
	this.drop_areas.push( [x,y,w,h,{ onDropItem:callback, data: data }]);
	return this.dragged_item;
}

//displays a Confirm dialog, returns true if clicked yes, false if clicked no, otherwise null
GLUIContext.prototype.Confirm = function( text )
{
	var ctx = this.context;
	var x = 0;
	var y = 0;
	var w = ctx.canvas.width;
	var h = ctx.canvas.height;

	//ctx.fillColor = [0.1,0.1,0.1, 0.5 * ctx.globalAlpha ];
	//ctx.fillRect( x, y, w,h );
	//this.blockArea(x,y,w,h);

	var x = w * 0.5 - 200;
	var y = h * 0.5 - 50;
	var w = 400;
	var h = 100;

	this.Panel(x,y,w,h,text);
	if( this.Button(x+10, y + 50, 180, 40, "Accept" ) )
		return true;
	if( this.Button(x+210, y + 50, 180, 40, "Cancel" ) )
		return false;
	return null;
}

//will set context_menu object
//values must be array
GLUIContext.prototype.ShowContextMenu = function( values, callback, options )
{
	options = options || {};

	if(callback && callback.constructor === Object)
	{
		options = callback;
		callback = options.callback;
	}

	var that = this;
	var pos = options.position;
	if(!pos)
		pos = [ this.last_pos[0] - 14,this.last_pos[1] - 14 ];

	var info = {
		pos: pos,
		size: [0,0], //will be updated on render
		id: options.id || values, //used to reassign
		values: values,
		callback: callback,
		time: getTime(),
		options: options
	};

	//close previous
	if(this.last_context_menu && options.id == this.last_context_menu.id)
	{
		this.context_menu = null;
		return;
	}

	this._prev_pending_assign = null;
	this.cancel_next_mouseup = true; //avoid clicking an option just showd
	this.last_mouseup_pos = null;
	this.consumeClick();

	setTimeout( function() {
		that.context_menu = info;
	}, 10 ); //deferred to avoid reclicks

	return info;
}

GLUIContext.prototype.CancelContextMenu = function()
{
	this.context_menu = null;
}

GLUIContext.prototype.drawContextMenu = function( context_menu )
{
	if(!context_menu)
		return false;

	this._rendering_context_menu = true;
	var ctx = this.context;

	var options = context_menu.options || {};

	var margin = options.margin != null ? options.margin : 4;
	var item_height = options.item_height != null ? options.item_height : 24;
	var icon_margin = options.icons ? item_height : 0;

	var x = context_menu.pos[0];
	var y = context_menu.pos[1];
	var values = context_menu.values;
	var w = context_menu.size[0] = 200;
	var h = context_menu.size[1] = values.length * item_height + margin*2;
	if( options.title )
	{
		y -= item_height + 4;
		h += item_height + 4;
	}
	if( x + w > ctx.canvas.width )
		x = ctx.canvas.width - w;
	if( y + h > ctx.canvas.height )
		y = ctx.canvas.height - h;

	if(!context_menu.area)
		context_menu.area = [0,0,0,0];
	context_menu.area[0] = x;
	context_menu.area[1] = y;
	context_menu.area[2] = w;
	context_menu.area[3] = h;

	var now = getTime();

	//check if inside context menu
	if( !this.isInsideRect( this.mouse.position, x,y,w,h ) )
	{
		//clicked outside
		if(this.last_click_pos && !this.isInsideRect( this.last_click_pos, x,y,w,h ))
		{
			this.consumeClick();
			return true;
		}

		if( now > context_menu.time + 2000 )
			return true;
	}
	else
		context_menu.time = now;

	//mouse is inside for sure
	ctx.fillColor = [0,0,0,1];
	ctx.fillRect(x,y,w,h);
	var icon_scale = (h/256) * 0.85;
	
	y += margin;

	//title
	if(options.title)
	{
		GUI.Label( x + margin, y, w - margin*2, item_height, options.title );
		y += item_height + 2;
		ctx.fillColor = [0.3,0.3,0.3,0.5];
		ctx.fillRect(x+margin,y+margin-2,w-margin*2,2);
	}

	var selected = -1;
	//render item list
	for(var i = 0; i < values.length; ++i)
	{
		//check mouse interaction
		var st = this.HoverArea(x + margin, y, w - margin*2, item_height);
		var entry = values[i];

		if(entry == null)
		{
			ctx.fillColor = [0.2,0.2,0.2,0.5];
			ctx.fillRect(x+margin,y+margin,w-margin*2,2);
		}
		else
		{
			var title = (entry.constructor === String ? entry : entry.title) || "";
			if(st == GLUI.HOVER)
			{
				ctx.fillColor = [0.2,0.2,0.2,1];
				ctx.fillRect(x+margin,y,w-margin*2,item_height);
			}
			if(icon_margin && entry.icon)
				this.DrawIcon( x + icon_margin * 0.5, y + icon_margin * 0.5, icon_scale, entry.icon );
			this.Label(x + margin + icon_margin, y, w - margin*2 - icon_margin, item_height, title, (context_menu.selected == i || st === GLUI.HOVER) ? [1,1,1,1] : [1,1,1,0.5] );
			if( st === GLUI.CLICKED )
				selected = i;
		}
		y += item_height;
	}

	this._rendering_context_menu = false;

	if( selected != -1 )
	{
		this.consumeClick();
		if( context_menu.callback )
			context_menu.callback( selected, values[selected] );
		else
			this._prev_pending_assign = { id: context_menu.id, value: selected };
		return true;
	}

	return false;
}

GLUIContext.prototype.drawBlockAreas = function()
{
	var ctx = this.context;
	ctx.font = "14px Arial";
	for(var i = 0; i < this.blocked_areas.length; ++i)
	{
		var area = this.blocked_areas[i];
		ctx.fillColor = [1,0.1,0.1,0.25];
		ctx.fillRect(area[0],area[1],area[2],area[3]);
		if( area[4] && area[4].label )
		{
			ctx.fillColor = [1,1,1,1];
			ctx.fillText( area[4].label, area[0],area[1] + 20);
		}
	}
}

GLUIContext.prototype.showTextInput = function( value, callback, callback_change, area, on_close )
{
	var that = this;
	if(this._modal_div && this._modal_div.parentNode)
		this._modal_div.parentNode.removeChild( this._modal_div );

	var parent = document.body; //this.context.canvas.parentNode;
	var div = this._modal_div = document.createElement("div");
	var w = 400;
	var h = 30;
	var x = (document.body.offsetWidth * 0.5 - 100);
	var y = (document.body.offsetHeight * 0.5 - 50);
	var font_size = 20;

	if( area )
	{
		x = area[0];
		y = area[1];
		w = area[2];
		h = area[3];
		font_size = Math.floor(h*0.7);
	}

	div.innerHTML = "<input />";//<span class='buttons'><button class='ok'>OK</button></span>";
	if( area )
		div.style.cssText = "position: fixed; background-color: transparent; color: #AAA; font: "+font_size+"px Arial;";
	else
		div.style.cssText = "position: fixed; border-radius: 10px; background-color: #333; color: #AAA; padding: 10px; font: "+font_size+"px Arial; box-shadow: 1px 1px 3px #111;";
	div.style.left = x + "px";
	div.style.top = y + "px";
	div.style.width = w + "px";
	if(area)
		div.style.height = h + "px";
	else
		div.style.minHeight = h + "px";

	var input = div.querySelector("input");
	if(area)
		input.style.cssText = "outline: none; width: 100%; height: 100%; border-radius: "+(area[4] || 0)+"px; background-color: #000; color: white; font: "+(font_size+2)+"px Arial; border: 0; padding-left: 14px;";
	else
		input.style.cssText = "outline: none; width: calc(100% - 80px); border-radius: 4px; background-color: #000; color: white; font: "+font_size+"px Arial; border: 0; padding: 8px;";
	input.value = value;
	input.addEventListener("keydown",function(e){
		if(e.keyCode == 13)
		{
			if(callback)
				callback(this.value);
			div.close();
		}
		else if(e.keyCode == 27)
			div.close();
		else if( callback_change )
			callback_change(this.value);
	});

	var button_ok = div.querySelector("button.ok");
	if(button_ok)
	{
		var button_css = "cursor: pointer; width: 60px; font: 20px Arial; padding: 8px 12px; border-radius: 2px; background-color: #666; color: white; border: 0; border-radius: 2px;"
		button_ok.style.cssText = button_css;
		button_ok.addEventListener("click",function(e){
			if(callback)
				callback(input.value);
			div.close();
		});
	}

	parent.appendChild( div );
	input.focus();

	div.close = function()
	{
		if(that._modal_div.parentNode)
			that._modal_div.parentNode.removeChild( that._modal_div );
		that._modal_div = null;
		window.blur(); //remove focus from this
		if( on_close )
			on_close();
	}

	div.autoclose = true; //used internally

	return div;
}


/*
GLUIContext.prototype.enableDragAndDrop = function()
{
	var canvas = this.context.canvas;
	canvas.addEventListener("dragstart", inner_drag, false );
	canvas.addEventListener("drag", inner_drag, false );

	function inner_drag(e)
	{
		console.log("drag",e.type);
	}
}
*/

//*****************************************************

function HSVtoRGB(h, s, v) {
    var r, g, b, i, f, p, q, t;
    if (arguments.length === 1) {
        s = h[1], v = h[2], h = h[0];
    }
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return [r,g,b];
}

function RGBtoHSV(color, out) {
    var r = color[0];
    var g = color[1];
    var b = color[2];

    var max = Math.max(r, g, b), min = Math.min(r, g, b),
        d = max - min,
        h,
        s = (max === 0 ? 0 : d / max),
        v = max;

    switch (max) {
        case min: h = 0; break;
        case r: h = (g - b) + d * (g < b ? 6: 0); h /= 6 * d; break;
        case g: h = (b - r) + d * 2; h /= 6 * d; break;
        case b: h = (r - g) + d * 4; h /= 6 * d; break;
    }

	out = out || new Float32Array(color.length);
	out[0] = h;
	out[1] = s;
	out[2] = v;
	if(color.length > 3) //alpha
		out[3] = color[3];
    return out;
}

if (typeof(window) != "undefined" && window.CanvasRenderingContext2D) {

	if(!window.CanvasRenderingContext2D.prototype.hasOwnProperty("fillColor") )
	{
		Object.defineProperty( window.CanvasRenderingContext2D.prototype, "fillColor", {
			set: function(v)
			{
				if(!this._fillColor)
					this._fillColor = new Float32Array([1,1,1,1]);
				this._fillColor.set(v);
				if(v.length == 3)
					this.fillStyle = "#" +  + inner(v[0]) +
											inner(v[1]) +
											inner(v[2]);
				else if(v.length == 4)
				{
					this.globalAlpha = v[3];
					this.fillStyle = "rgba(" + inner2(v[0]) + "," +
												inner2(v[1]) + "," +
												inner2(v[2]) + "," +
												Math.clamp(v[3],0,1).toFixed(3) + ")";
				}

				function inner(v)
				{
					v = Math.clamp( v * 255,0,255)|0;
					return v.toString(16);
				}

				function inner2(v)
				{
					v = Math.clamp( v * 255,0,255)|0;
					return v.toFixed(3);
				}
			},
			get: function()
			{
				this._fillColor[3] = this.globalAlpha;
				return this._fillColor;
			}
		});
	}

	if(!window.CanvasRenderingContext2D.prototype.roundRect)
		window.CanvasRenderingContext2D.prototype.roundRect = function(
		x,
		y,
		w,
		h,
		radius,
		radius_low
	) {
		var top_left_radius = 0;
		var top_right_radius = 0;
		var bottom_left_radius = 0;
		var bottom_right_radius = 0;

		if ( radius === 0 )
		{
			this.rect(x,y,w,h);
			return;
		}

		if(radius_low === undefined)
			radius_low = radius;

		//make it compatible with official one
		if(radius != null && radius.constructor === Array)
		{
			if(radius.length == 1)
				top_left_radius = top_right_radius = bottom_left_radius = bottom_right_radius = radius[0];
			else if(radius.length == 2)
			{
				top_left_radius = bottom_right_radius = radius[0];
				top_right_radius = bottom_left_radius = radius[1];
			}
			else if(radius.length == 4)
			{
				top_left_radius = radius[0];
				top_right_radius = radius[1];
				bottom_left_radius = radius[2];
				bottom_right_radius = radius[3];
			}
			else
				return;
		}
		else //old using numbers
		{
			top_left_radius = radius || 0;
			top_right_radius = radius || 0;
			bottom_left_radius = radius_low || 0;
			bottom_right_radius = radius_low || 0;
		}

		//top right
		this.moveTo(x + top_left_radius, y);
		this.lineTo(x + w - top_right_radius, y);
		this.quadraticCurveTo(x + w, y, x + w, y + top_right_radius);

		//bottom right
		this.lineTo(x + w, y + h - bottom_right_radius);
		this.quadraticCurveTo(
			x + w,
			y + h,
			x + w - bottom_right_radius,
			y + h
		);

		//bottom left
		this.lineTo(x + bottom_right_radius, y + h);
		this.quadraticCurveTo(x, y + h, x, y + h - bottom_left_radius);

		//top left
		this.lineTo(x, y + bottom_left_radius);
		this.quadraticCurveTo(x, y, x + top_left_radius, y);
	};
}

Math.clamp = function(v,a,b) { return (a > v ? a : (b < v ? b : v)); }
Math.lerp =  function(a,b,f) { return a * (1 - f) + b * f; }
Math.lerp01 =  function(a,b,f) { return Math.clamp(a * (1 - f) + b * f,0,1); }
Math.iLerp =  function(a,b,v) { return (v - a) / (b - a); }
Math.remap =  function(v,min,max,min2,max2) { return Math.lerp(min2,max2, Math.iLerp(min,max,v)); }

if(typeof(getTime) == "undefined")
	window.getTime = performance.now.bind(performance);


//global
var GUI = new GLUIContext();
