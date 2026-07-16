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
- ~~Per-raster video sources (second `VideoSourceManager` + texture).~~ **Closed 2026-07-14** — see "Per-raster video sources (v1.20)" below.
- Per-raster color modes (currently shared tint/color pipeline).
- Vertical or positionable-angle wipe (current wipe is horizontal rows, matching the dual-trace slider description).

## Per-raster video sources (v1.20)

Closes the "Per-raster video sources" follow-up above — not by adding a raw source picker to the Dual Raster Controls-tab section, but through the Patch Bay's video-routing system (Settings v34, `src/renderer/VideoCompositor.ts`, `src/ui/patchbay/PatchBayView.ts`) that already existed for the Composite node (v1.18).

- **`uniformsB` was already independent, just always kept in sync.** `RuttEtraScene.attachVideo()`/`setExternalVideoTexture()` set `uniforms.uVideo` (raster A) AND `uniformsB.uVideo` (raster B) to the SAME texture every time — the two uniform sets were always separate objects on separate materials, nothing structurally forced them to match. A new `RuttEtraScene.setExternalVideoTextureB(tex, w, h)` touches ONLY `uniformsB`, called after the existing methods each frame so its override sticks (those still resync B to A first, by design — the pre-existing single-source default stays exactly as-is when Dual Raster isn't wired).
- **A DUAL RASTER node** in the Patch Bay: two video INs (A/B — order is literal here, not asymmetric like Composite's blend-order sensitivity) sourced from Video Source A/B or the Composite node's own output, one OUT that can only ever reach the RENDERER module's IN (a raster split isn't a blendable single image, so — like Composite's OUT — it can't feed anything else). New Settings: `videoDualRasterInA`/`InB` (`'sourceA' | 'sourceB' | 'composite' | 'none'`, default `sourceA`/`sourceB`), and `videoRendererIn` gained a fourth value, `'dualRaster'`.
- **Wiring the OUT to RENDERER IN wakes `dualRasterEnabled` automatically** (same "a patching gesture activates the mode" precedent the modulation graph engine already uses) — but never forces it back OFF on unwiring, since it's also a real, independently user-toggleable Controls-tab preference (the Dual Raster section's own checkbox).
- **Pattern Generator interaction is intentionally NOT unified** — Pattern Generator's own compositing always touches both `uniforms`/`uniformsB` (it has one singular "the video" concept), and the Dual Raster override runs AFTER it every frame, so when both are active the Dual Raster wiring wins for what's actually displayed. Attempting real per-raster Pattern Generator compositing is out of scope here, same as it always has been for Composite.

## Full Patch Bay controls + Source B device picker (v1.27, Settings v35)

Two owner follow-ups, closing real gaps: the DUAL RASTER Patch Bay module had ONLY its 2 video-IN + 1 OUT jacks — none of `dualRasterEnabled`/`dualMode`/`dualTracePos` or the 16 raster-B shaping params had a home there (they were silently falling into the general faceplate's AUXILIARY catch-all, since their `PARAM_DOCS` panel is `'DCU'` and neither `DCU_SUBGROUPS`' key-name matching nor `PANEL_FIELDS`' panel-category matching recognizes that). Fixed exactly like the Pattern Generator module's own equivalent gap: a `DUAL_RASTER_OWNED` exclusion set in `patchbayLayout.ts`, and the module now builds an enable LED/toggle, a `dualMode` dropdown, and full `addParamCell` (IN/knob/value/OUT) rows for all 18 params, grouped under new `.rw-pb-subhead` divider labels mirroring `DualRasterSection.ts`'s own 5 groups.

Separately: Source B (feeding either raster, or Composite) had NO Controls-tab presence at all — only the Patch Bay's own one-click default-webcam-only module. `SourceSection.ts`'s webcam/screen/file/stream picker was extracted into a reusable `buildVideoSourcePicker()` (parameterized by `VideoSourceManager` instance + `kindKey`/`deviceIdKey`) so a new `createSourceBSection` could reuse it verbatim for Source B, registered as its own "Video Source B" Controls-tab section. New Settings v35: `deviceIdB` (Source B's own remembered webcam device, independent of Source A's `deviceId`) and `sourceBKind` widened to include `'stream'`.

## Relocated to col2 (v1.27, same session)

Immediate owner follow-up: "since the dual raster is so large as a node bump it to the far right of the stack to the right of the colorizer towards the top." The full-controls pass above grew the module to ~20 rows, dominating what used to be a compact left `rail` stack (four Function Generators, Sources, Composite, Dual Raster, both Video Sources, Renderer, Graph Engine). Moved it to `col2` (the rightmost of the Patch Bay's three flex-row stacks — `rail`/`col1`/`col2`, confirmed via `deck.append(rail, col1, col2)`), inserted as `col2`'s FIRST child so it sits above COLORIZER / POST-FX (the first field `buildFaceplate()` populates col2 with).

Mechanically: the module's own `{ ... }` construction block still runs at its original point in the file (before `col1`/`col2` exist), so it stores the built element in an outer `let dualRasterMod: HTMLElement | null` instead of appending directly; right after `col2`'s declaration, `col2.appendChild(dualRasterMod)` places it before `buildFaceplate()`'s loop populates the rest of the column. No other code needed to change — `allUnits()`/`stacks()`/`freeze()`/`tidy()`/`stackUnder()` are all already container-agnostic (`surface.querySelectorAll('.rw-pb-module, ...')` and a plain `[rail, col1, col2]` array), so a `.rw-pb-module` living in `col2` instead of `rail` drags, reorders, and free-layout-breaks-out exactly like any other unit — nothing assumed Dual Raster specifically lived in `rail`.
- **A real per-frame perf bug caught before shipping**: an early version called `ruttEtra.attachVideo()` every frame whenever Dual Raster's A input resolved to `'none'` (an edge case — the default is never `'none'`) — `attachVideo()` disposes and recreates raster A's `THREE.VideoTexture` unconditionally, so this would have silently churned a new texture every frame for as long as that state persisted. Fixed by not calling it at all in that branch: a `THREE.VideoTexture` already auto-updates from the `<video>` element on its own, so the fallback needed no action beyond leaving whatever binding an earlier step in the same frame already established.
- Verified live (Playwright + fake webcam): DUAL RASTER module renders with both jacks; wiring Source A/B into it and its OUT into RENDERER IN correctly sets `videoRendererIn: 'dualRaster'` and `dualRasterEnabled: true` (confirmed via the MCP bridge's `get_settings`); unplugging RENDERER IN reverts `videoRendererIn` to `'sourceA'` while correctly leaving `dualRasterEnabled` untouched. Zero console errors.
