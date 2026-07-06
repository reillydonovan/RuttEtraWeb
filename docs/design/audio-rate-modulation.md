# Design: Audio-rate modulation (AUDIT item 1)

Status: **design doc only — awaiting owner decision.** No implementation in this run, per plan.

## The problem

The backlog asks for LFOs up to 20,000 Hz. Both modulation engines tick once per render frame (`matrix.tick(dt)` / `graphEngine.tick(dt)` in `main.ts`), so the control-rate Nyquist is ~30 Hz at 60 fps. Raising the LFO slider cap alone produces frame-rate aliasing: a "1 kHz" LFO would render as a pseudo-random ~teens-of-Hz flicker that differs per machine. The v21 Hi range switch (×10) deliberately stops at stroboscopic territory and documents the aliasing; genuine audio-rate needs a different substrate.

## What audio-rate modulation meant on the hardware

On the original Rutt/Etra, an audio-rate oscillator patched into a deflection input didn't read as "fast wobble" — it read as **spatial pattern**. The beam draws the raster serially: row `y` of the frame is drawn at a different instant than row `y+1`, so a 2 kHz sine into vertical deflection paints ~33 full cycles *down the frame* at 60 Hz — stationary or slowly-drifting waves, moiré, and beat frequencies against the scan rate. Audio-rate modulation is a **function of scan time**, and scan time maps to **position within the frame**.

That reframing is the key: at 60 fps this is not a time-series sampling problem (which is unwinnable at control rate) — it's a per-vertex evaluation problem, which the GPU does natively.

## Option A — AudioWorklet oscillator bank (true audio path)

An `AudioWorkletProcessor` runs N oscillators at 48 kHz; each audio block it writes either (a) a downsampled control value (what CV input's worklet already does — still control-rate at the consumer, no help for 20 kHz), or (b) a **per-row buffer**: for each of the mesh's `scanRate` rows, the oscillator value at that row's virtual scan instant, transferred per frame and uploaded as a 1×N `DataTexture` the DCU vertex shader samples per row (exactly how `audioSpectrum` Z-displacement and the Oscilloscope pattern work today).

- **Pros:** one oscillator source usable by visuals AND by CV-out at genuine audio rate (drive a modular oscillator's FM input); phase-continuous across frames; keeps oscillator math out of the shader.
- **Cons:** an AudioContext for something purely visual (needs a user-gesture unlock; the audio safety stack posture questions apply even though no sound is emitted); worklet↔main-thread transfer plumbing per frame; per-row resolution only (columns would need scanRate×cols samples — impractical over the bridge); more moving parts.

## Option B — Scan-time oscillators in the DCU shader (recommended)

Add a small fixed bank (2–4) of "Scan Oscillators" evaluated **inside `ruttEtra.vert.glsl`**. Each has Settings-backed params — `waveform, freqHz (1..20000), amp, phaseDeg, target (hPos | vPos | zPush | intensity), scanAxis` — and the shader computes, per vertex:

```
virtualScanTime = uFrameStartSec + (rowIndex / uRows) * (1 / fps)    // V scan
                + (colIndex / uCols) * (1 / fps / uRows)             // + H term
value = wave(freq * virtualScanTime * 2π + phase) * amp
```

applied additively to the chosen deflection term. A 2 kHz sine then paints ~33 stationary cycles down a 60 fps frame — the faithful result. `uFrameStartSec` advances per frame so slightly-detuned frequencies drift the way hardware beat-frequencies do.

- **Pros:** zero added CPU or transfer cost; exact per-vertex evaluation at any frequency (spatial resolution = mesh resolution, and *spatial* aliasing against `scanRate` is precisely the moiré the hardware showed — the artifact IS the aesthetic); deterministic per frame across machines; no AudioContext, no gesture, no safety-stack questions.
- **Cons:** oscillators live outside the graph engine — they can't be patched *through* graph processors (mitigate: their params are ordinary modulatable Settings keys, so LFOs/CV can sweep `scanOscFreq` — FM by control-rate, the classic usage); the output isn't available as a control signal (mitigate: CPU mirror publishes per-frame `latest/mean` to the signal bus at control rate, same two-paths-one-param-set pattern as `PatternRegistry` compute mirrors); fixed bank size (4 slots — smallest working scope).

## Base/live split integration

Oscillator *parameters* are base values in Settings, modulated through `LiveValuesStore` like every other param (`scanOsc1Freq` etc. join `TARGETS`/`PARAM_DOCS`). The oscillator *output* never exists as a per-frame CPU scalar in Option B — it's evaluated in the shader — so it cannot be (and must not be) written anywhere near Settings. The control-rate mirror published to the signal bus is a read-only tap, identical in role to pattern-output signals.

## Migration plan (when implemented)

One version bump (v23+): `scanOscs: ScanOscConfig[4]` (or flat keys), all defaulting to `amp: 0` (inert). No safety reset needed — purely visual, no hardware or audio output. If Option A is ever added for audio-rate CV-out, it inherits the full CV safety stack (own context, forced-off channels, ramps, clamps) — that half IS output hardware territory.

## Recommendation

**Option B**, 4 slots, as a "Scan Oscillators" group in the DCU panel with a `[Faithful]` lineage badge — it is the closest thing to what the 1973 hardware actually did with audio-rate signals. Revisit Option A only alongside a broader "synth speaks audio out" initiative (it pairs with Sonification's infrastructure, not the modulation engines').

## Open questions for the owner

1. Bank size: 4 scan oscillators enough? (2 mirrors the dual-oscillator hardware setups; 4 gives chords of pattern.)
2. Should scan-osc targets include `intensity` (Z-axis-less "luminance ripple")? Cheap to add, slightly beyond the deflection-only hardware framing.
3. UI home: DCU panel group vs its own section? (DCU group recommended — console-adjacent, faithful tier.)
