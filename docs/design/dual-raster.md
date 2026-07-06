# Design: Dual raster / dual trace (AUDIT items 8–11)

Status: **implemented behind a feature flag, default OFF** (`dualRasterEnabled`, settings v23). The owner flips the flag and judges; the singleton path is untouched when the flag is off.

## Concept

Two independently modulated rasters fed by the same video signal, like a dual-trace oscilloscope on the hardware bench:

- **Wipe mode** — the dual-trace slider sweeps a horizontal split: slider down = all raster A, up = all raster B, anywhere between = B occupies the top portion, A the bottom, both at full resolution and independently controlled.
- **Alternate-line mode** — rasters interleave row-by-row (even scan rows = A, odd = B); the slider doesn't apply; each raster gets half the vertical resolution.
- The wipe position (`dualTracePos`) is an ordinary modulatable target — LFO/CV/MIDI can sweep the split (item 11).

## Architecture

**One geometry, two materials.** The scan grid (`scanRate × cols`) is identical for both rasters, so raster B is a second `LineSegments` sharing raster A's `BufferGeometry` with its own `ShaderMaterial` instance — zero extra geometry memory, one extra draw call. Same vertex shader for both, parameterized by three uniforms:

- `uDualMode` — 0 off / 1 wipe / 2 alternate (on both materials)
- `uDualSide` — 0 on material A, 1 on material B
- `uWipe` — split position (both)

Row visibility rides the existing Skip mechanism (`vAlive` + push-offscreen): in wipe mode a row is kept if it's on its side of the split (`uv.y` vs `uWipe`); in alternate mode by row parity. With `uDualMode = 0` the math is bypassed entirely — the singleton path renders exactly as before, and mesh B isn't in the scene graph at all until first enable.

**Parameter split.** Raster B duplicates the *deflection and luminance-shaping* params (17 keys, `b`-prefixed to keep Settings keys flat/dot-free): `bHPos bVPos bHSize bVSize bZPush bZBias bIntensity bHCenter bVCenter bHSpin bVSpin bRotation bHLinearity bVLinearity bThreshold bContrast bGamma`. All are `ModTarget`s (grouped as "B: …" in Target dropdowns) with `PARAM_DOCS` entries.

Shared between rasters (staged scope, mirrors the hardware's shared scan): video source + mirror, `scanRate`/`cols`/`skip`, `aspect`, `focus`, `zInvert`, `rotate90`, H/V Reverse, color mode/tint, spectrum routing, post-FX. Independent scan rates or per-raster sources are explicitly follow-ups, not v1.

## Base/live split

Every `b*` key follows the standard pattern: UI writes base via `Settings`, engines contribute to `LiveValuesStore`, material-B uniforms subscribe to `live`. No new mechanisms.

## Migration (v22 → v23)

Adds `dualRasterEnabled: false`, `dualMode: 'wipe'`, `dualTracePos: 0`, and the 17 `b*` keys at raster-A defaults. Nothing is force-reset on load beyond the normal backfill — the flag is persisted user preference (visual-only feature, no safety surface). Rolling back to v22 code drops the unknown keys harmlessly.

## Verification that the singleton path is unaffected

- Flag off ⇒ `uDualMode === 0` on material A (shader early-identical), mesh B never constructed, zero extra draw calls.
- Full suite green; migration idempotence tested; `npm run build` clean.
- Visual QA when the owner flips the flag: `dualRasterEnabled` in the Dual Raster panel section.

## Follow-ups (explicitly out of v1)

- Independent per-raster scan rates (needs a second geometry + rebuild plumbing).
- Per-raster video sources (second VideoSourceManager + texture).
- Per-raster color modes (currently shared tint/color pipeline).
- Vertical or positionable-angle wipe (current wipe is horizontal rows, matching the dual-trace slider description).
