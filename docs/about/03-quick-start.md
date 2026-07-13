## Quick Start

The shortest path to your first scanline mesh. Each step is one short action.

1. On the boot overlay, choose a source: **WEBCAM**, **SCREEN**, **FILE**, or **STREAM URL** — or click **continue without video** to use the Pattern Generator alone. Grant camera access if prompted. If the site operator has deployed a sample video, a **Load Sample Video** button is also available in Source → Video File.
2. Open the **Presets** panel and click **Phosphor Green** to load a starting look.
3. Drag inside the viewport — your cursor rotates the camera around the scanline mesh.
4. Open the **DCU** panel and adjust **Z Push**. The scanlines lift and fall as you turn it.
5. Open **Modulation** and add a patch: Source = `LFO (Sine)`, Target = `Z Push`, Amount = `0.5`. Watch the scanlines pulse.
6. Open **Record → Start Recording**. Stop when ready. The file downloads to your machine.

That's the whole synth. Everything below is the rest of what it can do.

**Slider tricks** — every numeric control accepts typed input in the box beside the slider; double-click (or double-tap) resets to default; arrow keys nudge by one step. The small **▾ at the top-left of every slider** opens its value & range menu: set a **custom range** (a min/max clamp — widen a slider up to 5× its stock span past either bound for extra headroom, or narrow it into a fine-tuning vernier), reset the range, or reset the value. **Right-clicking the slider** (or tapping its readout on touch) opens the same precise-entry panel directly. Custom ranges persist with your project; the ▾ and number box glow while one is active.

**Hover tooltips** — hold the mouse still over any parameter row or section header for about half a second and a short description pops up above it, explaining what that control does. Move the mouse away and it disappears immediately. This is the same text that drives the in-app Help's Controls tab and this manual's Param Reference — one description, everywhere it's needed. Mouse only (there's no hover state to speak of on touch); nothing to turn on or off.

**Panel skins** — the **skin picker** in the panel title bar (CRT / HW / RACK) switches between three looks. **CRT** is the flat original. **HW** swaps every control for skeuomorphic hardware: rotary knobs (drag vertically to turn; hold `Shift` for fine control; double-click to reset), bat switches with LED lenses, and LCD readouts (click one for precise entry, same as right-clicking). **RACK** adds full modular chrome on top — sections become rack modules with faceplate screws, every modulatable knob grows a 3.5mm input jack, and your actual modulation routings render as live patch cables: green cables from the Classic matrix's slot output jacks (drag in either direction — from a slot's output jack to a param's input jack, or from an empty input jack back to a slot; drop a plugged cable in space to unplug — this edits the slot's Target exactly like the dropdown does), cyan cables for Graph-engine bindings (edit those in the graph editor). A cable into a collapsed section plugs into that section's header, so nothing vanishes off-screen. Same parameters, same values in every skin — only the faces change, and every slider trick above still works. The skin choice is remembered on this machine, not in your presets or projects, and touch layouts keep their touch-friendly controls regardless.
