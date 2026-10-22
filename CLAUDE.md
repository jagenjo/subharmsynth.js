# GASFREE: notes for Claude Code

GASFREE (from GAS, Gear Acquisition Syndrome, and FREE: all the gear, none of the buying) is a rack of synthesizers that runs in the browser. You add synths, drum machines, effects, mixers and sequencers to a rack and patch them with cables, as in hardware or in Reason. It is plain JavaScript with no build step and no dependencies.

- Live at https://gasfree.app/ (the home page; the app is at /app/).
- Repo: https://github.com/jagenjo/subharmsynth.js (the project started as a single synth, the Subharm).
- Author: tamat (javi.agenjo@gmail.com). The home page footer reads "by tamat 2026".

`README.md` is the user manual and the file list: what every device and feature does. This file covers what the README doesn't: the goals, how the user likes to work, and how the code is put together.

## Goals

- **Many instruments, one rack.** Each device is an original design inspired by a kind of classic instrument (a polyrhythmic synth, an analog drum synth, a paraphonic synth, a wavetable poly, a tape machine...). Every device can be patched to every other one, sample-accurately.
- **Feels like hardware.** Panels are drawn like front panels: wood sides, screws, knobs, jacks, cables that sag. The back of the rack (Tab) carries the audio between devices, the front carries CV and gates at ±5 V.
- **No brands.** Nothing in the app, home page, README or code may name an existing company or product. Devices have their own names (MOUNT, PARA D, TAPE, LLM DRAM...). When the user asks for "a replica of the X by Y", copy the design and layout, give it an original name and keep the brand out of everything, comments included. Legacy type ids that remain from before (`dfam`, `mother32`, `labyrinth`, `pollyd`) stay as ids so old saves load; don't show them. The reverb impulses' `license.txt` keeps its original text.
- **Works offline from files.** `app/index.html` must work from `file://` and from any static server. No bundler, no npm packages at runtime, no external CDNs in the app.

## Repository layout

| path | what |
|---|---|
| `index.html` | redirects to `home/` |
| `home/` | the landing page: features, screenshots (`home/img/`), the logo, share preview (`home/img/share.jpg`, og/twitter tags) |
| `app/` | the app (open `app/index.html`) |
| `app/webrack.js` | main thread controller: device registry (`WR.registerSynth`), settings, patches, the audio graph, Web MIDI, keys |
| `app/rack-worklet.js` | the single `AudioWorkletProcessor` that hosts every device's DSP and copies the cables every sample |
| `app/code.js` | the whole UI: an immediate-mode canvas (widgets, cables, rear view, toolbar, panels, shortcuts) |
| `app/sequencer.js` | the song sequencer (bottom bar, piano roll, CV tracks, MIDI import, WAV export, detachable window) |
| `app/sessions.js` | autosaved sessions in localStorage |
| `app/analytics.js` | Umami statistics, off until `UMAMI_SRC` / `UMAMI_ID` are set |
| `app/devices/<type>.js` + `<type>-worklet.js` | one pair per device: panel and settings / DSP |
| `app/editor/` | the Synth Editor and the custom synths, kept apart from the rest |
| `app/data/` | `patches.json` (factory patches), impulses, Scala scales |
| `app/previews/<type>.jpg` | the pictures in ADD DEVICE, made by `tools/make-previews.sh` |
| `tools/` | `make-previews.sh` (headless Chrome + ImageMagick), `make-logo.py` |
| `old/` | the first version of the project, kept as it was. Don't edit it |
| `.claude/skills/claudisms/SKILL.md` | the user's catalogue of wording to avoid, as the `claudisms` skill (see *Writing*) |

## Architecture

### Audio engine

- All DSP runs in one AudioWorkletProcessor, `rack-worklet.js`. Each device's worklet file registers a class on `globalThis.WR_DSP[type]`; the rack loads each shared worklet file once.
- A DSP class has static `IN_IDS` / `OUT_IDS` (and `MIDI_IN`), instance arrays `ins`, `outs`, `patched`, and the methods `setSettings(s)`, `message(m)`, `beginBlock()`, `tick()` (one sample), `endBlock()`, `state()` (sent back to the UI, e.g. LEDs, meters, playheads). Read `devices/hyper-worklet.js` or `devices/tape-worklet.js` as a short example.
- Cables are copied every sample, so everything is sample-accurate. Front signals are ±5 V; rear audio is line level (±1).
- The main thread posts a device's whole settings object whenever it changes (compared with `JSON.stringify`). When a module's type changes under the same id (e.g. the custom synth switching between full and half width), a new DSP instance is created; a message sent just before the swap goes to the old instance.
- The convolution reverb is native WebAudio nodes, bridged through one of 8 send / return slots (`WR.SLOTS`).

### Devices

- `WR.registerSynth(type, def)` in `webrack.js` documents every field of `def` in a comment above it: `title`, `category`, `half`, `insert`, `worklet`, `jacks`, `rear_jacks`, `midi_in`, `defaults`, `validate`, `randomize`, `size`, `draw`, `key_prio`, `knob_jacks`, `rear_note`...
- Hooks added for the custom synths, usable by any device: `size(layout, settings)`, `jacksOf(s)`, `rearJacksOf(s)`, `drawRear(m, w, h)`, `onAdd(m)`, `hidden` (not in ADD DEVICE).
- A device's panel file goes into `app/index.html` as a `<script>` tag with the others; its worklet file is loaded by the rack from `def.worklet`. Then make its preview: `tools/make-previews.sh <type>`.
- Full-width devices take a row; `half: true` devices pair up side by side. `insert: true` effects get wired in before the speakers when added.
- Synths with `midi_in` get MASTER MIDI (the keys' MIDI without a cable) and a channel switch on the back.

### UI (code.js)

- Immediate mode: every frame redraws the rack. Widgets are functions that draw and return their new value: `knob(id, x, y, r, value, min, max, opts)`, `fader`, `button`, `tinyButton`, `drawJack`, `drawRearSocket`, `drawLabel`, `drawCasing`, `drawDevicePanel`, `drawDeviceJacks`...
- Panel coordinates are the device's own (`size()`); the rack scales them. Widget ids are prefixed with the module id through the global `id_prefix`.
- Globals worth knowing: `ctx`, `ui`, `jacks`, `id_prefix`, `knob_skin`, `KNOB_A0` / `KNOB_SWEEP` (knob angles), `TEXT_COLOR`, `DIM_COLOR`, `PREVIEW_MODE`, `midictl` (MIDI learn).
- `app/index.html?preview=<type>` draws only that device on magenta; the preview script relies on it.
- Knobs share skins (`WR.KNOB_SKINS`); Ctrl/Cmd + wheel always turns a knob; MIDI learn and computer-keyboard button mapping (`key_prio`) work on every device automatically.

### Saving

- A patch is the whole rack (devices, settings, cables). Patches only need fields that differ from the defaults; `validate()` must accept old and partial data.
- Factory patches live in `app/data/patches.json`, grouped per synth (at least three per synth) plus RACK patches.
- Sessions autosave in localStorage (`sessions.js`); the user's own patches and custom synth designs (`GASFREE_synths`) are also in localStorage.

### Synth Editor (app/editor/)

A generic device type, `custom` (full width) and `custom_half`, whose settings are the design: `items` (front panel), `back` (rear panel), `nodes` (modules inside), `wires`, panel size, colour and knob skin.

- `custom-worklet.js`: the module catalogue (`MODULES`: midi, osc, noise, lfo, adsr, clock, seq, sh, slew, quant, filter, vca, mix, drive, delay, math, out), the panel controls (`CONTROLS`) and `CustomDSP`, which compiles the design and runs the nodes in topological order (feedback loops read the previous sample). 8 front jack slots, 4 audio in / out on the back.
- `custom.js`: the device in the rack; draws the front and back from the design, its jacks follow the design.
- `editor.js` / `editor.css`: the editor overlay, with FRONT PANEL, BACK PANEL and INSIDE views. It renders items by calling the device's own draw with the rack's globals swapped (`inert()`), so the palette previews, the drag ghost and the gadgets inside the nodes look exactly like the rack.
- It is kept separate on purpose: the rest of the app only knows the generic hooks listed under *Devices*.

## Way of working

### Requests

The user writes short requests (often one or two lines, sometimes with typos) and expects the whole job done: code, test it, docs, preview picture, commit, push. Fill gaps with sensible choices that fit the existing devices, and say what you chose. When asked to replicate an instrument, follow its layout and features closely, under an original name.

### Commits and branches

- Commit each finished change and push. End commit messages with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Larger features go on a branch with a PR (e.g. `synth-editor`). `gh` is not installed: push the branch and give the user `https://github.com/jagenjo/subharmsynth.js/pull/new/<branch>`. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Unrelated work goes on `main`, not on a feature branch. Check `git branch --show-current` first.
- The user sometimes commits by hand (e.g. after a session ran out); look at `git log` and `git status` before starting.

### Versioning

Every `?v=` in `app/index.html` and `WR.VERSION` in `app/webrack.js` must carry the same value, and both are bumped together on each change so browsers reload the scripts. The format is the date plus a letter: `20261018a`, `20261018b`...

### Docs to keep in step with a change

- `README.md`: the file table and the device's or feature's section.
- The Help panel inside `app/index.html`.
- `home/index.html` when a device is added (the device list and the intro).
- `app/previews/<type>.jpg` after any panel change (`tools/make-previews.sh <type>`).
- Factory patches for a new synth (at least three) in `app/data/patches.json`.

### Testing

There is no test suite in the repo. Changes are verified two ways, with throwaway scripts in the session's scratchpad:

- **Node harnesses**: load `webrack.js`, `code.js` and the device files into a `vm` context with a fake canvas / AudioWorklet, run the DSP classes directly (feed `ins`, call `tick()`, measure `outs`: level, finiteness, filtering), and exercise UI logic.
- **Real Chrome**: the existing Chrome at `~/.cache/puppeteer/chrome/linux-137.0.7151.55/chrome-linux64/chrome`, headless, driven over the DevTools protocol (`--remote-debugging-port`, a fresh `--user-data-dir` each run, `--autoplay-policy=no-user-gesture-required`, `--allow-file-access-from-files`, open `file://.../app/index.html`). Drive it with real mouse events, evaluate state, take screenshots and look at them. Audio can be checked through the master meter.

Check new devices for sound (finite, bounded, audible), every preset, the panel at its size, cables on front and back, and save / load of its settings. One known intermittent failure: the UNIVERSE "all presets sound" check sometimes reports one quiet preset.

### Environment

- Disk space is tight: no large installs (no puppeteer download, no npm installs).
- Don't read credential files (`~/.git-credentials`, `~/.ssh`), and don't run commands with the sandbox disabled.
- Never use `pkill -f` / `pgrep -f` with a pattern that also appears in your own shell command: it kills the shell. Start Chrome in the background and kill it by its PID (`$!`).
- Foreground `sleep` is blocked; wait with `timeout 1 tail -f /dev/null` in a loop, or poll a URL.

### Deployment

nginx serves `/srv/www/gasfree.app/public_html`: a copy of `home/` at its root, a copy of `app/` in `app/`, and `beta/` as a symlink to `~/repos/gasfree/app` (so `/beta/` always shows the working tree). Copying to `public_html` is a release: only do it when the user asks.

## Writing

The app, README and home page use plain, short, factual sentences: what a control does, its range, what happens. Labels on panels are UPPERCASE. In replies and docs:

- No em dashes, no emojis (the PR attribution line above is the exception).
- Avoid the phrases catalogued in the `claudisms` skill, `.claude/skills/claudisms/SKILL.md` (e.g. "real", "honest", "worth...", "load-bearing", "the whole X", "lives", "shape" as metaphors).
- Describe what changed and what was verified; say plainly what failed or wasn't tested.

## Devices at a glance

Synths: SUBHARM (polyrhythmic), DRAM (analog percussion), BROTHER-32 (semi-modular with a 32 step sequencer), MAZE (generative), MYSTIC (wave scanning poly), MOUNT (8 voice wavetable poly), PARA D (4 oscillator paraphonic), LLM DRAM (80s drum machine), LUNAR 21 (drone machine), CUSTOM SYNTH (Synth Editor).
Sequencing and modulation: GRID 32 (32×32 note matrix), dual LFO, the song sequencer, the KEYS device (on-screen keys, QWERTY piano, MIDI).
Mixing and effects: mixer, compressor (with scope), reverb, delay, UNIVERSE (granular looper), COSMOS (12 algorithm reverb), HYPER (distortion / bit crusher), TAPE (wow, flutter, saturation, hiss, tape stop), REROUTE (front to back).
