# Design: Keyframing v2 — per-parameter automation lanes (AUDIT item 25)

Status: **data layer + minimal lane editor implemented; full timeline UI awaits owner review of this doc.**

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

## Shipped minimal UI (the "one working lane")

A `LANES (v2 preview)` strip under the timeline dock: add a lane from the full TARGETS list, enable/mute, type a relative offset and **Set @ playhead** (exact-bar upsert), remove point at playhead, delete lane, point count, and the **resolved-value preview** (`→ base+offset`) live next to the offset field. Crude by design — it proves the data layer end-to-end and is enough to author working automation today.

## Proposed full UI (awaiting review — not built)

- **Lane rows under the track**: each lane renders as a horizontal strip below the keyframe track, sharing the ruler's bar scale; points are draggable diamonds with a value axis (auto-scaled to the param's slider range from the designed bounds / v19 overrides).
- **Curve rendering** between points using the segment easing; click-drag on a segment cycles easing.
- **Record knob moves**: while playing with "Write" armed on a lane, Settings changes to that param are captured as points (thinned by a Douglas-Peucker pass on stop). This is the natural fit for the relative model: recorded value = `settings.get(key) - baseAtArmTime`… **open question** (see below).
- Copy/paste points, multi-select, per-lane collapsed height, lane color from the target's panel group.

## Open questions for the owner

1. **Record semantics**: when recording knob moves into a lane, should the recorded points be (a) offsets relative to the base at record-arm time (pure relative model, but the knob the user turns IS the base — recording would need to freeze the base and route the gesture into the lane), or (b) captured absolutes converted to offsets against the current base on write? (a) is cleaner but needs a "lane-write mode" that intercepts the knob; (b) is simpler but re-anchors if the base later changes.
2. Should lanes support `multiplicative` mode? `LiveValuesStore` factors make it a two-line engine change; UI cost is one dropdown per lane.
3. Clamp-hold vs decay-to-zero outside the point range.
4. Per-lane output slew (reuse `slewToward`) to smooth stepped hand-authored points?

## Tests

`src/sequencer/__tests__/lanes.test.ts`: empty/clamp/linear/easing/exact-bar evaluation, disabled/empty skip, same-param summing, upsert/remove purity. Timeline v1→v2 normalization is covered by the store's sanitize path (malformed lanes dropped individually).
