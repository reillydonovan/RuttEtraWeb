---
name: preflight
description: Run RuttEtraWeb's full pre-commit verification pipeline (typecheck, tests, build, about-bundle guard) and check the repo's structural invariants. Use before committing any non-trivial change, or when asked to "verify", "preflight", or "check everything".
---

# Preflight — RuttEtraWeb verification pipeline

Run these in order; stop and report on the first failure:

1. `npm run typecheck` — `tsc --noEmit`, catches type drift fast.
2. `npm test` — vitest, node env. Expect ALL suites green (441+ tests).
3. `npm run build` — full production build (typecheck + vite, multi-page).
4. `node scripts/check-about-bundle.cjs` — MUST pass after every build:
   asserts the about page ships zero synth runtime (no three.js, Web
   Audio, MediaRecorder, PeerJS).

## Invariant checklist (verify for the diff being committed)

- **Settings schema**: any change to saved-format shape bumps `_v`
  (`CURRENT_VERSION` in `src/state/Settings.ts`) and adds an idempotent
  `migrateSettings()` step. Migration tests assert `_v >= N`, never
  `=== N`.
- **Timeline schema**: same rule via `Timeline._v` (`src/sequencer/types.ts`)
  and the store's normalize path.
- **Base/live split**: no modulation/automation code path may call
  `settings.set(key, liveValue)` — engines write ONLY through
  `LiveValuesStore.setContributions()`.
- **New modulation/keyframe target**: adding a key to `ModTarget`
  (`src/state/Settings.ts`) + `TARGETS` (`src/ui/targets.ts`) makes the
  panel show a keyframe diamond and offer the param in MIDI/OSC/Graph
  target pickers — but that's just a lookup-table entry. It does
  **nothing** unless the param's actual consumer reads the LIVE value
  (`live.subscribe(key, ...)` / `live.getLive(key)`), not
  `settings.get`/`settings.subscribe`. A real bug found 2026-07-11:
  `audioGain`/`audioFloor`/`beatSensitivity` had been in `TARGETS` for a
  while but `IoSubsystems.ts` only ever read their base value once at
  boot — keyframing/modulating them silently did nothing. Grep the
  param's read site before adding it to `TARGETS`; if it's a
  `settings.get` one-shot or a `settings.subscribe`, convert it. Also
  deliberately EXCLUDE any target whose consumer does something
  expensive on every write (mesh rebuild, GPU resolution resize) —
  continuous modulation would hammer that operation every frame.
- **Audio/CV/MIDI-out safety**: outward-facing outputs (sonification, CV
  out channels, MIDI clock out) are structurally forced OFF on every
  load in `migrateSettings()` — never weaken this.
- **New tests in a new directory**: add its glob to the `include`
  allowlist in `vitest.config.ts` or the tests silently won't run.
- **Docs land with the feature**: new modulatable Settings key → entry in
  `src/ui/help/paramDocs.ts`; new graph node → complete `NodeDef` in the
  registry; user-facing behavior change → `src/ui/help/content.ts` +
  the relevant `docs/about/*.md`.
- **No service worker**: never reintroduce one; `public/sw.js` is a
  kill-switch for old installs.
- **Multi-surface commands go through the action registry**
  (`src/ui/actions.ts`): a command reachable from 2+ surfaces (keyboard
  shortcut, menu bar item, panel button) must be ONE registered action
  dispatched by id from each surface — never a second copy of the
  handler. The Ctrl+S / File▸Save pair is the reference.
- **Skin invariants** (PRINCIPLES.md principle 2 additions): a skin is
  a face inside the existing widgets, never a parallel widget tree or a
  second setter path; skin code reads LiveValuesStore display-only;
  skin state is localStorage (`src/ui/skin.ts`), never Settings. Rack
  cables write patch data (`modSlots[i].target`) via `applyCableTarget`
  — also never live values.
- **Workspace window system — read `docs/design/workspace-regions.md`
  before touching regions/views.** Core contract: shell chrome (resize
  handles, collapse strip, dock mini-bar, region bar) lives on the
  SHELL (#rw-center-shell / #rw-left-shell / #panel-root / #timeline-dock); movable
  content lives in the view wrappers (`ControlPanel.viewRoot`,
  `TimelineDock.viewRoot`, patch bay root, renderer wrapper), which the
  region system re-parents. New panel-level chrome must pick its side
  of that line deliberately, or it will vanish (or tag along) when the
  user re-docks windows. Tab-state keys (`workspaceTabs`/`workspaceActive`, v31) are
  normalized by `normalizeTabsState`; the no-side-effects rule (moving
  a view never assigns anything to another window) is enforced by the
  pure `moveView()` — follow the add-a-view checklist in the design
  doc for any new ViewId; EVERY view registers a FACTORY with
  registerView (per-window live instances — duplicates sync via the
  shared stores). Sequencer `onX` props are additive multicast
  accessors: assigning subscribes, never replaces — do not 'reset' a
  callback by reassigning it. Never
  re-parent the live WebGL canvas; renderer-outside-center is a
  captureStream mirror.
- **Menubar offset**: anything new pinned to the top of the viewport
  must offset by `var(--rw-menubar-h, 0px)` (0 in compact/viewer), and
  anything changing available canvas space must be measurable by
  `availableCanvasRect()` via a live rect.
- **Hover help is `attachTooltip` (`src/ui/tooltip.ts`), not native
  `title`**: a delayed (550ms), CRT-styled popover, popout-safe, and
  accepts a lazy `() => string` for state-dependent text (e.g. a
  PLAY/PAUSE button's label). Convert any new `el.title = '...'` to
  `attachTooltip(el, '...')` — a native title on one control next to
  styled tooltips on its siblings reads as broken, not just
  inconsistent. Applies to the timeline dock as much as the panel: it
  had zero styled tooltips until 2026-07-11 despite the panel getting a
  full hover-tooltip pass earlier the same session.
- **CSS `zoom` on a workspace window shell breaks alignment — scope it
  to the shell's CHILDREN.** `--rw-panel-inset-left`/`-right` (and
  similar) are real screen-pixel values published by JS from OTHER
  elements' post-zoom rects. Applying `zoom` directly to an
  absolutely-positioned shell that reads one of these as its own
  `left`/`right`/`width` re-scales that already-resolved pixel value a
  SECOND time for that one element, desyncing its edges from its
  neighbors (confirmed 2026-07-13 building the Text Size feature:
  windows drifted apart/overlapped at any non-1 scale). The fix is
  `.rw-zoomchrome > * { zoom: var(--rw-text-scale, 1); }` (children
  only, `panel.css`) — never `.rw-zoomchrome { zoom: ...; }` on the
  shell itself. The same reasoning applies to any other absolutely/
  fixed-positioned sibling whose geometry comes from a published CSS
  var: zoom its content, not its own box.
- **Global CSS safety nets over per-callsite fixes**: `panel.css` has
  three deliberately unscoped rules — `input[type="range"]`,
  `*::-webkit-scrollbar`, `input[type="file"]::file-selector-button` —
  added after the SAME styling bug (native OS control instead of the
  CRT theme) recurred at multiple unrelated call sites because a
  hand-built `<input>` didn't carry the right class. If you fix a
  styling bug for the second time on the same element type, the third
  fix belongs in a global rule, not another call site.

## Deploy warning

Pushing to `main` triggers the production FTP deploy
(`.github/workflows/deploy.yml`). Feature work goes on a branch; merge
to `main` only when the user explicitly wants to ship. The deployed
page identifies itself via the build stamp (`v<version> · <commit> ·
<date>`) on the boot overlay and panel title bar.

## Notes

- `src/ui/panel.css` is plain UTF-8 (fixed 2026-07-10 — it previously
  contained stray NUL bytes that made content greps treat it as binary).
  If greps ever report it as binary again, check for reintroduced NULs.
- GPU-side changes (shaders, postfx, dual raster, XR) have NO automated
  coverage — the suite deliberately excludes WebGL. Flag them for
  manual visual QA in the commit message or summary.
