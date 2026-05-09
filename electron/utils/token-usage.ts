import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';
import { listConfiguredAgentIds } from './agent-config';

const TOKEN_USAGE_CACHE_TTL_MS = 20_000;

type TokenUsageCacheEntry = {
  createdAt: number;
  entries: TokenUsageHistoryEntry[];
};

const tokenUsageCache = new Map<string, TokenUsageCacheEntry>();
const tokenUsageInFlight = new Map<string, Promise<TokenUsageHistoryEntry[]>>();

export {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';

async function listAgentIdsWithSessionDirs(): Promise<string[]> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');
  const agentIds = new Set<string>();

  try {
    for (const agentId of await listConfiguredAgentIds()) {
      const normalized = agentId.trim();
      if (normalized) {
        agentIds.add(normalized);
      }
    }
  } catch {
    // Ignore config discovery failures and fall back to disk scan.
  }

  try {
    const agentEntries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (entry.isDirectory()) {
        const normalized = entry.name.trim();
        if (normalized) {
          agentIds.add(normalized);
        }
      }
    }
  } catch {
    // Ignore disk discovery failures and return whatever we already found.
  }

  return [...agentIds];
}

async function listRecentSessionFiles(): Promise<Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }>> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');

  try {
    const agentEntries = await listAgentIdsWithSessionDirs();
    const files: Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }> = [];

    for (const agentId of agentEntries) {
      const sessionsDir = join(agentsDir, agentId, 'sessions');
      try {
        const sessionEntries = await readdir(sessionsDir);

        for (const fileName of sessionEntries) {
          const sessionId = extractSessionIdFromTranscriptFileName(fileName);
          if (!sessionId) continue;
          const filePath = join(sessionsDir, fileName);
          try {
            const fileStat = await stat(filePath);
            files.push({
              filePath,
              sessionId,
              agentId,
              mtimeMs: fileStat.mtimeMs,
            });
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files;
  } catch {
    return [];
  }
}

function normalizeUsageLimit(limit?: number): number {
  return typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;
}

function usageCacheKey(maxEntries: number): string {
  return Number.isFinite(maxEntries) ? String(maxEntries) : 'all';
}

export async function getRecentTokenUsageHistory(limit?: number): Promise<TokenUsageHistoryEntry[]> {
  const maxEntries = normalizeUsageLimit(limit);
  const cacheKey = usageCacheKey(maxEntries);
  const now = Date.now();
  const cached = tokenUsageCache.get(cacheKey);
  if (cached && now - cached.createdAt < TOKEN_USAGE_CACHE_TTL_MS) {
    return cached.entries.map((entry) => ({ ...entry }));
  }

  const existingLoad = tokenUsageInFlight.get(cacheKey);
  if (existingLoad) {
    const entries = await existingLoad;
    return entries.map((entry) => ({ ...entry }));
  }

  const loadPromise = readRecentTokenUsageHistory(maxEntries);
  tokenUsageInFlight.set(cacheKey, loadPromise);
  try {
    const entries = await loadPromise;
    tokenUsageCache.set(cacheKey, {
      createdAt: Date.now(),
      entries: entries.map((entry) => ({ ...entry })),
    });
    return entries;
  } finally {
    tokenUsageInFlight.delete(cacheKey);
  }
}

async function readRecentTokenUsageHistory(maxEntries: number): Promise<TokenUsageHistoryEntry[]> {
  const files = await listRecentSessionFiles();
  const results: TokenUsageHistoryEntry[] = [];

  for (const file of files) {
    if (results.length >= maxEntries) break;
    try {
      const content = await readFile(file.filePath, 'utf8');
      const entries = parseUsageEntriesFromJsonl(content, {
        sessionId: file.sessionId,
        agentId: file.agentId,
      }, Number.isFinite(maxEntries) ? maxEntries - results.length : undefined);
      results.push(...entries);
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? results.slice(0, maxEntries) : results;
}
