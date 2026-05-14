// Gradient — linear or radial luminance ramp. Phase rotates the
// linear direction; for radial, phase shifts the falloff origin
// horizontally.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uPhase;
uniform int   uGradientShape;

void main() {
  vec2 p = vUv - 0.5;
  float t;
  if (uGradientShape == 1) {
    // radial: distance from center, normalized to ~1 at corners
    vec2 c = vec2(0.5 * sin(uPhase), 0.0);
    t = length(p - c) * 1.41421356;
    t = 1.0 - clamp(t, 0.0, 1.0);
  } else {
    // linear: project along the direction encoded by phase
    vec2 dir = vec2(cos(uPhase), sin(uPhase));
    t = clamp(dot(p, dir) + 0.5, 0.0, 1.0);
  }
  float l = clamp((t - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
