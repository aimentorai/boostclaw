/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Wrench,
  FileText,
  Film,
  Music,
  FileArchive,
  File,
  X,
  FolderOpen,
  ZoomIn,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import {
  extractText,
  extractThinking,
  extractImages,
  extractToolUse,
  formatTimestamp,
  type TimestampFormatter,
} from './message-utils';
import { TaskProgressText } from './TaskProgressText';
import { formatReadableText, parseTaskProgressText } from './text-formatting';
import {
  filePathToHostedMediaSrc,
  getVideoAspectRatio,
  mediaLabel,
  revealVideoPreviewFrame,
} from './media-preview';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  suppressToolCards?: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}

interface ExtractedImage {
  url?: string;
  data?: string;
  mimeType: string;
}

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  suppressToolCards = false,
  isStreaming = false,
  streamingTools = [],
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const thinking = extractThinking(message);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const visibleThinking = showThinking ? thinking : null;
  const visibleTools = suppressToolCards ? [] : tools;

  const attachedFiles = message._attachedFiles || [];
  const [lightboxImg, setLightboxImg] = useState<{
    src: string;
    fileName: string;
    filePath?: string;
    base64?: string;
    mimeType?: string;
  } | null>(null);

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  if (
    !hasText &&
    !visibleThinking &&
    images.length === 0 &&
    visibleTools.length === 0 &&
    attachedFiles.length === 0 &&
    !hasStreamingToolStatus
  )
    return null;

  return (
    <div className={cn('flex gap-3 group', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && <div className="mt-1 h-8 w-8 shrink-0" aria-hidden="true" />}

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 max-w-[80%] space-y-2',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {/* Thinking section */}
        {visibleThinking && <ThinkingBlock content={visibleThinking} />}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() =>
                    setLightboxImg({
                      src,
                      fileName: 'image',
                      base64: img.data,
                      mimeType: img.mimeType,
                    })
                  }
                />
              );
            })}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              const isVideo = file.mimeType.startsWith('video/');
              // Skip image attachments if we already have images from content blocks
              if (isImage && images.length > 0) return null;
              if (isImage) {
                return file.preview ? (
                  <ImageThumbnail
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() =>
                      setLightboxImg({
                        src: file.preview!,
                        fileName: file.fileName,
                        filePath: file.filePath,
                        mimeType: file.mimeType,
                      })
                    }
                  />
                ) : (
                  <div
                    key={`local-${i}`}
                    className="w-36 h-36 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex items-center justify-center text-muted-foreground"
                  >
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              if (isVideo) {
                return <VideoPreviewCard key={`local-${i}`} file={file} compact />;
              }
              // Non-image files → file card
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && <MessageBubble text={text} isUser={isUser} isStreaming={isStreaming} />}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() =>
                    setLightboxImg({
                      src,
                      fileName: 'image',
                      base64: img.data,
                      mimeType: img.mimeType,
                    })
                  }
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              const isVideo = file.mimeType.startsWith('video/');
              if (isImage && images.length > 0) return null;
              if (isImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() =>
                      setLightboxImg({
                        src: file.preview!,
                        fileName: file.fileName,
                        filePath: file.filePath,
                        mimeType: file.mimeType,
                      })
                    }
                  />
                );
              }
              if (isImage && !file.preview) {
                return (
                  <div
                    key={`local-${i}`}
                    className="w-36 h-36 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex items-center justify-center text-muted-foreground"
                  >
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              if (isVideo) {
                return <VideoPreviewCard key={`local-${i}`} file={file} />;
              }
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Hover row for user messages */}
        {isUser && hasText && (
          <MessageHoverBar text={text} timestamp={message.timestamp} role="user" />
        )}

        {/* Hover row for assistant messages — only when there is real text content */}
        {!isUser && hasText && (
          <MessageHoverBar text={text} timestamp={message.timestamp} role="assistant" />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full space-y-1">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            className={cn(
              'flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs transition-colors',
              isRunning && 'border-primary/30 bg-primary/8 text-foreground',
              !isRunning && !isError && 'border-border/50 bg-muted/20 text-muted-foreground',
              isError && 'border-destructive/30 bg-destructive/5 text-destructive'
            )}
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
            {!isRunning && !isError && (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            )}
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-[12px] font-medium">{tool.name}</span>
            {duration && (
              <span className="text-[11px] opacity-60">
                {tool.summary ? `(${duration})` : duration}
              </span>
            )}
            {tool.summary && (
              <span className="truncate text-[11px] opacity-70">{tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Message hover bar (timestamp + copy) ─

function MessageHoverBar({
  text,
  timestamp,
  role,
}: {
  text: string;
  timestamp?: number;
  role: 'user' | 'assistant';
}) {
  const { t: tCommon } = useTranslation('common');
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div className="flex w-full select-none items-center justify-between px-1 opacity-100">
      <span className="text-xs text-muted-foreground">
        {timestamp ? formatTimestamp(timestamp, t as TimestampFormatter) : ''}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-7 w-7 rounded-full border shadow-sm transition-colors',
          copied
            ? 'border-green-500/20 bg-green-500/8 text-green-600 hover:bg-green-500/12'
            : 'border-[#edf0f5] bg-white/70 text-[#9aa2ae] hover:bg-white hover:text-[#5f6875]'
        )}
        onClick={copyContent}
        title={tCommon('actions.copy')}
        aria-label={tCommon('actions.copy')}
        data-testid={`${role}-copy-button`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

// ── Streaming Text Renderer ────────────────────────────────────
// Lightweight text display for streaming — avoids O(n²) ReactMarkdown
// parsing on every delta. Supports fenced code blocks, inline code,
// bold, italic, and headings via cheap regex splits. Full markdown
// renders only after streaming completes.

/** Apply lightweight inline formatting (bold, italic, inline code) to a text span. */
function formatInlineSegments(text: string): React.ReactNode[] {
  // Single pass: split on inline patterns
  // Order matters: `code` first (greedy), then **bold**, then *italic*
  const inlineRe = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;
  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    if (match[1]) {
      // Inline code: `code`
      nodes.push(
        <code
          key={`ic-${keyIdx++}`}
          className="rounded bg-background/50 px-1 py-0.5 text-sm font-mono"
        >
          {match[1].slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      // Bold: **text**
      nodes.push(<strong key={`b-${keyIdx++}`}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      // Italic: *text*
      nodes.push(<em key={`i-${keyIdx++}`}>{match[3].slice(1, -1)}</em>);
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }
  return nodes.length > 0 ? nodes : [text];
}

/** Apply lightweight heading rendering to line-based text. */
function formatTextBlock(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  return lines.map((line, i) => {
    const key = `l-${i}`;
    // Heading detection: ### text, ## text, # text
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const sizeClass =
        level === 1
          ? 'text-lg font-bold'
          : level === 2
            ? 'text-base font-semibold'
            : 'text-sm font-semibold';
      return (
        <div key={key} className={`${sizeClass} mt-3 mb-1`}>
          {formatInlineSegments(headingText)}
        </div>
      );
    }
    // Regular line with inline formatting
    return (
      <span key={key}>
        {i > 0 && '\n'}
        {formatInlineSegments(line)}
      </span>
    );
  });
}

const StreamingText = memo(function StreamingText({ text }: { text: string }) {
  const displayText = useMemo(() => formatReadableText(text), [text]);
  const parts = useMemo(() => {
    // Fast-path: no backticks at all → text with inline formatting
    if (!displayText.includes('```')) {
      return [
        <span key="t" className="whitespace-pre-wrap break-words text-sm">
          {formatTextBlock(displayText)}
        </span>,
      ];
    }

    // Split on fenced code blocks
    const segments: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
    let lastIndex = 0;
    const re = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    while ((match = re.exec(displayText)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: displayText.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'code', content: match[2], lang: match[1] || undefined });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < displayText.length) {
      const remaining = displayText.slice(lastIndex);
      const openBlock = remaining.match(/^```(\w*)\n([\s\S]*)$/);
      if (openBlock) {
        segments.push({ type: 'code', content: openBlock[2], lang: openBlock[1] || undefined });
      } else {
        segments.push({ type: 'text', content: remaining });
      }
    }

    return segments.map((seg, i) => {
      if (seg.type === 'code') {
        return (
          <pre
            key={`c-${i}`}
            className="overflow-x-auto rounded-xl border border-border/60 bg-background/50 p-4 my-2"
          >
            <code className="text-sm font-mono">{seg.content}</code>
          </pre>
        );
      }
      return (
        <span key={`t-${i}`} className="whitespace-pre-wrap break-words text-sm">
          {formatTextBlock(seg.content)}
        </span>
      );
    });
  }, [displayText]);

  return <>{parts}</>;
});

// ── Markdown Components (shared config) ────────────────────────

const markdownComponents = {
  code({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & { className?: string }) {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match && !className;
    if (isInline) {
      return (
        <code
          className="rounded bg-background/50 px-1.5 py-0.5 text-sm font-mono break-all break-words"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background/50 p-4">
        <code className={cn('text-sm font-mono', className)} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  a({
    href,
    children,
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline break-words break-all"
      >
        {children}
      </a>
    );
  },
};

// ── Message Bubble ──────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  text,
  isUser,
  isStreaming,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
}) {
  const { t } = useTranslation('chat');
  const displayText = useMemo(() => (isUser ? text : formatReadableText(text)), [isUser, text]);
  const taskProgress = useMemo(
    () => (!isUser && !isStreaming ? parseTaskProgressText(text) : null),
    [isStreaming, isUser, text]
  );
  const markdownContent = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {displayText}
      </ReactMarkdown>
    ),
    [displayText]
  );

  return (
    <div
      className={cn(
        'relative rounded-[22px] px-4 py-3',
        !isUser && 'w-full',
        isUser
          ? 'bg-primary text-primary-foreground shadow-[0_0_10px_hsl(var(--glow)/0.1)]'
          : 'bg-primary/8 text-foreground'
      )}
    >
      {isUser ? (
        <p
          className="whitespace-pre-wrap break-words break-all text-sm selection:bg-white/35 selection:text-primary-foreground"
          data-testid="user-message-text"
        >
          {text}
        </p>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none break-words break-all">
          {taskProgress ? (
            <TaskProgressText progress={taskProgress} title={t('taskProgress.processing')} />
          ) : isStreaming ? (
            <StreamingText text={displayText} />
          ) : (
            markdownContent
          )}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/50" />
          )}
        </div>
      )}
    </div>
  );
});

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const displayContent = useMemo(() => formatReadableText(content), [content]);
  const taskProgress = useMemo(() => parseTaskProgressText(content), [content]);

  return (
    <div className="w-full rounded-2xl border border-border/70 bg-white/[0.04] text-[14px]">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="font-medium">{t('message.thinking')}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-muted-foreground">
          <div className="prose prose-sm dark:prose-invert max-w-none opacity-75">
            {taskProgress ? (
              <TaskProgressText progress={taskProgress} title={t('taskProgress.processing')} />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  )
    return <FileText className={className} />;
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('archive') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z')
  )
    return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

function FileCard({ file }: { file: AttachedFileMeta }) {
  const { t } = useTranslation('chat');
  const handleOpen = useCallback(() => {
    if (file.filePath) {
      invokeIpc('shell:openPath', file.filePath);
    }
  }, [file.filePath]);

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-black/10 dark:border-white/10 px-3 py-2.5 bg-black/5 dark:bg-white/5 max-w-[220px]',
        file.filePath && 'cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors'
      )}
      onClick={handleOpen}
      title={file.filePath ? t('message.openFile') : undefined}
    >
      <FileIcon mimeType={file.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : t('message.file')}
        </p>
      </div>
    </div>
  );
}

function VideoPreviewCard({
  file,
  compact = false,
}: {
  file: AttachedFileMeta;
  compact?: boolean;
}) {
  const { t } = useTranslation('chat');
  const [src, setSrc] = useState<string | null>(file.preview);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    file.preview ? 'ready' : 'loading'
  );
  const [aspectRatio, setAspectRatio] = useState<string>('16 / 9');

  useEffect(() => {
    let cancelled = false;
    if (file.preview) {
      return () => {
        cancelled = true;
      };
    }

    void filePathToHostedMediaSrc(file.filePath, file.mimeType).then((nextSrc) => {
      if (cancelled) return;
      setSrc(nextSrc);
      setLoadState(nextSrc ? 'loading' : 'error');
    }).catch((error) => {
      console.warn('[VideoPreviewCard] Failed to build video src', {
        fileName: file.fileName,
        filePath: file.filePath,
        mimeType: file.mimeType,
        error,
      });
      if (!cancelled) {
        setSrc(null);
        setLoadState('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [file.fileName, file.filePath, file.mimeType, file.preview]);

  const handleOpen = useCallback(() => {
    if (file.filePath) {
      invokeIpc('shell:openPath', file.filePath);
    }
  }, [file.filePath]);

  if (!src) {
    return <FileCard file={file} />;
  }

  return (
    <div
      data-testid="chat-video-preview"
      className={cn(
        'relative overflow-hidden rounded-xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5',
        compact ? 'w-64 max-w-full' : 'w-[min(28rem,100%)]'
      )}
    >
      <video
        src={src}
        controls
        preload="auto"
        onLoadedMetadata={(event) => {
          setAspectRatio(getVideoAspectRatio(event.currentTarget) || '16 / 9');
          setLoadState('ready');
          console.info('[VideoPreviewCard] loaded video metadata', {
            fileName: file.fileName,
            filePath: file.filePath,
            mimeType: file.mimeType,
            duration: event.currentTarget.duration,
            videoWidth: event.currentTarget.videoWidth,
            videoHeight: event.currentTarget.videoHeight,
            src: event.currentTarget.currentSrc || event.currentTarget.src,
          });
          revealVideoPreviewFrame(event.currentTarget);
        }}
        onError={(event) => {
          setLoadState('error');
          const mediaError = event.currentTarget.error;
          console.warn('[VideoPreviewCard] video failed to load', {
            fileName: file.fileName,
            filePath: file.filePath,
            mimeType: file.mimeType,
            code: mediaError?.code,
            message: mediaError?.message,
            networkState: event.currentTarget.networkState,
            readyState: event.currentTarget.readyState,
            src: event.currentTarget.currentSrc || event.currentTarget.src,
          });
        }}
        style={{ aspectRatio }}
        className="block w-full min-h-32 max-h-[70vh] bg-black object-contain"
        title={file.fileName}
      />
      {loadState !== 'ready' && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex min-h-32 items-center justify-center bg-black/70 px-3 text-center text-[11px] text-white/70"
          style={{ aspectRatio }}
        >
          {loadState === 'error' ? t('message.videoPreviewUnavailable') : t('message.loadingVideoPreview')}
        </div>
      )}
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
          file.filePath && 'hover:bg-black/10 dark:hover:bg-white/10'
        )}
        onClick={handleOpen}
        disabled={!file.filePath}
        title={file.filePath ? t('message.openFile') : undefined}
      >
        <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{mediaLabel(file.fileName, file.fileSize, formatFileSize)}</span>
      </button>
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath;
  void base64;
  void mimeType;
  return (
    <div
      className="relative w-36 h-36 rounded-xl border overflow-hidden border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath;
  void base64;
  void mimeType;
  return (
    <div
      className="relative max-w-xs rounded-xl border overflow-hidden border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 group/img cursor-zoom-in"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  void src;
  void base64;
  void mimeType;
  void fileName;
  const { t } = useTranslation('common');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      invokeIpc('shell:showItemInFolder', filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title={t('actions.showInFolder')}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-[14px]">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <Wrench className="h-3 w-3 shrink-0 opacity-60" />
        <span className="font-mono text-xs">{name}</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>
      {expanded && input != null && (
        <pre className="px-3 pb-2 text-xs text-muted-foreground overflow-x-auto">
          {typeof input === 'string' ? input : (JSON.stringify(input, null, 2) as string)}
        </pre>
      )}
    </div>
  );
}
