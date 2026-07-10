# Design: Keyframing v2 — per-parameter automation lanes (AUDIT item 25)

Status: **data layer + full hybrid UI shipped (branch `timeline`, 2026-07-10). Record-knob-moves deferred — open question 1 below stays open; questions 2–4 also still open.**

## Owner decisions this design implements

1. **Automation writes through LiveValues.** Lanes are a third offset-writer alongside the Classic and Graph engines, contributing under the `'timeline'` namespace: `live = (base + Σoffsets) × Πfactors`. A lane sums with the knob exactly like CV into an input sums with the knob on the original hardware.
2. **Keyframes are relative offsets by architecture.** A lane point stores `{bar, value}` where `value` is an offset, not an absolute. The **UI previews the resolved absolute value** (`base + offset`) wherever an offset is entered — a display affordance, not a storage change.
3. Existing preset-snapshot keyframes are untouched — they continue to write *base* values through Settings during playback (they ARE "moving the knobs"); lanes ride on top. The two systems coexist and compose: snapshot keyframes set the scene, lanes wiggle single parameters against it.

## Data model (Timeline `_v: 2`)

```ts
interface AutomationPoint { bar: number; value: number; easing?: EasingType }
interface AutomationLane  { id: string; paramKey: string; enabled: boolean; points: AutomationPoint[] }
interface Timeline        { _v: 2; …; lanes: AutomationLane[] }
```

- Same easing vocabulary as keyframes, applied INTO a point (same convention).
- Outside the point range the lane **clamp-holds** the first/last value (predictable during loop-length edits; revisit if "release to 0" proves more musical).
- Multiple lanes on one param **sum** (summing-amplifier convention).
- Migration: `normalizeTimeline` backfills `lanes: []` and drops malformed lane entries individually. Deep-clone undo/redo and JSON export/import carry lanes automatically (they're plain data on the Timeline).

## Runtime

`Sequencer.applyLanes()` evaluates every enabled lane at the playhead (pure `laneOffsets()` in `src/sequencer/lanes.ts`, fully unit-tested) and pushes one `setContributions('timeline', offsets)` call. It runs on every playhead move — tick, seek, load, stop — and after every lane edit (`editLanes()` wraps mutation + undo + notify). The same-frame-clear semantics of `LiveValuesStore` give lanes the identical no-stickiness guarantee as the modulation engines: mute or delete a lane and its target snaps to base instantly.

Deliberately NOT excluded-params-filtered: lanes are explicit per-param opt-ins, unlike whole-snapshot interpolation.

## Shipped full UI (owner decisions 2026-07-10: hybrid, Resolve/Blender model)

The interim `LANES (v2 preview)` numeric strip is gone, replaced by:

- **Inline keyframe diamonds** (`src/ui/keyframeAffordance.ts`, attached from `slider()` in widgets.ts) on every modulatable panel row: hidden until a timeline exists; hollow = keyable, outlined = lane exists, filled = point at playhead. Click semantics (pure, tested in `src/ui/keyframeState.ts`): create lane with a 0-offset point / add a point pinning the evaluated curve value / remove the point — **live values never jump on key-create**. Right-click: Open in timeline / Remove point / Remove automation. Popout-safe (ownerDocument menus).
- **Lane rows in the dock** (`LaneEditor.ts` / `LaneRow.ts`) inside the shared scroll canvas under the scene track: canvas-2d curve with easing, dashed zero line, DOM point diamonds draggable in 2D (beat-snap, Alt = free; one `editLanes` commit per drag = one undo step), per-point easing context menu, sticky-left chips (mute / count / expand / delete), value axis from the param's effective slider span (v19 overrides honored). Inspector LANE POINT mode: bar / offset / easing / resolved-absolute preview.
- **SCENES rename**: the snapshot track is labeled SCENES with block markers (lane points stay small diamonds) — *scenes set everything, lanes animate one knob*. JSON field remains `keyframes`.
- Foundations: `Sequencer.addTimelineListener/addPlayheadListener` (multi-consumer, fires on `load(null)`), persistence moved to main.ts (lane edits save without the dock), `paramRangeRegistry` (designed ranges indexed from `slider()`), pure `laneGeometry.ts`.

## Deferred from the full UI (still open)

- **Record knob moves** — while playing with "Write" armed on a lane, Settings changes to that param are captured as points (thinned by a Douglas-Peucker pass on stop). Blocked on open question 1 below. Nothing shipped assumes points come from clicks — a recorder is just another producer calling `editLanes`.
- Copy/paste points, multi-select, lane color from the target's panel group.

## Open questions for the owner

1. **Record semantics**: when recording knob moves into a lane, should the recorded points be (a) offsets relative to the base at record-arm time (pure relative model, but the knob the user turns IS the base — recording would need to freeze the base and route the gesture into the lane), or (b) captured absolutes converted to offsets against the current base on write? (a) is cleaner but needs a "lane-write mode" that intercepts the knob; (b) is simpler but re-anchors if the base later changes.
2. Should lanes support `multiplicative` mode? `LiveValuesStore` factors make it a two-line engine change; UI cost is one dropdown per lane.
3. Clamp-hold vs decay-to-zero outside the point range.
4. Per-lane output slew (reuse `slewToward`) to smooth stepped hand-authored points?

## Tests

`src/sequencer/__tests__/lanes.test.ts`: empty/clamp/linear/easing/exact-bar evaluation, disabled/empty skip, same-param summing, upsert/remove purity. Timeline v1→v2 normalization is covered by the store's sanitize path (malformed lanes dropped individually).
