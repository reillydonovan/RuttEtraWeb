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
| Global | `1`–`9` | Load preset snapshot slot |
| Global | `F` | Toggle fullscreen (where supported) |
| Global | `H` | Toggle Help panel |
| Global | `?` | Focus the search box on this page |

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
