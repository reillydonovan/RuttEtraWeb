# Contributing to Rutt/Etra Web

Thanks for wanting to help. Bug reports, ideas, documentation fixes and code are all welcome.

## Reporting a bug

Open an [issue](https://github.com/reillydonovan/RuttEtraWeb/issues) with:

- what you did, what you expected, and what happened instead;
- your browser and OS (and the version shown in the panel title bar, e.g. `v1.34.0 · abc1234`);
- a screenshot or short screen recording if it's visual;
- any errors from the browser's developer console.

If the app won't start at all, try opening it with `?reset` on the end of the URL (it backs up and clears your saved local state) and say in the issue whether that helped.

## Suggesting a feature

Open an issue first and describe what you want to do with the instrument, not only the control you'd add. For anything larger than a small fix, agree the design in the issue before writing code; it saves everyone a rewrite.

## Working on the code

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # unit tests
npm run build      # typecheck + production build
```

Before opening a pull request:

1. `npm run typecheck`, `npm test` and `npm run build` all pass.
2. `node scripts/check-about-bundle.cjs` passes after the build (the manual, tutorials and design-system pages must not pull in the synth runtime).
3. You've tried the change in a browser. Most of the app is WebGL and DOM, which the unit tests deliberately don't cover.

Things worth knowing first:

- **Read [`PRINCIPLES.md`](PRINCIPLES.md).** The nine principles are treated as rules. The two that come up most: every parameter has a *base* value (the knob, the saved file) and a *live* value (base + modulation), and modulation must never write the base; and each concept has exactly one authoritative source, so search for the existing one before adding state.
- **Saved formats are versioned.** If you change what Settings, presets, projects or timelines store, bump the version and add an idempotent step to `migrateSettings()` / `migrateProject()` with a test.
- **Docs land with the feature.** A new modulatable parameter needs a `PARAM_DOCS` entry (`src/ui/help/paramDocs.ts`); a new graph node needs a complete `NodeDef`; user-visible behaviour changes go into `docs/about/*.md`.
- **Tests live next to the code** in `__tests__/` folders and must be pure (no WebGL). If you add tests in a new directory, add its glob to the `include` list in `vitest.config.ts`, or they won't run.
- **Audio and CV output stay safe.** Anything that makes sound or sends voltage defaults to off, starts quiet, ramps in, and goes through a limiter. Don't loosen that.
- [`CLAUDE.md`](CLAUDE.md) has detailed architecture notes and the history behind many decisions.

Keep a pull request to one change, and say in the description how you tested it.

## License

By contributing, you agree that your contribution is licensed under the project's [GNU AGPL-3.0](LICENSE) license.
