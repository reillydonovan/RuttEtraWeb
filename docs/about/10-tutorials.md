## Tutorials

Hands-on lessons, each a few minutes long. Screenshots land here as the
collection grows — for now, every step names the exact control so you
can follow along in the app.

### The interactive walkthrough (Help ▸ Start Tutorial)

The written lessons below are one way in. There's also a guided,
in-app version: **Help ▸ Start Tutorial** dims the interface, spotlights
the control being discussed, and floats a callout with Back / Next /
Exit — 8 steps from picking a source through Z Push, the camera,
modulation, a one-click sample patch, and saving your look. It's opt-in
only; nothing runs it automatically, and the highlighted control stays
fully interactive the whole time (the dim is visual, not a click-guard),
so a step that says "try dragging this" means you actually can, live,
without dismissing anything first. Press Esc or **Exit** anytime.
Re-runnable as many times as you like.

### Tutorial 1 — Make the image breathe with your microphone

Goal: your mic's loudness drives **Z Push** (the depth of the scanline
mesh), so the image physically pulses with sound. Two ways to wire it —
the Patch Bay way (visual, recommended for learning) and the Controls
way (fast once you know the instrument). Both edit the SAME thing: a
Classic modulation slot. The cables in the bay and the dropdowns in the
Modulation panel are two views of one patch — watch them mirror each
other as you go.

**Setup (once)**

1. Load the synth and pick any source on the boot screen — or click
   *continue without video* and enable the Pattern Generator
   (Source → Pattern Generator → Enable) so there's an image to modulate.
2. Turn the mic on: open **CONTROLS → Synth tab → Modulation**, and under
   *Audio Interface (mic)* click **Enable Mic**. Grant the browser
   permission. (Audio analysis is opt-in per session, on purpose —
   the synth never listens by default.)

**The Patch Bay way**

3. Open the bay: **Window ▸ Layout ▸ Patch Bay** (or pick PATCH BAY in
   any window's tab strip / + menu).
4. Find the **SOURCES** bus along the top. Drag the **AUDIO ENV** jack
   down onto **FUNCTION GEN 1's SRC IN** jack. A cable connects — GEN 1's
   little LCD now reads AUDIO, and it switched itself on (plugging a
   cable enables the generator; that's what the gesture means).
5. Drag **GEN 1's OUT** jack onto the **Z Push** jack (DEPTH field, in
   the DCU column). Second cable. The patch is live.
6. Make some noise. The mesh should pump. Too subtle or too wild? GEN 1's
   **AMT** field is the modulation depth — try 0.5 to 2.
7. Open **CONTROLS → Modulation** and look at slot 1: Source = `Audio
   level (mic)`, Target = `Z Push`, exactly what you patched. Change
   either side there and the bay's cables follow. Same patch, two views.

**The Controls way (the same thing, no cables)**

3. **CONTROLS → Synth → Modulation**, slot 1: set **Source** to `Audio
   level (mic)`, **Target** to `Z Push`, **Amount** to `0.8`, and flip
   the slot's enable toggle.

**Why your slider didn't move** — by design. The Z Push slider still
shows the value *you* set; the audio wobble rides on top of it (the
base/live split — see Design Principles). Turn the generator off and
Z Push lands exactly where you left it.

**Where to go from here**

- Any input works the same way: the SOURCES bus also carries **MIDI CC**,
  **CV IN**, and **OSC** jacks. Plug one into a generator's SRC IN, then
  set the specifics (which CC number, which CV channel) in that slot's
  expanded body in the Modulation panel. The I/O tab holds the device
  side (MIDI device, DC-coupled interface, OSC bridge).
- Any parameter works the same way: every labeled jack on the bay — all
  ~90 of them, Camera FOV to Pattern Frequency to CV OUT channels — is a
  valid Target, and the same list backs every Target dropdown.
- Four generators run at once (they're the Classic matrix). For patches
  bigger than four routes — or math between signals — switch the
  Modulation section to **Graph** mode: an unlimited node graph
  (LFOs, audio bands, MIDI, CV, logic, envelopes) with its own editor,
  whose bindings show up in the bay as cyan cables.
