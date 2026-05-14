## Performance & Recording

How to keep frames smooth, get the picture you want, and capture the result.

### Projects, Presets, and Timelines

The synth has three save formats at three different scales. Choose based on what you want to keep or share.

**Preset (`.preset.json`)** — a *look*. Saves the DCU controls, modulation patches, color and effects, the camera's default view. Small file, easy to share. Use this when you want to share a visual configuration with someone else or save a single instrument sound.

**Timeline (`.timeline.json`)** — a *score*. Saves a sequence of preset keyframes over musical time, with BPM and sync settings. Used to compose pieces that morph between visual configurations over bars and beats. Loading a timeline brings the keyframes; the preset for "right now" is captured inside the timeline as snapshots, not external references.

**Project (`.synth.json`)** — your *workspace*. Saves everything: the active preset, the current timeline, your MIDI bindings, CV calibrations, sonification configuration, OSC bridges, panel layout, camera position, resolution settings, performance profile. This is the "save your work" format. Use it when you want to come back tomorrow and be exactly where you left off.

Most sessions you'll save as a Project. Presets and Timelines are for sharing — when you've made something you want to give to someone else, export just the preset (or just the timeline) so they can load it without needing your hardware setup or your MIDI bindings.

### Project save/load walkthrough

The Project section sits at the top of the synth tab — it's the first group, above Source.

**Saving a project**

1. Click **Save As…** in the Project section.
2. Enter a name. The file downloads as `{name}.synth.json` (or, on Chromium browsers with the FS Access API, opens a save dialog so you can pick a permanent location).
3. The title bar updates to show `{Project Name} — RUTT/ETRA`.
4. Subsequent **Save** clicks (or `Ctrl+S`) write back to the same file without prompting.

When unsaved changes exist, the title bar appends an asterisk: `{Project Name} *`. The asterisk clears the moment you save.

**Opening a project**

1. Click **Open…** (or press `Ctrl+O`), pick a `.synth.json` file.
2. The synth restores the preset, timeline, bindings, configurations, and layout.
3. Hardware-output features (CV outputs, sonification, mic input) load their configs but stay disabled — re-enable them explicitly to start producing output. This rule is enforced structurally: the project loader routes settings through `migrateSettings()`, which always forces `cvOutputEnabled = false`, every `cvOutputChannels[].enabled = false`, and `sonification.enabled = false` regardless of the saved value.
4. A toast summarizes what was restored: *Loaded "Session 1" — 3 MIDI bindings, 2 CV channels (disabled), sonification ready (disabled), 8 timeline keyframes.*

**Auto-save and recovery**

Toggle **Auto-save every 60 s** in the Project section to write the current project to browser storage every minute when there are unsaved changes. If your tab crashes or you accidentally close, the next page load offers to recover. Auto-save is a safety net, not a primary save — explicit Save to file is still how you preserve work permanently.

**Recent Projects**

The Project section lists the last 8 projects opened. On Chromium browsers (Chrome, Edge, Brave, Opera), recent projects re-open in one click thanks to persistent file handles from the FS Access API. On Firefox and Safari, the list shows project names but you'll need to re-pick the file because the Web platform doesn't expose persistent file paths on those engines.

**Sharing vs preserving**

A common workflow: you build something good in a Project. You want to share the look but not your MIDI setup. From the current project, click **Save preset from project (.preset.json)** — exports just the preset portion as a `.preset.json` that anyone can load without needing your hardware. The project file stays on your machine; only the preset goes out.

**First-launch recovery**

The very first time you load the synth after the Project feature shipped, if pre-Project state exists in browser storage (a saved preset, user presets, or timelines), the synth packages all of it into a Project named "Recovered Session" and offers to restore it. One-shot — subsequent loads don't re-create it. If you decline, the snapshot is discarded; if you accept, save it to file with **Save As…** to preserve permanently.

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
