// Perlin-style fBm noise — sum of `uOctaves` value-noise layers at
// halving amplitudes. Time advances the field slowly. Stylized
// (value noise, not gradient Perlin) for cheap, smooth procedural
// textures.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uScale;
uniform float uOctaves;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 p = vUv * max(uScale, 0.05);
  float t = uTime * 0.15;
  float amp = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  int oct = int(clamp(uOctaves, 1.0, 6.0));
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum  += amp * vnoise(p + vec2(t, -t));
    norm += amp;
    p   *= 2.0;
    amp *= 0.5;
  }
  float n = sum / max(norm, 1e-4);
  float l = clamp((n - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
