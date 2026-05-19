import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { getCanonicalPrefixFromSessions, getMessageText, isInternalMessage, toMs } from './helpers';
import {
  CHAT_HISTORY_RPC_TIMEOUT_MS,
  loadSessionTranscriptFallbackMessages,
} from './history-actions';
import { DEFAULT_CANONICAL_PREFIX, DEFAULT_SESSION_KEY, type ChatSession, type RawMessage } from './types';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function parseSessionUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMs(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

const SIDEBAR_LABEL_HISTORY_LIMIT = 50;
const SIDEBAR_LABEL_HISTORY_TIMEOUT_MS = 8_000;
const SIDEBAR_LABEL_HISTORY_CONCURRENCY = 2;

type SessionListResult = {
  success?: boolean;
  result?: Record<string, unknown>;
  sessions?: unknown;
  error?: string;
};

async function loadShortSessionHistory(sessionKey: string, limit: number): Promise<RawMessage[]> {
  const localMessages = await loadSessionTranscriptFallbackMessages(sessionKey);
  if (localMessages.length > 0) {
    return localMessages.slice(0, limit);
  }

  try {
    const r = (await invokeIpc(
      'gateway:rpc',
      'chat.history',
      { sessionKey, limit },
      Math.min(SIDEBAR_LABEL_HISTORY_TIMEOUT_MS, CHAT_HISTORY_RPC_TIMEOUT_MS)
    )) as { success: boolean; result?: Record<string, unknown> };
    if (r.success && r.result && Array.isArray(r.result.messages)) {
      return r.result.messages as RawMessage[];
    }
  } catch {
    return [];
  }
  return [];
}

async function hydrateSidebarSessionMetadata(
  sessions: ChatSession[],
  set: ChatSet,
  get: ChatGet
): Promise<void> {
  const candidates = [...sessions]
    .filter((session) => {
      if (get().sessionLabels[session.key] || session.label) return false;
      return true;
    })
    .sort((left, right) => {
      const leftActivity =
        (typeof left.updatedAt === 'number' ? left.updatedAt : undefined) ??
        get().sessionLastActivity[left.key] ??
        0;
      const rightActivity =
        (typeof right.updatedAt === 'number' ? right.updatedAt : undefined) ??
        get().sessionLastActivity[right.key] ??
        0;
      return rightActivity - leftActivity;
    });

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < candidates.length) {
      const session = candidates[nextIndex++];
      if (!session) continue;

      try {
        const msgs = await loadShortSessionHistory(session.key, SIDEBAR_LABEL_HISTORY_LIMIT);
        const firstUser =
          msgs.find(
            (m) => m.role === 'user' && getMessageText(m.content).trim() && !isInternalMessage(m)
          ) ??
          [...msgs].reverse().find(
            (m) => m.role === 'user' && getMessageText(m.content).trim() && !isInternalMessage(m)
          );
        const lastMsg = msgs[msgs.length - 1];
        if (!firstUser && !lastMsg?.timestamp) continue;

        set((s) => {
          const next: Partial<typeof s> = {};
          if (firstUser && !s.sessionLabels[session.key]) {
            const labelText = stripSkillContext(getMessageText(firstUser.content)).trim();
            if (labelText) {
              const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
              next.sessionLabels = { ...s.sessionLabels, [session.key]: truncated };
            }
          }
          if (lastMsg?.timestamp && !s.sessionLastActivity[session.key]) {
            next.sessionLastActivity = {
              ...s.sessionLastActivity,
              [session.key]: toMs(lastMsg.timestamp),
            };
          }
          return next;
        });
      } catch {
        // Sidebar metadata is best-effort; foreground history loading handles user-visible errors.
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(SIDEBAR_LABEL_HISTORY_CONCURRENCY, candidates.length) },
      () => worker()
    )
  );
}

function normalizeRawSessions(rawSessions: unknown): ChatSession[] {
  return (Array.isArray(rawSessions) ? rawSessions : [])
    .map((s: Record<string, unknown>) => ({
      key: String(s.key || ''),
      label: s.label ? String(s.label) : undefined,
      displayName: s.displayName ? String(s.displayName) : undefined,
      thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
      model: s.model ? String(s.model) : undefined,
      updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
    }))
    .filter((s: ChatSession) => s.key);
}

function stripSkillContext(text: string): string {
  const match = text.match(/<user_request>\n?([\s\S]*?)\n?<\/user_request>/);
  if (match) return match[1].trim();
  return text;
}

function applySessionList(
  sessions: ChatSession[],
  set: ChatSet,
  get: ChatGet,
): void {
  const canonicalBySuffix = new Map<string, string>();
  for (const session of sessions) {
    if (!session.key.startsWith('agent:')) continue;
    const parts = session.key.split(':');
    if (parts.length < 3) continue;
    const suffix = parts.slice(2).join(':');
    if (suffix && !canonicalBySuffix.has(suffix)) {
      canonicalBySuffix.set(suffix, session.key);
    }
  }

  // Deduplicate: if both short and canonical existed, keep canonical only
  const seen = new Set<string>();
  const dedupedSessions = sessions.filter((s) => {
    if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });

  const { currentSessionKey } = get();
  let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
  if (!nextSessionKey.startsWith('agent:')) {
    const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
    if (canonicalMatch) {
      nextSessionKey = canonicalMatch;
    }
  }
  if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
    // Current session not found in the backend list
    const isNewEmptySession = get().messages.length === 0;
    if (!isNewEmptySession) {
      nextSessionKey = dedupedSessions[0].key;
    }
  }

  const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
    ? [
      ...dedupedSessions,
      { key: nextSessionKey, displayName: nextSessionKey },
    ]
    : dedupedSessions;

  const discoveredActivity = Object.fromEntries(
    sessionsWithCurrent
      .filter((session) => typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt))
      .map((session) => [session.key, session.updatedAt!]),
  );

  set((state) => ({
    sessions: sessionsWithCurrent,
    currentSessionKey: nextSessionKey,
    currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
    sessionLastActivity: {
      ...state.sessionLastActivity,
      ...discoveredActivity,
    },
  }));

  if (currentSessionKey !== nextSessionKey) {
    get().loadHistory();
  }

  void hydrateSidebarSessionMetadata(sessionsWithCurrent, set, get);
}

export function createSessionActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadSessions' | 'switchSession' | 'newSession' | 'renameSession' | 'deleteSession' | 'cleanupEmptySession'> {
  return {
    loadSessions: async () => {
      try {
        const localResult = await hostApiFetch<SessionListResult>('/api/sessions/list').catch(() => null);
        if (localResult && Array.isArray(localResult.sessions)) {
          const localSessions = normalizeRawSessions(localResult.sessions);
          if (localSessions.length > 0) {
            applySessionList(localSessions, set, get);
          }
        }

        const result = await invokeIpc(
          'gateway:rpc',
          'sessions.list',
          {}
        ) as { success: boolean; result?: Record<string, unknown>; error?: string };

        if (result.success && result.result) {
          const data = result.result;
          applySessionList(normalizeRawSessions(data.sessions), set, get);
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err);
      }
    },

    // ── Switch session ──

    switchSession: (key: string) => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only treat sessions with no history records and no activity timestamp as empty.
      // Relying solely on messages.length is unreliable because switchSession clears
      // the current messages before loadHistory runs, creating a race condition that
      // could cause sessions with real history to be incorrectly removed from the sidebar.
      const leavingEmpty = !currentSessionKey.endsWith(':main')
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      set((s) => ({
        currentSessionKey: key,
        currentAgentId: getAgentIdFromSessionKey(key),
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        ...(leavingEmpty ? {
          sessions: s.sessions.filter((s) => s.key !== currentSessionKey),
          sessionLabels: Object.fromEntries(
            Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
          ),
          sessionLastActivity: Object.fromEntries(
            Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
          ),
        } : {}),
      }));
      get().loadHistory();
    },

    // ── Rename session ──

    renameSession: async (key: string, label: string) => {
      const trimmed = label.trim().slice(0, 80);
      if (!trimmed) return;

      set((state) => ({
        sessionLabels: {
          ...state.sessionLabels,
          [key]: trimmed,
        },
        sessions: state.sessions.map((session) =>
          session.key === key ? { ...session, label: trimmed, displayName: trimmed } : session
        ),
      }));

      try {
        const result = await invokeIpc('session:rename', key, trimmed) as {
          success: boolean;
          error?: string;
        };
        if (!result.success) {
          console.warn(`[renameSession] IPC reported failure for ${key}:`, result.error);
        }
      } catch (err) {
        console.warn(`[renameSession] IPC call failed for ${key}:`, err);
      }
    },

    // ── Delete session ──
    //
    // NOTE: The OpenClaw Gateway does NOT expose a sessions.delete (or equivalent)
    // RPC — confirmed by inspecting client.ts, protocol.ts and the full codebase.
    // Deletion is therefore a local-only UI operation: the session is removed from
    // the sidebar list and its labels/activity maps are cleared.  The underlying
    // JSONL history file on disk is intentionally left intact, consistent with the
    // newSession() design that avoids sessions.reset to preserve history.

    deleteSession: async (key: string) => {
      // Soft-delete the session's JSONL transcript on disk.
      // The main process renames <suffix>.jsonl → <suffix>.deleted.jsonl so that
      // sessions.list skips it automatically.
      try {
        const result = await invokeIpc('session:delete', key) as {
          success: boolean;
          error?: string;
        };
        if (!result.success) {
          console.warn(`[deleteSession] IPC reported failure for ${key}:`, result.error);
        }
      } catch (err) {
        console.warn(`[deleteSession] IPC call failed for ${key}:`, err);
      }

      const { currentSessionKey, sessions } = get();
      const remaining = sessions.filter((s) => s.key !== key);

      if (currentSessionKey === key) {
        // Switched away from deleted session — pick the first remaining or create new
        const next = remaining[0];
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
          messages: [],
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
          currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
        }));
        if (next) {
          get().loadHistory();
        }
      } else {
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
        }));
      }
    },

    // ── New session ──

    newSession: () => {
      // Generate a new unique session key and switch to it.
      // NOTE: We intentionally do NOT call sessions.reset on the old session.
      // sessions.reset archives (renames) the session JSONL file, making old
      // conversation history inaccessible when the user switches back to it.
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only treat sessions with no history records and no activity timestamp as empty
      const leavingEmpty = !currentSessionKey.endsWith(':main')
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      const prefix = getCanonicalPrefixFromSessions(get().sessions) ?? DEFAULT_CANONICAL_PREFIX;
      const newKey = `${prefix}:session-${Date.now()}`;
      const newSessionEntry: ChatSession = { key: newKey };
      set((s) => ({
        currentSessionKey: newKey,
        currentAgentId: getAgentIdFromSessionKey(newKey),
        sessions: [
          ...(leavingEmpty ? s.sessions.filter((sess) => sess.key !== currentSessionKey) : s.sessions),
          newSessionEntry,
        ],
        sessionLabels: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
          : s.sessionLabels,
        sessionLastActivity: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey))
          : s.sessionLastActivity,
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
      }));
    },

    // ── Cleanup empty session on navigate away ──

    cleanupEmptySession: () => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only remove non-main sessions that were never used (no messages sent).
      // This mirrors the "leavingEmpty" logic in switchSession so that creating
      // a new session and immediately navigating away doesn't leave a ghost entry
      // in the sidebar.
      // Also check sessionLastActivity and sessionLabels comprehensively to prevent
      // falsely treating sessions with history as empty due to switchSession clearing messages early.
      const isEmptyNonMain = !currentSessionKey.endsWith(':main')
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      if (!isEmptyNonMain) return;
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.key !== currentSessionKey),
        sessionLabels: Object.fromEntries(
          Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
        ),
        sessionLastActivity: Object.fromEntries(
          Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
        ),
      }));
    },

    // ── Load chat history ──

  };
}
