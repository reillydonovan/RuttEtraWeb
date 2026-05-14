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
    include: ['src/modulation/graph/**/*.test.ts'],
    globals: false,
    reporters: ['default'],
  },
});
