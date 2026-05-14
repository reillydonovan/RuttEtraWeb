// Sine bands — sine-wave luminance varying along the chosen axis.
// Modulating frequency animates the stripe count; modulating phase
// scrolls them. Output mapped to 0..1 (unipolar).

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uFrequency;
uniform float uPhase;
uniform int   uAxis;

float coord(vec2 uv) {
  if (uAxis == 0) return uv.y;
  if (uAxis == 1) return uv.x;
  if (uAxis == 2) return uv.x + uv.y;        // diagonal
  return length(uv - 0.5) * 1.41421356;       // radial
}

void main() {
  float t = coord(vUv);
  float s = sin(t * uFrequency * 6.2831853 + uPhase) * 0.5 + 0.5;
  float l = clamp((s - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
