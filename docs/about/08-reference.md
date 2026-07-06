## Reference

The dry reference material that doesn't flow in prose but needs to be available. Print this page for an offline copy.

### Keyboard shortcuts

| Context | Key | Action |
|---|---|---|
| Camera | `R` | Reset View |
| Camera | `Shift+R` | Hard Reset Camera |
| Camera | `W A S D` | Translate (Fly mode) |
| Camera | `Q / E` | Translate vertical (Fly mode) |
| Camera | `Space` | Boost speed (Fly mode) |
| Camera | `Ctrl` | Slow speed (Fly mode) |
| Camera | `Shift` | Sprint (Fly mode) |
| Camera | `Esc` | Exit Fly mode → return to Orbit |
| Timeline | `Space` | Play / pause |
| Timeline | `←` / `→` | Step playhead by one bar |
| Timeline | `K` | Add keyframe at playhead |
| Timeline | `Delete` | Delete selected keyframe |
| Timeline | `Ctrl+Z` | Undo last timeline edit |
| Project | `Ctrl+N` | New Project (prompts on unsaved changes) |
| Project | `Ctrl+O` | Open Project (file picker) |
| Project | `Ctrl+S` | Save Project (writes back to current file, or prompts if untitled) |
| Project | `Ctrl+Shift+S` | Save Project As (name + location prompt) |
| Global | `/` | Focus the panel param search |
| Global | `[` / `]` | Cycle panel tabs (Synth / I/O / Help) |
| Global | `Alt+Shift+D` | Toggle the layout debug overlay |

The Project shortcuts call `preventDefault()` to override the browser's built-in `Ctrl+S` ("save page as") and `Ctrl+O` ("open file") so they always reach the synth.

### URL parameters

Append any of these to the URL of the synth (`index.html?...`). Multiple flags can be combined with `&`.

| Parameter | Effect |
|---|---|
| `?view=<peerid>` | Viewer mode — connects to the broadcast with the given PeerJS id, hides UI, fullscreen output. |
| `?layout=compact` | Force compact layout (single-column, ideal for tablets). |
| `?layout=standard` | Force standard layout. |
| `?layout=expansive` | Force expansive layout (large desktop). |
| `?debug=layout` | Overlay layout boundaries (red boxes around panels). |
| `?debug=graph` | Overlay graph engine state (per-frame node values). |
| `?debug=mod` | Overlay modulation matrix state (live values, base + mod split). |
| `?nohelp` | Suppress first-run auto-open of the Help panel. |
| `?tests=integration` | Run the integration test harness on load (development builds only). |

The about page itself accepts no URL parameters; it is a pure static document.

### File formats

#### Preset JSON (excerpt)

```json
{
  "version": 9,
  "name": "Phosphor Green",
  "settings": {
    "sourceKind": "webcam",
    "zPush": 1.5,
    "intensity": 0.8,
    "internalBpm": 120,
    "modMode": "classic",
    "patches": [
      { "id": "p1", "source": "lfo", "target": "zPush",
        "amount": 0.5, "params": { "rate": 0.5, "shape": "sine" } }
    ]
  }
}
```

#### Timeline JSON (excerpt)

```json
{
  "version": 1,
  "bpm": 120,
  "loop": true,
  "tracks": [
    { "bar": 0,  "kind": "snapshot", "settings": { ... } },
    { "bar": 8,  "kind": "presetRef", "name": "Phosphor Green",
      "easeIn": "smoothstep" },
    { "bar": 16, "kind": "snapshot", "settings": { ... } }
  ]
}
```

#### Project JSON (`.synth.json`)

A single JSON document, version-stamped. Top-level structure:

```json
{
  "formatVersion": 1,
  "type": "ruttetra-project",
  "appVersion": "0.10.x",
  "savedAt": "2026-05-14T21:00:00.000Z",
  "name": "Session 1",
  "description": "live set / Tuesday rehearsal",

  "settings": { /* full Settings snapshot */ },
  "userPresets": [ { "id": "...", "name": "...", "values": { ... } } ],
  "timelines":   [ { /* Timeline snapshots */ } ],
  "activeTimelineId": "tl-..."
}
```

Field guide:

- `formatVersion` — schema version for migration. Bumped on breaking changes; `parseProject()` runs migration steps when an older version is loaded, and saving back always writes at the current version.
- `type` — must be `"ruttetra-project"`. Guards against accidentally loading a preset or timeline file.
- `appVersion`, `savedAt`, `name`, `description` — metadata.
- `settings` — the full `Partial<Settings>` snapshot. Carries every persistent subsystem: DCU controls, modulation patches (Classic + Graph), camera `defaultView`, color / FX, MIDI bindings, OSC bindings, CV input + output channels, sonification config, pattern generator config, workspace UI, resolution + render scale, performance profile.
- `userPresets` — the named user presets at save time. Replaces the in-memory list on load.
- `timelines` — full timeline snapshots (no external references). `activeTimelineId` selects which one is loaded into the sequencer.

Loading a project routes `settings` through the same migration that the standalone Settings loader uses, which means **audio-output features (CV outputs, sonification) load with their configurations restored but always in a disabled state for safety**. The user explicitly re-enables them after load. This rule is structural — the saved file CAN say `enabled: true`, but the loader will discard that and substitute `false`.

The format is **self-contained** — no external references, no relative paths, no "load this preset from disk" indirection. A `.synth.json` round-trips identically through any cloud storage.

#### OSC bridge protocol

WebSocket messages are JSON: `{ "addr": "/cv/0", "args": [0.42] }`. Outgoing CV values are floats in `[-1, 1]`; the bridge multiplies by your hardware's voltage scale before sending OSC. Inbound messages from the bridge follow the same shape.

### Browser support matrix

| Feature | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Core synth (DCU + render) | ✅ | ✅ | ✅ |
| Web Audio | ✅ | ✅ | ✅ |
| Web MIDI | ✅ | ⚠️ behind flag | ❌ |
| Multi-channel audio (>2 ch) | ✅ Chrome 90+ | ⚠️ 2 ch only | ⚠️ 2 ch only |
| `setSinkId` (CV out routing) | ✅ | ✅ Firefox 116+ | ❌ |
| `getDisplayMedia` (screen capture) | ✅ | ✅ | ✅ macOS 13+ |
| WebRTC broadcast | ✅ | ✅ | ✅ |
| MediaRecorder MP4 | ✅ Chrome 100+ | ✅ Firefox 130+ | ✅ |
| MediaRecorder WebM | ✅ | ✅ | ❌ |
| Gamepad API | ✅ | ✅ | ✅ |

> Practical summary: Chrome / Edge for the full feature set. Firefox covers everything except Web MIDI (use a CV-to-MIDI-to-OSC bridge or the I/O panel's OSC). Safari is fine for playback and basic synthesis but lacks MIDI and WebM recording.

### Hardware compatibility (community-tested)

Not exhaustive — confirmed working by users in the field. If a device works for you that isn't listed, file an issue.

- **DC-coupled audio interfaces** — Expert Sleepers ES-3 / ES-5 / ES-8 / ES-9, MOTU UltraLite mk5, MOTU 828es, Focusrite Clarett+ 8Pre (DC mode toggleable per channel), RME Fireface UFX III.
- **CV-to-MIDI converters** — Endorphin.es Shuttle Control, Befaco CV Thing (CV out), Polyend Poly2 (note CV in), Bastl Atti (USB-MIDI to CV).
- **MIDI controllers** — Native Instruments Maschine Mikro, Akai LPD8, Novation Launchpad, Korg nanoKONTROL2. Anything that sends MIDI CC works.
- **Gamepads** — PS4 / PS5 DualShock, Xbox Wireless, generic USB SNES / Genesis pads, Logitech racing wheels.
