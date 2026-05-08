import type { HostApiContext } from '../api/context';
import { logger } from './logger';
import { getAllProvidersWithKeyInfo } from './secure-storage';
import { readOpenClawConfig } from './channel-config';
import { getAllSettings } from './store';
import { resolveProxySettings } from './proxy';

interface GatewayChannelStatusPayload {
  channelAccounts?: Record<string, Array<{
    accountId?: string;
    configured?: boolean;
    connected?: boolean;
    running?: boolean;
    linked?: boolean;
    lastError?: string;
    name?: string;
  }>>;
}

export type DiagnosticSeverity = 'info' | 'warning' | 'critical';

export type DiagnosticArea =
  | 'app'
  | 'gateway'
  | 'provider'
  | 'channel'
  | 'storage'
  | 'network'
  | 'security'
  | 'mcp'
  | 'usage';

export type DiagnosticFixAction =
  | 'restartGateway'
  | 'runDoctor'
  | 'runDoctorFix'
  | 'openLogs'
  | 'openProviderSettings'
  | 'openChannelSettings'
  | 'openProxySettings'
  | 'openMcpSettings';

export type DiagnosticIssue = {
  id: string;
  severity: DiagnosticSeverity;
  area: DiagnosticArea;
  title: string;
  detail: string;
  suggestion: string;
  fixAction?: DiagnosticFixAction;
  evidence?: string[];
};

export type DiagnosticSectionStatus = {
  area: DiagnosticArea;
  status: 'healthy' | 'degraded' | 'critical' | 'unknown';
  summary: string;
};

export type DiagnosticSnapshot = {
  generatedAt: string;
  overallStatus: 'healthy' | 'degraded' | 'critical' | 'unknown';
  sections: DiagnosticSectionStatus[];
  issues: DiagnosticIssue[];
  metrics: {
    gateway: {
      state: string;
      port?: number;
      uptime?: number;
      lastError?: string;
    };
    logs: {
      errorCount: number;
      warnCount: number;
      sampledLines: number;
    };
    providers?: {
      enabled: number;
      missingCredentials: number;
      totalProviders: number;
    };
    channels?: {
      connected: number;
      error: number;
      connecting: number;
      disconnected: number;
    };
    security?: {
      proxyEnabled: boolean;
      proxyServer?: string;
      mcpServerCount: number;
      suspiciousMcpConfigs: number;
    };
  };
};

type GatewayStatusLike = {
  state?: string;
  port?: number;
  uptime?: number;
  error?: string;
};

type GatewayHealthLike = {
  ok: boolean;
  error?: string;
  uptime?: number;
};

type DiagnosticInput = {
  gatewayStatus: GatewayStatusLike;
  gatewayHealth: GatewayHealthLike;
  recentLogs: string[];
  generatedAt?: string;
  providerInfo?: { enabled: number; missingCredentials: number; total: number; httpBaseUrls: string[] };
  channelInfo?: { connected: number; error: number; connecting: number; disconnected: number };
  securityInfo?: { proxyEnabled: boolean; proxyServer?: string; mcpServerCount: number; suspiciousMcpConfigs: number };
};

type LogAnalysis = {
  errorCount: number;
  warnCount: number;
  errorEvidence: string[];
  warnEvidence: string[];
  credentialLeakEvidence: string[];
  patterns: {
    openRouterPricing: string[];
    transientWsClose: string[];
    bonjourConflict: string[];
    auth401: string[];
    auth403: string[];
  };
};

const MAX_EVIDENCE_LINES = 5;

export function redactDiagnosticEvidence(line: string): string {
  return line
    .replace(/(authorization:\s*bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|key)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/("(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|key)"\s*:\s*")[^"]+"/gi, '$1[redacted]"');
}

const CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|bearer)\s*[:=]\s*\S+/i,
  /(?:sk-|sk-.*-)[a-zA-Z0-9]{16,}/,
  /xai-[a-zA-Z0-9]{16,}/i,
];

function detectCredentialLeaks(recentLogs: string[]): string[] {
  const evidence: string[] = [];
  for (const line of recentLogs) {
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(line)) {
        evidence.push(redactDiagnosticEvidence(line));
        break;
      }
    }
  }
  return evidence.slice(-MAX_EVIDENCE_LINES);
}

function analyzeLogLines(recentLogs: string[]): LogAnalysis {
  let errorCount = 0;
  let warnCount = 0;
  const errorEvidence: string[] = [];
  const warnEvidence: string[] = [];
  const openRouterPricing: string[] = [];
  const transientWsClose: string[] = [];
  const bonjourConflict: string[] = [];
  const auth401: string[] = [];
  const auth403: string[] = [];
  const credentialLeakEvidence = detectCredentialLeaks(recentLogs);

  for (const line of recentLogs) {
    if (line.includes('] [ERROR')) {
      errorCount += 1;
      errorEvidence.push(line);

      const normalized = line.toLowerCase();
      if (normalized.includes('401') || normalized.includes('unauthorized')) {
        auth401.push(line);
      }
      if (normalized.includes('403') || normalized.includes('forbidden')) {
        auth403.push(line);
      }
    } else if (line.includes('] [WARN')) {
      warnCount += 1;
      warnEvidence.push(line);

      const normalized = line.toLowerCase();
      if (normalized.includes('[model-pricing]') && normalized.includes('openrouter pricing fetch failed')) {
        openRouterPricing.push(line);
      }
      if (
        normalized.includes('[ws]') &&
        normalized.includes('closed before connect') &&
        normalized.includes('code=1006')
      ) {
        transientWsClose.push(line);
      }
      if (
        normalized.includes('[bonjour]') &&
        (normalized.includes('name conflict') ||
          normalized.includes('hostname conflict') ||
          normalized.includes('non-announced service'))
      ) {
        bonjourConflict.push(line);
      }
    }
  }

  return {
    errorCount,
    warnCount,
    errorEvidence: errorEvidence.slice(-MAX_EVIDENCE_LINES).map(redactDiagnosticEvidence),
    warnEvidence: warnEvidence.slice(-MAX_EVIDENCE_LINES).map(redactDiagnosticEvidence),
    credentialLeakEvidence,
    patterns: {
      openRouterPricing: openRouterPricing.slice(-MAX_EVIDENCE_LINES).map(redactDiagnosticEvidence),
      transientWsClose: transientWsClose.slice(-MAX_EVIDENCE_LINES).map(redactDiagnosticEvidence),
      bonjourConflict: bonjourConflict.slice(-MAX_EVIDENCE_LINES).map(redactDiagnosticEvidence),
      auth401: auth401.slice(-MAX_EVIDENCE_LINES).map(redactDiagnosticEvidence),
      auth403: auth403.slice(-MAX_EVIDENCE_LINES).map(redactDiagnosticEvidence),
    },
  };
}

function deriveOverallStatus(
  sections: DiagnosticSectionStatus[]
): DiagnosticSnapshot['overallStatus'] {
  if (sections.some((section) => section.status === 'critical')) return 'critical';
  if (sections.some((section) => section.status === 'degraded')) return 'degraded';
  if (sections.every((section) => section.status === 'unknown')) return 'unknown';
  return 'healthy';
}

function isPublicUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/^https?:\/\/127\.0\.0\.1/i.test(trimmed)) return false;
  if (/^https?:\/\/localhost/i.test(trimmed)) return false;
  if (/^https?:\/\/\[::1\]/i.test(trimmed)) return false;
  if (/^https?:\/\/10\.\d+\.\d+\.\d+/i.test(trimmed)) return false;
  if (/^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/i.test(trimmed)) return false;
  if (/^https?:\/\/192\.168\.\d+\.\d+/i.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed);
}

export function buildDiagnosticSnapshot(input: DiagnosticInput): DiagnosticSnapshot {
  const issues: DiagnosticIssue[] = [];
  const logAnalysis = analyzeLogLines(input.recentLogs);
  const gatewayState = input.gatewayStatus.state ?? 'unknown';
  const gatewayLastError = input.gatewayStatus.error ?? input.gatewayHealth.error;

  // ── Gateway section ──────────────────────────────────────────────────
  let gatewaySection: DiagnosticSectionStatus;
  if (gatewayState !== 'running') {
    issues.push({
      id: 'gateway-not-running',
      severity: 'critical',
      area: 'gateway',
      title: 'Gateway is not running',
      detail: `Current Gateway state is "${gatewayState}".`,
      suggestion: 'Start or restart the Gateway, then run diagnostics again.',
      fixAction: 'restartGateway',
      evidence: gatewayLastError ? [gatewayLastError] : undefined,
    });
    gatewaySection = {
      area: 'gateway',
      status: 'critical',
      summary: `Gateway state is ${gatewayState}.`,
    };
  } else if (!input.gatewayHealth.ok) {
    issues.push({
      id: 'gateway-health-failed',
      severity: 'critical',
      area: 'gateway',
      title: 'Gateway health check failed',
      detail: input.gatewayHealth.error ?? 'Gateway returned an unhealthy response.',
      suggestion: 'Restart the Gateway or run OpenClaw Doctor Fix from Developer settings.',
      fixAction: 'runDoctorFix',
      evidence: input.gatewayHealth.error ? [input.gatewayHealth.error] : undefined,
    });
    gatewaySection = {
      area: 'gateway',
      status: 'critical',
      summary: input.gatewayHealth.error ?? 'Gateway health check failed.',
    };
  } else {
    gatewaySection = {
      area: 'gateway',
      status: 'healthy',
      summary: 'Gateway is running and health check passed.',
    };
  }

  // ── Provider section ─────────────────────────────────────────────────
  let providerSection: DiagnosticSectionStatus;
  const providerInfo = input.providerInfo;
  if (providerInfo) {
    if (providerInfo.missingCredentials > 0) {
      issues.push({
        id: 'provider-missing-credentials',
        severity: 'warning',
        area: 'provider',
        title: 'Provider credentials missing',
        detail: `${providerInfo.missingCredentials} of ${providerInfo.total} configured provider(s) are missing API keys or credentials.`,
        suggestion: 'Open provider settings and add API keys for the enabled providers.',
        fixAction: 'openProviderSettings',
      });
      providerSection = {
        area: 'provider',
        status: 'degraded',
        summary: `${providerInfo.missingCredentials} provider(s) missing credentials.`,
      };
    } else {
      providerSection = {
        area: 'provider',
        status: 'healthy',
        summary: `All ${providerInfo.total} provider(s) have credentials configured.`,
      };
    }

    // Security: check for HTTP (non-HTTPS) custom base URLs
    if (providerInfo.httpBaseUrls.length > 0) {
      issues.push({
        id: 'provider-http-base-url',
        severity: 'warning',
        area: 'security',
        title: 'Provider using HTTP base URL',
        detail: `${providerInfo.httpBaseUrls.length} provider(s) are configured with an HTTP (non-HTTPS) base URL: ${providerInfo.httpBaseUrls.slice(0, 3).join(', ')}.`,
        suggestion: 'Switch to HTTPS base URLs to prevent credential and data exposure.',
        fixAction: 'openProviderSettings',
        evidence: providerInfo.httpBaseUrls,
      });
    }

    // Check for auth errors in logs
    if (logAnalysis.patterns.auth401.length > 0 || logAnalysis.patterns.auth403.length > 0) {
      const authCount = logAnalysis.patterns.auth401.length + logAnalysis.patterns.auth403.length;
      issues.push({
        id: 'provider-auth-errors',
        severity: 'warning',
        area: 'provider',
        title: 'Provider authentication errors detected',
        detail: `${authCount} authentication error(s) (401/403) found in recent logs.`,
        suggestion: 'Check API keys in provider settings. Keys may have expired or been revoked.',
        fixAction: 'openProviderSettings',
        evidence: [...logAnalysis.patterns.auth401, ...logAnalysis.patterns.auth403],
      });
    }
  } else {
    providerSection = {
      area: 'provider',
      status: 'unknown',
      summary: 'Provider status not available.',
    };
  }

  // ── Channel section ──────────────────────────────────────────────────
  let channelSection: DiagnosticSectionStatus;
  const channelInfo = input.channelInfo;
  if (channelInfo) {
    if (channelInfo.error > 0) {
      issues.push({
        id: 'channel-errors',
        severity: 'warning',
        area: 'channel',
        title: 'Channel connection errors',
        detail: `${channelInfo.error} channel(s) are in error state.`,
        suggestion: 'Open channel settings to review error details and reconnect.',
        fixAction: 'openChannelSettings',
      });
      channelSection = {
        area: 'channel',
        status: 'degraded',
        summary: `${channelInfo.error} channel(s) with errors.`,
      };
    } else if (channelInfo.connecting > 0) {
      issues.push({
        id: 'channel-connecting',
        severity: 'info',
        area: 'channel',
        title: 'Channels still connecting',
        detail: `${channelInfo.connecting} channel(s) are still establishing a connection.`,
        suggestion: 'If channels remain stuck in connecting state, check network or restart the Gateway.',
        fixAction: 'openChannelSettings',
      });
      channelSection = {
        area: 'channel',
        status: 'degraded',
        summary: `${channelInfo.connecting} channel(s) connecting.`,
      };
    } else if (channelInfo.connected > 0) {
      channelSection = {
        area: 'channel',
        status: 'healthy',
        summary: `${channelInfo.connected} channel(s) connected.`,
      };
    } else {
      channelSection = {
        area: 'channel',
        status: 'unknown',
        summary: 'No channels configured or status unavailable.',
      };
    }
  } else {
    channelSection = {
      area: 'channel',
      status: 'unknown',
      summary: 'Channel status not available.',
    };
  }

  // ── Security section ─────────────────────────────────────────────────
  let securitySection: DiagnosticSectionStatus;
  const securityInfo = input.securityInfo;
  if (securityInfo) {
    if (securityInfo.proxyEnabled && securityInfo.proxyServer) {
      if (isPublicUrl(securityInfo.proxyServer)) {
        issues.push({
          id: 'proxy-public-server',
          severity: 'info',
          area: 'security',
          title: 'Proxy points to a public address',
          detail: `Proxy is enabled and points to ${securityInfo.proxyServer}.`,
          suggestion: 'Verify that this proxy is a trusted service before sending sensitive traffic through it.',
          fixAction: 'openProxySettings',
          evidence: [securityInfo.proxyServer],
        });
      }
    }

    if (securityInfo.suspiciousMcpConfigs > 0) {
      issues.push({
        id: 'mcp-suspicious-config',
        severity: 'warning',
        area: 'security',
        title: 'Suspicious MCP server configuration detected',
        detail: `${securityInfo.suspiciousMcpConfigs} MCP server(s) have configurations that warrant review (public URLs, unknown commands, or sensitive directories).`,
        suggestion: 'Review MCP server configurations for safety.',
        fixAction: 'openMcpSettings',
      });
      securitySection = {
        area: 'security',
        status: 'degraded',
        summary: `${securityInfo.suspiciousMcpConfigs} MCP config(s) warrant review.`,
      };
    } else if (logAnalysis.credentialLeakEvidence.length > 0) {
      issues.push({
        id: 'credential-leak-in-logs',
        severity: 'warning',
        area: 'security',
        title: 'Credentials detected in logs',
        detail: 'Log output may contain API keys, tokens, or other credentials.',
        suggestion: 'The diagnostics panel and exported reports auto-redact these values, but you should rotate any leaked keys.',
        fixAction: 'openLogs',
        evidence: logAnalysis.credentialLeakEvidence,
      });
      securitySection = {
        area: 'security',
        status: 'degraded',
        summary: 'Potential credential exposure in logs.',
      };
    } else {
      securitySection = {
        area: 'security',
        status: 'healthy',
        summary: 'No security concerns detected.',
      };
    }
  } else {
    securitySection = {
      area: 'security',
      status: 'unknown',
      summary: 'Security status not available.',
    };
  }

  // ── MCP section ──────────────────────────────────────────────────────
  let mcpSection: DiagnosticSectionStatus;
  if (securityInfo) {
    if (securityInfo.mcpServerCount === 0) {
      mcpSection = {
        area: 'mcp',
        status: 'healthy',
        summary: 'No MCP servers configured.',
      };
    } else {
      mcpSection = {
        area: 'mcp',
        status: 'healthy',
        summary: `${securityInfo.mcpServerCount} MCP server(s) configured.`,
      };
    }
  } else {
    mcpSection = {
      area: 'mcp',
      status: 'unknown',
      summary: 'MCP status not available.',
    };
  }

  // ── Logs/app section ──────────────────────────────────────────────────
  let logsSection: DiagnosticSectionStatus;
  if (logAnalysis.errorCount > 0) {
    issues.push({
      id: 'recent-error-logs',
      severity: 'warning',
      area: 'app',
      title: 'Recent error logs detected',
      detail: `${logAnalysis.errorCount} error log line(s) were found in the recent log buffer.`,
      suggestion: 'Open logs and inspect the latest errors if the app is behaving unexpectedly.',
      fixAction: 'openLogs',
      evidence: logAnalysis.errorEvidence,
    });
    logsSection = {
      area: 'app',
      status: 'degraded',
      summary: `${logAnalysis.errorCount} error log line(s) found.`,
    };
  } else if (logAnalysis.warnCount > 0) {
    const classifiedWarningCount =
      logAnalysis.patterns.bonjourConflict.length +
      logAnalysis.patterns.openRouterPricing.length +
      logAnalysis.patterns.transientWsClose.length;

    if (logAnalysis.patterns.bonjourConflict.length > 0) {
      issues.push({
        id: 'bonjour-service-conflict',
        severity: 'info',
        area: 'network',
        title: 'Bonjour service name conflict',
        detail:
          'OpenClaw Gateway detected a local service discovery name or hostname conflict and automatically picked a new name.',
        suggestion:
          'If chat and the control console work normally, this is safe to ignore. If it repeats frequently, check for multiple BoostClaw/OpenClaw instances or restart the Gateway.',
        fixAction: 'restartGateway',
        evidence: logAnalysis.patterns.bonjourConflict,
      });
    }

    if (logAnalysis.patterns.openRouterPricing.length > 0) {
      issues.push({
        id: 'openrouter-pricing-unavailable',
        severity: 'info',
        area: 'network',
        title: 'OpenRouter pricing unavailable',
        detail: 'Gateway could not fetch OpenRouter pricing metadata.',
        suggestion:
          'This usually only affects cost display. Check network/proxy settings if model pricing is required.',
        fixAction: 'openLogs',
        evidence: logAnalysis.patterns.openRouterPricing,
      });
    }

    if (logAnalysis.patterns.transientWsClose.length > 0) {
      issues.push({
        id: 'transient-websocket-close',
        severity: 'info',
        area: 'gateway',
        title: 'Transient WebSocket disconnects',
        detail: 'One or more WebSocket probes closed before the connection completed.',
        suggestion:
          'Occasional entries are normal during refresh or reconnect. Investigate only if this grows continuously or chat streaming is unstable.',
        fixAction: 'openLogs',
        evidence: logAnalysis.patterns.transientWsClose,
      });
    }

    if (classifiedWarningCount < logAnalysis.warnCount) {
      issues.push({
        id: 'recent-warning-logs',
        severity: 'info',
        area: 'app',
        title: 'Other recent warning logs detected',
        detail: `${logAnalysis.warnCount - classifiedWarningCount} unclassified warning log line(s) were found in the recent log buffer.`,
        suggestion: 'Review the warning logs if related functionality is degraded.',
        fixAction: 'openLogs',
        evidence: logAnalysis.warnEvidence,
      });
    }

    logsSection = {
      area: 'app',
      status: 'degraded',
      summary: `${logAnalysis.warnCount} warning log line(s) found.`,
    };
  } else {
    logsSection = {
      area: 'app',
      status: 'healthy',
      summary: 'No recent warning or error logs found.',
    };
  }

  const sections = [gatewaySection, logsSection, providerSection, channelSection, securitySection, mcpSection];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    overallStatus: deriveOverallStatus(sections),
    sections,
    issues,
    metrics: {
      gateway: {
        state: gatewayState,
        port: input.gatewayStatus.port,
        uptime: input.gatewayStatus.uptime ?? input.gatewayHealth.uptime,
        lastError: gatewayLastError,
      },
      logs: {
        errorCount: logAnalysis.errorCount,
        warnCount: logAnalysis.warnCount,
        sampledLines: input.recentLogs.length,
      },
      providers: input.providerInfo
        ? {
            enabled: input.providerInfo.enabled,
            missingCredentials: input.providerInfo.missingCredentials,
            totalProviders: input.providerInfo.total,
          }
        : undefined,
      channels: input.channelInfo ?? undefined,
      security: input.securityInfo
        ? {
            proxyEnabled: input.securityInfo.proxyEnabled,
            proxyServer: input.securityInfo.proxyServer,
            mcpServerCount: input.securityInfo.mcpServerCount,
            suspiciousMcpConfigs: input.securityInfo.suspiciousMcpConfigs,
          }
        : undefined,
    },
  };
}

export function getDiagnosticSnapshot(ctx: HostApiContext): Promise<DiagnosticSnapshot> {
  return buildSnapshotWithContext(ctx, 3000);
}

export function runFullDiagnostics(ctx: HostApiContext): Promise<DiagnosticSnapshot> {
  return buildSnapshotWithContext(ctx, 5000);
}

async function buildSnapshotWithContext(
  ctx: HostApiContext,
  channelRpcTimeout: number,
): Promise<DiagnosticSnapshot> {
  const gatewayStatus = ctx.gatewayManager.getStatus() as GatewayStatusLike;
  let gatewayHealth: GatewayHealthLike;

  try {
    gatewayHealth = await ctx.gatewayManager.checkHealth();
  } catch (error) {
    gatewayHealth = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let providerInfo: DiagnosticInput['providerInfo'] | undefined;
  try {
    const providers = await getAllProvidersWithKeyInfo();
    const enabled = providers.filter((p) => p.enabled);
    const missingCredentials = enabled.filter((p) => !p.hasKey).length;
    const httpBaseUrls = enabled
      .filter((p) => p.baseUrl && /^http:\/\//i.test(p.baseUrl))
      .map((p) => `${p.name}: ${p.baseUrl}`);
    providerInfo = {
      enabled: enabled.length,
      missingCredentials,
      total: providers.length,
      httpBaseUrls,
    };
  } catch {
    // provider info is optional
  }

  let channelInfo: DiagnosticInput['channelInfo'] | undefined;
  try {
    const gatewayStatusPayload = await ctx.gatewayManager.rpc<GatewayChannelStatusPayload>(
      'channels.status',
      { probe: false },
      channelRpcTimeout,
    );
    if (gatewayStatusPayload?.channelAccounts) {
      let connected = 0;
      let error = 0;
      let connecting = 0;
      let disconnected = 0;
      for (const accounts of Object.values(gatewayStatusPayload.channelAccounts)) {
        if (!Array.isArray(accounts)) continue;
        for (const account of accounts) {
          if (account.connected === true || account.linked === true) {
            connected += 1;
          } else if (account.lastError) {
            error += 1;
          } else if (account.running === true) {
            connecting += 1;
          } else {
            disconnected += 1;
          }
        }
      }
      channelInfo = { connected, error, connecting, disconnected };
    }
  } catch {
    // channel info is optional
  }

  let securityInfo: DiagnosticInput['securityInfo'] | undefined;
  try {
    const [settings, openClawConfig] = await Promise.all([
      getAllSettings(),
      readOpenClawConfig(),
    ]);
    const resolvedProxy = resolveProxySettings(settings);
    const proxyServer = resolvedProxy.allProxy || resolvedProxy.httpsProxy || resolvedProxy.httpProxy || undefined;

    const mcpSection = openClawConfig.mcp as Record<string, unknown> | undefined;
    const mcpServers = mcpSection?.servers as Record<string, Record<string, unknown>> | undefined;
    const mcpServerCount = mcpServers ? Object.keys(mcpServers).length : 0;

    let suspiciousMcpConfigs = 0;
    if (mcpServers) {
      for (const entry of Object.values(mcpServers)) {
        const url = typeof entry.url === 'string' ? entry.url : '';
        if (url && /^https?:\/\//i.test(url) && isPublicUrl(url)) {
          suspiciousMcpConfigs += 1;
        }
        const command = typeof entry.command === 'string' ? entry.command : '';
        if (
          command &&
          (command.includes('/etc/') ||
            command.includes('/var/') ||
            command.includes('/bin/sh') ||
            command.includes('/bin/bash'))
        ) {
          suspiciousMcpConfigs += 1;
        }
      }
    }

    securityInfo = {
      proxyEnabled: settings.proxyEnabled,
      proxyServer,
      mcpServerCount,
      suspiciousMcpConfigs,
    };
  } catch {
    // security info is optional
  }

  return buildDiagnosticSnapshot({
    gatewayStatus,
    gatewayHealth,
    recentLogs: logger.getRecentLogs(200),
    providerInfo,
    channelInfo,
    securityInfo,
  });
}

export interface DiagnosticLogsParams {
  tailLines?: number;
  level?: string;
  query?: string;
  redact?: boolean;
  minLevel?: number;
}

export function getDiagnosticLogs(options: DiagnosticLogsParams): string[] {
  const tailLines = Math.max(1, Math.min(options.tailLines ?? 100, 1000));
  const minLevel = options.minLevel ?? 0;
  let lines = logger.getRecentLogs(tailLines, minLevel);

  if (options.query) {
    const lowerQuery = options.query.toLowerCase();
    lines = lines.filter((line) => line.toLowerCase().includes(lowerQuery));
  }

  if (options.level && options.level !== 'all') {
    const levelMap: Record<string, string> = {
      debug: '[DEBUG',
      info: '[INFO',
      warn: '[WARN',
      warning: '[WARN',
      error: '[ERROR',
    };
    const needle = levelMap[options.level.toLowerCase()];
    if (needle) {
      lines = lines.filter((line) => line.includes(needle));
    }
  }

  if (options.redact !== false) {
    lines = lines.map(redactDiagnosticEvidence);
  }

  return lines;
}

export interface DiagnosticExportReport {
  generatedAt: string;
  snapshot: DiagnosticSnapshot;
  logs: {
    errorCount: number;
    warnCount: number;
    sample: string[];
  };
  system: {
    appVersion?: string;
    platform?: string;
    arch?: string;
  };
}

export async function buildExportReport(
  ctx: HostApiContext,
  systemInfo?: { appVersion?: string; platform?: string; arch?: string },
): Promise<DiagnosticExportReport> {
  const snapshot = await runFullDiagnostics(ctx);
  const logSample = logger.getRecentLogs(100).map(redactDiagnosticEvidence);
  const errorCount = logSample.filter((l) => l.includes('] [ERROR')).length;
  const warnCount = logSample.filter((l) => l.includes('] [WARN')).length;

  return {
    generatedAt: new Date().toISOString(),
    snapshot,
    logs: {
      errorCount,
      warnCount,
      sample: logSample,
    },
    system: {
      appVersion: systemInfo?.appVersion,
      platform: systemInfo?.platform,
      arch: systemInfo?.arch,
    },
  };
}
