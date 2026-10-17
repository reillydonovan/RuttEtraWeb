import { describe, it, expect } from 'vitest';
import { formatPlan, evenSize, frameSlot, describeEncode } from '../encodePlan';

describe('formatPlan', () => {
  it('auto and mp4 lead with H.264 in MP4', () => {
    expect(formatPlan('auto')).toMatchObject({ container: 'mp4', videoCodecs: ['avc', 'vp9', 'av1'] });
    expect(formatPlan('mp4').audioCodecs[0]).toBe('aac');
  });
  it('webm picks VP9 / VP8 first with Opus', () => {
    expect(formatPlan('webm-vp9')).toMatchObject({ container: 'webm', videoCodecs: ['vp9', 'av1', 'vp8'], audioCodecs: ['opus', 'vorbis'] });
    expect(formatPlan('webm-vp8').videoCodecs[0]).toBe('vp8');
  });
});

describe('evenSize', () => {
  it('rounds odd dimensions down to even', () => {
    expect(evenSize(840, 899)).toEqual({ w: 840, h: 898 });
    expect(evenSize(1921, 1081)).toEqual({ w: 1920, h: 1080 });
    expect(evenSize(1, 1)).toEqual({ w: 2, h: 2 });
  });
});

describe('frameSlot', () => {
  it('captures one frame per slot at the target rate', () => {
    expect(frameSlot(0, 60, 0)).toEqual({ timestamp: 0, duration: 1 / 60, next: 1 });
    expect(frameSlot(0.016, 60, 1)).toBeNull(); // still inside slot 0
    const s = frameSlot(1 / 60 + 0.001, 60, 1)!;
    expect(s.timestamp).toBeCloseTo(1 / 60);
    expect(s.next).toBe(2);
  });
  it('skips frames rendered faster than the record rate', () => {
    // 120 Hz render, 30 fps record: three of every four renders are skipped.
    let next = 0; let captured = 0;
    for (let i = 0; i < 120; i++) {
      const s = frameSlot(i / 120, 30, next);
      if (s) { captured++; next = s.next; }
    }
    expect(captured).toBe(30);
  });
  it('holds a frame for missed slots when rendering falls behind, keeping real time', () => {
    const s = frameSlot(0.1, 60, 1)!; // slots 1..6 missed, now in slot 6
    expect(s.timestamp).toBeCloseTo(1 / 60);
    expect(s.duration).toBeCloseTo(6 / 60);
    expect(s.next).toBe(7);
    expect(s.timestamp + s.duration).toBeCloseTo(7 / 60);
  });
  it('total duration always equals elapsed slots', () => {
    let next = 0; let total = 0;
    for (const t of [0, 0.01, 0.05, 0.051, 0.2, 0.21, 0.5]) {
      const s = frameSlot(t, 60, next);
      if (s) { total += s.duration; next = s.next; }
    }
    expect(total).toBeCloseTo(next / 60);
  });
});

describe('describeEncode', () => {
  it('reads like a spec line', () => {
    expect(describeEncode('avc', 'quality', 40, 1920, 1080, 60)).toBe('H.264 High · constant quality · 1920×1080 · 60 fps');
    expect(describeEncode('vp9', 'bitrate', 40, 1280, 720, 30)).toBe('VP9 · 40 Mbps · 1280×720 · 30 fps');
  });
});
