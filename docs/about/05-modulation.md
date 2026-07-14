## Modulation

The synth has two parallel modulation engines. Pick one, or run **Both**. They sum into the same parameter targets.

### Classic vs Graph — when to use each

| | Classic | Graph |
|---|---|---|
| Best for | Simple modulation, DAW-style workflow | Complex patches, video CVs, signal processing |
| Slots / nodes | 4 slots (extendable) | Unlimited |
| Sources | LFO, Ramp, Audio (envelope), Audio Band, Beat, Joystick, Constant, MIDI CC/Note/Velocity/Clock, OSC, CV input (audio / OSC), Gamepad | All Classic sources + audio bands, audio pitch, audio onset, video luma / motion / color / edge, dedicated processor and logic nodes |
| Processors | Inline per patch (Curve, Range, Offset, Polarity) | All inline controls PLUS dedicated processor / logic nodes (mixer, multiplier, crossfade, slew, comparator, sequencer, sample-and-hold, etc.) |
| Output | Direct to param (or `cv:N` for CV out) | Output node (= a Settings binding) with the same inline controls as Classic; or dedicated `cv-output` sink node |
| Mobile | Fully usable — every control inline | Beginner view fully usable; the advanced node editor is desktop-only |

If you're patching three knobs to a few LFOs, use **Classic**. If you're routing the brightness of one corner of a webcam frame through a slew limiter into the bloom amount, use **Graph**. **Both** lets you split: a Classic slot drives Z Push while a Graph patch drives Color Hue, neither stepping on the other.

### The base/live split (v9 architecture)

Every modulation engine operates on a **base + mod** principle. The slider you turn is the **base** value. The renderer reads a **live** value computed each frame as `base + sum(active modulations)`. When a patch is disabled, deleted, or its source goes quiet, the contribution drops to zero immediately and the live value snaps back to base — no stuck parameters, no lingering offsets. (See Design Principles — [*Modulation doesn't overwrite your knobs*](#modulation-knobs).)

Per-patch reset (↻ icon) zeros out a single patch's contribution. The global **Reset Mod** button mutes every patch's Amount in one tick — a panic button for when a tangled routing has gotten away from you.

### Classic mode — patch row anatomy

Each row in the Classic matrix is a complete patch. Walk through one end-to-end:

1. **Source dropdown** — pick LFO (sine / triangle / square / saw / pulse), Ramp (up / down / triangle / hold), Audio (envelope), Audio Band [n], Beat, MIDI CC/Note/Velocity/Clock, OSC, Joystick X/Y/Z, Constant, CV Input (audio), CV Input (OSC), Gamepad Axis, Gamepad Button.
2. **▼ Expand** — opens source-specific controls below the row.
3. For an **LFO**: Rate, Shape, Phase, Duty (square/pulse only), Depth, Sync (Free/MIDI/Tempo), **Retrigger** button, Polarity (bipolar / unipolar).
4. **Output stage** (every source) — **Apply** mode (Additive sums an offset; Multiplicative contributes a `1 + value×amount` factor — the patched-multiplier idiom; live = (base + offsets) × factors), Curve (Linear / Exp / Log / S / Step), Range Min / Max, Offset, Invert, and **Slew ↑/↓** glide times (Classic only; 0 ms = off). Slew smooths the post-curve value — pair the Step curve with a 200 ms slew for a portamento staircase. In Graph mode, insert a Slew node instead; both use the same exponential math.
5. **Amount** — master level. Classic Amount range is ±5; Graph Amount range is ±20 (extreme for parameter sweeps).
6. **Target** — the parameter this patch modulates. CV-output channels appear here too as `CV Out: Ch N`.
7. **Copy / Paste / Reset / Delete** icon row at the right edge of the patch header.

#### Common Classic patches

- **Sine at 0.5 Hz → Z Push** — gentle breathing of the depth field.
- **Triangle at 4 Hz → Bloom Intensity** — flicker / strobe.
- **Square at 2 Hz with Sync MIDI 1/4 → Scan Rate** — beat-synced scanline density.
- **Audio (envelope) → Intensity, attack 5ms, release 200ms** — beam responds to track loudness.
- **Joystick X → Camera Yaw, smoothing 80ms** — pad performance over time.
- **Beat → Scan Rate (step output)** — every detected onset jumps to a new scanline density.

### Graph mode — patcher concepts

Graph mode is a signal-flow patcher modeled directly on the original Rutt/Etra's voltage-control philosophy. Sources drive other sources, processors shape signals, and bindings deliver results to Settings parameters.

- **Beginner view** — same expandable rows as Classic, but each row maps under the hood to a source node + a binding (= an Output node). Add / remove rows to add / remove bindings.
- **Advanced view** — the full node graph canvas with palette, Probe tool, Library, and inspector. **Drag from an output jack to an input jack** — a rubber-band cable follows the cursor (click-then-click still works too). Multi-output nodes (Sync's pulse/phase, and any future ones) connect **per port**. **Wheel zooms** (anchored on the cursor, 0.4×–2.5×), **drag empty canvas to pan**. Right-click a node for context actions; Esc cancels a half-made cable.
- **Library** — built-in starter patches: *Getting Started — Breathing Z Push*, *Annotated: Audio-Reactive Bloom*, Audio Ring Mod, Video Brightness Tracking, Beat-Synced Step Sequencer, Motion-Triggered Glitch, Slewed Pitch Follow, Reactive Crossfade, Edge-Driven Focus. The first two ship with a **Note** node explaining themselves. Below them, **My Patches**: name the current graph and Save to keep your own copies (same name overwrites); click a card to load, × to delete. Saved patches live in this browser's local storage — the *active* patch still travels inside Presets and Projects as before. Every starter patch is also reachable without opening the panel: **File ▸ Load Sample Patch** in the top menu bar.
- **Notes** — a Meta-category node with no inputs, outputs, or signal effect: just a free-text box, typed directly into the node on the canvas, for documenting what a patch does. Drop one from the palette any time; it never affects playback.
- **Mute without deleting** — every node has an **enabled** checkbox in the inspector (muted nodes dim on the canvas and output silence downstream), and each binding row has its own enable checkbox. A muted binding's target snaps back to its base value instantly — same no-stickiness rule as everything else in the modulation system.
- **Probe** — click any node output port to read its live value in the inspector. Essential for debugging tangled patches.
- **Convert to Graph** — at the bottom of the Classic body, a button that builds an equivalent graph patch from the current Classic slots and switches you to Graph mode. Use it as a starting point when a Classic patch has outgrown its inline controls.

The full **Node Catalog** is auto-generated in the Reference section below, with every node's inputs, outputs, params, and description. New nodes appear there as soon as they're added to the source tree.

Two additions round out the classic voltage-control trio (v22): **Envelope (ADSR)** — a true gate-triggered attack/decay/sustain/release generator (feed it a Beat pulse, comparator, or Sync (V) pulse and shape any parameter like a VCA), and **Filter (LP/HP/BP)** — a control-rate resonant state-variable filter for smoothing, wiggle-isolating, or ringing a signal around a cutoff. With oscillators, envelopes, filters, and multipliers all patchable, "anything that can modify sound can also modify image."

### Video as control signal

The synth's own video input is itself a CV source. Four nodes pull control signals from the picture:

- **video-luma** — average brightness over a region rectangle. Drive Focus to make the synth lock when the room gets dark.
- **video-motion** — frame-to-frame absolute difference. Drive Bloom to flash on movement.
- **video-color** — average HSV in a region. Drive Color Hue to match the dominant color of an area.
- **video-edge** — Sobel edge density. Drive Glitch to fire when edge content spikes.

Each node has a region picker (x / y / w / h, normalized 0..1). The Library's "Edge-Driven Focus" patch is a complete worked example.

### Shared internal BPM

The BPM at the top of the Modulation panel is shared across:

- Classic LFO patches in **Tempo** sync mode
- Graph **Clock** node in `internal` mode
- Timeline sequencer in `internal` sync mode

One BPM field drives all three — change it in one place and every tempo-locked source moves with it. (See Design Principles — [*One concept, one place to set it*](#one-concept).)

In **MIDI** sync mode, all three follow incoming MIDI clock pulses. There is **no silent fallback** if MIDI is selected but the clock disconnects — the LFOs hold at the last received tempo and the panel's "no clock" indicator lights up. This is intentional: silent fallback to internal BPM has bitten too many performers mid-show. (See Design Principles — [*The synth tells you what's wrong, instead of hiding it*](#tells-you-whats-wrong).)

### Worked examples

#### 1. Make the scanlines pulse with the music

Classic: `Audio (envelope)` → `Z Push`, attack 5ms, release 250ms, output Range 0..1, Amount 1.5. Adjust **Audio Floor** in the I/O → Audio panel until quiet rooms don't kick the scanlines. The `5ms / 250ms` shape gives you a fast attack on each kick / snare with a long musical decay.

#### 2. The bright corner of the room controls the focus

Graph (Beginner): add a `video-luma` source, set its region to the top-right quarter (`x=0.5 y=0 w=0.5 h=0.5`). Output Range 0..1, Invert ON. Target `Focus`. Now when that corner is bright, the focus stays sharp; when it's shaded, focus softens. (`Edge-Driven Focus` in the Library is a stronger version using `video-edge`.)

#### 3. Beat-synced step sequencer through 8 different colors

Graph: `clock` → `clock-divider /4` → `sequencer` (8 steps, each step a different value 0..1). Bind `sequencer.out` to `Color Hue`, output Curve Linear, Amount 1. Set the Clock node's source to `midi`, and start a MIDI clock from your DAW. The hue cycles through eight chosen colors, locked to the bar.
