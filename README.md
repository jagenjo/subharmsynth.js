# subharmsynth.js

A browser rack of semi-modular synthesizers built on the WebAudio API: replicas of the Moog Subharmonicon (polyrhythmic synthesizer) and the Moog DFAM (percussion synthesizer), plus shared keys, LFO, compressor, reverb and delay devices, all patchable with each other.

All synthesis runs in real time in one `AudioWorkletProcessor` (`rack-worklet.js`), which hosts each synth's DSP and copies the patch cables between them every sample. Oscillators, filters, envelopes, clocks, sequencers and the cables are all computed per sample, so patching between synths is sample-accurate. The reverb and delay are native WebAudio nodes after it.

Needs a browser with AudioWorklet support, served over `https://` or `localhost`. Web MIDI works in Chromium-based browsers.

## Files

| file | what |
|---|---|
| `index.html` | page and toolbar |
| `webrack.js` | the rack controller: synth registry, settings and patches, audio graph, post FX, Scala parser, Web MIDI, keys |
| `rack-worklet.js` | the audio processor: hosts the synths' DSP, routes the cables, runs the keys outputs, LFOs, compressor and scope |
| `code.js` | the rack UI: canvas widgets (knobs, buttons, switches, jacks), cables, shared devices, scrolling and zoom, toolbar, keyboard shortcuts |
| `synths/subharm.js`, `synths/subharm-worklet.js` | the Subharmonicon: panel, jacks and settings; DSP |
| `synths/dfam.js`, `synths/dfam-worklet.js` | the DFAM: panel, jacks and settings; DSP |
| `data/patches.json` | factory patches |
| `old/` | the original version of this replica, as in the first commit |
| `data/impulses/` | reverb impulse responses from Voxengo's free "IM Reverbs" pack, redistributed unaltered under its `license.txt` (© Aleksey Vaneev) |
| `data/scales/` | Scala `.scl` scales, plus `index.json` used by the scale picker |

## The rack

The page is a rack. From the top:

1. The **KEYS** device.
2. The synths, one row each.
3. A row with the **LFO** and the **compressor**.
4. A row with the **reverb** and the **delay**.

One patch bay spans all of them: any output can be cabled to any input of any device.

- **Add synth** (toolbar) inserts a new Subharm or DFAM at the bottom of the rack. A synth with a MIDI IN gets the keys' MIDI cable. You can have several of the same kind (`dfam`, `dfam2`, …).
- Each synth has three buttons on its right wood cheek: **move up**, **move down** and **remove**. Removing asks first and unplugs that synth's cables.
- The chevron on the top left folds a synth into a slim bar like the other devices. Its jacks stay on the bar, so cables stay connected.
- **Scale:** the rack fills the window width; more devices make it taller and it scrolls vertically.
  - Zoom **−** / **+** (toolbar) change the scale; the percentage button goes back to 100%. The zoom is remembered in the browser.
  - Zoomed past the width, the rack also scrolls sideways.
  - The mouse wheel scrolls when it's not over a knob; Shift + wheel scrolls sideways. You can also drag the scrollbars, or grab the rack by the wood sides of any row (or the empty space around it) and drag.
  - Dragging a cable near the edge of the window scrolls toward it.
- **Space** starts every synth when none is running, otherwise stops them all. **R**, **N** and **T** reset, step (NEXT / ADVANCE) and trigger every synth.
- **Adding another synth:** register it from a pair of files in `synths/`:
  - The main thread file calls `WR.registerSynth(type, { title, worklet, jacks, defaults, size, draw, … })`. The fields are documented in `webrack.js`.
  - The worklet file sets `globalThis.WR_DSP[type]` to a class with `outs` / `ins` / `patched` arrays, plus `setSettings`, `message`, `beginBlock`, `tick` and `state`.
  - Add both files to `index.html`.

## DFAM

A replica of the Moog DFAM ("Drummer From Another Mother"):

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
  - A cable in ADV / CLOCK replaces the internal clock: each pulse advances a step. To sync the DFAM to the Subharm, patch the Subharm's CLOCK output there.
  - A cable in VCA CV replaces the envelope on the VCA.
  - The decay inputs stretch their decay time by one octave of time per volt.
- Like the hardware, it has no MIDI. Play it from the keys device with cables, e.g. KEY 1 → VCO 1 CV and TRIG → TRIGGER.

## Subharmonicon

- **2 VCOs, each with 2 subharmonics.** VCO FREQ spans C4 to C8. The subs are true frequency dividers (÷1 fully clockwise to ÷16) of their VCO, so they stay phase-locked. The 3-position wave switch sets all square (up), pulse VCO with saw subs and SUB 1 normalled to the PWM input (middle), or all saw (down). Oscillators are band-limited (polyBLEP) and have a little analog drift.
- **Mixer** with 6 levels, driving a **4-pole ladder low-pass filter** with input saturation. The filter self-oscillates at the top of the resonance range.
- **VCF and VCA attack/decay envelopes.** VCF EG AMT is bipolar. The EG button locks both envelopes at maximum (it blinks while held), for drones.
- **2 four-step sequencers.** SEQ OCT sets the step range to ±1, ±2 or ±5 octaves. SEQ ASSIGN routes each sequencer to its VCO pitch and/or the division of either sub.
- **Quantizer**: 12-ET, 8-ET, 12-JI, 8-JI or off, applied to the VCO pitch (knob + sequencer + MIDI + the patched VCO 1 / VCO 2 pitch inputs).
- **Polyrhythm**: the tempo clock (20 to 3000 BPM) feeds 4 rhythm dividers (÷1 to ÷16). Each divider can clock SEQ 1 and/or SEQ 2. Coincident pulses count once, and every sequencer step fires both envelopes.
- **PLAY, RESET, TRIGGER and NEXT.** TRIGGER holds the envelopes while pressed.
- **32-point patch bay** with the hardware's layout. Outputs have inverted labels. Inputs accept one cable each; outputs can feed several. Audio-rate patching works, e.g. VCO 2 into VCO 1 for FM.

Patch bay signal levels: audio ±5 V, envelopes 0 to 5 V, SEQ outputs 1 V/oct, clock/trigger outputs 5 ms pulses at 5 V. Pitch and cutoff inputs track 1 V/oct.

## Keys device and MIDI

The **KEYS** row above the synth is where notes come in:

- **MIDI IN**: *ENABLE* asks the browser for MIDI access; ◀ / ▶ pick one input or all of them. The LCD shows the device and the notes being held.
- **Keyboard**: a 3-octave on-screen keyboard (drag across it to glide), *OCT −* / *OCT +*, and *QWERTY*, which turns the computer keyboard into a piano: `A S D F G H J K L ; '` are white keys, `W E T Y U O P` black keys, `Z` / `X` shift the octave. While QWERTY is on, `T` plays F# instead of triggering.
- **Split**: *SPLIT* divides the keyboard at the marker above the keys (drag it). The lower zone drives KEY 1 / GATE 1, the upper zone KEY 2 / GATE 2. Without split both pairs carry all notes.
- **Outputs**: GATE 1 / 2 (5 V while a key of that zone is held), KEY 1 / 2 (1 V/oct, C4 = 0 V, last-note priority), TRIG (a 5 ms pulse on every key press, whatever the split) and MIDI. All notes from every source (MIDI device, on-screen keys, QWERTY) go to the MIDI output.

As on the hardware, MIDI reaches the synth only through its MIDI IN jack, so the MIDI output is cabled to it by default (patches from before the keys device get that cable automatically). Unplug it to use the keyboard only as CV, e.g. KEY 1 → VCO 1 and GATE 1 → TRIGGER. What the synth does with MIDI:

- **Notes** transpose both VCOs relative to C4, with last-note priority. They retrigger both envelopes and hold them while the key is down.
- **Pitch bend**: ±2 semitones.
- **Clock**: 24 ppqn MIDI clock drives the master clock in 16ths, as on the hardware. While clock messages are arriving, they replace the TEMPO knob. A cable in the CLOCK input takes priority over both.
- **Start / Stop / Continue** run, stop and resume the sequencer.

## Beyond the hardware

- **Scala scales.** Type a scale name in the toolbar to add a fifth quantize mode, SCALA. It uses the selected `.scl` file, rooted at C.
- **Patches**: a patch is the whole rack, meaning its synths, all their settings, the shared devices and the cables.
  - The toolbar menu has 15 factory patches (in `data/patches.json`), grouped as SUBHARM, DFAM and RACK (both synths patched together), plus your own.
  - *Save as…* stores the rack under a name in the browser.
  - *Export* / *Import* write and read `.json` files, so patches can be shared or added to the repo.
  - Patches saved before the rack existed load as a rack with one Subharm.
  - A patch only needs the fields that differ from the defaults; anything missing or invalid falls back to the default.
- **Post FX row** at the bottom, on the master output after the compressor:
  - **Reverb** (send): MIX, PRE-DELAY, TONE (lowpass on the tail), ON and ROOM with 12 spaces from short to long: drum rooms, cave, salon, a plate generated in code, opera hall, silo, two big halls, parking garage, echo hall and a church. Impulses load the first time their room is selected.
  - **Delay**: TIME (free 10 ms – 2 s, or tempo divisions 1/16 – 1/1 with SYNC), FEEDBACK, TONE (lowpass in the feedback), MIX, PING-PONG and ON. Off by default.
- **Collapsible devices**: the chevron on the top left corner of the KEYS, LFO, compressor, reverb and delay devices folds the whole row (both devices sharing it) into slim bars; their jacks stay on the bar as small sockets, so cables stay connected.
- **Device row** below the synth, in the same style, patchable from and to the main patch bay:
  - **Dual LFO**: per LFO RATE (0.01–100 Hz), SHAPE (sine, triangle, saw, ramp, square, sample & hold), LEVEL (an attenuator, since the Subharmonicon has none), RATE CV inputs (1 V/oct) and SYNC inputs (a gate restarts the cycle). Outputs are ±5 V.
  - **Compressor** on the master output, before the reverb: THRESHOLD, RATIO, ATTACK, RELEASE, MAKEUP, MIX (parallel), ON, a gain reduction meter, a SIDECHAIN input (the detector rectifies, so use envelopes or gates for ducking) and a GR output (gain reduction as CV, 4 dB per volt). A small green CRT oscilloscope under its jacks shows the signal patched into its SCOPE input (±5 V full scale) or, with nothing patched, the master output. Click the screen to cycle the time base (5 ms, 20 ms, 100 ms: triggered; 500 ms, 2 s: scrolling roll mode).
- **Wires** (toolbar) hides the patch cables and leaves only their coloured plugs on the jacks.
- **Randomize** (toolbar) rolls a new playable sound on every synth and the LFOs. It keeps the volumes, compressor, reverb, cables and the loaded scale.
- **Two panel layouts** for the Subharm, switched with the *Layout* toolbar button. *Hardware* places every control where it is on the real front panel; *Classic* is the original compact layout of this replica, grouped by section. The rest of the rack follows its width.

## Controls

- Drag knobs vertically; hold Shift for fine control. The mouse wheel also works, and double-clicking a knob resets it.
- Drag from a jack to patch. Drag a cable off an input to move or remove it. Double-click or right-click a jack to unplug it.
- Keys: `Space` play/stop, `R` reset, `N` next step, `T` trigger (on every synth in the rack).

## Approximations

Some details are educated guesses, not measurements of the hardware:

- DFAM: the order of the patch bay jacks within their rows, the envelope curves and ranges, the FM depth and the HP filter (a 4-pole high pass from the same ladder)
- how strongly the SUB and RHYTHM CV inputs (and sequencers assigned to a sub) shift the division: 3 steps per volt
- the envelope curves
- the exact 12-JI ratio table
- quantization rooted at C, with the patched VCO pitch inputs going through the quantizer
