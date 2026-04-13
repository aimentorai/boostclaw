import { EventEmitter } from 'events';
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { BrowserWindow, session } from 'electron';
import { getSecretStore } from '../services/secrets/secret-store';
import { logger } from './logger';

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
  private cleanupAuthMaskSync: (() => void) | null = null;
  private cookiePollTimer: NodeJS.Timeout | null = null;

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window;
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
    if (!this.authMaskWindow || this.authMaskWindow.isDestroyed()) {
      this.authMaskWindow = null;
      return;
    }
    this.authMaskWindow.destroy();
    this.authMaskWindow = null;
  }

  private async showAuthMaskWindow(): Promise<void> {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      return;
    }
    if (this.authMaskWindow && !this.authMaskWindow.isDestroyed()) {
      const bounds = win.getBounds();
      this.authMaskWindow.setBounds(bounds);
      this.authMaskWindow.showInactive();
      this.authMaskWindow.moveTop();
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

  private clearPendingFlow(): void {
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
    this.closeAuthWindow();
    this.closeAuthMaskWindow();
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
    const returnUrl = this.authReturnUrl ? this.normalizeMainWindowReturnUrl(this.authReturnUrl) : null;
    this.cleanupMainWindowAfterAuth();
    if (!win || win.isDestroyed() || !returnUrl) {
      return;
    }
    await win.loadURL(returnUrl);
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
      this.clearPendingFlow();
      const payload = await this.persistToken(token);
      await this.restoreMainWindowAfterAuth();
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
      this.clearPendingFlow();
      const payload = await this.persistToken(token);
      await this.restoreMainWindowAfterAuth();
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

    this.clearPendingFlow();
    const payload = await this.persistToken(token);
    await this.restoreMainWindowAfterAuth();
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

  private async syncAuthMaskByUrl(urlText: string): Promise<void> {
    const flow = this.pendingFlow;
    if (!flow || flow.completed) {
      this.closeAuthMaskWindow();
      return;
    }
    if (this.isWebRedirectUrl(urlText)) {
      await this.showAuthMaskWindow();
      return;
    }
    this.closeAuthMaskWindow();
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
          const targets = ['登录', '登入', 'login', 'log in', 'sign in', 'continue', '继续', '授权', 'confirm', '确认'];
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

    const handleBeforeNavigate = (event: Electron.Event, url: string) => {
      if (!this.shouldHandleAuthNavigation(url)) {
        return;
      }
      this.emitDebug('web_will_navigate', summarizeAuthUrl(url));
      logger.info(`[AppAuth] will-navigate/redirect: ${summarizeAuthUrl(url).location}`);
      if (this.shouldPreventAuthNavigation(url)) {
        event.preventDefault();
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
    this.forcePromptLoginOnce = true;
    logger.info('[AppAuth] Logout completed');
    this.emit('auth:logout', { authenticated: false } satisfies AuthEventPayload);
  }
}

export const appAuthManager = new AppAuthManager();
