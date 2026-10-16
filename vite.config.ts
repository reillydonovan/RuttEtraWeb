import { defineConfig, Plugin } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { marked } from 'marked';

// Build stamp, injected as the __BUILD_INFO__ global: package version +
// short git commit + build date. Shown in the panel title bar so a
// deployed page can be matched to a commit at a glance (no more
// comparing bundle hashes to find out what's live).
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch { /* no git (e.g. tarball build) — 'unknown' is fine */ }
const BUILD_INFO = {
  version: pkg.version,
  commit,
  builtAt: new Date().toISOString().slice(0, 10),
};

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
  define: {
    __BUILD_INFO__: JSON.stringify(BUILD_INFO),
  },
  // Own fixed port (5173 is taken by another local project, and Vite
  // would otherwise silently drift to 5174, 5175…). `host: true` listens
  // on the LAN too, so another machine (e.g. the one running the Chrome
  // extension) can open http://<this-mac's-LAN-IP>:5190/. strictPort
  // fails loudly instead of changing the address under you.
  server: {
    port: 5190,
    strictPort: true,
    host: true,
    // Allow Bonjour names (http://<mac-name>.local:5190/) besides raw IPs.
    allowedHosts: ['.local'],
  },
  preview: {
    port: 4190,
    strictPort: true,
    host: true,
    allowedHosts: ['.local'],
  },
  plugins: [aboutMarkdown()],
  build: {
    target: 'es2022',
    // 'hidden': maps are still written for local debugging, but the built
    // JS doesn't reference them and the deploy workflow excludes *.map,
    // so the full source isn't published with every deploy.
    sourcemap: 'hidden',
    assetsInlineLimit: 0,
    rollupOptions: {
      // Multi-page: the synth at index.html, the long-form manual at
      // about.html, the video course at tutorials.html (static like about). The about page is fully static (no synth code,
      // no three.js, no Web Audio) so it ships as its own tiny chunk
      // and Vite's tree-shaking keeps the synth's vendor chunks out
      // of its dependency graph.
      input: {
        main:  resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
        tutorials: resolve(__dirname, 'tutorials.html'),
        designsystem: resolve(__dirname, 'designsystem.html'),
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
