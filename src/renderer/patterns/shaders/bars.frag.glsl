// Bars — hard on/off stripes. Frequency = stripe count across the frame.
// Thickness controls the duty cycle (0.5 = SMPTE-style equal bars).
// Axis: 0=h (horizontal stripes, count rows), 1=v (vertical stripes,
// count columns), 3=radial (concentric rings); 2=both -> XOR pattern.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uFrequency;
uniform float uThickness;
uniform int   uAxis;

float bar(float t, float freq, float duty) {
  float f = fract(t * freq);
  return step(f, duty);
}

void main() {
  float onH = bar(vUv.y, uFrequency, uThickness);
  float onV = bar(vUv.x, uFrequency, uThickness);
  float on;
  if (uAxis == 0) on = onH;
  else if (uAxis == 1) on = onV;
  else if (uAxis == 2) on = abs(onH - onV);
  else {
    float r = length(vUv - 0.5) * 1.41421356;
    on = bar(r, uFrequency, uThickness);
  }
  float l = clamp((on - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
