import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetchMock = vi.fn();

const cookiesGetMock = vi.fn();
const cookiesRemoveMock = vi.fn();
const executeJavaScriptMock = vi.fn();
const secretStoreGetMock = vi.fn();
const secretStoreSetMock = vi.fn();
const secretStoreDeleteMock = vi.fn();
const globalFetchMock = vi.fn();
const readOpenClawConfigMock = vi.fn();
const writeOpenClawConfigMock = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: {
    fromPartition: vi.fn(() => ({
      cookies: {
        get: (...args: unknown[]) => cookiesGetMock(...args),
        remove: (...args: unknown[]) => cookiesRemoveMock(...args),
      },
    })),
    defaultSession: {
      cookies: {
        get: (...args: unknown[]) => cookiesGetMock(...args),
        remove: (...args: unknown[]) => cookiesRemoveMock(...args),
      },
    },
  },
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getSecretStore: () => ({
    get: (...args: unknown[]) => secretStoreGetMock(...args),
    set: (...args: unknown[]) => secretStoreSetMock(...args),
    delete: (...args: unknown[]) => secretStoreDeleteMock(...args),
  }),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfigMock(...args),
  writeOpenClawConfig: (...args: unknown[]) => writeOpenClawConfigMock(...args),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async <T>(fn: () => Promise<T>) => fn(),
}));

describe('AppAuthManager.getSubscriptionQuotaSummary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cookiesGetMock.mockReset();
    cookiesRemoveMock.mockReset();
    executeJavaScriptMock.mockReset();
    secretStoreGetMock.mockReset();
    secretStoreSetMock.mockReset();
    secretStoreDeleteMock.mockReset();
    globalFetchMock.mockReset();
    readOpenClawConfigMock.mockReset();
    writeOpenClawConfigMock.mockReset();
    vi.stubGlobal('fetch', globalFetchMock);
  });

  it('uses the fixed internal token for both quota providers', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    vi.spyOn(manager, 'getAuthDebugInfo').mockResolvedValue({
      enabled: true,
      authenticated: true,
      source: 'stored_secret',
      accessToken: 'Bearer test-token',
      refreshToken: '',
      portalUserId: 'user-123',
    });

    proxyAwareFetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          code: 'OK',
          message: 'success',
          isSuccess: true,
          data: { totalQuota: 100, usedQuota: 10, remainingQuota: 90 },
        })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          code: 'OK',
          message: 'success',
          isSuccess: true,
          data: { totalQuota: 50, usedQuota: 5, remainingQuota: 45 },
        })),
      });

    const result = await manager.getSubscriptionQuotaSummary();

    expect(result.portalUserId).toBe('user-123');
    expect(proxyAwareFetchMock).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://open.microdata-inc.com/subscription/quota/tt?userId=user-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-Internal-Token': '1234567890',
        },
      }),
    );
    expect(proxyAwareFetchMock).toHaveBeenNthCalledWith(
      2,
      'https://open.microdata-inc.com/subscription/quota/amz?userId=user-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-Internal-Token': '1234567890',
        },
      }),
    );
  });

  it('posts auto trial requests with the fixed internal token and user id', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    vi.spyOn(manager, 'getAuthDebugInfo').mockResolvedValue({
      enabled: true,
      authenticated: true,
      source: 'stored_secret',
      accessToken: 'Bearer test-token',
      refreshToken: '',
      portalUserId: 'user-123',
    });

    proxyAwareFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        code: '0',
        message: 'OK',
        isSuccess: true,
      })),
    });

    const result = await manager.createSubscriptionAutoTrial('amz');

    expect(result).toEqual(expect.objectContaining({
      provider: 'amz',
      ok: true,
      status: 200,
      code: '0',
    }));
    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      'https://open.microdata-inc.com/subscription/auto-trial/amz',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': '1234567890',
        },
        body: JSON.stringify({ userId: 'user-123' }),
      }),
    );
  });

  it('fetches and stores subscription MCP config with the portal user id', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    vi.spyOn(manager, 'getAuthDebugInfo').mockResolvedValue({
      enabled: true,
      authenticated: true,
      source: 'stored_secret',
      accessToken: 'Bearer test-token',
      refreshToken: '',
      portalUserId: 'user-123',
    });
    const config: Record<string, unknown> = {
      mcp: {
        servers: {
          existing: { command: 'node', args: ['server.js'] },
        },
      },
    };
    readOpenClawConfigMock.mockResolvedValue(config);
    writeOpenClawConfigMock.mockResolvedValue(undefined);

    proxyAwareFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        code: 'OK',
        message: 'success',
        isSuccess: true,
        data: {
          'proboost-tiktok-mcp': {
            type: 'sse',
            url: 'https://example.com/mcp-servers/proboost-tiktok-mcp/sse',
            headers: {
              'secret-key': 'mcp-secret-key',
            },
          },
        },
      })),
    });

    const result = await manager.syncSubscriptionMcpConfig();

    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      'https://open.microdata-inc.com/subscription/mcp-config?userId=user-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-Internal-Token': '1234567890',
        },
      }),
    );
    expect(writeOpenClawConfigMock).toHaveBeenCalledWith({
      mcp: {
        servers: {
          existing: { command: 'node', args: ['server.js'] },
          'proboost-tiktok-mcp': {
            type: 'sse',
            url: 'https://example.com/mcp-servers/proboost-tiktok-mcp/sse',
            headers: {
              'secret-key': 'mcp-secret-key',
            },
          },
        },
      },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 200,
      code: 'OK',
      portalUserId: 'user-123',
      serverNames: ['proboost-tiktok-mcp'],
      servers: [
        {
          name: 'proboost-tiktok-mcp',
          type: 'sse',
          url: 'https://example.com/mcp-servers/proboost-tiktok-mcp/sse',
        },
      ],
    }));
  });

  it('does not rewrite openclaw config when MCP servers are unchanged', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    vi.spyOn(manager, 'getAuthDebugInfo').mockResolvedValue({
      enabled: true,
      authenticated: true,
      source: 'stored_secret',
      accessToken: 'Bearer test-token',
      refreshToken: '',
      portalUserId: 'user-123',
    });
    const config: Record<string, unknown> = {
      mcp: {
        servers: {
          'proboost-tiktok-mcp': {
            type: 'sse',
            url: 'https://example.com/mcp-servers/proboost-tiktok-mcp/sse',
            headers: {
              'secret-key': 'mcp-secret-key',
            },
          },
        },
      },
    };
    readOpenClawConfigMock.mockResolvedValue(config);
    writeOpenClawConfigMock.mockResolvedValue(undefined);

    proxyAwareFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        code: 'OK',
        message: 'success',
        isSuccess: true,
        data: {
          'proboost-tiktok-mcp': {
            type: 'sse',
            url: 'https://example.com/mcp-servers/proboost-tiktok-mcp/sse',
            headers: {
              'secret-key': 'mcp-secret-key',
            },
          },
        },
      })),
    });

    const result = await manager.syncSubscriptionMcpConfig();

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      portalUserId: 'user-123',
      serverNames: ['proboost-tiktok-mcp'],
    }));
    expect(writeOpenClawConfigMock).not.toHaveBeenCalled();
  });

  it('reads the post-login session cookie from model.microdata-inc.com', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    (manager as { postLoginModelUserId: string | null }).postLoginModelUserId = 'model-user-123';
    secretStoreGetMock.mockResolvedValue(null);
    cookiesGetMock.mockResolvedValueOnce([
      {
        name: 'session',
        domain: 'model.microdata-inc.com',
        value: 'session-cookie-value',
      },
    ]);

    const result = await manager.getPostLoginSessionCookieInfo();

    expect(cookiesGetMock).toHaveBeenCalledWith({
      url: 'https://model.microdata-inc.com/',
      name: 'session',
    });
    expect(result).toEqual({
      found: true,
      url: 'https://model.microdata-inc.com',
      name: 'session',
      domain: 'model.microdata-inc.com',
      value: 'session-cookie-value',
      userId: 'model-user-123',
    });
  });

  it('clears the post-login session cookie on logout', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    secretStoreDeleteMock.mockResolvedValue(undefined);
    cookiesGetMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          name: 'session',
          domain: 'model.microdata-inc.com',
          path: '/',
          value: 'session-cookie-value',
        },
      ]);
    cookiesRemoveMock.mockResolvedValue(undefined);

    await manager.logout();

    expect(cookiesGetMock).toHaveBeenCalledWith({
      url: 'https://model.microdata-inc.com/',
      name: 'session',
    });
    expect(cookiesRemoveMock).toHaveBeenCalledWith('https://model.microdata-inc.com/', 'session');
  });

  it('fetches the system default model key with model session and model user id', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    (manager as { postLoginModelUserId: string | null }).postLoginModelUserId = 'model-user-123';
    (manager as { postLoginSessionCookieValue: string | null }).postLoginSessionCookieValue = 'captured-session-value';
    vi.spyOn(manager as { persistSystemDefaultProviderAccount: (apiKey: string) => Promise<void> }, 'persistSystemDefaultProviderAccount')
      .mockResolvedValue(undefined);
    secretStoreGetMock.mockResolvedValue(null);
    globalFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        data: {
          key: 'sk-system-default-1234',
        },
      })),
    });

    const result = await manager.getSystemDefaultModelProviderInfo();

    expect(globalFetchMock).toHaveBeenCalledWith(
      'https://open.microdata-inc.com/proxy-center/llm/token/system-default-key',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: {
          Cookie: 'session=captured-session-value',
          'new-api-user': 'model-user-123',
          'User-Agent': 'BoostClaw/1.0',
          Accept: '*/*',
        },
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      available: true,
      accountId: 'boostclaw-system-default',
      label: 'boostmodel',
      baseUrl: 'https://model.microdata-inc.com/v1/chat/completions',
      keyMasked: 'sk-s***1234',
      userId: 'model-user-123',
    }));
  });

  it('captures numeric model user id from post-login localStorage', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    const loadURLMock = vi.fn().mockResolvedValue(undefined);
    executeJavaScriptMock.mockResolvedValue({
      href: 'https://model.microdata-inc.com/console/token-new',
      hostname: 'model.microdata-inc.com',
      hasUser: true,
      userId: '10',
      parseError: null,
      keys: ['display_name', 'group', 'id', 'role', 'status', 'username'],
      rawPreview: '{"display_name":"81208","group":"default","id":10,"role":1,"status":1,"username":"81208"}',
    });

    manager.setWindow({
      isDestroyed: () => false,
      loadURL: loadURLMock,
      webContents: {
        executeJavaScript: (...args: unknown[]) => executeJavaScriptMock(...args),
      },
    } as never);

    secretStoreGetMock.mockResolvedValue({
      type: 'oauth',
      accountId: '__BoostClaw_app_auth__',
      accessToken: 'token',
      refreshToken: '',
      expiresAt: Date.now() + 60_000,
    });
    secretStoreSetMock.mockResolvedValue(undefined);
    cookiesGetMock.mockResolvedValue([
      {
        name: 'session',
        domain: 'model.microdata-inc.com',
        value: 'session-cookie-value',
      },
    ]);

    await (manager as { restoreMainWindowAfterAuth: () => Promise<void> }).restoreMainWindowAfterAuth();

    const result = await manager.getPostLoginSessionCookieInfo();

    expect(loadURLMock).toHaveBeenCalledWith('https://model.microdata-inc.com/login');
    expect(result).toEqual(expect.objectContaining({
      found: true,
      value: 'session-cookie-value',
      userId: '10',
    }));
    expect(secretStoreSetMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'oauth',
      modelUserId: '10',
    }));
  });

  it('restores persisted model user id without requiring relogin', async () => {
    const { AppAuthManager } = await import('@electron/utils/app-auth');
    const manager = new AppAuthManager();
    secretStoreGetMock.mockResolvedValue({
      type: 'oauth',
      accountId: '__BoostClaw_app_auth__',
      accessToken: 'token',
      refreshToken: '',
      expiresAt: Date.now() + 60_000,
      modelUserId: '10',
    });
    cookiesGetMock.mockResolvedValueOnce([
      {
        name: 'session',
        domain: 'model.microdata-inc.com',
        value: 'session-cookie-value',
      },
    ]);

    const result = await manager.getPostLoginSessionCookieInfo();

    expect(result).toEqual(expect.objectContaining({
      found: true,
      value: 'session-cookie-value',
      userId: '10',
    }));
  });
});
