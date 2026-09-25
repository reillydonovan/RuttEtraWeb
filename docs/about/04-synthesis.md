## Synthesis

The core synth: how brightness becomes geometry, what each knob does, and how to dial in a look.

### Sources

- **Webcam** — pick any attached camera from the device dropdown. After granting permission, click **Refresh** to populate device labels (browsers withhold them until permission is granted).
- **Screen capture** — uses `getDisplayMedia` to synthesize a window, tab, or entire display.
- **Video file** — drag a file onto the picker to loop a local video through the effect.
- **Mirror H / Mirror V** — toggles applied before synthesis. Mirror V defaults to ON because the original Rutt/Etra signal feeds top-to-bottom.

### Pattern Generator (synthesized source)

The Pattern Generator is a built-in "video signal" — a fragment shader that paints a synthesized image into an offscreen texture, then feeds it through the DCU exactly the way a webcam frame would. It is a *layer* parallel to the video source, not a replacement: webcam / screen / file stay selected as before, and a separate **Enable** toggle (styled identically to **Mirror H** / **Mirror V**) flips the pattern pipeline on. When OFF, the live `VideoTexture` feeds the DCU directly with zero added GPU cost. (See Design Principles — [*The structure matches how you think about it*](#matches-how-you-think).)

Conceptually:

- `sourceKind` (webcam / file / screen / none) drives the **video layer**.
- `patternEnabled` gates the **pattern layer**, which is rendered to its own offscreen render target.
- `patternBlendMode` + `patternMix` describe how the two layers combine. The composited result then becomes the DCU's `uVideo` input — every existing knob, every modulation slot, every PostFX pass works on it identically to webcam input.

This is the historically-faithful version of the Rutt/Etra "internal signal generator". The 1974 hardware was famously a hijacked oscilloscope, so the most period-correct way to use this synth without a camera is to feed it a synthesized signal and let the DCU do its work.

#### Pattern catalog

Patterns are grouped into four families:

- **Calibration** — *Solid*, *Gradient*, *Bars*, *Grid*, *Checkerboard*. Useful for verifying linearity and Z Push response with a clean signal.
- **Waveform** — *Sine Bands*, *Triangle Bands*, *Saw Bands*, *Square Bands*, *Pulse Bands* (with duty-cycle Thickness), *Lissajous* (XY oscillator trace), *Spiral* (radial sweep). Modulating frequency or phase animates these.
- **Noise** — *White Noise* (uncorrelated per-pixel), *Perlin Noise* (smooth fBm with octave control), *Worley Noise* (cellular blobs).
- **Oscilloscope** — renders an arbitrary signal as a phosphor scope trace.

Switching `Kind` resets only the parameters that pattern actually uses to its defaults; cross-pattern controls (Mix, blend mode) keep their current values, so an LFO patched on Mix stays alive across kind changes.

#### Modulation

Every numeric pattern parameter (Frequency, Brightness, Contrast, Phase, Scale, Thickness, Density, Lissajous Freq Ratio, Spiral Arms, Perlin Octaves, Worley Point Density, Mix, Scope Sweep / Trigger / Persist / Thickness) is a first-class **ModTarget**. They show up in the Classic slot's Target dropdown and the Graph engine's `cv-output` target list under the **Pattern:** prefix. The base/live value separation in `LiveValuesStore` applies as usual — an LFO writes an additive offset, the slider keeps showing the *base* value, and the renderer reads `getLive()` each frame.

The small **+** button next to each pattern parameter slider creates a sine LFO already targeted at that param: it scans the modulation slot list, finds the first slot that is disabled or pointing at `none`, sets it to `source: 'sine', target: <param>, amount: 0.25`, and expands the slot's UI in the Modulation panel so you can keep tweaking.

#### Compositing

`patternBlendMode` is a discrete dropdown with eight modes:

| Mode         | Math                                  | Use                                                                 |
|--------------|---------------------------------------|---------------------------------------------------------------------|
| Replace      | pattern only                          | Pattern *is* the input. Set `sourceKind = none` for a pure synth.   |
| Add          | `v + p·mix`                           | Add bright structure on top of footage.                             |
| Subtract     | `v − p·mix`                           | Subtract a pattern as a luminance mask.                             |
| Multiply     | `mix(v, v·p, mix)`                    | Modulate camera brightness with a pattern (vignette, gates).        |
| Screen       | `mix(v, 1 − (1−v)(1−p), mix)`         | Light-only blend; never darkens.                                    |
| Difference   | `mix(v, |v−p|, mix)`                  | Edge / fold artifacts.                                              |
| Mask         | `v · lerp(1, lum(p), mix)`            | Use pattern luminance as a key on the video.                        |
| Crossfade    | `mix(v, p, mix)`                      | Clean A/B fade between video and pattern.                           |

`patternMix` (`0..1`, modulatable) is a wet/dry on the blended result, so even Replace mode honors a Mix sweep — handy for ducking the pattern in and out at tempo.

#### Oscilloscope mode in detail

The Oscilloscope kind expects a one-dimensional signal sampled into a circular buffer. The buffer is uploaded as a 1D `DataTexture` and rendered as a beam trace in the fragment shader, with optional phosphor decay (a feedback render-target accumulator).

- **Source kind** picks where samples come from: live audio time-domain, a Classic mod-matrix slot value, a Graph node port, an arbitrary numeric Settings key (read through `LiveValuesStore` so modulation appears in the trace), or BeatDetector pulses.
- **Source ref** is the sub-selector. For Audio it's ignored; for Classic Slot it's a 1-based slot number; for Graph Node it's `<nodeId>:<port>` (default port `out`); for Settings Param it's any numeric Settings key, e.g. `zPush`.
- **Sweep** controls how many buffer windows fit on screen — values >1 compress time; values <1 zoom in.
- **Trigger** is a rising-edge alignment threshold. Set to 0 to disable; non-zero values realign the displayed window so the trace stays visually stable on periodic signals.
- **Persist** is the phosphor decay between 0 and 0.99. Higher = longer trail.
- **Thickness** is the beam half-width in pixels; **Beam Hue** picks an HSV hue at full saturation (default 0.33 ≈ phosphor green).

Because the scope output then feeds the DCU, **scoping a signal also drives the Z displacement along the shape of that signal**. Audio waveforms become a vibrating raster; an LFO becomes a slow undulating ridge; a Graph clock pulse becomes a marching square wave of geometry. This is recursive Rutt/Etra video synthesis: the original 1974 patch.

#### Pattern outputs (signals back into the modulation system)

Every pattern publishes its internal control signals to a small per-frame value bus. These signals appear as **first-class modulation sources** alongside LFOs, audio envelopes, joystick, MIDI, and CV inputs.

The two paths — visible pattern (a fragment shader) and published signal (a small JS function) — share the *same parameter state*. A single Frequency knob feeds both the shader's `uFrequency` uniform and the CPU mirror's `time * frequency * 2π + phase` argument. Modulating Frequency moves the visible bands and the wave output in lockstep, by construction.

Catalog of published signals:

| Pattern              | Signal     | Range  | Description                                                                  |
|----------------------|------------|--------|------------------------------------------------------------------------------|
| Gradient             | `ramp`     | -1..1  | `sin(phase)` — slow rotation of the gradient direction.                      |
| Sine Bands           | `wave`     | -1..1  | `sin(time * frequency * 2π + phase)`.                                        |
| Triangle Bands       | `wave`     | -1..1  | Triangle wave at the configured frequency.                                   |
| Saw Bands            | `wave`     | -1..1  | Sawtooth wave at the configured frequency.                                   |
| Square Bands         | `wave`     | -1..1  | 50% duty bipolar square wave.                                                |
| Pulse Bands          | `wave`     | -1..1  | Bipolar pulse at the configured frequency; Thickness controls duty.          |
| Lissajous            | `x`        | -1..1  | `sin(time * frequency)` — the X oscillator drawing the curve.                |
| Lissajous            | `y`        | -1..1  | `sin(time * frequency * freqRatio + phaseOffset)` — the Y oscillator.        |
| Spiral               | `phase`    | -1..1  | `sin(uPhase)` — useful for syncing rotation-aware modulation to the visual.  |
| Oscilloscope         | `latest`   | -1..1  | Most recent sample written to the scope buffer.                              |
| Oscilloscope         | `mean`     | -1..1  | Running mean of the visible scope window.                                    |
| Oscilloscope         | `peak`     | 0..1   | Running peak absolute sample. Fast-attack envelope follower.                 |
| Oscilloscope         | `trigger`  | 0..1   | One-frame pulse (1.0) on rising-edge crossings, else 0.                      |

Three places they show up:

- **Classic mode source dropdown** — every signal is a top-level option in a `Pattern Outputs` group: pick **Pattern: Lissajous X**, route it to `Z Push`, watch Z Push wobble in lockstep with the visible curve.
- **Graph mode** — drop in a **Pattern Output** node, pick a signal from its dropdown, and wire it through the rest of the graph. A `pattern-output → slew → cv-output(BloomIntensity)` chain makes bloom smoothly follow whatever you're scoping.
- **CV out** — a per-channel **Pattern output** source kind sends the signal as voltage. An external hardware oscilloscope plugged into channel 2 then displays the same Lissajous X the synth's visual layer is drawing.

The pattern's CPU mirror runs once per frame in `PatternRenderer.tick()`, after the visible frame is rendered, so consumers see one-frame-old values — same one-frame latency every other inter-tick boundary in the engine has. When the pattern is disabled or the user picks a different pattern, the bus is cleared so stale signals can't keep driving slots that targeted them.

#### Common patches

- **Audio-reactive sine bands.** Source `Sine Bands`, then Classic slot 1: source `audio-band`, target `Pattern: Frequency`, amount `0.6`. Tap the **+** next to Frequency for a starting point. Set the band index in the slot's expanded body to a kick band; clap-band gives nicer mid-frequency wobble.
- **Recursive scope-of-LFO.** Source `Oscilloscope`, scope source `Classic Slot`, ref `1`. Slot 1: source `triangle`, target `none`, amount `1`. The slot itself doesn't drive a target; it just provides a value the scope samples each frame. Modulate slot 1's frequency from another slot for tempo-locked Z-displacement.
- **Perlin-noise crossfade with motion.** Source `Perlin Noise`, blend `Crossfade`, mix `0.5`. Patch a Graph **video-motion** node into a `cv-output` node targeting `Pattern: Mix`. Now the camera detects motion → the pattern fades in over the live video, generative feedback that responds to movement.

### Display Control Unit (DCU)

Every knob from the original Rutt Electrophysics brochure, grouped as in the panel UI.

#### Position & Size

- **H Position / V Position** — translate the displaced mesh in 2D screen space.
- **H Size / V Size** — bipolar sliders. Positive scales out from center; negative inverts (mirrors) along that axis.
- **Aspect** — pinch the H/V scale together, useful for matching non-square sources or stylizing into a tall/narrow look.

#### Depth

- **Z Push** — the main knob. How dramatically brighter pixels lift out of the scanline plane. At `0`, the mesh is flat. At `+1.0` you can clearly see the brightness terrain. At `+5.0` bright pixels punch nearly off-screen — useful for high-contrast inputs. Negative values invert (bright pixels recess instead of rise).
- **Z Bias** — DC offset on the entire depth field. Pushes the whole mesh forward or back relative to the camera.
- **Z Invert** — flip the polarity in one click without touching Z Push.

#### Beam

- **Intensity** — line brightness, multiplicative on the rendered scanline color.
- **Focus** — `0` = sharp single-pixel scanlines, `1.0` = soft 5-tap blur for a glow / out-of-focus CRT look. Mid values are most period-correct.

#### Rotation

- **H Center / V Center** — pivot point for spin / position. Move it before spinning to orbit around a corner.
- **H Spin / V Spin** — manual rotation (radians).
- **H Spin Rate / V Spin Rate** — auto-rotation speed. The mesh spins continuously; combine with damped LFO modulation for tumbling.
- **H Reverse / V Reverse** — flip handedness on each spin axis without changing magnitude.
- **Display 0° / 90°** — discrete flip equivalent to swapping the original hardware's 90° toggle.
- **Rotation** — continuous in-plane rotation in degrees (knob + switch, exactly like the hardware's rotation control: the knob composes on top of the 0/90 switch, pivoting on H/V Center). Modulatable — an LFO here gives a slow tumble; CV in gives voltage-controlled rotation.

**Collapse the scan**: H Size and V Size both pass through zero — dial either to `0` to collapse the raster to a line, or both for a point. This is the faithful "zoom to zero" gesture (the deflection dies, not the camera).

#### Dual Raster

The **Dual Raster** section adds a second (and optionally a third) independently modulated raster fed by the same video signal — a dual-trace scope on the bench:

- **Wipe mode** — the **Trace** slider splits the frame: fully down = all raster A, fully up = all raster B, anywhere between = B on top, A below, both at full resolution with independent controls. Trace position is modulatable (`Dual: Trace Position` in any Target dropdown) — sweep it with an LFO or CV for a live wipe.
- **Alternate lines** — rasters interleave row-by-row (half vertical resolution each); the slider doesn't apply.
- Raster B has its own position, size, Z push/bias, intensity, rotation/spin, linearity, and luminance shaping — every one a `B: …` modulation target. Scan rate/columns, mirrors, and color mode are shared with A.
- **Rasters: 2 or 3** — set **Rasters** to 3 to add a third raster, C, with the same full set of controls (`C: …` modulation targets). In wipe mode a second slider, **Trace 2**, sets how much of the top of the frame C takes (0 = no C), so the frame reads A at the bottom, B in the middle, C on top. Where Trace 2 overlaps Trace, C wins. In alternate mode rows cycle A, B, C, a third of the vertical resolution each. `Dual: Trace 2 Position` is modulatable like Trace.
- **Identify** — tints rasters A / B / C green / cyan / amber on screen so you can see which lines belong to which raster while you set up. It's a setup aid only: it isn't saved with your session, presets or projects, and it switches itself off while you record, stream (PeerJS or WHIP), pop out the render window, run a WebXR session, or take an MCP screenshot, then comes back when that stops.
- **Two independent video sources, via the Patch Bay** — by default both rasters display the same video signal (this toggle just adds a second independently-modulated *geometry*). To feed them genuinely different footage, patch it in the Patch Bay: a **DUAL RASTER** node takes two video inputs, three with Rasters set to 3 (drag Video Source A/B or the Composite node's output onto its A/B/C jacks) and its OUT feeds the **RENDERER** module — wiring that connection enables this toggle for you automatically, the same way patching a graph cable wakes the modulation engine.

When the toggle is off, nothing about the classic single-raster path changes — no extra draw call, no shader work.

#### Scan

- **Scan Rate** — the count of horizontal scanlines drawn per frame. `100` is sparse and graphic; `480` is video-rate; `1080` and up shifts into a thick mesh look.
- **Cols** — samples per row (vertices per scanline). Trade-off between geometry detail and GPU load.
- **Skip / Underscan** — drop a fraction of scanlines for a slatted blinds effect, or expand the safe area to crop edges.

#### Linearity

- **H Linearity / V Linearity** — pin-cushion (`>0`) and barrel (`<0`) bow on each axis. Subtle at ±0.2; aggressive past ±0.8.

#### Luminance

- **Threshold** — gate. Any pixel below this brightness becomes pure black (no scanline drawn). Use to key out backgrounds.
- **Contrast** — multiplicative on luminance before depth mapping.
- **Gamma** — exponent on luminance. `1.0` = linear. `<1` boosts shadows; `>1` boosts highlights.

### Color & Post-FX

The **Color / Post FX** section shapes the rendered scanlines after synthesis — the "monitor" half of the instrument, where the DCU's geometry picks up its phosphor.

- **Color mode** — Grayscale, Phosphor Green (P1), Phosphor Amber, Custom Tint, or Sampled Video (each scanline keeps the color of the pixels it sampled).
- **Background** — the clear color behind the mesh.
- **Bloom** — intensity / radius / threshold. Off by default so raw scanlines stay crisp; raise Intensity for the classic phosphor glow.
- **Scanline overlay** — a CRT shadow-line texture over the final image, with intensity and density controls.
- **Chromatic aberration** — radial RGB split, strongest toward the frame edges.
- **Vignette** — edge darkening.

#### Burn-In Feedback

An accumulation buffer that keeps the brightest value each frame and decays it over time — the long-exposure phosphor-trail look of an aging CRT. **Decay** sets the trail length as a half-life: `0.9` ≈ 0.1 s, `0.99` ≈ 1 s, `0.999` ≈ 11 s. Trails genuinely compound — hold a bright shape still and it burns in; move it and it drags a fading ghost.

**Shape masking** confines the burn-in to a region of the frame:

- **Shape** — *Full frame*, *Circle*, or *Box*.
- **Shape X / Shape Y** — the region's center. Both are modulation targets — patch two LFOs at slightly different rates and the feedback zone orbits the frame.
- **Radius** — region size.
- **Softness** — edge feather. `0` is a hard matte edge; higher values melt the region boundary into the clean image.

Outside the shape the image stays clean, so you can burn a halo into the middle of the frame while the edges keep tracking the live video.

#### Analog Character

A wear layer in the CRT pass — the imperfections of a real analog signal chain. Off by default and costs nothing until enabled:

- **Noise** — per-pixel video grain.
- **Dropout** — sparse one-frame horizontal tears, like a worn tape.
- **Hum Bar** — a slow-rolling horizontal brightness band, the classic ground-loop artifact.

All three amounts are modulation targets: drive Dropout from an audio band and the tape damage lands on the kick.

### Camera

Switch modes from the **Camera panel → Mode dropdown** (top of the panel).

The viewport's 3D camera operates in two modes:

- **Orbit** (default) — drag to rotate around the mesh, scroll/pinch to dolly. Free rotation in all directions. **Reset Up** snaps the vertical axis back without changing position; useful for un-tumbling after going over the poles.
- **Fly** — first-person free-flight. Click the canvas to capture the pointer, then: `WASD` to translate, `Q / E` for vertical, `Shift` to sprint, `Space` for boost. Move the mouse to aim. Click again or press `Esc` to release pointer lock. *Not available on touch/mobile — the Mode dropdown hides the Fly option on those devices.*

The **Resolution** dropdown picks a target render frame size: SD / HD / FHD / QHD / 4K, plus Custom and Fit modes (Match window, Fit to window). Recordings inherit this size — set it before clicking Record if you want the file to be exactly 1920×1080.

**FOV / Near / Far** sliders cover the projection envelope. **Reset View** restores the saved default view; **Hard Reset Camera** wipes the saved view too and rebuilds the original Rutt/Etra default.
