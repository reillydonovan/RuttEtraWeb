// Rutt/Etra vertex shader.
//
// Each vertex of a row-aligned grid samples the video texture at its UV,
// computes luminance (with optional Focus blur), runs the canonical DCU
// transform pipeline, and finally displaces along Z by the luminance.
//
// Pipeline order (matches the original hardware signal flow):
//   1. UV mirror (H/V)
//   2. Focus tap (5-tap luminance blur)
//   3. Threshold / Contrast / Gamma (luminance shaping)
//   4. Z Push / Bias / Invert
//   5. Linearity bow (X, Y)
//   6. Aspect, H/V Size
//   7. H/V Position (translation)
//   8. Display 0/90 rotation
//   9. H Spin / V Spin (around H/V Center)
//  10. H Reverse / V Reverse (mirror across pivot)
//  11. Skip-line discard (push offscreen for dropped scan lines)

uniform sampler2D uVideo;
uniform vec2  uVideoTexel;     // 1.0 / videoResolution

uniform vec2  uMirror;         // 0 or 1 per axis

uniform float uFocus;          // 0 sharp .. 1 soft
uniform float uThreshold;
uniform float uContrast;
uniform float uGamma;

uniform float uZPush;
uniform float uZBias;
uniform float uZInvert;        // 0 or 1

uniform vec2  uLinearity;      // bow coefficient per axis (-1..1)
uniform float uAspect;         // X/Y scale
uniform vec2  uSize;           // H Size, V Size (bipolar)
uniform vec2  uPos;            // H Pos, V Pos
uniform vec2  uCenter;         // H/V rotation pivot

uniform float uRotate90;       // 0 or 1 (Display 0/90)
uniform float uRotation;       // radians — continuous in-plane rotation (v21)
uniform float uHSpin;          // radians around X axis
uniform float uVSpin;          // radians around Y axis
uniform float uHReverse;       // 0 or 1
uniform float uVReverse;       // 0 or 1

uniform float uSkip;           // 0..0.95 — fraction of rows dropped
uniform float uRows;           // total row count for skip math

// v23: dual raster. Mode 0 = off (single raster, identical to pre-v23),
// 1 = wipe (split by uWipe), 2 = alternate lines (row parity).
uniform float uDualMode;
uniform float uDualSide;       // 0 = raster A, 1 = raster B
uniform float uWipe;           // 0..1 — B occupies the top uWipe fraction

uniform float uTime;
uniform float uDotScale;       // Dot Raster: dot diameter as a fraction of the sample spacing
uniform float uViewportH;      // drawing-buffer height (px), for gl_PointSize
uniform float uCols;           // samples per row (uRows is the row count)           // seconds (for any time-driven shader effects)

uniform sampler2D uSpectrum;       // 1xN texture of FFT bands (R channel)
uniform float     uSpectrumAmount; // gain applied to spectrum -> Z
uniform float     uSpectrumStride; // rows-per-band scaling (>=1 stretches band across N rows)
uniform float     uSpectrumOn;     // 0 or 1

varying float vLum;
varying vec2  vUv;
varying float vAlive;          // 1 = visible, 0 = dropped (Skip)

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float sampleLum(vec2 uvT) {
  float l0 = luma(texture2D(uVideo, uvT).rgb);
  if (uFocus < 0.001) return l0;
  // 4-tap cross blur; weight by uFocus
  vec2 ox = vec2(uVideoTexel.x, 0.0);
  vec2 oy = vec2(0.0, uVideoTexel.y);
  float l1 = luma(texture2D(uVideo, uvT + ox).rgb);
  float l2 = luma(texture2D(uVideo, uvT - ox).rgb);
  float l3 = luma(texture2D(uVideo, uvT + oy).rgb);
  float l4 = luma(texture2D(uVideo, uvT - oy).rgb);
  float blurred = (l0 + l1 + l2 + l3 + l4) * 0.2;
  return mix(l0, blurred, clamp(uFocus, 0.0, 1.0));
}

void main() {
  // 1. Mirror UVs
  vec2 uvT = uv;
  if (uMirror.x > 0.5) uvT.x = 1.0 - uvT.x;
  if (uMirror.y > 0.5) uvT.y = 1.0 - uvT.y;

  // 2-3. Luma sample, threshold, contrast, gamma
  float l = sampleLum(uvT);
  l = clamp((l - uThreshold) * uContrast, 0.0, 1.0);
  l = pow(l, max(uGamma, 0.001));

  // 4. Z push / bias / invert
  float zRaw = mix(l, 1.0 - l, step(0.5, uZInvert));
  float z = zRaw * uZPush + uZBias;

  // 4b. Optional spectrum-driven additive Z. The spectrum is a 1D texture
  //     with N bands; each row picks a u-coordinate based on its index and
  //     `uSpectrumStride` (1.0 = each band stretched across stride rows).
  if (uSpectrumOn > 0.5) {
    float row = floor(uv.y * (uRows - 1.0) + 0.5);
    float u = clamp(row * uSpectrumStride / max(uRows, 1.0), 0.0, 0.9999);
    float spec = texture2D(uSpectrum, vec2(u, 0.5)).r;
    z += spec * uSpectrumAmount;
  }

  // 5. Linearity bow on the base position
  vec3 p = position;
  p.x += uLinearity.x * p.x * (p.y * p.y);
  p.y += uLinearity.y * p.y * (p.x * p.x);

  // 6. Aspect + H/V Size (bipolar — negative inverts the axis)
  p.x *= uSize.x * uAspect;
  p.y *= uSize.y;

  // 7. H/V Position
  p.xy += uPos;

  // 8. Display rotation (around DCU center): the 0/90 switch composed
  //    with the continuous Rotation knob (v21) — knob + switch, sin/cos,
  //    matching the hardware's total-rotation control.
  vec2 d = p.xy - uCenter;
  if (uRotate90 > 0.5) d = vec2(-d.y, d.x);
  float cR = cos(uRotation), sR = sin(uRotation);
  d = vec2(d.x * cR - d.y * sR, d.x * sR + d.y * cR);

  // 9. H Spin (rotation around horizontal axis -> affects Y/Z)
  //    V Spin (rotation around vertical axis   -> affects X/Z)
  vec3 q = vec3(d, z);
  // V spin around Y axis
  float cV = cos(uVSpin), sV = sin(uVSpin);
  q = vec3(q.x * cV + q.z * sV, q.y, -q.x * sV + q.z * cV);
  // H spin around X axis
  float cH = cos(uHSpin), sH = sin(uHSpin);
  q = vec3(q.x, q.y * cH - q.z * sH, q.y * sH + q.z * cH);

  // 10. H/V Reverse (post-rotation flip across pivot axes)
  if (uHReverse > 0.5) q.y = -q.y;
  if (uVReverse > 0.5) q.x = -q.x;

  // Final position in object space
  p = vec3(uCenter, 0.0) + q;

  // 11. Skip / Underscan: push dropped scan lines way offscreen so the
  //     LineSegments connecting their vertices are clipped.
  float row = floor(uv.y * (uRows - 1.0) + 0.5);
  float keep = step(uSkip, fract(row * 0.6180339887)); // pseudo-random per row

  // 12. Dual raster row mask (v23). Rides the same offscreen-discard
  //     mechanism as Skip. uv.y is 0 at the TOP screen row, so
  //     "uv.y < uWipe" is the top region — raster B's territory in
  //     wipe mode.
  if (uDualMode > 1.5) {
    // Alternate lines: even rows = A, odd rows = B.
    float parity = mod(row, 2.0);
    keep *= (abs(parity - uDualSide) < 0.5) ? 1.0 : 0.0;
  } else if (uDualMode > 0.5) {
    float topRegion = 1.0 - step(uWipe, uv.y);
    keep *= (uDualSide > 0.5) ? topRegion : 1.0 - topRegion;
  }

  vAlive = keep;
  if (keep < 0.5) {
    p = vec3(0.0, 0.0, -1e6);
  }

  vLum = l;
  vUv  = uvT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  // Dot Raster: the world gap between neighbouring samples (the tighter of
  // row and column spacing, after H/V Size and Aspect), projected to pixels at
  // this depth. Lines ignore gl_PointSize.
  float gapY = 1.5 / max(1.0, uRows - 1.0) * max(0.02, abs(uSize.y));
  float gapX = 2.0 / max(1.0, uCols - 1.0) * max(0.02, abs(uSize.x * uAspect));
  float pxPerUnit = 0.5 * uViewportH * projectionMatrix[1][1] / max(1e-4, gl_Position.w);
  gl_PointSize = clamp(uDotScale * min(gapX, gapY) * pxPerUnit, 1.5, 32.0);
}
