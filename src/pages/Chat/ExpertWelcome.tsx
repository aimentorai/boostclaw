/**
 * ExpertWelcome Component
 * Displays expert-specific welcome message and suggested prompts
 * when the current chat session belongs to an expert agent.
 */
import { useEffect } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { useExpertsStore } from '@/stores/experts';
import { useChatStore } from '@/stores/chat';
import { useTemplatesStore } from '@/stores/templates';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  getTemplateName,
  getTemplateSuggestedPrompts,
  getTemplateWelcomeMessage,
} from '@/lib/template-i18n';
import type { ExpertRuntime } from '@/types/expert';
import { useTranslation } from 'react-i18next';

interface ExpertWelcomeProps {
  onPromptClick: (prompt: string) => void;
}

export function ExpertWelcome({ onPromptClick }: ExpertWelcomeProps) {
  const { t } = useTranslation('chat');
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const getExpertByAgentId = useExpertsStore((s) => s.getExpertByAgentId);
  const activeTemplate = useTemplatesStore((s) => s.activeTemplate);
  const setActiveTemplate = useTemplatesStore((s) => s.setActiveTemplate);

  // Clear active template when session no longer matches
  useEffect(() => {
    if (activeTemplate && !currentSessionKey.includes(`:tpl-${activeTemplate.id}`)) {
      setActiveTemplate(null);
    }
  }, [activeTemplate, currentSessionKey, setActiveTemplate]);

  // Template welcome takes priority
  if (activeTemplate) {
    const welcomeMessage = getTemplateWelcomeMessage(t, activeTemplate);
    const suggestedPrompts = getTemplateSuggestedPrompts(t, activeTemplate);

    return (
      <div className="w-full max-w-2xl px-4 text-center mb-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-500/10 text-3xl">
          {activeTemplate.icon}
        </div>
        <h1 className="text-2xl font-semibold text-foreground leading-snug">
          {getTemplateName(t, activeTemplate)}
        </h1>
        <Badge
          variant="secondary"
          className="mt-2 text-[10px] font-medium px-1.5 py-0 h-4 bg-purple-500/10 border-0 shadow-none text-purple-600 dark:text-purple-400"
        >
          {activeTemplate.category}
        </Badge>
        {welcomeMessage && (
          <p className="mt-4 text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">
            {welcomeMessage}
          </p>
        )}
        {suggestedPrompts.length > 0 && (
          <div className="mt-6 flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-medium">
              Try asking
            </span>
            <div className="flex flex-col gap-2 mt-1">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setActiveTemplate(null);
                    onPromptClick(prompt);
                  }}
                  className={cn(
                    'group flex items-center gap-3 w-full rounded-xl border px-4 py-3 text-left transition-all',
                    'border-black/8 dark:border-white/8 bg-white dark:bg-card',
                    'hover:border-[#3964F2]/30 hover:shadow-sm active:scale-[0.99]'
                  )}
                >
                  <span className="flex-1 text-[13px] text-foreground/70 group-hover:text-foreground transition-colors">
                    {prompt}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-foreground/30 group-hover:text-[#3964F2] shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const runtime = getExpertByAgentId(currentAgentId);
  if (!runtime) return null;

  return (
    <div className="w-full max-w-2xl px-4 text-center mb-8">
      {/* Expert icon */}
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#3964F2]/10 text-3xl">
        {runtime.config.icon}
      </div>

      {/* Expert name */}
      <h1 className="text-2xl font-semibold text-foreground md:text-3xl leading-snug">
        {runtime.config.name}
      </h1>

      {/* Status badge */}
      <div className="mt-2 flex items-center justify-center gap-2">
        <Badge
          variant="secondary"
          className="text-[10px] font-medium px-1.5 py-0 h-4 bg-black/5 dark:bg-white/10 border-0 shadow-none text-foreground/60"
        >
          {runtime.config.category}
        </Badge>
        <StatusPill status={runtime.status} />
      </div>

      {/* Welcome message */}
      {runtime.config.welcomeMessage && (
        <p className="mt-4 text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">
          {runtime.config.welcomeMessage}
        </p>
      )}

      {/* Error message */}
      {runtime.errorMessage && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{runtime.errorMessage}</span>
        </div>
      )}

      {/* Suggested prompts */}
      {runtime.config.suggestedPrompts.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-foreground/40 font-medium">
            Try asking
          </span>
          <div className="flex flex-col gap-2 mt-1">
            {runtime.config.suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onPromptClick(prompt)}
                className={cn(
                  'group flex items-center gap-3 w-full rounded-xl border px-4 py-3 text-left transition-all',
                  'border-black/8 dark:border-white/8 bg-white dark:bg-card',
                  'hover:border-[#3964F2]/30 hover:shadow-sm active:scale-[0.99]'
                )}
              >
                <span className="flex-1 text-[13px] text-foreground/70 group-hover:text-foreground transition-colors">
                  {prompt}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-foreground/30 group-hover:text-[#3964F2] shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Usage tips */}
      {runtime.config.usageTips.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1">
          {runtime.config.usageTips.map((tip) => (
            <span key={tip} className="text-[11px] text-foreground/40">
              {tip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: ExpertRuntime['status'] }) {
  switch (status) {
    case 'ready':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Ready
        </span>
      );
    case 'setting-up':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          Setting up
        </span>
      );
    case 'limited':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Limited
        </span>
      );
    case 'unavailable':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          Unavailable
        </span>
      );
  }
}
