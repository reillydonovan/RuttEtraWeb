# Panel design system

The control panel (`src/ui/panel.css`, `src/ui/widgets.ts`) is vanilla DOM,
no component framework, styled with plain CSS classes against a small set
of CRT/phosphor tokens. This doc exists because a real bug shipped from
not having it written down: a slider dropped into an ad-hoc `flex` row
(Pattern Generator's per-param "+ patch" button) silently stopped filling
the row width, because CSS Grid and Flexbox size children differently by
default and nobody had a rule making that a non-issue. Read this before
adding a new widget or a new row shape.

## Tokens (`:root` in `panel.css`)

CRT phosphor palette — reused verbatim in `src/about/about.css` so the
About page matches without importing the synth's CSS bundle:

| Token | Role |
|---|---|
| `--re-bg`, `--re-bg-2`, `--re-panel` | Background layers, darkest to panel surface |
| `--re-line`, `--re-line-hi` | Hairline borders, dim / bright |
| `--re-text`, `--re-text-dim` | Prose, secondary/muted prose |
| `--re-accent` | Phosphor green — active state, headings, links |
| `--re-accent-2` | Amber — the ONE reserved meaning: "the timeline/automation owns this value right now" (live-value badges, keyed-slider tint, playhead). Don't reach for it as a second decorative accent. |
| `--re-glow` | The `text-shadow`/`box-shadow` recipe for "this is lit up" |
| `--re-mono` | VT323 / Share Tech Mono stack |

## The row contract

`row(label, control, hint?)` (`widgets.ts`) is the ONLY way a labeled
control should be placed in the panel. It wraps `label` + `control`
(+ optional `hint` text) in a `.rw-row`, which is `display: grid;
grid-template-columns: 110px 1fr;`. CSS Grid auto-stretches a lone
grid-item child to fill its column — this is *why* a normal slider,
dropdown, or toggle just works with no extra CSS.

**Rule: `row()` takes exactly one control element.** If a row needs more
than one interactive piece — a slider plus a readout, two paired
dropdowns, a slider plus a "+" button — wrap them together first (see
below) and pass the WRAPPER as the single `control`. Never call
`document.createElement('div'); div.className = 'rw-row';` by hand and
`append()` three+ children into it — grid auto-placement will wrap the
3rd+ child onto an invisible second row instead of erroring, so the bug
doesn't show up until someone actually looks at that control (exactly
what happened in `SonificationSection.ts` before this doc existed).

## `.rw-inline-group`: multiple pieces, one row

When a row's control is itself more than one element, wrap them in a
`<div class="rw-inline-group">` and pass that to `row()`:

```ts
const group = document.createElement('div');
group.className = 'rw-inline-group';
group.append(rangeInput, readoutSpan);
body.appendChild(row('Master Volume', group));
```

`.rw-inline-group` is `display: flex`. Unlike CSS Grid, **Flexbox does
NOT auto-stretch children along the main axis** — a flex child's default
width is shrink-to-content. Two rules make this work anyway:

- `.rw-inline-group > *:first-child { flex: 1 1 auto; min-width: 0; }` —
  the primary control claims the row.
- `.rw-slider` and `.rw-select` carry their own `width: 100%` (below),
  which — combined with the flex rule above — is what actually makes
  them fill the available space and *shrink correctly* when a sibling
  (a "+" button, a readout) needs room too.
- `.rw-inline-group > select:not(:first-child) { flex: 0 0 auto; width:
  auto; }` — a SECOND dropdown in the same group (e.g. the high end of a
  paired range picker) stays compact instead of also claiming 100% and
  fighting the first one for space.

If you add a THIRD kind of companion element (not a button, not a
second select), check whether it needs its own override here before
shipping — don't assume "it'll just work," that assumption is exactly
what broke last time.

## Widget-level width rules (must hold regardless of parent layout)

Every widget that's meant to fill its row carries `width: 100%` directly
on itself, not just relying on the parent grid/flex to stretch it. This
is deliberate redundancy — it's what makes a widget safe to drop into
*either* a grid row (`.rw-row`) or a flex row (`.rw-inline-group`)
without a new bug:

- `.rw-slider` — `width: 100%; min-width: 0;`
- `.rw-select` (dropdown) — `width: 100%;`
- `.rw-text` (text input) — `width: 100%;`
- `.rw-color` — **intentionally fixed** (`40x22px` swatch). Don't add
  `width: 100%` here; a color swatch stretching edge-to-edge looks
  broken, not responsive.
- `.rw-toggle` — intentionally compact (a switch, not a bar). Same
  reasoning as `.rw-color`.

**When adding a new widget function**, ask: should this fill its row?
If yes, give it `width: 100%` directly on the element `row()` will
receive — don't rely on being called only from a grid context, because
sections do wrap widgets in ad-hoc flex containers (Pattern Generator's
per-param patch button, Sonification's paired dropdowns) and will
probably keep doing so.

## Global safety nets: `input[type="range"]` and scrollbars

Two rules in `panel.css` are deliberately **unscoped** (no `.rw-*` class
required) rather than layered on top of `.rw-slider`, because the
scoped-only version already broke twice: Video Audio's Volume slider and
CV Output's "Scaling trim" slider were both hand-built with a bare
`<input type="range">` and no `.rw-slider` class, so they rendered as
the OS's native control instead of the CRT theme. Same failure shape
across two unrelated sections is a sign the fix belongs at the element
level, not the call site:

- `input[type="range"] { appearance: none; ... }` — every range input in
  the document gets the phosphor track/thumb treatment whether or not
  its author remembered `.rw-slider`. The scoped `.rw-slider input[...]`
  rule still exists and still wins on specificity where it applies; the
  unscoped rule is the floor under it.
- `*::-webkit-scrollbar` / `scrollbar-color` — likewise unscoped, so
  every scroll container (panel body, timeline inspector, graph editor,
  About sidebar) gets a thin green-on-transparent scrollbar instead of
  the OS's chunky arrowed track. `.rw-panel-body` previously had its own
  local copy of this rule; it's now redundant but harmless.
- `input[type="file"]::file-selector-button` /
  `::-webkit-file-upload-button` — a file input's own `className` (even
  `.rw-text`) only styles the input's box; the "Choose File" picker
  button lives in a separate pseudo-element the parent class can't
  reach, so every file input (Source's Video File, Audio's Audio file,
  Presets' Import/Restore) rendered the OS's native grey button until
  this was added.

**When you hand-build a raw `<input type="range">` or a new scrolling
container, you get the themed look for free — but still add the
`.rw-slider` class (and run it through `row()`/`.rw-inline-group`) for
the width/spacing contract above.** The global rule only guarantees
paint, not layout.

## Section headers and the accordion

`ControlPanel.addSection({ title, body, tab, initiallyOpen? })` renders
a `.rw-section` accordion item. `SECTION_HINTS` (`src/ui/help/
sectionHints.ts`) is a flat `title -> one-line description` map — add an
entry there for any new section so its header gets a hover tooltip for
free (see below). No entry = no tooltip, nothing breaks.

## Hover tooltips (`src/ui/tooltip.ts`)

`attachTooltip(el, text)` shows a small CRT-styled popover above `el`
after a 550ms hover pause (mouse only — touch has no hover state) and
hides it the instant the pointer leaves or a drag/click starts. Two call
sites wire it automatically, no per-widget opt-in needed:

- **Param rows**: `row()` reads `control.dataset.paramKey` (set by
  `slider()`/`toggle()`/`dropdown()`/`colorInput()` via the internal
  `markParamKey()` helper) and looks it up in `PARAM_DOCS` — the same
  map that drives the in-app Help Controls tab and the About page's
  Param Reference. **Adding a param to `PARAM_DOCS` is what gives it a
  tooltip** — there is no separate tooltip-content authoring step.
- **Section headers**: `ControlPanel.addSection()` looks up `section.
  title` in `SECTION_HINTS`.

If you hand-build a control that bypasses `slider()`/`toggle()`/
`dropdown()`/`colorInput()` (raw `<input>`/`<select>`, as Sonification's
sliders do), it won't get a tooltip automatically — call `markParamKey`
yourself if there's a matching `PARAM_DOCS` entry, or `attachTooltip`
directly with inline text if there isn't.

## Fixed-height rows vs. flex-grow rows (timeline dock)

The timeline dock (`src/ui/timeline/timeline.css`) had the mirror-image
bug: `.rw-tl-track` (the SCENES row) was `flex: 1 1 auto`, so resizing
the dock taller stretched scene *keyframe markers* into giant bars
instead of revealing more automation lanes. Fixed by making it `flex: 0
0 48px` — a **fixed** row height, matching how Ableton/Logic/Pro Tools
size a track lane. The rule of thumb generalizes: **a row/track's height
should be driven by what it needs to show one item legibly, not by
"whatever space happens to be free."** Extra dock height should either
reveal more rows or sit as blank canvas below the last one — never
inflate existing content. If you add a new fixed-role strip to the dock
(a second marker track, say), give it `flex: 0 0 <px>`, not `flex: 1`.

## Checklist for a new panel row

1. Building a single control? Use `slider()`/`toggle()`/`dropdown()`/
   `colorInput()` + `row(label, control)`. Done — width, tooltip, and
   modulation-dot wiring are all automatic.
2. Building a row with 2+ interactive pieces? Wrap them in `.rw-inline-
   group` first, pass the wrapper to `row()`. Check whether the new
   piece type needs a sizing override in the `.rw-inline-group` rules
   above.
3. New Settings key? Add it to `PARAM_DOCS` — Help, About Param
   Reference, and the hover tooltip all come from that one entry.
4. New section? Add a one-line entry to `SECTION_HINTS`.
5. Never hand-roll a bare `div.rw-row` with more than one control child.
