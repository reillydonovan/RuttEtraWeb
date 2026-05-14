// White noise — per-pixel uncorrelated noise. Uses a hash on
// (uv, uTime) so the seed advances every frame.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uTime;

float hash(vec2 p) {
  // Spirals / fract / dot — a standard cheap hash that doesn't tile.
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float n = hash(vUv * 1024.0 + uTime * 60.0);
  float l = clamp((n - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
