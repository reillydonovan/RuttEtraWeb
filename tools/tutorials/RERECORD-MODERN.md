# Re-recording the video course for the Modern theme (v1.33.3)

Handoff for the overnight run on the GPU machine. Branch: `modern-theme`
(pushed; NOT merged — merging to `main` deploys production, owner decides
after reviewing the new videos). Read the repo `CLAUDE.md` "State of the
Modern theme" / "Modern design pass" entries first.

## What changed under the tours

1. **Modern is the default theme.** A fresh profile records in Modern with
   nothing to do. (Classic = `localStorage['rw-ui-theme'] = 'phosphor'`.)
2. **Every Controls section starts collapsed** (only Help ▸ Manual is
   open), and Controls lands on the **Synth** tab (no first-run Help).
   `h.section(title)` already opens a closed section; tours that click or
   `h.reveal` params WITHOUT calling `h.section` first will miss. Likely:
   `first-look`, `sources`, `video-modulation`, `feedback-chaos`,
   `clocks-sequencer`, `timeline-keyframes`, `workspace`; check `look`,
   `dual-raster`, `shaping` too. Fix: add `await h.section('<Section>')`
   before the first interaction in that section.
3. **"Source" section is now "Video Source A"** (section titles are what
   `h.section()` matches). No tour calls `h.section('Source')` today, but
   narration that says "the Source panel" should say "Video Source A".
4. **Timeline toolbar rebuilt** — transport buttons are icons now. Use the
   stable hooks instead of text:
   - `[data-tl="new"]` (+), `[data-tl="more"]` (⋯ menu: Save timeline,
     Rename…, Export JSON…, Import JSON…, Delete timeline…, Dock at
     top / bottom, Hide dock), `[data-tl="play"]`, `[data-tl="stop"]`,
     `[data-tl="prev"]`, `[data-tl="next"]`, `[data-tl="loop"]`.
   - Text clicks to replace: `timeline-scenes.mjs` 18, 56, 58;
     `timeline-keyframes.mjs` 33, 62; `performance-rig.mjs` 71, 79.
   - Narration mentioning "the PLAY button", "LOOP ON", "DOCK TOP/BOT"
     should follow the new layout (play icon; loop lights green; dock
     position lives in the ⋯ menu).
5. **Panel title-bar ⧉ / ⛶ buttons are gone** — popouts are the window
   tab bar's ⧉ or Window ▸ Pop Out Controls / Pop Out Output.
6. **Every window has the same ⧉ ⤢ – buttons**; – collapses a window to
   its tab strip (click the strip to restore). The `workspace` tour could
   show this.
7. **Caption cards** (`lib/helpers.mjs` `card()`, ~line 257) still use
   the CRT look (VT323, green glow). For the Modern course switch them to
   the system sans (`-apple-system, "SF Pro Display", …`), a white 700
   title with the kicker in mono caps grey, on `rgba(0,0,0,.88)` — the
   same look as the app's intro screen.
8. Project name is an editable field; the Patch Bay and Controls share
   the same edge scroll rails; jacks ripple on hover.

## Order of work

1. `git checkout modern-theme && git pull`, `npm install`, `npm run dev`
   (port 5190), then in `tools/tutorials`: `npm install`.
2. Apply the tour fixes above.
3. `node build.mjs --dry` for ALL lessons until every tour passes its
   `h.check()` assertions (dry = no TTS, no recording).
4. Full build overnight: `node build.mjs` (Kokoro `af_heart`, h264_nvenc).
   It rewrites `public/tutorials/*.vtt`, posters, `manifest.json` and the
   video-course block in `docs/about/10-tutorials.md`.
5. Spot-check a few MP4s (first-look, timeline-keyframes, patchbay-cables,
   workspace) for the Modern look, collapsed-section clicks landing, and
   narration matching what's on screen.
6. Commit the tour/caption/poster/manifest changes on `modern-theme` and
   push. Do NOT merge to `main`. Leave the MP4s for the owner to upload to
   `public_html/tutorials/` when the deploy happens (they're gitignored).
