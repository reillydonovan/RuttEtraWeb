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

### Two-screen setups

Two independent popouts cover both halves of a "controls here, output there" rig — pop one, the other, or both, depending on which side needs its own window.

**Controls popout.** The **⧉ button** in the panel title bar pops the entire control panel out into its own window. Drag it to your laptop screen, put the main window on the projector — output on one display, controls on the other, zero latency (it's the same page, not a stream). Click **⧈** (or close the popup) to bring the controls home. Because both windows share one live page, every slider, patch, and Learn binding works identically in either — nothing is mirrored or synced, it *is* the same panel.

**Output popout.** The **⛶ button** next to it pops the *render canvas* into its own window instead — for a projector or second display that needs to run seamlessly fullscreen, independent of the browser chrome around your main window. This one genuinely is a stream under the hood (`canvas.captureStream()` feeding a `<video>` element in the popup), but same-process and same-origin — no network hop, no encoding lag, no perceptible delay versus the main canvas.

Inside the output window, its own **fullscreen button** (top-right corner) requests fullscreen *on that window* — press it again (it relabels to "Exit Fullscreen") or hit `Esc` to leave. `F` toggles fullscreen from the keyboard too, scoped to that window. While fullscreen, the button fades out after a moment so nothing overlays the image; moving the mouse anywhere in the window brings it back, and it fades out again once you stop. The main window has its own independent `F` shortcut for putting *itself* fullscreen (browser native), unrelated to the popout.

Notes: global keyboard shortcuts (Ctrl+S and friends) fire in the main window; both popouts are desktop features (touch layouts keep the bottom sheet, and don't offer the output popout); a blocked-popup browser setting means the button quietly does nothing — check the address bar for a blocked-popup indicator; for *remote* second screens — another machine or a tablet — use Share → Broadcast and open the `?view=` link there instead.

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

### Anaglyph 3D viewing

Anaglyph is the classic two-colour 3D format: the left and right eye views are colour-separated and composited onto the canvas using **Dubois matrices** (which preserve colours better than simple red-minus-blue channel splitting). View the result with standard red-cyan glasses.

**Camera → Anaglyph 3D → Enable** switches the canvas. **Eye Sep (cm)** sets the inter-pupillary distance — the default 6.4 cm matches average human IPD; reduce it toward 3–4 cm if depth causes eye strain.

Because the anaglyph output replaces the main canvas, everything that reads from the canvas picks it up automatically:

- **Recording** — the downloaded file is a standard anaglyph video.
- **WHIP streaming** — the anaglyph image is broadcast in real time.
- **Screen sharing / screen capture source** — anaglyph output is shared.

Post-processing (bloom, CRT, feedback) is paused while anaglyph is active — the same trade-off as WebXR — and returns when you disable it. The Eye Sep slider here is independent from the one in the Record panel's Stereoscopic 3D section, so you can tune live viewing and offline rendering separately.

### Timeline recording

The Timeline sequencer lets you compose a piece by adding **scene keyframes** at specific bars. Shortening a timeline preserves keyframes past the new end — they're flagged in the editor and don't play, but they reappear if you lengthen the timeline again, so trimming is never destructive. (See Design Principles — [*Saved work is preserved, even when it changes*](#saved-work-preserved).)

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

The dock is docked at the bottom and **visible by default** on a fresh session — no need to hunt for a hidden panel before your first scene. **HIDE** in the transport collapses it to a thin strip; click that strip (or the mini handle) to bring it back. It's resizable too: drag its free edge (the top edge when docked at the bottom) to change its height (140–600 px, remembered across sessions). The side control panel resizes the same way — drag its inner edge (280–600 px).

The timeline has two composable layers, visually stacked in the dock:

- **SCENES** (the top track, block markers) — full-settings snapshots interpolated over musical time. A scene sets *everything*: the overall structure of the piece. This track has a fixed height — resizing the dock never inflates the scene markers, it reveals more of the lanes below instead, the same fixed-track-height convention Ableton/Logic/Pro Tools use.
- **Automation lanes** (the rows below) — per-parameter curves that ride on top. A lane animates *one knob*.

Conceptually: the scene track is a list of (bar, snapshot) pairs — the playhead advances bar-by-bar and the live Settings is the interpolation of the two surrounding scenes; each enabled lane then adds its evaluated offset to its one parameter.

A note on terminology: this manual (and the panel UI) calls both of these **keyframes**, matching Blender/Resolve/After Effects usage — a *scene* keyframes the whole picture, a *lane point* keyframes one parameter. Internally they're different data structures (a scene is a full settings snapshot; a lane point is one offset value), but from the keyboard and the panel they behave the same way: you park the playhead, you set a value, you've made a keyframe.

The transport's counter (bottom-right of the header, next to the **DISPLAY** dropdown) can show the playhead position four ways: **Bars/Beats** (`bar 4.75 / 16`, the default), **Timecode** (`HH:MM:SS:FF`), **Frames** (a raw running frame count), or **Samples** (a raw running audio-sample count). Only Bars/Beats is real — it's the timeline's actual clock (BPM × beats-per-bar, the same shared `internalBpm` every LFO and clock node reads). The other three are pure reformattings of that same position for editors who think in video or audio terms — **the same convention each medium normally uses**: Timecode reads like a video editor's clock, real elapsed wall-clock time at the chosen rate, not a musical count; Frames is the matching raw frame index. Picking one never changes playback, editing, snapping, or the underlying clock — it's exactly the same distinction Pro Tools' or Ableton's main counter format menu makes. Timecode and Frames add a small **fps** picker (23.976–60, standard editorial rates); Samples adds a **kHz** picker (44.1–96) — both notational references, independent of Record's actual capture FPS or the audio hardware's real sample rate. Every non-Bars/Beats reading appends the bar position as a trailing anchor (`frame 60  ·  bar 1.00`), so a frame or sample count is never disconnected from where the playhead actually sits on the ruler below it — the format picker, rate picker, and readout are also grouped as one unit in the transport, so they wrap together on a narrow dock instead of stranding on separate lines. The ruler's own tick labels track the same **DISPLAY** setting — switch to Timecode or Frames and the ticks along the top of the track relabel to match, so the ruler and the counter always agree about what a given tick means.

**Scenes:**

- **Add scene** — double-click the track, `Ctrl+click`, right-click → *Add scene*, press `K` at the playhead, or drag a preset chip from the Presets panel onto the track.
- **Easing per scene** — defines the curve into that scene from the previous one.
- **Snapshot vs preset reference** — snapshots are inline (heavy timelines = larger JSON), preset refs are by-name links (smaller, but break if the preset is renamed).
- **Loop** — toggle. The playhead wraps to bar 0 at the end. Combine with MIDI sync for a clip-launching workflow.

#### Automation lanes

Two ways to create automation, one place to shape it:

**From the panel (the fast way).** Every modulatable slider carries a small **keyframe diamond** in its top-right corner, next to the modulation dot. It's hidden until a timeline exists, then: hollow and dim = keyable; outlined = this param has a lane; filled and glowing = there's a point exactly at the playhead. Click it to key the param at the playhead — the first click creates the lane, later clicks add or remove points (a toggle). Once a param has points, **◀ ▶ jump arrows** appear flanking the diamond (the Resolve-style keyframe navigator): they seek the playhead to that param's previous/next keyframe without leaving the panel. Right-click the diamond for *Open in timeline* (reveals the lane in the dock), *Remove point at playhead*, or *Remove automation*. Rows with automation get a phosphor tick on their label, so a glance down the panel shows what's animated.

**In the dock (the shaping surface).** Each lane renders as a row under the SCENES track, sharing the same bar ruler and scroll:

- **+ Lane** adds a lane for any modulation target. The lane's curve draws in **absolute values** — the vertical axis is the param's slider range, so the curve reads in the same numbers as the panel knob. A dashed line marks the knob's current **base** value; the curve rides on it and visibly shifts when you move the knob.
- **Add points** by double-clicking (or `Ctrl+click`) anywhere in the row. New points *pin* the curve's current value at that bar — adding a handle never changes the sound/image.
- **Drag points in two dimensions**: horizontal moves the bar (beat-snapped; hold `Alt` for free positioning), vertical changes the value. A tooltip shows `bar · value` while you drag. One drag = one undo step.
- **Right-click a point** to set its easing (linear / easeIn / easeOut / easeInOut / step / hold — the curve into that point) or delete it.
- **The inspector** (right column) shows the selected point's bar, its **value** (the actual param value — matching the panel knob), a `base ± offset` breakdown, and easing, plus lane mute/delete. It tracks edits live in both directions — drag a point and the fields follow; type a value and the curve previews before you commit. Drag the column's left edge to resize it (180–420 px, remembered across sessions).
- **Navigate keyframes** with the `|◀` / `▶|` transport buttons or the `,` / `.` keys: the playhead jumps to the previous/next point of the selected lane (or, with nothing selected, the previous/next event across scenes and all lanes).
- **Mute** (the checkbox on the lane's chip) silences a lane; its target snaps back to the base value the same frame. Muted lanes render dim.

Lane values are **relative offsets**, not absolute values — they sum onto the parameter's base through the same live-value system modulation uses, so a lane composes with LFOs, CV, and the knob itself instead of fighting them. The panel knob itself never edits that base once a lane exists (see auto-key, below) — but change it through any other path (a MIDI/OSC binding, a preset or project load) and the whole curve shifts with it, since every keyframe is anchored relative to that base. Multiple lanes on one parameter sum, matching the summing-amplifier convention everywhere else in the synth.

The panel never makes you do that math, though: while a lane drives a parameter, its slider shows the **actual value at the playhead** (base + lane offset), with the readout and thumb tinted amber to say "the timeline owns this knob right now". Fast modulation that can't be folded into a knob (LFOs, CV, audio) still appears as a small amber **▸ live readout** above the slider.

Dragging the knob follows auto-key rules, the same convention every traditional keyframe editor and DAW uses (Blender/Resolve, Ableton/Pro Tools "write" automation): **once a parameter has a lane at all, every knob edit is keyed.** Parked exactly on an existing keyframe, the edit rewrites that keyframe only. Parked anywhere else on the curve, the edit **auto-creates a new keyframe at the playhead** — every other keyframe on the lane, and the base itself, are left exactly as they were. The base is only ever touched for a parameter that has *no* lane yet — an ordinary, unautomated knob. A full mouse drag collapses into one undo step regardless of how many pixels it crosses.

The lane's vertical scale comes from the parameter's slider range (including any custom range you've set via right-click), so a full-scale sweep always fits the row.

Put together, the panel alone is a complete keyframing workflow without ever opening the dock: click the diamond to key a param, `◀`/`▶` to hop to its previous/next keyframe, drag the knob to adjust the one you landed on. You don't even need the nav arrows — auto-key means moving the playhead to ANY new bar and adjusting the knob plants a fresh keyframe right there, so free scrubbing-and-tweaking works exactly like landing on an existing point. `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) undo and redo from anywhere in the app, not just while hovering the dock, so you're never far from a mistake.

Record-knob-moves (play + write your gestures into a lane) is a planned follow-up. Timelines containing lanes save as timeline format v2; older v1 files load unchanged.
