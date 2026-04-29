/**
 * MCP Server Config Store
 *
 * Manages MCP server entries in ~/.boostclaw/openclaw/openclaw.json under `mcp.servers`.
 * Uses the shared config mutex (`withConfigLock`) to prevent races with other
 * writers (subscription sync, skill-config, channel-config, etc.).
 *
 * Servers from the subscription endpoint are marked `subscription: true` and
 * should not be removable or have their critical fields edited by the user.
 */
import { isDeepStrictEqual } from 'node:util';
import { readOpenClawConfig, writeOpenClawConfig } from '../../utils/channel-config';
import { withConfigLock } from '../../utils/config-mutex';
import { logger } from '../../utils/logger';

// ── Types ───────────────────────────────────────────────────────────

export type McpServerTransport = 'stdio' | 'sse' | 'streamable-http';

export interface McpServerEntry {
  /** Unique server name (key in mcp.servers). */
  name: string;
  /** Transport type. Defaults to 'stdio' when absent. */
  transport: McpServerTransport;
  /** stdio: executable path. */
  command?: string;
  /** stdio: command arguments. */
  args?: string[];
  /** stdio: environment variables. */
  env?: Record<string, string>;
  /** sse / streamable-http: server URL. */
  url?: string;
  /** sse / streamable-http: custom headers (may contain API keys — mask in UI). */
  headers?: Record<string, string>;
  /** Whether this server is enabled. Defaults to true when absent. */
  enabled?: boolean;
  /** Set by subscription sync — user cannot delete or edit critical fields. */
  subscription?: boolean;
}

export interface McpServerSummary {
  name: string;
  transport: McpServerTransport;
  enabled: boolean;
  subscription: boolean;
  /** Whether url/command is populated */
  configured: boolean;
  /** Masked url or command path for display */
  preview: string;
}

export interface McpServerListResult {
  servers: McpServerSummary[];
}

export type McpServerSaveResult = {
  success: true;
  server: McpServerSummary;
} | {
  success: false;
  error: string;
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Extract the mcp.servers dictionary from the config (never mutates). */
function getServersFromConfig(config: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const mcp = config.mcp;
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) return {};
  const servers = (mcp as Record<string, unknown>).servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
  return servers as Record<string, Record<string, unknown>>;
}

function normalizeTransport(entry: Record<string, unknown>): McpServerTransport {
  const transport = entry.transport || entry.type;
  if (typeof transport === 'string') {
    const lower = transport.toLowerCase();
    if (lower === 'sse' || lower === 'streamable-http' || lower === 'stdio') {
      return lower as McpServerTransport;
    }
  }
  // Infer: if it has a url, it's sse; otherwise stdio (default for OpenClaw MCP).
  if (typeof entry.url === 'string' && entry.url.length > 0) return 'sse';
  return 'stdio';
}

function isSubscriptionServer(entry: Record<string, unknown>): boolean {
  return entry.subscription === true;
}

function serverToSummary(name: string, entry: Record<string, unknown>): McpServerSummary {
  const transport = normalizeTransport(entry);
  const enabled = entry.enabled !== false;
  const subscription = isSubscriptionServer(entry);
  const configured = transport === 'stdio'
    ? typeof entry.command === 'string' && entry.command.length > 0
    : typeof entry.url === 'string' && entry.url.length > 0;
  const preview = transport === 'stdio'
    ? (typeof entry.command === 'string' ? entry.command : '')
    : (typeof entry.url === 'string' ? entry.url : '');
  return { name, transport, enabled, subscription, configured, preview };
}

function serverToEntry(name: string, entry: Record<string, unknown>): McpServerEntry {
  const transport = normalizeTransport(entry);
  return {
    name,
    transport,
    command: typeof entry.command === 'string' ? entry.command : undefined,
    args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
    env: entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
      ? entry.env as Record<string, string> : undefined,
    url: typeof entry.url === 'string' ? entry.url : undefined,
    headers: entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers)
      ? entry.headers as Record<string, string> : undefined,
    enabled: entry.enabled !== false,
    subscription: isSubscriptionServer(entry),
  };
}

function validateServerName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0;
}

function validateTransport(transport: unknown): transport is McpServerTransport {
  return typeof transport === 'string'
    && ['stdio', 'sse', 'streamable-http'].includes(transport.toLowerCase());
}

/**
 * Validate that entry has the required fields for its transport.
 * Returns a user-facing error string, or null if valid.
 */
function validateEntry(body: Record<string, unknown>): string | null {
  const transport = body.transport ?? body.type;
  if (transport === undefined) {
    return 'Transport type (transport) is required. Choose "stdio", "sse", or "streamable-http".';
  }
  if (!validateTransport(transport)) {
    return `Invalid transport "${String(transport)}". Must be "stdio", "sse", or "streamable-http".`;
  }

  const t = String(transport).toLowerCase() as McpServerTransport;
  if (t === 'stdio') {
    if (typeof body.command !== 'string' || body.command.trim().length === 0) {
      return 'Command (command) is required for stdio transport.';
    }
  } else {
    if (typeof body.url !== 'string' || body.url.trim().length === 0) {
      return 'URL (url) is required for sse / streamable-http transport.';
    }
  }
  return null;
}

/** Sanitize entry for storage — only persist known fields. */
function sanitizeEntry(body: Record<string, unknown>): Record<string, unknown> {
  const transport = String(body.transport ?? body.type).toLowerCase() as McpServerTransport;
  const entry: Record<string, unknown> = { transport };

  if (transport === 'stdio') {
    if (typeof body.command === 'string') entry.command = body.command.trim();
    if (Array.isArray(body.args)) entry.args = body.args.map(String);
    if (body.env && typeof body.env === 'object' && !Array.isArray(body.env)) {
      entry.env = { ...body.env as Record<string, string> };
    }
  } else {
    if (typeof body.url === 'string') entry.url = body.url.trim();
    if (body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) {
      entry.headers = { ...body.headers as Record<string, string> };
    }
  }

  if (typeof body.enabled === 'boolean') entry.enabled = body.enabled;
  // preserve subscription flag if set
  if (body.subscription === true) entry.subscription = true;
  return entry;
}

// ── Public API ──────────────────────────────────────────────────────

/** List all MCP servers as summaries (safe for UI). */
export async function listMcpServers(): Promise<McpServerSummary[]> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const servers = getServersFromConfig(config as unknown as Record<string, unknown>);
    return Object.entries(servers).map(([name, entry]) => serverToSummary(name, entry));
  });
}

/** Get a single MCP server entry with full details. */
export async function getMcpServer(name: string): Promise<McpServerEntry | null> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const servers = getServersFromConfig(config as unknown as Record<string, unknown>);
    const entry = servers[name];
    if (!entry) return null;
    return serverToEntry(name, entry);
  });
}

/** Add a new MCP server. Returns error if name already exists. */
export async function addMcpServer(
  name: string,
  body: Record<string, unknown>,
): Promise<McpServerSaveResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { success: false, error: 'Server name is required.' };
  }

  const validationError = validateEntry(body);
  if (validationError) {
    return { success: false, error: validationError };
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const configObj = config as unknown as Record<string, unknown>;

    // Ensure mcp.servers exists
    if (!configObj.mcp || typeof configObj.mcp !== 'object' || Array.isArray(configObj.mcp)) {
      configObj.mcp = {};
    }
    const mcp = configObj.mcp as Record<string, unknown>;
    if (!mcp.servers || typeof mcp.servers !== 'object' || Array.isArray(mcp.servers)) {
      mcp.servers = {};
    }
    const servers = mcp.servers as Record<string, Record<string, unknown>>;

    if (servers[trimmedName]) {
      return { success: false, error: `MCP server "${trimmedName}" already exists.` };
    }

    const entry = sanitizeEntry(body);
    servers[trimmedName] = entry;
    await writeOpenClawConfig(config);
    logger.info(`[McpServerStore] Added MCP server "${trimmedName}"`);

    return { success: true, server: serverToSummary(trimmedName, entry) };
  });
}

/** Update an existing MCP server. Blocks editing subscription servers' critical fields. */
export async function updateMcpServer(
  name: string,
  body: Record<string, unknown>,
): Promise<McpServerSaveResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { success: false, error: 'Server name is required.' };
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const configObj = config as unknown as Record<string, unknown>;
    const servers = getServersFromConfig(configObj);

    const existing = servers[trimmedName];
    if (!existing) {
      return { success: false, error: `MCP server "${trimmedName}" not found.` };
    }

    const isSubscription = isSubscriptionServer(existing);
    if (isSubscription) {
      // For subscription servers, only allow toggling enabled state.
      if (typeof body.enabled === 'boolean') {
        existing.enabled = body.enabled;
      }
      const merged = { ...sanitizeEntry(body), ...existing };
      servers[trimmedName] = merged;
    } else {
      // Full merge: existing values serve as defaults for fields not in body.
      const sanitized = sanitizeEntry(body);
      const merged = { ...existing, ...sanitized };
      // preserve subscription = false explicitly
      merged.subscription = false;
      servers[trimmedName] = merged;
    }

    await writeOpenClawConfig(config);
    logger.info(`[McpServerStore] Updated MCP server "${trimmedName}"`);

    return { success: true, server: serverToSummary(trimmedName, servers[trimmedName]) };
  });
}

/** Delete an MCP server. Refuses to delete subscription servers. */
export async function deleteMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { success: false, error: 'Server name is required.' };
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const configObj = config as unknown as Record<string, unknown>;
    const servers = getServersFromConfig(configObj);

    const existing = servers[trimmedName];
    if (!existing) {
      return { success: false, error: `MCP server "${trimmedName}" not found.` };
    }

    if (isSubscriptionServer(existing)) {
      return { success: false, error: `Cannot delete subscription MCP server "${trimmedName}".` };
    }

    delete servers[trimmedName];
    await writeOpenClawConfig(config);
    logger.info(`[McpServerStore] Deleted MCP server "${trimmedName}"`);

    return { success: true };
  });
}

/** Toggle a server's enabled state. Works on both subscription and user servers. */
export async function toggleMcpServer(
  name: string,
  enabled: boolean,
): Promise<McpServerSaveResult> {
  return updateMcpServer(name, { enabled });
}
