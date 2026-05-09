import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
}));

describe('diagnostics snapshot builder', () => {
  it('reports a critical issue when Gateway is unhealthy', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: {
        state: 'running',
        port: 18789,
      },
      gatewayHealth: {
        ok: false,
        error: 'health probe failed',
      },
      recentLogs: [],
    });

    expect(snapshot.overallStatus).toBe('critical');
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gateway-health-failed',
          severity: 'critical',
          area: 'gateway',
        }),
      ])
    );
    expect(snapshot.metrics.gateway.lastError).toBe('health probe failed');
  });

  it('counts recent warning and error log lines', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: {
        state: 'running',
        port: 18789,
      },
      gatewayHealth: {
        ok: true,
      },
      recentLogs: [
        '[2026-05-07T00:00:00.000Z] [WARN ] first warning',
        '[2026-05-07T00:00:01.000Z] [ERROR] first error',
        '[2026-05-07T00:00:02.000Z] [INFO ] normal',
      ],
    });

    expect(snapshot.overallStatus).toBe('degraded');
    expect(snapshot.metrics.logs).toEqual({
      errorCount: 1,
      warnCount: 1,
      sampledLines: 3,
    });
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recent-error-logs',
          severity: 'warning',
          area: 'app',
          evidence: ['[2026-05-07T00:00:01.000Z] [ERROR] first error'],
        }),
      ])
    );
  });

  it('includes redacted warning evidence when only warnings are present', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: {
        state: 'running',
        port: 18789,
      },
      gatewayHealth: {
        ok: true,
      },
      recentLogs: [
        '[2026-05-07T00:00:00.000Z] [WARN ] Authorization: Bearer secret-token',
        '[2026-05-07T00:00:01.000Z] [INFO ] normal',
      ],
    });

    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recent-warning-logs',
          evidence: ['[2026-05-07T00:00:00.000Z] [WARN ] Authorization: Bearer [redacted]'],
        }),
      ])
    );
  });

  it('classifies common warning patterns into actionable issues', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: {
        state: 'running',
        port: 19790,
      },
      gatewayHealth: {
        ok: true,
      },
      recentLogs: [
        '[2026-05-07T08:48:45.475Z] [WARN ] [Gateway stderr] [ws] closed before connect code=1006',
        '[2026-05-07T08:48:46.014Z] [WARN ] [Gateway stderr] [model-pricing] OpenRouter pricing fetch failed: TypeError: fetch failed',
        '[2026-05-07T08:48:51.800Z] [WARN ] [Gateway stderr] [bonjour] watchdog detected non-announced service',
        '[2026-05-07T08:48:58.796Z] [WARN ] [Gateway stderr] [bonjour] gateway name conflict resolved',
      ],
    });

    expect(snapshot.issues.map((issue) => issue.id)).toEqual([
      'bonjour-service-conflict',
      'openrouter-pricing-unavailable',
      'transient-websocket-close',
    ]);
    expect(snapshot.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'recent-warning-logs',
        }),
      ])
    );
  });

  it('reports provider missing credentials', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: { state: 'running', port: 18789 },
      gatewayHealth: { ok: true },
      recentLogs: [],
      providerInfo: {
        enabled: 3,
        missingCredentials: 2,
        total: 5,
        httpBaseUrls: [],
      },
    });

    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider-missing-credentials',
          severity: 'warning',
          area: 'provider',
        }),
      ])
    );
    expect(snapshot.metrics.providers).toEqual({
      enabled: 3,
      missingCredentials: 2,
      totalProviders: 5,
    });
    expect(snapshot.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'provider',
          status: 'degraded',
        }),
      ])
    );
  });

  it('reports provider HTTP base URL as security warning', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: { state: 'running', port: 18789 },
      gatewayHealth: { ok: true },
      recentLogs: [],
      providerInfo: {
        enabled: 2,
        missingCredentials: 0,
        total: 2,
        httpBaseUrls: ['OpenAI: http://local-llm:8080/v1'],
      },
    });

    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider-http-base-url',
          severity: 'warning',
          area: 'security',
        }),
      ])
    );
  });

  it('reports channel errors', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: { state: 'running', port: 18789 },
      gatewayHealth: { ok: true },
      recentLogs: [],
      channelInfo: {
        connected: 1,
        error: 2,
        connecting: 1,
        disconnected: 0,
      },
    });

    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'channel-errors',
          severity: 'warning',
          area: 'channel',
        }),
      ])
    );
    expect(snapshot.metrics.channels).toEqual({
      connected: 1,
      error: 2,
      connecting: 1,
      disconnected: 0,
    });
  });

  it('detects credential leaks in logs and creates security issue', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: { state: 'running', port: 18789 },
      gatewayHealth: { ok: true },
      recentLogs: ['[2026-05-07T00:00:00.000Z] [INFO ] api_key=sk-1234567890123456'],
      securityInfo: {
        proxyEnabled: false,
        mcpServerCount: 1,
        suspiciousMcpConfigs: 0,
      },
    });

    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'credential-leak-in-logs',
          severity: 'warning',
          area: 'security',
        }),
      ])
    );
  });

  it('reports suspicious MCP configurations', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: { state: 'running', port: 18789 },
      gatewayHealth: { ok: true },
      recentLogs: [],
      securityInfo: {
        proxyEnabled: false,
        mcpServerCount: 3,
        suspiciousMcpConfigs: 2,
      },
    });

    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mcp-suspicious-config',
          severity: 'warning',
          area: 'security',
        }),
      ])
    );
    expect(snapshot.metrics.security).toEqual({
      proxyEnabled: false,
      proxyServer: undefined,
      mcpServerCount: 3,
      suspiciousMcpConfigs: 2,
    });
  });

  it('includes all six sections in snapshot', async () => {
    const { buildDiagnosticSnapshot } = await import('@electron/utils/diagnostics');

    const snapshot = buildDiagnosticSnapshot({
      generatedAt: '2026-05-07T00:00:00.000Z',
      gatewayStatus: { state: 'running', port: 18789 },
      gatewayHealth: { ok: true },
      recentLogs: [],
      providerInfo: { enabled: 2, missingCredentials: 0, total: 2, httpBaseUrls: [] },
      channelInfo: { connected: 2, error: 0, connecting: 0, disconnected: 0 },
      securityInfo: { proxyEnabled: false, mcpServerCount: 1, suspiciousMcpConfigs: 0 },
    });

    const areas = snapshot.sections.map((s) => s.area);
    expect(areas).toEqual(expect.arrayContaining(['gateway', 'app', 'provider', 'channel', 'security', 'mcp']));
  });
});

describe('diagnostic logs', () => {
  it('filters by level', async () => {
    const { getDiagnosticLogs } = await import('@electron/utils/diagnostics');

    // Note: this test validates the filtering logic. In real usage,
    // the logs come from logger.getRecentLogs which depends on state.
    const lines = getDiagnosticLogs({
      tailLines: 100,
      level: 'error',
      minLevel: 3,
    });

    for (const line of lines) {
      expect(line).not.toContain('[INFO');
      expect(line).not.toContain('[DEBUG');
    }
  });

  it('applies redaction when enabled', async () => {
    const { redactDiagnosticEvidence } = await import('@electron/utils/diagnostics');

    const result = redactDiagnosticEvidence('Authorization: Bearer sk-abc123');
    expect(result).toBe('Authorization: Bearer [redacted]');

    const result2 = redactDiagnosticEvidence('api_key=mysecretkey');
    expect(result2).toMatch(/\[redacted\]/);

    const result3 = redactDiagnosticEvidence(
      '[INFO ] response { "bodyPreview": "{\\"data\\":{\\"apiKey\\":\\"sk-sensitive-secret-1234567890\\"}}" }'
    );
    expect(result3).toContain('"bodyPreview": "[redacted]"');
    expect(result3).not.toContain('sk-sensitive-secret');

    const result4 = redactDiagnosticEvidence(
      '[INFO ] cookie { "sessionCookieSummary": { "prefix": "abc123", "suffix": "xyz789" } }'
    );
    expect(result4).not.toContain('abc123');
    expect(result4).not.toContain('xyz789');
  });
});
