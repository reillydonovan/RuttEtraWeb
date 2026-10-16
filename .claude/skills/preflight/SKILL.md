---
name: preflight
description: Run RuttEtraWeb's full pre-commit verification pipeline (typecheck, tests, build, about-bundle guard) and check the repo's structural invariants. Use before committing any non-trivial change, or when asked to "verify", "preflight", or "check everything".
---

# Preflight — RuttEtraWeb verification pipeline

Run these in order; stop and report on the first failure:

1. `npm run typecheck` — `tsc --noEmit`, catches type drift fast.
2. `npm test` — vitest, node env. Expect ALL suites green (540+ tests).
3. `npm run build` — full production build (typecheck + vite, multi-page).
4. `node scripts/check-about-bundle.cjs` — MUST pass after every build:
   asserts the about page ships zero synth runtime (no three.js, Web
   Audio, MediaRecorder, PeerJS).

## Invariant checklist (verify for the diff being committed)

- **A `replace_all` edit can clobber the very helper it's converting call
  sites to use.** When introducing a wrapper (e.g. `startDrag(p) { pending
  = p; ...extra... }`) to replace a dozen scattered `pending = p;` call
  sites, a `replace_all` for the string `pending = p;` also matches that
  exact text INSIDE the new helper's own body if it's phrased the same
  way — turning `pending = p;` inside `startDrag` into `startDrag(p);`
  and making it call itself. Found live 2026-07-15 building Patch Bay
  cable-selection state: infinite recursion (`RangeError: Maximum call
  stack size exceeded`) the instant any drag started, invisible to
  `tsc`/tests since JS doesn't flag self-recursive assignments. After
  any multi-site `replace_all` that introduces a new function whose body
  contains the literal old pattern, re-read that function's body
  specifically (not just spot-check a few call sites) before trusting
  the change.

- **Settings schema**: any change to saved-format shape bumps `_v`
  (`CURRENT_VERSION` in `src/state/Settings.ts` — 35 as of v1.27.0) and
  adds an idempotent `migrateSettings()` step. Migration tests assert
  `_v >= N`, never `=== N`.
- **`VideoSourceManager` has NO Settings connection of its own** — it's
  a plain instance (`video` element + internal state only). Every call
  site that switches a source (`useWebcam`/`useScreen`/`useFile`) is
  responsible for ALSO recording the choice in Settings
  (`sourceKind`/`sourceBKind`) itself, AFTER awaiting success (a
  denied/cancelled permission must not leave Settings claiming a live
  source that isn't real). The Patch Bay's VIDEO SOURCE module missed
  this for years before the Video Composite feature (v1.18.0) exposed
  it — its buttons switched the feed but the LCD/Settings/`sourceKind`
  disagreed with reality. If you add a new call site that switches a
  video source, check it records the kind; if you need to know whether
  a source is REALLY active, prefer `video.readyState >= 2` over
  trusting the `sourceKind` label (same reasoning, defense in depth).
- **`RuttEtraScene.attachVideo()` (and `setExternalVideoTexture()`)
  unconditionally dispose and recreate the video texture — never call
  either from a per-frame branch that can stay "active" for more than
  one frame**, only from a genuine one-time transition (a `settings.
  subscribe` firing, a real state change detected this frame). A
  `THREE.VideoTexture` already auto-updates from its `<video>` element
  on its own; it never needs re-creating just to "stay current." Found
  live 2026-07-14 building the Dual Raster node's per-frame routing
  resolution: an unwired input's fallback branch called `attachVideo()`
  every frame it persisted, which would have churned a new texture
  every frame — fixed by doing nothing in that branch and trusting
  whatever an earlier step in the same frame had already bound.
- **Timeline schema**: same rule via `Timeline._v` (`src/sequencer/types.ts`)
  and the store's normalize path.
- **Never use the `hidden` attribute/property to hide a mounted VIEW
  (a whole `ControlPanel`/`TimelineDock`/Patch Bay instance, or
  anything else with its own opinionated CSS)** — `hidden` only takes
  effect through the UA stylesheet's `[hidden] { display: none }`
  rule, which is the LOWEST-priority cascade origin; any ordinary
  author-stylesheet class rule that sets `display` on the same element
  wins and the "hidden" content keeps rendering underneath whatever's
  actually visible (found live 2026-07-14: closing a popup's Timeline
  tab revealed its transport bar had been painting the whole time,
  squeezing the Patch Bay tab's height). Use inline `style.display =
  'none'` / `''` instead — an inline style always outranks a class
  rule. Plain leaf DOM (a single label, a jack span) is fine with
  `hidden`; anything with its own CSS module is not.
- **Don't detach-and-reappend a mounted view on every UI update** —
  `ViewPopout.ts`'s popup tab switcher originally did
  `content.innerHTML = ''` + re-append on every tab click; for the
  Patch Bay this silently broke its cable canvas after a switch-away-
  and-back (DOM intact, sizes read correctly, nothing painted — a
  re-parent mid-session doesn't reliably re-trigger whatever
  ResizeObserver/rAF setup originally sized it). Append each live
  view's root element to its container ONCE; every later "show/hide"
  update should only toggle a property (see the `hidden`-vs-`style.
  display` note above), never rebuild the DOM around it.
- **Patch Bay jack registries are shared `Map<string, HTMLElement>`s
  keyed by plain Settings-key string** (`paramJacks`, `paramOutJacks`,
  etc. in `PatchBayView.ts`). Calling `addParamCell` for the SAME key
  from two different call sites doesn't error — it silently steals the
  jack registration for whichever call ran last, so the OTHER call's
  jack is visibly present and looks identical but is permanently
  unwireable (drags never snap to it; nothing shows as an error). A
  real bug found 2026-07-14: the general faceplate's AUXILIARY
  catch-all still listed every `patternXxx` TARGETS key (leftover from
  before the Pattern Generator module grew its own dedicated jacks),
  so dragging a cable onto the Pattern Generator's visible Brightness
  jack silently failed — the faceplate's later-built copy owned the
  map entry. Before giving a param a SECOND jack anywhere, grep for
  existing `addParamCell(...)`/`paramJacks.set(...)` call sites for
  that key; if one already exists, exclude the key from the new
  location entirely rather than building a competing jack.
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
- **Bay gestures that create/edit graph connections must call
  `ensureGraphLive()`** (PatchBayView.ts): `GraphEngine.tick()` no-ops
  entirely while `modMode` is `'classic'`, so a wire/binding made in
  classic mode is silently dead — every node output reads 0 (the
  "Scope draws a flat line" owner bug, v1.17.0). Any NEW gesture or
  remote surface that writes graph connections needs the same guard
  (MCP's set_graph_patch/add_graph_node already apply it).
- **MCP remote control** (`src/io/McpRemote.ts` + `tools/mcp-server/`):
  the command surface deliberately rides the app's own registries
  (TARGETS, action registry via `listActions()`, node registry) — when
  adding remote capabilities, extend those registries rather than
  hand-adding MCP-only commands, or the surface forks. The browser
  connects OUT to the bridge; keep it opt-in (I/O → MCP), and never
  let a remote write path reach the audio/CV arming flags.
- **Editing `modGraph` from a new surface needs TWO writes, not one**:
  `settings.set('modGraph', next)` persists the patch, but
  `GraphEngine` "never mutates the graph itself — `setPatch()` is the
  only way to change topology" (its own doc comment) — it does NOT
  subscribe to `Settings` and pick up the change on its own. Every
  graph-editing surface (Beginner/Advanced view, `ModulationContainerSection`,
  the Patch Bay's draggable graph cables added 2026-07-14) writes
  `settings.set('modGraph', next)` **and** awaits
  `getEngine().then((e) => e.setPatch(next))` in the same edit. Miss
  the second call and the edit LOOKS like it worked (Settings/UI update)
  but is silently inert live — the same shape of bug as the base/live
  `TARGETS` gotcha above, one layer down the stack. Relatedly:
  `AutoSave`'s project-recovery path writes `Settings` directly and does
  NOT prime the graph node registry the way `loadSamplePatch()` does
  (`await ensureGraphEngine()` before writing `modGraph`) — a project
  restored via the recovery prompt can render graph node labels as raw
  lowercase type strings that never self-correct. Known gap, not yet
  fixed (found 2026-07-14 while verifying node-to-node wiring); if you
  touch project restore, this is the place to fix it.
- **`NodeDeps.paramLive` is the ONE sanctioned window from graph nodes
  into `LiveValuesStore`, and it is read-only by contract.** GraphEngine
  wires it to `liveValues.getLive` for the `param-out` node (the Patch
  Bay's per-param OUT jacks). Never extend it into a write path, and
  never hand nodes the store itself — the constructor deliberately
  strips `liveValues` out of NodeDeps. Reads see the previous frame's
  contributions (bindings apply after nodes tick), so param→param
  patches are one-frame-delayed by design — document that in any node
  that reads it, don't "fix" it.
- **A graph node's `type` can change in place, same id** — Beginner
  view's source dropdown (`BeginnerView.ts`, `adapter.source.set`)
  mutates an EXISTING node's `type` rather than creating a new node
  (e.g. retargeting a row from LFO to Noise keeps the same `nodeId`).
  Any Patch Bay/rack UI that derives per-node structure from
  `getDef(node.type)` — jack rows, labels, port lists — must reconcile
  that structure on EVERY rebuild, not just "when the module is first
  created." A real bug shipped this way once: IN-jack rows were built
  once at module-creation time on the (false) assumption that a node's
  input ports never change post-creation; retargeting LFO -> Noise via
  Beginner view left the module stuck with zero IN rows forever, since
  nothing revisited it after creation. Caught live, not by typecheck or
  unit tests — the fix mirrors the OUT-row reconciliation pattern
  (`PatchBayView.ts`'s `rebuildGraphModules`): diff current vs. wanted
  every call, keyed off the node's CURRENT `def`.
- **Audio/CV/MIDI-out safety**: outward-facing outputs (sonification, CV
  out channels, MIDI clock out) are structurally forced OFF on every
  load in `migrateSettings()` — never weaken this.
- **New tests in a new directory**: add its glob to the `include`
  allowlist in `vitest.config.ts` or the tests silently won't run.
- **Docs land with the feature**: new modulatable Settings key → entry in
  `src/ui/help/paramDocs.ts`; new graph node → complete `NodeDef` in the
  registry; user-facing behavior change → `src/ui/help/content.ts` +
  the relevant `docs/about/*.md`.
- **Pure pattern data belongs in `PatternRegistry.ts`, not a Controls-tab
  section file.** Enum option lists, label-prettifiers, range tables for
  `pattern*` Settings keys — put them in `PatternRegistry.ts` (already
  the "no three.js, no DOM" pure-data home for pattern info, explicitly
  designed to be importable from the about-page's Pattern Catalog
  without dragging in renderer runtime) even if the only current
  consumer is `SourceSection.ts`. A second UI surface (the Patch Bay's
  own Pattern Generator module, v1.19.0) needing the SAME option lists
  is exactly why this matters — importing them out of a Controls-only
  section file would've pulled that file's webcam/HLS/UI code into the
  Patch Bay's lazy chunk for no reason.
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
  fix belongs in a global rule, not another call site. `.rw-select`
  itself was a case of this discovered late (2026-07-16): it had a
  `background`/`border`/`color`/`cursor` rule for years but never
  `appearance: none`, so Chromium kept drawing its OWN native
  dropdown-arrow sub-widget on the right edge of every select in the
  app — unstyled AND showing the OS default cursor regardless of the
  `cursor` rule already set on the element, because that native arrow
  is a distinct rendering surface `appearance: auto` keeps around. Found
  from an owner screenshot (a correctly CRT-styled value box with a grey
  system chevron glued to it) — fixed with `appearance: none` +
  a hand-drawn SVG chevron (`background-image`, kept as separate
  longhand properties, not the `background` shorthand, so per-skin
  `.rw-select` overrides that only touch fill color don't blank the
  chevron back out again). If you add a NEW skin-specific or scoped
  `.rw-select` background override, use `background-color`, not
  `background`, or you'll silently reintroduce this. The very next
  report from the same screenshot turned out to be a DIFFERENT native
  control with the same disease: `<input type="number">`'s spin-button
  arrows were never suppressed anywhere (no `::-webkit-inner/outer-
  spin-button` or `-moz-appearance: textfield` rule existed), most
  visible on the Patch Bay's wide `.rw-pb-cell-value` field. Fixed the
  same way (global unscoped rule in `panel.css`), but REMOVED rather
  than reskinned — this app's number fields already have a real
  adjust-without-typing affordance elsewhere (a paired knob/slider, or
  `attachNumberDragScrub`), so there was no affordance to replace.
  Lesson for next time a "confirmed served" fix still doesn't look
  right to the reporter: ask where the control lives and what it DOES,
  don't re-theorize from the same screenshot again — one line of owner
  context ("Patch Bay," "adjusts a float value up or down") ruled out
  the wrong theory immediately. That "no affordance to replace" call
  was itself corrected one message later — the owner wanted the
  up/down click behavior back, just reskinned, not removed. Since the
  native glyphs can't be repainted (only resized/hidden), the real fix
  is `attachNumberStepper()` (`widgets.ts`): a custom two-button column
  that reads `min`/`max`/`step` off the input's own attributes and
  dispatches real `input`/`change` events, so it's a drop-in visual
  replacement wherever a project-specific control still needs the
  click-to-nudge affordance, not a value-path fork.

## Modern theme + window chrome invariants (v1.33)

- **Modern is the default theme** (`theme.ts`, no stored value = modern;
  the About/Tutorials/splash inline scripts agree). Theme tests assert it.
  Classic (`phosphor`) must still render unchanged — check both.
- **`theme-modern.css`**: add a new component to the BEHAVIOUR's selector
  list, don't restyle it inline; add pointer-glow surfaces to
  `GLOW_SELECTOR` (`themeGlow.ts`) too. In an `:is()` list wrap element
  parts in `:where()` (an `:is()` takes its strongest entry's
  specificity). Never use the `background` shorthand on a CARD, FLOAT,
  `.rw-select` or stepper (glow + chevrons are background-image). No
  `backdrop-filter` on menus (fixed-position submenus). A rule that sets
  `display` must not un-hide collapsed sections or `[hidden]`.
- **Tokens, not values**: spacing `--sp-*`, type `--fs-*`, heights
  `--ctl-*`, radii `--r-*`, select chevrons `--sel-*`. Hovers are green
  tints (`--a-08/16`), never grey.
- **Section titles are lookup keys** (`h.section()` in the tutorial tours,
  `tutorialSteps.reveal`, `LayoutGroups`, `SECTION_HINTS`, `getSection`).
  Renaming one (e.g. "Source" → "Video Source A") means grepping and
  renaming every key and doc reference in the same change.
- **Window chrome is one system** for all four windows (same ⧉ ⤢ –
  buttons, one collapse model, one resize grip, one tab style); don't add
  a per-window special case. New collapse state = Settings key +
  migration (v36 added `leftCollapsed`/`centerCollapsed`).
- **Scrolling surfaces** use the shared edge rails
  (`attachEdgeScrollbars`); a cable canvas over a scroller must live
  INSIDE it (RackLayer `cableHost()`), sized from content that excludes
  the canvas — never from `scrollHeight` (fitCableCanvas feedback rule).
- **No self-modulation**: any new path that creates or re-targets a graph
  binding goes through `isSelfModulation()` (rackGeometry).
- **Headless screenshots**: launch with `reducedMotion: 'reduce'` — under
  SwiftShader transitions stall and screenshots show half-transitioned
  states; headless also hides scrollbars (`--hide-scrollbars`).

## Hierarchy, motion and Patch Bay invariants (v1.34)

- **Disclosure is one control**: section and group carets sit LEFT of the
  title, rotate via `--chev` / `--caret` (no `transform` transition), and
  have rest / hover (green wash) / pressed / focus states. A new collapsible
  thing uses `animateToggle()` (`src/ui/motion.ts`), never a CSS height
  transition, and passes both `mutate` and `undo`.
- **A section title is its head's first `<span>`**: don't insert another
  `<span>` before it (the caret is an `<i>` for this reason).
- **Collapsed groups hide controls**: code that points at a control
  (search, tutorial, tours, info-media capture) must call
  `expandGroupsAround(el)` first, or force groups open.
- **Rebuilt rows need fresh jacks**: RackLayer keys jacks by param; check
  `isConnected`, not just `has()`, before skipping one.
- **Patch Bay free layout keeps pixel sizes**: never rescale node widths or
  positions with the window. Drops resolve with `placeNearestFree`, then a
  spring back; never "park below the lowest node".
- **Collapsed Patch Bay nodes** draw sockets as proxies; anything that
  measures a jack falls back to `proxyOf.get(jack)` when the jack's rect is
  zero (cable anchors, snap search).


## Workspace drop invariants (v1.34)

- **Screen side ≠ window id.** With the default `panelDock: 'left'` the
  'right' window (Controls) is on the LEFT. Anything that maps a pointer
  position to a window (drop zones, edge reveals, insets) goes through
  `mirrored()` — test drags with BOTH the default and the Classic preset.
- **Only `#panel-root` publishes `--rw-panel-inset-*`**; a Controls view
  hosted in another window is an extra instance and must not.
- **Refresh recovery is unconditional**: `beforeunload` snapshots when
  dirty; don't re-gate it on the Auto-save toggle (owner decision).

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
