// Checkerboard — alternating cells. Density = number of cells across
// the longer axis; integer count produces sharp edges.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uDensity;

void main() {
  float n = max(uDensity, 1.0);
  vec2 c = floor(vUv * n);
  float on = mod(c.x + c.y, 2.0);
  float l = clamp((on - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
