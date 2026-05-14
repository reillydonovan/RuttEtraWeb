// Lissajous — XY oscillator trace. We sample the curve at many `s`
// values along [0, 2π) and shade fragments inside a thickness band
// around the nearest sample. uTime gently advances the curve so static
// configurations still breathe; modulate freqRatio / phaseOffset for
// dramatic motion.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uFrequency;     // X frequency
uniform float uFreqRatio;     // Y/X ratio
uniform float uPhaseOffset;   // Y phase offset (radians)
uniform float uThickness;     // band half-width in normalized units
uniform float uTime;

void main() {
  vec2 p = (vUv - 0.5) * 1.6; // ~slightly inset frame
  float bestD = 1e9;
  // 256 samples is plenty for most ratios up to ~12:1
  const int N = 256;
  for (int i = 0; i < N; i++) {
    float s = float(i) / float(N - 1) * 6.2831853 + uTime * 0.5;
    vec2 q = vec2(
      0.5 * sin(s * uFrequency),
      0.5 * sin(s * uFrequency * uFreqRatio + uPhaseOffset)
    );
    float d = distance(p, q);
    bestD = min(bestD, d);
  }
  float t = max(uThickness, 0.001);
  float on = 1.0 - smoothstep(t * 0.5, t, bestD);
  gl_FragColor = vec4(vec3(on * uBrightness), 1.0);
}
