## Performance & Recording

How to keep frames smooth, get the picture you want, and capture the result.

### Projects, Presets, and Timelines

The synth has three save formats at three different scales. Choose based on what you want to keep or share. (See Design Principles — [*Two ways to do something is sometimes correct*](#two-ways).)

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
3. Hardware-output features (CV outputs, sonification, mic input) load their configs but stay disabled — re-enable them explicitly to start producing output. This rule is enforced structurally: the project loader routes settings through `migrateSettings()`, which always forces `cvOutputEnabled = false`, every `cvOutputChannels[].enabled = false`, and `sonification.enabled = false` regardless of the saved value. (See Design Principles — [*The synth doesn't make sound by accident*](#no-accident-sound).)
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

### WebXR — VR and AR headsets

The Rutt/Etra has always been a three-dimensional instrument rendered through a two-dimensional window. WebXR removes that flattening. Connect a headset and you can step inside the mesh — walk around the scanlines, look at the displacement from underneath, see the terrain you've been editing as actual terrain.

The instrument doesn't change in headset. The synth is the same synth; only the rendering surface changes. You continue to edit on your desktop keyboard while wearing the headset, and your edits appear in three dimensions in front of your face in real time.

**Entering a session.** Connect a WebXR-capable headset to a desktop browser (Chrome or Edge — Safari and Firefox have limited support). Open the **XR** section in the control panel. Click **Enter VR** (opaque headset display, mesh in a black void) or **Enter AR** (passthrough cameras showing your physical room with the mesh overlaid). The first session per page load shows a one-shot safety reminder; dismissible per Principle 4.

**Mesh scale** picks the framing. **Tabletop** (default) puts a desk-model-sized mesh 1m in front of you at chest height — comfortable for seated use. **Roomscale** scales up to ~3m × 2m so you can walk through the mesh. **Architectural** scales to ~10m × 6m × 4m — you're dwarfed; stand still and look around (v1 has no teleport).

**Performance** has its own profile (Auto / Quality / Balanced / Battery) separate from your desktop profile, because stereo rendering at headset refresh rate roughly doubles GPU cost. Auto picks based on detected headset. The desktop profile is restored on session end — unless you changed it during the XR session, in which case your new choice is kept and a toast confirms it.

**What stays editable.** Everything. Modulation, timelines, audio analysis, MIDI/OSC/CV, recording — all continue running normally during the XR session because there's only one synth instance. The headset just renders a different camera into the same scene. Alt-tab to your desktop window or reach over to the keyboard to make changes; they appear in the headset immediately.

AR passthrough (on Quest 3, Vision Pro, and other passthrough-capable devices) puts the mesh in your physical room. The scanlines float in your space. The synth becomes part of where you are. (See Design Principles — [*Two ways to do something is sometimes correct*](#two-ways).)

**Ending.** Remove the headset, click **Exit XR**, or hide the tab — the session ends cleanly and the desktop view returns exactly where you left it. Post-processing (bloom, CRT, feedback) is skipped in headset for v1 — the raw mesh in stereo is its own aesthetic and worth experiencing before per-eye postfx returns as a later stage. (See Design Principles — [*Small versions that work*](#small-versions).)

### Recording

- **Format** — Auto, MP4, WebM-VP9, WebM-VP8. Auto picks the highest-quality codec the current browser supports. MP4 is ideal for direct social/media upload; WebM is better for archival.
- **FPS** — 30 / 60. Recording at 60 needs a steady 60fps render — drop to Balanced profile if you see frame drops.
- **Bitrate** — 1 to 50 Mbps. 8 Mbps is broadcast-grade for 1080p; 20 Mbps is over-provisioned and useful for masters.
- **Include mic** — encode the live microphone (or whichever audio input is selected) into the file's audio track.
- **Filename** — auto-generated as `rutt-etra-YYYYMMDD-HHMMSS.<ext>`.

The **Resolution** picker determines recording dimensions. Set Resolution to FHD before clicking Record if you want a 1920×1080 output.

### Stereoscopic 3D recording

The synth records stereoscopic 3D video — the kind that plays back in a VR headset, through red-and-cyan glasses, or on a 3D TV, all from one file. Turn on stereoscopic recording in the Record section, choose how strong you want the 3D effect to be, and record as usual. The output file is wide — twice as wide as your usual recordings — because it carries the left-eye view on one half and the right-eye view on the other.

Uploaded to YouTube, the file is automatically recognized as 3D — the synth tags it for you. Viewers can play it back in whatever mode their device supports: VR for headset users, anaglyph for paper-glasses users, side-by-side for 3D TVs, flat for everyone else. One upload, many ways to watch.

The **IPD** slider controls how strong the 3D effect is. The default 6.3 cm matches average human eye spacing. Smaller values are subtler; larger values exaggerate depth. The synth converts cm to world units based on your mesh size, so the on-screen effect is consistent regardless of how big you've made the mesh.

The **Preview stereo** button switches the main viewport to side-by-side rendering for three seconds so you can check the effect before committing to a take.

If your browser doesn't support MP4 recording (Firefox, older Safari), the synth still records valid side-by-side stereo — as WebM instead of MP4 — and tells you to flag it manually in YouTube Studio's Editor → 3D when you upload. The file still plays in 3D; it just doesn't auto-detect.

Stereoscopic recording is more demanding than normal recording — the synth renders the scene twice for every frame. If you notice slowdown, try dropping to a lower resolution or switching to the Balanced performance profile.

The stereoscopic output doesn't include the postfx effects (bloom, CRT scanlines, feedback) yet — same architectural reason as in headset, and per-eye postfx is a future stage shared between stereo recording and WebXR. For now, the stereoscopic output shows the raw mesh, which is its own kind of beautiful. (See Design Principles — [*Small versions that work*](#small-versions).)

### Timeline recording

The Timeline sequencer (Record panel → Timeline tab) lets you compose a piece by adding **keyframes** at specific bars. Shortening a timeline preserves keyframes past the new end — they're flagged in the editor and don't play, but they reappear if you lengthen the timeline again, so trimming is never destructive. (See Design Principles — [*Saved work is preserved, even when it changes*](#saved-work-preserved).)

Each keyframe is either:

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
