/**
 * Experts Page
 * Browse pre-installed AI experts and start expert-guided conversations
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, AlertCircle, ArrowRight, Settings, Check, X, Download } from 'lucide-react';
import { useExpertsStore } from '@/stores/experts';
import { useSkillsStore } from '@/stores/skills';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ExpertRuntime } from '@/types/expert';
import type { ExpertSkillStatus } from '@/stores/experts';

function statusBadge(status: ExpertRuntime['status'], t: (key: string) => string) {
  switch (status) {
    case 'ready':
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 shadow-none text-[11px] font-medium px-2 py-0.5 rounded-full">
          {t('chat:experts.skillReady')}
        </Badge>
      );
    case 'setting-up':
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-0 shadow-none text-[11px] font-medium px-2 py-0.5 rounded-full">
          {t('chat:experts.settingUp')}
        </Badge>
      );
    case 'limited':
      return (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-0 shadow-none text-[11px] font-medium px-2 py-0.5 rounded-full">
          {t('chat:experts.limitedMode')}
        </Badge>
      );
    case 'unavailable':
      return (
        <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-0 shadow-none text-[11px] font-medium px-2 py-0.5 rounded-full">
          {t('chat:experts.unavailable')}
        </Badge>
      );
  }
}

function SkillChip({ status }: { status: ExpertSkillStatus }) {
  if (status.installed && status.enabled) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">
        <Check className="h-3 w-3" />
        {status.skillId}
      </span>
    );
  }
  if (status.installed && !status.enabled) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-full px-2 py-0.5">
        <X className="h-3 w-3" />
        {status.skillId}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 bg-red-500/10 rounded-full px-2 py-0.5">
      <X className="h-3 w-3" />
      {status.skillId}
    </span>
  );
}

export function Experts() {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useNavigate();
  const experts = useExpertsStore((s) => s.experts);
  const runtimes = useExpertsStore((s) => s.runtimes);
  const skillStatuses = useExpertsStore((s) => s.skillStatuses);
  const loading = useExpertsStore((s) => s.loading);
  const error = useExpertsStore((s) => s.error);
  const loadExperts = useExpertsStore((s) => s.loadExperts);
  const switchSession = useChatStore((s) => s.switchSession);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const fetchSkills = useSkillsStore((s) => s.fetchSkills);
  const installSkill = useSkillsStore((s) => s.installSkill);
  const enableSkill = useSkillsStore((s) => s.enableSkill);

  const [installingSkills, setInstallingSkills] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadExperts();
  }, [loadExperts]);

  useEffect(() => {
    if (isGatewayRunning) {
      void fetchSkills();
    }
  }, [fetchSkills, isGatewayRunning]);

  const enabledExperts = useMemo(() => experts.filter((e) => e.enabled), [experts]);

  // Smart routing: auto-redirect when only one expert is enabled and ready
  useEffect(() => {
    if (loading) return;
    if (enabledExperts.length !== 1) return;
    if (sessionStorage.getItem('boostclaw-expert-redirected')) return;

    const expert = enabledExperts[0];
    const runtime = runtimes[expert.id];
    if (!runtime || runtime.status !== 'ready' || !runtime.agentId) return;

    sessionStorage.setItem('boostclaw-expert-redirected', '1');
    const sessionKey = `agent:${runtime.agentId}:main`;
    switchSession(sessionKey);
    navigate('/');
  }, [loading, enabledExperts, runtimes, switchSession, navigate]);

  const handleStartExpert = (runtime: ExpertRuntime) => {
    if (runtime.status === 'unavailable') return;
    const agentId = runtime.agentId;
    if (!agentId) return;

    const sessionKey = `agent:${agentId}:main`;
    switchSession(sessionKey);
    navigate('/');
  };

  const handleInstallMissingSkills = useCallback(
    async (expertId: string) => {
      const statuses = skillStatuses[expertId];
      if (!statuses) return;

      const missing = statuses.filter((s) => !s.installed || !s.enabled);
      if (missing.length === 0) return;

      setInstallingSkills((prev) => {
        const next = new Set(prev);
        for (const s of missing) next.add(s.skillId);
        return next;
      });

      let installed = 0;
      let failed = 0;
      let rateLimited = 0;
      for (const skill of missing) {
        try {
          if (!skill.installed) {
            await installSkill(skill.skillId);
            // Delay between installs to avoid ClawHub rate limits
            if (missing.length > 1) {
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
          await enableSkill(skill.skillId);
          installed += 1;
        } catch (err) {
          failed += 1;
          const msg = String(err);
          if (msg.includes('ateLimit') || msg.includes('rate')) {
            rateLimited += 1;
          }
          console.warn(`Failed to install/enable skill ${skill.skillId}:`, err);
        }
      }

      setInstallingSkills((prev) => {
        const next = new Set(prev);
        for (const s of missing) next.delete(s.skillId);
        return next;
      });

      if (rateLimited > 0) {
        toast.error(
          `Rate limited — please wait a moment and retry, or install manually from the Skills page.`,
          { duration: 8000 }
        );
      } else if (failed === 0) {
        toast.success(`Installed ${installed} skill${installed > 1 ? 's' : ''}`);
      } else if (installed > 0) {
        toast.warning(`Installed ${installed}, ${failed} failed`);
      } else {
        toast.error('Failed to install skills');
      }
    },
    [skillStatuses, installSkill, enableSkill]
  );

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div
      data-testid="experts-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden"
    >
      <div className="w-full max-w-4xl mx-auto flex flex-col h-full p-10 pt-16">
        {/* Header */}
        <div className="mb-8 shrink-0">
          <h1
            className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight"
            style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}
          >
            {t('chat:experts.pageTitle')}
          </h1>
          <p className="text-[17px] text-foreground/70 font-medium">
            {t('chat:experts.pageSubtitle')}
          </p>
        </div>

        {/* Gateway Warning */}
        {!isGatewayRunning && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
              {t('common:gateway.notRunning')}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Expert Cards */}
        <div className="flex-1 overflow-y-auto pb-10 min-h-0">
          {enabledExperts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Sparkles className="h-10 w-10 mb-4 opacity-50" />
              <p className="text-sm">{t('chat:experts.unavailable')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {enabledExperts.map((config) => {
                const runtime = runtimes[config.id];
                if (!runtime) return null;

                const isClickable = runtime.status !== 'unavailable' && !!runtime.agentId;
                const skills = skillStatuses[config.id] ?? [];
                const missingCount = skills.filter((s) => !s.installed || !s.enabled).length;
                const isInstalling = skills.some((s) => installingSkills.has(s.skillId));

                return (
                  <div
                    key={config.id}
                    className={cn(
                      'group flex flex-col gap-3 rounded-2xl border p-6 text-left transition-all duration-200',
                      'border-black/8 dark:border-white/8 bg-white dark:bg-card',
                      isClickable
                        ? 'hover:border-[#3964F2]/30 hover:shadow-md cursor-pointer active:scale-[0.98]'
                        : 'opacity-60'
                    )}
                  >
                    {/* Card header */}
                    <div className="flex items-start justify-between">
                      <div
                        className="flex items-center gap-3"
                        onClick={() => isClickable && handleStartExpert(runtime)}
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#3964F2]/10 text-2xl shrink-0">
                          {config.icon}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-[16px] font-semibold text-foreground truncate">
                            {config.name}
                          </h3>
                          <Badge
                            variant="secondary"
                            className="mt-1 text-[10px] font-medium px-1.5 py-0 h-4 bg-black/5 dark:bg-white/10 border-0 shadow-none text-foreground/60"
                          >
                            {config.category}
                          </Badge>
                        </div>
                      </div>
                      {statusBadge(runtime.status, t)}
                    </div>

                    {/* Description */}
                    <p
                      className="text-[13px] text-foreground/60 leading-relaxed line-clamp-2"
                      onClick={() => isClickable && handleStartExpert(runtime)}
                    >
                      {config.description}
                    </p>

                    {/* Skill status */}
                    {skills.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-medium">
                          {t('chat:experts.skillStatus')}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {skills.map((s) => (
                            <SkillChip key={s.skillId} status={s} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Install missing skills button */}
                    {missingCount > 0 && isGatewayRunning && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInstallMissingSkills(config.id);
                        }}
                        disabled={isInstalling}
                        className={cn(
                          'flex items-center gap-1.5 self-start text-[12px] font-medium rounded-full px-3 py-1.5 transition-colors',
                          'text-[#3964F2] bg-[#3964F2]/8 hover:bg-[#3964F2]/15',
                          isInstalling && 'opacity-50 cursor-wait'
                        )}
                      >
                        {isInstalling ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {isInstalling
                          ? 'Installing...'
                          : `Install ${missingCount} missing skill${missingCount > 1 ? 's' : ''}`}
                      </button>
                    )}

                    {/* Suggested prompts */}
                    {config.suggestedPrompts.length > 0 && (
                      <div
                        className="flex flex-col gap-1.5 mt-1"
                        onClick={() => isClickable && handleStartExpert(runtime)}
                      >
                        <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-medium">
                          {t('chat:experts.suggestedPrompts')}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {config.suggestedPrompts.slice(0, 3).map((prompt) => (
                            <span
                              key={prompt}
                              className="inline-block text-[11px] text-foreground/50 bg-black/[0.03] dark:bg-white/[0.05] rounded-full px-2.5 py-0.5 truncate max-w-full"
                            >
                              {prompt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Start indicator */}
                    {isClickable && (
                      <div
                        className="flex items-center gap-1.5 text-[12px] font-medium text-[#3964F2] mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleStartExpert(runtime)}
                      >
                        <span>Start conversation</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Advanced: manage agents link */}
          <div className="mt-8 pt-6 border-t border-black/8 dark:border-white/8">
            <button
              onClick={() => navigate('/agents')}
              className="flex items-center gap-2 text-[13px] text-foreground/50 hover:text-foreground/70 transition-colors font-medium"
            >
              <Settings className="h-3.5 w-3.5" />
              {t('chat:experts.advancedAgents')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Experts;
