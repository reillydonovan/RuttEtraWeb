import { defineConfig, Plugin } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { marked } from 'marked';

// PWA / Service Worker support has been removed. It caused stale-cache
// lock-ups on Hostinger (LiteSpeed default 7-day Cache-Control on JS)
// that no amount of skipWaiting/clientsClaim could reliably unstick on
// every user's browser, and the offline / install benefits weren't worth
// the support burden for a desktop-first synth. A static kill-switch
// `public/sw.js` is shipped alongside the build to auto-unregister any
// previously-installed SW for returning visitors.

/**
 * Build-time markdown -> HTML transformer.
 *
 * Triggered by importing `*.md?aboutMd` from anywhere in the source
 * tree. The markdown source is rendered with `marked` (devDependency
 * only) at transform time and inlined as a default-export HTML string.
 * This keeps the markdown parser entirely out of the client bundle —
 * the about page ships pre-rendered HTML, not source markdown.
 *
 * The plugin also synthesizes a `<h2 id="...">` for the FIRST heading
 * in each file based on the filename (so `01-intro.md` becomes
 * `id="intro"`), which the about page's TOC and search use as anchor
 * targets. This means content authors don't need to remember to add
 * IDs by hand.
 */
function aboutMarkdown(): Plugin {
  const SUFFIX = '?aboutMd';
  // Configure marked: GFM tables/strikethrough, no header IDs (we
  // synthesize them ourselves), no auto-linkifying URLs in code.
  marked.setOptions({ gfm: true, breaks: false });
  return {
    name: 'about-markdown',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const file = id.slice(0, -SUFFIX.length);
      const src = readFileSync(file, 'utf8');
      // Derive a canonical anchor ID from the filename: strip leading
      // digits/dashes and the .md extension. Files are named like
      // `01-quick-start.md` -> `quick-start`.
      const base = file.split(/[\\/]/).pop() ?? '';
      const slug = base
        .replace(/\.md$/, '')
        .replace(/^\d+[-_]/, '');
      const html = marked.parse(src) as string;
      // Inject a section wrapper with id, so each markdown file lands
      // as `<section id="...">...</section>` in the document and the
      // TOC + search can target sections cleanly.
      const wrapped = `<section id="${slug}" class="about-section">${html}</section>`;
      // Watch the source file for HMR during dev.
      this.addWatchFile(file);
      return `export default ${JSON.stringify(wrapped)};`;
    },
  };
}

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  plugins: [aboutMarkdown()],
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      // Multi-page: the synth at index.html, the long-form manual at
      // about.html. The about page is fully static (no synth code,
      // no three.js, no Web Audio) so it ships as its own tiny chunk
      // and Vite's tree-shaking keeps the synth's vendor chunks out
      // of its dependency graph.
      input: {
        main:  resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
      },
      output: {
        manualChunks: (id) => {
          // Pull three.js + its examples into a single vendor chunk so the
          // initial bundle stays under 400KB gzipped.
          if (id.includes('node_modules/three/')) return 'vendor-three';
          if (id.includes('node_modules/peerjs/')) return 'vendor-peerjs';
          if (id.includes('node_modules/qrcode/')) return 'vendor-qrcode';
          return undefined;
        },
      },
    },
  },
  assetsInclude: ['**/*.glsl', '**/*.vert', '**/*.frag'],
});
