import { EventEmitter } from 'events';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { BrowserWindow, session } from 'electron';
import { getSecretStore } from '../services/secrets/secret-store';
import { getProviderService } from '../services/providers/provider-service';
import { logger } from './logger';
import { proxyAwareFetch } from './proxy-fetch';
import { readOpenClawConfig, writeOpenClawConfig, type OpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';

type AuthEventPayload = {
  authenticated: boolean;
  profile?: {
    email?: string;
    subject?: string;
    scope?: string;
    expiresAt?: number;
  };
  reason?: string;
};

export type AppAuthDebugInfo = {
  enabled: boolean;
  authenticated: boolean;
  source: 'electron_session_cookie' | 'stored_secret' | 'none';
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt?: number;
  email?: string;
  subject?: string;
  portalUserId?: string;
  scope?: string;
};

type SubscriptionQuotaResult = {
  code?: string;
  message?: string;
  isSuccess?: boolean;
  data?: {
    totalQuota?: number;
    usedQuota?: number;
    remainingQuota?: number;
  } | null;
};

export type SubscriptionQuotaSnapshot = {
  provider: 'tt' | 'amz';
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  totalQuota?: number;
  usedQuota?: number;
  remainingQuota?: number;
  error?: string;
};

export type SubscriptionQuotaSummary = {
  portalUserId: string | null;
  snapshots: SubscriptionQuotaSnapshot[];
};

type SubscriptionAutoTrialResult = {
  code?: string;
  message?: string;
  isSuccess?: boolean;
};

type McpServerConfig = Record<string, unknown>;

type SubscriptionMcpConfigResult = {
  code?: string;
  message?: string;
  isSuccess?: boolean;
  data?: Record<string, McpServerConfig> | null;
};

export type SubscriptionAutoTrialResponse = {
  provider: 'tt' | 'amz';
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  error?: string;
};

/**
 * Summary of a single MCP server fetched from the subscription endpoint.
 * Intentionally omits the raw `headers` field because it may contain secrets
 * that must not be surfaced to the renderer or logs (see docs/api/mcp-config.md).
 */
export type SubscriptionMcpServerSummary = {
  name: string;
  type?: string;
  url?: string;
};

export type SubscriptionMcpConfigResponse = {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
  portalUserId: string | null;
  serverNames: string[];
  servers: SubscriptionMcpServerSummary[];
  error?: string;
};

export type PostLoginSessionCookieInfo = {
  found: boolean;
  url: string;
  name: string;
  domain?: string;
  value?: string;
  userId?: string;
};

export type SystemDefaultModelProviderInfo = {
  available: boolean;
  accountId: string;
  label: string;
  baseUrl: string;
  apiProtocol: 'openai-completions';
  apiKey?: string;
  keyMasked?: string;
  userId?: string;
  error?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
};

type JwtPayload = Record<string, unknown>;

type PendingAuthFlow = {
  state: string;
  codeVerifier: string;
  completed?: boolean;
  authorizationUrl?: string;
  webRetryCount: number;
  cookiePollMisses: number;
  redirectPageAutoClickCount: number;
  closeLoopbackServer?: () => void;
};

const APP_AUTH_ACCOUNT_ID = '__BoostClaw_app_auth__';

const AUTH_ENABLED = process.env.BoostClaw_APP_AUTH_ENABLED !== '0';
const AUTHORIZATION_ENDPOINT = process.env.BoostClaw_APP_AUTH_AUTHORIZATION_ENDPOINT
  || 'https://open.am.microdata-inc.com/usercenter/oauth/authorize';
const TOKEN_ENDPOINT = process.env.BoostClaw_APP_AUTH_TOKEN_ENDPOINT
  || 'https://open.am.microdata-inc.com/usercenter/oauth/token';
const CODE_EXCHANGE_ENDPOINT = (process.env.BoostClaw_APP_AUTH_CODE_EXCHANGE_ENDPOINT || '').trim();
const CLIENT_ID = process.env.BoostClaw_APP_AUTH_CLIENT_ID
  || '4edb20b8-9bb1-4fe1-9b20-b89bb19fe13a';
const CLIENT_SECRET = (process.env.BoostClaw_APP_AUTH_CLIENT_SECRET || '').trim();
const TOKEN_AUTH_METHOD = (
  process.env.BoostClaw_APP_AUTH_TOKEN_AUTH_METHOD
  || 'auto'
).trim() as 'auto' | 'none' | 'client_secret_post' | 'client_secret_basic';
const REDIRECT_URI = process.env.BoostClaw_APP_AUTH_REDIRECT_URI || 'https://open.microdata-inc.com';
const APP_CALLBACK_URI = process.env.BoostClaw_APP_AUTH_APP_CALLBACK_URI || 'BoostClaw://auth/callback';
const SCOPE = process.env.BoostClaw_APP_AUTH_SCOPE || 'openid profile';
const AUTH_PROMPT = (process.env.BoostClaw_APP_AUTH_PROMPT || '').trim();
const AUTH_COOKIE_NAME = process.env.BoostClaw_APP_AUTH_COOKIE_NAME || 'Auth-Graviteeio-APIM';
const DEBUG_CAPTURE_USER_URL = 'https://open.microdata-inc.com/portal/environments/DEFAULT/user';
const SUBSCRIPTION_QUOTA_BASE_URL = 'https://open.microdata-inc.com/subscription/quota';
const SUBSCRIPTION_AUTO_TRIAL_BASE_URL = 'https://open.microdata-inc.com/subscription/auto-trial';
const SUBSCRIPTION_MCP_CONFIG_URL = 'https://open.microdata-inc.com/subscription/mcp-config';
const SUBSCRIPTION_INTERNAL_TOKEN = '1234567890';
const AUTH_MASK_TIMEOUT_MS = 15_000;
// MCP server names that must never be written into ~/.openclaw/openclaw.json
// regardless of what the subscription endpoint returns. Operators can extend
// the list via env (comma-separated) without shipping a new build.
const DEFAULT_MCP_BLOCKED_SERVER_NAMES = ['proboost-patent-mcp'];
const MCP_BLOCKED_SERVER_NAMES = new Set<string>([
  ...DEFAULT_MCP_BLOCKED_SERVER_NAMES,
  ...(process.env.BoostClaw_MCP_BLOCKED_SERVER_NAMES || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
]);
const POST_LOGIN_SESSION_URL = process.env.BoostClaw_APP_AUTH_POST_LOGIN_URL || 'https://model.microdata-inc.com/login';
const POST_LOGIN_SESSION_COOKIE_NAME = 'session';
const SYSTEM_DEFAULT_MODEL_KEY_URL = 'https://open.microdata-inc.com/proxy-center/llm/token/system-default-key';
const SYSTEM_DEFAULT_MODEL_PROVIDER_ACCOUNT_ID = 'boostclaw-system-default';
const SYSTEM_DEFAULT_MODEL_PROVIDER_LABEL = 'boostmodel';
const SYSTEM_DEFAULT_MODEL_PROVIDER_BASE_URL = 'https://model.microdata-inc.com/v1/chat/completions';
const SYSTEM_DEFAULT_MODEL_PROVIDER_DEFAULT_MODEL_ID = 'qwen-plus';
const LOOPBACK_SUCCESS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录成功</title>
</head>
<body>
  <p>登录成功，请返回 BoostClaw 继续使用。</p>
</body>
</html>`;

function base64UrlEncode(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeJwtPayload(token: string | undefined): JwtPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const padded = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    return (parsed && typeof parsed === 'object') ? parsed as JwtPayload : null;
  } catch {
    return null;
  }
}

function buildCodeVerifier(): string {
  return base64UrlEncode(randomBytes(48));
}

function buildCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

function readStringClaim(payload: JwtPayload | null, claim: string): string | undefined {
  const value = payload?.[claim];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeTokenResponse(payload: unknown): TokenResponse | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const nested = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : record;
  const token = nested.token && typeof nested.token === 'object'
    ? nested.token as Record<string, unknown>
    : nested;

  const access = token.access_token ?? token.accessToken;
  const refresh = token.refresh_token ?? token.refreshToken;
  const expiresIn = token.expires_in ?? token.expiresIn;
  if (typeof access !== 'string') {
    return null;
  }

  return {
    access_token: access,
    refresh_token: typeof refresh === 'string' ? refresh : '',
    expires_in: typeof expiresIn === 'number' ? expiresIn : Number(expiresIn || 3600),
    scope: typeof token.scope === 'string' ? token.scope : undefined,
    id_token: typeof token.id_token === 'string'
      ? token.id_token
      : (typeof token.idToken === 'string' ? token.idToken : undefined),
    token_type: typeof token.token_type === 'string'
      ? token.token_type
      : (typeof token.tokenType === 'string' ? token.tokenType : undefined),
  };
}

function readJwtExpiresAt(...tokens: Array<string | undefined>): number | undefined {
  for (const token of tokens) {
    const payload = decodeJwtPayload(token);
    const exp = payload?.exp;
    if (typeof exp === 'number' && exp > 0) {
      return exp * 1000;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function summarizeAuthUrl(urlText: string): {
  location: string;
  hasCode: boolean;
  hasState: boolean;
  hasError: boolean;
  hasHash: boolean;
  hasAccessToken: boolean;
} {
  try {
    const parsed = new URL(urlText);
    const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);
    return {
      location: `${parsed.protocol}//${parsed.host}${parsed.pathname || '/'}`,
      hasCode: parsed.searchParams.has('code') || hashParams.has('code'),
      hasState: parsed.searchParams.has('state') || hashParams.has('state'),
      hasError: parsed.searchParams.has('error') || hashParams.has('error'),
      hasHash: Boolean(parsed.hash),
      hasAccessToken: parsed.searchParams.has('access_token') || hashParams.has('access_token'),
    };
  } catch {
    return {
      location: urlText,
      hasCode: false,
      hasState: false,
      hasError: false,
      hasHash: false,
      hasAccessToken: false,
    };
  }
}

function maskSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function summarizeCookieValue(value: string | undefined): {
  length: number;
  prefix: string;
  suffix: string;
} | undefined {
  if (!value) return undefined;
  return {
    length: value.length,
    prefix: value.slice(0, 24),
    suffix: value.slice(-24),
  };
}

function summarizeCookieRecord(cookie: {
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  expirationDate?: number;
  value?: string;
}): Record<string, unknown> {
  return {
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    expirationDate: cookie.expirationDate,
    valueSummary: summarizeCookieValue(cookie.value),
  };
}

function pickSystemDefaultApiKey(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || null;
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const direct = ['apiKey', 'key', 'token', 'data'].find((field) => typeof record[field] === 'string');
  if (direct) {
    return String(record[direct]).trim() || null;
  }

  for (const field of ['data', 'result', 'payload']) {
    if (record[field] && typeof record[field] === 'object') {
      const nested = pickSystemDefaultApiKey(record[field]);
      if (nested) return nested;
    }
  }

  return null;
}

function isMcpServerRegistry(value: unknown): value is Record<string, McpServerConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
}

/**
 * Merges MCP server definitions from the subscription endpoint into the
 * OpenClaw config. Server names present in `blocked` are skipped for incoming
 * data and also removed from any previously-written entries, so toggling the
 * blocklist retro-actively cleans up stale secrets.
 *
 * Returns the list of server names that were actually written into the config.
 */
function mergeMcpServersIntoOpenClawConfig(
  config: OpenClawConfig,
  servers: Record<string, McpServerConfig>,
  blocked: ReadonlySet<string> = new Set(),
): { serverNames: string[]; changed: boolean } {
  const mcp = config.mcp && typeof config.mcp === 'object' && !Array.isArray(config.mcp)
    ? { ...(config.mcp as Record<string, unknown>) }
    : {};
  const currentServers = mcp.servers && typeof mcp.servers === 'object' && !Array.isArray(mcp.servers)
    ? (mcp.servers as Record<string, McpServerConfig>)
    : {};
  const existingServers = mcp.servers && typeof mcp.servers === 'object' && !Array.isArray(mcp.servers)
    ? { ...(mcp.servers as Record<string, McpServerConfig>) }
    : {};

  // Drop any previously-written entries whose names are now blocklisted.
  for (const name of Object.keys(existingServers)) {
    if (blocked.has(name)) {
      delete existingServers[name];
    }
  }

  // Skip blocked names from the incoming payload entirely.
  const incomingEntries = Object.entries(servers).filter(([name]) => !blocked.has(name));
  const serverNames = incomingEntries.map(([name]) => name);

  const nextServers = {
    ...existingServers,
    ...Object.fromEntries(incomingEntries.map(([name, entry]) => [name, { ...entry }])),
  };
  mcp.servers = nextServers;
  config.mcp = mcp;

  return {
    serverNames,
    changed: !isDeepStrictEqual(currentServers, nextServers),
  };
}

export class AppAuthManager extends EventEmitter {
  private pendingFlow: PendingAuthFlow | null = null;
  private mainWindow: BrowserWindow | null = null;
  private authWindow: BrowserWindow | null = null;
  private authMaskWindow: BrowserWindow | null = null;
  private authReturnUrl: string | null = null;
  private forcePromptLoginOnce = false;
  private cleanupMainWindowAuthListeners: (() => void) | null = null;
  private cleanupSessionCookieListener: (() => void) | null = null;
  private cleanupSessionWebRequestListener: (() => void) | null = null;
  private cleanupDebuggerListener: (() => void) | null = null;
  private cleanupAuthMaskSync: (() => void) | null = null;
  private cookiePollTimer: NodeJS.Timeout | null = null;
  private authMaskTimeoutTimer: NodeJS.Timeout | null = null;
  // When true, auth mask must stay visible until restore flow explicitly ends.
  private keepAuthMaskVisible = false;
  // Runtime mask toggle for debugging auth pages.
  private authMaskEnabled = process.env.BoostClaw_APP_AUTH_MASK_ENABLED !== '0';
  private postLoginModelUserId: string | null = null;
  private postLoginSessionCookieValue: string | null = null;
  private systemDefaultModelProviderInfoCache: SystemDefaultModelProviderInfo | null = null;
  private systemDefaultModelProviderInfoRequest: Promise<SystemDefaultModelProviderInfo> | null = null;

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getAuthMaskState(): { enabled: boolean } {
    return { enabled: this.authMaskEnabled };
  }

  setAuthMaskEnabled(enabled: boolean): { enabled: boolean } {
    this.authMaskEnabled = enabled;
    logger.info('[AppAuth] Auth mask toggle updated', { enabled });
    if (!enabled) {
      this.keepAuthMaskVisible = false;
      this.clearAuthMaskTimeout();
      this.closeAuthMaskWindow();
    }
    return { enabled: this.authMaskEnabled };
  }

  private closeAuthWindow(): void {
    if (!this.authWindow || this.authWindow.isDestroyed()) {
      this.authWindow = null;
      return;
    }
    this.authWindow.close();
    this.authWindow = null;
  }

  private closeAuthMaskWindow(): void {
    this.cleanupAuthMaskSync?.();
    this.cleanupAuthMaskSync = null;
    this.keepAuthMaskVisible = false;
    if (!this.authMaskWindow || this.authMaskWindow.isDestroyed()) {
      this.authMaskWindow = null;
      return;
    }
    logger.info('[AppAuth] Closing auth mask window');
    this.authMaskWindow.destroy();
    this.authMaskWindow = null;
  }

  private clearAuthMaskTimeout(): void {
    if (!this.authMaskTimeoutTimer) {
      return;
    }
    clearTimeout(this.authMaskTimeoutTimer);
    this.authMaskTimeoutTimer = null;
  }

  private startAuthMaskTimeout(): void {
    this.clearAuthMaskTimeout();
    this.authMaskTimeoutTimer = setTimeout(() => {
      void this.handleAuthMaskTimeout();
    }, AUTH_MASK_TIMEOUT_MS);
  }

  private normalizeMainWindowLoginUrl(returnUrl: string): string {
    try {
      const parsed = new URL(returnUrl);
      // App uses HashRouter; force return to /login on timeout.
      parsed.hash = '#/login';
      parsed.search = '';
      return parsed.toString();
    } catch {
      return returnUrl;
    }
  }

  private async handleAuthMaskTimeout(): Promise<void> {
    this.authMaskTimeoutTimer = null;
    const flow = this.pendingFlow;
    if (!flow || flow.completed) {
      return;
    }

    const win = this.mainWindow;
    const returnUrl = this.authReturnUrl;
    if (flow.authorizationUrl && flow.webRetryCount < 1) {
      logger.warn('[AppAuth] Auth mask timeout reached, retrying login flow once', {
        timeoutMs: AUTH_MASK_TIMEOUT_MS,
        returnUrl,
      });
      this.emitDebug('web_mask_timeout_retry', {
        timeoutMs: AUTH_MASK_TIMEOUT_MS,
        returnUrl,
      });
      this.startAuthMaskTimeout();
      await this.retryAuthorizationInMainWindow('mask_timeout');
      return;
    }

    logger.warn('[AppAuth] Auth mask timeout reached, aborting login flow', {
      timeoutMs: AUTH_MASK_TIMEOUT_MS,
      returnUrl,
    });
    this.emitDebug('web_mask_timeout', {
      timeoutMs: AUTH_MASK_TIMEOUT_MS,
      returnUrl,
    });

    this.clearPendingFlow();
    this.cleanupMainWindowAfterAuth();

    if (win && !win.isDestroyed() && returnUrl) {
      await win.loadURL(this.normalizeMainWindowLoginUrl(returnUrl));
    }

    this.emit('auth:error', {
      authenticated: false,
      reason: `Login timed out after ${AUTH_MASK_TIMEOUT_MS / 1000}s`,
    });
  }

  private async showAuthMaskWindow(): Promise<void> {
    if (!this.authMaskEnabled) {
      return;
    }
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      return;
    }
    if (this.authMaskWindow && !this.authMaskWindow.isDestroyed()) {
      const bounds = win.getBounds();
      this.authMaskWindow.setBounds(bounds);
      this.authMaskWindow.showInactive();
      this.authMaskWindow.moveTop();
      logger.info('[AppAuth] Auth mask window refreshed');
      this.startAuthMaskTimeout();
      return;
    }

    const bounds = win.getBounds();
    const mask = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      parent: win,
      modal: false,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#F8FAFC',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.authMaskWindow = mask;
    mask.setIgnoreMouseEvents(true);
    mask.setAlwaysOnTop(true, 'screen-saver');
    mask.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mask.setMenuBarVisibility(false);

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; height: 100%; background: rgba(255,255,255,0.88); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { height: 100%; display: flex; align-items: center; justify-content: center; }
    .card { text-align: center; padding: 24px 32px; border-radius: 16px; background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 20px 40px rgba(15,23,42,0.12); }
    .spinner { width: 32px; height: 32px; border-radius: 50%; border: 2px solid #cbd5e1; border-top-color: #0f172a; margin: 0 auto 16px auto; animation: spin 1s linear infinite; box-sizing: border-box; }
    .title { color: #0f172a; font-size: 16px; font-weight: 600; line-height: 1.45; }
    .desc { margin-top: 8px; color: #475569; font-size: 14px; line-height: 1.45; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="spinner"></div>
      <div class="title">登录中</div>
      <div class="desc">正在完成登录，请稍候...</div>
    </div>
  </div>
</body>
</html>`;

    await mask.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    if (!mask.isDestroyed()) {
      mask.showInactive();
      mask.moveTop();
      logger.info('[AppAuth] Auth mask window shown');
      this.startAuthMaskTimeout();
    }

    const syncBounds = () => {
      if (!this.authMaskWindow || this.authMaskWindow.isDestroyed() || win.isDestroyed()) {
        return;
      }
      const nextBounds = win.getBounds();
      this.authMaskWindow.setBounds(nextBounds);
    };
    const closeMaskOnParentClose = () => this.closeAuthMaskWindow();
    win.on('resize', syncBounds);
    win.on('move', syncBounds);
    win.on('closed', closeMaskOnParentClose);
    this.cleanupAuthMaskSync = () => {
      win.removeListener('resize', syncBounds);
      win.removeListener('move', syncBounds);
      win.removeListener('closed', closeMaskOnParentClose);
    };
    mask.on('closed', () => {
      this.cleanupAuthMaskSync?.();
      this.cleanupAuthMaskSync = null;
      if (this.authMaskWindow === mask) {
        this.authMaskWindow = null;
      }
    });
  }

  private clearPendingFlow(options?: { keepMask?: boolean }): void {
    if (this.pendingFlow?.closeLoopbackServer) {
      this.pendingFlow.closeLoopbackServer();
    }
    this.pendingFlow = null;
    if (this.cookiePollTimer) {
      clearTimeout(this.cookiePollTimer);
      this.cookiePollTimer = null;
    }
    this.cleanupSessionCookieListener?.();
    this.cleanupSessionCookieListener = null;
    this.cleanupSessionWebRequestListener?.();
    this.cleanupSessionWebRequestListener = null;
    this.keepAuthMaskVisible = Boolean(options?.keepMask);
    if (!options?.keepMask) {
      this.clearAuthMaskTimeout();
    }
    this.closeAuthWindow();
    if (!options?.keepMask) {
      this.closeAuthMaskWindow();
    }
  }

  private cleanupMainWindowAuthNavigation(): void {
    this.cleanupMainWindowAuthListeners?.();
    this.cleanupMainWindowAuthListeners = null;
    if (this.cookiePollTimer) {
      clearTimeout(this.cookiePollTimer);
      this.cookiePollTimer = null;
    }
    this.cleanupSessionCookieListener?.();
    this.cleanupSessionCookieListener = null;
    this.cleanupSessionWebRequestListener?.();
    this.cleanupSessionWebRequestListener = null;
    this.cleanupDebuggerListener?.();
    this.cleanupDebuggerListener = null;
  }

  private cleanupMainWindowAfterAuth(): void {
    this.authReturnUrl = null;
    this.cleanupMainWindowAuthNavigation();
  }

  private normalizeMainWindowReturnUrl(returnUrl: string): string {
    try {
      const parsed = new URL(returnUrl);
      const pathname = parsed.pathname || '/';
      const hashRaw = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
      const hashPath = hashRaw.startsWith('/') ? hashRaw.split(/[?#]/)[0] : '';
      const onLoginPath = pathname === '/login' || pathname.startsWith('/login/');
      const onLoginHashPath = hashPath === '/login' || hashPath.startsWith('/login/');

      if (!onLoginPath && !onLoginHashPath) {
        return returnUrl;
      }

      // App uses HashRouter. When auth started from #/login, jump directly to home
      // to avoid showing the login prompt page briefly after token is acquired.
      if (onLoginHashPath) {
        parsed.hash = '#/';
        parsed.search = '';
        return parsed.toString();
      }

      parsed.pathname = '/';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return returnUrl;
    }
  }

  private async restoreMainWindowAfterAuth(): Promise<void> {
    const win = this.mainWindow;
    const postLoginUrl = (() => {
      try {
        return new URL(POST_LOGIN_SESSION_URL).toString();
      } catch {
        return null;
      }
    })();
    const returnUrl = this.authReturnUrl ? this.normalizeMainWindowReturnUrl(this.authReturnUrl) : null;
    this.cleanupMainWindowAfterAuth();
    if (!win || win.isDestroyed()) {
      return;
    }
    if (postLoginUrl) {
      this.postLoginModelUserId = null;
      this.postLoginSessionCookieValue = null;
      this.systemDefaultModelProviderInfoCache = null;
      await win.loadURL(postLoginUrl);
      await this.capturePostLoginSessionCookie(postLoginUrl);
      await this.capturePostLoginLocalStorageUserId();
      const quotaSummary = await this.getSubscriptionQuotaSummary();
      logger.info('[AppAuth] Prefetched subscription quotas after login', {
        portalUserId: quotaSummary.portalUserId,
        providers: quotaSummary.snapshots.map((snapshot) => ({
          provider: snapshot.provider,
          ok: snapshot.ok,
          status: snapshot.status,
          code: snapshot.code,
        })),
      });
      await this.syncSubscriptionMcpConfig();
      await this.prefetchSystemDefaultModelProviderInfo();
    }
    if (returnUrl) {
      await win.loadURL(returnUrl);
    }
  }

  private async capturePostLoginSessionCookie(urlText: string): Promise<void> {
    let target: URL;
    try {
      target = new URL(urlText);
    } catch {
      return;
    }

    const authSession = this.getAuthSession();
    let lastCookieValue: string | null = null;
    let stableCookieHits = 0;
    let latestCookie: Electron.Cookie | null = null;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        const cookies = await authSession.cookies.get({
          url: `${target.origin}/`,
          name: POST_LOGIN_SESSION_COOKIE_NAME,
        });
        logger.info('[AppAuth] Post-login session cookie candidates', {
          url: target.origin,
          name: POST_LOGIN_SESSION_COOKIE_NAME,
          attempt,
          count: cookies.length,
          cookies: cookies.map((cookie) => summarizeCookieRecord({
            domain: cookie.domain,
            path: cookie.path,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            expirationDate: cookie.expirationDate,
            value: cookie.value,
          })),
        });
        const sessionCookie = cookies.find((cookie) => cookie.name === POST_LOGIN_SESSION_COOKIE_NAME);
        if (sessionCookie?.value) {
          latestCookie = sessionCookie;
          if (sessionCookie.value === lastCookieValue) {
            stableCookieHits += 1;
          } else {
            lastCookieValue = sessionCookie.value;
            stableCookieHits = 1;
          }

          // The session value can change once immediately after login redirect.
          // Require the same value to be observed twice before finalizing it.
          if (stableCookieHits >= 2) {
            this.postLoginSessionCookieValue = sessionCookie.value;
            logger.info('[AppAuth] Captured stable post-login session cookie', {
              url: target.origin,
              name: sessionCookie.name,
              domain: sessionCookie.domain,
              path: sessionCookie.path,
              httpOnly: sessionCookie.httpOnly,
              secure: sessionCookie.secure,
              expirationDate: sessionCookie.expirationDate,
              stableCookieHits,
              value: sessionCookie.value,
            });
            return;
          }
        }
      } catch (error) {
        logger.warn('[AppAuth] Failed reading post-login session cookie', {
          url: target.origin,
          name: POST_LOGIN_SESSION_COOKIE_NAME,
          attempt,
          error: String(error),
        });
        return;
      }

      await sleep(500);
    }

    if (latestCookie?.value) {
      // Fallback: even if the cookie never stabilized twice within retries,
      // keep the latest value so auth can still proceed.
      this.postLoginSessionCookieValue = latestCookie.value;
      logger.warn('[AppAuth] Captured latest (unstable) post-login session cookie after retries', {
        url: target.origin,
        name: latestCookie.name,
        domain: latestCookie.domain,
        path: latestCookie.path,
        httpOnly: latestCookie.httpOnly,
        secure: latestCookie.secure,
        expirationDate: latestCookie.expirationDate,
        stableCookieHits,
        value: latestCookie.value,
      });
      return;
    }

    logger.warn('[AppAuth] Post-login session cookie not found', {
      url: target.origin,
      name: POST_LOGIN_SESSION_COOKIE_NAME,
    });
  }

  private async capturePostLoginLocalStorageUserId(): Promise<void> {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      return;
    }

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        const inspection = await win.webContents.executeJavaScript(`
          (() => {
            try {
              const href = typeof window.location?.href === 'string' ? window.location.href : '';
              const hostname = typeof window.location?.hostname === 'string' ? window.location.hostname : '';
              const raw = window.localStorage.getItem('user');
              if (hostname !== 'model.microdata-inc.com') {
                return { href, hostname, hasUser: Boolean(raw), userId: null, parseError: null, keys: [] };
              }
              if (!raw) {
                return { href, hostname, hasUser: false, userId: null, parseError: null, keys: [] };
              }
              const parsed = JSON.parse(raw);
              const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
              const rawUserId = parsed?.id;
              const userId = typeof rawUserId === 'string'
                ? (rawUserId.trim() || null)
                : (typeof rawUserId === 'number' && Number.isFinite(rawUserId)
                  ? String(rawUserId)
                  : null);
              return {
                href,
                hostname,
                hasUser: true,
                userId,
                parseError: null,
                keys,
                rawPreview: raw.length > 500 ? raw.slice(0, 500) + '...' : raw,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return {
                href: typeof window.location?.href === 'string' ? window.location.href : '',
                hostname: typeof window.location?.hostname === 'string' ? window.location.hostname : '',
                hasUser: Boolean(window.localStorage.getItem('user')),
                userId: null,
                parseError: message,
                keys: [],
              };
            }
          })()
        `, true);

        logger.info('[AppAuth] Post-login localStorage user inspection', {
          attempt,
          hostname: inspection?.hostname,
          href: inspection?.href,
          hasUser: inspection?.hasUser,
          keys: Array.isArray(inspection?.keys) ? inspection.keys : [],
          parseError: inspection?.parseError || undefined,
          rawPreview: typeof inspection?.rawPreview === 'string' ? inspection.rawPreview : undefined,
        });

        if (typeof inspection?.userId === 'string' && inspection.userId.trim()) {
          this.postLoginModelUserId = inspection.userId.trim();
          this.systemDefaultModelProviderInfoCache = null;
          await this.persistPostLoginModelUserId(this.postLoginModelUserId);
          logger.info('[AppAuth] Captured post-login localStorage user id', {
            hostname: 'model.microdata-inc.com',
            userId: this.postLoginModelUserId,
          });
          return;
        }
      } catch (error) {
        logger.warn('[AppAuth] Failed reading post-login localStorage user id', {
          hostname: 'model.microdata-inc.com',
          attempt,
          error: String(error),
        });
        return;
      }

      await sleep(500);
    }

    logger.warn('[AppAuth] Post-login localStorage user id not found', {
      hostname: 'model.microdata-inc.com',
      storageKey: 'user',
    });
  }

  private async persistPostLoginModelUserId(userId: string): Promise<void> {
    const secret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);
    if (secret?.type !== 'oauth') {
      return;
    }
    await getSecretStore().set({
      ...secret,
      modelUserId: userId,
    });
  }

  private async persistSystemDefaultProviderAccount(apiKey: string): Promise<void> {
    const providerService = getProviderService();
    const existing = await providerService.getAccount(SYSTEM_DEFAULT_MODEL_PROVIDER_ACCOUNT_ID);
    const now = new Date().toISOString();
    const account = {
      id: SYSTEM_DEFAULT_MODEL_PROVIDER_ACCOUNT_ID,
      vendorId: 'custom' as const,
      label: SYSTEM_DEFAULT_MODEL_PROVIDER_LABEL,
      authMode: 'api_key' as const,
      baseUrl: SYSTEM_DEFAULT_MODEL_PROVIDER_BASE_URL,
      apiProtocol: 'openai-completions' as const,
      model: existing?.model || SYSTEM_DEFAULT_MODEL_PROVIDER_DEFAULT_MODEL_ID,
      enabled: true,
      isDefault: existing?.isDefault ?? false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      headers: existing?.headers,
      fallbackModels: existing?.fallbackModels,
      fallbackAccountIds: existing?.fallbackAccountIds,
      metadata: existing?.metadata,
    };

    if (existing) {
      await providerService.updateAccount(existing.id, account, apiKey);
      return;
    }

    await providerService.createAccount(account, apiKey);
  }

  private async getStoredPostLoginModelUserId(): Promise<string | null> {
    const secret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);
    if (secret?.type === 'oauth' && typeof secret.modelUserId === 'string' && secret.modelUserId.trim()) {
      return secret.modelUserId.trim();
    }
    return null;
  }

  private buildSystemDefaultModelProviderUnavailable(error: string, userId?: string): SystemDefaultModelProviderInfo {
    return {
      available: false,
      accountId: SYSTEM_DEFAULT_MODEL_PROVIDER_ACCOUNT_ID,
      label: SYSTEM_DEFAULT_MODEL_PROVIDER_LABEL,
      baseUrl: SYSTEM_DEFAULT_MODEL_PROVIDER_BASE_URL,
      apiProtocol: 'openai-completions',
      userId,
      error,
    };
  }

  private async requestSystemDefaultModelProviderInfo(): Promise<SystemDefaultModelProviderInfo> {
    const sessionInfo = await this.getPostLoginSessionCookieInfo();
    const userId = sessionInfo.userId?.trim();
    if (!sessionInfo.found || !sessionInfo.value) {
      return this.buildSystemDefaultModelProviderUnavailable('Model session cookie is unavailable');
    }
    if (!userId) {
      return this.buildSystemDefaultModelProviderUnavailable('Model user ID is unavailable');
    }

    try {
      logger.info('[AppAuth] Requesting system default model key', {
        url: SYSTEM_DEFAULT_MODEL_KEY_URL,
        hasSessionCookie: Boolean(sessionInfo.value),
        modelUserId: userId,
        headers: {
          Cookie: sessionInfo.value ? `${POST_LOGIN_SESSION_COOKIE_NAME}=[present]` : undefined,
          'new-api-user': userId,
          'User-Agent': 'BoostClaw/1.0',
          Accept: '*/*',
        },
        sessionCookieSummary: summarizeCookieValue(sessionInfo.value),
      });
      const response = await fetch(SYSTEM_DEFAULT_MODEL_KEY_URL, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Cookie: `${POST_LOGIN_SESSION_COOKIE_NAME}=${sessionInfo.value}`,
          'new-api-user': userId,
          'User-Agent': 'BoostClaw/1.0',
          Accept: '*/*',
        },
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      const apiKey = pickSystemDefaultApiKey(parsed);
      logger.info('[AppAuth] System default model key response received', {
        url: SYSTEM_DEFAULT_MODEL_KEY_URL,
        status: response.status,
        ok: response.ok,
        hasApiKey: Boolean(apiKey),
        bodyPreview: text.slice(0, 500),
      });
      if (!response.ok || !apiKey) {
        return this.buildSystemDefaultModelProviderUnavailable(
          text || response.statusText || 'Failed to load system default model key',
          userId,
        );
      }

      await this.persistSystemDefaultProviderAccount(apiKey);

      return {
        available: true,
        accountId: SYSTEM_DEFAULT_MODEL_PROVIDER_ACCOUNT_ID,
        label: SYSTEM_DEFAULT_MODEL_PROVIDER_LABEL,
        baseUrl: SYSTEM_DEFAULT_MODEL_PROVIDER_BASE_URL,
        apiProtocol: 'openai-completions',
        apiKey,
        keyMasked: maskSecret(apiKey),
        userId,
      };
    } catch (error) {
      logger.warn('[AppAuth] System default model key request failed', {
        url: SYSTEM_DEFAULT_MODEL_KEY_URL,
        modelUserId: userId,
        error: String(error),
      });
      return this.buildSystemDefaultModelProviderUnavailable(String(error), userId);
    }
  }

  private async prefetchSystemDefaultModelProviderInfo(): Promise<void> {
    const info = await this.getSystemDefaultModelProviderInfo(true);
    logger.info('[AppAuth] Prefetched system default model provider info', {
      available: info.available,
      userId: info.userId,
      hasApiKey: Boolean(info.apiKey),
      error: info.error,
    });
  }

  private emitDebug(step: string, detail: Record<string, unknown>): void {
    this.emit('auth:debug', {
      step,
      detail,
      ts: Date.now(),
    });
  }

  private getRedirectUrl(): URL {
    return new URL(REDIRECT_URI);
  }

  private getAuthRelatedHosts(): string[] {
    const hosts = new Set<string>();
    const addHost = (value: string): void => {
      try {
        const host = new URL(value).hostname.trim();
        if (host) hosts.add(host);
      } catch {
        // no-op
      }
    };
    addHost(REDIRECT_URI);
    addHost(AUTHORIZATION_ENDPOINT);
    addHost(TOKEN_ENDPOINT);
    addHost(POST_LOGIN_SESSION_URL);
    return [...hosts];
  }

  private isCookieDomainMatch(cookieDomain: string, host: string): boolean {
    const normalizedCookieDomain = cookieDomain.replace(/^\./, '').toLowerCase();
    const normalizedHost = host.toLowerCase();
    return normalizedCookieDomain === normalizedHost || normalizedCookieDomain.endsWith(`.${normalizedHost}`);
  }

  private getAuthSession(): Electron.Session {
    const activeSession = this.mainWindow?.webContents.session;
    return activeSession || session.defaultSession;
  }

  private async getAuthCookie(): Promise<Electron.Cookie | null> {
    const cookies = await this.getAuthSession().cookies.get({ name: AUTH_COOKIE_NAME });
    return cookies.find((cookie) => typeof cookie.value === 'string' && cookie.value.length > 0) || null;
  }

  private async debugFetchUserEndpointWithSessionCookies(): Promise<void> {
    try {
      const target = new URL(DEBUG_CAPTURE_USER_URL);
      const authSession = this.getAuthSession();
      const cookies = await authSession.cookies.get({ url: `${target.origin}/` });
      const cookieHeader = cookies
        .filter((cookie) => typeof cookie.name === 'string' && typeof cookie.value === 'string')
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');

      const response = await fetch(DEBUG_CAPTURE_USER_URL, {
        method: 'GET',
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
      });
      const body = await response.text();
      let portalUserId: string | undefined;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        portalUserId = typeof parsed.id === 'string' ? parsed.id : undefined;
      } catch {
        // ignore non-json body
      }

      if (portalUserId) {
        const secret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);
        if (secret?.type === 'oauth') {
          await getSecretStore().set({
            ...secret,
            portalUserId,
          });
        }
      }

      logger.info('[AppAuth] Captured target response body via session-cookie fetch', {
        url: DEBUG_CAPTURE_USER_URL,
        status: response.status,
        cookieCount: cookies.length,
        portalUserId,
        body,
      });
    } catch (error) {
      logger.warn('[AppAuth] Failed session-cookie fetch for target response body', {
        url: DEBUG_CAPTURE_USER_URL,
        error: String(error),
      });
    }
  }

  private async ensurePortalUserIdFromSessionCookies(): Promise<string | null> {
    const secret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);
    if (secret?.type === 'oauth' && typeof secret.portalUserId === 'string' && secret.portalUserId.length > 0) {
      return secret.portalUserId;
    }

    try {
      const target = new URL(DEBUG_CAPTURE_USER_URL);
      const authSession = this.getAuthSession();
      const cookies = await authSession.cookies.get({ url: `${target.origin}/` });
      const cookieHeader = cookies
        .filter((cookie) => typeof cookie.name === 'string' && typeof cookie.value === 'string')
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');

      const response = await fetch(DEBUG_CAPTURE_USER_URL, {
        method: 'GET',
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
      });
      const body = await response.text();
      let portalUserId: string | null = null;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        portalUserId = typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : null;
      } catch {
        portalUserId = null;
      }

      if (!response.ok || !portalUserId) {
        logger.warn('[AppAuth] Failed to resolve portal user id before redirect', {
          url: DEBUG_CAPTURE_USER_URL,
          status: response.status,
          body: body.slice(0, 500),
        });
        return null;
      }

      if (secret?.type === 'oauth') {
        await getSecretStore().set({
          ...secret,
          portalUserId,
        });
      }

      return portalUserId;
    } catch (error) {
      logger.warn('[AppAuth] Failed to resolve portal user id before redirect', {
        url: DEBUG_CAPTURE_USER_URL,
        error: String(error),
      });
      return null;
    }
  }

  private async clearAuthCookies(): Promise<void> {
    const authSession = this.getAuthSession();
    const cookies = await authSession.cookies.get({ name: AUTH_COOKIE_NAME });
    const removalUrls = new Set<string>();

    const addRemovalUrls = (domain: string, path: string): void => {
      const cleanDomain = domain.replace(/^\./, '').trim();
      if (!cleanDomain) return;
      const cleanPath = path && path.startsWith('/') ? path : '/';
      removalUrls.add(`https://${cleanDomain}${cleanPath}`);
      removalUrls.add(`http://${cleanDomain}${cleanPath}`);
      removalUrls.add(`https://.${cleanDomain}${cleanPath}`);
      removalUrls.add(`http://.${cleanDomain}${cleanPath}`);
    };

    for (const cookie of cookies) {
      addRemovalUrls(cookie.domain || '', cookie.path || '/');
    }

    // Fallback origins for host-only cookies or domain/path mismatches.
    try {
      const redirect = this.getRedirectUrl();
      addRemovalUrls(redirect.hostname, '/');
    } catch {
      // no-op
    }
    try {
      const auth = new URL(AUTHORIZATION_ENDPOINT);
      addRemovalUrls(auth.hostname, '/');
    } catch {
      // no-op
    }
    try {
      const postLogin = new URL(POST_LOGIN_SESSION_URL);
      addRemovalUrls(postLogin.hostname, '/');
    } catch {
      // no-op
    }

    for (const url of removalUrls) {
      try {
        await authSession.cookies.remove(url, AUTH_COOKIE_NAME);
      } catch (error) {
        logger.warn('[AppAuth] Failed to remove auth cookie:', { url, error: String(error) });
      }
    }

    const remaining = await authSession.cookies.get({ name: AUTH_COOKIE_NAME });
    if (remaining.length > 0) {
      logger.warn('[AppAuth] Auth cookie still present after logout cleanup', {
        count: remaining.length,
        domains: remaining.map((item) => item.domain || '').filter(Boolean),
      });
    }

    const authHosts = this.getAuthRelatedHosts();
    if (authHosts.length === 0) {
      return;
    }
    const allCookies = await authSession.cookies.get({});
    const relatedCookies = allCookies.filter((cookie) => {
      const domain = cookie.domain || '';
      return authHosts.some((host) => this.isCookieDomainMatch(domain, host));
    });

    let removedCount = 0;
    for (const cookie of relatedCookies) {
      const domain = (cookie.domain || '').replace(/^\./, '').trim();
      if (!domain) continue;
      const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/';
      const urls = [
        `https://${domain}${path}`,
        `http://${domain}${path}`,
        `https://.${domain}${path}`,
        `http://.${domain}${path}`,
      ];
      for (const url of urls) {
        try {
          await authSession.cookies.remove(url, cookie.name);
          removedCount += 1;
        } catch {
          // no-op
        }
      }
    }
    if (removedCount > 0) {
      logger.info('[AppAuth] Removed auth-related session cookies on logout', {
        hosts: authHosts,
        removedCount,
      });
    }

    try {
      const postLogin = new URL(POST_LOGIN_SESSION_URL);
      const postLoginCookies = await authSession.cookies.get({
        url: `${postLogin.origin}/`,
        name: POST_LOGIN_SESSION_COOKIE_NAME,
      });
      let removedPostLoginCount = 0;
      for (const cookie of postLoginCookies) {
        const domain = (cookie.domain || postLogin.hostname).replace(/^\./, '').trim();
        if (!domain) continue;
        const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/';
        const urls = [
          `https://${domain}${path}`,
          `http://${domain}${path}`,
          `https://.${domain}${path}`,
          `http://.${domain}${path}`,
        ];
        for (const url of urls) {
          try {
            await authSession.cookies.remove(url, POST_LOGIN_SESSION_COOKIE_NAME);
            removedPostLoginCount += 1;
          } catch {
            // no-op
          }
        }
      }
      if (removedPostLoginCount > 0) {
        logger.info('[AppAuth] Removed post-login session cookies on logout', {
          url: postLogin.origin,
          name: POST_LOGIN_SESSION_COOKIE_NAME,
          removedCount: removedPostLoginCount,
        });
      }
    } catch {
      // no-op
    }
  }

  private getAppCallbackUrl(): URL | null {
    try {
      return new URL(APP_CALLBACK_URI);
    } catch {
      return null;
    }
  }

  isEnabled(): boolean {
    return AUTH_ENABLED;
  }

  isProtocolCallbackMode(): boolean {
    const parsed = this.getAppCallbackUrl();
    if (!parsed) return false;
    return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
  }

  isLoopbackCallbackMode(): boolean {
    try {
      const parsed = this.getRedirectUrl();
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    } catch {
      return false;
    }
  }

  getAppCallbackProtocol(): string | null {
    if (!this.isProtocolCallbackMode()) {
      return null;
    }
    try {
      const parsed = this.getAppCallbackUrl();
      if (!parsed) return null;
      return parsed.protocol.replace(':', '') || null;
    } catch {
      return null;
    }
  }

  private getExpectedAppCallbackLocation(): { host: string; pathname: string } | null {
    const parsed = this.getAppCallbackUrl();
    if (!parsed) return null;
    return {
      host: parsed.host,
      pathname: parsed.pathname || '/',
    };
  }

  private normalizeAuthUrl(authUrl: string, prompt: string): string {
    const url = new URL(authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPE);
    if (prompt) {
      url.searchParams.set('prompt', prompt);
    }
    if (!url.searchParams.has('code_challenge_method')) {
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  private async startLoopbackCallbackServer(): Promise<() => void> {
    const redirect = this.getRedirectUrl();
    const port = Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80));
    const host = redirect.hostname;
    const pathname = redirect.pathname || '/';
    let consumed = false;

    const server: Server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '', `${redirect.protocol}//${redirect.host}`);
        if (requestUrl.pathname !== pathname) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const oauthError = requestUrl.searchParams.get('error');
        if (oauthError) {
          const reason = requestUrl.searchParams.get('error_description') || oauthError;
          this.clearPendingFlow();
          this.emit('auth:error', { authenticated: false, reason });
          res.statusCode = 400;
          res.end(reason);
          return;
        }

        const code = requestUrl.searchParams.get('code');
        const state = requestUrl.searchParams.get('state');
        const flow = this.pendingFlow;
        if (!flow || !code || !state) {
          res.statusCode = 400;
          res.end('Missing code/state or no active login flow');
          return;
        }

        if (state !== flow.state) {
          this.clearPendingFlow();
          this.emit('auth:error', { authenticated: false, reason: 'State mismatch' });
          res.statusCode = 400;
          res.end('State mismatch');
          return;
        }

        if (consumed) {
          res.statusCode = 409;
          res.end('OAuth callback already consumed');
          return;
        }
        consumed = true;

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(LOOPBACK_SUCCESS_HTML);
        void this.completeAuthorization(code, state);
      } catch (error) {
        res.statusCode = 500;
        res.end(`Internal error: ${String(error)}`);
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    return () => {
      try {
        server.close();
      } catch {
        // no-op
      }
    };
  }

  private async exchangeToken(params: Record<string, string>): Promise<TokenResponse> {
    if (CODE_EXCHANGE_ENDPOINT) {
      return await this.exchangeTokenViaBackend(params);
    }

    const methods: Array<'none' | 'client_secret_post' | 'client_secret_basic'> = (() => {
      if (TOKEN_AUTH_METHOD === 'none') return ['none'];
      if (TOKEN_AUTH_METHOD === 'client_secret_post') return ['client_secret_post'];
      if (TOKEN_AUTH_METHOD === 'client_secret_basic') return ['client_secret_basic'];
      // auto: try no-auth first for adaptive servers, then secret methods (if secret exists).
      return CLIENT_SECRET
        ? ['none', 'client_secret_post', 'client_secret_basic']
        : ['none'];
    })();

    let lastError: Error | null = null;

    for (const method of methods) {
      if ((method === 'client_secret_post' || method === 'client_secret_basic') && !CLIENT_SECRET) {
        continue;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      const body = new URLSearchParams(params);
      if (method === 'client_secret_post') {
        body.set('client_secret', CLIENT_SECRET);
      } else if (method === 'client_secret_basic') {
        const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        headers.Authorization = `Basic ${credentials}`;
      }

      const bodyObject = Object.fromEntries(body.entries());
      const safeBody = {
        ...bodyObject,
        code: typeof bodyObject.code === 'string'
          ? `${String(bodyObject.code).slice(0, 8)}...`
          : bodyObject.code,
        code_verifier: typeof bodyObject.code_verifier === 'string'
          ? `[len:${String(bodyObject.code_verifier).length}]`
          : bodyObject.code_verifier,
        refresh_token: typeof bodyObject.refresh_token === 'string'
          ? `[len:${String(bodyObject.refresh_token).length}]`
          : bodyObject.refresh_token,
        client_secret: bodyObject.client_secret ? '[redacted]' : undefined,
      };
      const safeHeaders = {
        ...headers,
        Authorization: headers.Authorization ? '[redacted]' : undefined,
      };
      this.emitDebug('token_request', {
        endpoint: TOKEN_ENDPOINT,
        authMethod: method,
        headers: safeHeaders,
        body: safeBody,
      });

      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers,
        body: body.toString(),
      });

      const text = await response.text();
      let parsed: TokenResponse = {};
      let errorCode = '';
      try {
        const json = JSON.parse(text) as TokenResponse & { error?: string };
        parsed = json;
        errorCode = typeof json.error === 'string' ? json.error : '';
      } catch {
        // keep raw body in error path only
      }

      if (response.ok) {
        this.emitDebug('token_response', {
          endpoint: TOKEN_ENDPOINT,
          authMethod: method,
          status: response.status,
          ok: true,
        });
        if (!parsed.access_token || !parsed.refresh_token) {
          throw new Error('Token response missing access_token or refresh_token');
        }
        return parsed;
      }

      this.emitDebug('token_response', {
        endpoint: TOKEN_ENDPOINT,
        authMethod: method,
        status: response.status,
        ok: false,
        body: text.slice(0, 500),
      });

      const message = `Token exchange failed (${response.status}) [${method}]: ${text || response.statusText}`;
      lastError = new Error(message);

      if (response.status === 401 && errorCode === 'invalid_client') {
        continue;
      }

      throw lastError;
    }

    throw lastError ?? new Error('Token exchange failed: no usable auth method');
  }

  private async exchangeTokenViaBackend(params: Record<string, string>): Promise<TokenResponse> {
    const grantType = params.grant_type;
    const payload = {
      grantType,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      tokenEndpoint: TOKEN_ENDPOINT,
      code: params.code,
      codeVerifier: params.code_verifier,
      refreshToken: params.refresh_token,
      scope: SCOPE,
    };

    this.emitDebug('backend_token_request', {
      endpoint: CODE_EXCHANGE_ENDPOINT,
      body: {
        ...payload,
        code: payload.code ? `${payload.code.slice(0, 8)}...` : undefined,
        codeVerifier: payload.codeVerifier ? `[len:${payload.codeVerifier.length}]` : undefined,
        refreshToken: payload.refreshToken ? `[len:${payload.refreshToken.length}]` : undefined,
      },
    });

    const response = await fetch(CODE_EXCHANGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      // keep raw body in error path
    }

    this.emitDebug('backend_token_response', {
      endpoint: CODE_EXCHANGE_ENDPOINT,
      status: response.status,
      ok: response.ok,
      body: response.ok ? undefined : text.slice(0, 500),
    });

    if (!response.ok) {
      throw new Error(`Backend token exchange failed (${response.status}): ${text || response.statusText}`);
    }

    const token = normalizeTokenResponse(json);
    if (!token) {
      throw new Error('Backend token exchange response missing access_token or refresh_token');
    }
    return token;
  }

  private async persistToken(token: TokenResponse): Promise<AuthEventPayload> {
    const currentSecret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);
    const jwt = decodeJwtPayload(token.id_token) || decodeJwtPayload(token.access_token);
    const email = readStringClaim(jwt, 'email');
    const subject = readStringClaim(jwt, 'sub');
    const scope = typeof token.scope === 'string' ? token.scope : SCOPE;
    const jwtExpiresAt = readJwtExpiresAt(token.id_token, token.access_token);
    const expiresIn = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in : 3600;
    const expiresAt = token.expires_at || jwtExpiresAt || Date.now() + (expiresIn * 1000);

    await getSecretStore().set({
      type: 'oauth',
      accountId: APP_AUTH_ACCOUNT_ID,
      accessToken: token.access_token!,
      refreshToken: token.refresh_token || '',
      expiresAt,
      scopes: scope.split(/\s+/).filter(Boolean),
      email,
      subject,
      portalUserId: currentSecret?.type === 'oauth' ? currentSecret.portalUserId : undefined,
      modelUserId: currentSecret?.type === 'oauth' ? currentSecret.modelUserId : undefined,
    });
    this.forcePromptLoginOnce = false;

    return {
      authenticated: true,
      profile: {
        email,
        subject,
        scope,
        expiresAt,
      },
    };
  }

  private async completeAuthorization(code: string, state: string): Promise<void> {
    if (!this.pendingFlow) {
      this.emit('auth:error', { authenticated: false, reason: 'No active login flow' });
      return;
    }

    if (state !== this.pendingFlow.state) {
      this.clearPendingFlow();
      this.emit('auth:error', { authenticated: false, reason: 'State mismatch' });
      return;
    }

    if (this.pendingFlow.completed) {
      return;
    }
    this.pendingFlow.completed = true;

    try {
      const token = await this.exchangeToken({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: this.pendingFlow.codeVerifier,
      });
      this.clearPendingFlow({ keepMask: true });
      const payload = await this.persistToken(token);
      await this.ensurePortalUserIdFromSessionCookies();
      await this.restoreMainWindowAfterAuth();
      this.clearPendingFlow();
      this.emit('auth:success', payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.clearPendingFlow();
      await this.restoreMainWindowAfterAuth();
      this.emit('auth:error', { authenticated: false, reason });
    }
  }

  private isRedirectMatch(url: URL, expected: URL): boolean {
    const expectedPath = expected.pathname || '/';
    const currentPath = url.pathname || '/';
    return url.protocol === expected.protocol
      && url.host === expected.host
      && currentPath === expectedPath;
  }

  private readOAuthCallbackParams(parsed: URL): {
    error?: string;
    errorDescription?: string;
    code?: string;
    state?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    scope?: string;
    idToken?: string;
  } {
    const hashRaw = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hashRaw);
    if (!hashParams.toString() && hashRaw.includes('?')) {
      const index = hashRaw.indexOf('?');
      if (index >= 0 && index + 1 < hashRaw.length) {
        const fromQuestion = new URLSearchParams(hashRaw.slice(index + 1));
        for (const [key, value] of fromQuestion.entries()) {
          hashParams.set(key, value);
        }
      }
    }
    const pick = (...names: string[]): string | undefined => {
      for (const name of names) {
        const value = parsed.searchParams.get(name) ?? hashParams.get(name);
        if (value && value.trim().length > 0) {
          return value.trim();
        }
      }
      return undefined;
    };
    const expiresRaw = pick('expires_in', 'expiresIn');
    const expiresIn = expiresRaw ? Number(expiresRaw) : undefined;
    return {
      error: pick('error'),
      errorDescription: pick('error_description', 'errorDescription'),
      code: pick('code'),
      state: pick('state'),
      accessToken: pick('access_token', 'accessToken', 'token'),
      refreshToken: pick('refresh_token', 'refreshToken'),
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
      scope: pick('scope'),
      idToken: pick('id_token', 'idToken'),
    };
  }

  private async handleWebRedirectCallback(urlText: string): Promise<boolean> {
    if (!this.pendingFlow) return false;
    let parsed: URL;
    try {
      parsed = new URL(urlText);
    } catch {
      return false;
    }

    const redirect = this.getRedirectUrl();
    if (!this.isRedirectMatch(parsed, redirect)) {
      return false;
    }

    const callback = this.readOAuthCallbackParams(parsed);
    const oauthError = callback.error;
    if (oauthError) {
      const reason = callback.errorDescription || oauthError;
      this.clearPendingFlow();
      this.emit('auth:error', { authenticated: false, reason });
      return true;
    }

    const code = callback.code;
    const state = callback.state;
    if (!code || !state) {
      if (!callback.accessToken) {
        return false;
      }
      if (state && this.pendingFlow && state !== this.pendingFlow.state) {
        this.clearPendingFlow();
        this.emit('auth:error', { authenticated: false, reason: 'State mismatch' });
        return true;
      }
      if (this.pendingFlow) {
        this.pendingFlow.completed = true;
      }
      const token: TokenResponse = {
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken || '',
        expires_in: callback.expiresIn,
        scope: callback.scope,
        id_token: callback.idToken,
      };
      this.emitDebug('web_fragment_token_capture', {
        ...summarizeAuthUrl(urlText),
        hasRefreshToken: Boolean(callback.refreshToken),
        hasIdToken: Boolean(callback.idToken),
      });
      logger.info('[AppAuth] Captured OAuth token from redirect URL fragment/query');
      this.clearPendingFlow({ keepMask: true });
      const payload = await this.persistToken(token);
      await this.ensurePortalUserIdFromSessionCookies();
      await this.restoreMainWindowAfterAuth();
      this.clearPendingFlow();
      this.emit('auth:success', payload);
      return true;
    }

    await this.completeAuthorization(code, state);
    return true;
  }

  private isWebRedirectUrl(urlText: string): boolean {
    try {
      return this.isRedirectMatch(new URL(urlText), this.getRedirectUrl());
    } catch {
      return false;
    }
  }

  private async captureStoredTokenFromSession(urlText: string): Promise<boolean> {
    const win = this.mainWindow;
    const flow = this.pendingFlow;
    if (!win || win.isDestroyed() || !flow || flow.completed) {
      return false;
    }

    const currentUrl = urlText || win.webContents.getURL() || '';

    let authCookie: Electron.Cookie | null | undefined;

    for (let attempt = 1; ; attempt += 1) {
      if (!this.pendingFlow || this.pendingFlow !== flow || flow.completed || win.isDestroyed()) {
        return false;
      }

      authCookie = await this.getAuthCookie();

      if (authCookie?.value) {
        this.emitDebug('web_cookie_token_found', {
          source: currentUrl,
          attempt,
          name: AUTH_COOKIE_NAME,
          domain: authCookie.domain,
          expiresAt: authCookie.expirationDate ? authCookie.expirationDate * 1000 : undefined,
        });
        break;
      }

      if (attempt === 1 || attempt % 10 === 0) {
        this.emitDebug('web_cookie_token_wait', {
          source: currentUrl,
          attempt,
          name: AUTH_COOKIE_NAME,
        });
      }
      await sleep(200);
    }

    if (!authCookie?.value) {
      return false;
    }

    if (!this.pendingFlow || this.pendingFlow !== flow || flow.completed) {
      return false;
    }
    flow.completed = true;
    const cookieExpiresAt = authCookie.expirationDate ? authCookie.expirationDate * 1000 : undefined;
    const token: TokenResponse = {
      access_token: authCookie.value,
      refresh_token: '',
      expires_at: cookieExpiresAt,
    };

    this.emitDebug('web_cookie_token_capture', {
      source: currentUrl,
      hasAccessToken: true,
      cookieName: AUTH_COOKIE_NAME,
      domain: authCookie.domain,
      expiresAt: cookieExpiresAt || readJwtExpiresAt(authCookie.value),
    });

    this.clearPendingFlow({ keepMask: true });
    const payload = await this.persistToken(token);
    await this.ensurePortalUserIdFromSessionCookies();
    await this.restoreMainWindowAfterAuth();
    this.clearPendingFlow();
    this.emit('auth:success', payload);
    return true;
  }

  private shouldHandleAuthNavigation(urlText: string): boolean {
    if (this.pendingFlow && !this.pendingFlow.completed) {
      return true;
    }

    let parsed: URL;
    try {
      parsed = new URL(urlText);
    } catch {
      return false;
    }

    const redirect = this.getRedirectUrl();
    if (this.isRedirectMatch(parsed, redirect)) {
      return true;
    }

    const protocol = this.getAppCallbackProtocol();
    const appCallback = this.getExpectedAppCallbackLocation();
    return Boolean(
      protocol
      && appCallback
      && parsed.protocol === `${protocol}:`
      && parsed.host === appCallback.host
      && parsed.pathname === appCallback.pathname,
    );
  }

  private shouldPreventAuthNavigation(urlText: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(urlText);
    } catch {
      return false;
    }

    const protocol = this.getAppCallbackProtocol();
    const appCallback = this.getExpectedAppCallbackLocation();
    return Boolean(
      protocol
      && appCallback
      && parsed.protocol === `${protocol}:`
      && parsed.host === appCallback.host
      && parsed.pathname === appCallback.pathname,
    );
  }

  private async handleAuthNavigation(url: string): Promise<boolean> {
    await this.syncAuthMaskByUrl(url);
    const handledByStoredToken = await this.captureStoredTokenFromSession(url);
    if (handledByStoredToken) return true;
    if (this.pendingFlow) {
      this.pendingFlow.cookiePollMisses = 0;
    }
    if (this.isWebRedirectUrl(url)) {
      return await this.handleWebRedirectCallback(url);
    }
    const handledByRedirect = await this.handleWebRedirectCallback(url);
    if (handledByRedirect) return true;
    return await this.handleProtocolCallback(url);
  }

  private async syncAuthMaskByUrl(_urlText: string): Promise<void> {
    if (this.keepAuthMaskVisible) {
      return;
    }
    const flow = this.pendingFlow;
    // Only force-close the mask when there is no active flow. During an active
    // login flow, the mask visibility is controlled by navigation hooks in
    // `openLoginInMainWindow` (after the first page is shown).
    if (!flow) {
      this.closeAuthMaskWindow();
      return;
    }
  }

  private safeHandleAuthNavigation(url: string, source: string): void {
    void this.handleAuthNavigation(url).catch((error) => {
      const reason = error instanceof Error ? (error.stack || error.message) : String(error);
      logger.error(`[AppAuth] handleAuthNavigation failed (${source})`, error);
      this.emitDebug('web_handle_auth_navigation_error', {
        source,
        ...summarizeAuthUrl(url),
        reason,
      });

      if (this.pendingFlow && !this.pendingFlow.completed) {
        this.clearPendingFlow();
        void this.restoreMainWindowAfterAuth();
        this.emit('auth:error', {
          authenticated: false,
          reason: `Navigation handler failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  }

  private async retryAuthorizationInMainWindow(reason: string): Promise<void> {
    const win = this.mainWindow;
    const flow = this.pendingFlow;
    if (!win || win.isDestroyed() || !flow || flow.completed) {
      return;
    }
    if (!flow.authorizationUrl || flow.webRetryCount >= 1) {
      return;
    }

    flow.webRetryCount += 1;
    flow.cookiePollMisses = 0;
    logger.info(`[AppAuth] Retrying authorization in web flow (${reason})`);
    await win.loadURL(flow.authorizationUrl);
  }

  private async tryAutoClickRedirectLoginButton(url: string): Promise<boolean> {
    const win = this.mainWindow;
    const flow = this.pendingFlow;
    if (!win || win.isDestroyed() || !flow || flow.completed) {
      return false;
    }
    if (!this.isWebRedirectUrl(url) || flow.redirectPageAutoClickCount >= 3) {
      return false;
    }

    flow.redirectPageAutoClickCount += 1;
    try {
      const attempt = flow.redirectPageAutoClickCount;
      const result = await win.webContents.executeJavaScript(`
        (() => {
          const norm = (v) => (v || '').toString().trim().toLowerCase();
          const clickElement = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            try {
              el.focus?.();
              el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              el.click?.();
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              return true;
            } catch {
              return false;
            }
          };
          const targets = ['登录注册', '登入', 'login', 'log in', 'sign in', 'continue', '继续', '授权', 'confirm', '确认'];
          const attrTargets = ['login', 'signin', 'sign-in', 'auth', 'authorize', 'submit', 'primary', 'continue', 'confirm', 'next', 'oauth'];
          const isVisible = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0' && rect.width > 4 && rect.height > 4;
          };

          const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], div[role="button"], div[onclick], span[role="button"], span[onclick]'));
          const ranked = [];

          for (const el of candidates) {
            if (!isVisible(el)) continue;
            const text = norm(el.textContent || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('title') || '');
            const signature = norm([
              el.id || '',
              el.className || '',
              el.getAttribute('name') || '',
              el.getAttribute('data-testid') || '',
              el.getAttribute('data-test') || '',
              el.getAttribute('data-role') || '',
            ].join(' '));
            let score = 0;
            if (text && targets.some((t) => text.includes(t))) score += 10;
            if (signature && attrTargets.some((t) => signature.includes(t))) score += 8;
            if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && norm(el.getAttribute('type')) === 'submit')) score += 4;
            const rect = el.getBoundingClientRect();
            if (rect.width >= 72 && rect.height >= 28) score += 2;
            if (score > 0) {
              ranked.push({ el, score, area: rect.width * rect.height });
            }
          }

          ranked.sort((a, b) => (b.score - a.score) || (b.area - a.area));
          if (ranked.length > 0 && clickElement(ranked[0].el)) {
            return { clicked: true, method: 'ranked-button' };
          }

          const forms = Array.from(document.querySelectorAll('form'));
          for (const form of forms) {
            if (!(form instanceof HTMLFormElement)) continue;
            try {
              if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
              } else {
                form.submit();
              }
              return { clicked: true, method: 'form-submit' };
            } catch {
              // ignore and continue
            }
          }

          const fallback = candidates.find((el) => isVisible(el) && ((el instanceof HTMLElement) ? el.getBoundingClientRect().width * el.getBoundingClientRect().height >= 4000 : false));
          if (fallback && clickElement(fallback)) {
            return { clicked: true, method: 'fallback-large-click' };
          }

          try {
            const active = document.activeElement;
            if (active instanceof HTMLElement) {
              active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
              active.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
              active.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
              return { clicked: true, method: 'active-enter' };
            }
          } catch {
            // ignore and fallthrough
          }

          return { clicked: false, method: 'none' };
        })();
      `, true);
      const clicked = Boolean(result && typeof result === 'object' && 'clicked' in result && (result as { clicked?: boolean }).clicked);
      const method = (result && typeof result === 'object' && 'method' in result)
        ? String((result as { method?: string }).method || 'unknown')
        : 'unknown';
      if (clicked) {
        logger.info('[AppAuth] Auto-clicked login action on redirect page', { attempt, method });
        this.emitDebug('web_redirect_auto_click_login', {
          ...summarizeAuthUrl(url),
          attempt,
          method,
          clicked: true,
        });
      } else {
        logger.info('[AppAuth] Redirect page auto-click skipped (no actionable element found)', { attempt, method });
      }
      return Boolean(clicked);
    } catch (error) {
      logger.warn('[AppAuth] Redirect page auto-click failed', error);
      return false;
    }
  }

  private async probePageLocation(source: string): Promise<void> {
    const win = this.mainWindow;
    if (!win || win.isDestroyed() || !this.pendingFlow || this.pendingFlow.completed) {
      return;
    }
    try {
      const href = await win.webContents.executeJavaScript('window.location.href', true);
      if (typeof href !== 'string' || !href || !this.shouldHandleAuthNavigation(href)) {
        return;
      }
      this.emitDebug('web_location_probe', {
        source,
        ...summarizeAuthUrl(href),
      });
      logger.info(`[AppAuth] Probed window.location.href from ${source}: ${summarizeAuthUrl(href).location}`);
      this.safeHandleAuthNavigation(href, `probe:${source}`);
    } catch (error) {
      this.emitDebug('web_location_probe_error', {
        source,
        reason: String(error),
      });
    }
  }

  private scheduleCookiePoll(url: string): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed() || !this.pendingFlow || this.pendingFlow.completed) {
      return;
    }
    if (!url || this.cookiePollTimer) {
      return;
    }

    this.cookiePollTimer = setTimeout(async () => {
      this.cookiePollTimer = null;
      if (!this.pendingFlow || this.pendingFlow.completed || win.isDestroyed()) {
        return;
      }
      const authCookie = await this.getAuthCookie();
      if (authCookie?.value) {
        this.emitDebug('web_cookie_token_polled', { url });
        this.safeHandleAuthNavigation(win.webContents.getURL(), 'cookie-poll');
        return;
      }
      const currentUrl = win.webContents.getURL();
      if (!currentUrl || currentUrl !== url) {
        return;
      }
      if (this.pendingFlow && this.isWebRedirectUrl(currentUrl)) {
        this.pendingFlow.cookiePollMisses += 1;
        if (this.pendingFlow.cookiePollMisses >= 2 && this.pendingFlow.redirectPageAutoClickCount < 3) {
          const clicked = await this.tryAutoClickRedirectLoginButton(currentUrl);
          if (clicked) {
            this.scheduleCookiePoll(currentUrl);
            return;
          }
        }
        if (this.pendingFlow.cookiePollMisses >= 8 && this.pendingFlow.webRetryCount < 1) {
          void this.retryAuthorizationInMainWindow('redirect_without_token');
          return;
        }
      }
      this.scheduleCookiePoll(currentUrl);
    }, 500);
  }

  private async openLoginInMainWindow(authorizationUrl: string): Promise<void> {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      throw new Error('Main window is not available for login');
    }

    this.cleanupMainWindowAuthNavigation();
    this.authReturnUrl = win.webContents.getURL();
    this.emitDebug('web_login_start', summarizeAuthUrl(authorizationUrl));
    logger.info('[AppAuth] Web login started');
    this.closeAuthMaskWindow();

    // Credential-entry page should stay visible. Every non-login auth page
    // (oauth/authorize, redirect bridges, callback pages) must be masked.
    let firstLoginPageShown = false;
    const isPrimaryLoginPage = (targetUrl: string): boolean => {
      try {
        const parsed = new URL(targetUrl);
        return parsed.pathname.startsWith('/usercenter/login');
      } catch {
        return false;
      }
    };

    const handleBeforeNavigate = (event: Electron.Event, url: string) => {
      if (!this.shouldHandleAuthNavigation(url)) {
        return;
      }
      this.emitDebug('web_will_navigate', summarizeAuthUrl(url));
      logger.info(`[AppAuth] will-navigate/redirect: ${summarizeAuthUrl(url).location}`);
      if (this.shouldPreventAuthNavigation(url)) {
        event.preventDefault();
      }
      // Never mask the credential-entry page itself; users need to input
      // username/password there. For any subsequent non-login auth pages,
      // keep a full overlay so intermediate redirects are not exposed.
      if (isPrimaryLoginPage(url)) {
        this.clearAuthMaskTimeout();
        this.closeAuthMaskWindow();
      } else {
        void this.showAuthMaskWindow();
      }
      this.safeHandleAuthNavigation(url, 'will-navigate');
    };
    const handleAfterNavigate = (_event: Electron.Event, url: string) => {
      if (!this.shouldHandleAuthNavigation(url)) {
        return;
      }
      this.emitDebug('web_did_navigate', summarizeAuthUrl(url));
      logger.info(`[AppAuth] did-navigate/redirect: ${summarizeAuthUrl(url).location}`);
      this.safeHandleAuthNavigation(url, 'did-navigate');
    };
    const handleStartNavigation = (
      _event: Electron.Event,
      url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || isInPlace || !this.shouldHandleAuthNavigation(url)) {
        return;
      }
      this.emitDebug('web_did_start_navigation', summarizeAuthUrl(url));
      logger.info(`[AppAuth] did-start-navigation: ${summarizeAuthUrl(url).location}`);
      this.safeHandleAuthNavigation(url, 'did-start-navigation');
    };
    const handleInPageNavigate = (_event: Electron.Event, url: string, isMainFrame: boolean) => {
      if (!isMainFrame || !this.shouldHandleAuthNavigation(url)) {
        return;
      }
      this.emitDebug('web_did_navigate_in_page', summarizeAuthUrl(url));
      logger.info(`[AppAuth] did-navigate-in-page: ${summarizeAuthUrl(url).location}`);
      this.safeHandleAuthNavigation(url, 'did-navigate-in-page');
      void this.probePageLocation('did-navigate-in-page');
    };
    const handleFinishLoad = () => {
      const currentUrl = win.webContents.getURL();
      if (this.shouldHandleAuthNavigation(currentUrl)) {
        this.emitDebug('web_did_finish_load', summarizeAuthUrl(currentUrl));
        logger.info(`[AppAuth] did-finish-load: ${summarizeAuthUrl(currentUrl).location}`);
      }
      this.safeHandleAuthNavigation(currentUrl, 'did-finish-load');
      void this.probePageLocation('did-finish-load');
      this.scheduleCookiePoll(currentUrl);
      if (isPrimaryLoginPage(currentUrl)) {
        this.clearAuthMaskTimeout();
        this.closeAuthMaskWindow();
      }
      // Record that the first credential page has been shown to users once.
      // From now on, all later navigations in this flow remain masked.
      if (!firstLoginPageShown && isPrimaryLoginPage(currentUrl)) {
        firstLoginPageShown = true;
        logger.info('[AppAuth] Login form shown — all subsequent auth pages will be masked');
      }
    };
    const handleFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || !this.shouldHandleAuthNavigation(validatedUrl)) {
        return;
      }
      const detail = {
        ...summarizeAuthUrl(validatedUrl),
        errorCode,
        errorDescription,
      };
      this.emitDebug('web_did_fail_load', detail);
      logger.warn(`[AppAuth] did-fail-load code=${errorCode} desc=${errorDescription} url=${detail.location}`);
    };
    const handleCookieChanged = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (removed || cookie.name !== AUTH_COOKIE_NAME || !cookie.value) {
        return;
      }
      this.emitDebug('web_cookie_token_changed', {
        name: cookie.name,
        domain: cookie.domain,
        expiresAt: cookie.expirationDate ? cookie.expirationDate * 1000 : undefined,
      });
      logger.info(`[AppAuth] auth cookie changed: ${cookie.name} @ ${cookie.domain}`);
      void this.debugFetchUserEndpointWithSessionCookies();
      this.safeHandleAuthNavigation(win.webContents.getURL(), 'cookie-changed');
    };
    const handleBeforeRequest: Electron.OnBeforeRequestListener = (details, callback) => {
      if (details.resourceType !== 'mainFrame') {
        callback({});
        return;
      }
      const targetUrl = details.url || '';
      if (!this.shouldHandleAuthNavigation(targetUrl)) {
        callback({});
        return;
      }
      this.emitDebug('web_request_before_request', {
        ...summarizeAuthUrl(targetUrl),
        method: details.method,
      });
      logger.info(`[AppAuth] webRequest.onBeforeRequest: ${summarizeAuthUrl(targetUrl).location}`);
      if (this.shouldPreventAuthNavigation(targetUrl)) {
        callback({ cancel: true });
      } else {
        callback({});
      }
      this.safeHandleAuthNavigation(targetUrl, 'before-request');
    };

    try {
      const debuggerApi = win.webContents.debugger;
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach('1.3');
      }
      void debuggerApi.sendCommand('Network.enable');

      const handleDebuggerMessage = async (
        _event: Electron.Event,
        method: string,
        params?: Record<string, unknown>,
      ) => {
        if (method !== 'Network.responseReceived') {
          return;
        }

        const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
        const response = params?.response && typeof params.response === 'object'
          ? params.response as Record<string, unknown>
          : null;
        const responseUrl = typeof response?.url === 'string' ? response.url : '';
        if (!requestId || responseUrl !== DEBUG_CAPTURE_USER_URL) {
          return;
        }

        try {
          const bodyResult = await debuggerApi.sendCommand('Network.getResponseBody', { requestId }) as {
            body?: string;
            base64Encoded?: boolean;
          };
          const rawBody = typeof bodyResult.body === 'string' ? bodyResult.body : '';
          const decodedBody = bodyResult.base64Encoded
            ? Buffer.from(rawBody, 'base64').toString('utf8')
            : rawBody;

          logger.info('[AppAuth] Captured target response body via CDP', {
            url: responseUrl,
            status: response?.status,
            body: decodedBody,
          });
        } catch (error) {
          logger.warn('[AppAuth] Failed to capture target response body via CDP', {
            url: responseUrl,
            error: String(error),
          });
        }
      };

      debuggerApi.on('message', handleDebuggerMessage);
      this.cleanupDebuggerListener = () => {
        debuggerApi.removeListener('message', handleDebuggerMessage);
        if (debuggerApi.isAttached()) {
          try {
            debuggerApi.detach();
          } catch {
            // no-op
          }
        }
      };
    } catch (error) {
      logger.warn('[AppAuth] Failed to attach CDP debugger for auth flow', String(error));
    }

    win.webContents.on('will-redirect', handleBeforeNavigate);
    win.webContents.on('will-navigate', handleBeforeNavigate);
    win.webContents.on('did-start-navigation', handleStartNavigation);
    win.webContents.on('did-navigate', handleAfterNavigate);
    win.webContents.on('did-redirect-navigation', handleAfterNavigate);
    win.webContents.on('did-navigate-in-page', handleInPageNavigate);
    win.webContents.on('did-finish-load', handleFinishLoad);
    win.webContents.on('did-fail-load', handleFailLoad);
    win.webContents.session.cookies.on('changed', handleCookieChanged);
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, handleBeforeRequest);
    this.cleanupMainWindowAuthListeners = () => {
      win.webContents.removeListener('will-redirect', handleBeforeNavigate);
      win.webContents.removeListener('will-navigate', handleBeforeNavigate);
      win.webContents.removeListener('did-start-navigation', handleStartNavigation);
      win.webContents.removeListener('did-navigate', handleAfterNavigate);
      win.webContents.removeListener('did-redirect-navigation', handleAfterNavigate);
      win.webContents.removeListener('did-navigate-in-page', handleInPageNavigate);
      win.webContents.removeListener('did-finish-load', handleFinishLoad);
      win.webContents.removeListener('did-fail-load', handleFailLoad);
    };
    this.cleanupSessionCookieListener = () => {
      win.webContents.session.cookies.removeListener('changed', handleCookieChanged);
    };
    this.cleanupSessionWebRequestListener = () => {
      win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, null as unknown as Electron.OnBeforeRequestListener);
    };

    await win.loadURL(authorizationUrl);
  }

  async getAuthStatus(): Promise<AuthEventPayload & { enabled: boolean }> {
    if (!this.isEnabled()) {
      return { enabled: false, authenticated: true };
    }

    const authCookie = await this.getAuthCookie();
    const secret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);
    if (!authCookie?.value) {
      if (
        secret?.type === 'oauth'
        && typeof secret.accessToken === 'string'
        && secret.accessToken.length > 0
        && typeof secret.expiresAt === 'number'
        && secret.expiresAt > Date.now()
      ) {
        const jwt = decodeJwtPayload(secret.accessToken);
        const email = readStringClaim(jwt, 'email') || secret.email;
        const subject = readStringClaim(jwt, 'sub') || secret.subject;
        const scope = secret.scopes?.join(' ') || SCOPE;
        this.emitDebug('status_from_secret_without_cookie', {
          hasEmail: Boolean(email),
          hasSubject: Boolean(subject),
          expiresAt: secret.expiresAt,
        });
        logger.info('[AppAuth] Auth status restored from stored OAuth token (cookie missing)');
        return {
          enabled: true,
          authenticated: true,
          profile: {
            email,
            subject,
            scope,
            expiresAt: secret.expiresAt,
          },
        };
      }
      await getSecretStore().delete(APP_AUTH_ACCOUNT_ID);
      return { enabled: true, authenticated: false };
    }

    const jwt = decodeJwtPayload(authCookie.value);
    const email = readStringClaim(jwt, 'email') || (secret?.type === 'oauth' ? secret.email : undefined);
    const subject = readStringClaim(jwt, 'sub') || (secret?.type === 'oauth' ? secret.subject : undefined);
    const scope = (secret?.type === 'oauth' ? secret.scopes?.join(' ') : undefined) || SCOPE;
    const expiresAt = authCookie.expirationDate
      ? authCookie.expirationDate * 1000
      : (readJwtExpiresAt(authCookie.value) || (secret?.type === 'oauth' ? secret.expiresAt : undefined));

    return {
      enabled: true,
      authenticated: true,
      profile: {
        email,
        subject,
        scope,
        expiresAt,
      },
    };
  }

  async getAuthDebugInfo(): Promise<AppAuthDebugInfo> {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        authenticated: true,
        source: 'none',
        accessToken: null,
        refreshToken: null,
      };
    }

    const authCookie = await this.getAuthCookie();
    const secret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);

    if (authCookie?.value) {
      const jwt = decodeJwtPayload(authCookie.value);
      const accessToken = secret?.type === 'oauth' && secret.accessToken
        ? secret.accessToken
        : authCookie.value;
      return {
        enabled: true,
        authenticated: true,
        source: 'electron_session_cookie',
        accessToken,
        refreshToken: secret?.type === 'oauth' ? secret.refreshToken || '' : null,
        expiresAt: authCookie.expirationDate
          ? authCookie.expirationDate * 1000
          : (readJwtExpiresAt(authCookie.value) || (secret?.type === 'oauth' ? secret.expiresAt : undefined)),
        email: readStringClaim(jwt, 'email') || (secret?.type === 'oauth' ? secret.email : undefined),
        subject: readStringClaim(jwt, 'sub') || (secret?.type === 'oauth' ? secret.subject : undefined),
        portalUserId: secret?.type === 'oauth' ? secret.portalUserId : undefined,
        scope: (secret?.type === 'oauth' ? secret.scopes?.join(' ') : undefined) || SCOPE,
      };
    }

    if (
      secret?.type === 'oauth'
      && typeof secret.accessToken === 'string'
      && secret.accessToken.length > 0
      && typeof secret.expiresAt === 'number'
      && secret.expiresAt > Date.now()
    ) {
      const jwt = decodeJwtPayload(secret.accessToken);
      return {
        enabled: true,
        authenticated: true,
        source: 'stored_secret',
        accessToken: secret.accessToken,
        refreshToken: secret.refreshToken || '',
        expiresAt: secret.expiresAt,
        email: readStringClaim(jwt, 'email') || secret.email,
        subject: readStringClaim(jwt, 'sub') || secret.subject,
        portalUserId: secret.portalUserId,
        scope: secret.scopes?.join(' ') || SCOPE,
      };
    }

    return {
      enabled: true,
      authenticated: false,
      source: 'none',
      accessToken: null,
      refreshToken: null,
    };
  }

  async getSubscriptionQuotaSummary(): Promise<SubscriptionQuotaSummary> {
    const debug = await this.getAuthDebugInfo();
    const portalUserId = debug.portalUserId || null;
    if (!portalUserId || !debug.accessToken) {
      return { portalUserId, snapshots: [] };
    }

    const fetchOne = async (provider: 'tt' | 'amz'): Promise<SubscriptionQuotaSnapshot> => {
      const url = `${SUBSCRIPTION_QUOTA_BASE_URL}/${provider}?userId=${encodeURIComponent(portalUserId)}`;
      const headers: Record<string, string> = {
        'X-Internal-Token': SUBSCRIPTION_INTERNAL_TOKEN,
      };

      try {
        const response = await proxyAwareFetch(url, { method: 'GET', headers });
        const text = await response.text();
        let json: SubscriptionQuotaResult | null = null;
        try {
          json = JSON.parse(text) as SubscriptionQuotaResult;
        } catch {
          json = null;
        }

        return {
          provider,
          ok: response.ok && Boolean(json?.isSuccess),
          status: response.status,
          code: json?.code,
          message: json?.message,
          totalQuota: json?.data?.totalQuota,
          usedQuota: json?.data?.usedQuota,
          remainingQuota: json?.data?.remainingQuota,
          error: json ? undefined : text || response.statusText,
        };
      } catch (error) {
        return {
          provider,
          ok: false,
          status: 0,
          error: String(error),
        };
      }
    };

    return {
      portalUserId,
      snapshots: await Promise.all([fetchOne('tt'), fetchOne('amz')]),
    };
  }

  async syncSubscriptionMcpConfig(): Promise<SubscriptionMcpConfigResponse> {
    const debug = await this.getAuthDebugInfo();
    const portalUserId = debug.portalUserId || null;
    if (!portalUserId) {
      return {
        ok: false,
        status: 400,
        code: 'MISSING_USER_ID',
        message: 'Portal user ID is unavailable',
        portalUserId,
        serverNames: [],
        servers: [],
      };
    }

    const url = `${SUBSCRIPTION_MCP_CONFIG_URL}?userId=${encodeURIComponent(portalUserId)}`;
    try {
      const response = await proxyAwareFetch(url, {
        method: 'GET',
        headers: {
          'X-Internal-Token': SUBSCRIPTION_INTERNAL_TOKEN,
        },
      });
      const text = await response.text();
      let json: SubscriptionMcpConfigResult | null = null;
      try {
        json = JSON.parse(text) as SubscriptionMcpConfigResult;
      } catch {
        json = null;
      }

      if (!response.ok || !json?.isSuccess || !isMcpServerRegistry(json.data)) {
        return {
          ok: false,
          status: response.status,
          code: json?.code,
          message: json?.message,
          portalUserId,
          serverNames: [],
          servers: [],
          error: json ? undefined : text || response.statusText,
        };
      }

      // Build a non-sensitive summary view for the renderer. Raw `headers`
      // frequently include per-tenant secrets and MUST NOT leave the main
      // process (see docs/api/mcp-config.md security note).
      // Hoisting `data` into a narrowed local preserves the type-guard across
      // the later async closure below.
      const data = json.data;
      const skippedServerNames = Object.keys(data).filter((name) => MCP_BLOCKED_SERVER_NAMES.has(name));
      const servers: SubscriptionMcpServerSummary[] = Object.entries(data)
        .filter(([name]) => !MCP_BLOCKED_SERVER_NAMES.has(name))
        .map(([name, entry]) => {
          const record = entry as Record<string, unknown>;
          const type = typeof record.type === 'string' ? record.type : undefined;
          const endpoint = typeof record.url === 'string' ? record.url : undefined;
          return { name, type, url: endpoint };
        });

      const { serverNames, wroteConfig } = await withConfigLock(async () => {
        const config = await readOpenClawConfig();
        const mergeResult = mergeMcpServersIntoOpenClawConfig(config, data, MCP_BLOCKED_SERVER_NAMES);
        if (mergeResult.changed) {
          await writeOpenClawConfig(config);
        }
        return { serverNames: mergeResult.serverNames, wroteConfig: mergeResult.changed };
      });

      logger.info('[AppAuth] Synced subscription MCP config', {
        url,
        portalUserId,
        serverNames,
        skippedServerNames,
        wroteConfig,
      });

      return {
        ok: true,
        status: response.status,
        code: json.code,
        message: json.message,
        portalUserId,
        serverNames,
        servers,
      };
    } catch (error) {
      logger.warn('[AppAuth] Subscription MCP config sync failed', {
        url,
        portalUserId,
        error: String(error),
      });
      return {
        ok: false,
        status: 0,
        portalUserId,
        serverNames: [],
        servers: [],
        error: String(error),
      };
    }
  }

  async createSubscriptionAutoTrial(provider: 'tt' | 'amz'): Promise<SubscriptionAutoTrialResponse> {
    const debug = await this.getAuthDebugInfo();
    const portalUserId = debug.portalUserId || null;
    if (!portalUserId) {
      return {
        provider,
        ok: false,
        status: 400,
        code: 'MISSING_USER_ID',
        message: 'Portal user ID is unavailable',
      };
    }

    try {
      const response = await proxyAwareFetch(`${SUBSCRIPTION_AUTO_TRIAL_BASE_URL}/${provider}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': SUBSCRIPTION_INTERNAL_TOKEN,
        },
        body: JSON.stringify({ userId: portalUserId }),
      });
      const text = await response.text();
      let json: SubscriptionAutoTrialResult | null = null;
      try {
        json = JSON.parse(text) as SubscriptionAutoTrialResult;
      } catch {
        json = null;
      }

      return {
        provider,
        ok: response.ok && Boolean(json?.isSuccess),
        status: response.status,
        code: json?.code,
        message: json?.message,
        error: json ? undefined : text || response.statusText,
      };
    } catch (error) {
      return {
        provider,
        ok: false,
        status: 0,
        error: String(error),
      };
    }
  }

  async getPostLoginSessionCookieInfo(): Promise<PostLoginSessionCookieInfo> {
    const storedModelUserId = await this.getStoredPostLoginModelUserId();
    const modelUserId = this.postLoginModelUserId || storedModelUserId || undefined;
    let target: URL;
    try {
      target = new URL(POST_LOGIN_SESSION_URL);
    } catch {
      return {
        found: false,
        url: POST_LOGIN_SESSION_URL,
        name: POST_LOGIN_SESSION_COOKIE_NAME,
        userId: modelUserId,
      };
    }

    try {
      if (this.postLoginSessionCookieValue) {
        return {
          found: true,
          url: target.origin,
          name: POST_LOGIN_SESSION_COOKIE_NAME,
          domain: target.hostname,
          value: this.postLoginSessionCookieValue,
          userId: modelUserId,
        };
      }
      const cookies = await this.getAuthSession().cookies.get({
        url: `${target.origin}/`,
        name: POST_LOGIN_SESSION_COOKIE_NAME,
      });
      const sessionCookie = cookies.find((cookie) => cookie.name === POST_LOGIN_SESSION_COOKIE_NAME);
      return {
        found: Boolean(sessionCookie?.value),
        url: target.origin,
        name: POST_LOGIN_SESSION_COOKIE_NAME,
        domain: sessionCookie?.domain,
        value: sessionCookie?.value,
        userId: modelUserId,
      };
    } catch {
      return {
        found: false,
        url: target.origin,
        name: POST_LOGIN_SESSION_COOKIE_NAME,
        userId: modelUserId,
      };
    }
  }

  async getSystemDefaultModelProviderInfo(forceRefresh = false): Promise<SystemDefaultModelProviderInfo> {
    if (!forceRefresh && this.systemDefaultModelProviderInfoCache) {
      return this.systemDefaultModelProviderInfoCache;
    }

    if (!forceRefresh && this.systemDefaultModelProviderInfoRequest) {
      return await this.systemDefaultModelProviderInfoRequest;
    }

    const request = this.requestSystemDefaultModelProviderInfo();
    this.systemDefaultModelProviderInfoRequest = request;
    try {
      const info = await request;
      this.systemDefaultModelProviderInfoCache = info;
      return info;
    } finally {
      if (this.systemDefaultModelProviderInfoRequest === request) {
        this.systemDefaultModelProviderInfoRequest = null;
      }
    }
  }

  async startLoginFlow(): Promise<{ started: true; authorizationUrl: string }> {
    if (!this.isEnabled()) {
      throw new Error('App auth is disabled');
    }

    const codeVerifier = buildCodeVerifier();
    const codeChallenge = buildCodeChallenge(codeVerifier);
    const state = buildCodeVerifier();
    const nonce = buildCodeVerifier();
    this.clearPendingFlow();
    this.pendingFlow = {
      state,
      codeVerifier,
      webRetryCount: 0,
      cookiePollMisses: 0,
      redirectPageAutoClickCount: 0,
    };

    if (this.isLoopbackCallbackMode()) {
      this.pendingFlow.closeLoopbackServer = await this.startLoopbackCallbackServer();
    }

    const prompt = this.forcePromptLoginOnce ? 'login' : AUTH_PROMPT;
    // Only force IdP login on the first request after logout.
    // Retries in the same flow should not keep forcing re-auth.
    this.forcePromptLoginOnce = false;
    const authUrl = new URL(this.normalizeAuthUrl(AUTHORIZATION_ENDPOINT, prompt));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('code_challenge', codeChallenge);

    const authorizationUrl = authUrl.toString();
    if (this.pendingFlow) {
      this.pendingFlow.authorizationUrl = authorizationUrl;
    }
    try {
      await this.openLoginInMainWindow(authorizationUrl);
    } catch (error) {
      this.clearPendingFlow();
      this.cleanupMainWindowAuthNavigation();
      throw error;
    }
    this.emit('auth:started', { authorizationUrl });

    return { started: true, authorizationUrl };
  }

  async handleProtocolCallback(url: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    if (!this.isProtocolCallbackMode()) return false;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const expectedProtocol = this.getAppCallbackProtocol();
    if (!expectedProtocol || parsed.protocol !== `${expectedProtocol}:`) {
      return false;
    }

    const expectedLocation = this.getExpectedAppCallbackLocation();
    if (!expectedLocation) return false;
    if (parsed.host !== expectedLocation.host || parsed.pathname !== expectedLocation.pathname) {
      return false;
    }

    const oauthError = parsed.searchParams.get('error');
    if (oauthError) {
      const message = parsed.searchParams.get('error_description') || oauthError;
      this.clearPendingFlow();
      this.emit('auth:error', { authenticated: false, reason: message });
      return true;
    }

    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    if (!this.pendingFlow || !code || !state) {
      this.clearPendingFlow();
      this.emit('auth:error', { authenticated: false, reason: 'Missing code/state or no active login flow' });
      return true;
    }

    if (state !== this.pendingFlow.state) {
      this.clearPendingFlow();
      this.emit('auth:error', { authenticated: false, reason: 'State mismatch' });
      return true;
    }

    await this.completeAuthorization(code, state);

    return true;
  }

  async logout(): Promise<void> {
    logger.info('[AppAuth] Logout requested');
    await this.clearAuthCookies();
    await getSecretStore().delete(APP_AUTH_ACCOUNT_ID);
    this.clearPendingFlow();
    this.postLoginModelUserId = null;
    this.postLoginSessionCookieValue = null;
    this.systemDefaultModelProviderInfoCache = null;
    this.systemDefaultModelProviderInfoRequest = null;
    this.forcePromptLoginOnce = true;
    logger.info('[AppAuth] Logout completed');
    this.emit('auth:logout', { authenticated: false } satisfies AuthEventPayload);
  }
}

export const appAuthManager = new AppAuthManager();
