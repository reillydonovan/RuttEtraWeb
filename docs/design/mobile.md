# Mobile (compact) layout — Modern

Branch `mobile-modern`, 2026-10-15. Compact mode = `< 768px` wide, or touch under 1024px (`LayoutManager`).
Classic's compact look (`layout.css`) is untouched; **Modern** compact lives in `src/ui/layout/mobile-modern.css`
(scoped `html body[data-theme="modern"][data-layout="compact"]`, so it beats layout.css without `!important`).

## Shape

Full-bleed render; three floating layers: top strip (`TopStrip`), capture dock (`CaptureDock`), tab bar (`TabBar`).
A tab opens a `BottomSheet` of the real panel sections (re-parented from the desktop panel, as before).

- `CaptureDock.ts` is pure UI: every capability arrives through `CaptureDockDeps` from `main.ts` (recorder, source
  manager, presets) — it is a front end, never a second owner of anything. Photo = rAF-composited PNG → Web Share
  with files if `canShare`, else a download. Video = the existing `CanvasRecorder`; `subscribeSaved` hands the saved
  file to a toast with a Share action (sharing needs a fresh tap).
- `SourceQuick.ts` — front/back camera, library video, pattern — the same start paths as the boot screen (`startWebcam`,
  `startWithPattern`, the boot file input).
- Looks in the dock apply `presetPatch(values)` **minus `aspect`**, so a look never undoes the picture-fit aspect.
- In compact, `aspect` follows each new webcam/file source once (`main.ts`); desktop keeps the 4:3 default.

## Boundaries (what is desktop-only)

`LayoutGroups.ts` routes only: Video Source A · Display Control Unit · Virtual Camera · Modulation (Classic + Beginner
rows) · Audio · Color / Post FX · Geometry · Presets · Record · Share · Manual. NOT routed: Patch Bay, Timeline, node
graph Advanced editor, MIDI, OSC, CV, MCP, XR, Dual Raster, Video Source B, broadcast tools. They still exist and return
the moment the layout is not compact. To move something onto the phone, add its section title to a tab.

## Touch

Sliders use the existing compact scrub bar (div + pointer events — native ranges are unreliable inside the sheet's
scroll-snap on iOS); Modern restyles it as label + value over a 44px bar, no stop chips. Inputs are 16px (iOS never zooms
on focus); every target is ≥ 44px. Landscape (`max-height: 520px`): dock → right rail, looks carousel folds away.

## Not verified

Real iOS Safari / Android hardware (share sheet, front/back camera swap, MediaRecorder mime on iOS, pinch/orbit on the
canvas, safe-area insets); everything was exercised in desktop Chrome with iPhone emulation and a fake camera.
