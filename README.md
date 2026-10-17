# subharmsynth.js

**SYNTHS** is a browser rack of semi-modular synthesizers built on the WebAudio API: replicas of the Moog Subharmonicon (polyrhythmic synthesizer), DFAM (percussion synthesizer, here called DRAM), Mother-32 (synthesizer with a 32 step sequencer, here called Brother-32) and Labyrinth (parallel generative synthesizer, here called Maze), with a mixer, LFOs, compressors, reverbs and delays, all patchable with each other.

All synthesis runs in real time in one `AudioWorkletProcessor` (`rack-worklet.js`), which hosts each synth's DSP and copies the patch cables between them every sample. Oscillators, filters, envelopes, clocks, sequencers and the cables are all computed per sample, so patching between synths is sample-accurate. The reverb and delay are native WebAudio nodes after it.

Needs a browser with AudioWorklet support, served over `https://` or `localhost`. Web MIDI works in Chromium-based browsers.

## Files

| file | what |
|---|---|
| `index.html` | page and toolbar |
| `webrack.js` | the rack controller: synth registry, settings and patches, audio graph, post FX, Scala parser, Web MIDI, keys |
| `rack-worklet.js` | the audio processor: hosts the synths' DSP, routes the cables, runs the keys outputs, LFOs, compressor and scope |
| `sequencer.js` | the song sequencer in the bottom bar: tracks, piano roll, transport, recording, scheduling |
| `sessions.js` | sessions: the rack autosaved in the browser, the Sessions panel |
| `code.js` | the rack UI: canvas widgets (knobs, buttons, switches, jacks), cables, shared devices, scrolling and zoom, toolbar, keyboard shortcuts |
| `devices/subharm.js`, `devices/subharm-worklet.js` | the Subharmonicon: panel, jacks and settings; DSP |
| `devices/dram.js`, `devices/dram-worklet.js` | the DRAM |
| `devices/b32.js`, `devices/b32-worklet.js` | the Brother-32 |
| `devices/maze.js`, `devices/maze-worklet.js` | the Maze |
| `devices/mixer.js`, `devices/mixer-worklet.js` | the 6 channel mixer |
| `devices/lfo.js`, `devices/lfo-worklet.js` | the dual LFO |
| `devices/comp.js`, `devices/comp-worklet.js` | the stereo compressor and its scope |
| `devices/delay.js`, `devices/delay-worklet.js` | the stereo / ping-pong delay |
| `devices/reverb.js`, `devices/reverb-worklet.js` | the convolution reverb: native nodes, bridged through a send / return slot |
| `data/patches.json` | factory patches |
| `old/` | the original version of this replica, as in the first commit |
| `data/impulses/` | reverb impulse responses from Voxengo's free "IM Reverbs" pack, redistributed unaltered under its `license.txt` (© Aleksey Vaneev) |
| `data/scales/` | Scala `.scl` scales, plus `index.json` used by the scale picker |

## The rack

The page is a rack. From the top:

1. The **AUDIO I/O** device.
2. The **KEYS** device.
3. The devices, in the order you choose. Synths and mixers take a full row. The half-width devices (dual LFO, compressor, reverb, delay) sit side by side when two are next to each other.

A new rack has a Subharm, an LFO and a compressor, then a reverb and a delay, cabled as the default audio path.

One patch bay spans all of them: any output can be cabled to any input of any device. The front carries CV, gates and audio at ±5 V; the back carries the line-level audio between devices (see *Rear view*).

- **Add device** (toolbar) inserts a new device at the bottom of the rack. The menu is grouped into synths (Subharm, DRAM, Brother-32, Maze), modulation (dual LFO), mixing (mixer, compressor) and effects (reverb, delay).
  - You can have several of the same kind (`dram`, `dram2`, …). Reverbs are limited to 8, one per send / return slot of the audio engine.
  - A new LFO, compressor, reverb or delay arrives unpatched: patch its audio on the back (Tab).
  - A synth with a MIDI IN (Subharm, Brother-32, Maze) gets the keys' MIDI through **MASTER MIDI** instead of a long cable across the rack (see *MIDI on the back*).
  - A new synth's audio goes to the first free mixer channel; with no mixer, to wherever the other synths go (or the compressor).
  - A new mixer takes over the synths that weren't on a mixer: they move onto its channels, and its MAIN L / R go where they went.
- Each synth has three buttons on its right wood cheek: **move up**, **move down** and **remove**. A full-width device moves past a whole row: a pair of half-width devices stays together. Removing asks first and unplugs that synth's cables.
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
- **Space** starts every synth when none is running, otherwise stops them all. **R**, **N** and **T** reset, step (NEXT / ADVANCE) and trigger every synth.
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

## Maze

A replica of the Moog Labyrinth, following its manual, named Maze here. Patches that still use the old `labyrinth` name load as Maze.

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
  - Normalled connections, as on the hardware: EG1 into VCW FOLD and CUTOFF, EG2 into both VCA CVs, the mixer into VCW IN and VCF IN, the ring modulation into U MIX 1, the internal clock into CLOCK 1 and CLOCK 1 into CLOCK 2.
- **MIDI** (cabled from the keys when it's added): notes transpose the VCO and fire the envelopes; MIDI clock and start / stop drive the sequencers.
- **Factory patches:** *Alien Bells* and *Folded Bongos*.

## Brother-32

A replica of the Moog Mother-32, named Brother-32 here. Patches that still use the old `mother32` name load as Brother-32.

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

A replica of the Moog DFAM ("Drummer From Another Mother"), named DRAM here. Patches that still use the old `dfam` name load as DRAM.

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
- **Tracks** (up to 16), on the left: each plays on its own MIDI **CH**annel (click to change, Shift for the previous), with **M**ute, **S**olo and **×** to delete. Double-click a name to rename it.
  - **+ TRACK** adds one on the next free channel; **CLEAR** empties the selected track.
  - Set the synths' **CH** switches on the back (Tab) to choose which synth plays which track. A synth on OMNI plays them all.
- **Piano roll** of the selected track, with the other tracks' notes faint behind it.
  - Click to add a note on the grid (drag to set its length). Drag a note to move it, drag its end to change its length, right-click (or Delete) to remove it.
  - The keys on the left play the note. The mouse wheel scrolls the notes.
- **Recording:** with REC on while playing, notes from the on-screen keys, the QWERTY keys and a MIDI device go into the selected track, snapped to the grid.
- **Timing:** notes are scheduled ahead into the audio engine with their sample position, so they don't depend on the page's frame rate.
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

As on the hardware, MIDI reaches the synth only through its MIDI IN jack, so the MIDI output is cabled to it by default (patches from before the keys device get that cable automatically). Unplug it to use the keyboard only as CV, e.g. KEY 1 → VCO 1 and GATE 1 → TRIGGER. What the synth does with MIDI:

- **Notes** transpose both VCOs relative to C4, with last-note priority. They retrigger both envelopes and hold them while the key is down.
- **Pitch bend**: ±2 semitones.
- **Clock**: 24 ppqn MIDI clock drives the master clock in 16ths, as on the hardware. While clock messages are arriving, they replace the TEMPO knob. A cable in the CLOCK input takes priority over both.
- **Start / Stop / Continue** run, stop and resume the sequencer.

## Beyond the hardware

- **Scala scales.** Type a scale name in the toolbar to add a fifth quantize mode, SCALA. It uses the selected `.scl` file, rooted at C.
- **Sessions** (toolbar): your work is saved automatically in this browser, a few seconds after every change and when you leave the page.
  - A session is the whole rack (devices, settings, cables) and the song.
  - Each visit reopens the last session; turn off *Reopen the last session at start* in the panel to start each visit with a fresh rack in a new session.
  - The panel lists the sessions, newest first, with their devices and song, to **Load**, rename (✎) or delete (×). **New session** starts a fresh rack and keeps the current one.
  - The 30 most recent are kept; when the browser's storage is full, the oldest go first.
- **Patches**: a patch is the whole rack, meaning its synths, all their settings, the shared devices and the cables.
  - The toolbar menu has 21 factory patches (in `data/patches.json`), grouped as SUBHARM, DRAM, BROTHER-32, MAZE and RACK (several devices patched together), plus your own.
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
- **Options** (toolbar) opens a small panel:
  - **Layout:** Hardware or Classic, for the Subharm (see below).
  - **Show wires:** off hides the patch cables and leaves only their coloured plugs on the jacks.
  - **Mouse wheel turns the knob under the cursor:** off, the wheel always scrolls the rack, so scrolling over the panels can't move a knob or fader by accident.
  - The choices are remembered in the browser.
- **Randomize** (toolbar) rolls a new playable sound on every synth and the LFOs. It keeps the volumes, compressor, reverb, cables and the loaded scale.
- **Two panel layouts** for the Subharm, switched in *Options*. *Hardware* places every control where it is on the real front panel; *Classic* is the original compact layout of this replica, grouped by section. The rest of the rack follows its width.

## Controls

- Drag knobs vertically; hold Shift for fine control. The mouse wheel also works, and double-clicking a knob resets it.
- Drag from a jack to patch. Drag a cable off an input to move or remove it. Double-click or right-click a jack to unplug it.
- Keys: `Space` play/stop, `R` reset, `N` next step, `T` trigger (on every synth in the rack).

## Approximations

Some details are educated guesses, not measurements of the hardware:

- Maze: how much CORRUPT changes per pass, the ranges of the amounts, the wavefolder and filter curves, the scales after the ones the manual lists, how notes are handled over MIDI, and the panel layout (an arrangement of the manual's controls, not a copy of the panel)
- Brother-32: the placement of the patch bay jacks within the 4 × 8 grid, the ranges of the knobs, the ASSIGN choices, and the step editing (a step grid instead of the button modes)
- DRAM: the order of the patch bay jacks within their rows, the envelope curves and ranges, the FM depth and the HP filter (a 4-pole high pass from the same ladder)
- how strongly the SUB and RHYTHM CV inputs (and sequencers assigned to a sub) shift the division: 3 steps per volt
- the envelope curves
- the exact 12-JI ratio table
- quantization rooted at C, with the patched VCO pitch inputs going through the quantizer
