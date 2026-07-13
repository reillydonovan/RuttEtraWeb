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

## Deliberate v1 scope cuts (v1.9, superseded above where noted)

- ~~No pan/zoom, no free module dragging~~ — shipped in v1.13 (above).
- **No mid-drag auto-scroll**: patching between two jacks that can't be
  on screen together in a short region means scrolling first. Fix
  candidate: edge auto-scroll during a drag.
- **Param cells are jack + label**, not mini-knobs — value editing
  lives in the Controls view; the bay is the patching surface. Mini
  knobs (same slider-face machinery) are the obvious v2.
- **Slot fields are RATE/AMT only** — the full slot editor (sync,
  output stage, slew…) stays in the Modulation section. More faceplate
  controls per module are v2 candidates via the `SlotRowAdapter` field
  builders.
