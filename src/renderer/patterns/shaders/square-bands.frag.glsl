// Square bands — hard-edged 50%-duty square wave.

precision highp float;

varying vec2 vUv;
uniform float uBrightness;
uniform float uContrast;
uniform float uFrequency;
uniform float uPhase;
uniform int   uAxis;

float coord(vec2 uv) {
  if (uAxis == 0) return uv.y;
  if (uAxis == 1) return uv.x;
  if (uAxis == 2) return uv.x + uv.y;
  return length(uv - 0.5) * 1.41421356;
}

void main() {
  float t = coord(vUv);
  float sq = step(0.5, fract(t * uFrequency + uPhase / 6.2831853));
  float l = clamp((sq - 0.5) * uContrast + 0.5, 0.0, 1.0) * uBrightness;
  gl_FragColor = vec4(vec3(l), 1.0);
}
