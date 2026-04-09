/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { hostApiFetch } from '@/lib/host-api';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ExecutionGraphCard } from './ExecutionGraphCard';
import { ChatToolbar } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { deriveTaskSteps, parseSubagentCompletionInfo } from './task-visualization';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';

export function Chat() {
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const [childTranscripts, setChildTranscripts] = useState<Record<string, RawMessage[]>>({});

  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const subagentCompletionInfos = useMemo(
    () => messages.map((message) => parseSubagentCompletionInfo(message)),
    [messages],
  );

  useEffect(() => {
    const completions = subagentCompletionInfos.filter((value): value is NonNullable<typeof value> => value != null);
    const missing = completions.filter((completion) => !childTranscripts[completion.sessionId]);
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (completion) => {
        try {
          const result = await hostApiFetch<{ success: boolean; messages?: RawMessage[] }>(
            `/api/sessions/transcript?agentId=${encodeURIComponent(completion.agentId)}&sessionId=${encodeURIComponent(completion.sessionId)}`,
          );
          if (!result.success) {
            console.warn('Failed to load child transcript:', {
              agentId: completion.agentId,
              sessionId: completion.sessionId,
              result,
            });
            return null;
          }
          return { sessionId: completion.sessionId, messages: result.messages || [] };
        } catch (error) {
          console.warn('Failed to load child transcript:', {
            agentId: completion.agentId,
            sessionId: completion.sessionId,
            error,
          });
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setChildTranscripts((current) => {
        const next = { ...current };
        for (const result of results) {
          if (!result) continue;
          next[result.sessionId] = result.messages;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [subagentCompletionInfos, childTranscripts]);

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const streamState = useMemo(() => {
    const streamMsg = streamingMessage && typeof streamingMessage === 'object'
      ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
      : null;
    const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');
    const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
    const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
    const streamImages = streamMsg ? extractImages(streamMsg) : [];
    const hasStreamText = streamText.trim().length > 0;
    const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
    const hasStreamTools = streamTools.length > 0;
    const hasStreamImages = streamImages.length > 0;
    const hasStreamToolStatus = streamingTools.length > 0;
    const hasAnyStreamContent = hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

    return {
      streamMsg,
      streamText,
      streamThinking,
      streamTools,
      streamImages,
      hasStreamText,
      hasStreamThinking,
      hasStreamTools,
      hasStreamImages,
      hasStreamToolStatus,
      hasAnyStreamContent,
      shouldRenderStreaming: sending && hasAnyStreamContent,
    };
  }, [showThinking, sending, streamingMessage, streamingTools]);

  const isEmpty = messages.length === 0 && !sending;
  const agentNameById = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const { userRunCards, suppressedToolIndexes } = useMemo(() => {
    const nextUserMessageIndexes = new Array<number>(messages.length).fill(-1);
    let nextUserMessageIndex = -1;
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      nextUserMessageIndexes[idx] = nextUserMessageIndex;
      if (messages[idx].role === 'user' && !subagentCompletionInfos[idx]) {
        nextUserMessageIndex = idx;
      }
    }

    const computedRunCards: Array<{
      triggerIndex: number;
      replyIndex: number | null;
      active: boolean;
      agentLabel: string;
      sessionLabel: string;
      segmentEnd: number;
      steps: ReturnType<typeof deriveTaskSteps>;
    }> = [];
    const suppressedIndexes = new Set<number>();
    const segmentAgentLabel = agentNameById.get(currentAgentId) || currentAgentId;
    const segmentSessionLabel = sessionLabels[currentSessionKey] || currentSessionKey;

    for (let idx = 0; idx < messages.length; idx += 1) {
      const message = messages[idx];
      if (message.role !== 'user' || subagentCompletionInfos[idx]) continue;

      const nextUserIndex = nextUserMessageIndexes[idx];
      const segmentEnd = nextUserIndex === -1 ? messages.length : nextUserIndex;
      const segmentMessages = messages.slice(idx + 1, segmentEnd);
      const replyIndexOffset = segmentMessages.findIndex((candidate) => candidate.role === 'assistant');
      const replyIndex = replyIndexOffset === -1 ? null : idx + 1 + replyIndexOffset;
      const completionInfos = subagentCompletionInfos
        .slice(idx + 1, segmentEnd)
        .filter((value): value is NonNullable<typeof value> => value != null);
      const isLatestOpenRun = nextUserIndex === -1 && (sending || pendingFinal || streamState.hasAnyStreamContent);

      let steps = deriveTaskSteps({
        messages: segmentMessages,
        streamingMessage: isLatestOpenRun ? streamingMessage : null,
        streamingTools: isLatestOpenRun ? streamingTools : [],
        sending: isLatestOpenRun ? sending : false,
        pendingFinal: isLatestOpenRun ? pendingFinal : false,
        showThinking,
      });

      for (const completion of completionInfos) {
        const childMessages = childTranscripts[completion.sessionId];
        if (!childMessages || childMessages.length === 0) continue;
        const branchRootId = `subagent:${completion.sessionId}`;
        const childSteps = deriveTaskSteps({
          messages: childMessages,
          streamingMessage: null,
          streamingTools: [],
          sending: false,
          pendingFinal: false,
          showThinking,
        }).map((step) => ({
          ...step,
          id: `${completion.sessionId}:${step.id}`,
          depth: step.depth + 1,
          parentId: branchRootId,
        }));

        steps = [
          ...steps,
          {
            id: branchRootId,
            label: `${completion.agentId} subagent`,
            status: 'completed',
            kind: 'system' as const,
            detail: completion.sessionKey,
            depth: 1,
            parentId: 'agent-run',
          },
          ...childSteps,
        ];
      }

      if (steps.length === 0) continue;

      const cardSegmentEnd = replyIndex ?? (nextUserIndex === -1 ? messages.length - 1 : nextUserIndex - 1);
      for (let messageIndex = idx + 1; messageIndex <= cardSegmentEnd; messageIndex += 1) {
        suppressedIndexes.add(messageIndex);
      }

      computedRunCards.push({
        triggerIndex: idx,
        replyIndex,
        active: isLatestOpenRun,
        agentLabel: segmentAgentLabel,
        sessionLabel: segmentSessionLabel,
        segmentEnd: cardSegmentEnd,
        steps,
      });
    }

    return { userRunCards: computedRunCards, suppressedToolIndexes: suppressedIndexes };
  }, [
    agentNameById,
    childTranscripts,
    currentAgentId,
    currentSessionKey,
    messages,
    pendingFinal,
    sending,
    sessionLabels,
    showThinking,
    streamState.hasAnyStreamContent,
    streamingMessage,
    streamingTools,
    subagentCompletionInfos,
  ]);

  const messageRows = useMemo(() => messages.map((msg, idx) => {
    const suppressToolCards = suppressedToolIndexes.has(idx);
    const cardsForMessage = userRunCards.filter((card) => card.triggerIndex === idx);

    return (
      <div
        key={msg.id || `msg-${idx}`}
        className="space-y-3"
        id={`chat-message-${idx}`}
        data-testid={`chat-message-${idx}`}
      >
        <ChatMessage
          message={msg}
          showThinking={showThinking}
          suppressToolCards={suppressToolCards}
        />
        {cardsForMessage.map((card) => (
          <ExecutionGraphCard
            key={`graph-${idx}`}
            agentLabel={card.agentLabel}
            sessionLabel={card.sessionLabel}
            steps={card.steps}
            active={card.active}
            onJumpToTrigger={() => {
              document.getElementById(`chat-message-${card.triggerIndex}`)?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              });
            }}
            onJumpToReply={() => {
              if (card.replyIndex == null) return;
              document.getElementById(`chat-message-${card.replyIndex}`)?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              });
            }}
          />
        ))}
      </div>
    );
  }), [messages, showThinking, suppressedToolIndexes, userRunCards]);

  return (
    <div className={cn("relative flex min-h-0 flex-col overflow-hidden rounded-[28px] transition-colors duration-500")} style={{ height: '100%' }}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--glow)/0.08),transparent_24%)]" />
      {/* Toolbar */}
      <div className="relative z-10 flex shrink-0 items-center justify-end border-b border-border/50 px-5 py-3">
        <ChatToolbar />
      </div>

      {/* Messages Area */}
      <div className="relative z-10 min-h-0 flex-1 overflow-hidden px-5 py-5">
        <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-4 lg:flex-row lg:items-stretch">
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div ref={contentRef} className="max-w-4xl space-y-4">
              {isEmpty ? (
                <WelcomeScreen />
              ) : (
                <>
                  {messageRows}

                  {/* Streaming message */}
                  {streamState.shouldRenderStreaming && (
                    <ChatMessage
                      message={(streamState.streamMsg
                        ? {
                            ...(streamState.streamMsg as Record<string, unknown>),
                            role: (typeof streamState.streamMsg.role === 'string' ? streamState.streamMsg.role : 'assistant') as RawMessage['role'],
                            content: streamState.streamMsg.content ?? streamState.streamText,
                            timestamp: streamState.streamMsg.timestamp ?? streamingTimestamp,
                          }
                        : {
                            role: 'assistant',
                            content: streamState.streamText,
                            timestamp: streamingTimestamp,
                          }) as RawMessage}
                      showThinking={showThinking}
                      isStreaming
                      streamingTools={streamingTools}
                    />
                  )}

                  {/* Activity indicator: waiting for next AI turn after tool execution */}
                  {sending && pendingFinal && !streamState.shouldRenderStreaming && (
                    <ActivityIndicator phase="tool_processing" />
                  )}

                  {/* Typing indicator when sending but no stream content yet */}
                  {sending && !pendingFinal && !streamState.hasAnyStreamContent && (
                    <TypingIndicator />
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="relative z-10 border-t border-destructive/20 bg-destructive/10 px-4 py-2">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
            <button
              onClick={clearError}
              className="text-xs text-destructive/60 hover:text-destructive underline"
            >
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSend={sendMessage}
        onStop={abortRun}
        disabled={!isGatewayRunning}
        sending={sending}
        isEmpty={isEmpty}
      />

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-[28px] bg-background/20 backdrop-blur-[1px] pointer-events-auto">
          <div className="rounded-full border border-border bg-background p-2.5 shadow-lg">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen() {
  const { t } = useTranslation('chat');
  const quickActions = [
    { key: 'askQuestions', label: t('welcome.askQuestions') },
    { key: 'creativeTasks', label: t('welcome.creativeTasks') },
    { key: 'brainstorming', label: t('welcome.brainstorming') },
  ];

  return (
    <div data-testid="chat-welcome-screen" className="flex h-[60vh] flex-col items-center justify-center text-center">
      <div className="panel-elevated tech-border w-full max-w-3xl rounded-[32px] px-8 py-10">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-primary/75">{t('welcome.eyebrow')}</p>
        <h1 className="text-gradient mx-auto mb-4 max-w-2xl text-4xl font-semibold md:text-5xl">
          {t('welcome.subtitle')}
        </h1>
        <div className="mb-8 grid gap-3 text-left sm:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-background/55 p-4">
            <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t('welcome.sessionsTitle')}</p>
            <p className="text-sm font-medium text-foreground">{t('welcome.sessionsBody')}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/55 p-4">
            <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t('welcome.agentsTitle')}</p>
            <p className="text-sm font-medium text-foreground">{t('welcome.agentsBody')}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/55 p-4">
            <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t('welcome.runtimeTitle')}</p>
            <p className="text-sm font-medium text-foreground">{t('welcome.runtimeBody')}</p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-center gap-2.5">
        {quickActions.map(({ key, label }) => (
          <button 
            key={key}
            className="rounded-full border border-border/70 bg-background/55 px-4 py-2 text-[13px] font-medium text-foreground/75 transition-colors hover:border-primary/30 hover:bg-primary/8 hover:text-foreground"
          >
            {label}
          </button>
        ))}
        </div>
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-white/[0.05] px-4 py-3 text-foreground">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-white/[0.05] px-4 py-3 text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Processing tool results…</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
