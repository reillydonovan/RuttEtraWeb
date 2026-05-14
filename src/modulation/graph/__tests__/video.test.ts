import { describe, expect, it } from 'vitest';
import { runNode } from './helpers';

const fakeTap = {
  getLumaRegion:   (_r: { x: number; y: number; w: number; h: number }) => 0.6,
  getColorRegion:  (_r: { x: number; y: number; w: number; h: number }) => ({ h: 0.3, s: 0.7, v: 0.9 }),
  getMotionRegion: (_r: { x: number; y: number; w: number; h: number }) => 0.2,
  getEdgeDensity:  (_r: { x: number; y: number; w: number; h: number }) => 0.4,
  getRow:          (_y: number) => 0.55,
  getCol:          (_x: number) => 0.45,
};

describe('video stub nodes (no VideoTap)', () => {
  it('video-luma returns 0', () => {
    expect(runNode('video-luma', 1).out).toBe(0);
  });
  it('video-luma-row returns 0', () => {
    expect(runNode('video-luma-row', 1).out).toBe(0);
  });
  it('video-luma-col returns 0', () => {
    expect(runNode('video-luma-col', 1).out).toBe(0);
  });
  it('video-motion returns 0', () => {
    expect(runNode('video-motion', 1).out).toBe(0);
  });
  it('video-color returns 0/0/0 on each output', () => {
    const o = runNode('video-color', 1);
    expect(o.h).toBe(0); expect(o.s).toBe(0); expect(o.v).toBe(0);
  });
  it('video-edge returns 0', () => {
    expect(runNode('video-edge', 1).out).toBe(0);
  });
});

describe('video nodes (with VideoTap)', () => {
  it('video-luma reads from getLumaRegion and applies gain', () => {
    expect(runNode('video-luma', 1, { deps: { videoTap: fakeTap } }).out).toBeCloseTo(0.6);
  });
  it('video-color outputs h/s/v from getColorRegion', () => {
    const o = runNode('video-color', 1, { deps: { videoTap: fakeTap } });
    expect(o.h).toBeCloseTo(0.3);
    expect(o.s).toBeCloseTo(0.7);
    expect(o.v).toBeCloseTo(0.9);
  });
  it('video-motion clamps to 1', () => {
    const tap = { ...fakeTap, getMotionRegion: () => 5 };
    expect(runNode('video-motion', 1, { deps: { videoTap: tap }, params: { gain: 1 } }).out).toBe(1);
  });
  it('video-edge respects gain', () => {
    expect(runNode('video-edge', 1, {
      deps: { videoTap: fakeTap },
      params: { gain: 1 },
    }).out).toBeCloseTo(0.4);
  });
});
