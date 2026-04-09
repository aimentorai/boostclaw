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
  closeLoopbackServer?: () => void;
};

const APP_AUTH_ACCOUNT_ID = '__BoostClaw_app_auth__';

const AUTH_ENABLED = process.env.BoostClaw_APP_AUTH_ENABLED === '1';
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
const AUTH_PROMPT = (process.env.BoostClaw_APP_AUTH_PROMPT || 'login').trim();
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

export class AppAuthManager extends EventEmitter {
  private pendingFlow: PendingAuthFlow | null = null;
  private mainWindow: BrowserWindow | null = null;
  private authWindow: BrowserWindow | null = null;
  private authReturnUrl: string | null = null;
  private cleanupMainWindowAuthListeners: (() => void) | null = null;
  private cleanupSessionCookieListener: (() => void) | null = null;
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
    this.closeAuthWindow();
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
  }

  private cleanupMainWindowAfterAuth(): void {
    this.authReturnUrl = null;
    this.cleanupMainWindowAuthNavigation();
  }

  private async restoreMainWindowAfterAuth(): Promise<void> {
    const win = this.mainWindow;
    const returnUrl = this.authReturnUrl;
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

  private getAuthSession(): Electron.Session {
    const activeSession = this.mainWindow?.webContents.session;
    return activeSession || session.defaultSession;
  }

  private async getAuthCookie(): Promise<Electron.Cookie | null> {
    const cookies = await this.getAuthSession().cookies.get({ name: AUTH_COOKIE_NAME });
    return cookies.find((cookie) => typeof cookie.value === 'string' && cookie.value.length > 0) || null;
  }

  private async clearAuthCookies(): Promise<void> {
    const cookies = await this.getAuthSession().cookies.get({ name: AUTH_COOKIE_NAME });
    for (const cookie of cookies) {
      const domain = (cookie.domain || '').replace(/^\./, '');
      if (!domain) {
        continue;
      }
      const protocol = cookie.secure ? 'https' : 'http';
      const path = cookie.path || '/';
      const url = `${protocol}://${domain}${path}`;
      try {
        await this.getAuthSession().cookies.remove(url, cookie.name);
      } catch (error) {
        logger.warn('[AppAuth] Failed to remove auth cookie:', error);
      }
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

  private normalizeAuthUrl(authUrl: string): string {
    const url = new URL(authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', SCOPE);
    if (AUTH_PROMPT) {
      url.searchParams.set('prompt', AUTH_PROMPT);
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
      this.cleanupMainWindowAfterAuth();
      this.emit('auth:success', payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.clearPendingFlow();
      this.cleanupMainWindowAfterAuth();
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

    const oauthError = parsed.searchParams.get('error');
    if (oauthError) {
      const reason = parsed.searchParams.get('error_description') || oauthError;
      this.clearPendingFlow();
      this.emit('auth:error', { authenticated: false, reason });
      return true;
    }

    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    if (!code || !state) {
      return false;
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
    if (!win || win.isDestroyed() || !this.pendingFlow || this.pendingFlow.completed) {
      return false;
    }

    const currentUrl = urlText || win.webContents.getURL() || '';

    let authCookie: Electron.Cookie | null = null;

    for (let attempt = 1; ; attempt += 1) {
      if (!this.pendingFlow || this.pendingFlow.completed || win.isDestroyed()) {
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

    this.pendingFlow.completed = true;
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
    const handledByStoredToken = await this.captureStoredTokenFromSession(url);
    if (handledByStoredToken) return true;
    if (this.isWebRedirectUrl(url)) {
      return await this.handleWebRedirectCallback(url);
    }
    const handledByRedirect = await this.handleWebRedirectCallback(url);
    if (handledByRedirect) return true;
    return await this.handleProtocolCallback(url);
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
        void this.handleAuthNavigation(win.webContents.getURL());
        return;
      }
      const currentUrl = win.webContents.getURL();
      if (!currentUrl || currentUrl !== url) {
        return;
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

    const handleBeforeNavigate = (event: Electron.Event, url: string) => {
      if (!this.shouldHandleAuthNavigation(url)) {
        return;
      }
      if (this.shouldPreventAuthNavigation(url)) {
        event.preventDefault();
      }
      void this.handleAuthNavigation(url);
    };
    const handleAfterNavigate = (_event: Electron.Event, url: string) => {
      if (!this.shouldHandleAuthNavigation(url)) {
        return;
      }
      void this.handleAuthNavigation(url);
    };
    const handleFinishLoad = () => {
      const currentUrl = win.webContents.getURL();
      void this.handleAuthNavigation(currentUrl);
      this.scheduleCookiePoll(currentUrl);
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
      void this.handleAuthNavigation(win.webContents.getURL());
    };

    win.webContents.on('will-redirect', handleBeforeNavigate);
    win.webContents.on('will-navigate', handleBeforeNavigate);
    win.webContents.on('did-navigate', handleAfterNavigate);
    win.webContents.on('did-redirect-navigation', handleAfterNavigate);
    win.webContents.on('did-finish-load', handleFinishLoad);
    win.webContents.session.cookies.on('changed', handleCookieChanged);
    this.cleanupMainWindowAuthListeners = () => {
      win.webContents.removeListener('will-redirect', handleBeforeNavigate);
      win.webContents.removeListener('will-navigate', handleBeforeNavigate);
      win.webContents.removeListener('did-navigate', handleAfterNavigate);
      win.webContents.removeListener('did-redirect-navigation', handleAfterNavigate);
      win.webContents.removeListener('did-finish-load', handleFinishLoad);
    };
    this.cleanupSessionCookieListener = () => {
      win.webContents.session.cookies.removeListener('changed', handleCookieChanged);
    };

    await win.loadURL(authorizationUrl);
  }

  async getAuthStatus(): Promise<AuthEventPayload & { enabled: boolean }> {
    if (!this.isEnabled()) {
      return { enabled: false, authenticated: true };
    }

    const authCookie = await this.getAuthCookie();
    if (!authCookie?.value) {
      await getSecretStore().delete(APP_AUTH_ACCOUNT_ID);
      return { enabled: true, authenticated: false };
    }

    const secret = await getSecretStore().get(APP_AUTH_ACCOUNT_ID);
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
    this.pendingFlow = { state, codeVerifier };

    if (this.isLoopbackCallbackMode()) {
      this.pendingFlow.closeLoopbackServer = await this.startLoopbackCallbackServer();
    }

    const authUrl = new URL(this.normalizeAuthUrl(AUTHORIZATION_ENDPOINT));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('code_challenge', codeChallenge);

    const authorizationUrl = authUrl.toString();
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
    await this.clearAuthCookies();
    await getSecretStore().delete(APP_AUTH_ACCOUNT_ID);
    this.clearPendingFlow();
    this.emit('auth:logout', { authenticated: false } satisfies AuthEventPayload);
  }
}

export const appAuthManager = new AppAuthManager();
