/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
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
  Server,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
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
  const link = (
    <NavLink
      to={to}
      onClick={onClick}
      data-testid={testId}
      aria-label={hideLabel ? label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[12px] font-medium transition-all duration-200',
          'text-[#3a4452] hover:bg-white/70 hover:text-[#20242d] dark:text-[#b0b8c4] dark:hover:bg-white/8 dark:hover:text-[#e2e6ed]',
          isActive ? 'bg-white text-[#20242d] shadow-[0_8px_22px_rgba(80,92,120,0.10)] dark:bg-white/10 dark:text-[#e2e6ed] dark:shadow-none' : '',
          collapsed && 'px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div
            className={cn(
              'flex shrink-0 items-center justify-center transition-colors',
              isActive ? 'text-[#20242d] dark:text-[#e2e6ed]' : 'text-[#3a4452] group-hover:text-[#20242d] dark:text-[#b0b8c4] dark:group-hover:text-[#e2e6ed]'
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
                  className="shrink-0 rounded-full border border-[#dce3ef] bg-white text-[11px] text-[#5f6b7a] dark:border-[#2a3345] dark:bg-white/8 dark:text-[#b0b8c4]"
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

  if (hideLabel && label) {
    return (
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  // New or not-yet-loaded sessions have no timestamp; show under "today", not "older"
  // (zh: "一个月之前" / en: "Over a month ago" would look wrong for a fresh chat).
  if (!activityMs || activityMs <= 0) return 'today';

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
    (a, b) =>
      (sessionLastActivity[b.key] ?? nowMs) - (sessionLastActivity[a.key] ?? nowMs)
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
    {
      to: '/mcp',
      icon: <Server className="h-[18px] w-[18px]" strokeWidth={1.8} />,
      label: t('sidebar.mcp'),
      testId: 'sidebar-nav-mcp',
    },
  ];

  // ── History pane drag-to-resize ──────────────────────────────────
  const [historyWidth, setHistoryWidth] = useState(210);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = historyWidth;
  }, [historyWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - dragStartX.current;
      const next = Math.max(160, Math.min(400, dragStartWidth.current + delta));
      setHistoryWidth(next);
    };
    const onMouseUp = () => {
      draggingRef.current = false;
      setIsDragging(false);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <aside
      data-testid="sidebar"
      style={{
        width: sidebarCollapsed || !isOnChat ? 72 : 76 + historyWidth,
      }}
      className={cn(
        'flex min-h-0 shrink-0 overflow-hidden border-r border-[#e8edf5] bg-[#eef3ff] dark:border-[#1e2433] dark:bg-[#181d28]',
        !isDragging && 'transition-[width] duration-300',
      )}
    >
      <div className="flex min-h-0 flex-1">
        {/* Left icon rail */}
        <div
          className={cn(
            'flex min-h-0 shrink-0 flex-col border-r border-[#e2e8f2] bg-[#eef3ff] dark:border-[#1e2433] dark:bg-[#181d28]',
            sidebarCollapsed ? 'w-[72px]' : 'w-[76px]'
          )}
        >
          <div className="flex h-[72px] flex-col items-center justify-center gap-1 border-b border-[#e2e8f2] dark:border-[#252b38]">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white bg-white shadow-sm dark:border-white/10 dark:bg-white/10">
              <img src={logoSvg} alt="BoostClaw" className="h-4.5 w-auto shrink-0" />
            </div>
            <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-bold leading-none text-[#20242d] dark:text-[#e2e6ed]">
              BoostClaw
            </span>
          </div>

          <nav className="flex flex-1 flex-col gap-3 px-2 py-2">
            {topNavItems.map((item) => (
              <NavItem key={item.to} {...item} collapsed={false} />
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-4 border-t border-[#e2e8f2] dark:border-[#252b38] px-2 py-4">
            {bottomNavItems.map((item) => (
              <NavItem key={item.to} {...item} collapsed={false} hideLabel />
            ))}
            <div className="flex justify-center">
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <NavLink
                    to="/settings"
                    data-testid="sidebar-nav-settings"
                    aria-label={t('common:sidebar.settings')}
                    className={({ isActive }) =>
                      cn(
                        'flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[12px] font-medium transition-all',
                        'text-[#3a4452] hover:bg-white/70 hover:text-[#20242d] dark:text-[#b0b8c4] dark:hover:bg-white/8 dark:hover:text-[#e2e6ed]',
                        isActive && 'bg-white text-[#20242d] shadow-[0_8px_22px_rgba(80,92,120,0.10)] dark:bg-white/10 dark:text-[#e2e6ed] dark:shadow-none'
                      )
                    }
                  >
                    <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{t('common:sidebar.settings')}</TooltipContent>
              </Tooltip>
            </div>
            {sidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="mx-auto h-7 w-7 rounded-lg text-[#3a4452] hover:bg-white/70 hover:text-[#20242d] dark:text-[#b0b8c4] dark:hover:bg-white/8 dark:hover:text-[#e2e6ed]"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeft className="h-[16px] w-[16px]" />
              </Button>
            )}
          </div>
        </div>

        {/* Right history pane */}
        {!sidebarCollapsed && isOnChat && (
          <div
            className="flex min-h-0 min-w-0 shrink-0 flex-col bg-white dark:bg-[#11161f] relative"
            style={{ width: historyWidth }}
          >
            <div className="px-2.5 py-2">
              <button
                data-testid="sidebar-new-chat"
                onClick={() => {
                  const { messages } = useChatStore.getState();
                  if (messages.length > 0) newSession();
                  navigate('/');
                }}
                className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#edf0f5] bg-white px-2 py-1.5 text-[12px] font-medium text-[#20242d] shadow-sm transition-colors hover:bg-[#f7f8fa] dark:border-[#252b38] dark:bg-[#181d28] dark:text-[#e2e6ed] dark:hover:bg-[#1e2433]"
              >
                <Plus className="h-4 w-4 shrink-0 text-[#20242d]" strokeWidth={2} />
                <span className="min-w-0 truncate text-center">{t('sidebar.newChat')}</span>
              </button>
            </div>

            {sessions.length > 0 && (
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-1">
                {sessionBuckets.map((bucket) =>
                  bucket.sessions.length > 0 ? (
                    <div key={bucket.key} className="pt-1">
                      <div className="px-2 pb-1 text-[11px] uppercase tracking-[0.16em] text-[#a8afb9] dark:text-[#6b7280]">
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
                                'hover:bg-[#f6f7f9] dark:hover:bg-[#1e2433]',
                                isActiveSession
                                  ? 'bg-[#eef3ff] text-[#20242d] hover:bg-[#eef3ff] dark:bg-[#1a2740] dark:text-[#e2e6ed] dark:hover:bg-[#1a2740]'
                                  : 'text-[#68717f] dark:text-[#9aa2b0]'
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-1">
                                <span
                                  className={cn(
                                    'max-w-[44px] shrink-0 truncate rounded-full border px-1 py-0.5 text-[12px] font-medium',
                                    isActiveSession
                                      ? 'border-[#d9e2f3] bg-white text-[#20242d] dark:border-[#2a3a5a] dark:bg-[#222d42] dark:text-[#e2e6ed]'
                                      : 'border-[#e4e8ef] bg-white text-[#77808d] dark:border-[#252b38] dark:bg-[#181d28] dark:text-[#9aa2b0]'
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
                                'opacity-0 group-hover:opacity-100',
                                'text-[#a0a7b2] hover:text-[#20242d] hover:bg-[#eef3ff] dark:text-[#6b7280] dark:hover:text-[#e2e6ed] dark:hover:bg-white/10'
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
            <div className="mt-auto border-t border-[#eef1f5] dark:border-[#1e2433] px-2 py-2">
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7 rounded-lg text-[#6b747f] hover:bg-[#f6f7f9] hover:text-[#20242d] dark:text-[#6b7280] dark:hover:bg-white/8 dark:hover:text-[#e2e6ed]"
                onClick={() => setSidebarCollapsed(true)}
              >
                <PanelLeftClose className="h-[16px] w-[16px]" />
              </Button>
            </div>

            {/* Drag handle for resizing history pane */}
            <div
              onMouseDown={onDragMouseDown}
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#0a84ff]/30 transition-colors z-10"
            />
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
