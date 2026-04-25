import { clearHistoryPoll, setLastChatEventAt } from './helpers';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { handleRuntimeEventState } from './runtime-event-handlers';

// End-to-end latency tracking for chat streaming performance diagnosis.
let _sendOrigin = 0; // performance.now() when sendMessage fires the RPC
let _firstDeltaAt = 0; // performance.now() when the first delta event arrives
let _deltaCount = 0; // total delta events received in current run

export function markSendOrigin(): void {
  _sendOrigin = performance.now();
  _firstDeltaAt = 0;
  _deltaCount = 0;
}

export function createRuntimeEventActions(
  set: ChatSet,
  get: ChatGet
): Pick<RuntimeActions, 'handleChatEvent'> {
  return {
    handleChatEvent: (event: Record<string, unknown>) => {
      const runId = String(event.runId || '');
      const eventState = String(event.state || '');
      const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
      const { activeRunId, currentSessionKey } = get();

      // Only process events for the current session (when sessionKey is present)
      if (eventSessionKey != null && eventSessionKey !== currentSessionKey) {
        console.log(
          `[perf] SKIP session mismatch: event=${eventSessionKey} current=${currentSessionKey}`
        );
        return;
      }

      // Only process events for the active run (or if no active run set)
      if (activeRunId && runId && runId !== activeRunId) {
        console.log(`[perf] SKIP runId mismatch: event=${runId} active=${activeRunId}`);
        return;
      }

      if (eventState === 'delta' && !activeRunId) {
        console.log(`[perf] WARN delta received but no activeRunId set`);
      }

      // ── Latency tracking ──
      if (eventState === 'delta') {
        _deltaCount++;
        if (!_firstDeltaAt) {
          _firstDeltaAt = performance.now();
          if (_sendOrigin) {
            const ttfb = _firstDeltaAt - _sendOrigin;
            console.log(`[perf] Time to first token: ${ttfb.toFixed(0)}ms`);
          }
        }
      }
      if (eventState === 'final' && _firstDeltaAt) {
        const elapsed = performance.now() - _sendOrigin;
        console.log(
          `[perf] Stream complete: ${elapsed.toFixed(0)}ms total, ` +
            `${_deltaCount} deltas, ${(elapsed / Math.max(_deltaCount, 1)).toFixed(1)}ms/delta avg`
        );
        _sendOrigin = 0;
      }

      setLastChatEventAt(Date.now());

      // Defensive: if state is missing but we have a message, try to infer state.
      let resolvedState = eventState;
      if (!resolvedState && event.message && typeof event.message === 'object') {
        const msg = event.message as Record<string, unknown>;
        const stopReason = msg.stopReason ?? msg.stop_reason;
        if (stopReason) {
          resolvedState = 'final';
        } else if (msg.role || msg.content) {
          resolvedState = 'delta';
        }
      }

      // Only pause the history poll when we receive actual streaming data.
      // The gateway sends "agent" events with { phase, startedAt } that carry
      // no message — these must NOT kill the poll, since the poll is our only
      // way to track progress when the gateway doesn't stream intermediate turns.
      const hasUsefulData =
        resolvedState === 'delta' ||
        resolvedState === 'final' ||
        resolvedState === 'error' ||
        resolvedState === 'aborted';
      if (hasUsefulData) {
        clearHistoryPoll();
        // Adopt run started from another client (e.g. console at 127.0.0.1:18789):
        // show loading/streaming in the app when this session has an active run.
        const { sending } = get();
        if (!sending && runId) {
          set({ sending: true, activeRunId: runId, error: null });
        }
      }

      handleRuntimeEventState(set, get, event, resolvedState, runId);
    },
  };
}
