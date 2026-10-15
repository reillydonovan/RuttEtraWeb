## Quick Start

The shortest path to your first scanline mesh. Each step is one short action.

1. On the boot overlay, choose a source: **WEBCAM**, **SCREEN**, **FILE**, **STREAM URL**, or **PATTERN** — PATTERN (and **continue without video**) starts the *Noise Terrain* preset, a moving Pattern Generator image that needs no camera, microphone or file. The camera is only requested when you pick WEBCAM. SCREEN is hidden on phones and tablets, which can't capture the screen. If the site operator has deployed a sample video, a **Load Sample Video** button is also available in Video Source A → Video File.
2. Open the **Presets** panel and click **Phosphor Green** to load a starting look.
3. Drag inside the viewport — your cursor rotates the camera around the scanline mesh.
4. Open the **DCU** panel and adjust **Z Push**. The scanlines lift and fall as you turn it.
5. Open **Modulation** and add a patch: Source = `LFO (Sine)`, Target = `Z Push`, Amount = `0.5`. Watch the scanlines pulse.
6. Open **Record → Start Recording**. Stop when ready. The file downloads to your machine.

That's the whole synth. Everything below is the rest of what it can do.

### The menu bar

A traditional app menu strip along the top (desktop only). **File** holds project New/Open/Save/Save As, the recent-projects list, and whole-workspace backup (Export/Import Everything) — the same operations as the Project panel and the `Ctrl+N`/`O`/`S` shortcuts, one implementation behind all three. **Edit** is timeline undo/redo; **View** switches skins, HUD, fullscreen, panel/timeline docking, and **Text Size**; **Window** pops the controls or output into separate windows and manages workspace regions (below); **Help** jumps straight to any Help tab, opens this manual, or shows the build's About box. The old always-visible ABOUT corner link moved into the Help menu.

**Text Size** (`View ▸ Text Size`, or `Ctrl+=` / `Ctrl+-` / `Ctrl+0`) — a legibility preference for anyone who finds the default hard to read. It scales every window's controls and fonts together and is remembered on this machine (like the skin choice, not in your presets or projects) — the default stays exactly as-is for everyone who never touches it.

### Panel skins

The **skin picker** in the panel title bar (CRT / HW / RACK) switches between three looks; **fresh sessions start on RACK**.

- **CRT** — the flat original.
- **HW** — swaps every control for skeuomorphic hardware: rotary knobs (drag vertically to turn; hold `Shift` for fine control; double-click to reset), bat switches with LED lenses, and LCD readouts (click one for precise entry, same as right-clicking).
- **RACK** — adds full modular chrome on top of HW: sections become rack modules with faceplate screws, every modulatable knob grows a 3.5mm input jack and an output jack, and your actual modulation routings render as live patch cables — green cables from the Classic matrix's slot output jacks (cables go one way — drag from an output jack into an input jack; pressing an empty input shows a quick reminder of where cables come from. Grab a plugged input to move its cable, or drop it in space to unplug — this edits the slot's Target exactly like the dropdown does), cyan cables for Graph-engine bindings — grab one by its input jack to move it to another knob, or drop it in space to unplug. Drag a knob's **output** jack onto another knob's input to modulate one parameter with another (the same Param Out patch the Patch Bay makes, so it shows up there too). A cable into a collapsed section plugs into that section's header, so nothing vanishes off-screen.

Same parameters, same values in every skin — only the faces change, and every slider trick below still works. The skin choice is remembered on this machine, not in your presets or projects, and touch layouts keep their touch-friendly controls regardless.

### Themes

Independent of the skin, **View ▸ Theme** (or the **MODERN / CLASSIC** picker in the panel title bar) chooses the overall look:

- **Modern** — the default. Neutral Apple-style greys with phosphor green spent where it means something: lit, active, hovered and focused state, a faint green catch on card edges, and a soft green glow that follows the pointer. A system sans-serif for headings and buttons (numbers and small labels stay monospaced), rounded cards on every Patch Bay module, graph node and Controls section, a lift on Patch Bay modules when you hover them, pill buttons, iOS-style switches and round-thumb sliders. Amber still means "the timeline owns this value" and red still means warning or a rejected cable. Cables, the Scope trace and timeline lanes keep their colours.
- **Classic** — the original green-on-black phosphor terminal, one click away.

A theme works with every skin (RACK + Modern gives rounded modules with live cables and knobs), follows into pop-out windows and onto the About and Tutorials pages (add `?theme=phosphor` or `?theme=modern` to a page's address to flip it), and respects your system's reduced-motion setting (no lift, glow or press animation). Like the skin it is remembered on this machine only — never in presets, projects or timelines.

### Workspace windows & tabs

The interface is four windows (**left**, **center**, **right**, **bottom**), and each holds a strip of **tabs**, exactly like Unity or Blender.

- Click a tab to switch what the window shows (**RENDERER**, **CONTROLS**, **TIMELINE**, **PATCH BAY**).
- **Drag a tab** onto another window's tab strip to move it there — a thin caret nudges between tabs to show exactly where it will land, the strip highlights, and while you drag, the *empty* window nearest your pointer reveals itself as a labeled drop strip (one at a time, proximity-based). Drag within a strip to **reorder**.
- **✕ closes a tab** (any window's **[+]** reopens it). **[+] always just adds a tab** — every view is fully multi-instance (RENDERER, PATCH BAY, CONTROLS, and TIMELINE all get a fresh, independent instance per window; every instance drives the same underlying settings/sequencer, so they always agree). Two TIMELINE tabs in different windows both play; two CONTROLS panels both edit.
- Every window has the same buttons: **⧉** pops it out, **⤢** maximizes it, **–** collapses it. A collapsed window shrinks to just its tab strip on its own edge (a vertical rail on the left and right, a bar at the bottom or top); click the strip, or **□**, to bring it back. The Renderer works the same way — collapsing it hides the output until you restore it.
- Moving a view never disturbs another window, and a window with no tabs disappears until you give it one — while dragging, empty windows reveal themselves near your pointer on all four edges (top and bottom drops also pick the bottom window's dock edge) plus the center.
- The renderer moves like any view — away from the center it becomes a live mirror while whatever you promoted takes the center stage.
- Side and bottom windows also have **⤢ maximize** (double-click the bar works too) and **– collapse**. The **Renderer** window has ⤢ too: the raster fills everything under the menu bar and the other windows hide until you click ⤡ (or double-click its bar) again — pair it with View ▸ Fullscreen for a clean full-screen output.
- **File ▸ New Project** starts from nothing: it releases both video inputs and brings back the *select a source* screen.
- **Window ▸ Layout** has the preset family — `Default (4-up)` (Patch Bay left, Renderer center, Controls right, Timeline bottom), `Classic`, `Tall`, `Wide`, `Performance`, `Patch Bay` — plus **Reset Layout**, the escape hatch back to Default from any arrangement you regret.

Window arrangements save with your project; phones/tablets keep the standard mobile layout regardless.

### Popouts (multi-display)

Every window bar has a **⧉** button beside maximize/collapse that opens that window's active view as its own OS window: Patch Bay and Timeline get a fresh, fully-live duplicate instance (everything stays in sync through the shared stores — closing the popup loses nothing); Controls and the Renderer use their dedicated popouts. Perfect for a two-monitor rig: output on the projector, bay on the laptop, timeline on a side screen.

Every popup carries its **own tab bar with a `+`**, so it's not stuck with just the one view it opened with — add Renderer, Controls, Timeline, or Patch Bay as more tabs right there (each a fresh, fully-live instance, same as the four in-document windows); closing a popup's last tab closes the popup.

### The Patch Bay

A view that turns the whole instrument into a hardware faceplate — and a node editor.

**Info buttons.** Every module and faceplate field in the Patch Bay, every graph node, and every Controls section header has a small **ⓘ**. Click it for a pop-up explaining what that module does, how to patch it, and every parameter it holds (with ranges), plus a link to the matching part of this manual. At the top is a live **signal-flow diagram**: the module in the middle, what's plugged into it on the left, and where its outputs go on the right, in the same cable colours as the bay (dashed = connected but muted, or its engine is switched off in Modulation mode). Close it with ✕, Esc, or a click outside.

**Navigating the board.** Scroll-wheel to zoom (or the −/100%/+ buttons in the SOURCES bar); click-drag any empty background — or any part of a module that isn't a control (its body, labels, readouts) — to pan around the board (the cursor shows an open hand wherever you can grab); while dragging a cable or a module, hold it near an edge of the view and the board glides in that direction (faster the closer you get, easing to a stop at the end) so you can reach a jack that's off-screen without dropping and zooming out; while you drag a cable, its end fades to white when it's over a jack that will take it and to red when it won't — hover a jack that can't accept it and that jack lights red with a short note saying why (both ends are outputs, a parameter can't modulate itself, video only goes to video jacks, and so on). The same feedback works for the RACK skin's cables in Controls; drag any module by its header to reorder it within the stacks (an insertion line shows where it lands) or drop it out past them to arrange modules freely, Max/MSP style, with magnetic edge-snapping — dropped modules push themselves apart so they never end up overlapping. The **TIDY / FREE** button is a toggle: **FREE** breaks every module out into free layout in one click (same as dragging one out by hand); **TIDY** snaps everything back into the default stacked layout. Switch back and forth as often as you like. A free arrangement survives being squeezed into a narrow window, and gets extra room around its edges so the outermost module's far side is always reachable while panning.

#### The faceplate

Four **FUNCTION GENERATOR** modules (the Classic mod slots) with SRC IN and OUT jacks, a **SOURCES** field of signal jacks (waveforms, audio, beat, joystick), and every modulatable parameter as a labeled jack **with a rotary knob and its real current value in an editable field right underneath** (drag the knob vertically, Shift for fine control, exactly like the hardware skin's pots) — every field group (Position & Size, Depth, Beam, Rotation, Scan, Linearity, Luminance, Colorizer/Post-FX, Camera, Pattern, Audio Analyzer, Auxiliary), so you can run the whole synth from the bay without the Controls tab open at all; only the CV OUT jacks (virtual, not real settings) skip the knob and value field. While modulation drives a param, an **amber needle** rides its knob and an amber `▸ value` readout shows the live figure — the same orange live-value language as the Controls tab.

Matching the real RE-4's faceplate, **every param row has an OUT jack too**: drag Height's OUT onto Depth's IN and the param's live value becomes a signal feeding the other param (a reusable *Param Out* node appears in the GRAPH ENGINE section, reading one frame behind — the same clean delay as a feedback loop).

Drag a generator's OUT to any param jack to route it (or drag from the param jack back); drop a plugged cable in space to unplug; drag a SOURCES jack into a SRC IN to pick that generator's signal. It's the same Classic matrix you already know — the cables *are* the slot Source/Target settings, so the Modulation panel's dropdowns update as you patch (and vice versa).

#### Video Source A/B and Composite

<div class="about-flow" data-flow="composite"><span class="about-flow-cap">Blending two pictures: a camera on A, the Pattern Generator’s OUT on B, and the blend sent to the Renderer.</span></div>

A **VIDEO SOURCE A** module switches webcam/screen/file (the same switch as Controls ▸ Video Source A), and an independent **VIDEO SOURCE B** module does the same for a second feed — each with an expandable **live preview** of the incoming signal and an OUT jack. Source B also has its own **Video Source B** group in Synth ▸ Controls (next to Source), with the same full webcam-device / screen / file / stream-URL picker Source A has — pick a different camera than A, the same camera twice, a video file, or a stream URL; it remembers its own device choice (`deviceIdB`) independently of Source A's. A **COMPOSITE** module takes two video inputs plus the same 8 blend modes the Pattern Generator uses (Add, Subtract, Multiply, Screen, Difference, Mask, Crossfade, B-only) and a mix control. Drag Source A's OUT jack and Source B's OUT jack onto Composite's A/B inputs, then Composite's OUT onto the **RENDERER** module's IN jack, and the blend becomes what the mesh actually displaces — a file layered over a webcam, a screen-share crossfaded with a camera.

RENDERER IN always shows the cable for whatever's actually feeding it, including Source A — dragging Source A's OUT onto RENDERER IN explicitly is a real, confirmable connection, not a no-op (an earlier "normalled jacks are invisible" version of this made that specific drag look like it silently failed, since Source A already IS the default and a same-value Settings write produces no visible change on its own). Unplugging RENDERER IN falls back to Source A same as before. The **RENDERER** module's own expandable **live preview** monitors the final rendered output — it lives on the sink itself, not a separate module.

A **DUAL RASTER** module gives raster A and raster B (Synth ▸ Dual Raster) two genuinely different feeds instead of the shared signal they mirror by default: drag Video Source A/B (or the Composite node's output) onto its A/B inputs, then its OUT onto RENDERER's IN — wiring that connection turns Dual Raster on for you, same as patching a graph cable wakes the modulation engine. The module also carries EVERY raster-B control as a full IN/knob/value/OUT param cell — enable, wipe/alternate mode, the trace-position slider, and all of raster B's own Position & Size / Depth & Beam / Rotation / Linearity / Luminance shaping — so the whole Dual Raster feature is patchable and playable from the bay, not just its routing.

#### Pattern Generator

It also has a video **OUT** jack, so the pattern can be used as a third picture source alongside Video Source A and B: patch it into **RENDERER** (pattern alone, no camera needed), into **COMPOSITE A/B** (blend it with a camera or file), or into **DUAL RASTER A/B** (camera on one raster, pattern on the other). While the OUT is patched anywhere, the pattern stops overlaying and shows only where the cable goes; unplug it to get the overlay back.

A **PATTERN GENERATOR** module puts the whole synthesized-pattern layer in the bay too: a corner LED plus a clearly labeled **enable** checkbox, a kind picker (Calibration/Waveform/Noise/Oscilloscope, same grouping as Controls), a blend-mode dropdown, a mix field, and — the useful part — a set of supporting-property cells that changes to match whatever kind is currently selected (Solid shows just Brightness; Lissajous shows Brightness/Frequency/Freq Ratio/Phase Offset/Thickness; Oscilloscope shows its own scope-specific set), instead of showing every pattern param at once regardless of relevance. Each of those cells is a full IN/OUT jack pair, same as any faceplate param — patch a Function Generator straight into Brightness, or drag Frequency's own OUT elsewhere. This is the ONE home for these params: the general faceplate deliberately has no separate "Pattern" field group, so there's never two competing jacks for the same signal. An expandable **live preview** on the module itself shows the raw pattern actually being generated (before it's composited with video), the same monitor style as the Video Source and Renderer modules.

#### The Graph Engine section

A **GRAPH ENGINE** section shows one module per graph node in the patch (labeled LFO, Audio Envelope, Sync, etc. — not one generic chip) — **every** node in the patch, active or not; a node with no connections anywhere is dimmed so it reads as a placeholder, not a signal in use. Each module is a full peer of the FUNCTION GENERATOR modules: drag its header to reorder or break it into free layout, same as any other module.

Its cyan param cables are draggable too: grab a bound param's jack and drop it on a different param to re-route that node's output there, or drop it in empty space to unplug it (the binding stays in the graph, just detached, so you can re-plug it later); a node feeding several params at once (fan-out) only moves the one cable you grab, the others hold. Some nodes also take an input from ANOTHER node instead of just producing an output (Ramp's trigger, Noise's clock) — those render as amber IN jacks, wireable straight from another node's OUT jack (drag either end), no need to open the Graph editor's canvas just for that. Drag a node's OUT jack straight onto a faceplate param too — say an LFO onto H Position — and it patches a live binding the same way a Classic slot's cable does; a node's own OUT jack stays fixed as a source either way (grabbing it only ever adds a new connection, never retargets or removes one).

Node params render as real controls on the module — rotary knobs for numbers, dropdowns for choices — and waveform pickers like the LFO's *shape* get their own small jack: **drag TRI from the SOURCES bus onto it for a triangle wave** (the cable stays plugged as a picture of the current shape). Each module also shows a mute LED right on the faceplate, no need to open the Graph editor's inspector for a quick toggle.

Two node types are worth calling out:

- **Scope** — splice it into any cable to see the live waveform on its module, phosphor-style; it passes the signal through unchanged.
- **Note** — a real text area right on the module, ComfyUI-style, for annotating a patch — same as the Graph editor's own on-canvas note editing.

#### Adding and arranging nodes

**Right-click any empty board background** for a categorized Add Node menu (the same node list the Graph editor's palette has, Blender/Max-MSP style) — the new module **spawns free-floating right where you clicked**, never overlapping another module, ready to wire up without leaving the bay; it also shows up as a normal row in Controls ▸ Modulation's Beginner view (switching out of Classic mode automatically if needed), so the two surfaces always agree on what the patch is — and any patching gesture wakes the graph engine automatically, so a fresh wire is always live, never silent.

Every graph module has a small **✕** in its header — click it to remove that node, with a confirmation ("Delete node 'X'? This also removes any of its connections.") before anything is actually deleted; Cancel leaves it untouched. Deleting a node unplugs any other node's input wired from it and drops any binding it was driving, same cleanup the Graph editor's own right-click delete does (one shared removal, so both surfaces stay consistent).

Loading a sample or library patch while you have a patch going asks before replacing it (Cancel keeps yours).

New to the bay? **Help ▸ Patch Bay Tutorial** is a second guided walkthrough teaching spawning, knobs, wiring, and the Scope, with try-it buttons. Open the bay from a region dropdown or `Window ▸ Layout ▸ Patch Bay`.

#### Cable and jack states

Cables and jacks carry real visual states, not just one static look:

- **Idle hover** — rest the mouse over a jack (no drag) and it glows softly; hold it a beat longer and a tooltip explains what it does. Rest over a cable itself and it gets the same subtle glow.
- **Select** — click a cable to highlight it with a bright white outline, useful for tracing one connection through a busy patch. Click empty background, or another cable, to clear the selection.
- **Drag and drop** — grab any jack and the candidate jacks it could snap to light up in the color the resulting cable would actually be (green for a Function Generator cable, cyan for a graph binding, amber for a node-to-node wire, purple for video routing, pale mint for a SOURCES cable) — a live preview of what connecting there would create, not a flat highlight. The cable being dragged also fades toward white as it nears a valid target, or toward red while it's floating over empty space with nothing to snap to — a second, always-visible signal layered on top of the jack glow. The mouse cursor itself switches to match: a plug icon over jacks, a checkmark when the drag is over something it can connect to, a "no" glyph when it isn't. A delayed tooltip names what dropping there will do.
- **Untether** — drop a plugged cable in empty space to unplug it; drop an OUT jack's cable in empty space and nothing happens, since an output can feed several connections at once and there's no single "the" cable to remove from there.

Modules and graph nodes get the same treatment: hover a unit's header bar and it glows to show it's grabbable; click a header (without dragging) to select the unit with a bright outline — useful for keeping track of one node in a busy patch — and click empty board background to clear the selection. Dragging any unit keeps the cursor showing a consistent "grabbing" glyph for the whole gesture.

The custom cursor treatment isn't limited to the Patch Bay — every clickable control, drag handle, resize edge, text field, and even the plain resting pointer across the whole app uses an on-theme glyph instead of the browser's native cursor, so the interface reads as one consistent instrument end to end.

### On a phone

On a phone the app switches to a **camera-style layout**: the picture fills the screen and the controls float over it.

- **Top strip** — the current look's name and a help button.
- **Capture dock** — swipe the **looks** carousel and tap a look to apply it. Below it: **flip camera** (front/back), the **shutter**, and a **Photo / Video** switch. In Photo mode the shutter saves a PNG (through the phone's share sheet where available); in Video mode it starts and stops a recording, with a running timer, and offers **Share** when the file is saved.
- **Tab bar** — **Source**, **Shape**, **Motion**, **Color**, **More**. A tab opens a sheet of real controls; drag the sheet down to peek at the picture, or long-press the picture to hide everything.
- **Source** leads with four big choices: front camera, back camera, a video from your library, or the built-in pattern. The picture's shape follows the camera, so a portrait selfie fills a portrait screen.
- Turn the phone sideways and the dock becomes a rail on the right edge.

The phone deliberately leaves out what needs a mouse, a keyboard or hardware: the **Patch Bay**, the **Timeline**, the node-graph editor, MIDI, OSC, CV, MCP, XR, Dual Raster, Video Source B and live broadcasting. They are all still there on a desktop browser, and your saved looks and projects open on either.

### Remote control via MCP

The whole synth is drivable from an MCP client (Claude Desktop, Claude Code, ...) — see I/O ▸ [MCP (remote control)](#mcp-remote-control) for the full tool list and setup.

### Slider tricks

Every numeric control accepts typed input in the box beside the slider; double-click (or double-tap) resets to default; arrow keys nudge by one step. The small **▾ at the top-left of every slider** opens its value & range menu: set a **custom range** (a min/max clamp — widen a slider up to 5× its stock span past either bound for extra headroom, or narrow it into a fine-tuning vernier), reset the range, or reset the value. **Right-clicking the slider** (or tapping its readout on touch) opens the same precise-entry panel directly. Custom ranges persist with your project; the ▾ and number box glow while one is active.

### Hover tooltips

Hold the mouse still over any parameter row or section header for about half a second and a short description pops up above it, explaining what that control does. Move the mouse away and it disappears immediately. This is the same text that drives the in-app Help's Controls tab and this manual's Param Reference — one description, everywhere it's needed. Mouse only (there's no hover state to speak of on touch); nothing to turn on or off.
