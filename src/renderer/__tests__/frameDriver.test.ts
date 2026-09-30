import { describe, it, expect } from 'vitest';
import { shouldDriveBackup, STALL_MS } from '../frameDriver';

describe('frameDriver.shouldDriveBackup', () => {
  it('stays out of the way while the main loop is ticking', () => {
    expect(shouldDriveBackup(1000, 1000 - 16)).toBe(false);
    expect(shouldDriveBackup(1000, 1000 - STALL_MS)).toBe(false);
  });
  it('takes over once the main loop has stalled', () => {
    expect(shouldDriveBackup(1000, 1000 - STALL_MS - 1)).toBe(true);
    expect(shouldDriveBackup(5000, 0)).toBe(true);
  });
});
