import { describe, expect, it } from 'vitest';
import { EDGE_PAN, edgePull, stepAxis, type AxisState } from '../edgePan';

const DT = 1 / 60;

/** Hold the pointer at `p` in a 0..400 view for `frames`, recording state. */
function hold(s: AxisState, p: number, frames: number, max = 5000): AxisState[] {
  const out: AxisState[] = [];
  for (let i = 0; i < frames; i++) {
    s = stepAxis(s, edgePull(p, 0, 400) * EDGE_PAN.maxSpeed, max, DT);
    out.push(s);
  }
  return out;
}

describe('edgePull', () => {
  it('is zero away from the edges and signed toward them', () => {
    expect(edgePull(200, 0, 400)).toBe(0);
    expect(edgePull(390, 0, 400)).toBeGreaterThan(0);
    expect(edgePull(10, 0, 400)).toBeLessThan(0);
  });

  it('starts gently: shallow depth pulls far less than half as hard as full depth', () => {
    const shallow = edgePull(400 - EDGE_PAN.edge * 0.75, 0, 400); // 25% into the band
    expect(shallow).toBeGreaterThan(0);
    expect(shallow).toBeLessThan(0.25);
    expect(edgePull(400, 0, 400)).toBeCloseTo(1, 5);
  });

  it('is monotonic through the band and past the edge, capped at 1.4', () => {
    let prev = 0;
    for (let p = 400 - EDGE_PAN.edge; p <= 520; p += 2) {
      const v = edgePull(p, 0, 400);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBeCloseTo(1.4, 5);
  });

  it('shrinks the band in a tiny view so the middle never pans', () => {
    expect(edgePull(50, 0, 100)).toBe(0);
    expect(edgePull(95, 0, 100)).toBeGreaterThan(0);
  });
});

describe('stepAxis', () => {
  it('ramps up smoothly and cruises without per-frame jumps', () => {
    const run = hold({ v: 0, pos: 0 }, 400, 90);
    const cruise = EDGE_PAN.maxSpeed;
    expect(run[0].v).toBeLessThan(cruise * 0.2);         // gentle start
    expect(run[60].v).toBeGreaterThan(cruise * 0.95);    // at speed within a second
    for (let i = 1; i < run.length; i++) {
      expect(run[i].v).toBeGreaterThanOrEqual(run[i - 1].v - 1e-9); // never lurches back
      expect(run[i].v - run[i - 1].v).toBeLessThan(cruise * 0.15); // no jerky jumps
      expect(run[i].pos).toBeGreaterThan(run[i - 1].pos);
    }
  });

  it('eases into the end of the scroll range without overshoot or a hard stop', () => {
    const run = hold({ v: EDGE_PAN.maxSpeed, pos: 800 }, 400, 240, 1000);
    const speeds = run.map((s) => s.v);
    for (const s of run) expect(s.pos).toBeLessThanOrEqual(1000);
    expect(run[run.length - 1].pos).toBeGreaterThan(999);
    // Decelerates continuously as it closes in (no single-frame slam).
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i - 1] - speeds[i]).toBeLessThan(EDGE_PAN.maxSpeed * 0.15);
    }
  });

  it('glides to rest after release instead of stopping dead', () => {
    let s: AxisState = { v: EDGE_PAN.maxSpeed, pos: 1000 };
    const speeds: number[] = [];
    for (let i = 0; i < 120 && (i === 0 || s.v !== 0); i++) {
      s = stepAxis(s, 0, 100000, DT);
      speeds.push(s.v);
    }
    expect(speeds[0]).toBeGreaterThan(EDGE_PAN.maxSpeed * 0.8); // still moving right after release
    expect(s.v).toBe(0);                                         // and does come to rest
    expect(speeds.length).toBeLessThan(90);                      // within ~1.5 s
  });

  it('reverses direction continuously when the pointer crosses to the other edge', () => {
    let s: AxisState = { v: EDGE_PAN.maxSpeed, pos: 2000 };
    let prev = s.v;
    for (let i = 0; i < 60; i++) {
      s = stepAxis(s, -EDGE_PAN.maxSpeed, 5000, DT);
      expect(prev - s.v).toBeLessThan(EDGE_PAN.maxSpeed * 0.3);
      prev = s.v;
    }
    expect(s.v).toBeLessThan(0);
  });

  it('is frame-rate independent (30 vs 120 fps travel about the same distance)', () => {
    const travel = (fps: number): number => {
      let s: AxisState = { v: 0, pos: 0 };
      for (let i = 0; i < fps; i++) s = stepAxis(s, EDGE_PAN.maxSpeed, 1e6, 1 / fps);
      return s.pos;
    };
    const a = travel(30), b = travel(120);
    expect(Math.abs(a - b) / b).toBeLessThan(0.08);
  });

  it('reduced motion goes straight to the target speed', () => {
    const s = stepAxis({ v: 0, pos: 0 }, 500, 1e6, DT, true);
    expect(s.v).toBe(500);
  });
});
