# Design proposal: Anti-menu-diving (AUDIT item 26)

Status: **proposal — awaiting owner decision.** The two "least-opinionated wins" below shipped with this document; the three structural approaches are specified but NOT implemented.

## Problem

The audit measured the panel as shallow (≤4 clicks to anything: DCU param 0–1, modulation target ~3, CV-out channel ~3–4) but with **zero fast navigation**: no search, no favorites, no keyboard jumps, and Learn is initiated from the I/O sections rather than from the knob being bound. "Nobody likes to menu dive" is less about depth here and more about *round trips* — a performer tweaking Z Push, bloom, and one LFO rate mid-set re-scrolls the accordion every time.

## Shipped with this proposal (modest wins)

1. **Panel-wide param search** — a box above the tab strip; filters all tabs by section title / row label / hint, expands matches, dims non-matches, auto-switches tab, restores prior accordion state on clear. `/` focuses it. DOM-driven; zero per-section registration.
2. **Tab hotkeys** — `1` / `2` / `3` switch Synth / I/O / Help when not typing.
3. (Adjacent, from item 27) **Two-screen popout** and (from item 16b) **right-click precise entry** already reduce panel round trips.

## Approach A — Command palette (Ctrl+K)

A fuzzy-matching overlay (like an editor's palette) indexing: every param (jump + focus + type-a-value inline), panel actions (Start Recording, Reset Mod, New Project…), presets by name, and Learn verbs ("learn midi → zPush").

- **Pros:** one interaction covers navigation, value entry, actions, and binding; keyboard-first performers never touch the accordion; index can be built from `PARAM_DOCS` + `TARGETS` (single sources already exist).
- **Cons:** heaviest build (fuzzy index, overlay UI, action registry — the action registry is new architecture); discoverability for non-keyboard users is poor; overlaps ~60% with the shipped search box.
- **Est. scope:** action-registry module + overlay UI + index builder; no schema change unless recent-commands persistence is wanted (⚙️ one key).

## Approach B — Pinned "performance strip" (recommended)

Right-click (or a pin icon in the numeric modal) adds any param to a horizontal strip docked above the canvas — a mini-row of 4–8 favorite sliders always visible, drag-to-reorder, one click to unpin. Persisted as `pinnedParams: string[]` in Settings (⚙️ one migration).

- **Pros:** directly matches the performer mental model ("my faders for this set"); zero navigation once pinned; tiny surface (reuses `slider()` widgets bound to the same keys — one concept one source); pairs perfectly with the popout window; naturally travels inside Projects.
- **Cons:** occupies canvas real estate (mitigate: auto-hide when the panel is collapsed / fullscreen); one more chrome element; needs a compact-layout answer (probably "not on compact" v1).
- **Est. scope:** small — a strip component + pin plumbing in the numeric modal + `pinnedParams` migration + docs. No engine changes.

## Approach C — Learn-from-the-knob + per-param context menu

Extend the right-click modal (shipped in item 16b) into a small context sheet per param: **Learn MIDI**, **Learn OSC**, **+ LFO** (exists for pattern params — generalize the "+ Mod patch" affordance), **Pin** (if B ships), **Reset**, **Custom range** (shipped).

- **Pros:** binds interaction to the knob the user is already touching — the single biggest round-trip killer for I/O setup; "+ LFO" generalization reuses the pattern-panel idiom users already know; composes with A and B rather than competing.
- **Cons:** Learn needs target-aware entry points into `MidiMapping.learn()` / OSC learn (today they're table-row-initiated — API is there, the UI contract needs a "learn into key K" variant); modal grows towards a menu (keep it a short verb list, not a submenu tree).
- **Est. scope:** medium — modal → context sheet, learn-by-key wiring, generalized +LFO helper. No schema change.

## Recommendation

Ship **B then C** (B is the highest value-to-risk ratio; C removes the I/O-tab round trip). Revisit **A** only if the action count grows enough that a palette beats the search box — today it wouldn't.

## Explicitly not proposed

Restructuring the accordion/tab IA itself, floating per-section panels, or a hard "performance mode" that hides sections — all conflict with "keep the panel familiar" and the coexistence principle for marginal gain over A–C.
