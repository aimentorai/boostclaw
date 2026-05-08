import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test.describe('BoostClaw diagnostics panel', () => {
  test('shows local health snapshot in settings', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/diagnostics/snapshot","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              generatedAt: '2026-05-07T08:00:00.000Z',
              overallStatus: 'degraded',
              sections: [
                {
                  area: 'gateway',
                  status: 'healthy',
                  summary: 'Gateway is running and health check passed.',
                },
                {
                  area: 'app',
                  status: 'degraded',
                  summary: '1 error log line found.',
                },
                {
                  area: 'provider',
                  status: 'healthy',
                  summary: 'All 3 provider(s) have credentials configured.',
                },
                {
                  area: 'channel',
                  status: 'healthy',
                  summary: '2 channel(s) connected.',
                },
                {
                  area: 'security',
                  status: 'healthy',
                  summary: 'No security concerns detected.',
                },
                {
                  area: 'mcp',
                  status: 'healthy',
                  summary: '1 MCP server(s) configured.',
                },
              ],
              issues: [
                {
                  id: 'bonjour-service-conflict',
                  severity: 'info',
                  area: 'network',
                  title: 'Bonjour service name conflict',
                  detail: 'OpenClaw Gateway detected a local service discovery name conflict.',
                  suggestion: 'Check for multiple BoostClaw/OpenClaw instances.',
                  fixAction: 'restartGateway',
                  evidence: ['[WARN ] [bonjour] gateway name conflict resolved'],
                },
              ],
              metrics: {
                gateway: {
                  state: 'running',
                  port: 18789,
                },
                logs: {
                  errorCount: 0,
                  warnCount: 1,
                  sampledLines: 12,
                },
                providers: {
                  enabled: 3,
                  missingCredentials: 0,
                  totalProviders: 3,
                },
                channels: {
                  connected: 2,
                  error: 0,
                  connecting: 0,
                  disconnected: 0,
                },
                security: {
                  proxyEnabled: false,
                  mcpServerCount: 1,
                  suspiciousMcpConfigs: 0,
                },
              },
            },
          },
        },
      },
    });

    await page.getByTestId('sidebar-nav-settings').click();

    await expect(page.getByTestId('settings-diagnostics-panel')).toBeVisible();
    await expect(page.getByTestId('settings-diagnostics-status')).toContainText(/Degraded|降级|低下/);
    await expect(page.getByTestId('settings-diagnostics-issues')).toContainText(
      'Bonjour service name conflict'
    );
    await expect(page.getByTestId('settings-diagnostics-issues')).toContainText(
      '[bonjour] gateway name conflict resolved'
    );

    await page.getByTestId('settings-diagnostics-refresh').click();
    await expect(page.getByTestId('settings-diagnostics-status')).toContainText(/Degraded|降级|低下/);
  });

  test('diagnostics panel shows expanded metrics when available', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/diagnostics/snapshot","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              generatedAt: '2026-05-07T08:00:00.000Z',
              overallStatus: 'degraded',
              sections: [
                { area: 'gateway', status: 'healthy', summary: 'Gateway running.' },
                { area: 'app', status: 'healthy', summary: 'No issues.' },
                {
                  area: 'provider',
                  status: 'degraded',
                  summary: '2 provider(s) missing credentials.',
                },
                {
                  area: 'channel',
                  status: 'degraded',
                  summary: '1 channel(s) with errors.',
                },
                {
                  area: 'security',
                  status: 'degraded',
                  summary: 'Potential credential exposure.',
                },
                { area: 'mcp', status: 'healthy', summary: '1 MCP server.' },
              ],
              issues: [
                {
                  id: 'provider-missing-credentials',
                  severity: 'warning',
                  area: 'provider',
                  title: 'Provider credentials missing',
                  detail: '2 of 3 provider(s) missing API keys.',
                  suggestion: 'Open provider settings.',
                  fixAction: 'openProviderSettings',
                },
                {
                  id: 'credential-leak-in-logs',
                  severity: 'warning',
                  area: 'security',
                  title: 'Credentials detected in logs',
                  detail: 'Log output may contain API keys.',
                  suggestion: 'Rotate any leaked keys.',
                  fixAction: 'openLogs',
                  evidence: ['[INFO ] api_key=[redacted]'],
                },
              ],
              metrics: {
                gateway: { state: 'running', port: 18789 },
                logs: { errorCount: 0, warnCount: 0, sampledLines: 10 },
                providers: { enabled: 3, missingCredentials: 2, totalProviders: 3 },
                channels: { connected: 1, error: 1, connecting: 0, disconnected: 2 },
                security: { proxyEnabled: false, mcpServerCount: 1, suspiciousMcpConfigs: 0 },
              },
            },
          },
        },
      },
    });

    await page.getByTestId('sidebar-nav-settings').click();

    await expect(page.getByTestId('settings-diagnostics-panel')).toBeVisible();
    await expect(page.getByTestId('settings-diagnostics-status')).toContainText(/Degraded|降级|低下/);

    await expect(page.getByTestId('settings-diagnostics-issues')).toContainText(
      'Provider credentials missing'
    );
    await expect(page.getByTestId('settings-diagnostics-issues')).toContainText(
      'Credentials detected in logs'
    );
    await expect(page.getByTestId('settings-diagnostics-issues')).toContainText('[redacted]');
  });

  test('diagnostic log viewer shows filtered logs', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/diagnostics/snapshot","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              generatedAt: '2026-05-07T08:00:00.000Z',
              overallStatus: 'healthy',
              sections: [
                { area: 'gateway', status: 'healthy', summary: 'Gateway running.' },
                { area: 'app', status: 'healthy', summary: 'No issues.' },
                { area: 'provider', status: 'healthy', summary: 'OK.' },
                { area: 'channel', status: 'healthy', summary: 'OK.' },
                { area: 'security', status: 'healthy', summary: 'OK.' },
                { area: 'mcp', status: 'healthy', summary: 'OK.' },
              ],
              issues: [],
              metrics: {
                gateway: { state: 'running', port: 18789 },
                logs: { errorCount: 0, warnCount: 0, sampledLines: 0 },
              },
            },
          },
        },
        '["/api/diagnostics/logs?tailLines=200&redact=true","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              lines: [
                '[2026-05-07T08:00:00.000Z] [INFO ] Gateway started on port 18789',
                '[2026-05-07T08:00:01.000Z] [WARN ] Authorization: Bearer [redacted]',
              ],
              count: 2,
              filtered: false,
            },
          },
        },
      },
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-diagnostics-panel')).toBeVisible();

    await page.getByTestId('settings-diagnostics-logs-toggle').click();
    await expect(page.getByTestId('settings-diagnostics-logs-output')).toBeVisible();
    await expect(page.getByTestId('settings-diagnostics-logs-output')).toContainText(
      'Gateway started on port 18789'
    );
    await expect(page.getByTestId('settings-diagnostics-logs-output')).toContainText('[redacted]');
  });

  test('diagnostics export button is visible', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/diagnostics/snapshot","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              generatedAt: '2026-05-07T08:00:00.000Z',
              overallStatus: 'healthy',
              sections: [],
              issues: [],
              metrics: {
                gateway: { state: 'running', port: 18789 },
                logs: { errorCount: 0, warnCount: 0, sampledLines: 0 },
              },
            },
          },
        },
      },
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-diagnostics-panel')).toBeVisible();
    await expect(page.getByTestId('settings-diagnostics-export')).toBeVisible();
  });

  test('standalone diagnostics page is accessible from sidebar', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/diagnostics/snapshot","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              generatedAt: '2026-05-07T08:00:00.000Z',
              overallStatus: 'healthy',
              sections: [
                { area: 'gateway', status: 'healthy', summary: 'Gateway running.' },
                { area: 'app', status: 'healthy', summary: 'No issues.' },
                { area: 'provider', status: 'healthy', summary: 'OK.' },
                { area: 'channel', status: 'healthy', summary: 'OK.' },
                { area: 'security', status: 'healthy', summary: 'OK.' },
                { area: 'mcp', status: 'healthy', summary: 'OK.' },
              ],
              issues: [
                {
                  id: 'bonjour-service-conflict',
                  severity: 'info',
                  area: 'network',
                  title: 'Bonjour service name conflict',
                  detail: 'Name conflict detected.',
                  suggestion: 'Check for multiple instances.',
                  fixAction: 'restartGateway',
                  evidence: ['[WARN ] name conflict'],
                },
              ],
              metrics: {
                gateway: { state: 'running', port: 18789 },
                logs: { errorCount: 0, warnCount: 0, sampledLines: 0 },
                providers: { enabled: 2, missingCredentials: 0, totalProviders: 2 },
                channels: { connected: 1, error: 0, connecting: 0, disconnected: 0 },
                security: { proxyEnabled: false, mcpServerCount: 1, suspiciousMcpConfigs: 0 },
              },
            },
          },
        },
        '["/api/diagnostics/fix","POST"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { ok: true, detail: 'Gateway restart initiated.' },
          },
        },
      },
    });

    await page.getByTestId('sidebar-nav-diagnostics').click();

    await expect(page.getByTestId('diagnostics-issues')).toBeVisible();
    await expect(page.getByTestId('diagnostics-section-gateway')).toBeVisible();
    await expect(page.getByTestId('diagnostics-section-provider')).toBeVisible();
    await expect(page.getByTestId('diagnostics-section-security')).toBeVisible();

    await expect(page.getByTestId('diagnostics-issue')).toContainText('Bonjour service name conflict');

    await expect(page.getByTestId('diagnostics-refresh')).toBeVisible();
    await expect(page.getByTestId('diagnostics-export')).toBeVisible();

    await page.getByTestId('diagnostics-fix-restartGateway').click();
    await expect(page.getByTestId('diagnostics-fix-result')).toBeVisible();
  });

  test('standalone diagnostics page shows fix confirmation for destructive actions', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/diagnostics/snapshot","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              generatedAt: '2026-05-07T08:00:00.000Z',
              overallStatus: 'critical',
              sections: [
                { area: 'gateway', status: 'critical', summary: 'Gateway is not running.' },
                { area: 'app', status: 'healthy', summary: 'No issues.' },
                { area: 'provider', status: 'healthy', summary: 'OK.' },
                { area: 'channel', status: 'healthy', summary: 'OK.' },
                { area: 'security', status: 'healthy', summary: 'OK.' },
                { area: 'mcp', status: 'healthy', summary: 'OK.' },
              ],
              issues: [
                {
                  id: 'gateway-not-running',
                  severity: 'critical',
                  area: 'gateway',
                  title: 'Gateway is not running',
                  detail: 'Current state is "stopped".',
                  suggestion: 'Start or restart the Gateway.',
                  fixAction: 'restartGateway',
                },
              ],
              metrics: {
                gateway: { state: 'stopped', port: 18789 },
                logs: { errorCount: 0, warnCount: 0, sampledLines: 0 },
              },
            },
          },
        },
      },
    });

    await page.getByTestId('sidebar-nav-diagnostics').click();

    await expect(page.getByTestId('diagnostics-issues')).toBeVisible();
    await expect(page.getByTestId('diagnostics-issues')).toContainText('Gateway is not running');

    await page.getByTestId('diagnostics-fix-restartGateway').click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toContainText('restart the Gateway');
  });
});
