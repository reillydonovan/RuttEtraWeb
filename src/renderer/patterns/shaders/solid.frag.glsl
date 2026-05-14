// Solid color pattern — uniform luminance across the frame. Useful for
// calibrating Z Push response and verifying the synth's quiescent
// behavior with a flat input.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;

void main() {
  float l = clamp(uBrightness, 0.0, 1.0);
  gl_FragColor = vec4(vec3(l), 1.0);
}
