// Oscilloscope — renders a 1D `uScopeBuffer` as a beam trace.
// `uScopeSweep` controls how many buffer windows fit on screen
// (>1 = compressed time view; <1 = zoomed-in).
//
// `uScopeThickness` is in pixels (`uResolution.y` is the RT height).
// `uScopeBeamHue` selects an HSV hue at full saturation; brightness
// gates the trace's value channel.
//
// The "phosphor decay" persistence is implemented in the renderer via
// a feedback render target — this shader is responsible only for
// drawing the current frame's trace; the renderer blends it over the
// previous accumulator.

precision highp float;

varying vec2 vUv;

uniform sampler2D uScopeBuffer;
uniform float     uScopeBufferLength;
uniform vec2      uResolution;
uniform float     uBrightness;
uniform float     uScopeSweep;
uniform float     uScopeThickness;
uniform float     uScopeBeamHue;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float sampleScope(float u) {
  // u in 0..1 across the visible window
  float idx = u * max(uScopeSweep, 0.001);
  // Wrap so high sweep values tile multiple buffer copies horizontally
  idx = fract(idx);
  return texture2D(uScopeBuffer, vec2(idx, 0.5)).r;
}

void main() {
  // Sample the trace at this column and a few neighbors to estimate
  // the band. Center y at 0.5; values map -1..1 to top..bottom of the
  // frame.
  float dx = 1.0 / max(uResolution.x, 1.0);
  float v0 = sampleScope(vUv.x);
  float vL = sampleScope(vUv.x - dx);
  float vR = sampleScope(vUv.x + dx);
  // Use per-fragment min/max so steep slopes still look connected.
  float vmin = min(v0, min(vL, vR));
  float vmax = max(v0, max(vL, vR));

  float yMin = 0.5 - 0.5 * vmax;
  float yMax = 0.5 - 0.5 * vmin;

  // Distance from this fragment to the trace band, in pixels along Y.
  float pxY = vUv.y * uResolution.y;
  float bandTopPx    = yMin * uResolution.y;
  float bandBotPx    = yMax * uResolution.y;
  float distPx;
  if (pxY < bandTopPx)        distPx = bandTopPx - pxY;
  else if (pxY > bandBotPx)   distPx = pxY - bandBotPx;
  else                        distPx = 0.0;

  float t = max(uScopeThickness, 0.5);
  float a = 1.0 - smoothstep(t * 0.5, t, distPx);

  vec3 hue = hsv2rgb(vec3(fract(uScopeBeamHue), 1.0, 1.0));
  vec3 col = hue * a * uBrightness;
  gl_FragColor = vec4(col, 1.0);
}
