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
- **Param cells are jack + label**, not mini-knobs — value editing
  lives in the Controls view; the bay is the patching surface. Mini
  knobs (same slider-face machinery) are the obvious v2.
- **Slot fields are RATE/AMT only** — the full slot editor (sync,
  output stage, slew…) stays in the Modulation section. More faceplate
  controls per module are v2 candidates via the `SlotRowAdapter` field
  builders.
