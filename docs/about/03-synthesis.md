## Synthesis

The core synth: how brightness becomes geometry, what each knob does, and how to dial in a look.

### Sources

- **Webcam** — pick any attached camera from the device dropdown. After granting permission, click **Refresh** to populate device labels (browsers withhold them until permission is granted).
- **Screen capture** — uses `getDisplayMedia` to synthesize a window, tab, or entire display.
- **Video file** — drag a file onto the picker to loop a local video through the effect.
- **Mirror H / Mirror V** — toggles applied before synthesis. Mirror V defaults to ON because the original Rutt/Etra signal feeds top-to-bottom.

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

### Camera

The viewport's 3D camera operates in two modes:

- **Orbit** (default) — drag to rotate around the mesh, scroll/pinch to dolly. Free rotation in all directions. **Reset Up** snaps the vertical axis back without changing position; useful for un-tumbling.
- **Fly** — first-person free-flight. WASD to translate, `Q/E` for vertical, `Shift` to sprint, `Space` for boost.

The **Resolution** dropdown picks a target render frame size: SD / HD / FHD / QHD / 4K, plus Custom and Fit modes (Match window, Fit to window). Recordings inherit this size — set it before clicking Record if you want the file to be exactly 1920×1080.

**FOV / Near / Far** sliders cover the projection envelope. **Reset View** restores the saved default view; **Hard Reset Camera** wipes the saved view too and rebuilds the original Rutt/Etra default.
