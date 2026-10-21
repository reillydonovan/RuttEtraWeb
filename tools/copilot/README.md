# Look copilot: settings sampler and stills renderer

Step 2 of the look copilot (words in, RuttEtraWeb settings out). This step makes the
training pictures: it samples thousands of looks from the app's real settings space and
renders one still of each through the app itself, deterministically. A later step captions
the stills and trains a model on (caption -> patch).

The settings schema it follows is `S:\projects\ruttetraweb-copilot\schema\SCHEMA.md`
(section 7, "Recommended first set", 39 keys).

## What it does

- **`sample.mjs`** writes N looks as JSONL. Each line is
  `{id, seed, source, stratum, preset, patch}`:
  - `patch`: all 39 first-set keys (relief, raster shape, colour, glow and CRT, view), every
    value inside its Controls-slider range and snapped to the slider step (the range a user
    can reach; where the docs disagree, the slider wins).
  - `stratum`: `exact` (a built-in preset as shipped, about 5%), `near` (a built-in preset,
    perturbed, about 50%) or `broad` (every key from its prior, the rest).
  - `seed`: the app's render seed for this still (offline mode's seeded chance).
  - `source`: the picture the look scans (see Sources).
- **`stills.mjs`** renders each sample in ONE headed Chrome running the built app in
  offline mode (`?render=offline`, src/render/offline.ts) and writes `<id>.png` plus a manifest
  line.
- **`contact.mjs`** tiles a stills directory into one contact sheet.

### How the sampler draws (space.mjs)

- **Near a preset:** each numeric key moves with probability 0.35. Log-scale keys move
  multiplicatively (x times e^N(0, 0.3)), the others by N(0, 8% of the range). Switches flip
  with probability 0.1. An enum is redrawn with probability 0.1 and a colour with
  probability 0.2. All 12 presets are used, `default` included.
- **Broad:** log-uniform where the effect is perceptual: zPush (0.08..4), threshold
  (0.005..0.7), contrast, gamma, scanRate and cols (30..600), bloomIntensity,
  scanlineDensity and cameraFov. `1 - feedbackDecay` is log-uniform over 0.001..0.5, so short
  and long trails are equally common. Most shape keys have a spike at their neutral value:
  skip is 0 in 75% of samples, rotation 0 in 70%, spins 0 in 65%, linearity 0 in 60%, and
  hSize/vSize 1 in 50% (otherwise a log-uniform 0.25..2 ratio, mirrored in 15%).
  Backgrounds are dark: black in 15%, near-black tinted in 65%, up to 35% lightness in 20%.
  Tints are saturated mid-light colours.
- **Switches on:** bloom about 55% (broad), scanlines 70%, vignette 65%, feedback 25%, analog
  25%, zInvert 15%. renderMode is wireframe in 20%, and `dots` is never used: the renderer
  draws it exactly like scanlines.
- **Gating:** a value whose switch is off is written at its default. Examples: bloom* with
  bloom off, customTint unless colorMode is phosphorCustom, feedbackDecay with feedback off.
  A value the picture cannot show would be a label the caption cannot support.
- **Determinism:** sample i depends only on `(--seed, i)` and the options. Asking for more
  samples later extends a set and leaves its start unchanged.

`sampler.test.mjs` checks the following: every key of every sample is in range, on its step
and a valid enum; the set is deterministic by seed; gating holds; the strata come out in the
stated proportions; log priors are log-uniform. It also checks the data against the app:
every default against `DEFAULTS`, the 12 presets against `src/ui/presets.ts`, and each
pattern source against the pattern registry. A change in the app therefore fails the test
and cannot skew the samples silently.

### Sources

A still needs a picture. The sources are few and fixed, and each sample records one:

- `pattern:perlin`, `pattern:lissajous`, `pattern:worley` (the three pattern-* presets'
  own settings), `pattern:sinebands`, `pattern:spiral`. All use `patternEnabled`, blend
  `replace` and mix 1, and every parameter of the kind is sent explicitly, because loading
  `patternKind` does not apply that kind's defaults. A perturbed pattern-* preset uses its
  own pattern 60% of the time.
- Images given with `--images a.png,b.jpg` (PNG/JPG). Each is listed by its path and
  sha256 in `<samples>.sources.json`, and `stills.mjs` refuses to run if the file has
  changed since then. An image source also sets `mirrorH: false` (mirrorH defaults on, a
  webcam convention) and `patternEnabled: false`. When images are given, 50% of samples
  use one (`--p-image`).

### How a still is made (offline mode, `__ruttOffline.still`)

1. Every key an earlier still touched goes back to its default, and so does the camera
   transform. The reset is one `settings.patch(presetPatch(...))` and the look is a second
   one, which is how a built-in preset loads. Import JSON is never used. Because there are
   two patches, a switch that stays on (feedback) is turned off and on again, and that
   clears its history.
2. Source settings and the 39-key patch are applied. An unknown or mistyped key throws;
   the app's loader would only drop it with a console warning.
3. The source image is bound (when the source is an image). The seeded chance is reseeded
   with the sample's seed and the post-FX clock is set to zero. A still therefore does not
   depend on the stills rendered before it, and a resumed run renders the same pixels.
4. `--frames` frames are stepped at `--fps` (t = 0 .. (frames-1)/fps) so feedback and decay
   settle. Then the frame is captured: a PNG, the SHA-256 of the raw RGBA pixels, and the
   mean and max luma.

The **performance profile is pinned** for the run (`--profile`, default `quality`) and
recorded in `runs.jsonl`. Otherwise a 768 px window would get `balanced`, which turns
chroma off and halves the bloom render target. Under `quality` the chroma stays at the
app default (on, 0.0025), because chroma is not a first-set key.

## Commands

```sh
npm run build                                   # stills render the BUILT app (dist/)
(cd tools/offline-render && npm install)        # playwright; uses the installed Chrome

node tools/copilot/sample.mjs --n 5000 --seed 1 --out S:/projects/ruttetraweb-copilot/stills/<set>/samples.jsonl \
     --images S:/path/a.png,S:/path/b.jpg
node tools/copilot/stills.mjs --samples S:/projects/ruttetraweb-copilot/stills/<set>/samples.jsonl \
     --out S:/projects/ruttetraweb-copilot/stills/<set>        # --size 768 --frames 45 --fps 30 --profile quality
node tools/copilot/contact.mjs --dir S:/projects/ruttetraweb-copilot/stills/<set>   # contact.png, first 60

npx vitest run tools/copilot src/render/__tests__/offline.test.ts
```

`stills.mjs` resumes: an id already in `manifest.jsonl` is skipped, so the same command can
be rerun after an interruption. To check determinism, render the same samples into two
directories and compare the `sha256` columns of the two manifests.

**GPU:** stills need a real GPU (a software renderer fails the run) and use ANGLE on
OpenGL, which gave bit-identical frames in the offline-render measurement. A long set is a
GPU job: check `nvidia-smi` and what else is on the card first.

## Output layout (planned)

```
S:\projects\ruttetraweb-copilot\stills\<set>\
  samples.jsonl               the looks (sample.mjs)
  samples.jsonl.sources.json  the sources they name: settings, image path + sha256
  000000.png ...              one still per sample id
  manifest.jsonl              {id, sha256, ms, mean, max} per still rendered
  runs.jsonl                  one line per run: GPU, ANGLE, profile, size, frames, fps, app commit
  contact.png                 contact.mjs
```

## Known limits

- **No motion.** Modulation, autoOrbit (pinned off), spin rates and the timeline cannot
  show in a still, so they are not sampled. Motion words ("breathing", "pulsing on the
  kick", "slow drift") need short clips and the modulation template (SCHEMA.md section 7,
  second tier): future work.
- **Patterns animate.** Perlin and Worley drift and the Lissajous figure moves. Each still
  is the picture at t = (frames-1)/fps, the same for every sample, so the look varies and the
  moment does not.
- **Presets are approximate.** The `exact` stratum carries only the first-set keys. Chroma
  stays at its default (classic-1974, sampled-video and wireframe switch it off in the app),
  `aspect` is left out, and the camera mode, lens and saved view of `default` and `diving`
  are not representable. "diving" is therefore its colour and glow seen from the default
  camera.
- **Some samples will be blank or near-blank.** Examples: a high threshold on a dark
  source, zPush 0 with wireframe off, a tiny hSize. They are legitimate looks. The manifest's
  `max` luma marks them (stills.mjs counts those with max < 0.02); the captioning step
  should decide whether to keep them.
- **Second-tier keys** (pattern parameters as look keys, dual raster, Patch Bay routing,
  camera transform, chroma, aspect) are held at their defaults or set by the source.
- **One size per set.** The default is 768x768 at render scale 1. A different size is a
  different set: bloom radius and scanline density read differently at another resolution.
