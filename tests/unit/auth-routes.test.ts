import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getAuthStatusMock = vi.fn();
const getAuthDebugInfoMock = vi.fn();
const getSubscriptionQuotaSummaryMock = vi.fn();
const syncSubscriptionMcpConfigMock = vi.fn();
const getPostLoginSessionCookieInfoMock = vi.fn();
const getSystemDefaultModelProviderInfoMock = vi.fn();
const createSubscriptionAutoTrialMock = vi.fn();
const startLoginFlowMock = vi.fn();
const logoutMock = vi.fn();
const sendJsonMock = vi.fn();
const parseJsonBodyMock = vi.fn();

vi.mock('@electron/utils/app-auth', () => ({
  appAuthManager: {
    getAuthStatus: (...args: unknown[]) => getAuthStatusMock(...args),
    getAuthDebugInfo: (...args: unknown[]) => getAuthDebugInfoMock(...args),
    getSubscriptionQuotaSummary: (...args: unknown[]) => getSubscriptionQuotaSummaryMock(...args),
    syncSubscriptionMcpConfig: (...args: unknown[]) => syncSubscriptionMcpConfigMock(...args),
    getPostLoginSessionCookieInfo: (...args: unknown[]) => getPostLoginSessionCookieInfoMock(...args),
    getSystemDefaultModelProviderInfo: (...args: unknown[]) => getSystemDefaultModelProviderInfoMock(...args),
    createSubscriptionAutoTrial: (...args: unknown[]) => createSubscriptionAutoTrialMock(...args),
    startLoginFlow: (...args: unknown[]) => startLoginFlowMock(...args),
    logout: (...args: unknown[]) => logoutMock(...args),
  },
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleAuthRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns auth debug info through the host api', async () => {
    getAuthDebugInfoMock.mockResolvedValueOnce({
      enabled: true,
      authenticated: true,
      source: 'electron_session_cookie',
      accessToken: 'Bearer test-token',
      refreshToken: '',
      portalUserId: 'user-123',
    });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');

    const handled = await handleAuthRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/auth/debug'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(getAuthDebugInfoMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      source: 'electron_session_cookie',
      accessToken: 'Bearer test-token',
      portalUserId: 'user-123',
    }));
  });

  it('returns subscription quota summary through the host api', async () => {
    getSubscriptionQuotaSummaryMock.mockResolvedValueOnce({
      portalUserId: 'user-123',
      snapshots: [{ provider: 'tt', ok: true, status: 200, remainingQuota: 99 }],
    });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');

    const handled = await handleAuthRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/auth/subscription-quotas'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(getSubscriptionQuotaSummaryMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      portalUserId: 'user-123',
      snapshots: [expect.objectContaining({ provider: 'tt', remainingQuota: 99 })],
    }));
  });

  it('syncs subscription MCP config through the host api', async () => {
    syncSubscriptionMcpConfigMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      code: 'OK',
      portalUserId: 'user-123',
      serverNames: ['proboost-tiktok-mcp'],
    });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');

    const handled = await handleAuthRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/auth/subscription-mcp-config'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(syncSubscriptionMcpConfigMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      ok: true,
      code: 'OK',
      serverNames: ['proboost-tiktok-mcp'],
    }));
  });

  it('returns post-login session cookie info through the host api', async () => {
    getPostLoginSessionCookieInfoMock.mockResolvedValueOnce({
      found: true,
      url: 'https://model.microdata-inc.com',
      name: 'session',
      value: 'session-cookie-value',
    });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');

    const handled = await handleAuthRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/auth/post-login-session'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(getPostLoginSessionCookieInfoMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      found: true,
      name: 'session',
      value: 'session-cookie-value',
    }));
  });

  it('returns system default model provider info through the host api', async () => {
    getSystemDefaultModelProviderInfoMock.mockResolvedValueOnce({
      available: true,
      accountId: 'boostclaw-system-default',
      label: 'boostmodel',
      baseUrl: 'https://model.microdata-inc.com/v1/chat/completions',
      apiProtocol: 'openai-completions',
      keyMasked: 'sk-s***1234',
    });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');

    const handled = await handleAuthRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/auth/system-default-model-provider'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(getSystemDefaultModelProviderInfoMock).toHaveBeenCalledTimes(1);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      available: true,
      accountId: 'boostclaw-system-default',
      keyMasked: 'sk-s***1234',
    }));
  });

  it('creates subscription auto trial through the host api', async () => {
    parseJsonBodyMock.mockResolvedValueOnce({ provider: 'amz' });
    createSubscriptionAutoTrialMock.mockResolvedValueOnce({
      provider: 'amz',
      ok: true,
      status: 200,
      code: '0',
      message: 'OK',
    });
    const { handleAuthRoutes } = await import('@electron/api/routes/auth');

    const handled = await handleAuthRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/auth/subscription-auto-trial'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(parseJsonBodyMock).toHaveBeenCalledTimes(1);
    expect(createSubscriptionAutoTrialMock).toHaveBeenCalledWith('amz');
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      provider: 'amz',
      ok: true,
      code: '0',
    }));
  });
});
