/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useExpertsStore } from '@/stores/experts';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { ExpertWelcome } from './ExpertWelcome';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { parseSubagentCompletionInfo } from './task-visualization';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';

function isSimpleGreetingMessage(message: RawMessage | undefined): boolean {
  if (!message || message.role !== 'user') return false;
  const text = extractText(message).trim().toLowerCase();
  if (!text || text.length > 24) return false;
  return /^(你好|您好|哈喽|嗨|在吗|hi|hello|hey|yo|哈喽呀|你好呀)[!.。！?？\s]*$/i.test(text);
}

export function Chat() {
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
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
  const getExpertByAgentId = useExpertsStore((s) => s.getExpertByAgentId);
  const loadExperts = useExpertsStore((s) => s.loadExperts);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);

  const [thinkingExpanded, setThinkingExpanded] = useState(true);
  const toggleThinkingExpanded = useCallback(() => {
    setThinkingExpanded((expanded) => !expanded);
  }, []);
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
    void loadExperts();
  }, [loadExperts]);

  // Align composer agent summary with the current session as early as the chat page opens
  // (same data Sidebar loads; avoids a race where model/skill feel missing until navigation).
  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const activeExpert = getExpertByAgentId(currentAgentId);

  const subagentCompletionInfos = useMemo(
    () => messages.map((message) => parseSubagentCompletionInfo(message)),
    [messages]
  );

  // Gateway not running block has been completely removed so the UI always renders.

  const streamState = useMemo(() => {
    const streamMsg =
      streamingMessage && typeof streamingMessage === 'object'
        ? (streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number })
        : null;
    const streamText = streamMsg
      ? extractText(streamMsg)
      : typeof streamingMessage === 'string'
        ? streamingMessage
        : '';
    const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
    const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
    const streamImages = streamMsg ? extractImages(streamMsg) : [];
    const hasStreamText = streamText.trim().length > 0;
    const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
    const hasStreamTools = streamTools.length > 0;
    const hasStreamImages = streamImages.length > 0;
    const hasStreamToolStatus = streamingTools.length > 0;
    const hasAnyStreamContent =
      hasStreamText ||
      hasStreamThinking ||
      hasStreamTools ||
      hasStreamImages ||
      hasStreamToolStatus;

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

  const simpleGreetingSegments = useMemo(() => {
    const simpleIndexes = new Set<number>();
    let currentSimpleGreeting = false;

    for (let idx = 0; idx < messages.length; idx += 1) {
      const message = messages[idx];
      if (message.role === 'user' && !subagentCompletionInfos[idx]) {
        currentSimpleGreeting = isSimpleGreetingMessage(message);
      }
      if (currentSimpleGreeting) {
        simpleIndexes.add(idx);
      }
    }

    return simpleIndexes;
  }, [messages, subagentCompletionInfos]);

  const messageRows = useMemo(
    () =>
      messages.map((msg, idx) => {
        const shouldShowThinking = showThinking && !simpleGreetingSegments.has(idx);

        return (
          <div
            key={msg.id || `msg-${idx}`}
            className="space-y-3"
            id={`chat-message-${idx}`}
            data-testid={`chat-message-${idx}`}
          >
            <ChatMessage
              message={msg}
              showThinking={shouldShowThinking}
              thinkingExpanded={thinkingExpanded}
              onToggleThinkingExpanded={toggleThinkingExpanded}
            />
          </div>
        );
      }),
    [messages, showThinking, simpleGreetingSegments, thinkingExpanded, toggleThinkingExpanded]
  );

  const activeUserMessage = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      if (messages[idx].role === 'user' && !subagentCompletionInfos[idx]) {
        return messages[idx];
      }
    }
    return undefined;
  }, [messages, subagentCompletionInfos]);
  const suppressActiveThinking = isSimpleGreetingMessage(activeUserMessage);

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden bg-[#f8f9fb] transition-colors duration-500'
      )}
      style={{ height: '100%' }}
    >
      {isEmpty ? (
        /* ── 新对话欢迎状态：可滚动主区域（专家欢迎文案较长时不溢出视口）+ 底部固定输入框 ── */
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <div className="flex min-h-full w-full flex-col items-center justify-center px-6 py-4 sm:py-6">
              {activeExpert ? (
                <ExpertWelcome onPromptClick={(prompt) => sendMessage(prompt)} />
              ) : (
                <WelcomeScreen />
              )}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4 pt-2">
            <ChatInput
              onSend={sendMessage}
              onStop={abortRun}
              disabled={!isGatewayRunning}
              sending={sending}
              isEmpty={isEmpty}
            />
          </div>
        </div>
      ) : (
        /* ── 正常对话状态：工具栏 + 消息列表 + 底部输入框 ── */
        <>
          {/* Toolbar */}
          <div className="relative z-10 flex shrink-0 items-center justify-end px-5 py-3">
            <ChatToolbar />
          </div>

          {/* Messages Area */}
          <div className="relative z-10 min-h-0 flex-1 overflow-hidden px-5 py-5">
            <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-4 lg:flex-row lg:items-stretch">
              <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                <div ref={contentRef} className="max-w-4xl space-y-4">
                  {messageRows}

                  {/* Streaming message */}
                  {streamState.shouldRenderStreaming && (
                    <ChatMessage
                      message={
                        (streamState.streamMsg
                          ? {
                              ...(streamState.streamMsg as Record<string, unknown>),
                              role: (typeof streamState.streamMsg.role === 'string'
                                ? streamState.streamMsg.role
                                : 'assistant') as RawMessage['role'],
                              content: streamState.streamMsg.content ?? streamState.streamText,
                              timestamp: streamState.streamMsg.timestamp,
                            }
                          : {
                              role: 'assistant',
                              content: streamState.streamText,
                            }) as RawMessage
                      }
                      showThinking={showThinking && !suppressActiveThinking}
                      thinkingExpanded={thinkingExpanded}
                      onToggleThinkingExpanded={toggleThinkingExpanded}
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
        </>
      )}

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] pointer-events-auto">
          <div className="rounded-full border border-border bg-background p-2.5 shadow-lg">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────
// 新对话欢迎区：展示品牌欢迎语和功能标语，位于居中布局内，紧跟输入框上方

function WelcomeScreen() {
  const { t } = useTranslation('chat');

  return (
    <div data-testid="chat-welcome-screen" className="mb-8 w-full max-w-2xl px-4 text-center">
      {/* 主欢迎标题 */}
      <h1 className="text-2xl font-semibold leading-snug text-[#20242d] md:text-[30px]">
        {t('welcome.greeting')}
      </h1>
      {/* 功能标语副标题 */}
      <p className="mt-2 text-sm font-medium tracking-[0.03em] text-[#a2a9b3]">{t('welcome.tagline')}</p>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/30 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-foreground">
        <div className="flex gap-1">
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  const { t } = useTranslation('chat');
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/30 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-foreground">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>{t('activity.toolProcessing')}</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
