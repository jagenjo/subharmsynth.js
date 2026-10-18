#!/bin/bash
# tools/make-previews.sh
# Takes a picture of every device for the ADD DEVICE panel: opens app/index.html?preview=<type> in
# headless Chrome (which draws only that device, on magenta), trims the magenta and saves
# app/previews/<type>.jpg, 640 px wide. Run it from anywhere after changing a panel:
#   tools/make-previews.sh [type ...]        (no types: all of them)
# CHROME=/path/to/chrome overrides the browser; it looks for Chrome / Chromium otherwise.

set -e
DIR="$(cd "$(dirname "$0")/../app" && pwd)"
OUT="$DIR/previews"
mkdir -p "$OUT"

if [ -z "$CHROME" ]; then
	for c in google-chrome chromium chromium-browser $HOME/.cache/puppeteer/chrome/*/chrome-linux64/chrome; do
		if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME="$c"; break; fi
	done
fi
[ -n "$CHROME" ] || { echo "no Chrome / Chromium found: set CHROME=/path/to/chrome"; exit 1; }
command -v convert >/dev/null || { echo "ImageMagick (convert) is needed"; exit 1; }

# the device types, as registered by the device files
TYPES="$*"
if [ -z "$TYPES" ]; then
	TYPES=$(cd "$DIR" && node -e '
		const fs=require("fs"), vm=require("vm");
		const sb={ console, performance:{ now:()=>0 } }; vm.createContext(sb);
		vm.runInContext(fs.readFileSync("webrack.js","utf8"), sb);
		for(const f of fs.readdirSync("devices")) if(!/-worklet\.js$/.test(f)) vm.runInContext(fs.readFileSync("devices/"+f,"utf8"), sb);
		console.log(vm.runInContext("WR.order", sb).join(" "));')
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for t in $TYPES; do
	# full width devices 1568 px wide, half width ones about 773: a window of that width, tall enough
	"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
		--user-data-dir="$TMP/profile" --window-size=1568,1100 --virtual-time-budget=5000 \
		--screenshot="$TMP/$t.png" "file://$DIR/index.html?preview=$t" >/dev/null 2>&1 || true
	if [ ! -s "$TMP/$t.png" ]; then echo "$t: no picture"; continue; fi
	convert "$TMP/$t.png" -bordercolor "#ff00ff" -border 1 -fuzz 3% -trim +repage -resize 640x -quality 84 "$OUT/$t.jpg"
	echo "$t: $(identify -format '%wx%h' "$OUT/$t.jpg")"
done
