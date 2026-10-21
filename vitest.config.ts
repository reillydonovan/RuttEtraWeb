import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the Rutt/Etra signal-graph engine.
 *
 * Engine code is pure ES modules with no DOM dependency, so the default
 * `node` environment is fine. We only run vitest against the graph module
 * for now to keep CI fast and to avoid having to mock three / WebGL.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/modulation/**/*.test.ts',
      // v22: MIDI clock out — pure lookahead-scheduling math.
      'src/midi/**/*.test.ts',
      // Keyframing v2: automation-lane evaluation is pure math.
      'src/sequencer/**/*.test.ts',
      // v9: pure helpers in CVInput / GamepadInput are testable without a DOM.
      'src/audio/**/*.test.ts',
      // v12: stereoscopic metadata injection — pure-function MP4 box
      // surgery, exhaustively testable in node without a DOM.
      'src/record/**/*.test.ts',
      'src/input/**/*.test.ts',
      // v10: PatternRegistry is pure data + OscilloscopeBuffer is a thin
      // wrapper around a Float32Array; both run fine in node without WebGL.
      'src/renderer/patterns/**/*.test.ts',
      // v11: WebXR manager. Uses the jsdom environment (declared at the
      // top of XRManager.test.ts via `// @vitest-environment jsdom`) so
      // `document.visibilitychange` and `navigator.xr` can be exercised
      // directly; everything else here stays in node.
      'src/renderer/__tests__/*.test.ts',
      // v10: Settings migration is pure, schema-only logic — exercises
      // sonification's "always force enabled=false" rule and the v9→v10
      // backfill paths.
      'src/state/**/*.test.ts',
      // v10: Project save/load — schema migration, snapshot, dirty
      // tracking, recovered-session packaging.
      'src/project/**/*.test.ts',
      // Keyframing v2 full UI: pure lane-editor geometry (bar/value ↔
      // pixel mapping, drag math) and the panel diamond's decision logic.
      'src/ui/**/*.test.ts',
      // Offline render (?render=offline): the render clock + seeded chance, and the
      // precomputed-spectrum file parser. Pure logic, no WebGL.
      'src/platform/**/*.test.ts',
      'src/render/**/*.test.ts',
      // Look copilot: the settings sampler (pure JS) checked against the app's DEFAULTS/PRESETS.
      'tools/copilot/**/*.test.mjs',
    ],
    globals: false,
    reporters: ['default'],
  },
});
