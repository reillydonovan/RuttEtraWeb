# Rutt/Etra Web Synthesizer

A browser-based recreation of the **Rutt/Etra Scan Processor** — the legendary 1973 analog video synthesizer designed by Steve Rutt and Bill Etra. This implementation runs entirely in the browser with no backend required. Feed it a webcam, a video file, or your screen, and it renders the iconic scan-line effect where scan lines are displaced along the Z axis in proportion to the brightness of each pixel.

It also speaks **Web MIDI**, **multi-band FFT audio reactivity**, and **OSC over WebSocket** out of the box.

---

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and click **REQUEST WEBCAM**.

## Build for production

```bash
npm run build
```

`dist/` is fully static — deploy to GitHub Pages, Netlify, Vercel, or any static host with no server configuration needed.

---

## Recent changes (v1.27.4, July 2026 — custom stepper arrows for Patch Bay value fields)

- **The Patch Bay's per-param value fields now have real, CRT-styled up/down stepper buttons** in place of the browser's native spin arrows suppressed in the previous release — owner: "there should be stepper arrows just stylized to fit the aesthetic of the design system." New reusable `attachNumberStepper()` widget (`widgets.ts`): a thin two-button column (green chevron icons, matching the app's cursor/dropdown-chevron visual language) glued to the input's right edge; click steps once, press-and-hold repeats, respecting the field's own min/max/step. Every step still fires the same `input`/`change` events the field's existing listener already handles — no separate value path.

## Recent changes (v1.27.3, July 2026 — native number-input spin buttons suppressed)

- **`<input type="number">`'s native up/down spin-button arrows are now suppressed app-wide** — found on the Patch Bay's per-param value fields (wide enough for Chromium's spinner cluster to render at full, unstyled size, unlike the tighter Controls-tab number boxes): a plain grey OS stepper with the default cursor, same root cause as the `<select>` chevron bug just below. Removed rather than reskinned — every number field already has a real adjust-without-typing affordance (a paired knob, a paired slider, or drag-to-scrub), so there's no missing feature to replace.

## Recent changes (v1.27.2, July 2026 — native `<select>` chevron/cursor fix)

- **Every dropdown in the app now draws its own CRT-styled chevron instead of showing Chromium's native grey arrow button.** `.rw-select` had `background`/`border`/`color` styling for a long time but never `appearance: none`, so the browser kept rendering its own native dropdown-arrow sub-widget on the right edge regardless — unstyled, and (a related Chromium quirk) showing the OS default cursor there even though a custom cursor rule was already set on the element. Found from an owner screenshot showing a correctly-themed value box with an unstyled grey system chevron glued to it.

## Recent changes (v1.27.1, July 2026 — Dual Raster module relocated in the Patch Bay)

- **The DUAL RASTER module now lives in the right-hand column (`col2`), above COLORIZER / POST-FX**, instead of the crowded left rail stack — its full-controls pass (previous release) grew it to ~20 rows, dominating what used to be a compact column of small Function Generator/Composite/Video Source modules. Pure layout change: drag/reorder/free-layout behavior is unaffected (the underlying machinery was already container-agnostic).

## Recent changes (v1.27.0, July 2026 — Dual Raster full Patch Bay controls, Video Source B in Controls tab; Settings v35)

- **The DUAL RASTER Patch Bay module now carries every one of its own controls** — an enable LED + labeled toggle, the wipe/alternate mode dropdown, and full IN/knob/value/OUT param cells for the trace-position slider and all 16 of raster B's own Position & Size / Depth & Beam / Rotation / Linearity / Luminance params — grouped under labeled sub-sections, matching the Controls tab's own layout. Previously the module only had its two video-IN jacks and one OUT jack; every one of those 17 modulatable params was quietly reachable only through the general faceplate's AUXILIARY catch-all, disconnected from the module that's conceptually "about" them.
- **Video Source B — a new "Video Source B" section in the Controls tab** (Synth, next to Source) — a full webcam-device / screen-capture / video-file / stream-URL picker, identical to Source A's, for the Patch Bay's second video feed. Previously Source B was only reachable via the Patch Bay's own one-click "default webcam only" module. Source B now remembers its own webcam device choice (`deviceIdB`, Settings v35) independently of Source A's — pick a different camera, the same camera, a file, or a stream.
- Settings schema **v34 → v35**: `deviceIdB` (new key) and `sourceBKind` widened to include `'stream'` (previously WEBCAM/SCREEN/FILE only).

## Recent changes (v1.26.0, July 2026 — audio node framework, Phase 1: LFO/graph signal → audible tone)

- **New "Sonify" graph node** (category Audio) — a sink node, same shape as CV Output: wire any graph signal (an LFO, envelope, anything) into it and it delivers that value once per frame to the Sonification voice.
- **Sonification's per-param mapping dropdowns (Pitch / Amplitude / Cutoff / Resonance) gained a "Graph Node" option** alongside the existing eight mesh stats — pick it on any of the four and that parameter is driven by whatever the Sonify node last supplied, through the exact same curve/smoothing/AudioParam pipeline every mesh-stat mapping already uses. No second AudioContext, no new ramp/limiter code — this reuses the existing safety-gated voice (default disabled, quiet default, soft-start ramp, brick-wall limiter, mic-feedback gate) entirely.
- Scoped as Phase 1 of a larger "audio node framework" ask (LFO → audible tone / uploaded video-file audio routing / mic input as a patchable node) — the other two phases are intentionally deferred; this is the smallest, lowest-risk piece and the one that reuses existing machinery most directly.
- Found and fixed a real ordering hazard while wiring this up: the Sonification instance's construction was moved earlier in `main.ts`'s boot sequence, ahead of the Graph engine factory — the factory's dependency object now references `sonification`, and it can be pre-warmed as early as boot if a saved session already has a non-Classic mod mode, which was before the old construction point ran.

## Recent changes (v1.25.1, July 2026 — popout right-click node-spawn fix)

- **Fixed: right-clicking to add a graph node in a popped-out Patch Bay window spawned the node at the main window's click coordinates instead of the popout's own.** Root cause: the "Add Node" context menu was built, appended, and positioned against the bare global `document`/`window` — which, since the Patch Bay's setup code always runs in the MAIN window's JS context regardless of which window its `root` element ends up living in (per the popout architecture: a fresh instance is built by the opener and then adopted into the popup document), resolved to the wrong window's document body and viewport dimensions. Fixed by building/positioning the menu against `root.ownerDocument`/its `defaultView`, the same convention already used elsewhere in the file (tooltips, the cable canvas) for popout-safety.

## Recent changes (v1.25.0, July 2026 — Patch Bay node hover/select/drag-cursor states)

- **Graph node/module header bars now show a hover cue** — resting the mouse over any Patch Bay unit's header (a Function Generator, a graph node, a faceplate field group, the SOURCES bus) glows softly, signaling it's the grab handle before you commit to a drag.
- **Click-to-select for nodes and modules** — click a unit's header to give it a bright, persistent white outline (the same visual language the cable click-to-select already uses); click empty board background to clear it. Selecting a unit clears any cable selection and vice versa, so the two outline styles never compete for attention.
- **The cursor now stays a consistent "grabbing" glyph for the full duration of any node drag** (reorder in TIDY mode or a free move), instead of only being guaranteed correct while directly over the dragged unit's own box — fast pointer motion could previously outrun the moving element and flicker the cursor back to default.

## Recent changes (v1.24.0, July 2026 — custom cursor graphics app-wide)

- **Every browser-default cursor in the app is now a custom on-theme glyph** — not just the Patch Bay. A shared `src/ui/cursors.css` defines one set of small SVG cursors (a subtle ring-and-dot for anything clickable, a move-cross for drag handles, a red slash-circle for disabled/blocked, a green "?" for help, a fine reticle for precise-pick tools, directional double-arrows for resize handles, a styled I-beam for text entry, and even the plain resting arrow) and every stylesheet in the app — panel, timeline, graph editor, workspace tabs, menu bar, layout, tutorial, rack skin — references the same tokens instead of hand-rolling its own. Native `<select>`/checkbox/radio controls and every text input get the treatment too via a couple of unscoped safety-net rules, and the browser's own middle-click autoscroll cursor is suppressed app-wide so it can never sneak in.
- Found and fixed a real CSS specificity bug while wiring this up: the rack skin's own jack-cursor rule was silently outranking the Patch Bay's under the app's default skin — fixed with a scoped `!important`.

## Recent changes (v1.23.0, July 2026 — cable accept/reject gradient + custom cursors)

- **Cable accept/reject gradient** — the cable being dragged now fades toward white as it nears a valid drop target, or toward red while floating over empty space with nothing to snap to, layered right on top of the jack's own per-kind hover glow (not a replacement for it).
- **Custom cursor graphics throughout the Patch Bay** — every native browser `grab`/`grabbing` cursor is replaced with a small on-theme glyph: a move-cross for panning the board or dragging a module, a plug ring/filled-circle pair for idle/dragging jacks, and a checkmark/slash pair for whether a drag is currently over something it can connect to.
- The default left-to-right layout experiment from the previous round was tried, then reverted per owner feedback — the Patch Bay's default layout is the classic stacked list again, with TIDY/FREE as the only toggle (no ARRANGE button).

## Recent changes (v1.22.0, July 2026 — Patch Bay cable states)

- **Cable and jack visual states** — resting cables/jacks now support idle hover (a soft glow, plus a delayed tooltip), click-to-select (a bright outline you can toggle by clicking elsewhere), and a drag-time preview: dragging a cable colors the candidate jacks it could snap to in the color the resulting connection would actually be (green for Function Generator cables, cyan for graph bindings, amber for node-to-node wires, purple for video routing) instead of one flat highlight, with a delayed tooltip naming what dropping there does. Dropping a plugged cable in empty space unplugs it (an OUT jack's cable does nothing, since one output can feed many connections).

- **Fixed a real Pattern Generator wiring bug** — dragging a Function Generator's cable onto a Pattern Generator param (Brightness, Frequency, etc.) silently did nothing. Root cause: the general faceplate still had a leftover AUXILIARY catch-all copy of every `patternXxx` param (from before those params got their own dedicated jacks on the Pattern Generator module), and two `addParamCell` calls for the same key silently steal each other's jack registration — the faceplate's copy was winning, so the Pattern Generator's own visible jack wasn't actually the one being dragged onto. The faceplate now excludes pattern-owned keys entirely; one authoritative jack per param.
- **Pattern Generator live preview** — the module's own expandable monitor now shows the raw pattern actually being generated (before compositing with video), the same style as the Video Source/Renderer previews. `PatternRenderer` reads back a small offscreen copy only while the preview is expanded, so it costs nothing collapsed.
- **TIDY is now a toggle** — the button reads **FREE** in stacked layout (one click breaks every module out into free layout) and **TIDY** in free layout (one click snaps back), instead of only ever restoring.
- **Delete a node from the Patch Bay** — every graph module gets a small ✕ with a confirmation dialog ("Delete node 'X'? This also removes any of its connections.") before removing it; Cancel keeps it. Shares one removal implementation with the Graph editor's own right-click delete (`deleteGraphNode` in `rackGeometry.ts`) so both surfaces agree on cleanup (unwiring other nodes' inputs from it, dropping its bindings).
- **Fixed popped-out windows' add-tab menu** — selecting Timeline/Renderer/etc. from a popup's own `+` menu did nothing; a cross-window `instanceof Node` check always evaluated false against a node from the popup's own JS realm (the classic reason `Array.isArray` exists instead of `instanceof Array`), so the menu's own click was read as "outside" and closed itself one event before the item's handler could fire.

## Recent changes (v1.20.0, July 2026 — Dual Raster node, About-page documentation pass)

- **Dual Raster node in the Patch Bay** — a new DUAL RASTER module gives raster A and raster B genuinely independent video feeds instead of the shared signal they mirror by default: wire Video Source A/B (or the Composite node's output) onto its two inputs, then its OUT onto the RENDERER module's IN. Wiring that connection turns on Dual Raster mode for you automatically. Closes a gap the Dual Raster feature's own design doc had flagged as explicitly out of scope when it first shipped. Settings schema v34.
- **About page documentation pass** — MCP now has full coverage (a dedicated I/O section with the complete tool list, plus the wire protocol in Reference), two missing keyboard shortcuts were added to the Reference table (`H` for HUD toggle, `Ctrl+=`/`Ctrl+-`/`Ctrl+0` for Text Size), and Quick Start's window-management and Patch Bay content — previously a handful of giant paragraphs — was restructured into real headed subsections so the manual's own sidebar table of contents can actually navigate it.

## Recent changes (v1.19.0, July 2026 — Pattern Generator in the Patch Bay, popout tab bar, Note node fix)

- **Pattern Generator controls in the Patch Bay** — a new PATTERN GENERATOR module: an enable LED, a kind picker (grouped by category, same list as Controls), a blend-mode dropdown, a mix field, and a **dynamic supporting-properties section** that shows only the parameters relevant to whichever pattern kind is currently selected — Solid shows just Brightness; Lissajous shows Brightness/Frequency/Freq Ratio/Phase Offset/Thickness; Oscilloscope shows its own scope-specific set. Switching kind applies that pattern's defaults immediately, exactly like the Controls tab.
- **Popped-out windows now have a real tab bar** — every popup opened via a window's ⧉ button gets its own local tab strip with a `+` to add more views (Renderer/Controls/Timeline/Patch Bay), matching the in-document window chrome. Found and fixed two real bugs while building this: switching tabs was silently breaking the Patch Bay's cable canvas (a DOM re-parent was interrupting whatever sizes it), and closing a tab could leave its content still rendering underneath the active one (the `hidden` attribute loses to any ordinary CSS class that sets `display`).
- **Note node fixed** — adding a Note via the Patch Bay's right-click menu produced a module with nothing to type into. It now has a real text area, same as the Graph editor's own inline note editing.

## Recent changes (v1.18.0, July 2026 — Video Source A/B Composite)

- **Composite two video sources into the render output** — a second, fully independent **Video Source B** (webcam/screen/file, its own picker and live preview) joins the existing source, plus a **Composite** node in the Patch Bay with two video inputs and the same 8 blend modes the Pattern Generator already uses (Add, Subtract, Multiply, Screen, Difference, Mask, Crossfade, B-only) and a wet/dry mix. Drag Video Source A's OUT jack and Video Source B's OUT jack onto Composite's two inputs, then Composite's OUT onto the new **Renderer** module's IN jack, and the blended feed becomes the mesh's video input — a file layered over a webcam, screen-share crossfaded with a camera, whatever two feeds you want to combine. Nothing changes for existing sessions until you actually drag a cable: the Renderer's IN jack defaults ("normals," in Eurorack terms) straight to Video Source A, byte-for-byte the same as before. Settings schema v33.

## Recent changes (v1.17.0, July 2026 — MCP remote control, popout windows, patch tutorial, bay previews)

- **MCP remote control** — drive the entire synth from any MCP client (Claude Desktop, Claude Code, ...): `tools/mcp-server/` hosts a local stdio↔WebSocket bridge; the browser connects out to it from the new **I/O → MCP** section (opt-in, like every I/O route). Tools cover every modulatable parameter (`list/get/set_param` with ranges from the param docs), every registered app command (`list/run_action` — save, load sample patches, layout presets, tutorials...), the whole modulation graph (`get/set_graph_patch`, `add_graph_node`, `list_node_types`), arbitrary settings reads, and PNG **screenshots** of the output. The surface rides the app's own registries, so it grows automatically as params/actions/nodes are added. Settings schema v32.
- **Pop any window out to a separate display** — every workspace window bar now has a ⧉ button beside maximize/collapse that opens the window's active view as a standalone OS window: Patch Bay and Timeline get a fresh fully-live instance (duplicates sync through the shared stores, so closing the popup loses nothing); Controls and the Renderer route to their existing specialized popouts.
- **Patch Bay tutorial** — Help ▸ **Patch Bay Tutorial**: a second opt-in guided walkthrough teaching the modular surface — param stations, right-click node spawning (with try-it buttons that add an LFO and a Scope for you), wiring, live values, free layout and TIDY.
- **Nodes spawn where you right-click** — Add Node now drops the new module free-floating at the cursor (entering free layout if needed) instead of appending it to the left stack, and spawned modules can never overlap existing ones (collision resolution got a guaranteed park-below fallback for dense boards). Also fixes nodes added while already in free layout landing statically at the board's top-left over other modules.
- **Preview monitors in the bay** (think TouchDesigner): VIDEO SOURCE gains an expandable live monitor of the incoming feed, and a new **RENDER PREVIEW** module shows the final output — both draw the one real source/canvas, collapsed by default and free when collapsed.
- **Scope flat-line fixed** — wiring nodes together while the Modulation section was still in Classic mode silently left the graph engine asleep (every output read 0, so the Scope drew a dead line). Any patching gesture in the bay now wakes the graph engine automatically, same as loading a sample patch always has.

## Recent changes (v1.16.0, July 2026 — sample patches, Notes node, interactive tutorial)

- **Notes node** — a free-text annotation node for the Graph editor (ComfyUI-style): drop one from the Meta category in the palette, type directly into its on-canvas textarea to document a patch. No signal effect, no inputs/outputs.
- **Sample patches from the top bar** — File ▸ **Load Sample Patch** lists the same starter patches the Graph editor's Library sidebar has, now reachable without opening the panel first. Two new ones (*Getting Started — Breathing Z Push*, *Annotated: Audio-Reactive Bloom*) ship with a Notes node explaining themselves.
- **Interactive tutorial** — Help ▸ **Start Tutorial** (opt-in only, never shown automatically): an 8-step guided walkthrough that dims the app, spotlights the control being discussed, and floats an interactive callout with Back/Next/Exit — source → Z Push → camera → modulation → try a sample patch → save. The highlighted control stays fully interactive the whole time (the dim is a visual overlay, not a click-blocker), so a step can say "try dragging this" and you actually can.
- **Patch Bay: per-node GRAPH ENGINE modules, now fully draggable** — the bay's graph section no longer collapses every graph-sourced cable into one generic "GRAPH ENGINE" chip; it shows one module per graph node that's actively feeding a param, labeled from the node registry (LFO, Audio Envelope, Sync, etc.), so a cable tells you *which* node is driving it. Those cables are draggable exactly like a Classic slot's: grab a bound param's jack and drop it on a different param to re-route that node's output there, or drop it in empty space to unplug (the binding stays in the graph, just detached — re-plug it any time). A node feeding several params at once only moves the one cable you grab; the node's own output jack stays fixed since it can fan out to more than one binding. Both a picture and an edit surface of the exact same `modGraph` bindings the Graph editor works with — no parallel data path.
- **Patch Bay: graph node modules move and reorder like every other module** — a GRAPH ENGINE module is now a full peer of a FUNCTION GENERATOR module: drag its header to reorder it in the rail, break it out into the Max/MSP-style free layout, and TIDY it back, exactly the same gesture set.
- **Patch Bay: node-to-node wiring** — some graph nodes take an input from another node (Ramp's trigger, Noise's clock) rather than just producing an output; those now render as draggable IN jacks on their Patch Bay module, wireable straight from another node's OUT jack (drag either end) or unplugged by dropping in empty space — no need to open the Graph editor's canvas just to wire a trigger.
- **Patch Bay: every graph node gets a module, and you can add one right there** — the GRAPH ENGINE section used to show only nodes actively feeding something; it now shows every node in the patch (dimmed if not yet connected to anything), matching a real node editor. Right-click empty board background for a categorized **Add Node** menu (Blender/Max-MSP convention) — pick a type and it appears immediately with all its jacks ready, ports and all, so you can wire it up on the spot without leaving the bay. Nodes added this way stay in sync with Controls too: a companion binding makes the new node show up as a normal row in the Modulation panel's Beginner view, and modulation mode switches out of Classic automatically if needed so it's actually live, not just sitting in the patch inert.
- **Patch Bay: control knobs on every graph node** — a module's own params (LFO's shape/rate/range/phase/duty/bipolar, and so on for every node type) render right on its faceplate now, plus a mute LED — no need to open the Graph editor's inspector just to tweak a rate. Feels like a real synth voice: jacks in, knobs in the middle, jack out.
- **Patch Bay: drag any node's OUT straight onto a param jack** — dragging a graph node's output onto e.g. H Position now creates a live binding on drop (it used to only recognize another node's input, leaving the cable dead with nowhere to land); grabs the node's own placeholder connection if it has one instead of stacking up an extra binding.
- **Patch Bay: every faceplate jack shows its real value, editable in place** — Position & Size, Depth, Rotation, Camera, Pattern, every field group now has a live number field under each jack, so you can run the whole synth from the bay without ever opening the Controls tab. Same base-value write every slider in the app makes; any modulation already patched into that param keeps layering on top live.
- **Patch Bay: the eurorack pass** (owner's own RE-4 photo as the reference) — **rotary knobs** on every faceplate param and every graph-node number param (drag vertically, Shift = fine, double-click = reset), corner screws on every module, and **live modulated values shown in amber** the way Controls shows them: an amber needle rides each knob and a `▸ value` readout appears under the field while an LFO/CV/graph signal drives the param.
- **Patch Bay: per-param OUT jacks** — like the hardware, every param row now has an input AND an output. Drag a param's OUT jack onto another param (Height OUT → Depth IN) or into a node's input; behind the scenes it creates a reusable **Param Out** graph node reading that param's live value (one frame behind, same as a feedback loop).
- **Patch Bay: waveform jacks pick node shapes** — drag SINE/TRI/SQR/SAW/PULSE from the SOURCES bus straight onto an LFO's shape jack to pick its wave; the cable stays plugged as a picture of the current shape.
- **New Scope node** — a passthrough oscilloscope (out = in, unchanged): splice it into any cable and its Patch Bay module draws the live waveform, phosphor-style. Chosen over static per-LFO waveform icons because it shows the *actual* signal anywhere in a chain.
- **Free layout: no more overlapping nodes, no more floating labels** — dropped modules push themselves out of collisions on release, and the GRAPH ENGINE section label no longer floats disembodied at the top-left after breaking modules out of the stacks (a real reported bug).
- **Loading a sample/library patch now warns before replacing a non-empty graph patch** — OK replaces, Cancel keeps what you have. Patches were already included in every save format (Projects, Presets, Timelines all snapshot full Settings including the graph).
- **Patch cables render correctly at any Global Text Size** — a real cross-cutting bug: every cable canvas (Patch Bay, rack skin overlay, graph editor) sized itself in a way that ignored the page's CSS `zoom` (Text Size preference), so cables visually landed at `zoom×` their true jack position — invisible at 100% but obvious at any other scale, and it got worse while resizing a window. Fixed at the shared root (`ui/cableDraw.ts`'s `fitCableCanvas`), verified at multiple text scales and window sizes.

## Recent changes (v1.15.0, July 2026 — timeline pan/zoom, format-aware length field, keyframe verification)

- **Timeline track: scroll and zoom like Premiere/Blender/Resolve** once a zoomed-in track extends past the dock's width — plain wheel still scrolls lane rows vertically as before; **Shift+wheel pans horizontally**; **Ctrl/Cmd+wheel zooms**, anchored to the bar under the cursor so that point stays put (the same cursor-anchored recipe the Patch Bay's board zoom already uses). The `−`/`+` transport buttons still work exactly as before.
- **The timeline's LENGTH field now follows the DISPLAY format** (owner request): it reads "BARS" in Bars/Beats as always, but relabels to total **runtime in seconds** for Timecode, a total **frame count** for Frames, and a total **sample count** for Samples — editing any of them converts back to the underlying whole-bar count (the one real stored value; these are editing-unit conversions on top of it, same principle as the read-only playhead counter). Fixed a real bug surfacing this: the native spinner arrows (and the new drag-scrub, below) were nudging the value by too fine a step to ever cross into a different whole bar, so they visibly "did nothing" — the step is now exactly one bar's worth in whatever unit is showing.
- **Click-to-type, drag-to-scrub number fields** (Unity/Blender-style) on the timeline transport's BPM / LENGTH / B-BAR fields — hover shows a vertical-drag cursor, a plain click still focuses for typing, but dragging up/down adjusts the value continuously (hold Shift to fine-tune).
- **Verified the panel keyframe diamonds** (◇/◆) and their ◀ ▶ jump-to-keyframe arrows still work correctly for every parameter, across all three skins (CRT/Hardware/Rack) — a reported regression didn't reproduce against a fresh build; if you still see it, it's very likely a stale `npm run dev` process from earlier in a long session (its hot-reloaded code is current, but its boot-overlay version stamp is captured at server start, so it can look older than it is) — restart the dev server and hard-refresh.

## Recent changes (v1.14.0, July 2026 — patch bay canvas panning, video source node, global text size, layout fixes)

- **Patch bay: click-drag-to-pan** — grab any empty background (not a module, jack, or control) and drag to scroll the board around, the standard node-editor gesture (Blender/Unity/Figma), alongside the existing scroll-wheel/button zoom. A free-form (broken-out) layout also gets **150px of pan headroom** on every side so the outermost node's far edge is reachable instead of sitting flush against the scrollport — scoped to free mode only, and switched off again the moment the bay narrows into its vertical-stack mode (stacked flow already fills the width; the extra room would just be dead space).
- **Patch bay: a VIDEO SOURCE module** — WEBCAM / SCREEN / FILE buttons plus a live readout, wired directly to the same `VideoSourceManager` Controls uses (not a mirrored copy): switching the source from the bay or from Controls is the same state either way. Camera and Pattern Generator params were already jacks in the bay (built from the same `TARGETS`/`PARAM_DOCS` join Controls reads); this was the one missing "where does the picture come from" control.
- **Patch bay: flow-layout nodes now dynamically resize with the window** — the default (non-free) stacked layout used to hold its intrinsic width and just clip/scroll between "maximized" and its ~900px narrow floor; it now reflows continuously, and a broken-out free arrangement rescales its nodes' horizontal size proportionally as the window shrinks/grows instead of holding stale pixel geometry.
- **Global text size** (View → Text Size, `Ctrl+=`/`Ctrl+-`/`Ctrl+0`) — a legibility preference for users who find the default hard to read, stored like the skin (`localStorage`, not a Settings/project value) and left at its default for everyone who never touches it. Implemented via a `zoom` scoped to each workspace window's *content* rather than the window itself — an early version zoomed the window shells directly, which re-scaled their already-resolved pixel `left`/`right` insets a second time and desynced window edges (confirmed and fixed before shipping).
- **Fullscreen (maximized) windows are now always opaque** — a maximized window used to inherit its normal translucent CRT-panel background, which is fine stacked over the app's dark base but let the still-rendering 3D canvas underneath bleed through once maximized (the timeline dock most visibly). Maximizing now forces a solid backdrop for every window except the renderer's own maximize, where seeing the canvas through the frame is the point.

## Recent changes (v1.13.0, July 2026 — true multi-instance windows + node-editor patch bay)

- **Every view is now FULLY multi-instance** — duplicate tabs of the same view are live simultaneously in different windows: two TIMELINES both playing, two CONTROLS panels both editable (all instances bind the same Settings/Sequencer stores, so they mirror by construction — no placeholders, no "shown in another window" beat). Enabled by converting the Sequencer's five single-assignment callbacks to additive multicast accessors (`seq.onX = fn` now subscribes — this also fixed a latent bug where RecordSection silently clobbered the timeline dock's callbacks) and by per-window instance factories for Controls/Timeline (`src/main.ts`).
- **The patch bay became a real node editor** (Max/MSP patterns, owner-directed): **zoom** with the scroll wheel (cursor-anchored) or the −/100%/+ buttons — the cable canvas stays screen-space so lines are crisp at any zoom; **drag any module by its header** to reorder within the vertical stacks (a thin insertion line shows the landing slot) or drop it past the stacks to **break the board into free layout**, where nodes drag anywhere with **magnetic snapping** (left/top align, stack-above/below with a 10px gap); **TIDY** snaps everything back to the flow layout. A custom free arrangement **survives narrow-mode round-trips** — squeezing the bay into a small window stacks it temporarily and restores every node's position when widened. Empty-zone tab drops now cover the **top edge** too (bottom window docked top), completing the proximity pattern on all four sides.

## Recent changes (v1.12.0, July 2026 — Unity tab model, 4-up default, tutorials)

- **True Unity/Blender tabs** (Settings v30 → **v31**) — every window holds an ordered **tab strip**: click tabs to switch, **drag a tab** onto another window's strip to move it (a thin **insertion caret** nudges between tabs to show the landing slot; during a drag, only the empty window NEAREST the pointer reveals itself as a labeled drop strip — proximity-based, never all at once), drag within a strip to **reorder**, and **✕ closes a tab** (reopen via any window's [+]). Tab strips are the one and only drop target — no separate edge zones. **Moving a view never assigns anything to another window** — the source window just falls back to its own next tab, and a window with zero tabs hides entirely.
- **[+] always just adds a tab** — never moves, never touches another window, no "(moves here)" language. Any view can be tabbed in any number of windows: RENDERER and PATCH BAY are factories (each window gets its own live instance — a bay left AND bottom; pass-through renderer center AND live mirrors beside it); CONTROLS and TIMELINE are single live DOM trees whose one element **follows your most recent click** — a window holding their tab while the element is elsewhere shows a slim placeholder ("click the tab to bring it over"), and clicking steals it back.
- **Default skin is now RACK** — fresh sessions open with the modular look and live cables; an explicitly chosen skin is respected as before.
- **Four windows, 4-up default** — a new LEFT window joins center/right/bottom (resizable 220–1400, hidden when empty). Fresh installs open in the owner's target layout: **Patch Bay left, Renderer center, Controls right, Timeline bottom**. Existing files migrate to their old arrangement (left window empty). `panelDock` is retired to `right` — the left side belongs to the left window now; drag tabs there instead.
- **Unity-family layout presets** — Window ▸ Layout: `Default (4-up)`, `Classic`, `Tall` (everything tabbed into one column), `Wide` (tall bottom strip with timeline+controls tabs), `Performance`, `Patch Bay`; Reset Layout = Default.
- **Wire any input in the bay** — the SOURCES bus gains **MIDI CC**, **CV IN**, and **OSC** jacks alongside the waveforms/audio/joystick: drag one into a generator's SRC IN, set the specifics (CC number, CV channel) in that slot's Modulation-panel body, and route the OUT to any of ~90 param jacks.
- **Tutorials** — a new About-page section (`docs/about/10-tutorials.md`) starting with *Tutorial 1: Make the image breathe with your microphone* — the mic→Z Push patch, step by step, in both the Patch Bay and the Controls panel (they're two views of the same slot).
- Menu-bar top-level buttons carry hover tooltips; canvas geometry fixed for top-docked strips stacking under the menu bar.

## Recent changes (v1.11.0, July 2026 — unified window system: the center joins, tabs everywhere)

- **The render window is now a window like any other** — a third `center` region (Settings v30) with the same tab bar as the side and dock: the RENDERER became a view you can send anywhere (it auto-switches to a `captureStream` mirror when it leaves the center, where the one real WebGL canvas always renders as a pass-through — a live GL canvas is never re-parented). Any of the three windows can host Renderer / Controls / Timeline / Patch Bay in any arrangement; a new **center drop zone** joins the four edges, so dragging tabs composes every state. The `Patch Bay` preset now puts the bay front-and-center with the output docked below.
- **Unity-style tabs** — every window's bar carries a draggable name-plate TAB (the drag handle for re-docking), the view dropdown, and ⤢/– where applicable; one design system across all windows, now written down in `docs/design/workspace-regions.md` (anatomy, contracts, how to add a view).
- **Patch bay legibility** (owner feedback, rack1) — SOURCES moved from the left rail to a **horizontal bus bar across the top**, so cables from signals to generators have distinct start points instead of collapsing into one vertical line; all physical cables now end in **plug dots** so start/end read at a glance even where cables overlap; CV OUT shows a hint when no channels exist instead of an empty frame.
- **Roomier windows** — panel width clamp 280–600 → **220–1400**, timeline height 140–600 → **100–900**.
- **Menu bar polish** — the top-level FILE/EDIT/VIEW/WINDOW/HELP buttons carry hover tooltips; Window menu gains Center/Side/Dock Window submenus covering every view.

## Recent changes (v1.10.0, July 2026 — drag-to-dock windows, maximize, collapse)

- **Drag-to-dock (Unity/Blender-style)** — grab any window's title bar (the ⠿ grip) and drag: edge drop zones light up (left / right / top / bottom) and dropping re-docks that window there. Drag the side panel to the left edge, the timeline to the top — or to the RIGHT edge, where it takes over the side shell and the controls swap into the dock. Windows are no longer glued anywhere; a drop resolves through the pure `resolveDrop()` (`workspaceModel.ts`, table-tested) into the same persisted Settings keys the shells already use (`panelDock`, `timelineDock`, region assignments), so Reset Layout and the named presets remain the intuitive defaults to retreat to.
- **Maximize + collapse per window** — every region bar gets ⤢ (near-fullscreen overlay below the menu bar; double-click the bar does the same, Unity muscle-memory) and – (collapse; the side panel's strip / the dock's mini-bar restore it). Maximize is transient session state, deliberately unpersisted; while a pane is maximized the render canvas expands beneath it (excluded from insets), so a maximized OUTPUT mirror streams at full-viewport quality.

## Recent changes (v1.9.0, July 2026 — the PATCH BAY)

- **Patch Bay view** (`src/ui/patchbay/`) — a dedicated hardware-faceplate view of the whole instrument, inspired by the original 1973 console: four FUNCTION GENERATOR modules (the Classic mod slots — enable LED, source LCD, RATE/AMT, SRC IN and OUT jacks), a SOURCES signal field (waveforms, audio, beat, joystick), engraved param fields laid out by the manual's brochure-derived DCU sub-groups (POSITION & SIZE / DEPTH / BEAM / ROTATION / SCAN / LINEARITY / LUMINANCE) plus Colorizer/Post-FX, Camera, Pattern, Geometry, Audio, and **real CV OUT jacks** for the `cv:N` virtual targets. Every jack is always visible at a fixed position — no scrolling accordion, no anchor fallbacks — and gravity-sagged cables render the actual patch: **drag OUT → param to route a slot (or param → OUT), drop in space to unplug, drag a SOURCES jack into a SRC IN to set a generator's source.** All writes are the same `modSlots` patch-data writes the Modulation panel makes; graph bindings render read-only in cyan. Coverage-tested: every modulation target has a faceplate home (an AUXILIARY field catches strays loudly). Hosts in any workspace region — `Window ▸ Layout ▸ Patch Bay` puts it in a tall dock. Design doc: `docs/design/patch-bay.md`.

## Recent changes (v1.8.0, July 2026 — workspace regions)

- **Workspace regions (Unity-style view docking, v1)** — the two layout shells (side panel, bottom/top dock) each get a slim region bar with a **view-switcher dropdown**: any region can host CONTROLS, TIMELINE, or OUTPUT (MIRROR) (`src/ui/workspace/`). Assigning a view the other region holds swaps them, so no region is ever empty. The moving pieces are new movable content wrappers (`ControlPanel.viewRoot`, `TimelineDock.viewRoot`) — shell chrome (width/height handles, collapse strip, dock mini-bar) stays on the shells, which keep owning geometry and persistence exactly as before, so `availableCanvasRect()` and the render pipeline are untouched. OUTPUT (MIRROR) is a `captureStream` copy of the render canvas (one WebGLRenderer — the center canvas is the real one, permanently, a documented v1 limitation). Assignment persists as Settings v28 → **v29** (`panelRegionView`/`dockRegionView`, normalized so foreign ids or collisions reset to stock — the reset path is the validator). Compact/touch keeps today's behavior entirely (region bars hidden, defaults forced transiently), and the panel popout wins over region assignments while open.
- **Window ▸ Layout presets + Reset Layout** — Unity-style named layouts (`Default`, `Performance` with output maximized, `Editing` with a tall timeline) plus a one-click **Reset Layout** escape hatch for any window state you don't like; Window ▸ Side/Dock Region radios mirror the in-region dropdowns.

## Recent changes (v1.7.0, July 2026 — app menu bar + rack drag fixes)

- **App menu bar** — a traditional File / Edit / View / Window / Help strip along the top of the desktop layout (`src/ui/menu/MenuBar.ts`), backed by a new app-wide **action registry** (`src/ui/actions.ts`): every command that exists in more than one surface (Ctrl+S, the Project panel's SAVE, the File menu) now dispatches through one registered action, so the save-with-prompt dance and friends exist exactly once. File = project ops + recent list + Export/Import Everything; Edit = timeline undo/redo (greyed when no timeline); View = skin radios / HUD / fullscreen / panel + timeline docking; Window = both popouts; Help = deep links into the Help tabs, the manual, and an About box with the build stamp. The old corner ABOUT link is absorbed into Help. The bar publishes `--rw-menubar-h` (0 in compact/viewer mode) and the canvas/panel/timeline all offset off it via the same live-rect measurement the panel and dock already use.
- **Rack cable drag fixes** — bidirectional patching (dragging from an empty input jack now works and snaps to slot output jacks), instant grab-glow feedback on pointerdown, and a popout-safe cable canvas (recreated when the panel moves between windows).
- **Discoverable range clamp** — every slider gets a small ▾ opening a value/range menu (set custom min/max clamp, reset range, reset value) — the v19 right-click range editor, now visible.

## Recent changes (v1.6.0, July 2026 — rack skin with live patch cables)

- **Third skin: RACK** — the title-bar skin picker (CRT / HW / RACK dropdown, replacing v1.5.0's two-way ◉ toggle) gains a full modular-rack mode: everything the hardware skin does, plus sections dressed as rack modules (faceplate screws, rails) and a **live patch-cable layer** (`src/ui/rack/`). Every modulatable slider grows a 3.5mm input jack; each Classic mod slot gets an output jack; green cables render the matrix's actual routings with gravity sag and animated signal flow (respects `prefers-reduced-motion`), and **drag-and-drop patching works**: drag from an output jack to any input jack to set that slot's target (enabling the slot — that's what plugging a cable means), grab a plugged input jack to move the cable, drop in space to unplug. Cable edits write `Settings.modSlots[i].target` through the exact same path as the Modulation section's Target dropdown — cables are a picture of the patch, not a parallel system, and the base/live split is untouched. Cyan cables show Graph-engine bindings read-only (the graph editor remains their editing surface). Endpoints hidden by a collapsed section or inactive tab re-anchor to the section header / tab strip instead of vanishing. The cable bezier/glow recipe is shared with the graph editor via the new `ui/cableDraw.ts` (one concept, one source). Dormant unless the rack skin is active — zero cost in the other skins.

## Recent changes (v1.5.0, July 2026 — hardware skin, Phase 1)

- **Skeuomorphic "hardware panel" skin** — the skin toggle in the panel title bar swaps the flat CRT controls for a euro-synth look: SVG rotary knobs (vertical drag, `Shift` for fine, double-click reset, right-click precise entry — every write path shared with the flat slider), bat toggle switches with LED lenses, pushbutton bezels, and LCD-strip readouts/selects. Implemented as a fifth *face* inside the existing widgets, swapped purely by CSS off `body[data-skin="hardware"]` (the same mechanism the compact layout uses), so the base/live split and auto-key rules hold by construction. The preference is localStorage-only — deliberately **not** a Settings key, so patches never restyle your panel — and the popout panel window stays in sync. Compact/touch layouts keep their touch faces regardless of skin. Design + phase plan: `docs/design/skeuomorphic-skin.md`; new skin invariants added to `PRINCIPLES.md` (principle 2). Live-modulation visualization on the knobs (mod arcs) is Phase 2, not yet implemented.

## Recent changes (settings v26 → v28, July 2026 — timeline UX + panel polish)

A follow-up round of owner-reported fixes and small features on top of the audit run below, each landed as its own commit. Settings schema v26 → v28.

- **Auto-key semantics** — once a panel param has an automation lane, the knob is always keyed: on an existing point it rewrites that point, off one it auto-creates a new point at the playhead. Fixes a real bug where editing a slider away from a keyframe silently rewrote the global base, shifting every other keyframe's resolved value.
- **Timeline visible by default** — `timelineDock` now defaults to `'bottom'` instead of `'hidden'`.
- **Transport counter display format** — Bars/Beats / Timecode / Frames / Samples, a DAW-style `DISPLAY` dropdown next to the readout. Pure display conversions; the timeline's real clock is unchanged. Timecode and Frames read like a video editor's counter — real elapsed wall-clock time at the chosen fps, not a musical count — and every non-Bars/Beats reading appends the bar position as a trailing anchor (`frame 60 · bar 1.00`) so the number is never disconnected from where the playhead actually sits on the ruler. The format picker, rate picker, and readout are grouped as one unit in the transport so they always wrap together instead of stranding on separate lines.
- **About page sidebar TOC** — a persistent, independently-scrolling left sidebar replaces the old top nav: 9 sections plus every section's own sub-headings, generated at runtime from the live DOM, scrollspy-highlighted, deep-linkable.
- **Hover tooltips** — hold over any panel param row or section header for ~half a second for a short description, sourced from the same `PARAM_DOCS` map that drives the in-app Help and the About Param Reference.
- **Render-canvas popout** — a second two-screen popout (alongside the existing controls popout) that pops the live OUTPUT into its own draggable window via `captureStream()`, with its own auto-fading fullscreen toggle for seamless projector use.
- **Panel layout fixes** — Pattern Generator sliders and four Sonification rows now correctly fill their row width at any panel size (a shared `.rw-inline-group` utility replaces several ad-hoc hand-rolled layouts); the SCENES track in the timeline dock is now a fixed height instead of stretching into giant markers when the dock is resized taller.
- **`F` (fullscreen) and `H` (HUD toggle)** — both had been documented as global shortcuts for a long time without ever being implemented; both now work.
- **Ruler ticks follow the display format** — the timeline ruler's tick labels now render in whatever format the transport's `DISPLAY` dropdown is set to (Bars/Beats, Timecode, Frames, Samples) instead of always showing the raw bar number, so the ruler and the counter never disagree about what point in time a tick represents.
- **Render canvas respects panel/timeline bounds** — the canvas now sizes and offsets itself to the live rectangle left over after the control panel and timeline dock, instead of stretching full-bleed underneath them; it re-measures on every panel/timeline resize, dock change, or collapse.
- **Slider + scrollbar design-system audit** — the Video Audio Volume slider and the CV Output "Scaling trim" slider were rendering as unstyled native browser widgets; both now use the shared slider/row widgets. A global `input[type="range"]` baseline and a themed thin scrollbar (green-on-transparent, matching the CRT phosphor palette) were added so any future ad-hoc slider or scroll container inherits the right look by default instead of falling back to OS chrome.
- **Timeline ruler drag-to-scrub fix** — click-dragging across the ruler used to select the bar-number text instead of scrubbing, which silently suppressed the browser's `click` event on release so the orange playhead never moved. The ruler now uses a real pointer-drag gesture: the playhead tracks the pointer live during the drag (not just on release), and the ruler text can no longer be selected.
- **Render-popout fullscreen button: idle-fade, not hover-fade** — the button used to hide only while the cursor was literally outside the popup window, so a mouse parked motionlessly inside stayed visible forever. It now fades out after ~2.5s of no pointer movement and reappears instantly on movement, regardless of where the cursor is resting.
- **File-input picker buttons themed** — `<input type="file">`'s native "Choose File" button lives in a `::file-selector-button` pseudo-element that a parent `className` can't reach; every file picker in the app (Source's Video File, Audio's Audio file, Presets' Import/Restore) now matches the CRT button styling instead of falling back to the OS's grey system button.
- **Any slider can be keyframed** — audited every panel slider against the timeline/modulation target list and added the ~14 that were missing (camera near/far, fly speed/boost, auto-orbit speed, bloom threshold, scanline density, vignette amount, anaglyph/stereo IPD, video audio volume, audio attack/release/threshold). Deliberately excludes params whose live modulation would be unsafe or meaningless (mesh-rebuild triggers, one-shot recording/render-pipeline config, the auto-rotation rate that already competes with keyframing rotation directly) — see CLAUDE.md for the full list and reasoning. Also fixed a real pre-existing bug the audit turned up: Audio Gain / Audio Floor / Beat Sensitivity had been keyframable-looking in the UI for a while but the audio analyzer only ever read their value once at boot, so modulating or keyframing them silently did nothing.
- **Timeline dock hover tooltips** — the timeline dock had none of the styled hover tooltips the rest of the panel got earlier this session (only scattered native browser tooltips); every transport control, the ruler, the scene track, lane chips/points, and the resize handles now use the same delayed CRT-styled popover, including state-aware text for PLAY/PAUSE and LOOP ON/OFF.
- **Capture Settings tooltip gap** — Source → Video File's Resolution and FPS controls are hand-built (a resolution dropdown that writes two Settings keys at once can't use the shared widget helpers) and were missing tooltips as a result even though their descriptions already existed; fixed.

## Recent changes (settings v16 → v25, July 2026)

One audited backlog run (see `AUDIT.md` and `CLAUDE.md`) landed seventeen features and fixes, each as its own tested commit. The Settings schema went v16 → v25 (one migration per change) and the Timeline schema went v1 → v2.

**Panel & workflow**

- **Param search + tab hotkeys** — press `/` anywhere to filter every control across all panel tabs (matching sections expand, matching rows highlight); `[` / `]` cycle Synth / I/O / Help.
- **Two-screen popout** — the `⧉` title-bar button moves the entire control panel into its own window. Same live page, same JS context — nothing is mirrored or synced. Output fullscreen on the projector, controls on the laptop.
- **Custom slider ranges** — right-click (long-press on touch) any slider to widen or narrow its range, clamped to a ±5×-span safety envelope so a typo can't dial a GPU-hanging scan rate. Overrides persist and travel inside Projects.
- **Build stamp** — the panel title bar shows `v<version> · <commit>` with the build date in the tooltip, so a deployed page maps to a commit at a glance.

**Modulation**

- **Graph mute + My Patches** — per-node and per-binding enable checkboxes (muted nodes dim on the canvas and contribute nothing); the graph Library sidebar gained a **My Patches** area for saving/loading named user patches.
- **Classic slot slew (glide)** — per-slot rise/fall glide (0–5000 ms) in the Output group, same exponential math as the Graph Slew node.
- **Multiplicative modulation** — Classic slots (and Graph beginner rows) pick **Additive (+)** or **Multiply (×)**; live value = `(base + Σoffsets) × Πfactors` — the classic patched-multiplier for tremolo/VCA-style depth control.
- **LFO range switch** — Low (×0.01) / Mid (×1) / High (×10) coarse range on Classic and Graph LFO rates, like the range switch on the original hardware oscillators.
- **ADSR + resonant filter nodes** — a gate-triggered **Envelope (ADSR)** and a control-rate state-variable **Filter (LP/HP/BP)** with genuine resonant overshoot, both in the graph palette.
- **Graph editor polish** — drag-to-wire with a rubber-band cable, cursor-anchored pan/zoom (0.4×–2.5×), and per-port `nodeId#port` connections so multi-output nodes can be wired from any output.

**Synthesis & FX**

- **Dual raster** *(feature flag, default OFF)* — a second, independently modulated raster B fed by the same video: **Wipe** mode splits the frame on a modulatable Trace slider; **Alternate lines** interleaves row-by-row. Raster B's position/size/depth/rotation/luminance are all `B:` modulation targets.
- **Shape-masked feedback** — confine burn-in trails to a movable circle or box region; center, radius, and softness are all modulatable (orbit the feedback zone with two LFOs).
- **Analog character** — a wear layer in the CRT pass: video grain, one-frame dropout tears, and a rolling hum bar. Off by default, all amounts modulatable.
- **Rotation knob** — continuous ±180° in-plane rotation composed after the 0°/90° switch, pivoting on H/V Center. Modulatable.
- **Burn-in fixed** — the feedback accumulator now genuinely compounds (it was a one-frame echo); Decay reads as a half-life (0.9 ≈ 0.1 s · 0.99 ≈ 1 s · 0.999 ≈ 11 s).
- **Anaglyph Eye Sep fixed** — the slider was a no-op because three.js's AnaglyphEffect eye separation was unsettable; a vendored effect makes it real.

**I/O & timeline**

- **MIDI clock out** — transmit 24-PPQ clock plus Start/Stop at the shared Tempo BPM so external gear chases the synth. Forced OFF on every page load, same posture as CV output. Ships with an emulated **Sync (V)** frame-locked pulse node for the graph.
- **Keyframing v2 (full lane UI)** — timeline **automation lanes**: per-parameter point lists whose values are relative offsets summed through the live-value system (they compose with LFOs and CV instead of fighting them). Curves draw and edit in **absolute values** (the same numbers as the panel knob, with a dashed line at the current base) via 2D point drag, a resizable inspector, and per-param ◀ ▶ keyframe-jump arrows on panel rows. The panel slider follows traditional keyframe-editor semantics (Blender/Resolve): parked exactly on a keyframe, it edits that keyframe only; off one, it edits the base and shifts the whole curve — one undo step per drag either way. Timeline dock and side panel are both drag-resizable. Timeline schema v2; v1 files load unchanged. Record-knob-moves is a planned follow-up.
- **About-page search rebuilt** — the manual's search now indexes every heading with a results dropdown, highlighted snippets, and jump-to-heading (previously it filtered whole sections and always scrolled to the top).

## Earlier: v11 → v12

- **WebXR (v11)** — Enter VR/AR via `src/renderer/XRManager.ts`: mesh framing presets (tabletop / roomscale / architectural), a separate XR performance-profile axis, auto-end on tab hide. Post-processing is skipped in-headset for v1.
- **Stereoscopic recording (v12)** — side-by-side stereo via a second offscreen renderer (`src/record/StereoCompositor.ts`), IPD control, and YouTube SV3D metadata injection into MP4s on stop (`src/record/StereoMetadata.ts`).
- **Anaglyph mode** — red-cyan stereo on the main canvas (`src/renderer/AnaglyphRenderer.ts`); recording and streaming capture it automatically. Eye separation shares one cm→world mapping with stereo recording (`src/renderer/stereoIpd.ts`).
- **WHIP output streaming** — publish the canvas as WebRTC to OBS 30+, MediaMTX, Cloudflare Stream, LiveKit (`src/stream/WhipPublisher.ts`).
- **Stream input** — HLS (`.m3u8` via hls.js), MPEG-DASH, or any direct video URL as a source, with per-source audio routing (speaker playback and record-baking are independent toggles).
- **Sample video source** — a "Load Sample" button backed by `public/samples/sample.mp4` (override with `VITE_SAMPLE_VIDEO_URL`, see `.env.example`).
- **4× MSAA** on the composer's render target; higher default recording bitrate (25 Mbps).
- **Source selection at startup** and About-page layout refresh.

## Earlier: v10 release notes

**May 2026** — **Pattern Generator source** — a synthesized "video signal" layer parallel to webcam / screen / file. Adds 16 fragment-shader patterns plus a fully-functional Oscilloscope mode that turns any signal you can sample (audio, mod-matrix slot, graph node port, settings param, beat pulse) into a phosphor scope trace that the DCU then displaces in Z. The original 1974 hardware was famously a hijacked oscilloscope; this is the Rutt-faithful version of an internal signal generator.

### Pattern Generator (`src/renderer/patterns/`)

- **Architecture: independent layer, not a mode.** A new `patternEnabled` toggle in the Source panel (styled identically to **Mirror H** / **Mirror V**) gates a separate offscreen pipeline. The video source (`sourceKind`) keeps doing what it always did; the pattern layer is composited on top with a configurable blend mode + mix amount, and the result feeds the DCU's `uVideo` uniform unchanged. When the layer is OFF, the live `VideoTexture` binds to the DCU directly with zero added GPU cost.
- **Pattern catalog** — Calibration (Solid, Gradient, Bars, Grid, Checker), Waveform (Sine / Triangle / Saw / Square / Pulse Bands, Lissajous, Spiral), Noise (White / Perlin / Worley), and Oscilloscope. 16 patterns, one fragment shader each, all <80 lines of GLSL.
- **Compositor** — single fragment shader with 8 blend modes (replace, add, subtract, multiply, screen, difference, mask, crossfade) selected via an int uniform. `patternMix` acts as a wet/dry on the blended output; even Replace honors it for tempo-locked layer ducking.
- **Modulation native** — every numeric pattern parameter (Frequency, Brightness, Contrast, Phase, Scale, Thickness, Density, Lissajous Freq Ratio, Spiral Arms, Perlin Octaves, Worley Point Density, Mix, Scope Sweep / Trigger / Persist / Thickness) is a first-class **ModTarget** appearing in every Classic slot Target dropdown and every Graph `cv-output` target list under the **Pattern:** prefix. The standard `LiveValuesStore` base/live split applies — sliders display the user-edited base, the renderer reads `getLive()` each frame.
- **Inline "+ Mod patch" button** next to each pattern slider creates a sine LFO already wired to that parameter and expands its slot in the Modulation panel.
- **Oscilloscope mode** — circular `Float32Array` buffer plus a 1D `THREE.DataTexture` rendered as a beam trace. Source kinds: live audio time-domain (via `FFTAnalyzer.getTimeDomain`), Classic mod-matrix slot value, Graph node port (via the existing `GraphEngine.probe`), arbitrary numeric Settings key (read through `LiveValuesStore` so modulation appears in the trace), or BeatDetector pulse. Optional rising-edge trigger alignment locks repetitive waveforms in place; phosphor decay (`patternScopePersist`) is implemented via a feedback ping-pong render target.
- **Per-pattern UI** rebuilds itself on `patternKind` change: only the controls each pattern actually consumes are shown, defaults are reset on switch via `settings.patch(PATTERN_REGISTRY[kind].defaults)`.
- **Pattern signals → modulation sources.** Every pattern publishes its internal control signals back into the modulation system through a tiny `PatternSignalBus` (`Map<string, number>`, keyed by `<patternKind>:<signalId>`). Each frame the active pattern's CPU mirror — a small JS function declared next to the shader's GLSL in `PatternRegistry` — runs once and writes its outputs (Lissajous X / Y, Sine Bands wave, Spiral phase, Oscilloscope `latest` / `mean` / `peak` / `trigger`, etc.). Two paths, one set of params: shader and CPU mirror always stay in lockstep. Consumers: Classic mode adds them to the source dropdown under a `Pattern Outputs` optgroup (encoded as `po:<busId>`); Graph mode registers a `pattern-output` node; CVOutput adds a `pattern-output` source kind so external hardware can be driven by the same Lissajous X the visual layer is drawing. Bus is cleared on disable / kind-switch so stale signals never leak.
- **Tests**: `PatternRegistry.test.ts` enforces every `PatternKind` literal has an entry and a non-empty `paramKeys`; `OscilloscopeBuffer.test.ts` covers ring-buffer FIFO, block writes, and rising-edge trigger alignment; `PatternSignalBus.test.ts` covers id encoding + bus mutation; per-pattern compute-mirror math is covered in `PatternRegistry.compute.test.ts`.
- **Settings v9 → v10 migration** adds every `pattern*` key from `DEFAULTS` if missing, and backfills the new `ModSlot.patternOutputId` / `CVOutputChannel.sourcePatternOutputId` fields with empty strings. Rolling back to v9 code drops the unknown fields harmlessly.

### Sonification — hear the image (`src/audio/Sonification.ts`, `src/audio/MeshAnalyzer.ts`)

The synth's **first audible-output feature**. A single Web Audio voice whose four parameters (Pitch, Amplitude, Cutoff, Resonance) are driven each frame by statistics computed from the scanline mesh — faithful to Steina Vasulka and Bill Hearn's 1970s practice of routing video signals through audio amplifiers to literally hear the image.

- **Voice chain** — `OscillatorNode → BiquadFilterNode → GainNode (amp) → GainNode (master) → DynamicsCompressorNode (limiter) → destination`, plus a parallel `MediaStreamAudioDestinationNode` tap that the recorder and broadcaster pull tracks from. Sonification runs on its own `AudioContext`, separate from CV Output's, so the two surfaces share no mixer node — sonification audio can never bleed into a CV channel.
- **MeshAnalyzer** publishes 8 stats from the existing `VideoTap` lo-res readback (the same buffer `video-luma` / `video-motion` graph nodes use): `meanBrightness`, `brightnessVariance`, `verticalCentroid`, `horizontalCentroid`, `meshActivity`, `peakRow`, `peakBrightness`, `edgeDensity`. The DCU brightness pipeline (luma → threshold → contrast → gamma) is mirrored on the CPU side so the sonified signal tracks what's actually visible, not just the raw video luma. 64-row analysis grid; <0.1 ms / frame on mid-tier hardware.
- **Mapping layer** — small "patch matrix" parallel to the modulation system but kept simple (no graph, no chaining). Each voice param is bound to one mesh stat with a per-mapping easing curve (Linear / Exponential / Logarithmic / S-Curve) and a single global Smoothing slider (1-pole lowpass; 5 ms = twitchy, 200 ms = drone-smooth). Pitch additionally has a configurable MIDI-note range and a Quantize toggle.
- **Default mapping** — Pitch ← `verticalCentroid` (Exponential, musical), Amplitude ← `meanBrightness` (Linear), Cutoff ← `brightnessVariance` (Exponential), Resonance ← `meshActivity` (Linear). Designed to feel expressive on arbitrary video without configuration.
- **Recording / broadcast capture** — `Recorder.start()` and `Broadcaster.start()` pull `getCaptureStream()` from the `Sonification` instance and add the audio track(s) to the canvas `MediaStream`. Mic + sonification are mixed by the browser at recording time. Capture taps post-master / post-limiter, so the recorded audio is exactly what you hear.
- **Safety surface** — non-negotiable for a first audio-output feature:
    - **Default disabled, always.** The settings migration explicitly forces `sonification.enabled = false` on every page load and preset import (mirrors the CV-output "channels start disabled" rule).
    - **-18 dB default master volume.**
    - **500 ms soft-start ramp** on enable; 250 ms ramp on disable.
    - **Brick-wall limiter** (`DynamicsCompressorNode`, ratio 20, threshold -3 dBFS, knee 6 dB) catches runaway resonant filter sweeps.
    - **Mic-feedback gate** — when `FFTAnalyzer.kind === 'mic' && fft.running` AND sonification is enabled, master gain is auto-forced to 0 with a UI banner explaining why. The synth refuses to ship a feedback loop.
    - **Browser autoplay policy** — the Enable click is the natural user gesture. If the toggle is flipped without a gesture (URL config — should be impossible thanks to the migration's force-off), a "click anywhere on the canvas to start audio" indicator appears and the next canvas click resumes the context.
- **Tests** — `MeshAnalyzer.test.ts` covers the 8 stats with synthetic gradient / motion / centroid inputs; `Sonification.test.ts` covers mapping curves, dB → gain conversion, MIDI → Hz, and the mic-feedback gate.
- **Settings** — single nested `sonification: SonificationConfig` block in v10 schema (`enabled`, `masterVolumeDb`, `waveform`, `filterType`, `pitchRangeMidi`, `quantize`, `smoothingMs`, per-param `mappings`). Migration deep-merges with `DEFAULT_SONIFICATION` so saved partials get new keys filled in.

### Project save/load — the "save your work" feature (`src/project/`)

Consolidates the seven-plus different save-shaped concepts (presets, timelines, MIDI bindings, OSC bindings, CV calibrations, sonification config, pattern generator state, layout preferences) into one workspace document — `.synth.json`. Three nested concepts now exist at three different scales: **Preset** (a look, small / shareable), **Timeline** (a score, focused on time-based composition), **Project** (the workspace — preset + timeline + every binding, calibration, layout preference, camera, resolution).

- **Schema** (`src/project/types.ts`) — `SynthProject` is a versioned wrapper carrying `formatVersion + appVersion + savedAt + name + description + settings + userPresets + timelines + activeTimelineId`. The full Settings snapshot is the wire form — choosing this over a nested `{io, sonification, workspace, …}` shape means every persistent subsystem is captured automatically (present and future) and the existing `migrateSettings()` safety guards apply for free.
- **Project core** (`src/project/Project.ts`) — pure helpers for `snapshotProject`, `serializeProject`, `parseProject`, `migrateProject`, `applyProject`, `summarize`, `presetFromProject`. No DOM, no localStorage, no listeners; the test suite exercises 18 round-trip / migration / safety scenarios.
- **Safety, structurally** — `applyProject()` always routes settings through `migrateSettings()`, which forces `cvOutputEnabled = false`, every `cvOutputChannels[].enabled = false`, and `sonification.enabled = false` regardless of saved values. A project file CAN say `enabled: true`; the loader will discard it and substitute `false`. Hardware-output features never auto-arm from a saved file. Same rule for mic-as-envelope-source (browser won't auto-grant mic permission anyway).
- **ProjectStore** (`src/project/ProjectStore.ts`) — runtime state machine: current project name, dirty flag (driven by `Settings.subscribeAll` plus explicit `markDirty()` for preset / timeline edits), recent-projects list (capped at 8, persisted in localStorage), `FileSystemFileHandle` cache when the FS Access API is available. File ops (`saveToCurrent`, `saveAs`, `openWithPicker`, `openFromFile`, `openRecent`) feature-detect the FS Access API and fall back to download/upload on Firefox / Safari.
- **AutoSave** (`src/project/AutoSave.ts`) — 60s interval timer that writes the current snapshot to localStorage when the project is dirty. Pending payload is surfaced through a one-time recovery prompt on next page load. Toggle persists across sessions; `tick()` is also called from `beforeunload` so accidental closes leave a recoverable trail.
- **Recovered Session** (`src/project/RecoveredSession.ts`) — first-launch packaging. If pre-Project state exists in any of the legacy localStorage keys (`ruttetra.settings.v1`, `ruttetra.userPresets.v1`, `ruttetra.timelines.v1`), it's wrapped as an auto-save payload named "Recovered Session" so the user gets a recovery prompt on the next load. One-shot; gated by `ruttetra.project.recoveredAt`.
- **UI** (`src/ui/sections/ProjectSection.ts`) — sits at the top of the synth tab. Status strip shows `{Project Name} *` with the asterisk surfacing unsaved changes. Primary actions: New / Open / Save / Save As. Secondary: "Save preset from project" (exports just the preset portion as `.preset.json`). Recent Projects list (with one-click reopen on Chromium, file-picker fallback elsewhere) + Auto-save toggle with last-snapshot timestamp readout.
- **Title bar dirty marker** — `document.title` reflects `{Project Name}{ * if dirty} — RUTT/ETRA` so the browser tab tells you about unsaved changes even when the panel is hidden.
- **Keyboard shortcuts** — `Ctrl+N` (New), `Ctrl+O` (Open), `Ctrl+S` (Save), `Ctrl+Shift+S` (Save As). All call `preventDefault()` to override the browser's built-in handlers.
- **Live camera capture on save** — before serializing, the synth pushes the current camera into `settings.defaultView` so the saved project restores the camera the user is actually looking at, not whatever the loaded preset's saved view was.
- **Format version migration** — `parseProject()` checks `formatVersion`, runs migrations on read, and saving back always writes at the current version regardless of source. Forward-compat: a file with `formatVersion > current` loads with a `console.warn` and is normalized on save.
- **Tests** — `Project.test.ts` (18 tests): snapshot, round-trip, migration, validation, the cardinal sonification / CV-output safety rules, presetFromProject. `ProjectStore.test.ts` (17 tests): initial state, dirty tracking, newProject, recent list (dedup, cap at 8, persistence, handle-strip-on-write), openFromText, helpers. `AutoSave.test.ts` (11 tests): enable/disable, persistence, no-op-when-clean, snapshot-on-dirty, formatAge, fake-timer interval. `RecoveredSession.test.ts` (7 tests): clean install, packaging settings / presets / timelines, one-shot, no-clobber, malformed JSON tolerance. Total: 53 new tests, all green.

### Earlier in this release cycle

Base/live split architecture, modulation UX improvements, **bidirectional voltage control (CV)**, and a separate **About / Manual page** at `about.html` distinct from the in-app Help dock.

### About / Manual page (`about.html`)

Long-form end-to-end documentation of the synth, distinct from the in-app Help panel which stays a quick-reference dock.

- **Multi-page Vite build** — second entry in `rollupOptions.input`. Same domain, separate bundle, separate HTML file. Visiting it does not load any synth code, three.js, Web Audio, or PeerJS — confirmed by `scripts/check-about-bundle.cjs`.
- **Markdown sources** — section content lives as 8 markdown files in `docs/about/` (intro, quick start, synthesis, modulation, I/O, performance, reference, acknowledgements). A small Vite plugin (`aboutMarkdown` in `vite.config.ts`) renders each file to HTML at build time using `marked` (devDependency), so the runtime bundle ships pre-rendered HTML, not a markdown parser.
- **Auto-generated reference sections** — Param Reference + Node Catalog. Param Reference is built from `src/ui/help/paramDocs.ts` (the same map the in-app Help reads); Node Catalog walks the graph node registry and emits per-node descriptions / inputs / outputs / params. Both auto-update as soon as a new param doc or node def is added to the source tree — no manual sync.
- **Left sidebar** (July 2026) — persistent, own-scrolling table of contents replacing the old top nav bar: the 9 manual sections plus every section's own h3/h4 sub-headings, nested and built at runtime from the live DOM (a new heading in any `docs/about/*.md` file just shows up, no TOC upkeep). A scrollspy highlights wherever you're currently reading, both the section and the specific sub-heading. Auto-generated Param Reference / Node Catalog sub-content is deliberately excluded from the TOC (would bury real headings under ~60 param/node names) but stays fully searchable. Off-canvas drawer on narrow viewports, opened via a pinned "☰ Contents" button.
- **Search** — indexes every heading (not just top-level sections) with a results dropdown, highlighted snippets, and jump-to-heading, now anchored under the sidebar's search box.
- **Print stylesheet** — drops the scanline overlay, switches to dark-on-white, expands hidden sections, numbers headings (`1.`, `1.1`), forces page breaks between sections. Useful for printing the keyboard shortcuts and param reference for an offline reference.
- **CRT aesthetic, no new tokens** — reuses the same VT323 / phosphor green palette as the synth's main panel. Subtle scanline overlay at lower opacity than the synth canvas so prose stays readable.
- **About bundle stats** — about.html (1.6 kB gzip) + about.css (2.5 kB gzip) + about.js (40.7 kB gzip; mostly the pre-rendered docs HTML plus the sidebar TOC/scrollspy logic) + paramDocs/types (9.5 kB gzip, shared). Total ~54 kB gzipped over the wire; still well under a second on 4G.

The synth gets a small "ABOUT" link in the top edge of the page that opens `about.html` in the same tab. Returning leaves the synth's state intact (different page, different scope, same `localStorage` content).

### CV output — send synth params, modulation, or graph signals OUT to hardware

The symmetric counterpart to CV input. Drives Eurorack modules, CV-equipped synths, or any device that accepts analog voltages, via a DC-coupled audio interface.

**Architecture** (`src/audio/CVOutput.ts` + `src/audio/cv-out-worklet.js`)

- **Owns its own AudioContext** with `sinkId` set to the chosen DC-coupled interface — physically isolated from the audible audio AudioContext, so the synth's monitoring mix can never bleed into CV channels (would produce horrible noise on a modular oscillator's pitch input). Audible audio and CV audio are on different AudioContexts; routing between them is impossible.
- **`ChannelMergerNode`** sized to the interface's `maxChannelCount` fans each per-channel `AudioWorkletNode` to one specific hardware output. `setSinkId` for Chrome / Edge; Firefox falls back to OS-level routing (documented).
- **Per-channel worklet** (`cv-out-worklet.js`) keeps three guarantees that can never be bypassed by main-thread bugs: (1) `enabled=false` emits exactly 0 samples; (2) every false→true `enable` arms a 100ms 0V→target ramp; (3) hard sample clamp to ±1.0 is the LAST instruction before the output buffer write.

**Output types** — same channel can be re-typed without rewiring the graph:

| Type | Behavior |
|---|---|
| `cv` | Continuous voltage tracking the source. Use for envelopes, LFOs, parameter automation. |
| `gate` | High/low based on threshold (configurable: high V, low V, threshold). |
| `trigger` | Fixed-duration pulse on rising-edge detection. Default 10ms at 5V; configurable. |
| `clock` | Square-wave clock at a tempo division (1/4, 1/8, 1/16, etc.). Sourced from internal BPM or MIDI clock. |
| `pitch` | **1V/octave pitch CV** with calibration. `voltage = refV + ((note − refNote) / 12) × voltsPerOct × calibrationScale`. Defaults: ref=C4 (60), 0V, 1.0V/oct (Buchla 1.2V/oct supported). Optional quantize-to-scale (chromatic / major / minor / harmonic minor / pentatonic) with rotatable scale root. Glide / portamento via per-channel ms slider. |

**Pitch calibration UI** — modal panel with **Play C2** / **Play C6** reference notes and a **scaling trim** slider that multiplies the V/oct value (factory: 1.0; ±5% covers nearly all interface drift). Tune your oscillator at C2, then trim until C6 is in tune.

**Sources for each channel**:

- **Constant value** — fixed normalized signal (great for testing).
- **Classic slot** — pair the channel with a Classic slot whose Target is set to `cv:N`. The slot's post-output-stage value drives the channel.
- **Graph node** — by node id + port. Or, more cleanly, drop a **CV Output** sink node in the graph and set its channel parameter.
- **Settings param** — emit any modulatable param's live value (mirror what the synth is currently doing).
- **MIDI note** — pitch type uses this directly; non-pitch types see the raw note number.
- **Auto** — clock type follows internal BPM.

**UI integration**:

- **I/O → CV Out section** — interface picker, channel-count input, Start/Stop master button, status (running, channel count, `setSinkId` support), per-channel rows with type/source/range/scale/offset/smooth, **Test +2.5V** button, **Enable** toggle, type-specific sub-fields (gate threshold, trigger ms, clock division, pitch reference + V/oct + Calibrate Pitch).
- **Classic Target dropdown** — `cv:N` virtual targets appear automatically for every configured CV-output channel; the slot routes through `CVOutput.setClassicSource` instead of `LiveValuesStore`.
- **Graph cv-output node** — sink node (control input, no outputs) registered alongside cv-input. Pair with a channel index to drive that CV channel.

**Safety**:

- **Outputs start muted on every page load**, regardless of saved state. Settings migration forces every channel's `enabled = false` and `cvOutputEnabled = false` on load. User must re-arm each channel before any voltage actually leaves the interface — protects gear that's already physically connected.
- **Output limiter** — hard clamp to ±1.0 sample, applied unconditionally inside the worklet's last instruction before the buffer write.
- **0V startup ramp** — every false→true enable triggers a 100ms 0V→target ramp inside the worklet. No clicks, pops, or unexpected jumps.

**Tests**: `CVOutput.test.ts` — 18 cases covering pitch math (including fractional notes, custom references, Buchla 1.2V/oct, calibration trim), scale quantization (chromatic / major / minor / pentatonic), and the voltage-clamp contract. Plus 4 new `cv-output` graph node cases.

### CV input — drive any param with external analog voltages

Bidirectional now: pair this section with **CV output** above and the synth becomes a full peer in a modular rig — voltages flow in either direction through the same DC-coupled interface.

Four routes:

- **DC-coupled audio interface** (best fidelity) — the Expert Sleepers ES-8/ES-9, MOTU UltraLite, some Focusrite Scarletts pass DC voltages through their audio inputs. Wired through a dedicated `AudioWorkletNode` that downsamples to control rate (1kHz default) so a Pi-class CPU can handle it. ±5V Eurorack default; switchable to 0–5V, ±10V, 0–10V. Per-channel range, polarity, smoothing (1-pole, 0–500ms), control rate, and **calibration** ("capture current voltage as zero").
- **CV-to-MIDI converter** (FH-2, Befaco CV Thing, etc.) — already covered by Web MIDI; surfaced in Help and the I/O panel as a guidance hint.
- **OSC bridge** — for Norns / Bela / RPi with ADC HAT. Reference Python scripts in `tools/cv-bridge/` (MCP3008 + ADS1115 on Raspberry Pi). Emits `/cv/<n>` over the existing OSC bridge.
- **Gamepad / HID** — every connected gamepad's axes and buttons appear as sources, with rolling variance for **CV Learn**.

UI:

- **I/O → CV section** — device picker, per-channel live readout (e.g. `+2.34V` with a bar that distinguishes "0V" from "no signal"), Calibrate button per channel, gamepad picker with live axis/button grid, OSC-bridge channel manager.
- **Inline body group** — both Classic and Graph beginner expanded rows show a CV body group with channel selector, live voltage readout, Calibrate, and Learn buttons.
- **`cv-input` graph node** — `route` (audio / osc / midi-cc) + channel + bipolar param. Drop one in any patch.
- **`gamepad-axis` / `gamepad-button` graph nodes** — buttons expose a `gate` output too.
- **CV Learn** — click Learn next to a CV slot, wiggle a CV, and the channel that moved the most binds.

Edge cases covered: device disconnected mid-session (channels zero out, no crash, status indicator), Firefox 2-channel limit detected and warned, AC-coupled interfaces flagged in Help.

### Base/live split architecture (carried over from earlier in v9)

- **Fixed: "sticky parameters" bug** — When modulation drops to zero (amount → 0, patch disabled, or source signal silent), params now snap back to their user-edited base value instantly. Previously they stuck at their last modulated value indefinitely.
- **Architecture**: Introduced `LiveValuesStore` with separate **base** (what the UI knob shows) and **live** (what the renderer reads) values. Engines push per-frame contributions; renderer subscribes to live values. UI continues reading/writing base values via `Settings`. This is the canonical "base + mod" pattern used by every modulation-capable synth.
- **Per-row Reset (↻) buttons** — Click to reset a patch's params to type-defaults while keeping routing. Shift+click for hard reset (also wipes Source + Target back to defaults). Keyboard: `R` / `Shift+R`.
- **Global "Reset Mod" button** — Mutes every patch (Amount → 0) and snaps all modulated params back to base in one tick. The panic button for complex routings.
- **`?debug=mod` overlay** — Live readout of `base / live / Δ` for every modulated param. Essential for verifying the base/live split is working correctly.
- **Graph patch Amount range increased** — Now ±20 (was ±5) for extreme parameter sweeps.
- **137 unit tests** — `LiveValues.test.ts` pins down the base+mod contract; `inputs.test.ts` covers the cv-input / gamepad-axis / gamepad-button / cv-output graph nodes; `CVInput.test.ts` covers input range / polarity / invert math; `CVOutput.test.ts` covers pitch math, scale quantization, and the voltage-clamp contract.

---

## Features

The control panel is split into three tabs (cycle with `[` / `]`, filter any control with `/`):

- **Synth** — the original scan-processor: project, source, DCU, dual raster, camera, color, post-FX, modulation, geometry, presets, record, share.
- **I/O** — MIDI, Audio (FFT), OSC, CV in/out, Sonification.
- **Help** — quick-reference dock; the long-form manual lives at `about.html`.

### Video sources
- **Webcam** — pick any attached camera from a device dropdown. Click *Refresh* after granting camera permission to see correct device labels.
- **Screen capture** — use `getDisplayMedia` to synthesize a window, tab, or entire display.
- **Video file** — drag a file onto the picker to loop local video through the effect.
- Mirror H / Mirror V toggles apply before synthesis. Both default to on so webcam input feels right immediately.

### Display Control Unit — full native Rutt/Etra control set

Every knob from the original [Rutt Electrophysics hardware brochure](https://vasulka.org/archive/Artists5/Rutt-E/VidSynthCont.pdf) is implemented as a live shader uniform:

| Group | Controls |
|---|---|
| **Position & Size** | H Position, V Position, H Size (bipolar — negative inverts), V Size (bipolar), Aspect |
| **Depth** | Z Push, Z Bias, Z Invert |
| **Beam** | Intensity, Focus (0 = sharp → 1 = soft 5-tap blur) |
| **Rotation** | H Center, V Center, H Spin, V Spin, H/V Spin Rate (auto-rotation), H Reverse, V Reverse, Display 0°/90°, Rotation (continuous ±180° knob) |
| **Scan** | Scan Rate (rows), Cols (samples per row), Skip/Underscan (drop fraction of lines) |
| **Linearity** | H Linearity, V Linearity (pin-cushion / barrel bow) |
| **Luminance** | Threshold, Contrast, Gamma |

### Modulation system

Two parallel modulation engines run alongside each other — **Classic** (4-slot matrix) and **Graph** (signal-graph patching). Pick one, or run both simultaneously. v9 introduces a **base/live split** architecture that fixes the long-standing "sticky parameter" bug: when modulation drops to zero or a patch is disabled, params now snap back to their user-edited base value instantly instead of sticking at their last modulated value.

#### Classic mode — Hardware-style 4-slot matrix

Emulates the original Ramp Generator, Waveform Generator (oscillator), Audio Interface, and Joystick modules. Four independent slots can each target any DCU or post-FX parameter:

- **Sources** — Sine, Triangle, Square, Saw, Pulse (with duty cycle), Ramp (up / down / triangle / hold), Audio (envelope), Audio Band [n], Beat, MIDI CC, MIDI Note, MIDI Velocity, MIDI Clock, OSC, Joystick X / Y / Z, Constant, **CV Input (audio)**, **CV Input (OSC)**, **Gamepad Axis**, **Gamepad Button** (v9)
- **Routing** — any source → any target; multiple slots sum into the same target (matching the hardware Summing Amplifier)
- **Per-slot controls** — expandable rows expose source-specific params (LFO Rate / Phase / Duty / Depth, Ramp Time, Audio Gain, etc.) plus an output stage (Curve / Range / Offset / Invert) that shapes the signal before it hits the target
- **Clock Sync** — when on, the slot's frequency slider is replaced by a Division dropdown (`1/1 1/2 1/4 1/8 1/16 1/32` plus dotted and triplet variants). Tempo is taken from incoming MIDI clock or the shared internal BPM.
- **MIDI Out** — each slot can additionally emit its current value as a CC on a chosen channel/CC pair, turning the synth into a modulation source for external gear
- **Joystick pad** — click-and-drag 2D pad in the Modulation panel, scroll wheel for Z axis

#### Graph mode — Signal-graph modulation

Inspired by the original Rutt/Etra's voltage-control philosophy: every signal is a normalized scalar (-1..1 by convention, unbounded in practice), and signals can be processed, mixed, multiplied, and chained arbitrarily before reaching a param target:

- **Beginner view** — looks identical to Classic mode; expandable rows with source/amount/target and inline controls. The backing model is a full signal graph; edits in Beginner view are non-destructive projections — switching to Advanced view reveals the underlying nodes.
- **Advanced view** — node-and-cable editor (double-click canvas to add nodes, drag ports to wire). Ships with ~40 node types spanning sources (LFO, Clock, MIDI, OSC, Video luma, Audio FFT), processors (Mix, Multiply, Curve, Slew, Delay, S&H, Logic, Math), and a special Output node that binds the graph's result to Settings params.
- **Amount range** — Graph patches support ±20 modulation depth (Classic is ±5) for extreme parameter sweeps.
- **Patch library** — save named graph patches to `localStorage`; export/import as JSON.

#### Common features (both modes)

- **Per-row Reset (↻)** — click to reset a patch's params to type-defaults (LFO Rate → 1 Hz, Shape → Sine, Amount → 0, output stage → identity) while keeping Source + Target. Shift+click for **hard reset** (also wipes Source → Sine LFO and Target → "none"). Keyboard: `R` / `Shift+R` when row is focused.
- **Global "Reset Mod"** — button at the top of the Modulation panel mutes every patch (Amount → 0) and forces all modulated params back to base in one tick. The patches stay configured — this is the "panic button" for when a complex routing gets out of hand.
- **Copy / Paste** — per-row clipboard with format-aware serialization (Classic slots and Graph beginner rows use compatible snapshots).
- **`?debug=mod` overlay** — append `?debug=mod` to the URL to see a live readout of every modulated param's `base / live / Δ` values. Updates at 30 Hz. Essential for verifying the base/live split is working correctly.

### MIDI (I/O tab)

- **Web MIDI** device pickers for input and output, persisted across sessions and auto-reattached on USB reconnect.
- **MIDI clock receiver** with a smoothed BPM readout and a flashing beat indicator. Handles 24-PPQ, start/stop/continue, and exposes `phase01` / `beatPulse` to the modulation matrix.
- **Learn table** — click *Learn*, wiggle a knob on your controller, drop the resulting binding into any Settings target with a curve (linear / exp / log / inverted) and min/max range.
- **14-bit CC** is supported — pair an MSB CC with its LSB partner (CC + 32 by default) for 16384-step resolution.
- **MIDI Out** — driven by the per-slot config in the Modulation section.
- Safari falls back to a polite "Web MIDI not available" notice — the rest of the app keeps working.

### FFT audio reactivity (I/O tab)

- **Inputs** — microphone, audio file (drag-drop with built-in transport + loop toggle), or tab/system audio capture.
- **Configurable** FFT size (512–4096), band count (8–128), and band spacing (linear / logarithmic / mel).
- **Per-band attack/release/gain/floor/threshold** smoothing, applied frame-aware.
- **Live visualizer** drawn on a small `<canvas>` showing every band in real time.
- **Spectrum -> Z displacement** routing — the band array is uploaded as a `RedFormat`/`FloatType` `DataTexture` each frame; the vertex shader samples it per row, adding a per-band Z term so audio literally pushes scan lines into the screen. Tunable amount and stride.
- **Beat detector** — spectral flux on the bass bands with an adaptive threshold and a decaying pulse, exposed as the `beat` mod source.
- **Monitor** toggle (off by default, with a feedback warning) routes the analyzed signal to your speakers.

The original `audio` mod source is preserved — it now reads `FFTAnalyzer.getEnvelope()` so existing presets and slots keep working unchanged.

### OSC bridge (I/O tab)

- **WebSocket client** in the browser; **UDP &harr; WebSocket bridge** in `tools/osc-bridge/`.
- The bridge is a tiny Node script (`node-osc` + `ws`) that translates each OSC packet to JSON and back. See [`tools/osc-bridge/README.md`](tools/osc-bridge/README.md) for protocol details and TouchOSC / Max / SuperCollider examples.
- **Learn table** identical to the MIDI side — click *Learn*, send a message from TouchOSC, target picker fills in.
- **Auto-reconnect** with exponential backoff (1 s → 30 s) so unplugging and replugging the bridge is painless.
- **Copy TouchOSC layout** button generates a starter JSON listing one fader per binding and copies it to your clipboard.

### Free-flight 3D camera

| Mode | Controls |
|---|---|
| **Orbit** (default) | Left-drag = rotate · Right-drag = pan · Scroll = zoom |
| **Fly** | Click canvas to lock pointer → `W/A/S/D` move · `Space/Ctrl` up/down · `Q/E` roll · `Shift` boost · `Esc` release |

- FOV, near, and far plane sliders — clip *into* the geometry intentionally
- **Auto-orbit** — slow hands-free camera spin around the raster
- **R** key or *Reset View* button — snaps back to saved default
- **Save Default View** — captures the current camera as the new reset target; persists across reloads and is included in preset exports

### Color & post-processing

- **Color modes** — Grayscale · Phosphor Green (P1) · Phosphor Amber · Custom Tint · Sampled Video
- **Background color** picker
- **Bloom** (UnrealBloomPass) — intensity, radius, threshold. Off by default in v2 to keep raw scan lines crisp; flip it on for the classic glow.
- **Scanline overlay** — intensity, density
- **Chromatic aberration** — radial RGB split
- **Vignette** — edge darkening
- **Burn-in feedback** — accumulation buffer with decay; produces the long-exposure phosphor-trail look of an aging CRT

### Presets

Seven built-in presets load with a single click. Each captures all DCU, color/FX, and camera default view settings:

| Preset | Description |
|---|---|
| Classic 1974 | White scan lines on black, modest bloom — the original look |
| Phosphor Green | Soft P1 green glow, heavy bloom |
| Amber Terminal | Warm amber phosphor with heavy scanline grid |
| Wireframe | Sampled video color, no bloom — readable terrain mesh |
| Heavy Bloom | Deep haze, high contrast, dramatic glow |
| Burn-In | Long-exposure feedback trails |
| Diving | Camera tucked inside the raster in fly mode |

**User presets** can be saved (named, stored in `localStorage`) and exported/imported as JSON files. The format is versioned (`_v`, currently 25) and older presets are auto-migrated on load — old files keep working, missing fields are filled with sensible defaults.

### Recording

In the *Record* section:

1. Choose format (*Auto* picks the best available codec: MP4/H.264 → WebM/VP9 → WebM/VP8)
2. Set FPS and bitrate
3. Optionally toggle **Include Mic** to capture narration
4. Click **Start Recording** — a live timer shows elapsed time
5. Click **Stop & Download** — file downloads with a timestamped filename

### Streaming (WebRTC P2P)

In the *Share* section:

1. Click **Start Broadcast** — a share URL and QR code appear immediately
2. Open that URL on any other browser or device to view the live synthesized output fullscreen with no UI
3. The viewer page reconnects automatically if the connection drops
4. Click **Stop** to end the broadcast

> Uses the public [PeerJS broker](https://peerjs.com) for WebRTC signaling. No server setup required. For reliable production use, run your own:
> ```bash
> npx peerjs --port 9000 --key yourkey
> ```
> Then update the `new Peer()` call in `src/stream/Broadcaster.ts` to point at it.

### Documentation

The synth ships with two levels of documentation:

- **In-app Help panel** — quick reference dock accessible via the Help tab. Short explanatory text for each control, plus quick-start tutorials. Collapses out of the way while you work.
- **About / Manual page** (`about.html`) — comprehensive long-form reference covering every feature, keyboard shortcut, URL parameter, MIDI/OSC/CV workflow, and browser compatibility detail. Click the "ABOUT" link in the top-right of the synth to open it. Includes auto-generated Param Reference and Node Catalog sections that stay in sync with the code. Print-friendly stylesheet for offline reference.

---

## Design principles

This codebase follows nine design principles that have shaped every feature in the v1–v10 release cycle: one authoritative source per concept, a strict base / live split for modulatable parameters, no silent fallbacks when a configured mode loses its prerequisite, explicit user action required for any audio or CV output (with a mandatory safety stack), coexistence over replacement, explicit versioned migrations, a data model that matches the user's mental model rather than the engineer's convenience, documentation that lands with the feature, and the smallest working scope first. New features and refactors are measured against these rules before they ship.

The long-form reference is [`PRINCIPLES.md`](./PRINCIPLES.md) at the repo root. An artist-facing version lives in the About page under *Design Principles*. A directive version for AI tools lives at [`.cursor/rules/principles.mdc`](./.cursor/rules/principles.mdc) and is applied automatically when working in this repo with Cursor.

---

## OSC bridge quick start

```bash
cd tools/osc-bridge
npm install
npm run dev          # runs server.ts via tsx, no build step
```

Default ports: UDP `8000` in (from your controller), UDP `9000` out (back to your controller), WebSocket `8080` (the synth). Override with `UDP_IN_PORT`, `UDP_OUT_HOST`, `UDP_OUT_PORT`, `WS_PORT` env vars.

In the synth's **I/O &rarr; OSC** panel, set the bridge URL to `ws://localhost:8080` and click **Connect**.

---

## Project structure

```
src/
├── main.ts                     entry — routes synth vs ?view=<id> (viewer mode)
├── state/
│   ├── Settings.ts             typed params store, subscribe/notify, localStorage, versioned migrations (currently v25)
│   └── paramRanges.ts          custom per-parameter slider ranges (±5×-span safety envelope)
├── input/sources.ts            webcam / screen / file source manager
├── renderer/
│   ├── RuttEtra.ts             scene, LineSegments grid, ShaderMaterial, spectrum DataTexture
│   ├── VideoCompositor.ts      v1.18: Video Source A/B blend pass (reuses the pattern compositor shader)
│   ├── CameraRig.ts            Orbit + Fly modes, FOV, reset/save view
│   ├── Postfx.ts               EffectComposer: feedback, bloom, CRT pass
│   ├── ResolutionManager.ts    centralizes renderer / postfx / pattern RT sizing + canvas fit
│   ├── patterns/               v10: synthesized "video signal" generator (parallel to webcam/screen/file)
│   │   ├── PatternRegistry.ts  pure-data map: kind → label / shader src / paramKeys / defaults
│   │   ├── PatternRenderer.ts  pattern RT + composit RT + per-kind material map + tick / setSize / dispose
│   │   ├── OscilloscopeBuffer.ts circular FIFO + DataTexture upload + rising-edge trigger alignment
│   │   └── shaders/            quad.vert + 16 pattern frag shaders + compositor (8 blend modes)
│   ├── XRManager.ts            v11: WebXR session lifecycle, mesh framing, XR perf profiles
│   ├── AnaglyphRenderer.ts     red-cyan on-canvas stereo (wraps vendored AnaglyphEffectIpd)
│   ├── AnaglyphEffectIpd.ts    vendored three.js anaglyph effect with settable eye separation
│   ├── stereoIpd.ts            shared cm→world IPD convention (anaglyph + stereo recording)
│   └── shaders/
│       ├── ruttEtra.vert.glsl  full DCU vertex pipeline + spectrum-driven Z term
│       └── ruttEtra.frag.glsl  color modes + intensity + alpha falloff
├── modulation/
│   ├── ModMatrix.ts            Classic 4-slot engine: Ramp, LFO, FFT, Beat, MIDI/OSC sources, MIDI-out
│   ├── LiveValues.ts           base/live split store — fixes "sticky params" when modulation stops
│   ├── ModDebugOverlay.ts      ?debug=mod overlay showing base/live/Δ per param
│   ├── outputStage.ts          shared curve/invert/range/offset shaping (used by both engines)
│   └── graph/
│       ├── GraphEngine.ts      signal-graph engine: compile, topology sort, per-frame tick
│       ├── types.ts            GraphPatch, GraphNode, TargetBinding, NodeDef interfaces + nodeId#port refs
│       ├── registry.ts         node type registry + getDef() lookup
│       ├── bootstrap.ts        auto-registers all node definitions at import time
│       ├── nodes/              ~48 node implementations (sources, processors, logic, video, audio, inputs, outputs)
│       ├── VideoTap.ts         per-frame video texture luminance sampler (Video CV nodes)
│       ├── library.ts          starter patch templates
│       └── userLibrary.ts      "My Patches" — named user graph patches in localStorage
├── sequencer/                  preset-keyframe timeline engine
│   ├── Sequencer.ts            transport, playhead, bracketed keyframe lerp, undo/redo
│   ├── types.ts                Timeline / Keyframe / AutomationLane schema (v2), excluded params
│   ├── lanes.ts                automation-lane evaluation (relative offsets via LiveValues)
│   ├── store.ts                timeline persistence + legacy-BPM migration toast
│   ├── interp.ts               number/color lerp, enum step-at-midpoint
│   └── easings.ts              linear/easeIn/easeOut/easeInOut/step/hold
├── project/                    v10: .synth.json workspace format
│   ├── Project.ts              snapshot/serialize/parse/migrate/apply (pure)
│   ├── ProjectStore.ts         dirty tracking, recents, FS Access API + fallback
│   ├── AutoSave.ts             60s dirty-snapshot to localStorage + recovery prompt
│   └── RecoveredSession.ts     one-shot legacy-state packaging on first launch
├── perf/
│   ├── PerformanceProfile.ts   quality/balanced/battery profile manager
│   └── FrameBudgetWatcher.ts   frame-time watchdog
├── platform/
│   ├── WakeLock.ts             keep-awake during performance
│   └── HapticFeedback.ts       vibration feedback on supported devices
├── midi/
│   ├── MidiManager.ts          requestMIDIAccess, device pickers, sendCC (7- and 14-bit)
│   ├── MidiMapping.ts          binding registry, learn(), curves, last-value cache
│   ├── MidiClock.ts            24-PPQ clock receiver, bpm + phase + beatPulse + divisionToHz
│   └── MidiClockOut.ts         24-PPQ clock transmitter (lookahead-scheduled, forced OFF each load)
├── audio/
│   ├── FFTAnalyzer.ts          AnalyserNode wrapper, banding (linear/log/mel), per-band smoothing
│   ├── BeatDetector.ts         spectral flux on bass bands, adaptive threshold
│   ├── CVInput.ts              v9: multi-channel CV reader for DC-coupled audio interfaces
│   ├── cv-worklet.js           v9: AudioWorkletProcessor — control-rate downsample + variance
│   ├── CVOutput.ts             v9: multi-channel CV writer (own AudioContext + sinkId, ChannelMergerNode, type processors)
│   ├── cv-out-worklet.js       v9: AudioWorkletProcessor — smoothing + 0V startup ramp + hard sample clamp
│   ├── Sonification.ts         v10: mesh→audio voice (osc→filter→amp→limiter, safety stack)
│   └── MeshAnalyzer.ts         v10: 8 mesh statistics from the VideoTap readback
├── input/
│   ├── sources.ts              webcam / screen / file source manager
│   └── GamepadInput.ts         v9: gamepad / HID poller, axis variance for CV Learn
├── osc/OscClient.ts            WebSocket OSC client, learn(), auto-reconnect
├── record/
│   ├── Recorder.ts             MediaRecorder wrapper, codec detection, download
│   ├── StereoCompositor.ts     v12: offscreen side-by-side stereo renderer
│   └── StereoMetadata.ts       v12: YouTube SV3D MP4 box injection (pure, tested)
├── stream/
│   ├── Broadcaster.ts          PeerJS broadcaster + QR share URL
│   ├── Viewer.ts               ?view=<id> fullscreen viewer with auto-reconnect
│   └── WhipPublisher.ts        WHIP (WebRTC ingest) canvas output → OBS/MediaMTX/Cloudflare
├── about/                      v9: about.html entry — long-form manual page
│   ├── main.ts                 loads markdown sections + injects autogen tables; nav, search, mobile TOC
│   ├── autogen.ts              builds Param Reference + Node Catalog from paramDocs + graph registry
│   └── about.css               page styles — fixed nav, scanline overlay, tables, print stylesheet
└── ui/
    ├── ControlPanel.ts         collapsible dock-able panel shell with Synth / I/O tabs
    ├── PanelPopout.ts          two-screen popout — adopts the live panel DOM into its own window
    ├── PanelSearch.ts          `/` param search across all tabs
    ├── widgets.ts              reusable form controls (slider, toggle, dropdown…) + custom-range modal
    ├── widgets/
    │   └── LearnBinding.ts     shared learn-table primitive used by MIDI + OSC
    ├── shared/
    │   └── SlotRow.ts          shared expandable modulation row component (Classic + Graph beginner)
    ├── targets.ts              shared list of routable Settings keys
    ├── panel.css               retro CRT theme — VT323 font, glow, scanlines, tab strip
    ├── presets.ts              built-in preset definitions
    ├── help/
    │   ├── content.ts          in-app Help tab content — markdown blobs and HELP_TABS
    │   ├── paramDocs.ts        v9: pure-data param descriptions (shared by Help + about page)
    │   └── HelpSection.ts      Help panel renderer (Synth / I/O tab)
    ├── graph/
    │   ├── BeginnerView.ts     beginner-view rows (uses shared SlotRow.ts)
    │   ├── AdvancedView.ts     node editor canvas (click-to-wire, palette, inspector)
    │   ├── CableLayer.ts       bezier cable rendering, kind-colored, animated flow
    │   ├── inspector.ts        binding inspector panel (Advanced view)
    │   ├── Library.ts          starter-patch sidebar
    │   ├── Probe.ts            signal probe scope
    │   ├── RegionPicker.ts     video-region picker for video nodes
    │   └── graph.css           graph-specific styles
    ├── layout/                 responsive panel system (TabBar, BottomSheet, TopStrip,
    │                           LayoutManager, ResponsivePanel, DebugOverlay)
    ├── timeline/               timeline dock UI (Dock, Track, Ruler, Inspector, Transport, LanesPanel)
    └── sections/               one file per panel section
        ├── SourceSection.ts
        ├── DcuSection.ts
        ├── DualRasterSection.ts           v23: second raster (B) — wipe/alternate + B: mod targets
        ├── ModulationContainerSection.ts  Classic/Graph/Both mode switch + Reset Mod button
        ├── ModulationSection.ts           Classic 4-slot UI (uses shared SlotRow.ts)
        ├── CameraSection.ts
        ├── ColorPostFxSection.ts
        ├── GeometrySection.ts
        ├── PresetsSection.ts
        ├── RecordSection.ts
        ├── ShareSection.ts
        ├── ProjectSection.ts              v10: New/Open/Save/Save As, recents, auto-save
        ├── PatchSection.ts                Graph mode container (Beginner / Advanced tabs)
        ├── XrSection.ts                   v11: Enter VR/AR, framing, XR perf profile
        ├── MidiSection.ts                 (I/O tab)
        ├── AudioSection.ts                (I/O tab)
        ├── OscSection.ts                  (I/O tab)
        ├── CVSection.ts                   v9: I/O tab — CV inputs + gamepad picker
        ├── CVOutputSection.ts             v9: I/O tab — CV outputs (per-channel type/source/range/test/calibrate)
        └── SonificationSection.ts         v10: I/O tab — mesh sonification voice + mappings

docs/
└── about/                       v9: long-form manual sources (markdown, rendered at build time)
    ├── 01-intro.md
    ├── 02-design-principles.md
    ├── 03-quick-start.md
    ├── 04-synthesis.md
    ├── 05-modulation.md
    ├── 06-io.md
    ├── 07-performance.md
    ├── 08-reference.md
    └── 09-about.md

scripts/
└── check-about-bundle.cjs        v9: post-build sanity check — confirms about-*.js has no synth runtime

tools/
├── osc-bridge/                 standalone Node workspace (own package.json)
│   ├── package.json
│   ├── server.ts               UDP <-> WebSocket OSC bridge
│   └── README.md
├── mcp-server/                 v1.17: MCP (Model Context Protocol) remote control
│   ├── package.json
│   ├── server.mjs              MCP stdio <-> WebSocket relay to the browser
│   └── README.md               tool list + Claude Desktop/Code setup
└── cv-bridge/                  v9: reference scripts for ADC → OSC CV bridges
    ├── README.md
    ├── mcp3008_to_osc.py       Raspberry Pi + MCP3008 (8-ch, 10-bit, SPI)
    └── ads1115_to_osc.py       Raspberry Pi + ADS1115 (4-ch, 16-bit, I²C)
```

---

## Technology

- [Vite](https://vitejs.dev/) + vanilla TypeScript — no framework, fully static output
- [three.js](https://threejs.org/) — WebGL rendering, EffectComposer, OrbitControls, PointerLockControls, DataTexture
- [PeerJS](https://peerjs.com/) — WebRTC signaling (zero backend)
- [hls.js](https://github.com/video-dev/hls.js) — HLS stream-input playback in non-Safari browsers
- [qrcode](https://www.npmjs.com/package/qrcode) — QR code generation for share URLs
- [marked](https://marked.js.org/) — markdown rendering (build-time only for about page)
- Browser APIs — Web MIDI, Web Audio (`AnalyserNode`), `getUserMedia`, `getDisplayMedia`, `enumerateDevices`, `MediaRecorder`, `captureStream`
- OSC bridge (separate workspace) — [node-osc](https://www.npmjs.com/package/node-osc) + [ws](https://www.npmjs.com/package/ws)

---

## Browser support

| Feature | Chrome / Edge / Opera | Firefox | Safari |
|---|---|---|---|
| Core synth + camera + recording | ✅ | ✅ | ✅ |
| WebRTC streaming | ✅ | ✅ | ✅ |
| Web MIDI | ✅ | ⚠️ flag | ❌ (graceful fallback) |
| Tab audio capture | ✅ | ⚠️ partial | ❌ |
| Mic / file audio | ✅ | ✅ | ✅ |
| OSC bridge | ✅ | ✅ | ✅ |

---

## Out of scope (for now)

- RTMP push to YouTube / Twitch (requires an ffmpeg backend bridging WebRTC → RTMP)
- Virtual webcam output for OBS / Zoom (requires a native helper app)
- Mobile-first layout (works on large tablets; desktop is the primary target)

---

## Credits

Original hardware design: **Steve Rutt & Bill Etra**, Rutt Electrophysics, New York, 1973.

Control set documentation sourced from the [Rutt/Etra Video Synthesizer brochure](https://vasulka.org/archive/Artists5/Rutt-E/VidSynthCont.pdf) in the Vasulka archive.
