// Rutt/Etra fragment shader — colorizes the displaced scan lines.
//
// Color modes:
//   0 = Grayscale    (intensity-modulated white)
//   1 = Phosphor     (tint by uTint, like a P1 green / P3 amber CRT)
//   2 = Video color  (sample the video texture at vUv)

precision highp float;

uniform sampler2D uVideo;
uniform float     uIntensity;
uniform vec3      uTint;
uniform int       uColorMode;
uniform float     uAlphaFalloff; // 0..1 — fade lines below threshold
uniform float     uDots;         // 1 = Dot Raster mode: draw round, soft-edged dots

varying float vLum;
varying vec2  vUv;
varying float vAlive;

void main() {
  if (vAlive < 0.5) discard;

  vec3 col;
  if (uColorMode == 2) {
    col = texture2D(uVideo, vUv).rgb;
  } else if (uColorMode == 1) {
    col = uTint * vLum;
  } else {
    col = vec3(vLum);
  }

  col *= uIntensity;

  // Alpha softens lines that have very low luminance — gives the classic
  // "dark areas drop out" look without fully discarding (which would break
  // line continuity in a confusing way).
  float a = mix(1.0, vLum, clamp(uAlphaFalloff, 0.0, 1.0));

  if (uDots > 0.5) {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float edge = 1.0 - smoothstep(0.09, 0.25, r2);
    col *= edge;
    a *= edge;
  }

  gl_FragColor = vec4(col, a);
}
