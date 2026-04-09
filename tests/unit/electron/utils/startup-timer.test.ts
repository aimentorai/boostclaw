import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startupTimer } from '../../../../electron/utils/startup-timer';

describe('startup-timer', () => {
  beforeEach(() => {
    startupTimer.reset();
  });

  it('should track elapsed time since module load', () => {
    const elapsed = startupTimer.getElapsed();
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('should format mark output with label and time', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    startupTimer.mark('test_phase');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[STARTUP\] test_phase: \d+ms/)
    );
  });

  it('should return elapsed time from getElapsed', () => {
    const elapsed1 = startupTimer.getElapsed();
    expect(typeof elapsed1).toBe('number');
    expect(elapsed1).toBeGreaterThanOrEqual(0);
  });

  it('should reset timer', () => {
    vi.useFakeTimers();

    try {
      startupTimer.reset();
      vi.advanceTimersByTime(10);
      startupTimer.reset();

      const elapsed = startupTimer.getElapsed();
      expect(elapsed).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should log complete message with total time', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    startupTimer.complete();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[STARTUP\] === COMPLETE: \d+ms ===/)
    );
  });
});
