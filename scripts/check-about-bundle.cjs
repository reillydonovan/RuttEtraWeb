/* eslint-disable */
// Sanity-check the static-page bundles (about + tutorials): confirm no synth-runtime
// constructors / module imports leaked in. Run after `vite build`.

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist', 'assets');
// The static pages: the About manual and the Video Tutorials page. Neither
// may pull in synth runtime.
const PAGES = ['about', 'tutorials', 'designsystem'];

// Each entry is [label, regex]. The regex is matched against the
// minified bundle source. We're looking for runtime-only patterns
// (constructor calls, navigator.* dotted access, vendor module names
// inside import strings) — NOT for the same words appearing as plain
// prose inside the rendered markdown HTML strings.
const probes = [
  ['new AudioContext',     /new AudioContext\b/],
  ['new (...)AudioContext',/new \w*AudioContext\(/],
  ['new MediaRecorder',    /new MediaRecorder\b/],
  ['navigator.mediaDevices',/navigator\.mediaDevices\b/],
  ['THREE.* construct',    /new THREE\.\w+/],
  ['peerjs import',        /from"peerjs"|require\("peerjs"/],
  ['three import',         /from"three"|require\("three"/],
  ['qrcode import',        /from"qrcode"|require\("qrcode"/],
];

let failed = 0;
for (const page of PAGES) {
  const chunk = fs.readdirSync(DIST).find((f) => new RegExp(`^${page}-.*\\.js$`).test(f));
  if (!chunk) {
    console.error(`FAIL: no ${page}-*.js chunk found in`, DIST);
    process.exit(2);
  }
  const src = fs.readFileSync(path.join(DIST, chunk), 'utf8');
  for (const [label, re] of probes) {
    const m = src.match(re);
    const hits = m ? m.length : 0;
    if (hits > 0) {
      console.log(`FAIL: ${page}: ${label}  (${hits} match${hits>1?'es':''})`);
      failed++;
    } else {
      console.log(`OK  : ${page}: ${label}`);
    }
  }
  console.log(`${page} chunk: ${chunk}, ${src.length} bytes
`);
}

process.exit(failed ? 1 : 0);
