# subharmsynth.js

A browser replica of the Moog Subharmonicon semi-modular polyrhythmic synthesizer, built on the WebAudio API.

All sound is generated in real time by an `AudioWorkletProcessor` (`harm-worklet.js`). That covers the oscillators, subharmonic dividers, ladder filter, envelopes, clock, polyrhythm dividers, sequencers and patch-cable routing, all computed per sample. The only extra node is a `ConvolverNode` for the optional reverb.

Needs a browser with AudioWorklet support, served over `https://` or `localhost`. Web MIDI works in Chromium-based browsers.

## Files

| file | what |
|---|---|
| `index.html` | page and toolbar |
| `code.js` | the panel: canvas drawing, knobs, buttons, patch bay cables, keyboard shortcuts |
| `harm.js` | controller: settings, jack table, audio graph, Scala parser, Web MIDI |
| `harm-worklet.js` | the DSP engine |
| `data/patches.json` | factory patches |
| `old/` | the original version of this replica, as in the first commit |
| `data/scales/` | Scala `.scl` scales, plus `index.json` used by the scale picker |

## What it emulates

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
- **Patches**: a toolbar menu with 8 factory patches (in `data/patches.json`) and your own. *Save as…* stores the whole panel and its cables under a name in the browser. *Export* / *Import* write and read `.json` patch files, so patches can be shared or added to the repo. A patch only needs the fields that differ from Init; anything missing or invalid falls back to the Init value.
- **Post FX row** at the bottom, on the master output after the compressor:
  - **Reverb** (send): MIX, PRE-DELAY, TONE (lowpass on the tail), ROOM (two hall impulses) and ON.
  - **Delay**: TIME (free 10 ms – 2 s, or tempo divisions 1/16 – 1/1 with SYNC), FEEDBACK, TONE (lowpass in the feedback), MIX, PING-PONG and ON. Off by default.
- **Collapsible devices**: the chevron on the top left corner of the KEYS, LFO, compressor, reverb and delay devices folds the whole row (both devices sharing it) into slim bars; their jacks stay on the bar as small sockets, so cables stay connected.
- **Device row** below the synth, in the same style, patchable from and to the main patch bay:
  - **Dual LFO**: per LFO RATE (0.01–100 Hz), SHAPE (sine, triangle, saw, ramp, square, sample & hold), LEVEL (an attenuator, since the Subharmonicon has none), RATE CV inputs (1 V/oct) and SYNC inputs (a gate restarts the cycle). Outputs are ±5 V.
  - **Compressor** on the master output, before the reverb: THRESHOLD, RATIO, ATTACK, RELEASE, MAKEUP, MIX (parallel), ON, a gain reduction meter, a SIDECHAIN input (the detector rectifies, so use envelopes or gates for ducking) and a GR output (gain reduction as CV, 4 dB per volt). A small green CRT oscilloscope under its jacks shows the signal patched into its SCOPE input (±5 V full scale) or, with nothing patched, the master output. Click the screen to cycle the time base (5 ms, 20 ms, 100 ms: triggered; 500 ms, 2 s: scrolling roll mode).
- **Wires** (toolbar) hides the patch cables and leaves only their coloured plugs on the jacks.
- **Randomize** (toolbar) rolls a new playable sound, keeping volume, compressor, reverb, cables and the loaded scale.
- **Two panel layouts**, switched with the *Layout* toolbar button: *Hardware* places every control where it is on the real front panel; *Classic* is the original compact layout of this replica, grouped by section.

## Controls

- Drag knobs vertically; hold Shift for fine control. The mouse wheel also works, and double-clicking a knob resets it.
- Drag from a jack to patch. Drag a cable off an input to move or remove it. Double-click or right-click a jack to unplug it.
- Keys: `Space` play/stop, `R` reset, `N` next step, `T` trigger.

## Approximations

Some details are educated guesses, not measurements of the hardware:

- how strongly the SUB and RHYTHM CV inputs (and sequencers assigned to a sub) shift the division: 3 steps per volt
- the envelope curves
- the exact 12-JI ratio table
- quantization rooted at C, with the patched VCO pitch inputs going through the quantizer
