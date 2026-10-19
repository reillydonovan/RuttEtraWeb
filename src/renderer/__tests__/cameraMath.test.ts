import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { lookAtEuler, continuousEuler, normalizeDeg, unwrapNear } from '../cameraMath';

const DEG = Math.PI / 180;

/** three's own answer for the same look-at, to prove the pure maths matches the renderer. */
function threeEuler(eye: number[], target: number[], up: number[]): number[] {
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(eye[0], eye[1], eye[2]);
  cam.up.set(up[0], up[1], up[2]);
  cam.lookAt(target[0], target[1], target[2]);
  const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

describe('camera transform maths', () => {
  it('the factory view tilts down ~8.75° and faces forward', () => {
    const [x, y, z] = lookAtEuler([0, 0.4, 2.6], [0, 0, 0], [0, 1, 0]);
    expect(x).toBeCloseTo(-8.746, 2);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('matches three.js for arbitrary views, including roll', () => {
    const cases: [number[], number[], number[]][] = [
      [[2.6, 0, 0], [0, 0, 0], [0, 1, 0]],
      [[1, 2, -3], [0.5, -0.2, 0.1], [0, 1, 0]],
      [[-1.5, 0.3, 0.8], [0, 0, 0], [Math.sin(0.4), Math.cos(0.4), 0]],
    ];
    for (const [eye, tgt, up] of cases) {
      const ours = lookAtEuler(eye as never, tgt as never, up as never);
      const ref = threeEuler(eye, tgt, up);
      for (let i = 0; i < 3; i++) expect(ours[i]).toBeCloseTo(ref[i], 4);
    }
  });

  it('wraps and unwraps whole turns', () => {
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-180)).toBe(180);
    expect(unwrapNear(-170, 175)).toBe(190);
    expect(unwrapNear(10, 725)).toBe(730);
  });

  it('keeps counting through the top instead of flipping yaw and roll', () => {
    // Pitched just past straight up: three reports (80, 180, 180) — the same view as (100, 0, 0).
    expect(continuousEuler([80, 180, 180], [95, 0, 0])).toEqual([100, 0, 0]);
    // A yaw spin past ±180 continues from the reference.
    expect(continuousEuler([0, -170, 0], [0, 175, 0])).toEqual([0, 190, 0]);
  });
});
