/**
 * Startup Timer Utility
 * Tracks elapsed time from app start for diagnostic logging
 */

export interface StartupTimer {
  getElapsed: () => number;
  mark: (label: string) => void;
  reset: () => void;
  complete: () => void;
}

class StartupTimerImpl implements StartupTimer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  getElapsed(): number {
    return Date.now() - this.startTime;
  }

  mark(label: string): void {
    const elapsed = this.getElapsed();
    console.log(`[STARTUP] ${label}: ${elapsed}ms`);
  }

  reset(): void {
    this.startTime = Date.now();
  }

  complete(): void {
    const elapsed = this.getElapsed();
    console.log(`[STARTUP] === COMPLETE: ${elapsed}ms ===`);
  }
}

export const startupTimer = new StartupTimerImpl();
