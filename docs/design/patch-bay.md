# Patch Bay view — design

Status: **v1 shipped** (2026-07-13, v1.9.0). This is the dedicated
spatial "rack view" that `docs/design/skeuomorphic-skin.md` §3
explicitly deferred to its own design doc. Owner direction: "the front
panel of the OG Ford Model T of the Rutt/Etra… an actual patch bay as a
whole" — inspired by the 1973 console, not a replica.

## What it is

A full-region hardware faceplate (`src/ui/patchbay/`), registered as
the `patchbay` view in the Phase-2 workspace registry — host it in the
side region, the dock (the `Window ▸ Layout ▸ Patch Bay` preset puts it
in a tall dock), or leave it parked. Unlike the rack SKIN (which
overlays cables on the accordion panel and coexists untouched), the bay
owns its own spatial layout, which kills the rack's hardest problem by
construction: **every jack is always visible at a fixed position**, so
there is no DOM scanning and no anchor-fallback chain — the jack
registry is static and anchors are live rects of known elements.

## Layout (patchbayLayout.ts — pure, tested)

- **Left rail** — 4 × FUNCTION GENERATOR modules (the Classic mod
  slots): enable LED, SRC IN jack + source LCD, RATE and AMT fields,
  OUT jack. Below them the SOURCES signal field (SINE/TRI/SQR/SAW/
  PULSE/RAMP waveforms + AUDIO ENV/AUDIO BAND/BEAT/JOY X/JOY Y) and the
  GRAPH ENGINE chip (the read-only anchor for graph-binding cables).
- **Column 1 — the DCU**, grouped by the manual's brochure sub-groups
  (docs/about/04-synthesis.md): POSITION & SIZE, DEPTH, BEAM, ROTATION,
  SCAN, LINEARITY, LUMINANCE.
- **Column 2** — COLORIZER/POST-FX, CAMERA, PATTERN GENERATOR,
  GEOMETRY, AUDIO ANALYZER (from `PARAM_DOCS.panel`), a visible
  AUXILIARY catch-all (new targets can't silently vanish — the
  coverage test in `__tests__/patchbayLayout.test.ts` asserts every
  TARGETS entry lands exactly once), and **CV OUT** with real jacks for
  the `cv:N` virtual targets (which the rack skin deliberately skips).

## Cable model (all writes are patch-data writes)

Reuses `ui/cableDraw.ts` ('sag') and `ui/rack/rackGeometry.ts` —
`applyCableTarget`, the new `applyCableSource`, `slotForParam`,
`nearestJack`. Nothing touches live values.

- **OUT → param jack** sets `modSlots[i].target` (plug = enable, drop
  in space = unplug) — bidirectional, same as the rack skin post-Phase-0.
- **SOURCES jack → SRC IN** sets `modSlots[i].source` for the
  "performable core" sources; sources needing extra config (MIDI CC
  number, CV channel, pattern output id) keep their dropdown home in
  the Modulation panel — the SOURCES field deliberately isn't an
  exhaustive ModSource list.
- **Graph bindings** render as dim cyan cables from the GRAPH ENGINE
  chip, read-only; the graph editor stays their editing surface.
- Cable canvas is screen-space over live jack rects (the AdvancedView
  trick), popout-safe (recreated when the view changes documents),
  rAF-driven with an `isConnected` early-out so a parked bay costs
  nothing measurable.

## v1.13: the bay became a node editor

Owner-directed follow-up (supersedes the "no pan/zoom, no free
dragging" cut below): board-layer **zoom** (wheel + −/100%/+ buttons;
the cable canvas stays in screen space so lines are crisp at any
zoom), **header-drag** interactions — reorder within the vertical
stacks (insertion line), or drop past the stacks' CONTENT extent
(content-based hit-test; the flex columns' empty tails don't swallow
drops) to break the board into **free layout** with magnetic snapping
(left/top align, stack above/below at a 10px gap), **TIDY** to restore
the flow, and free-layout **suspend/restore** across narrow-mode
round-trips so a custom arrangement survives window resizing. Free
positions are session-local by design.

## v1.14: click-drag-to-pan, dynamic reflow, a VIDEO SOURCE module

Owner-directed follow-up round two:

- **Click-drag-to-pan** on empty background (`PatchBayView.ts`) — a
  pointerdown whose target isn't a module/field/jack/control starts a
  scroll-position drag, the standard node-editor gesture. A **150px
  pan-headroom** padding on `.rw-pb-surface` (the scrolled element, not
  the board — keeps the board's own `width:100%` math untouched) gives
  the outermost free-layout node room to have its own far edge brought
  into view instead of sitting flush against the scrollport. Scoped to
  `.rw-pb-freemode:not(.rw-pb--narrow)` only: the default flow layout
  already exactly fills its window (extra room there would just open
  with dead space scrolled into view), and a free layout that gets
  squeezed narrow (see below) doesn't need it either since it's
  temporarily flattened back to the stacked flow.
- **Dynamic reflow going from wide back to narrow** (owner bug report:
  nodes didn't resize shrinking a maximized window back down): the flow
  layout's `.rw-pb-board` changed from `width:max-content` to
  `width:100%` so it continuously reflows with the container instead of
  holding its intrinsic size until the ~900px narrow snap. A free
  layout's units now rescale their `left`/`width` proportionally on
  every resize (tracked against a `freeRefWidth` baseline in
  `PatchBayView.ts`), and `syncSurfaceSize()` was rewritten to derive
  from `root.clientWidth`/`clientHeight` (ground truth) instead of
  reading `board.scrollWidth` back — the old version was circular once
  `width:100%` meant the board just echoed whatever surface was last
  set to, so it never shrank again after the first zoom or free-mode
  action locked in an explicit surface size.
- **A VIDEO SOURCE module** in the rail, above the FUNCTION GENERATOR
  stack: WEBCAM / SCREEN / FILE buttons and a live LCD readout, wired
  directly to the `VideoSourceManager` instance Controls already uses
  (`createPatchBayView(settings, source)` — the factory in `main.ts`
  now threads it through). No jack — like `cols`/`scanRate`, it's a
  one-shot device/stream choice, not a continuous modulation signal.

## Deliberate v1 scope cuts (v1.9, superseded above where noted)

- ~~No pan/zoom, no free module dragging~~ — shipped in v1.13 (above).
- ~~No mid-drag auto-scroll~~ — pan is now click-drag on empty
  background at any time (v1.14); a true auto-scroll-while-dragging-a-
  cable is still unbuilt if that turns out to not be enough.
- ~~Param cells are jack + label, not mini-knobs~~ — stale: mini-knobs
  shipped in a later round (`createMiniKnob`, `miniKnob.ts`) — every
  faceplate param cell has a real rotary knob + editable value field,
  not just a jack.
- **Slot fields are RATE/AMT only** — the full slot editor (sync,
  output stage, slew…) stays in the Modulation section. More faceplate
  controls per module are v2 candidates via the `SlotRowAdapter` field
  builders.

## v1.22: cable/jack visual states + default left-to-right layout (branch `cableruns`)

Two owner-directed features, live-performance/real-time-mixing focused ("a manageable mess with an intuitive layout for plugging shit in, mixing, and checking it out").

**Cable states** — six states, most genuinely new (`--plugged`/`--hover`/`--grab` already existed, flat one-color):
- `distanceToCable` (new, `cableDraw.ts`, pure): samples the cubic bezier at 20 steps for a click/hover hit-test against a drawn cable — no such hit-test existed before (cables were draw-only, no persistent identity). Each cable kind gets a stable id string (`classic:${slotIndex}`, `graphbind:${bindingId}`, `nodewire:${targetNodeId}#${targetPort}`, etc.) so state can attach to "this cable" across frames despite everything being redrawn from scratch every frame.
- `CableDrawOpts` gained `selected`/`hovered` (a white outline pass under the color stroke for `selected`, a smaller glow bump for `hovered` — visually distinct from `highlight`, which stays the drag rubber-band's own look).
- Click-to-select reuses the EXISTING pan-handler's pointerdown/up pair (checking `!started`, i.e. the gesture never crossed the pan threshold) rather than a new listener — the cable canvas is `pointer-events:none` by design, so clicks always fall through to `root` anyway.
- Per-kind drag-hover color: the two `Pending` kinds whose candidate pool spans two jack kinds (`dragGraphOut`/`dragParamOut`, via `graphOutHoverSetter`) now preview the color the drop would ACTUALLY create (`NODE_WIRE_COLOR` for a node wire, `GRAPH_COLOR` for a param binding) via an inline `--rw-hover-color` custom property, instead of one flat green for every kind — applied to every other single-kind drag too, for consistency. The rubber-band cable itself got the same fix (`to-graphout`/`to-paramout` previously hardcoded ONE color regardless of which kind was actually hovered — a real pre-existing inconsistency, fixed in the same pass).
- `tooltip.ts` gained `scheduleTooltip`/`cancelTooltip` — a programmatic, cursor/candidate-anchored sibling to the existing native-hover-driven `attachTooltip`, since a drag's snap candidate changes without a fresh `pointerenter` on the newly-snapped jack.
- Idle hover (mouse resting, no drag) is pure CSS `:hover` for jacks (no JS at all) and a lightweight `pointermove` hit-test (early-exits the moment it finds a hit under threshold) for cables.
- **A real bug found while wiring this in**: the very first version made `startDrag(p)`'s helper body literally `startDrag(p);` — a `replace_all` edit meant for the ~10 `dragXxx` call sites also rewrote the helper's OWN definition (since the text matched), producing infinite recursion the instant any drag started (`RangeError: Maximum call stack size exceeded`). Caught live via Playwright (not by typecheck — TS doesn't flag self-recursive calls), fixed by re-editing just the helper body back to the real assignment.

**Default freeform left-to-right layout** — built (a pure `autoLayout.ts` column-packing algorithm, wired via a `freeze(computed?)` extension) and verified live, then **reverted the same session** on owner feedback ("stick to the default as before... not try the left to right patch for now"). TIDY/stacked remains the one default; nothing about `freeze()`/`allUnits()`/`bus`'s draggability changed from the pre-v1.22 baseline. See v1.23 below.

## v1.23: layout revert + cable accept/reject gradient + custom cursors

Immediate owner follow-up to v1.22: keep the cable-states work, drop the default-layout experiment entirely, and go further on cable feedback ("a gradient for the cable run to indicate if it can be patched or not on top of the hover state for the jack. I like both things") plus custom cursor graphics ("so it doesn't look like browser native mouse icons during various states").

- **Reverted the default LTR layout wholesale**: deleted `autoLayout.ts` + its test file, restored `freeze()`/`allUnits()`/`makeUnitDraggable(bus, ...)` to their pre-v1.22 form (no `computed` parameter, `bus` back in the free-unit set and individually draggable), removed the ARRANGE button and every `data-pb-unit-id` attribute. The v1.22 cable-states work (id scheme, `selectedCableId`, per-kind hover color, tooltips, idle hover) is untouched — it doesn't depend on anything the revert removed.
- **Cable accept/reject gradient** (`cableDraw.ts`): `CableDrawOpts.gradientEnd` — when set, `drawPatchCable` strokes with a `ctx.createLinearGradient(a, b)` from `color` to `gradientEnd` instead of a flat color (the glow/`shadowColor` stays solid — a gradient shadow reads muddy at cursor scale). The drag rubber-band now always passes one: `pending.hover != null` (every `Pending` variant has this field, generalized across all 10 drag kinds) → fades to `CABLE_ACCEPT_COLOR` (`#ffffff`); otherwise → `CABLE_REJECT_COLOR` (`#ff5566`). Reuses the SAME hover-tracking data the per-kind jack-color feature already reads — no new validity detection, just a second visual channel for the same fact, layered on top of (not replacing) the jack's own hover glow, per the owner's explicit "I like both things."
- **Custom cursor graphics** (`patchbay.css`, Patch Bay only — rack skin's own overlay cursors untouched): inline SVG data-URI cursors replace every native `grab`/`grabbing` keyword — a 4-way move glyph for the idle/panning board background and module-header dragging, a jack-ring/filled-circle pair for idle/dragging jacks, and a checkmark-circle/slash-circle pair (`.rw-pb-cursor-accept`/`.rw-pb-cursor-reject`, toggled on `root` from the exact same `pending.hover != null` check the gradient reads) for the accept/reject drag states. Each cursor declaration keeps its native keyword as a comma-separated fallback.
- **A real specificity bug found while verifying the jack cursors, not by typecheck**: `rack.css`'s `body[data-skin="rack"]:not([data-layout="compact"]) .rw-rack-jack` rule is a 3-class-equivalent selector; the Patch Bay's own `.rw-patchbay .rw-rack-jack` rule is only 2 — so with the rack skin active (the app's default), rack.css silently won the `cursor` property specifically, even though this file's own header comment says bay jacks are "always visible, whatever the skin." Every OTHER property the two rules share (width/height/border/background) happens to be visually identical between the two files, which is exactly why this specificity gap went unnoticed until a custom cursor value made the two rules' outcomes visibly different. Fixed with a scoped, commented `!important` on the two jack cursor declarations — the deliberate right tool for "this must win regardless of what else targets this shared class."
- Verified live (Playwright): `computed.cursor` on a Patch Bay jack starts with the custom SVG data URI (not silently falling back to `grab`) both idle and during a drag; the root's cursor and CSS classes flip between accept/reject as the drag crosses from empty background onto a valid target and back; the gradient renders visibly fading from a source color toward white near an accepted target (screenshot-confirmed); the layout revert leaves the bay opening in stock TIDY with only the FREE button present (no ARRANGE). Full suite (548/548 — same count as pre-v1.22, since the 9 `autoLayout.test.ts` cases were deleted with the file, and the 4 `cableDraw.test.ts` cases from v1.22 remain), typecheck, build, about-bundle guard all clean.

## v1.24: custom cursors go app-wide

Immediate owner follow-up to v1.23: push the Patch-Bay-only cursor work out to the whole GUI ("every state that is possible for the cursor to be substituted by a browser default, replace with something in the design aesthetic... just improved upon"), plus the resting arrow and text caret, native `<select>`/checkbox/radio controls, and the middle-mouse-button autoscroll cursor.

- The Patch Bay's hardcoded SVG cursor values were promoted into a new shared `src/ui/cursors.css` (`--rw-cur-*` custom properties), imported once from `main.ts`; every other stylesheet (`panel.css`, `skin.css`, `graph.css`, `layout.css`, `menubar.css`, `workspace.css`, `timeline.css`, `tutorial.css`, `rack.css`, and `patchbay.css` itself) now references the same tokens instead of a native keyword — one source, per repo principle 1.
- The plain resting arrow (`html, body`) and the text-input caret (all real text-editable elements, via an unscoped safety-net rule) are now custom too; native `<select>`/checkbox/radio get the pointer token via a second small unscoped rule (closing a real gap — `.rw-select` never had an explicit cursor rule at all).
- A global `mousedown` listener in `main.ts` suppresses the browser's native middle-click autoscroll gesture app-wide (previously only locally suppressed inside the Patch Bay's own pan handler).
- See CLAUDE.md's "State of the app-wide custom cursor round" entry for full detail. No Settings/schema change; pure CSS + one small JS listener.

## v1.25: node hover/select/drag-cursor states

Immediate owner follow-up: give module/graph-node units the same hover/select/drag visual language the cables already have — a header hover glow, click-to-select with a persistent outline, and a cursor that stays consistent for the whole drag gesture, not just while directly over the unit.

- `patchbay.css`'s `.rw-pb-unit-handle:hover` (already added by `makeUnitDraggable()` to every module/field/graphnode/bus header) gets a background wash + inset glow.
- New `selectedUnit`/`selectUnit()` in `PatchBayView.ts` — click a header (no drag) to select, click empty board background to clear; mutually exclusive with cable selection so the two outline styles never compete.
- `root` gets a `.rw-pb-node-dragging` class for the duration of any unit drag, forcing the grabbing cursor over the whole board (`!important`) rather than relying on a per-element rule that fast pointer motion can outrun.
- See CLAUDE.md's "State of the node hover/select/drag-cursor round" entry for full detail. Not yet spot-checked live in a browser this round (no browser-automation tool available in that session) — worth a follow-up check next time one is.
