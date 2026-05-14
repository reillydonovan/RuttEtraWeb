// Compositor — blends the pattern texture with the video texture
// according to `uBlendMode` (int) and `uMix` (0..1).
//
// Modes match the `PatternBlendMode` union in Settings.ts; the integer
// indices are kept in sync via `BLEND_MODE_INDEX` in PatternRegistry.ts.
//
//   0 replace    -> pattern only (video unused)
//   1 add        -> v + p*mix
//   2 subtract   -> v - p*mix
//   3 multiply   -> mix(v, v*p, mix)
//   4 screen     -> mix(v, 1 - (1-v)*(1-p), mix)
//   5 difference -> mix(v, abs(v-p), mix)
//   6 mask       -> v * pattern_luma * mix + v * (1-mix)
//   7 crossfade  -> mix(v, p, mix)
//
// `uMix` is the master blend amount; modes that don't need it still
// honor it as a "wet/dry" between the unmodified video and the
// blended result. Clamped to 0..1 in the renderer (LiveValuesStore can
// drive it negative or above 1 via modulation; we accept that and
// clamp at the boundary so weird-but-musical sweeps still work).

precision highp float;

varying vec2 vUv;

uniform sampler2D uPattern;
uniform sampler2D uVideo;
uniform int       uBlendMode;
uniform float     uMix;
uniform float     uHasVideo; // 1 when sourceKind != 'none', else 0

void main() {
  vec4 p = texture2D(uPattern, vUv);
  vec4 v = uHasVideo > 0.5 ? texture2D(uVideo, vUv) : vec4(0.0, 0.0, 0.0, 1.0);
  float mixK = clamp(uMix, 0.0, 1.0);
  vec3 outRgb;

  if (uBlendMode == 0) {
    // replace: pattern only (video ignored). uMix still acts as a
    // brightness gate so a user can sweep the pattern in/out.
    outRgb = p.rgb * mixK;
  } else if (uBlendMode == 1) {
    outRgb = v.rgb + p.rgb * mixK;
  } else if (uBlendMode == 2) {
    outRgb = v.rgb - p.rgb * mixK;
  } else if (uBlendMode == 3) {
    outRgb = mix(v.rgb, v.rgb * p.rgb, mixK);
  } else if (uBlendMode == 4) {
    vec3 scr = vec3(1.0) - (vec3(1.0) - v.rgb) * (vec3(1.0) - p.rgb);
    outRgb = mix(v.rgb, scr, mixK);
  } else if (uBlendMode == 5) {
    outRgb = mix(v.rgb, abs(v.rgb - p.rgb), mixK);
  } else if (uBlendMode == 6) {
    // mask: pattern luminance keys whether the video shows through
    float lum = dot(p.rgb, vec3(0.2126, 0.7152, 0.0722));
    outRgb = v.rgb * mix(1.0, lum, mixK);
  } else {
    // crossfade (7) and any out-of-range int
    outRgb = mix(v.rgb, p.rgb, mixK);
  }

  gl_FragColor = vec4(clamp(outRgb, 0.0, 1.0), 1.0);
}
