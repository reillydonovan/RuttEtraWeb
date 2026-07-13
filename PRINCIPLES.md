# Rutt/Etra: Design Principles

This document captures the architectural and product rules that have shaped every feature in this synth. They were not invented up front; they were derived from observed practice over the course of building the v1–v10 release cycle. The synth has accumulated significant complexity along the way — two parallel modulation engines, the Pattern Generator layer, mesh sonification, bidirectional CV I/O, the Timeline sequencer, the Projects workspace format — and the only thing keeping that accumulation coherent rather than chaotic is the small set of constraints written down here.

The nine principles below describe what to do, what not to do, and where it shows up in the existing code. New features should be measured against them before they ship. Existing features that violate them are bugs, not "different choices." Cursor reads a directive version of this document at `.cursor/rules/principles.mdc` and applies it during code generation; an artist-facing version exists in the About page's *Design Principles* section. All three are derived from the same nine principles in the same order, so cross-referencing between them is safe.

---

## 1. One concept, one authoritative source

**When a concept exists in multiple subsystems, it is defined once and consumed by all. No state lives in two places that have to be manually synced.**

### Why this exists

A concept that's defined twice will eventually be defined inconsistently. The two definitions will drift — usually because one is updated in response to a bug report and the other is forgotten, or because a feature flag is added to one site and not the other. Drift is invisible until it causes a user-facing bug, and by then the two definitions have already grown enough divergent context that reconciling them is a non-trivial refactor. The cheapest time to enforce "one source" is *before* the second copy is written.

Equally, "one source" is what makes documentation honest. If the in-app Help describes a parameter one way and the About page describes it another way, the user has to pick which one to believe. If both pages read from the same `PARAM_DOCS` map, they agree by construction.

### How it shows up in the codebase

- **Shared internal BPM.** `Settings.internalBpm` is the BPM. Classic mode LFOs in `Tempo` sync (`src/modulation/ModMatrix.ts`), the Graph mode `clock` node in `internal` mode (`src/modulation/graph/nodes/sources.ts`), and the Timeline sequencer in `internal` sync mode (`src/sequencer/Sequencer.ts`) all read from it. There is no `timelineBpm`, no `lfoTempo`, no per-engine duplicate.
- **`PARAM_DOCS` (`src/ui/help/paramDocs.ts`).** A pure-data map of every modulatable Settings key to its description, range, and panel category. The in-app Help reads it (`src/ui/help/HelpSection.ts`); the About page's auto-generated Param Reference reads the same map (`src/about/autogen.ts → buildParamReferenceHtml`). One description, two destinations.
- **Graph node registry (`src/modulation/graph/registry.ts`).** Each node registers a single `NodeDef<T>` carrying its inputs, outputs, params, and description. The runtime engine uses it to instantiate nodes; the About page's auto-generated Node Catalog renders the same registry (`buildNodeCatalogHtml`). New nodes appear in both places on the next build with no manual sync.
- **`migrateSettings()` (`src/state/Settings.ts`).** A single forward-only migration function is the canonical entry point for any saved data — settings, preset JSON, project JSON. The Project loader routes through it explicitly; the Settings localStorage loader does the same. Safety rules like "force `sonification.enabled = false` on load" are written once and apply everywhere.
- **`LiveValuesStore` (`src/modulation/LiveValues.ts`).** The renderer reads live values from one place. Both modulation engines push contributions into namespaces inside the same store. There is no "graph live cache" plus "classic live cache."
- **`ResolutionManager` (`src/renderer/ResolutionManager.ts`).** Renderer, postfx composer, and pattern render targets all consult one sizing authority. Resolution changes propagate from a single point.

### What violating this looks like

- Adding a `timelineBpm` field to `TimelineState` so the sequencer can run at a different tempo than the LFOs. The next user request — "why does my MIDI clock not sync the timeline?" — exposes the mistake; the timeline silently ignored the shared BPM.
- Hardcoding a parameter description in `HelpSection.ts` instead of adding it to `PARAM_DOCS`. The About page's auto-generated reference table now lacks the param, and the two pages disagree on what the param does.
- Re-implementing migration logic inside `Project.parseProject()` instead of routing through `migrateSettings()`. The Project loader silently allowed `sonification.enabled = true` to slip through, defeating the safety stack in Principle 4.

### Edge cases

- Some computations are duplicated *on purpose*. Pattern signals run both as a GLSL shader (for the visible pattern) and a CPU mirror (for the published modulation signal). Both read the same parameter state from `Settings`; the duplication is in the *computation*, not in the *source of truth*. That is fine and intentional.
- Performance caches (e.g., a frame-local copy of a per-frame value) are not "second sources" as long as they're rebuilt from the canonical source each frame and never written back.

---

## 2. Base values and live values are different things

**UI controls read and write the base value. Modulation contributes to the live value. The renderer reads the live value. The three never collapse into the same field.**

### Why this exists

When a modulation source goes quiet — disabled, deleted, amount turned to zero — its contribution must drop to zero immediately, and the parameter must snap back to whatever the user last set on the underlying knob. If modulation writes its sum back into the same field the UI displays, "turn the LFO off" leaves the last modulated value stuck. This was the actual bug that pushed the synth to v9's base/live split (see the docstring of `LiveValuesStore` for the full pathology).

The separation also makes the UI honest. The slider shows the value *you* set, not the value the LFO happens to be at right now. The wobble is on top.

### How it shows up in the codebase

- **`LiveValuesStore` (`src/modulation/LiveValues.ts`).** Holds live values as `base + sum(offsets) * product(factors)` across namespaces. Engines push per-frame contributions via `setContributions(namespace, offsets, factors)`. Contributions not in the new map are *cleared* on the same frame, so removed patches reset instantly.
- **Settings is base-only.** `Settings.set(key, ...)` is exclusively the UI write path. Search results for `Settings.set` should never appear inside `ModMatrix.tick()` or `GraphEngine.tick()` — and they don't.
- **The renderer reads live.** `RuttEtra.ts` and every shader uniform binding reads `liveValues.get(key)`. The shader never sees the base value directly.
- **Per-patch reset and global Reset Mod.** The `↻` icon zeros one patch's contribution. **Reset Mod** mutes every patch's Amount in one tick. Sliders are untouched; live values snap back to base.
- **Preset load smoothing.** When a preset replaces Settings, live values ramp to the new bases over ~120 ms (`src/main.ts`). The mechanism still respects the layering: Settings updates first, live ramps to the new base. No engine writes the ramp value into Settings.

### What violating this looks like

- A new modulation source that calls `settings.set('zPush', currentLiveValue)` "to keep things consistent." This is the pre-v9 bug. Disabling that source will leave Z Push stuck wherever the source last had it.
- A UI control that reads from `liveValues.get(key)` for its displayed value. The slider will now jitter at the LFO rate while modulation is active, and the user can no longer tell what their own base setting is.
- A "freeze current value" feature that copies live into base. This may be the right product feature, but it must be triggered by *explicit user action* (a button), never by a modulation lifecycle event.

### Edge cases

- The "freeze" button described above is the only legitimate path from live to base, and it requires user intent.
- Multiplicative factors (`factor = 1` means no effect) are a separate accumulator from additive offsets and combine via `base * product(factors) + sum(offsets)`. Both still write to `liveValues`, not to `Settings`.
- **UI skins are faces, not forks (v1.5's hardware skin).** An alternate skin renders *inside* the existing widget functions and writes base through the same single write path (`setFromDisplay()` and friends in `widgets.ts`) — never a parallel widget tree, never a second setter path. Skin code reads `LiveValuesStore` for display only; a skeuomorphic control that "shows live" is exactly where writing live back into base will one day look tempting. It is still the pre-v9 bug.
- **Skin state is local UI preference, never patch data.** It lives in localStorage (`src/ui/skin.ts`), not in `Settings`/presets/projects — loading someone else's patch must never restyle your panel. See `docs/design/skeuomorphic-skin.md` §1.

---

## 3. No silent fallbacks

**When a feature has a configured mode and that mode's prerequisite is missing, surface the state. Do not silently fall back to a different mode.**

### Why this exists

Silent fallbacks mask misconfiguration. A user picks MIDI Clock sync, starts the show, and the MIDI cable is loose; if the LFO silently falls back to internal BPM the user only notices that the visuals are wrong mid-set, with no information about why. An explicit "no clock" indicator turns a mystery into a one-second debug. The same calculus applies to device pickers, file references, audio inputs, and CV interfaces.

"Just work" sounds friendly until you realize the friendlier behavior is "tell me when something's broken so I can fix it."

### How it shows up in the codebase

- **MIDI Clock with no clock.** When `Sync = MIDI` and no clock pulses have arrived for 2 seconds, `MidiClock` (`src/midi/MidiClock.ts`) reports "no clock"; the Modulation panel lights its indicator; LFOs hold at their last-known rate. They do *not* switch to `internalBpm` (see the comment in `docs/about/04-modulation.md` under "Shared internal BPM").
- **Configured MIDI device disconnected.** `MidiManager` surfaces the disconnect state; the bindings list shows the device as unavailable. The synth does not auto-pick a different device.
- **AC-coupled audio interface for CV.** The CV input panel warns when the active interface is suspected AC-coupled (DC voltages will drift toward zero) rather than silently giving the user garbage data.
- **Recent Projects on Firefox/Safari.** Without persistent `FileSystemFileHandle`, recent entries show project names but require re-pick. The synth does not silently load a stale path or pick a different file.
- **Settings migration on unknown future versions.** A project file with `formatVersion > current` logs a `console.warn` and is normalized on save; it does not silently truncate fields.

### What violating this looks like

- Adding `if (!midiClock.received) return internalBpm` inside an LFO's rate computation. This is the canonical anti-example. The performer never knows why the visuals fell behind the band.
- Auto-picking the first available microphone when the configured device disappears. The user thinks they're recording one source and is actually recording another.
- Loading a "default" preset when a referenced preset name is missing. The keyframe silently snaps to a different look.

### Edge cases

- Defaults are appropriate when **no specific mode is configured**. Internal BPM is the default when `Sync = Internal`. Falling back to it when MIDI Clock is *not selected* is fine. Falling back to it when MIDI Clock *is* selected is never fine.
- "Tell the user" is enough; the synth doesn't have to refuse to run. The LFO holding its last-known rate is a sensible runtime behavior. The point is that the user can see the state.

---

## 4. Explicit user action required for audio output

**Any feature that produces sound or sends voltage to external hardware loads its configuration but never auto-enables. Defaults are quiet. Soft-start ramps from zero. A hard limiter sits between voices and destination. Feedback paths are detected and prevented.**

### Why this exists

Audio output is where unhappy accidents happen. A loud preset, a feedback loop from mic input, a runaway resonant filter, an inadvertent voltage spike into a hardware module — all of these are at minimum unpleasant and at maximum expensive. The cost of being conservative is one button click on enable. The cost of being permissive is occasionally a damaged module or a damaged eardrum. The safety stack is therefore mandatory and non-negotiable on every audio-output feature, and the rule is structural: even if the saved file says "enabled," the loader replaces it with "disabled."

### How it shows up in the codebase

- **Sonification (`src/audio/Sonification.ts`).** Default disabled on every page load. Default master volume `-18 dB`. `500 ms` soft-start ramp on enable; `250 ms` on disable. `DynamicsCompressorNode` brick-wall limiter at `-3 dBFS`. Mic-feedback gate forces master to 0 with a UI banner if mic input is selected as an envelope source while sonification is on. Isolated `AudioContext` so sonification can never leak into CV.
- **CV output (`src/audio/CVOutput.ts`).** Channels default disabled. `100 ms` ramp from 0V on enable. Hard sample clamp to `±10V` in the worklet. Separate `AudioContext` targeting a DC-coupled interface via `setSinkId`.
- **`migrateSettings()` structural override.** Every load — settings, preset, project — forces `cvOutputEnabled = false`, every `cvOutputChannels[].enabled = false`, and `sonification.enabled = false` regardless of saved values. This is enforced inside the migration so no loader can forget it.
- **Project load toast.** The summary explicitly names disabled hardware-output features so the user can re-enable them deliberately: *"2 CV channels (disabled), sonification ready (disabled)."*

### What violating this looks like

- A new audio feature that defaults to "on" because "the user enabled it last time, that's what they want." This is exactly the configuration the safety stack refuses. The user will re-enable it explicitly after every load; that's the point.
- A CV channel that ramps from "current voltage" instead of from 0V on enable. A click of arbitrary size enters the modular.
- Skipping the limiter for "performance" reasons. The limiter is `~0.1 ms` of latency; if a feature can't afford it, the feature doesn't ship.
- Loading a saved project's `sonification.enabled = true` directly without routing through `migrateSettings()`.

### Edge cases

- Visual rendering (the canvas) auto-resumes on load. The rule is strictly about audio output and external voltage. Light is not sound.
- The Test button on each CV channel that holds `+2.5V` while pressed is a deliberate, momentary, user-driven action — explicit by definition. It's the safety stack working, not bypassing.

---

## 5. Coexistence over replacement

**New systems live alongside old, not on top of. ModMatrix wasn't replaced by GraphEngine; both run, the user picks. Presets weren't replaced by Projects; both serve different scales. Pattern Generator is a layer, not a mode that excludes the webcam.**

### Why this exists

A working feature has a user base, a set of expectations, and an established mental model. Replacing it with a "cleaner" alternative breaks all three even when the alternative is genuinely better. The cost is paid by every existing user, the benefit is captured by future users; the math rarely favors replacement on a tool that ships incrementally. Coexistence — the old keeps running, the new lives next to it, the user can opt in — preserves working features and gives users gradual paths into new capabilities.

This is also a guard against premature unification. Two systems that *look* similar at the level of "they're both modulation" are very different at the level of "how the user reasons about them" (Principle 7).

### How it shows up in the codebase

- **Classic and Graph modulation.** `ModMatrix` (`src/modulation/ModMatrix.ts`) and `GraphEngine` (`src/modulation/graph/GraphEngine.ts`) both exist. `Settings.modMode` selects `classic`, `graph`, or `both`. Their contributions sum into `LiveValuesStore` from separate namespaces; nothing forces a user to migrate.
- **Presets, Timelines, Projects.** Three save formats at three scopes (see `docs/about/06-performance.md`). A preset is a look; a timeline is a score; a project is a workspace. None replaces another — sharing a preset is fundamentally different from sharing a workspace.
- **Pattern Generator (`src/renderer/patterns/`).** A `patternEnabled` toggle gates a layer that composites onto the existing video pipeline. `sourceKind` (webcam / file / screen / none) is untouched; the pattern blends on top via `patternBlendMode + patternMix`. The 1973-faithful "internal signal generator" is a layer alongside the camera, not a fourth source-enum value that excludes it.
- **Graph mode views.** Beginner view is a constrained projection of the same underlying graph that Advanced view edits. Both are valid; the user picks per session.
- **Help panel and About page.** The Help dock is the short-form quick reference; the About page is the long-form manual. Both ship; neither replaces the other.

### What violating this looks like

- Removing ModMatrix once GraphEngine reached feature parity. Every existing preset's modulation now requires a manual rebuild in Graph mode.
- Folding the Pattern Generator into `sourceKind: 'pattern'`. Users who want camera-plus-pattern (the most common combo) suddenly can't have both.
- Deleting the Help panel because the About page covers the same content. Quick-while-you-work and read-in-depth are different jobs.
- A v2 modulation engine that auto-migrates v1 patches into its model on load. Users who relied on v1 semantics lose work.

### Edge cases

- True deprecation is appropriate when the existing system is broken or unmaintainable — not when a new design is merely cleaner. None of this codebase's systems are in that state. If something reaches it, deprecation gets its own explicit user notification (see Principle 6) and a wind-down period.
- A new system that's strictly a refactor with identical user-facing behavior can replace the old one; the rule is about user-facing systems, not internal plumbing.

---

## 6. Migrations are explicit, never silent

**Saved format upgrades happen on load with versioned schemas. Old data is preserved when shape changes. Migrations notify the user when non-trivial changes happen, and offer reversal where reasonable.**

### Why this exists

The user trusted the synth with their work. Silent migration breaks that trust the moment a value changes shape and the user notices a different sound. The cost of "we hope you didn't need that" is dramatic — saved projects feel disposable, which makes the format itself feel disposable. The cost of explicit migration is a one-line toast and a version field.

This rule extends past format upgrades into any data shape change: shortening a timeline, removing a parameter, splitting one field into two. Whenever the user's saved structure changes in a way they could detect, they should be the one to know.

### How it shows up in the codebase

- **`migrateSettings()` (`src/state/Settings.ts`).** A versioned migration chain (`v1 → v2 → … → v10`), each step idempotent. New fields get sensible defaults; legacy fields are converted (e.g., the v7 → v8 step that converts `clockSync: boolean` into the `syncMode` enum and deletes the legacy field).
- **Preset version field (`_v`)** is written on every save; loading a lower version walks the migration chain. The synth keeps reading old presets indefinitely.
- **Project formatVersion (`src/project/Project.ts`).** Forward-compat: a file with `formatVersion > current` loads with a `console.warn` and is normalized on save, not silently truncated.
- **Timeline shortening.** Keyframes past the new end are *flagged*, not deleted. They reappear if the timeline is lengthened again. The user can see them but they don't play.
- **The Recovered Session (`src/project/RecoveredSession.ts`).** When pre-Project state is detected on first launch after the Projects feature shipped, it's packaged into a recovery prompt — one-shot, gated by a localStorage marker, never silent.
- **Modulation engine upgrade.** When `modMode` was added (Classic → Classic+Graph), old presets loaded as `modMode = 'classic'` exclusively. No auto-conversion of Classic slots into graph patches; the user converts deliberately via the **Convert to Graph** button when they want it.

### What violating this looks like

- Silently dropping `pattern*` keys when a v10 project loads in v9 code. Round-tripping the file loses work invisibly.
- Auto-picking a BPM when multiple saved timelines disagreed: "the most recent timeline's BPM becomes the shared BPM." There is no right answer to "which timeline wins"; the only correct move is to leave the default at `120` and surface the prior values so the user picks.
- A modulation engine upgrade that silently rewrites all existing patches into the new model. The user loads their preset and the sound is different.
- Quietly upgrading a saved file's version on load without notification. The user doesn't know what changed; they can't tell if anything broke.

### Edge cases

- Strictly additive migrations — new optional fields with sensible defaults — don't need a user-visible notification. They're still versioned. The rule is about user-detectable changes.
- A migration that fails (malformed JSON, unrecognized shape) should fall back to defaults *with a notification*, not silently. The Recovered Session pathway is the model: try to recover, tell the user, let them decide.

---

## 7. The data model serves the user's mental model, not the engineer's

**The shape of saved data and the shape of UI bend toward how users reason, not toward how the code is convenient to write.**

### Why this exists

Engineering convenience pulls toward unification: any two things that share data should share a representation. User reasoning pulls toward differentiation: two things the user thinks about separately should look separate, even if their data could collapse. The user is the one who has to explain the synth to a friend, debug it at 2am, and remember last week's choices. The engineer reads the code every day; the user touches it occasionally. Bend toward the user.

A second reason: when the data model matches the user's model, documentation writes itself. When it doesn't, every section becomes a translation layer.

### How it shows up in the codebase

- **Automation lanes vs preset keyframes.** Both are "moments in time" mathematically. They exist as separate concepts because users think about "structural moments" (a key change in the piece) and "per-knob animation" (the Z Push wobble) as different jobs.
- **Pattern Generator as a layer.** Not `sourceKind = 'pattern'`. Users describe it as "the synth signal composited on top of my video"; the data model matches that exactly (`patternEnabled + patternBlendMode + patternMix`).
- **Classic and Graph modulation as different engines.** They could have been the same engine with two UI skins. They're not, because users have different mental models — DAW-style 4-slot patching vs voltage-control patcher — and the synth respects that.
- **Three save formats (preset / timeline / project).** A single nested document could carry all three. It doesn't, because users want to share a *look* without sharing their *MIDI bindings*. The formats match the things users want to do, not the engineering shape of the data.
- **Source toggles styled like Mirror H / Mirror V.** Pattern Generator's enable toggle deliberately mimics the existing per-frame source modifiers, because that's the family of controls users already understood.

### What violating this looks like

- Unifying Classic and Graph into one engine because "they're both modulation." Users who reasoned about a 4-slot matrix now have a graph; users who reasoned about a graph now have a matrix view. Both groups lose.
- Folding Pattern Generator into `sourceKind = 'pattern'`. The user wants camera-plus-pattern (most common); the data model says you can have one or the other.
- A `keyframes[]` array that contains both timeline preset-jumps and per-knob animations interleaved. The data is "neat"; the user can't reason about either job in isolation.
- Naming a UI control `slot.modOutEnabled` when the user calls it "MIDI Out." Engineering convenience names belong to engineering; user-facing labels belong to users.

### Edge cases

- Sometimes the user model and the engineering model align (e.g., a list of presets is just a list). When they do, take it; this principle is about resisting unification when they don't.
- Internal representations can be whatever's convenient as long as the saved-format and UI-facing shape matches the user model. A graph that's stored as edges-and-nodes internally but displayed as expandable rows for Beginner view is fine; both shapes serve their audience.

---

## 8. Documentation is part of feature acceptance

**Every feature lands with Help panel updates and About page updates in the same build. Auto-generated reference sections are wired so documentation cannot drift from code. A feature that ships without docs is incomplete.**

### Why this exists

Documentation written later is documentation that's wrong. The author has forgotten the rationale, the API has shifted, the edge cases that were obvious during the build are no longer obvious. The cheapest documentation is the documentation written by the person who just shipped the feature, while the trade-offs are still fresh.

Auto-generated reference sections take this further: if the docs are computed from the same data the runtime uses, they cannot drift at all.

### How it shows up in the codebase

- **`PARAM_DOCS` is the single source.** New modulatable params register their description, range, and panel category in `src/ui/help/paramDocs.ts`. The in-app Help and the About page's Param Reference both read this map (see Principle 1).
- **Graph nodes register their docs.** A new node's `NodeDef<T>` carries its `description`, `inputs`, `outputs`, and `params`. The Node Catalog in the About page is generated from the registry.
- **About page sections per feature.** Every recent v9–v10 feature shipped with its own markdown section under `docs/about/` (Pattern Generator → `03-synthesis.md`, Sonification → `05-io.md`, Projects → `06-performance.md`). The README's *Recent changes* list documents what changed at the developer level as well.
- **Help content tabs.** `src/ui/help/content.ts` carries per-tab markdown blobs. New features update the relevant tab in the same PR as the runtime code.

### What violating this looks like

- A new graph node that runs in the engine but lacks a description, so it appears in the catalog as an empty entry. The user can patch it but can't tell what it does.
- "We'll document this in the next release." There is no next release for that documentation; it ships when it ships.
- Hardcoding a control's description in two places (Help and About) instead of registering it in `PARAM_DOCS`. The two will drift; this is also a Principle 1 violation.
- Shipping a parameter that's missing from `PARAM_DOCS`. The Help tab is silent for it; the About page's auto-generated reference omits it.

### Edge cases

- Purely internal refactors that don't change user-facing behavior don't need doc updates. Rename a function, change a file's layout — fine.
- Experimental features behind a flag may ship without full About page coverage if the flag itself is explicit. They still need *something* in Help — at minimum a note that the feature is experimental and how to enable it.

---

## 9. The right scope is rarely the maximalist scope

**The synth ships features that work end-to-end before adding the next layer. Stages are serial when they share architecture; parallel when they don't. The result is features that ship working rather than half-built superstructures.**

### Why this exists

A maximalist v1 fails partially. A minimal v1 ships completely. The user can use a complete single feature; they cannot use a half-built polyphonic synth. Scope discipline is therefore an honesty mechanism: the synth claims to do the things it actually does and nothing more, and the next layer arrives once the previous one is solid.

This is also a guard against architectural debt. A maximalist design freezes a lot of decisions before they've been validated by use. A minimal design leaves room to learn.

### How it shows up in the codebase

- **Sonification ships as a single voice.** Not polyphonic, not multi-timbral, not a synth bay. One voice that sounds good is more useful than thirty-two voices that don't.
- **Graph Beginner view shipped before the Advanced node editor.** Same underlying graph; the Beginner view constrains the surface so the user can patch immediately, the Advanced view follows for users who outgrew it.
- **Pattern Generator v1 did not expose internal signals as modulation sources.** Visual rendering shipped first; the `pattern-output` bus followed in a later stage once the rendering side was proven.
- **CV output supports five channel types** (cv / gate / trigger / clock / pitch). Not fifty. The five cover the common cases; extensions are added when requested.
- **Resolution presets are a fixed list** (SD / HD / FHD / QHD / 4K / Custom). Custom exists for the edge case; the presets cover the working cases.
- **The OSC bridge is a small Node program.** Not a configurable middleware framework. It does one thing and does it.

### What violating this looks like

- Shipping a polyphonic sonification engine instead of a single voice that sounds good. The MeshAnalyzer side is solid; the synth side is half-built; the feature feels uneven and gets used only by people willing to debug it.
- Building the Advanced graph editor before the Beginner view exists. Most users never get past the empty-canvas problem.
- Adding "internal signals as modulation sources" to the Pattern Generator at the same time as the visual rendering. The rendering bugs and the signal-routing bugs interleave; debugging takes longer than the serial version.
- A "Custom" resolution input with no presets at all. The user has to know what FHD is. Defaults are scaffolding; remove them only when the user has explicitly chosen to.

### Edge cases

- Some features are end-to-end *only* at full scope. A data-format migration needs to handle every version, not just the most recent one. "Minimum" still means the smallest correct version, not "an arbitrary subset."
- A feature can ship more maximally if the user explicitly asks for it. "Smallest working scope" is the default; the user can override it. This is what Cursor's directive document means by "confirm before building a maximalist version."

---

## Applying these principles to new work

A short checklist for proposing or reviewing a feature. Walk through each item; if the answer surprises you, that's the principle in action.

1. **Does this introduce a concept that already exists elsewhere?** ([§1](#1-one-concept-one-authoritative-source)) Search before adding state. If it exists, consume the existing source.
2. **Does this touch a parameter — base or live?** ([§2](#2-base-values-and-live-values-are-different-things)) UI writes base, modulation writes live, renderer reads live. Anything else needs explanation.
3. **Does this have a fallback path that could silently mask user error?** ([§3](#3-no-silent-fallbacks)) Surface the state. Hold last-known. Show the indicator.
4. **Does this produce audio output?** ([§4](#4-explicit-user-action-required-for-audio-output)) The safety stack is mandatory: default disabled, quiet, soft-start, limiter, feedback gate, structurally enforced through `migrateSettings()`.
5. **Does this replace existing functionality, or coexist?** ([§5](#5-coexistence-over-replacement)) Default to coexistence. Replacement requires the existing system to be broken or unmaintainable, not merely older.
6. **Does this change a saved format?** ([§6](#6-migrations-are-explicit-never-silent)) Bump the version. Add a migration step. Notify the user where the change is detectable.
7. **Does the data model match how users will think about this?** ([§7](#7-the-data-model-serves-the-users-mental-model-not-the-engineers)) Describe the feature out loud to an imagined user. Match that description.
8. **Where in the docs does this land?** ([§8](#8-documentation-is-part-of-feature-acceptance)) Help panel update, About page section, `PARAM_DOCS` / `NodeDef` entry. Documentation is part of acceptance, not a follow-up.
9. **What's the smallest working version?** ([§9](#9-the-right-scope-is-rarely-the-maximalist-scope)) Ship the minimum that's complete end-to-end. Stage the rest serially.

When a feature request conflicts with a principle, surface the conflict. The principles are constraints, not suggestions; they are written down precisely so that "we'd have to violate principle 4 to do this" is a fair thing to say in a design discussion.

---

> See also: the artist-facing version of these principles lives in the About page under *Design Principles*. The directive version for AI tools lives at `.cursor/rules/principles.mdc` and is applied automatically during code generation in this repo.
