/**
 * Diagnostics Page
 * Standalone health dashboard for local Gateway, log, and security diagnostics.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  RefreshCw,
  Search,
  Shield,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { toUserMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

type DiagnosticSnapshot = {
  generatedAt: string;
  overallStatus: 'healthy' | 'degraded' | 'critical' | 'unknown';
  sections: Array<{
    area: string;
    status: 'healthy' | 'degraded' | 'critical' | 'unknown';
    summary: string;
  }>;
  issues: Array<{
    id: string;
    severity: 'info' | 'warning' | 'critical';
    area: string;
    title: string;
    detail: string;
    suggestion: string;
    fixAction?: string;
    evidence?: string[];
  }>;
  metrics: {
    gateway: { state: string; port?: number; uptime?: number; lastError?: string };
    logs: { errorCount: number; warnCount: number; sampledLines: number };
    providers?: { enabled: number; missingCredentials: number; totalProviders: number };
    channels?: { connected: number; error: number; connecting: number; disconnected: number };
    security?: { proxyEnabled: boolean; proxyServer?: string; mcpServerCount: number; suspiciousMcpConfigs: number };
  };
};

const DESTRUCTIVE_FIX_ACTIONS = ['restartGateway', 'runDoctorFix'];

export default function Diagnostics() {
  const { t } = useTranslation('diagnostics');
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixConfirmAction, setFixConfirmAction] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<{ action: string; ok: boolean; detail?: string; error?: string } | null>(null);

  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logLevel, setLogLevel] = useState('all');
  const [logQuery, setLogQuery] = useState('');
  const [logRedact, setLogRedact] = useState(true);
  const [logLoading, setLogLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const logLevelRef = useRef(logLevel);
  const logQueryRef = useRef(logQuery);
  const logRedactRef = useRef(logRedact);
  useEffect(() => { logLevelRef.current = logLevel; }, [logLevel]);
  useEffect(() => { logQueryRef.current = logQuery; }, [logQuery]);
  useEffect(() => { logRedactRef.current = logRedact; }, [logRedact]);

  const refreshDiagnostics = async (options?: { silent?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await hostApiFetch<DiagnosticSnapshot>('/api/diagnostics/snapshot');
      setSnapshot(result);
      if (!options?.silent) {
        toast.success(t('refreshed'));
      }
    } catch (err) {
      const msg = toUserMessage(err) || t('failed');
      setError(msg);
      if (!options?.silent) {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFix = async (action: string) => {
    setFixConfirmAction(null);
    setFixResult(null);
    setLoading(true);
    try {
      const result = await hostApiFetch<{ ok: boolean; detail?: string; error?: string }>(
        '/api/diagnostics/fix',
        { method: 'POST', body: JSON.stringify({ action }) }
      );
      setFixResult({ action, ok: result.ok, detail: result.detail, error: result.error });
      if (result.ok) {
        toast.success(result.detail ?? t('fixApplied'));
      } else {
        toast.error(result.error ?? t('fixFailed'));
      }
      await refreshDiagnostics({ silent: true });
    } catch (err) {
      const msg = toUserMessage(err) || t('fixFailed');
      setFixResult({ action, ok: false, error: msg });
      toast.error(msg);
      await refreshDiagnostics({ silent: true });
    } finally {
      setLoading(false);
    }
  };

  const NAVIGATION_ACTIONS: Record<string, string> = {
    openLogs: '#logs',
    openProviderSettings: '/settings',
    openChannelSettings: '/channels',
    openProxySettings: '/settings',
    openMcpSettings: '/mcp',
  };

  const handleFixClick = (action: string) => {
    if (NAVIGATION_ACTIONS[action]) {
      const target = NAVIGATION_ACTIONS[action];
      if (target.startsWith('#')) {
        setShowLogs(true);
        if (logLines.length === 0) void fetchLogs();
        setTimeout(() => {
          document.getElementById('diagnostics-logs')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        navigate(target);
      }
      return;
    }
    if (DESTRUCTIVE_FIX_ACTIONS.includes(action)) {
      setFixConfirmAction(action);
      return;
    }
    void handleFix(action);
  };

  const fetchLogs = async () => {
    setLogLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('tailLines', '200');
      if (logLevelRef.current !== 'all') params.set('level', logLevelRef.current);
      if (logQueryRef.current.trim()) params.set('query', logQueryRef.current.trim());
      params.set('redact', logRedactRef.current ? 'true' : 'false');
      const result = await hostApiFetch<{ lines: string[]; count: number; filtered: boolean }>(
        `/api/diagnostics/logs?${params.toString()}`
      );
      setLogLines(result.lines);
    } catch (err) {
      toast.error(toUserMessage(err) || t('logsFailed'));
    } finally {
      setLogLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const report = await hostApiFetch<Record<string, unknown>>('/api/diagnostics/export');
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `boostclaw-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('exported'));
    } catch (err) {
      toast.error(toUserMessage(err) || t('exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const copyLogs = async () => {
    if (logLines.length === 0) return;
    try {
      await navigator.clipboard.writeText(logLines.join('\n'));
      toast.success(t('logsCopied'));
    } catch {
      toast.error(t('logsCopyFailed'));
    }
  };

  useEffect(() => {
    void refreshDiagnostics({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusClass = !snapshot
    ? 'text-muted-foreground border-muted-foreground/20'
    : snapshot.overallStatus === 'healthy'
      ? 'text-green-600 dark:text-green-500 border-green-500/20'
      : snapshot.overallStatus === 'critical'
        ? 'text-red-600 dark:text-red-400 border-red-500/20'
        : 'text-amber-600 dark:text-amber-400 border-amber-500/20';

  const sectionIcon = (area: string) => {
    switch (area) {
      case 'gateway': return <Wifi className="h-4 w-4" />;
      case 'security': return <Shield className="h-4 w-4" />;
      case 'app': return <FileText className="h-4 w-4" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-semibold text-foreground tracking-tight">
              {t('title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">{t('desc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshDiagnostics()}
              disabled={loading}
              className="rounded-full h-9 px-4"
              data-testid="diagnostics-refresh"
            >
              <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
              {t('runDiagnostics')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={exporting}
              className="rounded-full h-9 px-4"
              data-testid="diagnostics-export"
            >
              <Download className={cn('h-4 w-4 mr-2', exporting && 'animate-spin')} />
              {t('export')}
            </Button>
          </div>
        </div>

        {/* Fix result banner */}
        {fixResult && (
          <div
            className={cn(
              'rounded-xl border px-4 py-3 text-sm',
              fixResult.ok
                ? 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-500'
                : 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400'
            )}
            data-testid="diagnostics-fix-result"
          >
            <span className="font-medium">{t(`fixAction.${fixResult.action}` as any)}</span>
            {': '}
            {fixResult.ok ? fixResult.detail : fixResult.error}
            {snapshot && (
              <span className="ml-2">
                {snapshot.issues.length === 0
                  ? t('fixAllResolved')
                  : t('fixRemainingIssues', { count: snapshot.issues.length })}
              </span>
            )}
          </div>
        )}

        {/* Overall status card */}
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-card p-6">
          <div className="flex items-center gap-3">
          <div className={cn('rounded-full p-2.5 border', statusClass)}>
            {!snapshot ? <Activity className="h-6 w-6" /> :
             snapshot.overallStatus === 'healthy' ? <CheckCircle2 className="h-6 w-6" /> :
             snapshot.overallStatus === 'critical' ? <AlertTriangle className="h-6 w-6" /> :
             <Activity className="h-6 w-6" />}
          </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('overallStatus')}</p>
              <p className="text-lg font-semibold text-foreground">
                {snapshot ? t(`status.${snapshot.overallStatus}`) : t('status.unknown')}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {snapshot ? t(`statusDesc.${snapshot.overallStatus}`) : t('statusDesc.unknown')}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-muted-foreground">{t('lastChecked')}</p>
              <p className="text-sm text-foreground">
                {snapshot
                  ? new Date(snapshot.generatedAt).toLocaleTimeString()
                  : t('notRun')}
              </p>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
            data-testid="diagnostics-error">
            {error}
          </div>
        )}

        {/* Section status grid */}
        {snapshot && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {snapshot.sections.map((section) => (
              <div
                key={section.area}
                className={cn(
                  'rounded-xl border px-4 py-3',
                  section.status === 'healthy' && 'border-green-500/20 bg-green-500/5',
                  section.status === 'degraded' && 'border-amber-500/20 bg-amber-500/5',
                  section.status === 'critical' && 'border-red-500/20 bg-red-500/5',
                  section.status === 'unknown' && 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5',
                )}
                data-testid={`diagnostics-section-${section.area}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {sectionIcon(section.area)}
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    {t(`section.${section.area}`)}
                  </p>
                </div>
                <p className="text-[13px] text-foreground/80">{section.summary}</p>
              </div>
            ))}
          </div>
        )}

        <Separator className="bg-black/5 dark:bg-white/5" />

        {/* Metrics */}
        {snapshot && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label={t('gateway')}
              value={snapshot.metrics.gateway.state}
              sub={`Port: ${snapshot.metrics.gateway.port ?? '-'}`}
            />
            <MetricCard
              label={t('errors')}
              value={String(snapshot.metrics.logs.errorCount)}
              sub={t('sampledLines', { count: snapshot.metrics.logs.sampledLines })}
            />
            <MetricCard
              label={t('warnings')}
              value={String(snapshot.metrics.logs.warnCount)}
              sub={t('checkedAt', { time: new Date(snapshot.generatedAt).toLocaleTimeString() })}
            />
            {snapshot.metrics.providers && (
              <MetricCard
                label={t('provider.total')}
                value={String(snapshot.metrics.providers.enabled)}
                sub={`${snapshot.metrics.providers.missingCredentials} ${t('provider.missingCredentials').toLowerCase()}`}
              />
            )}
          </div>
        )}

        <Separator className="bg-black/5 dark:bg-white/5" />

        {/* Issues */}
        {snapshot && (
          <div data-testid="diagnostics-issues">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">{t('issues')}</h2>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {snapshot.issues.length}
              </Badge>
            </div>
            {snapshot.issues.length === 0 ? (
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-500">
                {t('noIssues')}
              </div>
            ) : (
              <div className="space-y-3">
                {snapshot.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-card px-4 py-4"
                    data-testid="diagnostics-issue"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge
                        variant={
                          issue.severity === 'critical'
                            ? 'destructive'
                            : issue.severity === 'warning'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="rounded-full px-2.5 py-0.5"
                      >
                        {t(`severity.${issue.severity}`)}
                      </Badge>
                      <p className="text-[13px] font-semibold text-foreground">{issue.title}</p>
                    </div>
                    <p className="text-[12px] text-muted-foreground">{issue.detail}</p>
                    <p className="mt-1 text-[12px] text-foreground/80">{issue.suggestion}</p>
                    {issue.evidence && issue.evidence.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-[11px] font-medium uppercase text-muted-foreground">{t('evidence')}</p>
                        <pre className="max-h-36 overflow-auto rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-words">
                          {issue.evidence.join('\n')}
                        </pre>
                      </div>
                    )}
                    {issue.fixAction && (
                      <div className="mt-3">
                        <Button
                          type="button"
                          variant={issue.severity === 'critical' ? 'destructive' : 'outline'}
                          size="sm"
                          onClick={() => handleFixClick(issue.fixAction!)}
                          disabled={loading}
                          className="rounded-full h-7 px-3 text-[12px]"
                          data-testid={`diagnostics-fix-${issue.fixAction}`}
                        >
                          {t(`fixAction.${issue.fixAction}`)}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Separator className="bg-black/5 dark:bg-white/5" />

        {/* Log viewer */}
        <div id="diagnostics-logs">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <button
              type="button"
              onClick={() => {
                const next = !showLogs;
                setShowLogs(next);
                if (next && logLines.length === 0) void fetchLogs();
              }}
              className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground/70"
              data-testid="diagnostics-logs-toggle"
            >
              <FileText className="h-4 w-4" />
              {t('logs')}
              <span className="text-[11px] text-muted-foreground">{showLogs ? '▲' : '▼'}</span>
            </button>
            {showLogs && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyLogs()}
                disabled={logLines.length === 0}
                className="h-7 text-[12px] rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                data-testid="diagnostics-logs-copy"
              >
                <Copy className="h-3 w-3 mr-1" />
                {t('logsCopy')}
              </Button>
            )}
          </div>
          {showLogs && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'debug', 'info', 'warn', 'error'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => { setLogLevel(level); void fetchLogs(); }}
                    className={cn(
                      'rounded-full px-3 py-1 text-[11px] font-medium border transition-colors',
                      logLevel === level
                        ? 'bg-foreground text-background border-foreground'
                        : 'border-black/10 dark:border-white/10 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                    data-testid={`diagnostics-logs-level-${level}`}
                  >
                    {level === 'all' ? t('logsLevelAll') : level.toUpperCase()}
                  </button>
                ))}
                <div className="flex-1 min-w-[140px]">
                  <Input
                    placeholder={t('logsSearch')}
                    value={logQuery}
                    onChange={(e) => setLogQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void fetchLogs(); }}
                    className="h-7 text-[12px] rounded-lg px-2.5"
                    data-testid="diagnostics-logs-search"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setLogRedact((p) => !p); void fetchLogs(); }}
                  className={cn(
                    'rounded-full px-3 py-1 text-[11px] font-medium border transition-colors',
                    logRedact
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                      : 'border-black/10 dark:border-white/10 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                  data-testid="diagnostics-logs-redact"
                >
                  {t('logsRedact')}
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchLogs()}
                  disabled={logLoading}
                  className="rounded-full h-7 px-3 text-[12px] border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                  data-testid="diagnostics-logs-refresh"
                >
                  <Search className={cn('h-3 w-3 mr-1', logLoading && 'animate-spin')} />
                </Button>
              </div>
              <pre
                className="text-[11px] text-muted-foreground bg-black/5 dark:bg-white/5 p-3 rounded-xl max-h-80 overflow-auto whitespace-pre-wrap font-mono border border-black/5 dark:border-white/5"
                data-testid="diagnostics-logs-output"
              >
                {logLoading ? 'Loading...' : logLines.length > 0 ? logLines.join('\n') : t('logsEmpty')}
              </pre>
            </div>
          )}
        </div>

        {/* Fix confirmation dialog */}
        <ConfirmDialog
          open={!!fixConfirmAction}
          title={t('fixConfirmTitle')}
          message={
            fixConfirmAction === 'restartGateway'
              ? t('fixConfirmRestartGateway')
              : t('fixConfirmRunDoctorFix')
          }
          confirmLabel={t(`fixAction.${fixConfirmAction ?? 'restartGateway'}` as any)}
          cancelLabel="Cancel"
          variant={fixConfirmAction === 'restartGateway' ? 'destructive' : 'default'}
          onConfirm={() => { if (fixConfirmAction) void handleFix(fixConfirmAction); }}
          onCancel={() => setFixConfirmAction(null)}
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="space-y-1 rounded-xl bg-black/5 dark:bg-white/5 px-4 py-3">
      <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="text-[18px] font-semibold text-foreground">{value}</p>
      <p className="text-[12px] text-muted-foreground">{sub}</p>
    </div>
  );
}
