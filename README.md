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
| `data/scales/` | Scala `.scl` scales, plus `index.json` used by the scale picker |

## What it emulates

- **2 VCOs, each with 2 subharmonics.** The subs are true frequency dividers (÷1 to ÷16) of their VCO, so they stay phase-locked. The wave switch sets saw or square for a VCO and its subs. Oscillators are band-limited (polyBLEP) and have a little analog drift.
- **Mixer** with 6 levels, driving a **4-pole ladder low-pass filter** with input saturation. The filter self-oscillates at the top of the resonance range.
- **VCF and VCA attack/decay envelopes.** VCF EG AMT is bipolar. The VCA EG button set to off holds the VCA open, for drones.
- **2 four-step sequencers.** SEQ OCT sets the step range to ±1, ±2 or ±5 octaves. SEQ ASSIGN routes each sequencer to its VCO pitch and/or the division of either sub.
- **Quantizer**: 12-ET, 8-ET, 12-JI, 8-JI or off, applied to the VCO pitch (knob + sequencer + MIDI).
- **Polyrhythm**: the tempo clock feeds 4 rhythm dividers (÷1 to ÷16). Each divider can clock SEQ 1 and/or SEQ 2. Coincident pulses count once, and every sequencer step fires both envelopes.
- **PLAY, RESET, TRIGGER and NEXT.** TRIGGER holds the envelopes while pressed.
- **32-point patch bay** with the hardware's layout. Outputs have inverted labels. Inputs accept one cable each; outputs can feed several. Audio-rate patching works, e.g. VCO 2 into VCO 1 for FM.

Patch bay signal levels: audio ±5 V, envelopes 0 to 5 V, SEQ outputs 1 V/oct, clock/trigger outputs 5 ms pulses at 5 V. Pitch and cutoff inputs track 1 V/oct.

## MIDI

Click *Enable* in the toolbar.

- **Notes** transpose both VCOs relative to C4, with last-note priority. They retrigger both envelopes and hold them while the key is down.
- **Pitch bend**: ±2 semitones.
- **Clock**: 24 ppqn; one beat = one master clock tick. While clock messages are arriving, they replace the TEMPO knob. A cable in the CLOCK input takes priority over both.
- **Start / Stop / Continue** run, stop and resume the sequencer.

## Beyond the hardware

- **Scala scales.** Type a scale name in the toolbar to add a fifth quantize mode, SCALA. It uses the selected `.scl` file, rooted at C.
- **Reverb send**, plus **Save / Load / Init** of the whole panel and its cables in the browser's local storage.

## Controls

- Drag knobs vertically; hold Shift for fine control. The mouse wheel also works, and double-clicking a knob resets it.
- Drag from a jack to patch. Drag a cable off an input to move or remove it. Double-click or right-click a jack to unplug it.
- Keys: `Space` play/stop, `R` reset, `N` next step, `T` trigger.
- **Keys** (toolbar) turns the computer keyboard into a piano: `A S D F G H J K L ; '` are the white keys starting at C4, `W E T Y U O P` the black keys, and `Z` / `X` shift the octave. Notes behave like MIDI notes. While it is on, `T` plays F# instead of triggering.

## Approximations

Some details are educated guesses, not measurements of the hardware:

- the VCO knob range (C1 to C6)
- how strongly the SUB and RHYTHM CV inputs (and sequencers assigned to a sub) shift the division: 3 steps per volt
- the envelope curves
- the exact 12-JI ratio table
- quantization rooted at C; the VCO pitch CV inputs are added after the quantizer
