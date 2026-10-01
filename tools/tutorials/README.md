# Video tutorials

Generates the narrated video course shown on `tutorials.html`
(**Help ▸ Video Tutorials** in the app). Each lesson is a Playwright tour of
the real app in headed Chrome (real GPU), narrated with Kokoro TTS, captioned,
and muxed with ffmpeg (NVENC H.264).

- `curriculum.mjs` — tracks and lessons, in order. One source for build
  order, numbering, the website's course outline, and the About page list.
- `tours/<id>.mjs` — one lesson: narration `lines`, optional `pre()` setup
  (trimmed from the video), and `run(page, seg, h)` where each `seg(id, fn)`
  pairs a narration line with the actions that illustrate it.
- `lib/helpers.mjs` — cursor/drag/knob/menu/section helpers (`h`).
- `lib/bay.mjs` — Patch Bay jack finder.

## Setup (once)

```bash
npm install                       # Playwright (uses installed Chrome)
python -m venv .venv
.venv/Scripts/python -m pip install kokoro-onnx soundfile piper-tts imageio-ffmpeg
mkdir voices && cd voices
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

## Build

Start the app first (`npm run dev` in the repo root, port 5190), then:

```bash
node build.mjs                    # every lesson (~2-3 min each)
node build.mjs sources look       # just these
node build.mjs --dry patchbay-nodes   # fast selector check: no TTS/recording
node build.mjs --vtt              # rewrite captions only
node build.mjs --index            # rewrite manifest.json + About list only
node build.mjs --voice kokoro:am_michael --speed 1.05   # another voice
```

Output goes to `public/tutorials/`: `<id>.mp4`, `.vtt` (captions, one cue
per sentence), `.jpg` (poster) and `manifest.json` (read by
`tutorials.html`). Narration WAVs are cached in `out/tts-cache/`.

Tours assert app state with `h.check()` so a dry run catches a click that
did nothing; a failed lesson saves `out/<id>/failure.png`.

## Publishing

The MP4s are gitignored (a few hundred MB). Posters, captions and
`manifest.json` are committed and deploy with the site. Upload the MP4s
once to the server's `public_html/tutorials/` (hPanel File Manager or any
FTP client); the deploy workflow only removes files it uploaded itself, so
later deploys leave them alone. Re-upload a lesson's MP4 whenever you
rebuild it.
