// Worley (cellular) noise — distance-to-nearest-feature-point.
// Standard "cell-grid + per-cell jittered point" approach scans a 3x3
// neighborhood of the current cell. Output: smooth blob terrain.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uScale;
uniform float uPointDensity;
uniform float uTime;

vec2 hash2(vec2 p) {
  return fract(sin(vec2(
    dot(p, vec2(127.1, 311.7)),
    dot(p, vec2(269.5, 183.3))
  )) * 43758.5453);
}

void main() {
  vec2 p = vUv * max(uScale, 0.05) * max(uPointDensity, 1.0);
  vec2 i = floor(p);
  vec2 f = fract(p);
  float minD = 1e9;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = vec2(float(x), float(y));
      vec2 jitter = hash2(i + cell);
      // Animate each cell's point on its own little orbit.
      jitter = 0.5 + 0.5 * sin(6.2831853 * jitter + uTime);
      vec2 r = cell + jitter - f;
      minD = min(minD, dot(r, r));
    }
  }
  float d = sqrt(minD);
  float n = clamp(1.0 - d, 0.0, 1.0);
  float l = clamp((n - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
