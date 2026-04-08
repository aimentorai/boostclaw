/**
 * Renderer Startup Timer Utility
 * Tracks elapsed time from renderer init for diagnostic logging
 */

const startTime = Date.now();

export const rendererTimer = {
  getElapsed(): number {
    return Date.now() - startTime;
  },

  mark(label: string): void {
    const elapsed = this.getElapsed();
    console.log(`[RENDERER] ${label}: ${elapsed}ms`);
  },

  reset(): void {
    // Not typically used in renderer, but included for consistency
  },

  complete(): void {
    const elapsed = this.getElapsed();
    console.log(`[RENDERER] === COMPLETE: ${elapsed}ms ===`);
  },
};
