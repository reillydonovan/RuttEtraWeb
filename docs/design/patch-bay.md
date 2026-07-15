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

**Default freeform left-to-right layout** (`src/ui/patchbay/autoLayout.ts`, new, pure/tested) — TIDY stays fully available as a fallback (owner decision, not removed):
- `graphNodeColumns` — pure topological layering over `NodeWire[]` (BFS from root/no-input nodes; a diamond's child takes `1 + max(parents' columns)`, not the sum).
- `computeDefaultLayout` — pure packing: fixed x-bands (`generators → processors → output → fields`) plus graph-node layers folded into the `generators` band by wire depth; collision-free by construction (no `resolveOverlap` needed for a fresh computed layout).
- Wired via a small `freeze(computed?)` extension (accepts optional seeded positions; with none, behavior is byte-identical to the existing "freeze wherever flex rendered it" path) and a one-shot bootstrap inside `frame()`'s existing `isConnected` guard, since real `offsetWidth`/`offsetHeight` measurements aren't available until the view is actually connected and laid out.
- `bus` (the SOURCES strip) is excluded from the free-layout unit set entirely — it's a pinned utility strip, not a signal-flow node (it was never part of the TIDY-mode reorder-stack set either). Its own header-drag-to-free-layout affordance was removed to match (it has no default position of its own to return to).
- New **ARRANGE** button (next to TIDY/FREE) re-runs the layout on demand — recovers a clean read after a hand-made mess, works whether currently TIDY or FREE.
- **Two real bugs found while wiring this in, both live-only (Playwright), not caught by unit tests or typecheck**: (1) the one-shot bootstrap flag was latched to `true` unconditionally before the layout attempt ran — if the very first connected frame measured zero-sized units (e.g. the bay isn't the active workspace tab at boot, which is the actual default: the stock 4-up preset's left window is ~400px, well under the narrow threshold), the bootstrap permanently gave up for the rest of the session. Fixed by only latching on an actual success (every discovered unit measured real geometry), retrying every frame otherwise. (2) freshly computed free units landed with `top:0` measured from `board`'s own border-box (where CSS absolute positioning's containing block sits) — but `bus`, an ordinary flow child, visually starts BELOW `board`'s padding-top, so a naive `top:0` placed every free unit under/behind the `bus` row instead of below it. Fixed by offsetting every computed top by `board`'s padding-top + `bus`'s real height + the flex gap between them.
- Verified live (Playwright): fresh load in the stock (narrow) left window correctly falls back to stacked/TIDY (narrow-mode always wins, unchanged pre-existing rule); widened past 900px shows the full LTR arrangement (22 units, zero overlaps, correct column order verified by measured `left` values); TIDY/FREE/ARRANGE all toggle correctly; the narrow→wide→narrow→wide round-trip (the ORIGINAL owner bug report this suspend/restore system was built for) still restores correctly; a freshly-added graph node (LFO, no wired input) correctly lands in the same column as the Function Generators when ARRANGE is clicked.
