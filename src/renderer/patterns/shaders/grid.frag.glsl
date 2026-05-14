// Grid — crosshatch lines. Scale sets cell size in normalized units;
// thickness sets the line half-width as a fraction of cell size.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uScale;
uniform float uThickness;

void main() {
  float scale = max(uScale, 0.05);
  vec2 g = fract(vUv * scale * 8.0);
  float lineX = step(uThickness, g.x) * step(uThickness, 1.0 - g.x);
  float lineY = step(uThickness, g.y) * step(uThickness, 1.0 - g.y);
  // line==0 when ON the line (both dimensions inside the band)
  float on = 1.0 - lineX * lineY;
  float l = clamp((on - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
