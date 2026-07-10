---
name: preflight
description: Run RuttEtraWeb's full pre-commit verification pipeline (typecheck, tests, build, about-bundle guard) and check the repo's structural invariants. Use before committing any non-trivial change, or when asked to "verify", "preflight", or "check everything".
---

# Preflight — RuttEtraWeb verification pipeline

Run these in order; stop and report on the first failure:

1. `npm run typecheck` — `tsc --noEmit`, catches type drift fast.
2. `npm test` — vitest, node env. Expect ALL suites green (441+ tests).
3. `npm run build` — full production build (typecheck + vite, multi-page).
4. `node scripts/check-about-bundle.cjs` — MUST pass after every build:
   asserts the about page ships zero synth runtime (no three.js, Web
   Audio, MediaRecorder, PeerJS).

## Invariant checklist (verify for the diff being committed)

- **Settings schema**: any change to saved-format shape bumps `_v`
  (`CURRENT_VERSION` in `src/state/Settings.ts`) and adds an idempotent
  `migrateSettings()` step. Migration tests assert `_v >= N`, never
  `=== N`.
- **Timeline schema**: same rule via `Timeline._v` (`src/sequencer/types.ts`)
  and the store's normalize path.
- **Base/live split**: no modulation/automation code path may call
  `settings.set(key, liveValue)` — engines write ONLY through
  `LiveValuesStore.setContributions()`.
- **Audio/CV/MIDI-out safety**: outward-facing outputs (sonification, CV
  out channels, MIDI clock out) are structurally forced OFF on every
  load in `migrateSettings()` — never weaken this.
- **New tests in a new directory**: add its glob to the `include`
  allowlist in `vitest.config.ts` or the tests silently won't run.
- **Docs land with the feature**: new modulatable Settings key → entry in
  `src/ui/help/paramDocs.ts`; new graph node → complete `NodeDef` in the
  registry; user-facing behavior change → `src/ui/help/content.ts` +
  the relevant `docs/about/*.md`.
- **No service worker**: never reintroduce one; `public/sw.js` is a
  kill-switch for old installs.

## Deploy warning

Pushing to `main` triggers the production FTP deploy
(`.github/workflows/deploy.yml`). Feature work goes on a branch; merge
to `main` only when the user explicitly wants to ship. The deployed
page identifies itself via the build stamp (`v<version> · <commit> ·
<date>`) on the boot overlay and panel title bar.

## Notes

- `src/ui/panel.css` is UTF-16/BOM-encoded — content greps see it as
  binary (use `Select-String` in PowerShell); keep the encoding when
  editing.
- GPU-side changes (shaders, postfx, dual raster, XR) have NO automated
  coverage — the suite deliberately excludes WebGL. Flag them for
  manual visual QA in the commit message or summary.
