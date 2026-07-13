# Workspace window system — design system

Status: v1.12 (2026-07-13), the Unity tab model. The single reference
for how RuttEtraWeb's window system works and how to extend it.
CLAUDE.md and the preflight skill point here; keep all three in sync.

## Concepts

**Window** — a screen area holding an ordered list of TABS with one
active tab. Four windows, each decorating a DOM shell:

| Window  | Shell               | Geometry owner |
|---------|---------------------|----------------|
| center  | `#rw-center-shell`  | positioned by `main.ts resize()` to `availableCanvasRect()` |
| left    | `#rw-left-shell`    | `leftPanelWidth` (220–1400); HIDDEN while it has no tabs |
| right   | `#panel-root`       | `panelWidth` (220–1400) / `panelCollapsed`; `panelDock` forced `right` since v31 |
| bottom  | `#timeline-dock`    | `timelineDock` (top/bottom/hidden) / `timelineHeight` (100–900) |

**View** — content shown by a tab. Registry ids
(`workspaceModel.ViewId`): `renderer`, `panel` (Controls), `timeline`,
`patchbay`. **Multi-instance views** (`MULTI_INSTANCE` = renderer,
patchbay) register a FACTORY and may hold duplicate tabs in several
windows at once — each window gets its own cached instance
(`elementFor(view, win)`). Single-instance views (panel, timeline)
register one element and live in exactly one window; adding them
elsewhere MOVES them and the [+] menu says "(moves here)". Inactive/
unhosted elements park in the hidden `#rw-view-park`. A window never
shows the same view twice.

**The no-side-effects rule (the owner's bright line):** moving or
adding a view NEVER assigns anything new to another window. The source
window falls back to its own next tab; a window left with zero tabs
hides. There is no swap.

**The renderer is a view like any other**, with one twist: while it is
the CENTER's active tab it is a transparent pass-through and the ONE
real WebGL canvas renders beneath (a live GL canvas is never
re-parented). Active anywhere else, it shows a `captureStream` mirror.
Inactive, the mirror stops.

## The window bar (identical on all four)

```
[ tab ][ tab ][ tab ] [+] ............ [⤢] [–]
```

- **Tabs** — click to switch; DRAG to move onto another window's tab
  strip (highlighted while hovered) — the ONE drop-target kind. While a
  drag is live, empty (hidden) windows reveal themselves as labeled
  "DROP TAB HERE" strips so they stay reachable. The drag ghost names
  the view. Dropping into a stowed window un-stows it (hidden dock
  restores to its last edge; a collapsed right panel expands).
- **[+]** — add a view: multi-instance views get a DUPLICATE tab (no
  other window affected); single-instance views move (labeled).
- **✕ per tab** — closes that window's tab (a fully-closed view reopens
  via any [+]). Tabs drag-reorder within their strip; a thin
  **insertion caret** (`.rw-wtab-caret`, DOM-present only during a
  drag) marks the landing slot. During a drag the EMPTY window nearest
  the pointer reveals itself as a labeled drop strip (proximity, one at
  a time — `.rw-drop-reveal`).
- **⤢ maximize** (left/right/bottom) — transient near-fullscreen
  overlay (`data-region-max`; `availableCanvasRect()` skips such
  shells). Double-click the bar does the same. Never persisted.
- **– collapse** (right/bottom) — the shells' existing strips restore.
- Compact/touch and viewer mode hide all bars; the workspace
  force-hosts the CLASSIC arrangement transiently (no Settings
  writes). The panel popout wins over tabs while open.

## State (Settings v31)

- `workspaceTabs: Record<WindowId, ViewId[]>` and
  `workspaceActive: Record<WindowId, ViewId | null>` — project-portable.
- `normalizeTabsState` is the validator: unknown ids drop, duplicate
  homes keep the first, the renderer always exists somewhere, actives
  must be members. Tabs degrade gracefully (no whole-state reset).
- Presets (`LAYOUT_PRESETS`, the Unity family): `default` (4-up: bay
  left, renderer center, controls right, timeline bottom), `classic`,
  `tall`, `wide`, `performance`, `patchbay`. `Reset Layout` = default.
- Maximize state is transient (never persisted). The renderer may hold
  duplicate tabs: pass-through only as the CENTER's active tab, mirror
  instances everywhere else (per-window captureStream, stopped when
  inactive).

## Shell/content contract (the rule that keeps this working)

Shell chrome — resize handles, collapse strip, dock mini-bar, window
bar — lives on the SHELL. Movable content lives in the view wrapper
(`ControlPanel.viewRoot`, `TimelineDock.viewRoot`, the patch bay root,
the renderer wrapper). New panel-level chrome must pick its side of
that line deliberately, or it will vanish (or tag along) when the user
re-docks tabs. Inset CSS vars: the right shell owns
`--rw-panel-inset-right` (ControlPanel.publishInset), the LEFT shell
owns `--rw-panel-inset-left` (Workspace.publishLeftInset) — never write
the other side's var.

## Adding a new view

1. Build a self-contained root element (own CSS scope; must lay out in
   a narrow column, a short strip, and the full center).
2. Add its id to `workspaceModel.ViewId` + `VALID_VIEWS`, a label in
   `Workspace.VIEW_LABELS`.
3. Register it: `workspace.registerView(id, el)` (late/lazy is fine —
   the patch bay is the model).
4. Extend `LAYOUT_PRESETS` if it belongs in presets, and the
   `workspaceTabs`/`workspaceActive` Settings unions + a migration
   (same version-bump rules as any Settings change).
5. Docs: this file, README, About quick-start, in-app Help.

## CSS classes (workspace.css)

`.rw-region-bar` / `.rw-tabstrip` / `.rw-tab(.active)` / `.rw-tab-add`
/ `.rw-region-btn` — bar anatomy. `.rw-window-empty` — zero-tab hide.
`.rw-region-max` + `[data-region-max]` — maximize overlay.
`.rw-drag-ghost`, `.rw-strip-hover`, the `body.rw-region-dragging`
empty-window reveal — drag feedback. `.rw-view-renderer(--passthrough)`,
`#rw-center-shell(.rw-center-passthrough)`, `#rw-left-shell`,
`.rw-left-resize`. All colors from the `--re-*` tokens.
