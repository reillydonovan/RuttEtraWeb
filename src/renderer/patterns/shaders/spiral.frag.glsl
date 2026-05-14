// Spiral — radial sweep with N arms. Phase rotates the spiral over
// time; scale tightens/loosens the winding.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uArms;
uniform float uScale;
uniform float uPhase;

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x);
  float v = sin(a * max(uArms, 1.0) + r * 6.2831853 * max(uScale, 0.05) + uPhase) * 0.5 + 0.5;
  float l = clamp((v - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
