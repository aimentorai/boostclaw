import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function parseSafeAgentSessionKey(sessionKey: unknown): { agentId: string } | null {
  if (typeof sessionKey !== 'string') return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3 || parts[0] !== 'agent') return null;
  const [, agentId, ...suffixParts] = parts;
  if (!SAFE_SESSION_SEGMENT.test(agentId)) return null;
  if (suffixParts.length === 0 || suffixParts.some((part) => !SAFE_SESSION_SEGMENT.test(part))) {
    return null;
  }
  return { agentId };
}

async function resolveSessionTranscriptPath(sessionKey: string): Promise<string | null> {
  const parsedSession = parseSafeAgentSessionKey(sessionKey);
  if (!parsedSession) return null;

  const { agentId } = parsedSession;
  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  const fsP = await import('node:fs/promises');
  const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  const sessionsJson = JSON.parse(raw) as Record<string, unknown>;

  let uuidFileName: string | undefined;
  let resolvedSrcPath: string | undefined;

  if (Array.isArray(sessionsJson.sessions)) {
    const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
    if (entry) {
      uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (!uuidFileName && typeof entry.id === 'string') {
        uuidFileName = `${entry.id}.jsonl`;
      }
    }
  }

  if (!uuidFileName && sessionsJson[sessionKey] != null) {
    const val = sessionsJson[sessionKey];
    if (typeof val === 'string') {
      uuidFileName = val;
    } else if (typeof val === 'object' && val !== null) {
      const entry = val as Record<string, unknown>;
      const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (absFile) {
        if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
          resolvedSrcPath = absFile;
        } else {
          uuidFileName = absFile;
        }
      } else {
        const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
        if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
      }
    }
  }

  if (resolvedSrcPath) return resolvedSrcPath;
  if (!uuidFileName) return null;
  if (!uuidFileName.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
  return join(sessionsDir, uuidFileName);
}

async function loadTranscriptMessages(transcriptPath: string): Promise<unknown[]> {
  const fsP = await import('node:fs/promises');
  const raw = await fsP.readFile(transcriptPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.flatMap((line) => {
    try {
      const entry = JSON.parse(line) as { type?: string; message?: unknown };
      return entry.type === 'message' && entry.message ? [entry.message] : [];
    } catch {
      return [];
    }
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractSessionStoreEntries(store: Record<string, unknown>): Array<{
  key?: string;
  entry: Record<string, unknown>;
}> {
  const directEntries = Object.entries(store)
    .filter(([key, value]) => key !== 'sessions' && value && typeof value === 'object')
    .map(([key, value]) => ({ key, entry: value as Record<string, unknown> }));
  const arrayEntries = Array.isArray(store.sessions)
    ? store.sessions
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
        .map((entry) => ({ key: readString(entry.key) || readString(entry.sessionKey), entry }))
    : [];
  return [...directEntries, ...arrayEntries];
}

async function listLocalSessions(): Promise<Array<Record<string, unknown>>> {
  const fsP = await import('node:fs/promises');
  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  const agentDirs = await fsP.readdir(agentsDir, { withFileTypes: true }).catch(() => []);
  const sessions: Array<Record<string, unknown>> = [];

  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue;
    if (!SAFE_SESSION_SEGMENT.test(agentDir.name)) continue;

    const sessionsDir = join(agentsDir, agentDir.name, 'sessions');
    const sessionsJsonPath = join(sessionsDir, 'sessions.json');
    const raw = await fsP.readFile(sessionsJsonPath, 'utf8').catch(() => '');
    if (!raw.trim()) continue;

    let store: Record<string, unknown>;
    try {
      store = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    for (const { key: entryKey, entry } of extractSessionStoreEntries(store)) {
      const key = readString(entryKey) || readString(entry.key) || readString(entry.sessionKey);
      if (!key || !parseSafeAgentSessionKey(key)) continue;

      const fileName = readString(entry.file)
        || readString(entry.fileName)
        || readString(entry.path)
        || readString(entry.sessionFile);
      if (fileName?.includes('.deleted.jsonl')) continue;

      let updatedAt = readTimestampMs(entry.updatedAt)
        || readTimestampMs(entry.lastActivityAt)
        || readTimestampMs(entry.lastMessageAt)
        || readTimestampMs(entry.createdAt);

      if (!updatedAt && fileName && !fileName.startsWith('/') && !fileName.match(/^[A-Za-z]:\\/)) {
        const normalizedFileName = fileName.endsWith('.jsonl') ? fileName : `${fileName}.jsonl`;
        const stat = await fsP.stat(join(sessionsDir, normalizedFileName)).catch(() => null);
        updatedAt = stat?.mtimeMs;
      }

      sessions.push({
        key,
        label: readString(entry.label),
        displayName: readString(entry.displayName) || readString(entry.name),
        thinkingLevel: readString(entry.thinkingLevel),
        model: readString(entry.model),
        updatedAt,
      });
    }
  }

  return sessions;
}

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/sessions/transcript' && req.method === 'GET') {
    try {
      const agentId = url.searchParams.get('agentId')?.trim() || '';
      const sessionId = url.searchParams.get('sessionId')?.trim() || '';
      if (!agentId || !sessionId) {
        sendJson(res, 400, { success: false, error: 'agentId and sessionId are required' });
        return true;
      }
      if (!SAFE_SESSION_SEGMENT.test(agentId) || !SAFE_SESSION_SEGMENT.test(sessionId)) {
        sendJson(res, 400, { success: false, error: 'Invalid transcript identifier' });
        return true;
      }

      const transcriptPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
      const messages = await loadTranscriptMessages(transcriptPath);

      sendJson(res, 200, { success: true, messages });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        sendJson(res, 404, { success: false, error: 'Transcript not found' });
      } else {
        sendJson(res, 500, { success: false, error: 'Failed to load transcript' });
      }
    }
    return true;
  }

  if (url.pathname === '/api/sessions/history' && req.method === 'GET') {
    try {
      const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
      if (!sessionKey) {
        sendJson(res, 400, { success: false, error: 'sessionKey is required' });
        return true;
      }

      const transcriptPath = await resolveSessionTranscriptPath(sessionKey);
      if (!transcriptPath) {
        sendJson(res, 404, { success: false, error: 'Transcript not found' });
        return true;
      }

      const messages = await loadTranscriptMessages(transcriptPath);
      sendJson(res, 200, { success: true, messages });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        sendJson(res, 404, { success: false, error: 'Transcript not found' });
      } else {
        sendJson(res, 500, { success: false, error: 'Failed to load session history' });
      }
    }
    return true;
  }

  if (url.pathname === '/api/sessions/list' && req.method === 'GET') {
    sendJson(res, 200, { success: true, sessions: await listLocalSessions() });
    return true;
  }

  if (url.pathname === '/api/sessions/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string }>(req);
      const sessionKey = body.sessionKey;
      const parsedSession = parseSafeAgentSessionKey(sessionKey);
      if (!parsedSession) {
        sendJson(res, 400, { success: false, error: 'Invalid session key' });
        return true;
      }
      const { agentId } = parsedSession;
      const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
      const sessionsJsonPath = join(sessionsDir, 'sessions.json');
      const fsP = await import('node:fs/promises');
      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      const sessionsJson = JSON.parse(raw) as Record<string, unknown>;

      let uuidFileName: string | undefined;
      let resolvedSrcPath: string | undefined;
      if (Array.isArray(sessionsJson.sessions)) {
        const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
          .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
        if (entry) {
          uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (!uuidFileName && typeof entry.id === 'string') {
            uuidFileName = `${entry.id}.jsonl`;
          }
        }
      }
      if (!uuidFileName && sessionsJson[sessionKey] != null) {
        const val = sessionsJson[sessionKey];
        if (typeof val === 'string') {
          uuidFileName = val;
        } else if (typeof val === 'object' && val !== null) {
          const entry = val as Record<string, unknown>;
          const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (absFile) {
            if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
              resolvedSrcPath = absFile;
            } else {
              uuidFileName = absFile;
            }
          } else {
            const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
            if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
          }
        }
      }
      if (!uuidFileName && !resolvedSrcPath) {
        sendJson(res, 404, { success: false, error: `Cannot resolve file for session: ${sessionKey}` });
        return true;
      }
      if (!resolvedSrcPath) {
        if (!uuidFileName!.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
        resolvedSrcPath = join(sessionsDir, uuidFileName!);
      }
      const dstPath = resolvedSrcPath.replace(/\.jsonl$/, '.deleted.jsonl');
      try {
        await fsP.access(resolvedSrcPath);
        await fsP.rename(resolvedSrcPath, dstPath);
      } catch {
        sendJson(res, 500, { success: false, error: 'Failed to delete session' });
        return true;
      }
      const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
      const json2 = JSON.parse(raw2) as Record<string, unknown>;
      if (Array.isArray(json2.sessions)) {
        json2.sessions = (json2.sessions as Array<Record<string, unknown>>)
          .filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
      } else if (json2[sessionKey]) {
        delete json2[sessionKey];
      }
      await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
      sendJson(res, 200, { success: true });
    } catch {
      sendJson(res, 500, { success: false, error: 'Failed to delete session' });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/rename' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; label: string }>(req);
      const sessionKey = body.sessionKey;
      const label = String(body.label ?? '').trim().slice(0, 80);
      const parsedSession = parseSafeAgentSessionKey(sessionKey);
      if (!parsedSession) {
        sendJson(res, 400, { success: false, error: 'Invalid session key' });
        return true;
      }
      if (!label) {
        sendJson(res, 400, { success: false, error: 'label is required' });
        return true;
      }

      const { agentId } = parsedSession;
      const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
      const sessionsJsonPath = join(sessionsDir, 'sessions.json');
      const fsP = await import('node:fs/promises');
      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      const sessionsJson = JSON.parse(raw) as Record<string, unknown>;
      let updated = false;

      if (Array.isArray(sessionsJson.sessions)) {
        sessionsJson.sessions = (sessionsJson.sessions as Array<Record<string, unknown>>).map((entry) => {
          if (entry.key !== sessionKey && entry.sessionKey !== sessionKey) return entry;
          updated = true;
          return { ...entry, label, displayName: label };
        });
      } else if (sessionsJson[sessionKey]) {
        const value = sessionsJson[sessionKey];
        if (typeof value === 'object' && value !== null) {
          sessionsJson[sessionKey] = {
            ...(value as Record<string, unknown>),
            label,
            displayName: label,
          };
          updated = true;
        }
      }

      if (!updated) {
        sendJson(res, 404, { success: false, error: 'Session not found' });
        return true;
      }

      await fsP.writeFile(sessionsJsonPath, JSON.stringify(sessionsJson, null, 2), 'utf8');
      sendJson(res, 200, { success: true });
    } catch {
      sendJson(res, 500, { success: false, error: 'Failed to rename session' });
    }
    return true;
  }

  return false;
}
