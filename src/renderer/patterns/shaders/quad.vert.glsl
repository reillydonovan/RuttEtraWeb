// Shared full-screen quad vertex shader for every pattern + compositor.
// Position is supplied as clip-space coordinates by `THREE.PlaneGeometry(2,2)`
// (the standard fullscreen-pass mesh in three.js EffectComposer style).

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
