import { defineConfig } from 'vite';

// PWA / Service Worker support has been removed. It caused stale-cache
// lock-ups on Hostinger (LiteSpeed default 7-day Cache-Control on JS)
// that no amount of skipWaiting/clientsClaim could reliably unstick on
// every user's browser, and the offline / install benefits weren't worth
// the support burden for a desktop-first synth. A static kill-switch
// `public/sw.js` is shipped alongside the build to auto-unregister any
// previously-installed SW for returning visitors.

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
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
