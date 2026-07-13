# Skeuomorphic "hardware panel" UI skin — design

Status: **Phase 1 shipped** (2026-07-13, v1.5.0): skin module +
localStorage preference, title-bar ◉ toggle, rotary-knob face for
sliders, bat-switch face for toggles, pushbutton/LCD CSS reskins,
popout stamping, PRINCIPLES/README/About/Help updates. Phases 2–4
(live-mod arcs, routing affordance, full chrome) not started.
Branch: `skeuomorphic` (owner decision 2026-07-13 — build here despite
the doc's original branch-hygiene concern; the branch's earlier commits
are the unrelated Keyframing v2 / timeline work).

## Goal

A runtime-togglable second skin for the control panel: rotary knobs,
bat switches, illuminated indicators, meters — the visual language of a
Eurorack/analog synth panel. Not a reskin only: the synth's actual state
must be legible through it, with **base** values shown as physical
control position and **live** (modulated) values shown as a visually
distinct layer on top. Direct manipulation writes base through exactly
the widget paths the standard skin uses.

## What the investigation found (why this is cheaper than it sounds)

Three existing mechanisms mean the skin is mostly *joining* patterns
rather than inventing them:

1. **Widgets already have swappable faces.** `slider()` builds FOUR
   interchangeable control surfaces at construction time (native range,
   touch scrub bar, stop chips, tappable readout) and CSS — keyed off
   `body[data-layout="compact"]` — decides which are visible. No JS
   rebuild on layout flip. A knob is a fifth face selected by
   `body[data-skin="hardware"]`, using the identical convention.
2. **One write path per widget.** Every way of setting a slider (range
   drag, scrub, stop chip, keyboard, numeric modal, double-click reset)
   funnels through `setFromDisplay()`, which handles the timeline
   auto-key branch, undo-gesture collapsing, and the base write. A knob
   face calls `setFromDisplay()`/`endDragGesture()` and inherits ALL of
   that — auto-keying, undo, keyframe diamonds — with zero new write
   logic. **The base/live split is preserved by construction.**
3. **Read-only live plumbing already exists.** `liveValueBus.ts`
   (lazy handle to `LiveValuesStore`) already feeds each slider's live
   badge; `getBase`/`getLive`/`getNamespaceOffset('timeline', …)` give
   everything a live-arc needs. `ActiveTargetsBus` already publishes
   which engine (classic/graph) is writing which key. Nothing new is
   read from the engines; nothing is ever written back.

## 1. Where the skin toggle lives: localStorage, not Settings

A new tiny module `src/ui/skin.ts`:

- `getSkin(): 'standard' | 'hardware'`, `setSkin(s)`, `subscribeSkin(fn)`
- persists to `localStorage['rw-ui-skin']`
- stamps `document.body.dataset.skin` — and the popout document's body:
  `PanelPopout` moves the panel DOM into a `window.open` document, so
  `skin.ts` must stamp every registered panel document, same as the
  ownerDocument-proofing the popout work already did for drag handlers.

**Why not `Settings`:** the skin changes zero synth behavior — same
params, same values, same engines. `Settings` keys ride into presets,
`.synth.json` projects, and auto-save payloads; loading someone else's
patch must never restyle your panel (a look/score is not an operator
preference). Keeping it out of `Settings` also means no `_v` bump and no
migration surface.

**Acknowledged counter-precedent:** `panelCollapsed` and `timelineDock`
ARE Settings keys. Those are *workspace geometry* deliberately made
project-portable. Skin is operator taste, closer to OS theme. If a
future owner decision wants skin embedded in projects, it can be added
then with an explicit migration (principle 6) — the reverse (removing a
key from patch data) is messier, so we start local.

**Toggle UI (proposal):** a small button in the panel title bar next to
the existing actions (visible in both skins), labeled `SKIN`. Cheap to
move if the owner prefers it in a section.

**Layout interaction (decision, stated not asked):** the hardware skin
applies only in `standard`/`expansive` layouts. In `compact` (touch),
the existing scrub-bar/stop-chip faces stay regardless of skin — small
rotary knobs are a known-bad touch target, and compact mode's faces
exist precisely because of iOS pointer quirks. CSS expresses this as
`body[data-skin="hardware"]:not([data-layout="compact"])` selectors.

## 2. Per-control-type mapping

All rendering is CSS + inline SVG. **No new dependencies.** Reuses the
`--re-*` tokens (`panel.css` `:root`; see `panel-design-system.md`) —
phosphor green `--re-accent` keeps meaning "active/lit", amber
`--re-accent-2` keeps its ONE reserved meaning ("timeline/automation
owns this value").

| Control (widgets.ts) | Hardware face | Base vs. live |
|---|---|---|
| `slider()` | SVG rotary knob, ~270° sweep, engraved tick scale from `effMin..effMax` (respects v19 custom ranges). Drag = vertical pointer scrub (Shift = fine); double-click reset; right-click → existing numeric modal; keyboard unchanged (same handlers rebound). Small LCD readout under the knob replaces `.rw-num`. | **Knob pointer = base (+ timeline offset)** — identical semantics to today's `toDisplay()`: the number you'd edit. **Phosphor arc from pointer angle to live angle = residual modulation** (Classic/Graph/CV wobble), replacing the `▸` text badge in this skin; driven by the same `whenLiveValues` subscription the badge uses. Amber ring segment when the param is timeline-keyed (`rw-slider--tl` equivalent). |
| `toggle()` | Bat/rocker switch with engraved ON/OFF and an LED lens lit when true. | LED = base. (Booleans aren't continuously modulated; the existing dual-engine `rw-mod-dot` still renders.) |
| `dropdown()` | v1: keep the `<select>`, reskinned as a backlit LCD strip with a bezel (pure CSS). Rotary selector ("chicken-head") for short enums is Phase 4 — it needs per-option detents and adds no information. | n/a — dropdowns aren't modulation targets. |
| `button()` | Momentary panel pushbutton: raised bezel, press-depression, optional LED variant for stateful actions (e.g. RECORD). | n/a. |
| `colorInput()` | Swatch in a screw-mounted lens frame; stays fixed-size (design-system rule). | n/a. |
| Joystick (`.rw-joystick-wrap`, ModulationSection) | Hardware gimbal styling on the existing pad. | Stick = base position; a small phosphor ghost-crosshair shows the live XY if modulated. |
| `readout()`, FFT/audio meters | Phase 4: LED bargraph / VU-needle styling. | Meters are live by definition — no split to draw. |
| `textInput()`, file inputs | LCD strip styling (the global `::file-selector-button` safety net already themes the button; this only restyles). | n/a. |

**Implementation shape for the knob (the only substantial one):** built
inside `slider()` like `scrubBar` is — always constructed, CSS-hidden
outside the hardware skin. Its pointer handlers reuse the scrub bar's
document-level pointermove pattern (popout-safe via `ownerDocument`).
The live-arc update piggybacks on the *existing* `lv.subscribe` call in
`slider()` (currently feeding the badge) — no second subscription, no
per-frame work when the value isn't changing (LiveValuesStore already
dedupes republishes).

Sections that hand-build controls (Sonification's raw ranges, Capture
Settings) fall back to the globally-themed native controls in hardware
skin — acceptable for v1, listed as Phase 4 polish.

## 3. Patch-cable visualization: honest assessment → defer

The **data** is easy: Classic is 4 fixed slots (`Settings.modSlots`:
source→target+amount), Graph is a serialized DAG (`Settings.modGraph`:
nodes, `inputs` refs, `TargetBinding`s), and `ActiveTargetsBus` already
streams which targets are hot. The **geometry** is the whole cost:
targets live in a scrolling, two-tab, mostly-collapsed accordion
(possibly split across a popout window!), so real cables need per-frame
anchor tracking, an SVG overlay per document, and an answer for "cable
into a collapsed section." Estimate: **comparable to Phases 1+2
combined**, for a drawing that is occluded most of the time.

Recommendation: **not in v1.** Phase 3 ships the cheap 90%: a lit
**jack** affordance on every currently-modulated knob (colored per
engine, from ActiveTargetsBus), click → scroll-to/highlight the source
slot or graph node. Full bezier cables only make sense in a future
dedicated spatial "rack view", which would be its own design doc.

## 4. Phased rollout

Docs land with each phase (principle 7): README recent-changes, the
About manual (`docs/about/*.md` — markdown rendered at build time, so
the zero-synth-runtime guarantee of `about.html` is untouched; skin code
lives entirely in `src/ui/` + `panel.css`, none of it imported by the
about entry), in-app Help (`ui/help/content.ts`), and this doc's status.

- **Phase 1 — mode toggle + core faces, base-only.** `skin.ts`,
  title-bar toggle, knob face for `slider()` (base pointer + LCD
  readout, all write paths reused), switch face for `toggle()`,
  CSS-only pushbutton/LCD reskins for button/select/text/color. Live
  badge continues to work as-is. Docs: README, About "Interface"
  section, Help, PRINCIPLES.md additions (below).
- **Phase 2 — live visualization.** Phosphor mod-arc on knobs (replaces
  the text badge in this skin), amber timeline-keyed ring, joystick
  ghost-crosshair.
- **Phase 3 — routing affordance.** Lit per-engine jack on modulated
  knobs + navigate-to-source. Re-assess full cables afterward; expected
  answer stays "separate rack-view design."
- **Phase 4 — full chrome.** Rack rails/screws/engraved section labels,
  rotary selectors for short-enum dropdowns, VU/LED meters for audio
  sections, hardware-face variants for the hand-built section controls.

Each phase is independently shippable and independently revertable; the
standard skin is untouched throughout (coexistence, principle 5).

## 5. New invariants (to add to PRINCIPLES.md with Phase 1)

1. **Skin state is local UI preference — never patch data.** It lives
   in localStorage via `src/ui/skin.ts`, not in `Settings`, presets,
   timelines, or projects.
2. **A skin is a face, not a fork.** Alternate skins render inside the
   existing widget functions and write base through the same single
   write path (`setFromDisplay()` and friends). No parallel widget
   tree, no second setter path — ever.
3. **Skin code reads `LiveValuesStore` for display only.** (This is
   principle 2 restated at the skin boundary, because a skeuomorphic
   control that "shows live" is exactly where someone will one day be
   tempted to write live back into base.)

## Open questions for the owner

1. Base branch: `main`, or `skeuomorphic` after it merges? (Blocks
   branch creation, not this doc.)
2. Toggle placement: panel title bar (proposed) or a section row?
3. Skin scope on compact/touch: doc proposes hardware skin is
   desktop-layout-only (see §1) — veto if you want knobs on touch too.
