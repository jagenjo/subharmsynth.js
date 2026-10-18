# GASFREE

**GASFREE** (from GAS, Gear Acquisition Syndrome, and FREE: all the gear, none of the buying) is a browser rack of synthesizers built on the WebAudio API, inspired by classic instruments: a polyrhythmic synthesizer (Subharm), an analog percussion synthesizer (DRAM), a semi-modular synthesizer with a 32 step sequencer (Brother-32), a generative synthesizer (Maze), wave-scanning and wavetable polyphonic synthesizers (Mystic, Mount), a four-oscillator paraphonic synthesizer (Para D), an early 80s style drum machine (LLM Dram), an ambient drone machine (Lunar 21) and a note grid sequencer (Grid 32), plus a granular looper (Universe), a multi-algorithm reverb (Cosmos) a lo-fi distortion (Hyper) and a tape machine (Tape), with a mixer, LFOs, compressors, reverbs and delays, all patchable with each other. Every name in it is its own; it is not affiliated with any instrument maker.

All synthesis runs in real time in one `AudioWorkletProcessor` (`rack-worklet.js`), which hosts each synth's DSP and copies the patch cables between them every sample. Oscillators, filters, envelopes, clocks, sequencers and the cables are all computed per sample, so patching between synths is sample-accurate. The reverb and delay are native WebAudio nodes after it.

Needs a browser with AudioWorklet support, served over `https://` or `localhost`. Web MIDI works in Chromium-based browsers.

## Files

The repository has three parts: the app in `app/` (open `app/index.html`), the home page in `home/`, and `index.html` at the root, which sends visitors to the home page. `tools/` has the scripts.

| file | what |
|---|---|
| `index.html` | sends the project's address to the home page |
| `app/index.html` | the app: page and toolbar |
| `app/editor/` | the Synth Editor and the custom synths, apart from the other devices: `custom-worklet.js` (the module catalog and the engine that plays a design), `custom.js` (the device: its panel in the rack), `editor.js` and `editor.css` (the editor) |
| `app/analytics.js` | anonymous, cookie-free usage statistics (Umami), shared with the home page; off until `UMAMI_SRC` and `UMAMI_ID` are set at its top |
| `app/webrack.js` | the rack controller: synth registry, settings and patches, audio graph, post FX, Scala parser, Web MIDI, keys |
| `app/rack-worklet.js` | the audio processor: hosts the synths' DSP, routes the cables, runs the keys outputs, LFOs, compressor and scope |
| `app/sequencer.js` | the song sequencer in the bottom bar: tracks, piano roll, transport, recording, scheduling |
| `app/sessions.js` | sessions: the rack autosaved in the browser, the Sessions panel |
| `app/code.js` | the rack UI: canvas widgets (knobs, buttons, switches, jacks), cables, shared devices, scrolling and zoom, toolbar, keyboard shortcuts |
| `app/devices/subharm.js`, `app/devices/subharm-worklet.js` | the Subharm: panel, jacks and settings; DSP |
| `app/devices/dram.js`, `app/devices/dram-worklet.js` | the DRAM |
| `app/devices/b32.js`, `app/devices/b32-worklet.js` | the Brother-32 |
| `app/devices/maze.js`, `app/devices/maze-worklet.js` | the Maze |
| `app/devices/mystic.js`, `app/devices/mystic-worklet.js` | the Mystic (polyphonic) |
| `app/devices/llmdram.js`, `app/devices/llmdram-worklet.js` | the LLM Dram drum machine |
| `app/devices/lunar.js`, `app/devices/lunar-worklet.js` | the Lunar 21 drone machine |
| `app/previews/`, `tools/make-previews.sh` | the devices' pictures for ADD DEVICE, and the script that makes them |
| `app/devices/mixer.js`, `app/devices/mixer-worklet.js` | the 6 channel mixer |
| `app/devices/lfo.js`, `app/devices/lfo-worklet.js` | the dual LFO |
| `app/devices/comp.js`, `app/devices/comp-worklet.js` | the stereo compressor and its scope |
| `app/devices/delay.js`, `app/devices/delay-worklet.js` | the stereo / ping-pong delay |
| `app/devices/universe.js`, `app/devices/universe-worklet.js` | Universe, the granular / looper effect |
| `app/devices/hyper.js`, `app/devices/hyper-worklet.js` | Hyper, the distortion / bit crusher |
| `app/devices/tape.js`, `app/devices/tape-worklet.js` | Tape, the tape machine (wow, flutter, saturation, hiss) |
| `app/devices/cosmos.js`, `app/devices/cosmos-worklet.js` | Cosmos, the 12 algorithm reverb |
| `app/devices/pollyd.js`, `app/devices/pollyd-worklet.js` | Para D, the four-voice paraphonic synthesizer |
| `app/devices/grid.js`, `app/devices/grid-worklet.js` | Grid 32, the note matrix sequencer |
| `app/devices/mount.js`, `app/devices/mount-worklet.js` | Mount, the eight voice polyphonic synthesizer |
| `app/devices/reroute.js`, `app/devices/reroute-worklet.js` | Reroute, front to back and back again |
| `app/devices/reverb.js`, `app/devices/reverb-worklet.js` | the convolution reverb: native nodes, bridged through a send / return slot |
| `app/data/patches.json` | factory patches |
| `home/` | the project's home page: features, screenshots (`home/img/`), every device, and a button to launch the app |
| `home/img/share.jpg` | the picture shown when a link to the site is shared (1200 × 630; the home page's and the app's `og:image`, at `https://gasfree.app/img/share.jpg`) |
| `home/logo.svg`, `home/icon.svg`, `tools/make-logo.py` | the GASFREE logo (a knob drawn as a fuel gauge, turned to F) and the mark alone (the home page's icon), and the script that draws them |
| `old/` | the first version of this project, as in the first commit |
| `app/data/impulses/` | free reverb impulse responses, redistributed unaltered under their `license.txt` |
| `app/data/scales/` | Scala `.scl` scales, plus `index.json` used by the scale picker |

## Synth Editor

Build your own synth: design its front panel, then wire what is behind it.

- **Start:** ADD DEVICE › Custom › CUSTOM SYNTH adds one and opens the editor. The ✎ button on a custom synth's left ear opens it again. It starts as an example synth (MIDI, oscillator, filter, envelope, VCA); **Empty panel** starts from scratch.
- **The panel:** choose its width (full or half rack), height (1 to 5 units), colour, knob style and wooden sides.
- **FRONT PANEL:** the palette shows each item as it will look (in the panel's colours and knob style): knobs (small, medium, large, XL and huge), sliders, buttons (a gate while held), switches, LEDs, jacks in and out, labels, sections, rectangles, lines and screws.
  - Drag one onto the panel: it follows the mouse at its real size and lands where it is dropped. A click adds it in a free place.
  - **Knobs** have their own scale: where it starts and ends (a turn from 7 to 5 o'clock, almost a full turn, a full turn, the top half, a quarter, or any angles), its lines (automatic, a number, or none), and whether the knob turns smoothly or clicks through a number of steps (2 to 64).
  - Drag an item to move it. Drag the corner of a section, rectangle, slider or button to resize it, and the ends of a line to change it.
  - Delete removes it, the arrows nudge it, and Ctrl+D duplicates it. The properties on the right set its label, size, colour and range.
- **BACK PANEL:** what the rack shows with Tab. MAIN OUT L / R (where the AUDIO OUT module's sound leaves, cabled to the speakers when the synth is added) and MIDI IN (with its channel switches) are always there; move them where you like. Add AUDIO IN sockets (audio from the rack into the synth: it can be an effect too), AUDIO OUT sockets (more outputs), labels, rectangles, lines, vents and screws. It starts with vents and a sticker with the synth's name.
- **Lines and rectangles** (front and back): their colour is the panel's print (normal or dim), its line colour, or a fixed one (red, orange, yellow, green, blue, white, black, cream). Rectangles can be filled and have rounded corners; lines and outlines have a width.
- **INSIDE:** every item with an input or output is a node, in its place on the panel spread a little apart, next to the modules. The nodes of the panel's items show the gadget itself, live: a knob at its value, an LED lit with its input. The modules:
  - **Inputs:** MIDI IN (pitch, gate, velocity).
  - **Sources:** OSCILLATOR (sine, triangle, saw, square with pulse width), NOISE.
  - **Modulation:** LFO, ENVELOPE (ADSR), CLOCK, STEP SEQUENCER (8 steps), SAMPLE & HOLD, SLEW, QUANTIZER.
  - **Processors:** FILTER (low, band and high pass), VCA, MIXER, DRIVE, DELAY.
  - **Utilities:** MATH (A × B + C).
  - **Outputs:** AUDIO OUT, to the rack's audio.
- **Wiring:** drag from an output (right side) to an input (left side). An input takes one wire; drag a wired input to move its wire or drop it to remove it. Double-click a wire to remove it. Drag the background to pan; the wheel zooms.
  - An input with no wire uses its own value, set in the properties of the selected module.
  - A knob or slider takes the range of the first input it is wired to (CUTOFF, ATTACK...), starting at that input's default. Untick *Automatic range* to set your own.
- **Signals:** audio is −1..1, gates 0 or 1, envelopes 0..1, pitch in octaves from C4. Jacks convert to the rack's volts: CV and audio ±5 V, pitch 1 V/oct, gates 5 V. Up to 8 jacks in and 8 out on the front, 4 audio ins and 4 audio outs on the back (line level, −1..1).
- **It plays while you build it:** the design is the device's settings, so changes are heard at once (play the keys). It is saved with the rack, its patches and sessions. MIDI learn and CV tracks work on its knobs, and the computer keyboard presses its buttons.
- **My synths:** *Save to My synths* keeps the design in this browser. ADD DEVICE › Custom adds it again, and the editor can load it into another custom synth or delete it.
- **Not yet:** polyphony (a custom synth plays one voice), undo, and sharing designs as files (they can be shared inside exported patches).

## Usage statistics

`app/analytics.js` sends anonymous events to [Umami](https://umami.is), a privacy-friendly analytics tool: no cookies, no personal data, and browsers with Do Not Track on are not counted. It does nothing until its two settings are filled in: `UMAMI_SRC` (the tracker script of your Umami, e.g. `https://umami.example.com/script.js`) and `UMAMI_ID` (the website id from the Umami dashboard). `UMAMI_DOMAINS` can limit it to the real site, so local copies are not counted.

Besides the page views of the home page and the app, it records:

- **Home page:** `launch` (which button: header, hero or bottom) and `see-devices`.
- **App:** `audio-on` (once a visit), `add-device` (the device), `load-patch` (a factory patch's name and group; user patches only as "user patch"), `export-patch` (file or clipboard), `import-patch`, `midi-on` (once, with the number of MIDI inputs), `song-play` (once a visit), `export-wav`, `midi-file` (its number of tracks) and `detach-sequencer`.

## The rack

The page is a rack. From the top:

1. The **AUDIO I/O** device.
2. The **KEYS** device.
3. The devices, in the order you choose. Synths and mixers take a full row. The half-width devices (dual LFO, compressor, reverb, delay, Universe, Hyper, Tape, Cosmos) sit side by side when two are next to each other.

A new rack has a Subharm, an LFO and a compressor, then a reverb and a delay, cabled as the default audio path.

One patch bay spans all of them: any output can be cabled to any input of any device. The front carries CV, gates and audio at ±5 V; the back carries the line-level audio between devices (see *Rear view*).

- **Add device** (toolbar) opens a panel with every device, grouped into synths, modulation, mixing and effects. Each card shows the device's picture, what it is, and whether it is full or half width, takes MIDI, is an insert effect, or is already in the rack.
  - Type in the search box to filter (Enter adds the first match); click a card to add that device at the bottom of the rack, which scrolls to it. `index.html#add` opens the panel.
  - The pictures are in `app/previews/`, made by `tools/make-previews.sh` (headless Chrome and ImageMagick). It opens `app/index.html?preview=<type>`, which draws only that device, then trims and saves the picture. Run it again after changing a panel; give it device types to redo only those.
  - You can have several of the same kind (`dram`, `dram2`, …). Reverbs are limited to 8, one per send / return slot of the audio engine.
  - A new LFO, compressor, reverb or delay arrives unpatched: patch its audio on the back (Tab).
  - A new Universe, Hyper, Tape or Cosmos goes in just before the speakers (between the last device and MAIN IN), so you hear it right away.
  - A synth with a MIDI IN (Subharm, Brother-32, Maze) gets the keys' MIDI through **MASTER MIDI** instead of a long cable across the rack (see *MIDI on the back*).
  - A new synth's audio goes to the first free mixer channel; with no mixer, to wherever the other synths go (or the compressor).
  - A new mixer takes over the synths that weren't on a mixer: they move onto its channels, and its MAIN L / R go where they went.
- Each synth has three buttons on its right wood cheek: **move up**, **move down** and **remove**. A full-width device moves past a whole row: a pair of half-width devices stays together. Removing asks first and unplugs that device's cables. When an effect (compressor, reverb, delay, Universe, Hyper, Tape) or a mixer is removed, what came into it is cabled on to where it went (IN L → OUT L, IN R → OUT R, mixer channels → MAIN), so the audio keeps reaching the speakers.
- The chevron on the top left folds a synth into a slim bar like the other devices. Its jacks stay on the bar, so cables stay connected.
- **Scale:** the rack fills the window width; more devices make it taller and it scrolls vertically.
  - Zoom **−** / **+** (toolbar) change the scale; the percentage button goes back to 100%. The zoom is remembered in the browser.
  - Zoomed past the width, the rack also scrolls sideways.
  - The mouse wheel scrolls when it's not over a knob; Shift + wheel scrolls sideways. You can also drag the scrollbars, or grab the rack by the wood sides of any row (or the empty space around it) and drag.
  - Dragging a cable near the edge of the window scrolls toward it.
- **Rear view:** **Tab** (or *Rear* in the toolbar) turns the rack around, as in Propellerhead Reason. The back of every device has its audio sockets, patched with cables like the front.
  - Sockets:
    - each synth's AUDIO OUT (mono, after its volume)
    - the mixer's inputs and outputs
    - COMPRESSOR IN / OUT L / R
    - DELAY and REVERB IN / OUT L / R
    - AUDIO I/O MAIN IN L / R (to the speakers) and INPUT L / R (the audio interface)
  - The default path is synths → compressor → delay → reverb → MAIN IN. Patches from before the rear sockets load with that path cabled.
  - An audio input adds up every cable plugged into it. Dragging from an input takes its newest cable. An unpatched IN R (compressor, delay, reverb, MAIN, mixer aux return) takes the IN L signal.
  - Nothing reaches the speakers unless something is patched into MAIN IN.
  - The reverbs run in native WebAudio nodes outside the audio processor, so their returns come back one render quantum (128 samples) later. You won't hear that on a reverb. The delay runs inside the processor.
  - Each device's label says what it does with the audio, e.g. "100% WET (DRY OFF)". Hovering a socket lists its connections.
  - The front's CV cables are hidden while the rear is shown, and the rear cables while the front is.
- **Space** starts every synth when none is running, otherwise stops them all.
- **Pads** (LLM DRAM, MYSTIC, LUNAR 21): hold the mouse button down and slide across them to play each pad you pass over.
- **MIDI learn** (Options): click a knob, fader or button, then move a MIDI controller or press a key / pad to map it.
  - **What it does:** a CC sets a knob or fader over its whole range. A CC (over 63) or a note presses a button and holds it while it lasts.
  - **Mapped MIDI:** it is no longer played as notes.
  - **The mappings:** listed in Options, each with a button to remove it, and saved with the rack. In learn mode every control is outlined and the mapped ones show their CC or note.
- **Keyboard control:** the device in the middle of the screen gets its buttons (not its knobs) on the computer keyboard. Scroll to choose the device.
  - **Keys:** 1–0, Q–P, A–', Z–/, [ ] - = \. The buttons used most (play, trigger, pads, steps, footswitches) get keys first, then mode and performance switches; configuration buttons (MIDI, DUMP, SAVE, the reset buttons under encoders) get none. Each button takes the free key nearest to where it is on the panel, so the keyboard is a map of the device. The priorities are each device's `key_prio` table.
  - **Held keys:** they hold the button down, so momentary buttons work (drone voices, pads, plates, footswitches). A lever switch moves to its next position.
  - **Which device:** a thin yellow line on its left shows the device the keys go to.
  - **Seeing the keys:** hold **Shift** to show each button's key on it, with the device outlined. A device with more buttons than keys has banks; **`** switches between them.
  - **QWERTY piano:** when it is on (keys device), the letters play notes instead.
- **Adding another synth:** register it from a pair of files in `devices/`:
  - The main thread file calls `WR.registerSynth(type, { title, worklet, jacks, defaults, size, draw, … })`. The fields are documented in `webrack.js`.
  - The worklet file sets `globalThis.WR_DSP[type]` to a class with `outs` / `ins` / `patched` arrays, plus `setSettings`, `message`, `beginBlock`, `tick` and `state`.
  - Add both files to `index.html`.

## Mixer

A 6 channel line mixer in the same panel style as the synths. Insert it from *Add device*.

- **Channel strips:**
  - The channel's source name, read from its rear cable.
  - AUX send knob (post fader).
  - PAN (a balance, so a centred channel keeps full level on both sides).
  - MUTE and SOLO.
  - A fader (0 dB at three quarters, up to +7.5 dB) with a level meter.
- **MASTER:** AUX SEND and AUX RETURN levels, the main fader, and L / R meters. An LED lights while any channel is soloed.
- **Front:** LEVEL CV 1–6 inputs act as a VCA on each channel (5 V = the fader's level), and a MIX output carries the mono mix at ±5 V, e.g. for the scope.
- **Back:** IN 1–6, AUX SEND, AUX RET L / R, MAIN L / R.
- **Reverb on an aux:** patch AUX SEND → REVERB IN L, REVERB OUT L / R → AUX RET L / R, and turn the reverb's **DRY** button off so it returns only the effect. The delay has the same DRY button. The *Mixer & Aux Reverb* factory patch is set up this way.

## Mount

An eight voice polyphonic synthesizer with three oscillators a voice and wavetables. PATCH, LFO 1 and 2, GLIDE, ARP, the MENU with its OLED, ANIMATE and MASTER are along the top; the three OSCILLATOR rows, MIXER, FILTER, the envelope sliders and EFFECTS are below. The buttons light up red, and LED columns show the stepped choices.

- **Patch:** the PATCH encoder and PATCH − / + step through 12 factory patches and 16 user slots. SAVE stores the sound in a user slot (the patch's own, or the first empty one). INITIALISE loads the init patch. COMPARE, held, plays the patch as saved. AUDITION plays middle C.
- **Oscillators** (three alike):
  - RANGE (16', 8', 4', 2'), COARSE (±1 octave), FINE (±100 cents).
  - WAVE: sine, triangle, sawtooth, pulse, or MORE, one of 8 wavetables (BRIGHT, VOCAL, ORGAN, ODD, PULSE SWEEP, DIGITAL, HOLLOW, SYNC), chosen in the OSC menu.
  - MOD ENV 2 and LFO 2 depths for the pitch.
  - SOURCE and SHAPE AMOUNT: the shape's manual amount, and its MOD ENV 1 and LFO 1 depths. SOURCE picks which one the knob sets, and the lit LEDs show the ones in use. For pulse, the shape is the width; for the wavetables, the position in the table.
- **LFO 1 and 2:** TYPE (triangle, saw, square, S&H), FADE TIME, RANGE (HIGH, LOW, SYNC to the arp tempo or MIDI clock), RATE. LFO 1 moves the shapes and the filter; LFO 2 moves the pitch.
- **Mixer:** OSC 1–3, RING 1*2, NOISE, VCA GAIN.
- **Filter:** SHAPE (LP, BP, HP), SLOPE (12 or 24 dB), FREQUENCY, RESONANCE, OVERDRIVE, KEY TRACKING, ENV DEPTH (from MOD ENV 1, the AMP ENV or both: SOURCE), LFO 1 DEPTH, OSC 3 FILTER MOD.
- **Envelopes:** four sliders for the AMP ENVELOPE, and four for the MOD ENVELOPES (SELECT: MOD 1 or MOD 2). Hold and velocity are in the ENV menu.
- **Glide** (TIME, ON) and **Arp** (ON, KEY LATCH, GATE). Its tempo, pattern (up, down, up/down, random, played), octaves and swing are in the ARP/CLOCK menu.
- **Effects:** DISTORTION, then DELAY (TIME, SYNC, FEEDBACK, LEVEL), REVERB (TIME, TYPE 1–3, LEVEL) and CHORUS (RATE, TYPE 1–3, LEVEL). BYPASS takes out the three time effects.
- **Menu:** the 4 × 20 OLED shows the patch, or the control being turned. Its nine buttons open PATCH, OSC, ENV, LFO, ARP/CLOCK, MOD, VOICE, FX and SETTINGS. Press a menu again (or PAGE ◀ ▶) for its next page, use a row button to pick a row, and turn the PARAMETER encoder (or VALUE − / +) to change it.
  - **MOD:** a 6 slot matrix. Sources: LFO 1–2, MOD ENV 1–2, AMP ENV, velocity, mod wheel, key, CV MOD IN, ANIMATE 1–2. Destinations: pitch (all or each oscillator), shape, filter, resonance, VCA, noise, pan, the LFO rates, distortion.
  - **VOICE:** POLY, MONO or MONO LEGATO; unison 2 or 4 with DETUNE; bend range, tune, amp velocity.
- **Animate:** ANIMATE 1 and 2, held, switch on their matrix slots (by default: the filter opens; set them in SETTINGS or the MOD menu). HOLD keeps them on.
- **Master:** VOLUME, and the **CV MOD IN** socket (±5 V), a source of the matrix. OUT L / OUT R are on the back.
- **Not here:** the mod and pitch wheels (MIDI pitch bend works), the 60 wavetables (8 here), LFOs 3 and 4, the tuning tables, and the pedals.

## Grid 32

A pattern sequencer on a 32 × 32 LED matrix, half a rack wide like the effects. Each column is a step and each row a note of the scale, the lowest at the bottom.

- **Drawing:** click a cell to light it, and drag to paint a line of them. A drag that starts on a lit cell clears instead. The rows of the scale's root are marked and named, and the playing step glows.
- **Notes:** SCALE (chromatic, major, minor, the modes, pentatonics, blues, harmonic minor, whole tone), ROOT and OCTAVE (the bottom row's note; OCTAVE 0 is C4).
- **Timing:** TEMPO (or **SYNC**: the rack's tempo), LENGTH (1–32 steps, a red line on the screen), DIVISION (1/4 to 1/32, and triplets), GATE, SWING.
- **Playing:** CHANCE drops notes at random. **TIE** makes cells side by side in a row one held note. DIRECTION plays forward, backward, ping-pong or at random.
- **Patterns:** A–H (a dot marks the ones with notes). The tools CLEAR, RANDOM, COPY / PASTE (between patterns and GRIDs) and ◀ ▶ ▼ ▲ move the pattern in time or pitch.
- **Outputs:**
  - **KEY / GATE**: the lowest note of each step (1 V/oct, 0 V = C4).
  - **KEY 2 / GATE 2**: the highest note.
  - **TRIG** on every new note, **CLOCK OUT** on every step, **EOC** at the start of each cycle.
- **Inputs:** CLOCK IN (a step a pulse), RESET, TRANSPOSE (1 V/oct) and RUN (plays while the gate is high). On the back, MIDI IN: it follows MIDI clock (start and stop too), and with **KBD** the keys transpose it (C4: as written).
- **MIDI:** with it on (CH 1–16: click again for the next channel, Shift+click turns it off), the notes also go into the rack's MIDI on that channel, as the keys device's would. Every note of a step plays, so the polyphonic synths (MYSTIC, PARA D) play its chords.

## Para D

A classic analog synthesizer design with four oscillators, played as one voice or as four (its type in saved racks is `pollyd`). Its panel: black with white print, black knobs with numbered scales, blue, orange and white rocker switches, and wooden sides. Below the panel, on the keyboard deck, are the wheels, the sequencer and the sockets of the back panel.

- **Controllers:**
  - TUNE, GLIDE (with its ON switch on the deck), MODULATION MIX.
  - The two modulation sources: OSC 4 or FILTER EG, and NOISE (or the MOD SOURCE socket) or LFO. The mod wheel sets how much reaches the oscillators (OSCILLATOR MODULATION) and the cutoff (FILTER MODULATION).
  - MODE: **MONO** (the four oscillators on the last note, legato), **UNISON** (the four, detuned and spread in stereo), **POLY** (an oscillator a note, four voices).
  - **AUTO DAMP** (POLY): a key let go stops its note at once. Off, it rings on until the contour ends.
- **Oscillator bank:** four oscillators, each with RANGE (LO, 32', 16', 8', 4', 2'), FREQUENCY (OSC 2–4, ±7 semitones) and WAVEFORM (triangle, tri / saw, saw, square, wide and narrow pulse; OSC 4 has a reverse saw instead of the tri / saw). **OSC 4 CONTROL** off takes OSC 4 off the keyboard: a drone or a modulation oscillator, and POLY has three voices.
- **Mixer:** the four oscillators, EXT IN (the EXT SIGNAL IN socket on the back, with its OVERLOAD light) and NOISE (white or pink), each with its volume and switch.
- **Modifiers:** the 24 dB ladder filter (CUTOFF, EMPHASIS, AMOUNT OF CONTOUR, low or high pass) and its contour (attack, decay, sustain). KEYBOARD CONTROL 1 and 2 track the keys by 1/3, 2/3 or (both) fully. Then the loudness contour. **DECAY** on: both contours release with their decay time; off, at once.
  - In POLY, the four voices share the filter and the contours (paraphonic). The contours start again when a key is pressed with none held.
- **Output:** VOLUME, the stereo bucket brigade **CHORUS** (I, II, or both: fast and shallow) and a **DISTORTION** (DISTORTION, TONE, LEVEL).
- **Deck:** the PITCH wheel (±2 semitones, springs back), the MOD wheel, the LFO (0.05–200 Hz, triangle or square) and TRANSPOSE (±1 octave).
- **Sequencer:** 8 patterns of up to 32 steps. Each step holds a note or a chord (up to 4), an accent, a glide (tied into the next step) and a ratchet (1–4 repeats).
  - **TEMPO**, GATE, SWING, and SYNC (follow the rack's tempo: its first device with a clock). It also follows MIDI clock (the song with SYNC on) or the SYNC IN socket (a step per pulse).
  - **PLAY / STOP**, **HOLD** (stay on the step), **RESET** (back to step 1), **PAGE** (steps 1–8, 9–16, 17–24, 25–32, shown by the LOCATION lights).
  - **PATTERN**, then a step button, picks a pattern. **SHIFT + ARP (SET END)**, then a step button, sets its length. **SHIFT + a step** clears it. A step button alone moves the record position there and plays the step.
  - **REC**, stopped: each chord (or note) played is a step, and HOLD / REST adds a rest. RESET / ACCENT accents the last step recorded, and RATCHET sets its repeats. REC while playing: the notes go onto the nearest step.
  - **ARP:** the keys held, in a 16th each. The step buttons choose its mode (UP, DOWN, INC, EXC, RANDOM, ORDER, UP 2 OCT, DOWN 2 OCT); HOLD keeps it playing after the keys are let go.
- **Sockets:** PITCH, V-TRIG, VELOCITY (with its level knob) and SYNC OUT; SYNC IN, EXT V-TRIG (starts the contours), LOUDNESS, FILTER, OSCILLATOR (1 V/oct) and MOD SOURCE. On the back: OUT L, OUT R and EXT SIGNAL IN.
- **Not here:** the 37 keys (play it from the keys device or MIDI), the after pressure output, and the sequencer's banks (one bank of 8 patterns).

## Mystic

A wave-scanning polyphonic synthesizer. It is the rack's only **polyphonic** synth: it plays every note of its MIDI channel on 8 voices (POLY), or one voice with legato and GLIDE (MONO). Play it from the keys, a MIDI device, the song sequencer or its own pads.

- **Panel:** laid out in sections. It has a matte black panel with red section titles, silver knobs, LED ring encoders, aluminium end cheeks, orange-lettered access buttons and white-lettered function buttons. The screens are white dot matrix OLEDs (a 5×7 font).
  - **CV / GATE:** inputs MOD 1 (cutoff), MOD 2 (WAVSCAN), PITCH, GATE and CLOCK; outputs PITCH, GATE, MOD 1 (ENV 1), MOD 2 (LFO 1), ENV 3 and CLOCK (a pulse on each arpeggiator step).
  - **ARPEGGIATOR:** MODE, OCTAVE, DIVISION (1/4 to 1/32) and SWING; ON, LATCH, TRIPLET and TAP TEMPO. SHIFT + ON (EDIT) shows its page.
  - **FILTER CONTROLS:** CUTOFF, RESONANCE and DRIVE / MORPH, on FILTER 1 or FILTER 2.
  - **MAIN SYSTEMS:**
    - **Patch encoder and ◀ ▶:** step through the built-in patches (INIT, Glass Pad, FM Bells, Mutant Arp, Supersaw Stack, Vowel Choir, Sub Bass, Comb Pluck). The left OLED shows the patch, or the module being edited (with its wave for the oscillators and mutants), or the BROWSE list.
    - **Buttons:** INIT resets the module shown (SHIFT: the whole patch) and RANDOM makes a random sound. HOME shows the 8 macros (SHIFT + HOME: PANIC).
  - **MASTER CONTROL:** 8 encoders around four OLED windows (a parameter's name and value above and below a line) edit the module picked.
    - **Buttons:** the white buttons reset their parameter. PAGE ▲ ▼ steps through the pages, EXIT goes home, and VOICE shows polyphony and glide. MOD MATRIX shows the modulation amounts.
  - **MODULE SELECT:** the signal flow. ENV 4–5, LFO 2–5, PRE-FX and POST-FX, which it does not have, are dimmed.
  - **24 pads:** play the notes of a scale (CHORDS mode: triads); roots are tinted. With SHIFT they do what is printed under them: OCT − / +, PAD MODE, KEY, and the 16 scales.
- **DELAY and REVERB** after the amp: DELAY has TIME, FEEDBACK, WET TONE and DRY/WET; REVERB has TIME, TONE and DRY/WET.
- **OSC 1 and OSC 2:** each scans through 8 single-cycle waves (SINE, TRIANGLE, SAW, SQUARE, PULSE, ORGAN, VOX, DIGITAL) with **WAVSCAN**, plus SEMI and CENT.
- **Mutators:** each of OSC 1 and OSC 2 goes through two (MUTANT 1–4 on the panel), each with a mode, RATIO, DEPTH and DRY/WET:
  - **FM-LIN:** phase modulation by a sine at RATIO × the oscillator.
  - **WAVSTACK:** three detuned copies; RATIO sets the spread.
  - **OSC SYNC:** a hard-synced slave up to RATIO × 2.
  - **PW-ASYM:** squeezes the first half of the wave.
  - **HARMONIC:** sweeps to the upper harmonics.
  - **PHAZDIST:** phase distortion.
- **OSC 3:** one wave, with SEMI and CENT.
- **Mixer:** OSC 1–3, RING MOD (OSC 1 × OSC 2) and NOISE.
- **FILTER 1:** LP LADDER 24, LP 12, BAND PASS, HIGH PASS, VOWEL (two formants, CUTOFF moves through A E I O U) or COMB. It has CUTOFF, RESONANCE (feedback for COMB), DRIVE, ENV 1 AMT and KEYTRACK.
- **FILTER 2:** a state-variable filter whose MORPH goes low pass → band pass → high pass, with CUTOFF and RESONANCE. **ROUTING** puts the filters in series or parallel.
- **Envelopes:**
  - **AMP ENV** (ADSR, with VELOCITY sensitivity).
  - **FILTER ENV (ENV 1)** (ADSR).
  - **MOD ENV (ENV 3)** (attack / decay), sent to the mutators' depth and to WAVSCAN.
- **LFO:** RATE, SHAPE (SINE, TRIANGLE, SAW, SQUARE, S&H), sent to PITCH, WAVSCAN, CUTOFF and MUTATORS.
- **ARPEGGIATOR:** UP, DOWN, UP/DOWN, RANDOM or AS PLAYED, with DIVISION (1/4 to 1/32), OCTAVES (1–4), GATE, LATCH and TEMPO. MIDI clock (or a cable in CLOCK) takes over from TEMPO.
- **Factory patches:** *Glass Pad*, *FM Bells* and *Mutant Arp*.
- **Simplified:** no mod matrix, assignable macros, ENV 4–5, LFO 2–5, pre / post effects, and patch saving inside the synth are replaced by the fixed routings and pages above; the waves are 8 instead of 219.
- **CPU:** it is the heaviest device. In tests, 8 voices took about 13% of a CPU core, up to 30% with all four mutators stacking.

## Universe

A granular / looper / delay effect pedal. It is a half-width effect with stereo IN / OUT on the back.

- **Panel:** a pedal: a light grey enclosure with navy print and black knobs with grey tops (the GREY CAP knob style), on a dark rack shelf. The CV jacks are on its top edge.
  - **Knobs:** ACTIVITY, SHAPE, FILTER, MIX on top; TIME (on its blue ¼×…8× scale), REPEATS, SPACE, LOOP LEVEL below. **SHIFT** switches them to the secondary controls printed in grey: MOD FREQ, RESONANCE, EFFECT VOLUME, LOOPER SPEED, MOD DEPTH, REVERB TIME and FADE TIME.
  - **SELECT:** sets whether TIME is the subdivision (SUBDIV light) or the tempo (TEMPO light).
  - **Preset knob:** turns through all 44 presets, among the four outlined groups whose LEDs pick an effect. FWD/REV plays the effect backwards. The four A–D lights show and pick the variation.
  - **PHRASE LOOPER box:** PRE-FX, LOOPER ONLY, BURST, QUANTIZE and REVERSE. Its centre button engages the looper.
  - **Footswitches:** TAP (with the looper: REC / PLAY / DUB, or with BURST, record while held), bypass, and HOLD (with the looper: STOP, held a second to ERASE).
- **How it works:** it keeps the last 11 seconds of its input. Each effect plays small pieces of it ("grains") back, at other speeds, looped, reversed or bit-crushed, timed by the tempo.
- **Effects:** 11 effects, each with variations A–D (44 presets). The display shows what the variation does. What each variation does, and what ACTIVITY and REPEATS do in each effect, are:

  | Effect | A | B | C | D | ACTIVITY |
  |---|---|---|---|---|---|
  | MOSAIC | normal + double speed | normal + half speed | all loops double speed | half, normal, double, 4× | loopers active (1–4) |
  | SEQ | filtered, shuffled random rhythms | normal / half speed, sustainer at full ACTIVITY | overlapping layers with filter sweeps | interlocking bit-crushed layers, crushed sub octave at full ACTIVITY | variation / layers |
  | GLIDE | half ↔ normal | double ↔ half | normal ↔ double | both directions at once | glide speed (SHAPE: the glide pattern) |
  | HAZE | short, diffuse, stretched | many random grains | normal + double speed grains | normal + half speed grains | density and spread |
  | TUNNEL | drone compresses and lengthens | sub octave drone, filter sweeps | resonant band passes | envelope-triggered, per note | depth (REPEATS: drone decay) |
  | STRUM | repeats the last note | overlapping copies: phasing | cascading chains of recent notes | chains + double speed grains | density |
  | BLOCKS | rearranged + bursts of notes | rearranged, pitch-shifted | soft: filtered, fading samples | pitch-shifted + bit-crushed | variation |
  | INTERRUPT | rearranged playing cuts in | pitch-shifted | filter sweeps and delay | bit-crushed, drastic | variation (REPEATS: how often) |
  | ARP | arpeggios of the last note | pitch-shifted speed pattern | a random filter each step | bit-crushed | arpeggio steps |
  | PATTERN | rhythm 1, classic delay | rhythm 2 | rhythm 3 | rhythm 4 | delay taps (REPEATS: feedback) |
  | WARP | envelope filter on each tap | resonant band pass on each tap | pitch-shifted taps | taps + double speed grains | delay taps (REPEATS: feedback) |

  STRUM, BLOCKS, INTERRUPT, ARP and TUNNEL D find the notes by detecting onsets in the input. **REV** plays the effect backwards (pressing the preset knob on the pedal).
- **Knobs:** ACTIVITY ("more or less" of the effect), REPEATS (elsewhere: how many times each sample echoes), SHAPE (the samples' envelope: percussive, flat, swell), FILTER (resonant low pass on the effect), MIX, TIME (¼×, ½×, 1×, 2×, 4×, 8× the tempo), SPACE (reverb) and LOOP LEVEL.
- **Secondary controls** (shift functions on the pedal) are the small knobs: MOD depth and RATE (pitch modulation), RES (filter resonance), VOL (effect volume), TEMPO, REVERB (ROOM, HALL, CATHEDRAL, AMBIENT WASH) and the looper SPEED (¼× to 4×).
- **Tempo:** SYNC follows the rack's tempo. TAP (or TEMPO) sets its own and turns SYNC off. MIDI clock or a cable in CLOCK takes over.
- **HOLD** freezes the buffer: the effect keeps playing what it holds while you play on top. **BYPASS** passes the dry signal.
- **Phrase looper** (up to 60 s): REC → PLAY → DUB (overdub) → PLAY, STOP and ERASE, plus REVERSE, PRE-FX (record the dry input), LOOPER ONLY (the effect off, only the loop and the dry signal), BURST, QUANTIZE (the loop trimmed to the nearest beat) and FADE TIME (STOP fades it out). The bar shows the loop's position.
- **CV:** CLOCK, HOLD (a gate toggles it), ACTIVITY and MIX (±5 V) in; CLOCK (a pulse each step) and ENV (input level) out.
- **Algorithms:** each effect is its own approximation. User presets are the rack's patches, and the loop is not saved with them.

## Reroute

A thin row of 8 channels to tidy up long cables. Each channel has two sockets on the front:

- **TO BACK** (an input): what comes in goes out of the channel's OUT on the back.
- **FROM BACK** (an output): what comes into the channel's IN on the back comes out here.

Patch a signal into one Reroute's front, cable its back to another Reroute's back (Tab), and take the signal out of that one's front, anywhere in the rack. It is listed under Utility in Add device.

## Cosmos

A multi-algorithm stereo reverb pedal. It is a half-width device with stereo IN / OUT on the back, with a 12 character, 14 segment display.

- **The 12 algorithms:**
  - **HALL:** 3 bands, with low and high decay multipliers and band levels.
  - **ROOM:** early reflections and late reverb, diffusion.
  - **PLATE:** damping and tone, distance.
  - **SPRING:** tension, 1–3 springs, resonance, an input tremolo.
  - **DUALVERB:** two reverbs, A / B mix.
  - **REVERSE:** reversed windows, a forward reverb, feedback, late dry.
  - **MODECHOVERB:** a reverb into an echo, with swept verb / flanger / chorus.
  - **BLACKHOLE:** huge; gravity or inverse gravity, feedback.
  - **MANGLEDVERB:** a reverb into EQ and distortion, wobble.
  - **TREMOLOVERB:** 9 tremolo shapes, mono or stereo.
  - **DYNAVERB:** a gate / expander / compressor / limiter / reverser on the reverb, its side chain from the input or the reverb.
  - **SHIMMER:** two pitch shifters in the feedback.
- **Knobs:** MIX, DECAY, SIZE, DELAY, LOW, HIGH, XNOB, YNOB, FXMIX and CONTOUR. What each does depends on the algorithm, as in the guide; the display names the parameter and its value as you turn it. A decay knob's top is [INF], then [FREEZE].
- **PRESET encoder:** turn it for the presets (30 factory presets). Click it for ALGORITHM mode, where turning it chooses an algorithm. EDITED lights when a knob was turned.
- **TEMPO:** the DELAY knobs in note values of the tempo tapped on TAP.
- **Footswitches:** ACTIVE (bypass with the tails ringing on), HOTSWITCH (freeze the reverb) and TAP.
- **Algorithms:** approximations of classic studio reverbs. The HotSwitch is a freeze here, not a programmable set of knob positions. No expression pedal or MIDI.

## Hyper

A lo-fi distortion and bit crusher (half width, stereo IN / OUT on the back), for the warm, crunchy, slightly broken sound of indie game soundtracks. The signal goes through, in order:

- **WOBBLE:** tape wow (0.55 Hz) and flutter (6.3 Hz), a short delay whose length moves, so the pitch bends.
- **DRIVE** (up to +36 dB) into a **TYPE** of saturation: TAPE (soft), TUBE (asymmetric, even harmonics), FUZZ (hard clipping) or FOLD (the wave folds back on itself). The level is compensated as DRIVE goes up.
- **TONE:** a low pass after the distortion.
- **RATE:** sample rate reduction, 100 Hz to 48 kHz, without anti-aliasing (the aliasing is part of the sound).
- **BITS:** 16 down to 1, continuous.
- **MIX** with the dry signal, **OUT** level and **ON** (off: dry through).
- **Starting points:** DRIFTER (warm, wobbly, slightly crushed), 8-BIT (chiptune grit), BROKEN (a dying console) and FOLDED.
- **CV:** DRIVE (±5 V = the whole range), BITS (1 V = 3 bits fewer), RATE (1 V/oct).

These settings are my reading of that sound, not a recipe from the artist. His music gets much of it from the synths and samples themselves; Hyper adds the grit and the wobble.

## Tape

A tape machine (half width, stereo IN / OUT on the back) for hazy, wobbly, nostalgic sound: the warm, slightly seasick pitch and faded highs of an old cassette played back on a tired deck. A cassette on the panel turns with the tape. The signal goes through, in order:

- **The tape:** a delay line read at a moving point. **WOW** is a slow, uneven drift (a sine plus a wandering random, the two sides drifting a little apart); **FLUTTER** is fast. Together they bend the pitch from a few cents to seasick.
- **SATURATE:** tape compression, a little asymmetric, then the head bump (a lift in the low end).
- **TONE:** the tape's high cut (12 dB/oct).
- **AGE:** dropouts: now and then the level dips and the sound darkens; an older tape is also duller overall.
- **HISS**, then **MIX** with the dry signal, **OUTPUT** and **ON** (off: dry through).
- **MACHINE:** CASSETTE (darker, a slow uneven wow), REEL (cleaner, a big low end, faster flutter) or VHS (warbly, brighter hiss).
- **STOP:** hold it and the tape winds down to a halt, its pitch falling, in **STOP TIME** (0.05 to 4 s); let go and it spins up again.
- **Starting points:** HAZY (a warm old cassette), WARPED (a tape left in the sun), VHS (a worn video tape) and STUDIO (a good reel to reel).
- **CV:** WOW (±5 V = the whole range), TONE (1 V/oct), STOP (a gate: high holds it).

Put it after a pad or a slow arpeggio, with WOW around 0.4 and TONE near 5 kHz, and add a reverb after it.

## LLM Dram

An early 80s style sampling drum machine. Its panel: charcoal with orange outlined sections, grey rectangular buttons, black skirted knobs, 16 pads and slider banks.

- **Sounds:** 24 pad sounds on 16 mixer channels.
  - **Bottom row:** SIDESTICK, SNARE 1–3, BASS 1–2, CRASH, and PERCUSSION, which switches the top row (as does BANK).
  - **Top row:** HI HAT 1, 2 and OPEN, TOMS HI / MID / LO and RIDE 1–2; or, with PERCUSSION on, CABASA 1–2, TAMBOURINE 1–2, CONGAS HI / LO, COWBELL and CLAPS.
  - **CLICK:** the 16th channel, a metronome while recording.
  - **The samples:** they are synthesized in code at start, at 28 kHz, and stored as 8-bit companded and 12-bit samples played back without interpolation, for the grain of the early sampling drum machines. 32 samples in all; SAMP gives any pad sound any of them.
- **Mixer:** PAN (top sliders) and LEVEL (bottom faders) per channel, and VOICE SELECT. Press a voice again to cycle its sounds (SNARE 1 / 2 / 3, …). MUTE and SOLO act on the selected voice.
- **Display:** the selected voice's BIT (8 / 12), SAMP, DIST, PLAY (forward / reverse), TUNE, LEV, STRT, LEN and LOOP. Move with the arrows, change with the encoder, the wheel or NO- / YES+. MENU switches to the pattern's PATT, LEN, SWNG, BPM, QUAN, SYNC, FILL, SREP and PERC.
- **TUNE:** SNARE, TOMS HI / MID / LO and CONGAS HI / LO (±12 semitones), and HI HAT DECAY. A closed hi hat cuts an open one.
- **WAVE DESIGNER and ANALOG FILTER:** an FX bus for the voices with SEND on. ATTACK and SUSTAIN shape the transients; the filter is a 4-pole low pass (or HPF), with CUTOFF, RESONANCE and ON.
- **VOLUME:** INPUT (the rear IN into the mix; REC lights with signal) and MASTER.
- **Sequencer:** 16 patterns of up to 64 steps.
  - **Modes:** PADS (play, and record while REC and playing, quantized with QUAN), STEP (the pads are the 16 steps of a page for the selected sound; ◀◀ ▶▶ change page), PATT (pick the pattern; it changes at the end of the bar) and SONG (plays the patterns that have hits, in turn).
  - **Functions:** LENGTH (16 / 32 / 48 / 64), RAND, COPY (then a pad in PATT to paste), ERASE (the selected sound; twice: the whole pattern), SYNC, STEP REPEAT (loops the current beat), NOTE REPEAT (held pads repeat every 1/16), AUTO FILL (a snare / tom fill every 4 bars) and TRIGGER (the pads play the selected sound in 16 pitches).
  - **Tempo:** RATE and TAP, or SYNC (MIDI clock, else the rack's tempo). Swing from 50 to 75%.
- **On the back:** OUT L / R, IN, MIDI IN (notes play the pads on the General MIDI drum map, and are recorded) and 16 individual outputs. A cabled individual output takes its channel out of the mix.
- **Not here:** MIDI, USB and DUMP only show a message; there is no sampling from the input.

## Lunar 21

An ambient drone machine. Its panel: cream with black print, black, red and blue knobs (the FLAT knob style), mini jacks, the touch plates and the drone buttons.

- **Drone voices 1, 2, 6 and 7:** 5 reed-like oscillators each.
  - **Per oscillator:** MUTE, TUNE (−12 to +24 semitones, fine enough for microtonal chords) and MOD (a slow drift of its own, for beating).
  - **Per voice:** VOLT (the pitch), ATT / RLS, a CV (1 V/oct) and a GATE input, and an ENV output.
  - **Playing them:** each is played by its button in DRONE VOICES or its round pad. **HOLD** makes them latch.
- **Voices 3 and 8:** a square oscillator (PITCH, RANGE) with a sub DIVIDER and NOISE.
  - **Modulator:** a triangle (rate, ×10) doing FM and / or AM, with its own MOD OUT (0–12 V).
  - **S&H:** IN (else the noise) sampled on CLOCK (else the modulator).
- **Voices 4 and 5 (VCO 1 / 2):** OCTAVE (LO, 64' to 1'), TUNE, FINE, SHAPE (sine → triangle → saw → square), PW and FM, with V/OCT, FM, SHAPE (and SYNC on VCO 2) inputs.
  - **Playing them:** from the touch plates or MIDI, through **EG VCA 1 / 2** (ADSR; HOLD keeps them open, LOOP repeats attack / decay).
- **Touch plates:** the 12 notes of an octave, with OCTAVE ▽ △ and a HOLD button. The display switches SINGLE (both VCOs on the last note) or TWIN (the last two notes). They output V/OCT and GATE ×2.
- **Mixer:** PAN and VOL for the 8 voices, EXT.AUDIO and PREAMP.
- **FILTER L / R:** 12 dB, aggressive: driven, and resonant up to whistling. They have CV FREQ with its amount, and LINK.
- **DUAL EFFECTOR:** a cartridge on each side, with X / Y / Z, CV X / Y / Z, BLEND and MASTER VOLUME.
  - **Cartridges:** 10, with 3 programs each: CATHEDRAL, TIME, MAGIC, INFINITY, VIBROTREM, VIBE, PITCH SHIFTER, STRING RINGER, DIGITAL and FILTER.
  - **Editing:** click the slot for the next cartridge. The L/R switch picks the side that the knobs and the program buttons edit.
  - **What's different:** the programs are my own versions of what the chart names. SYNTEX-1 and GENERATOR are left out.
- **CV sources:** LFO A / B (WAVE triangle → square, RATE, 0–10 V), the **JOYSTICK** (drag it; X / Y with offsets), the **5 STEP SEQUENCER** (PULSER clock or CLOCK in, STAGES 4 / 5, a gate switch per step, CV and GATE out), the **PREAMP** and the **ENVELOPE FOLLOWER** (ENVELOPE and GATE out).
- **On the back:** OUT L / R (cabled into the rack in stereo when it is added), DRY OUT 4 / 5, EXT AUDIO and PREAMP IN. The front EXT. SOURCE jack takes a CV-level signal into the preamp.
- **CPU:** in tests, about 8% of a core idle and 19% with every voice and both effects running. Silent effects sleep after 4 seconds.

## Maze

A generative semi-modular synthesizer with two parallel bit-shift sequencers.

- **Oscillators:**
  - A sine VCO (20 Hz–5 kHz) and a triangle MOD VCO (0.05 Hz–1.3 kHz).
  - Each has an EG1 AMT (bipolar) and a sequencer amount: SEQ1 for the VCO, SEQ2 for the MOD VCO. At full (QTZ) the sequence plays in tune at 1 V/oct.
  - M VCO FM AMT frequency-modulates the VCO with the MOD VCO.
- **Mixer:** saturating, with VCO, MOD VCO, RING MOD and NOISE levels (each overdrives above 12 o'clock) and NOISE TONE.
- **Two voice paths:**
  - **VCW**, a wavefolder: FOLD, BIAS, EG1/CV AMT and a SEQ1 amount.
  - **VCF**, a 2-pole state-variable filter: CUTOFF, RESONANCE, FILTER TYPE (low pass morphing into band pass), EG1/CV AMT and a SEQ2 amount.
  - The ORDER switch puts them in parallel or in series either way. Each path has its own VCA, opened by EG2, and **BLEND** crossfades between them.
- **Envelopes:** two decay-only envelopes, EG1 DECAY and EG2 (VCA) DECAY. **EG TRIG MIX** balances which sequencer's triggers fire them, and how strongly. Also VOLUME, and the U MIX utility mixer (U MIX 1 LVL).
- **Generative sequencers:** two sequencers of 8 bits each.
  - Each bit is on or off. Flipping a bit on stores a random voltage in it, and a bit that is on sends a trigger when the play head reaches it.
  - Per sequencer: LENGTH (steps down from 8 to 1, then back to 8), BIT FLIP (the bit under the write head; you can also click any bit), BIT SHIFT (rotates the bits), **CORRUPT** and **CV RANGE**.
  - CORRUPT left of 12 o'clock rewrites the voltages as the head passes but keeps the rhythm; right of 12 o'clock it also flips bits.
  - CV RANGE scales the voltages before the **quantizer** (unquantized, chromatic, major, pentatonic, the minor scales, whole tone, Hirajoshi and others).
  - **CHAIN SEQ** joins the two into one sequence of up to 16 steps.
  - **BUFFER:** hold it for a second to save the pattern, short-press to bring it back. The live pattern, mutations included, is saved with the patch.
  - Transport: TEMPO, RUN / STOP, RESET, ADVANCE (while stopped) and TRIGGER.
- **32-point patch bay:**
  - 20 inputs: VCO 1V/OCT, M VCO SYNC, M VCO 1V/OCT, BLEND, VCW IN, VCW FOLD, VCW VCA CV, VCF IN, CUTOFF, VCF VCA CV, U MIX 1 (RING), U MIX 2, EG2 TRIG, CLOCK 1, BIT FLIP 1, CLOCK 2, BIT FLIP 2, MIDI, TRIGGER, RESET.
  - 12 outputs: VCA, M VCO, NOISE, MIXER, EG1, EG2, U MIX 1+2, SEQ1 CV, SEQ1 TRIG, SEQ2 CV, SEQ2 TRIG, CLOCK.
  - Normalled connections: EG1 into VCW FOLD and CUTOFF, EG2 into both VCA CVs, the mixer into VCW IN and VCF IN, the ring modulation into U MIX 1, the internal clock into CLOCK 1 and CLOCK 1 into CLOCK 2.
- **MIDI** (cabled from the keys when it's added): notes transpose the VCO and fire the envelopes; MIDI clock and start / stop drive the sequencers.
- **Factory patches:** *Alien Bells* and *Folded Bongos*.

## Brother-32

A semi-modular mono synthesizer with a 32 step sequencer.

- **VCO:**
  - FREQUENCY (C1–C7; the sequence and the keys add to it, C4 = 0 V) and PULSE WIDTH.
  - VCO MOD AMOUNT, with switches for its source (EG / LFO) and destination (FREQ / PW). The VCO MOD input replaces the source.
  - VCO WAVE (saw / pulse) picks what goes to the mixer; both waves are always on the patch bay.
- **Mixer:** VCO / NOISE MIX. EXT AUDIO replaces the noise.
- **Filter:** a ladder filter with a HIGH / LOW switch, CUTOFF, RESONANCE, and a bipolar VCF MOD AMOUNT from the EG or the LFO.
- **Envelope:** ATTACK, DECAY and a SUSTAIN switch (on: holds while the gate is high, then decays).
- **VCA:** VCA MODE (EG / ON for drones) and VOLUME. Accented steps are louder and a bit brighter.
- **LFO and the rest:** LFO RATE with a triangle / square switch, GLIDE, and the VC MIX crossfader between MIX 1 (normalled to +5 V) and MIX 2 (normalled to 0 V).
- **ASSIGN output:** sends the accent gates, a clock pulse per step, or a ramp over the sequence.
- **Sequencer:** 32 steps, each with a note, rest, accent and glide. LENGTH (1–32), TEMPO (a step per 16th), GATE LENGTH, RUN / STOP, RESET and NEXT STEP.
  - The real unit edits steps through button modes. Here every step is a cell of the step grid: click to select it, click again for a rest.
  - REST, ACCENT and GLIDE change the selected step.
  - The 13-key keyboard (OCT − / +) plays the synth; with **REC** on, it writes the selected step and moves to the next.
  - While the sequence runs, holding a key (or a MIDI note) transposes it, relative to C3.
- **32-point patch bay** (4 × 8):
  - 18 inputs: EXT AUDIO, MIX CV, VCA CV, VCF CUTOFF, VCF RES, VCO 1V/OCT, VCO LIN FM, VCO MOD, LFO RATE, MIX 1, MIX 2, VC MIX CTRL, MULT, GATE, TEMPO (a clock that replaces the internal one), RUN/STOP, RESET, HOLD.
  - 14 outputs: VCA, NOISE, VCF, VCO SAW, VCO PULSE, LFO TRI, LFO SQ, VC MIX, MULT 1, MULT 2, ASSIGN, EG, KB, GATE.
- **MIDI IN** (on the back, MASTER MIDI on when the Brother-32 is added): notes, pitch bend, and clock (24 ppqn to 16ths) with start / stop.
- **Factory patches:** *Acid Line*, *PWM Drift* and, in RACK, *Brother & Drummer* (the Brother-32's ASSIGN clock drives the DRAM).

## DRAM

An analog percussion synthesizer with an 8 step sequencer.

- **Two VCOs**, 10 Hz to 10 kHz, each with a triangle / square switch.
  - A shared decay-only **VCO EG**, set by VCO DECAY. It goes to each VCO through a bipolar EG AMOUNT (±5 octaves).
  - **1→2 FM AMOUNT** and **HARD SYNC** (VCO 2 to VCO 1).
- **Mixer:** VCO 1, VCO 2 and white noise. Patching EXT AUDIO replaces the noise.
- **Filter:** a ladder filter with a **LP / HP** switch.
  - CUTOFF, RESONANCE, VCF DECAY, and a bipolar VCF EG AMOUNT.
  - NOISE / VCF MOD modulates the cutoff with the noise, or with the VCF MOD input when it's patched.
- **VCA:** a VCA EG with a **FAST / SLOW** attack switch, VCA DECAY, and VOLUME.
- **8-step sequencer** with a PITCH and a VELOCITY knob per step.
  - PITCH is ±5 V at 1 V/oct. SEQ PITCH MOD sends it to VCO 1 & 2, to VCO 2 only, or to neither.
  - VELOCITY (0 to 5 V) scales the VCA and VCF envelopes, so a step at zero velocity is a rest.
  - TEMPO goes from 10 to 10,000 BPM, one step per 16th.
  - RUN / STOP, ADVANCE (steps and triggers) and TRIGGER (plays the current step).
- **24-point patch bay**, 15 inputs and 9 outputs.
  - Inputs: TRIGGER, VCA CV, VELOCITY, VCA DECAY, EXT AUDIO, VCF DECAY, NOISE LEVEL, VCO DECAY, VCF MOD, VCO 1 CV, 1→2 FM AMT, VCO 2 CV, TEMPO, RUN / STOP, ADV / CLOCK.
  - Outputs: VCA, VCA EG, VCF EG, VCO EG, VCO 1, VCO 2, TRIGGER, VELOCITY, PITCH.
  - A cable in ADV / CLOCK replaces the internal clock: each pulse advances a step. To sync the DRAM to the Subharm, patch the Subharm's CLOCK output there.
  - A cable in VCA CV replaces the envelope on the VCA.
  - The decay inputs stretch their decay time by one octave of time per volt.
- It has no MIDI. Play it from the keys device with cables, e.g. KEY 1 → VCO 1 CV and TRIG → TRIGGER.

## Subharm

- **2 VCOs, each with 2 subharmonics.** VCO FREQ spans C4 to C8. The subs are true frequency dividers (÷1 fully clockwise to ÷16) of their VCO, so they stay phase-locked. The 3-position wave switch sets all square (up), pulse VCO with saw subs and SUB 1 normalled to the PWM input (middle), or all saw (down). Oscillators are band-limited (polyBLEP) and have a little analog drift.
- **Mixer** with 6 levels, driving a **4-pole ladder low-pass filter** with input saturation. The filter self-oscillates at the top of the resonance range.
- **VCF and VCA attack/decay envelopes.** VCF EG AMT is bipolar. The EG button locks both envelopes at maximum (it blinks while held), for drones.
- **2 four-step sequencers.** SEQ OCT sets the step range to ±1, ±2 or ±5 octaves. SEQ ASSIGN routes each sequencer to its VCO pitch and/or the division of either sub.
- **Quantizer**: 12-ET, 8-ET, 12-JI, 8-JI or off, applied to the VCO pitch (knob + sequencer + MIDI + the patched VCO 1 / VCO 2 pitch inputs).
- **Polyrhythm**: the tempo clock (20 to 3000 BPM) feeds 4 rhythm dividers (÷1 to ÷16). Each divider can clock SEQ 1 and/or SEQ 2. Coincident pulses count once, and every sequencer step fires both envelopes.
- **PLAY, RESET, TRIGGER and NEXT.** TRIGGER holds the envelopes while pressed.
- **32-point patch bay.** Outputs have inverted labels. Inputs accept one cable each; outputs can feed several. Audio-rate patching works, e.g. VCO 2 into VCO 1 for FM.

Patch bay signal levels: audio ±5 V, envelopes 0 to 5 V, SEQ outputs 1 V/oct, clock/trigger outputs 5 ms pulses at 5 V. Pitch and cutoff inputs track 1 V/oct.

## Audio I/O device

The thin row at the top. Its settings are remembered by the browser, not saved in patches.

- **OUTPUT** ◀ / ▶ chooses the audio output device. This needs `AudioContext.setSinkId` (Chrome, Edge); other browsers play on the system default.
- **INPUT** ◀ / ▶ chooses the input device (microphone or line in); **ON** opens it. The browser asks for permission the first time.
  - Echo cancellation, noise suppression and auto gain are turned off.
  - Device names appear once access has been granted.
- **GAIN** sets the input level: unity at the middle, up to +12 dB.
- **IN L / IN R** jacks carry the input as ±5 V signals, so it can be patched anywhere. For example: DRAM EXT AUDIO to filter the microphone, the scope, the compressor's sidechain, or a pitch / cutoff input for audio-rate modulation.
- **MASTER** is the volume of everything (after the reverb): 0 dB at the default position, up to +3.9 dB. The L / R meters show the peak level after it.

## Song sequencer

The bar at the bottom of the page: **▲ SEQUENCER** raises it into a multitrack sequencer. Drag its top edge to resize it.

- **Transport:** ▶ PLAY / ■ STOP, **● REC**, **LOOP**, the position (bar.beat), **BPM** (− / +, Shift for steps of 1), **BARS** (the loop length, 1–64), **GRID** (1/4 to 1/32) and **SYNC**.
  - SYNC sends MIDI clock and start / stop with the song, so the synths' own sequencers follow it.
- **Tracks** (up to 16), on the left: each plays on its own MIDI **CH**annel (click to change, Shift for the previous), with **M**ute and **S**olo. Double-click a name to rename it in place (Enter keeps it, Escape cancels).
  - **⋮ (options):** COPY the track, PASTE the copy below it, DELETE it, MOVE UP or MOVE DOWN.
  - **+ TRACK** adds one on the next free channel; **CLEAR** empties the selected track.
  - **LOAD MIDI FILE** replaces the song with a standard MIDI file (.mid). Every channel of every track becomes a track (up to 16), on its channel; the first tempo sets the BPM, and the loop gets as many bars as the notes need (up to 64).
  - Set the synths' **CH** switches on the back (Tab) to choose which synth plays which track. A synth on OMNI plays them all.
- **Piano roll** of the selected track, with the other tracks' notes faint behind it.
  - Click empty space to add a note, as long as the grid. Drag a note's end to change its length (the cursor changes over the end).
  - **Selecting:** drag on empty space to select the notes in a rectangle; Shift+click adds or removes a note, Shift+drag adds a rectangle. Ctrl+A selects them all, Escape none.
  - Dragging a selected note moves the whole selection, and dragging the end of one changes the length of all of them.
  - Right-click or Delete removes the note, or the selection it is in.
  - The keys on the left play the note. The mouse wheel scrolls the notes.
- **Recording:** with REC on while playing, notes from the on-screen keys, the QWERTY keys and a MIDI device go into the selected track, snapped to the grid.
- **Timing:** notes are scheduled ahead into the audio engine with their sample position, so they don't depend on the page's frame rate.
- **⇱ WINDOW** detaches the sequencer into a window of its own, for a second screen. The rack gets the room back.
  - The window fills with the tracks and the piano roll. Keys pressed there still play the synths and edit the notes.
  - Closing it, or **⇲ ATTACH**, puts the sequencer back in the main window. Closing the main window closes it too.
  - The browser must allow pop-ups for the page.
- **CV tracks** record knob movements over the song:
  - **Recording:** with REC on while the song plays, turn any knob or fader in the rack. Its movements go into a CV track for that knob, made then if it has none. Turning it again later re-records just that stretch.
  - **Playback:** while the song plays, each CV track turns its knob, unless your hand is on it. **M** mutes a CV track, leaving the knob alone.
  - **+ CV:** click it, then turn a knob, to make an empty CV track for that knob to draw in.
  - **Editing:** select a CV track to see its curve over the loop. Click to add a point, drag a point to move it, Shift+drag to draw, right-click to delete.
  - CV tracks move the knobs on the screen, so a collapsed device, or the rear view (Tab), catches up when it is shown again.
- **EXPORT WAV** plays the song once from the start and records the rack's output, then keeps recording until the sound has died away (at most 10 s more). It saves a stereo 16-bit WAV file at the audio device's sample rate.
  - It records in real time, so it takes as long as the song. Click it again to stop early and save what is there.
  - The status line shows the length and the peak level. If the recording clipped, it says so; turn MASTER down.
- **Saved with the patch.** A new rack starts with a short arpeggio on channel 1.

## MIDI on the back

MIDI sockets are on the back of the devices (Tab): the keys' **MIDI OUT**, and a **MIDI IN** on the Subharm, Brother-32 and Maze.

- **Cable or MASTER MIDI:** a MIDI cable from MIDI OUT to a MIDI IN carries the notes. Or switch on **MASTER MIDI** under the MIDI IN to get them without a cable; new synths start that way. Switching it on unplugs a MIDI IN cable, and patching a cable switches it off.
- **Channels:** the channel selector under each MIDI IN, a red 7-segment display with ▲ / ▼ buttons (or the mouse wheel over the display), picks the channel the synth listens to: `--` for OMNI (every channel, the default) or 01–16.
- **Keys:** the same selector under the keys' MIDI OUT sets the channel of the on-screen and QWERTY keys. Notes from a MIDI device keep their own channel.
- **Engine:** every channel has its own note stack with last-note priority, so two synths on different channels play their own lines. Clock and start / stop go to every synth the MIDI reaches.

## Keys device and MIDI

The **KEYS** row above the synth is where notes come in:

- **MIDI IN**: *ENABLE* asks the browser for MIDI access; ◀ / ▶ pick one input or all of them. The LCD shows the device and the notes being held.
- **Keyboard**: a 3-octave on-screen keyboard (drag across it to glide), *OCT −* / *OCT +*, and *QWERTY*, which turns the computer keyboard into a piano: `A S D F G H J K L ; '` are white keys, `W E T Y U O P` black keys, `Z` / `X` shift the octave. While QWERTY is on, `T` plays F# instead of triggering.
- **Split**: *SPLIT* divides the keyboard at the marker above the keys (drag it). The lower zone drives KEY 1 / GATE 1, the upper zone KEY 2 / GATE 2. Without split both pairs carry all notes.
- **Outputs**: GATE 1 / 2 (5 V while a key of that zone is held), KEY 1 / 2 (1 V/oct, C4 = 0 V, last-note priority), TRIG (a 5 ms pulse on every key press, whatever the split), and MIDI OUT on the back. All notes from every source (MIDI device, on-screen keys, QWERTY, the song) go to MIDI OUT.

MIDI reaches the synth only through its MIDI IN jack, so the MIDI output is cabled to it by default (patches from before the keys device get that cable automatically). Unplug it to use the keyboard only as CV, e.g. KEY 1 → VCO 1 and GATE 1 → TRIGGER. What the synth does with MIDI:

- **Notes** transpose both VCOs relative to C4, with last-note priority. They retrigger both envelopes and hold them while the key is down.
- **Pitch bend**: ±2 semitones.
- **Clock**: 24 ppqn MIDI clock drives the master clock in 16ths. While clock messages are arriving, they replace the TEMPO knob. A cable in the CLOCK input takes priority over both.
- **Start / Stop / Continue** run, stop and resume the sequencer.

## Extras

- **Scala scales.** Type a scale name in the toolbar to add a fifth quantize mode, SCALA. It uses the selected `.scl` file, rooted at C.
- **Sessions** (toolbar): your work is saved automatically in this browser, a few seconds after every change and when you leave the page.
  - A session is the whole rack (devices, settings, cables) and the song.
  - Each visit reopens the last session; turn off *Reopen the last session at start* in the panel to start each visit with a fresh rack in a new session.
  - The panel lists the sessions, newest first, with their devices and song, to **Load**, rename (✎) or delete (×). **New session** starts a fresh rack and keeps the current one.
  - The 30 most recent are kept; when the browser's storage is full, the oldest go first.
- **Patches**: a patch is the whole rack, meaning its synths, all their settings, the shared devices and the cables.
  - The toolbar menu has 41 factory patches (in `data/patches.json`), grouped as SUBHARM, DRAM, BROTHER-32, MAZE, MYSTIC, LLM DRAM, LUNAR 21, PARA D, MOUNT (at least three for every synth) and RACK (several devices together), plus your own.
  - *Save as…* stores the rack under a name in the browser.
  - *Export* / *Import* write and read `.json` files, so patches can be shared or added to the repo.
  - Patches saved before the rack existed load as a rack with one Subharm.
  - A patch only needs the fields that differ from the defaults; anything missing or invalid falls back to the default.
- **Post FX row** at the bottom, on the master output after the compressor:
  - **Reverb** (send): MIX, PRE-DELAY, TONE (lowpass on the tail), ON and ROOM with 12 spaces from short to long: drum rooms, cave, salon, a plate generated in code, opera hall, silo, two big halls, parking garage, echo hall and a church. Impulses load the first time their room is selected.
  - **Delay**: TIME (free 10 ms – 2 s, or tempo divisions 1/16 – 1/1 with SYNC), FEEDBACK, TONE (lowpass in the feedback), MIX, PING-PONG and ON. Off by default.
- **Collapsible devices**: the chevron on the top left corner of the KEYS, LFO, compressor, reverb and delay devices folds the whole row (both devices sharing it) into slim bars; their jacks stay on the bar as small sockets, so cables stay connected.
- **Device row** below the synth, in the same style, patchable from and to the main patch bay:
  - **Dual LFO**: per LFO RATE (0.01–100 Hz), SHAPE (sine, triangle, saw, ramp, square, sample & hold), LEVEL (an attenuator, since the Subharm has none), RATE CV inputs (1 V/oct) and SYNC inputs (a gate restarts the cycle). Outputs are ±5 V.
  - **Compressor** on the master output, before the reverb: THRESHOLD, RATIO, ATTACK, RELEASE, MAKEUP, MIX (parallel), ON, a gain reduction meter, a SIDECHAIN input (the detector rectifies, so use envelopes or gates for ducking) and a GR output (gain reduction as CV, 4 dB per volt). A small green CRT oscilloscope under its jacks shows the signal patched into its SCOPE input (±5 V full scale) or, with nothing patched, the master output. Click the screen to cycle the time base (5 ms, 20 ms, 100 ms: triggered; 500 ms, 2 s: scrolling roll mode).
- **Options** (toolbar) opens a small panel:
  - **Layout:** Hardware or Classic, for the Subharm (see below).
  - **Show wires:** off hides the patch cables and leaves only their coloured plugs on the jacks.
  - **Mouse wheel turns the knob under the cursor:** off, the wheel always scrolls the rack, so scrolling over the panels can't move a knob or fader by accident. Ctrl (Cmd on a Mac) + wheel still turns the knob or fader under the cursor.
  - The choices are remembered in the browser.
- **Randomize** (toolbar) rolls a new playable sound on every synth and the LFOs. It keeps the volumes, compressor, reverb, cables and the loaded scale.
- **Two panel layouts** for the Subharm, switched in *Options*. *Hardware* lays the controls out as a full front panel; *Classic* is the first, compact layout of this project, grouped by section. The rest of the rack follows its width.

## Controls

- Drag knobs vertically; hold Shift for fine control. The mouse wheel also works, and double-clicking a knob resets it.
- Drag from a jack to patch. Drag a cable off an input to move or remove it. Double-click or right-click a jack to unplug it.
- Keys: `Space` play/stop (every synth); the other keys press the buttons of the device in the middle of the screen (hold `Shift` to see them, `` ` `` switches banks).

## Design notes

Some choices made in the sound engines and panels:

- Mount: what SHAPE does to the sine, triangle and saw, the 8 wavetables, the filter and envelope curves, the effects' algorithms, and a 6 slot matrix
- Para D: the curves and ranges of the knobs, the modulation depths, how UNISON spreads the oscillators, the chorus and distortion circuits, the arpeggiator modes, and the layout of the sequencer's buttons on the deck
- Maze: how much CORRUPT changes per pass, the ranges of the amounts, the wavefolder and filter curves, the scales, how notes are handled over MIDI, and the panel layout
- Brother-32: the placement of the patch bay jacks within the 4 × 8 grid, the ranges of the knobs, the ASSIGN choices, and the step editing (a step grid)
- DRAM: the order of the patch bay jacks within their rows, the envelope curves and ranges, the FM depth and the HP filter (a 4-pole high pass from the same ladder)
- how strongly the SUB and RHYTHM CV inputs (and sequencers assigned to a sub) shift the division: 3 steps per volt
- the envelope curves
- the exact 12-JI ratio table
- quantization rooted at C, with the patched VCO pitch inputs going through the quantizer
