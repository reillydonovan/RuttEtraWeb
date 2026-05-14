/* eslint-disable */
// Sanity-check the about-page bundle: confirm no synth-runtime
// constructors / module imports leaked in. Run after `vite build`.

const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist', 'assets');
const aboutChunk = fs.readdirSync(DIST).find((f) => /^about-.*\.js$/.test(f));
if (!aboutChunk) {
  console.error('FAIL: no about-*.js chunk found in', DIST);
  process.exit(2);
}
const src = fs.readFileSync(path.join(DIST, aboutChunk), 'utf8');

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
for (const [label, re] of probes) {
  const m = src.match(re);
  const hits = m ? m.length : 0;
  if (hits > 0) {
    console.log(`FAIL: ${label}  (${hits} match${hits>1?'es':''})`);
    failed++;
  } else {
    console.log(`OK  : ${label}`);
  }
}

console.log(`\nabout chunk: ${aboutChunk}`);
console.log(`size: ${src.length} bytes`);

process.exit(failed ? 1 : 0);
