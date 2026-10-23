/**
 * A built-in test signal for the audio-reactive features: a two-bar drum and
 * bass loop rendered in code, so the Audio section, the beat detector and the
 * AUDIO ENV / audio-band sources can be tried on a computer with no
 * microphone and no audio file (owner ask: "do the tutorial on a system
 * without mic input").
 *
 * Pure: returns mono samples; FFTAnalyzer plays them as a looping
 * AudioBufferSourceNode into the analyser. It is analysed silently — it only
 * reaches the speakers through the Audio section's Monitor switch (default
 * off), like every other input.
 *
 * 4/4 at the given BPM: kick on every beat, snare on 2 and 4, closed hats on
 * the eighths, and a bass note on each beat (so the low bands move with the
 * kick, the highs with the hats). Deterministic (seeded noise).
 */

export const DEMO_BEAT_BARS = 2;

export function renderDemoBeat(sampleRate: number, bpm: number, bars = DEMO_BEAT_BARS): Float32Array {
  const beatSec = 60 / Math.max(20, Math.min(300, bpm || 120));
  const beats = bars * 4;
  const n = Math.max(1, Math.round(beats * beatSec * sampleRate));
  const out = new Float32Array(n);
  let seed = 0x2f6b4a1d;
  const noise = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  const at = (beat: number): number => Math.round(beat * beatSec * sampleRate);

  // Bass line, one note per beat (A1, A1, C2, G1 ...).
  const BASS = [55, 55, 65.41, 49, 55, 55, 73.42, 49];

  for (let b = 0; b < beats; b++) {
    // Kick: a sine sweeping 120 → 45 Hz with a fast decay.
    {
      const start = at(b), len = Math.round(0.35 * sampleRate);
      let phase = 0;
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / sampleRate;
        const f = 45 + 75 * Math.exp(-t * 30);
        phase += (2 * Math.PI * f) / sampleRate;
        out[start + i] += Math.sin(phase) * Math.exp(-t * 9) * 0.9;
      }
    }
    // Snare on 2 and 4: noise plus a short 190 Hz body.
    if (b % 2 === 1) {
      const start = at(b), len = Math.round(0.18 * sampleRate);
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / sampleRate;
        out[start + i] += (noise() * 0.5 + Math.sin(2 * Math.PI * 190 * t) * 0.25) * Math.exp(-t * 22);
      }
    }
    // Bass: a soft square-ish tone under the kick.
    {
      const f = BASS[b % BASS.length];
      const start = at(b), len = Math.round(beatSec * 0.85 * sampleRate);
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / sampleRate;
        const s = Math.sin(2 * Math.PI * f * t);
        out[start + i] += Math.tanh(s * 2.5) * 0.22 * Math.exp(-t * 3) * Math.min(1, t * 200);
      }
    }
  }
  // Closed hats on every eighth: differentiated noise (bright) with a very short decay.
  for (let e = 0; e < beats * 2; e++) {
    const start = at(e / 2), len = Math.round(0.045 * sampleRate);
    let prev = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / sampleRate;
      const w = noise();
      out[start + i] += (w - prev) * 0.18 * Math.exp(-t * 80);
      prev = w;
    }
  }

  // Normalise to a modest peak.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const k = 0.8 / peak;
    for (let i = 0; i < n; i++) out[i] *= k;
  }
  return out;
}
