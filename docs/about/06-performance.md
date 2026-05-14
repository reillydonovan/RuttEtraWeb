## Performance & Recording

How to keep frames smooth, get the picture you want, and capture the result.

### Performance profiles

Top of the **UI** panel: a three-way selector.

- **Quality** — every effect on, full FFT bands, full mesh resolution, no fps cap. Use on a workstation GPU.
- **Balanced** (default) — mid bloom, mid FFT, mesh resolution capped at the picked Resolution. Use on a modern laptop.
- **Battery** — bloom off, half mesh, low FFT. Use on a phone or to run all day.

Each profile is a coarse hint — individual sliders still override. Switching profiles never wipes your settings.

### Resolution and render scale

- **Resolution** — target frame size (SD / HD / FHD / QHD / 4K / Custom). The renderer is sized to this, regardless of window dimensions.
- **Fit modes** — `Match window`, `Fit to window`, `Fixed`. `Fit` letterboxes if aspect ratios don't match; `Match window` resamples to fit; `Fixed` shows actual pixels (with scrollbars at small viewports).
- **Render scale** — supersampling factor for anti-aliasing (`1.0` = native, `2.0` = render twice the linear resolution then downsample). Costs GPU time, dramatically smooths sharp scanline edges.

### Recording

- **Format** — Auto, MP4, WebM-VP9, WebM-VP8. Auto picks the highest-quality codec the current browser supports. MP4 is ideal for direct social/media upload; WebM is better for archival.
- **FPS** — 30 / 60. Recording at 60 needs a steady 60fps render — drop to Balanced profile if you see frame drops.
- **Bitrate** — 1 to 50 Mbps. 8 Mbps is broadcast-grade for 1080p; 20 Mbps is over-provisioned and useful for masters.
- **Include mic** — encode the live microphone (or whichever audio input is selected) into the file's audio track.
- **Filename** — auto-generated as `rutt-etra-YYYYMMDD-HHMMSS.<ext>`.

The **Resolution** picker determines recording dimensions. Set Resolution to FHD before clicking Record if you want a 1920×1080 output.

### Timeline recording

The Timeline sequencer (Record panel → Timeline tab) lets you compose a piece by adding **keyframes** at specific bars. Each keyframe is either:

- a **snapshot** of the current Settings (saved inline), or
- a **preset reference** (linked to a saved preset by name).

Between keyframes the synth interpolates per-parameter with the configured easing (Linear / Smoothstep / Smootherstep / Cubic In/Out / Bounce). Hit **Record Timeline** and the entire piece is captured end-to-end in one button — equivalent to manually scoring keyframe positions, hitting play, and starting the recorder simultaneously. The output file is exactly the duration of the timeline.

Edit workflow:

- Click **Add at playhead** to add a keyframe at the current bar.
- Drag keyframes horizontally to reposition.
- Right-click for context: Replace Snapshot With Current, Convert To Preset Reference, Delete, Duplicate.
- The "Replace Snapshot With Current" action is critical — it's how you adjust a snapshot keyframe in place after tweaking parameters.

MIDI clock sync is supported on the timeline. Set Sync = MIDI and the playhead advances on incoming clock pulses; the bar grid lines up with the MIDI bar.

### Broadcasting

- Click **Start Broadcast** in the Share panel. The synth establishes a WebRTC peer-to-peer link via PeerJS, generates a viewer URL like `https://your-host/?view=<peerid>`, and renders a QR code.
- Viewers open the URL on any device and see the fullscreen output with no UI overlay. The viewer page does NOT load the synth runtime — it's a pure receiver.
- The default broker is the public PeerJS server. For production / consistent uptime, run your own peer broker (`peerjs --port 9000`) and point the synth at it via the `peerHost` setting.

### Presets

- **Save** — captures the entire Settings tree (DCU, modulation, color/FX, camera default view, internalBpm, modMode, OSC mappings, MIDI mappings).
- **Load** — replaces the current Settings with the saved values. Live values smooth-ramp to the new bases over ~120 ms by default, so the transition is musical rather than a hard cut.
- **Export / Import** — round-trips the preset as a JSON file. See the Reference section for the schema.
- **Snapshot slots `1`–`9`** — the keyboard digit keys map to nine quick slots, useful for performance hot-loading.

### Timeline sequencer (full walkthrough)

The bar-based interpolating preset sequencer. Conceptually: a piece is a list of (bar, snapshot) pairs, the playhead advances bar-by-bar, and at any moment the live Settings is the interpolation of the two surrounding keyframes.

- **Add keyframe** — at playhead, or by clicking on the bar grid.
- **Easing per keyframe pair** — defines the curve from this keyframe to the next.
- **Snapshot vs preset reference** — snapshots are inline (heavy timelines = larger JSON), preset refs are by-name links (smaller, but break if the preset is renamed).
- **Loop** — toggle. The playhead wraps to bar 0 at the end. Combine with MIDI sync for a clip-launching workflow.
