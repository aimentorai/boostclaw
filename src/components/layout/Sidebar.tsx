/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  MessageCircle,
  Monitor,
  Sparkles,
  Wrench,
  Clock,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Trash2,
  Box,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  hideLabel?: boolean;
  onClick?: () => void;
  testId?: string;
}

function NavItem({ to, icon, label, badge, collapsed, hideLabel, onClick, testId }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      data-testid={testId}
      aria-label={hideLabel ? label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition-all duration-200',
          'text-[hsl(var(--sidebar-text))] hover:bg-[hsl(var(--sidebar-text))]/14',
          isActive
            ? 'bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-text))] shadow-[0_4px_14px_rgba(0,0,0,0.10)]'
            : '',
          collapsed && 'px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div
            className={cn(
              'flex shrink-0 items-center justify-center transition-colors',
              isActive
                ? 'text-[hsl(var(--sidebar-active-text))]'
                : 'text-[hsl(var(--sidebar-text))] group-hover:text-[hsl(var(--sidebar-text))]'
            )}
          >
            {icon}
          </div>
          {!collapsed && !hideLabel && label && (
            <>
              <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-center leading-none">
                {label}
              </span>
              {badge && (
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full border border-[hsl(var(--sidebar-history-badge-border))] bg-[hsl(var(--sidebar-history-badge-bg))] text-[11px] text-[hsl(var(--sidebar-history-badge-text))]"
                >
                  {badge}
                </Badge>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfYesterday) return 'yesterday';

  const daysAgo = (startOfToday - activityMs) / (24 * 60 * 60 * 1000);
  if (daysAgo <= 7) return 'withinWeek';
  if (daysAgo <= 14) return 'withinTwoWeeks';
  if (daysAgo <= 30) return 'withinMonth';
  return 'older';
}

const INITIAL_NOW_MS = Date.now();

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const navigate = useNavigate();
  const isOnChat = useLocation().pathname === '/';

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    sessionLabels[key] ?? label ?? displayName ?? key;

  const { t } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(
    null
  );
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents]
  );
  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> =
    [
      { key: 'today', label: t('chat:historyBuckets.today'), sessions: [] },
      { key: 'yesterday', label: t('chat:historyBuckets.yesterday'), sessions: [] },
      { key: 'withinWeek', label: t('chat:historyBuckets.withinWeek'), sessions: [] },
      { key: 'withinTwoWeeks', label: t('chat:historyBuckets.withinTwoWeeks'), sessions: [] },
      { key: 'withinMonth', label: t('chat:historyBuckets.withinMonth'), sessions: [] },
      { key: 'older', label: t('chat:historyBuckets.older'), sessions: [] },
    ];
  const sessionBucketMap = Object.fromEntries(
    sessionBuckets.map((bucket) => [bucket.key, bucket])
  ) as Record<SessionBucketKey, (typeof sessionBuckets)[number]>;

  for (const session of [...sessions].sort(
    (a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
  )) {
    const bucketKey = getSessionBucket(sessionLastActivity[session.key] ?? 0, nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const topNavItems = [
    {
      to: '/',
      icon: <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} />,
      label: t('common:sidebar.chat'),
      testId: 'sidebar-nav-chat',
    },
    {
      to: '/experts',
      icon: <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.8} />,
      label: t('common:sidebar.experts'),
      testId: 'sidebar-nav-experts',
    },
    {
      to: '/skills',
      icon: <Wrench className="h-[18px] w-[18px]" strokeWidth={1.8} />,
      label: t('sidebar.skills'),
      testId: 'sidebar-nav-skills',
    },
    {
      to: '/cron',
      icon: <Clock className="h-[18px] w-[18px]" strokeWidth={1.8} />,
      label: t('sidebar.cronTasks'),
      testId: 'sidebar-nav-cron',
    },
  ];
  const bottomNavItems = [
    {
      to: '/models',
      icon: <Box className="h-[18px] w-[18px]" strokeWidth={1.8} />,
      label: t('sidebar.models'),
      testId: 'sidebar-nav-models',
    },
    {
      to: '/channels',
      icon: <Monitor className="h-[18px] w-[18px]" strokeWidth={1.8} />,
      label: t('sidebar.channels'),
      testId: 'sidebar-nav-channels',
    },
  ];

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'flex min-h-0 shrink-0 overflow-hidden border-r border-border bg-[hsl(var(--sidebar-bg))] transition-all duration-300',
        sidebarCollapsed || !isOnChat ? 'w-[72px]' : 'w-[286px]'
      )}
    >
      <div className="flex min-h-0 flex-1">
        {/* Left icon rail */}
        <div
          className={cn(
            'flex min-h-0 shrink-0 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-bg))]',
            sidebarCollapsed ? 'w-[72px]' : 'w-[76px]'
          )}
        >
          <div className="flex h-[72px] flex-col items-center justify-center gap-1 border-b border-[hsl(var(--sidebar-border))]">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--sidebar-text))]/25 bg-[hsl(var(--sidebar-active-bg))] shadow-sm">
              <img src={logoSvg} alt="BoostClaw" className="h-4.5 w-auto shrink-0" />
            </div>
            <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-bold leading-none text-[hsl(var(--sidebar-text))]">
              BoostClaw
            </span>
          </div>

          <nav className="flex flex-1 flex-col gap-3 px-2 py-2">
            {topNavItems.map((item) => (
              <NavItem key={item.to} {...item} collapsed={false} />
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-4 border-t border-[hsl(var(--sidebar-border))] px-2 py-4">
            {bottomNavItems.map((item) => (
              <NavItem key={item.to} {...item} collapsed={false} hideLabel />
            ))}
            <NavLink
              to="/settings"
              data-testid="sidebar-nav-settings"
              aria-label={t('common:sidebar.settings')}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition-all',
                  'text-[hsl(var(--sidebar-text))] hover:bg-[hsl(var(--sidebar-text))]/14',
                  isActive &&
                    'bg-[hsl(var(--sidebar-active-bg))] text-[hsl(var(--sidebar-active-text))] shadow-[0_4px_14px_rgba(0,0,0,0.10)]'
                )
              }
            >
              <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />
            </NavLink>
            {sidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="mx-auto h-8 w-8 rounded-lg text-[hsl(var(--sidebar-text))] hover:bg-[hsl(var(--sidebar-text))]/14"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeft className="h-[16px] w-[16px]" />
              </Button>
            )}
          </div>
        </div>

        {/* Right history pane */}
        {!sidebarCollapsed && isOnChat && (
          <div className="flex min-h-0 w-[210px] min-w-0 shrink-0 flex-col bg-[hsl(var(--sidebar-history-bg))]">
            <div className="px-2.5 py-2">
              <button
                data-testid="sidebar-new-chat"
                onClick={() => {
                  const { messages } = useChatStore.getState();
                  if (messages.length > 0) newSession();
                  navigate('/');
                }}
                className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
              >
                <Plus className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
                <span className="min-w-0 truncate text-center">{t('sidebar.newChat')}</span>
              </button>
            </div>

            {sessions.length > 0 && (
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-1">
                {sessionBuckets.map((bucket) =>
                  bucket.sessions.length > 0 ? (
                    <div key={bucket.key} className="pt-1">
                      <div className="px-2 pb-1 text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--sidebar-history-muted))]">
                        {bucket.label}
                      </div>
                      {bucket.sessions.map((s) => {
                        const agentId = getAgentIdFromSessionKey(s.key);
                        const agentName = agentNameById[agentId] || agentId;
                        const isActiveSession = isOnChat && currentSessionKey === s.key;
                        return (
                          <div key={s.key} className="group relative flex items-center">
                            <button
                              onClick={() => {
                                switchSession(s.key);
                                navigate('/');
                              }}
                              className={cn(
                                'w-full min-w-0 rounded-sm px-2 py-1.5 pr-6 text-left text-[12px] transition-all',
                                'hover:bg-[hsl(var(--sidebar-history-hover))]',
                                isActiveSession
                                  ? 'bg-[hsl(var(--sidebar-history-active))] text-[hsl(var(--sidebar-history-active-text))] hover:bg-[hsl(var(--sidebar-history-active))]'
                                  : 'text-[hsl(var(--sidebar-history-text))]'
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-1">
                                <span
                                  className={cn(
                                    'max-w-[44px] shrink-0 truncate rounded-full border px-1 py-0.5 text-[11px] font-medium',
                                    isActiveSession
                                      ? 'border-[hsl(var(--sidebar-history-active-text))]/35 bg-[hsl(var(--sidebar-history-active-text))]/15 text-[hsl(var(--sidebar-history-active-text))]'
                                      : 'border-border bg-background text-muted-foreground'
                                  )}
                                >
                                  {agentName}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                  {getSessionLabel(s.key, s.displayName, s.label)}
                                </span>
                              </div>
                            </button>
                            <button
                              aria-label="Delete session"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSessionToDelete({
                                  key: s.key,
                                  label: getSessionLabel(s.key, s.displayName, s.label),
                                });
                              }}
                              className={cn(
                                'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                                'opacity-30 group-hover:opacity-100',
                                'text-muted-foreground hover:text-primary hover:bg-accent'
                              )}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null
                )}
              </div>
            )}
            <div className="mt-auto border-t border-border px-2 py-2">
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-8 w-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-primary"
                onClick={() => setSidebarCollapsed(true)}
              >
                <PanelLeftClose className="h-[16px] w-[16px]" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
    </aside>
  );
}
