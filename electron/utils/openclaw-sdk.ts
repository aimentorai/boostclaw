/**
 * Dynamic imports for openclaw extension internals.
 *
 * openclaw is NOT in the asar's node_modules — it lives at resources/openclaw/
 * (extraResources).  Static `import ... from 'openclaw/plugin-sdk/...'` would
 * produce a runtime require() that fails inside the asar.
 *
 * openclaw 4.23 removed the `plugin-sdk/{channel}` subpath exports.
 * We now load directly from the stable `dist/extensions/{channel}/` paths:
 *   - directory-contract-api.js  (stable, no content hash)
 *   - normalize-*.js             (hashed, found at runtime via readdir)
 */
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

const _openclawPath = getOpenClawDir();
const _openclawResolvedPath = getOpenClawResolvedDir();

function requireFromExtensions<T = Record<string, unknown>>(subpath: string): T | null {
  for (const base of [_openclawResolvedPath, _openclawPath]) {
    try {
      return require(join(base, 'dist', 'extensions', subpath)) as T;
    } catch {
      // try next base
    }
  }
  return null;
}

/**
 * Find a file in a channel's extension directory by prefix pattern
 * and require it.  Used for hashed filenames like `normalize-Wb6YkZe1.js`.
 */
function requireMatchingFile<T = Record<string, unknown>>(
  channel: string,
  filePrefix: string
): T | null {
  for (const base of [_openclawResolvedPath, _openclawPath]) {
    try {
      const dir = join(base, 'dist', 'extensions', channel);
      const files = readdirSync(dir);
      const match = files.find((f) => f.startsWith(filePrefix) && f.endsWith('.js'));
      if (match) return require(join(dir, match)) as T;
    } catch {
      // try next base
    }
  }
  return null;
}

// --- Discord ---
const _discordDir = requireFromExtensions<{
  listDiscordDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listDiscordDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
}>('discord/directory-contract-api.js');

const _discordNorm = requireMatchingFile<{
  n: (raw: string) => string | undefined;
}>('discord', 'normalize-');

// --- Telegram ---
const _telegramDir = requireFromExtensions<{
  listTelegramDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listTelegramDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
}>('telegram/directory-contract-api.js');

// Telegram normalize depends on grammy which isn't available outside openclaw's
// full dependency tree.  The heavy parse logic lives in the channel file, but
// for the directory use-case (normalizing IDs returned by the directory API)
// a lightweight inline normalizer suffices — the caller falls back to entry.id
// when the normalizer returns undefined.
const TELEGRAM_PREFIX_RE = /^telegram:/i;
function normalizeTelegramMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return;
  const stripped = trimmed.replace(TELEGRAM_PREFIX_RE, '').trim();
  if (!stripped) return;
  return `telegram:${stripped}`.toLowerCase();
}

// --- Slack ---
const _slackDir = requireFromExtensions<{
  listSlackDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listSlackDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
}>('slack/directory-contract-api.js');

const _slackNorm = requireMatchingFile<{
  n: (raw: string) => string | undefined;
}>('slack', 'target-parsing-');

// --- WhatsApp ---
// Directory functions are stubbed locally in channels.ts; only load normalize.

const _whatsappNorm = requireMatchingFile<{
  a: (raw: string) => string | undefined;
}>('whatsapp', 'normalize-target-');

// --- Exports (with null-safe fallbacks) ---

export const listDiscordDirectoryGroupsFromConfig =
  _discordDir?.listDiscordDirectoryGroupsFromConfig;
export const listDiscordDirectoryPeersFromConfig = _discordDir?.listDiscordDirectoryPeersFromConfig;
export const normalizeDiscordMessagingTarget = _discordNorm?.n;

export const listTelegramDirectoryGroupsFromConfig =
  _telegramDir?.listTelegramDirectoryGroupsFromConfig;
export const listTelegramDirectoryPeersFromConfig =
  _telegramDir?.listTelegramDirectoryPeersFromConfig;
// normalizeTelegramMessagingTarget is the inline function defined above
export { normalizeTelegramMessagingTarget };

export const listSlackDirectoryGroupsFromConfig = _slackDir?.listSlackDirectoryGroupsFromConfig;
export const listSlackDirectoryPeersFromConfig = _slackDir?.listSlackDirectoryPeersFromConfig;
export const normalizeSlackMessagingTarget = _slackNorm?.n;

export const normalizeWhatsAppMessagingTarget = _whatsappNorm?.a;
