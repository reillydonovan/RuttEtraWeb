/**
 * MIDI clock transmitter (v22, AUDIT item 3 — "sync out").
 *
 * Sends 24-PPQ `0xF8` timing pulses derived from `Settings.internalBpm`
 * (the single shared BPM) on the selected MIDI output, so external
 * sequencers / drum machines / modular MIDI clocks can chase the synth.
 * `0xFA` (Start) is sent on enable, `0xFC` (Stop) on disable.
 *
 * Scheduling uses the standard lookahead pattern: a coarse JS interval
 * (100 ms) schedules precisely-timestamped pulses ~250 ms ahead via Web
 * MIDI's `send(data, timestamp)` — jitter-free even when the main thread
 * hiccups. BPM changes are picked up at the next scheduling window
 * (≤100 ms latency, plenty for a tempo knob).
 *
 * Posture: `midiClockOutEnabled` is forced OFF on every load (same
 * structural rule as CV output) — outward-facing signals never auto-arm
 * from a saved file.
 */

/** Schedule the pulse times due in [now, now+lookaheadMs). Pure. */
export function schedulePulses(
  nextPulseTime: number,
  now: number,
  lookaheadMs: number,
  bpm: number,
): { times: number[]; next: number } {
  const interval = 60000 / (Math.max(1, bpm) * 24);
  const times: number[] = [];
  let t = nextPulseTime;
  // If we fell far behind (tab throttled), jump forward rather than
  // machine-gunning a burst of stale pulses.
  if (t < now - 4 * interval) t = now;
  const horizon = now + lookaheadMs;
  while (t < horizon) {
    times.push(t);
    t += interval;
  }
  return { times, next: t };
}

const TICK_MS = 100;
const LOOKAHEAD_MS = 250;

export class MidiClockOut {
  private timer: number | null = null;
  private nextPulseTime = 0;

  constructor(
    private readonly getOutput: () => Pick<MIDIOutput, 'send'> | null,
    private readonly getBpm: () => number,
  ) {}

  get running(): boolean {
    return this.timer != null;
  }

  start(): void {
    if (this.timer != null) return;
    const out = this.getOutput();
    try { out?.send([0xFA]); } catch { /* device vanished — harmless */ }
    this.nextPulseTime = performance.now();
    const tick = (): void => {
      const output = this.getOutput();
      if (!output) return; // device gone — resume when it's back
      const { times, next } = schedulePulses(
        this.nextPulseTime, performance.now(), LOOKAHEAD_MS, this.getBpm(),
      );
      this.nextPulseTime = next;
      for (const t of times) {
        try { output.send([0xF8], t); } catch { /* ignore */ }
      }
    };
    tick();
    this.timer = window.setInterval(tick, TICK_MS);
  }

  stop(): void {
    if (this.timer == null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    try { this.getOutput()?.send([0xFC]); } catch { /* ignore */ }
  }
}
