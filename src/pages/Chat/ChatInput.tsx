/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowUp,
  Square,
  X,
  Paperclip,
  FileText,
  Film,
  Music,
  FileArchive,
  File,
  Loader2,
  ChevronDown,
  Bot,
  Check,
  Search,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useTemplatesStore } from '@/stores/templates';
import { useExpertsStore } from '@/stores/experts';
import { useSkillsStore } from '@/stores/skills';
import type { ExpertStatus } from '@/types/expert';
import type { Skill } from '@/types/skill';
import { useProviderStore } from '@/stores/providers';
import type { ProviderAccount, ProviderWithKeyInfo } from '@/lib/providers';
import { useTranslation } from 'react-i18next';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string; // disk path for gateway
  preview: string | null; // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
}

interface PickerItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  status?: ExpertStatus;
  category?: string;
  sessionKey: string;
  agentId: string;
  isExpert: boolean;
  isTemplate: boolean;
  expertId?: string;
  templateId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildSkillInjectedMessage(
  baseText: string,
  skill: Skill | null,
  hasAttachments: boolean
): string {
  if (!skill) return baseText;
  const userPrompt = baseText.trim();
  const fallbackPrompt = hasAttachments
    ? 'Please process the attached file(s).'
    : 'Please help with this task.';

  return [
    `<skill_context name="${skill.name}" id="${skill.id}">`,
    `Use this skill as the primary approach for this request.`,
    skill.description ? `Skill description: ${skill.description}` : null,
    `</skill_context>`,
    '',
    `<user_request>`,
    userPrompt || fallbackPrompt,
    `</user_request>`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
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

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return 'google-gemini-cli';
    if (account.vendorId === 'openai') return 'openai-codex';
  }
  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }
  if (account.vendorId === 'minimax-portal-cn') return 'minimax-portal';
  return account.vendorId;
}

function hasConfiguredProviderCredentials(
  account: ProviderAccount,
  statusById: Map<string, ProviderWithKeyInfo>
): boolean {
  if (
    account.authMode === 'oauth_device' ||
    account.authMode === 'oauth_browser' ||
    account.authMode === 'local'
  ) {
    return true;
  }
  return statusById.get(account.id)?.hasKey ?? false;
}

function formatModelLabel(modelRef: string): string {
  const separatorIndex = modelRef.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= modelRef.length - 1) return modelRef;
  return modelRef.slice(separatorIndex + 1);
}

function shouldOpenDropdownUpward(
  triggerEl: HTMLElement | null,
  estimatedPanelHeight = 220
): boolean {
  if (!triggerEl || typeof window === 'undefined') return true;
  const rect = triggerEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  if (spaceBelow >= estimatedPanelHeight) return false;
  if (spaceAbove >= estimatedPanelHeight) return true;
  return spaceAbove > spaceBelow;
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  sending = false,
  isEmpty = false,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [expertPickerOpen, setExpertPickerOpen] = useState(false);
  const [expertPickerUpward, setExpertPickerUpward] = useState(true);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillPickerUpward, setSkillPickerUpward] = useState(true);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerUpward, setModelPickerUpward] = useState(true);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [expertSearchQuery, setExpertSearchQuery] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expertPickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const agents = useAgentsStore((s) => s.agents);
  const updateAgentModel = useAgentsStore((s) => s.updateAgentModel);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const switchSession = useChatStore((s) => s.switchSession);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId]
  );
  const currentAgentName = currentAgent?.name ?? currentAgentId;
  const currentModelDisplay = currentAgent?.modelDisplay ?? null;
  const currentModelRef = useMemo(
    () =>
      (currentAgent?.overrideModelRef || currentAgent?.modelRef || defaultModelRef || '').trim(),
    [currentAgent?.modelRef, currentAgent?.overrideModelRef, defaultModelRef]
  );

  // Expert-centric data
  const expertRuntimes = useExpertsStore((s) => s.runtimes);
  const templates = useTemplatesStore((s) => s.templates);
  const setActiveTemplate = useTemplatesStore((s) => s.setActiveTemplate);
  const activeTemplate = useTemplatesStore((s) => s.activeTemplate);

  // Skill data
  const skills = useSkillsStore((s) => s.skills);
  const fetchSkills = useSkillsStore((s) => s.fetchSkills);
  const gatewayRunning = useGatewayStore((s) => s.status).state === 'running';

  const currentTemplateId = useMemo(() => {
    if (!currentSessionKey.includes(':tpl-')) return null;
    const match = currentSessionKey.match(/:tpl-(.+)$/);
    return match?.[1] ?? null;
  }, [currentSessionKey]);

  const templateSkill = useMemo<Skill | null>(() => {
    if (!currentTemplateId) return null;
    const tpl = templates.find((t) => t.id === currentTemplateId);
    if (!tpl?.requiredSkills?.length) return null;
    const skillId = tpl.requiredSkills[0];
    return skills.find((s) => s.id === skillId || s.slug === skillId || s.name === skillId) ?? null;
  }, [currentTemplateId, templates, skills]);

  const currentExpertRuntime = useMemo(() => {
    if (currentTemplateId) return null;
    return Object.values(expertRuntimes).find((r) => r.agentId === currentAgentId) ?? null;
  }, [expertRuntimes, currentAgentId, currentTemplateId]);

  const effectiveTargetLabel = useMemo(() => {
    if (currentTemplateId) {
      const tpl = templates.find((t) => t.id === currentTemplateId);
      if (tpl) return tpl.name;
    }
    if (currentExpertRuntime) return currentExpertRuntime.config.name;
    return currentAgentName;
  }, [currentTemplateId, templates, currentExpertRuntime, currentAgentName]);

  // Unified picker items: experts → their templates → non-expert agents
  const pickerItems = useMemo<PickerItem[]>(() => {
    const items: PickerItem[] = [];
    const allAgents = agents ?? [];

    // 1. Expert-backed items
    for (const runtime of Object.values(expertRuntimes)) {
      if (!runtime.agentId || !runtime.mainSessionKey) continue;
      const cfg = runtime.config;
      items.push({
        id: `expert:${cfg.id}`,
        label: cfg.name,
        description: cfg.description,
        icon: cfg.icon || cfg.name.charAt(0).toUpperCase(),
        status: runtime.status,
        category: cfg.category,
        sessionKey: runtime.mainSessionKey,
        agentId: runtime.agentId,
        isExpert: true,
        isTemplate: false,
        expertId: cfg.id,
      });

      // 2. Templates under this expert
      const expertAgent = allAgents.find((a) => a.expertId === cfg.id);
      if (expertAgent) {
        for (const tpl of templates) {
          items.push({
            id: `tpl:${tpl.id}`,
            label: tpl.name,
            description: tpl.description,
            icon: tpl.icon || cfg.icon || tpl.name.charAt(0).toUpperCase(),
            category: tpl.category,
            sessionKey: `agent:${expertAgent.id}:tpl-${tpl.id}`,
            agentId: expertAgent.id,
            isExpert: true,
            isTemplate: true,
            expertId: cfg.id,
            templateId: tpl.id,
          });
        }
      }
    }

    // 3. Non-expert agents
    for (const agent of allAgents) {
      if (agent.expertId && agent.id !== 'main') continue;
      items.push({
        id: `agent:${agent.id}`,
        label: agent.name,
        description: agent.modelDisplay || '',
        icon: agent.name?.trim()?.charAt(0)?.toUpperCase() || 'A',
        sessionKey: agent.mainSessionKey ?? `agent:${agent.id}:main`,
        agentId: agent.id,
        isExpert: false,
        isTemplate: false,
      });
    }

    return items;
  }, [agents, expertRuntimes, templates]);

  const filteredPickerItems = useMemo(() => {
    const query = expertSearchQuery.trim().toLowerCase();
    if (!query) return pickerItems;
    return pickerItems.filter((item) => {
      const searchable = [item.label, item.description, item.category, item.expertId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [expertSearchQuery, pickerItems]);
  const modelOptions = useMemo(() => {
    const statusById = new Map<string, ProviderWithKeyInfo>(
      providerStatuses.map((status) => [status.id, status])
    );
    const entries = providerAccounts
      .filter((account) => account.enabled && hasConfiguredProviderCredentials(account, statusById))
      .sort((left, right) => {
        if (left.id === providerDefaultAccountId) return -1;
        if (right.id === providerDefaultAccountId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });

    const options = new Map<string, { modelRef: string; label: string; description: string }>();
    for (const account of entries) {
      const runtimeProviderKey = resolveRuntimeProviderKey(account);
      const modelId = (account.model || '').trim();
      if (!runtimeProviderKey || !modelId) continue;
      const normalizedModelId = modelId.startsWith(`${runtimeProviderKey}/`)
        ? modelId.slice(runtimeProviderKey.length + 1)
        : modelId;
      if (!normalizedModelId) continue;
      const modelRef = `${runtimeProviderKey}/${normalizedModelId}`;
      if (!options.has(modelRef)) {
        options.set(modelRef, {
          modelRef,
          label: normalizedModelId,
          description: account.label,
        });
      }
    }

    return [...options.values()];
  }, [providerStatuses, providerAccounts, providerDefaultAccountId]);
  const filteredModelOptions = useMemo(() => {
    const query = modelSearchQuery.trim().toLowerCase();
    if (!query) return modelOptions;
    return modelOptions.filter((option) => {
      const searchable = [option.label, option.modelRef, option.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [modelSearchQuery, modelOptions]);

  const selectedSkill: Skill | null = useMemo(
    () => (skills ?? []).find((s) => s.id === selectedSkillId) ?? null,
    [skills, selectedSkillId]
  );

  const filteredSkills = useMemo(() => {
    const enabled = (skills ?? []).filter((s) => s.enabled);
    const query = skillSearchQuery.trim().toLowerCase();
    if (!query) return enabled;
    return enabled.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        (s.description || '').toLowerCase().includes(query) ||
        (s.slug || '').toLowerCase().includes(query)
    );
  }, [skills, skillSearchQuery]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus textarea on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  useEffect(() => {
    if (!expertPickerOpen && !skillPickerOpen && !modelPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const node = event.target as Node;
      if (!expertPickerRef.current?.contains(node)) setExpertPickerOpen(false);
      if (!skillPickerRef.current?.contains(node)) setSkillPickerOpen(false);
      if (!modelPickerRef.current?.contains(node)) setModelPickerOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [expertPickerOpen, skillPickerOpen, modelPickerOpen]);

  // Fetch skills when gateway is running
  useEffect(() => {
    if (gatewayRunning) void fetchSkills();
  }, [fetchSkills, gatewayRunning]);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  // ── File staging via native dialog ─────────────────────────────

  const pickFiles = useCallback(async () => {
    try {
      const result = (await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      })) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      // Add placeholder entries immediately
      const tempIds: string[] = [];
      for (const filePath of result.filePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        // Handle both Unix (/) and Windows (\) path separators
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        setAttachments((prev) => [
          ...prev,
          {
            id: tempId,
            fileName,
            mimeType: '',
            fileSize: 0,
            stagedPath: '',
            preview: null,
            status: 'staging' as const,
          },
        ]);
      }

      // Stage all files via IPC
      console.log('[pickFiles] Staging files:', result.filePaths);
      const staged = await hostApiFetch<
        Array<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>
      >('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({ filePaths: result.filePaths }),
      });
      console.log(
        '[pickFiles] Stage result:',
        staged?.map((s) => ({
          id: s?.id,
          fileName: s?.fileName,
          mimeType: s?.mimeType,
          fileSize: s?.fileSize,
          stagedPath: s?.stagedPath,
          hasPreview: !!s?.preview,
        }))
      );

      // Update each placeholder with real data
      setAttachments((prev) => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map((a) =>
              a.id === tempId ? { ...data, status: 'ready' as const } : a
            );
          } else {
            console.warn(`[pickFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map((a) =>
              a.id === tempId ? { ...a, status: 'error' as const, error: 'Staging failed' } : a
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[pickFiles] Failed to stage files:', err);
      // Mark any stuck 'staging' attachments as 'error' so the user can remove them
      // and the send button isn't permanently blocked
      setAttachments((prev) =>
        prev.map((a) =>
          a.status === 'staging' ? { ...a, status: 'error' as const, error: String(err) } : a
        )
      );
    }
  }, []);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        },
      ]);

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        console.log(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        const staged = await hostApiFetch<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>('/api/files/stage-buffer', {
          method: 'POST',
          body: JSON.stringify({
            base64,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
          }),
        });
        console.log(
          `[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`
        );
        setAttachments((prev) =>
          prev.map((a) => (a.id === tempId ? { ...staged, status: 'ready' as const } : a))
        );
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId ? { ...a, status: 'error' as const, error: String(err) } : a
          )
        );
      }
    }
  }, []);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every((a) => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = (input.trim() || attachments.length > 0) && allReady && !disabled && !sending;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    const textToSend = buildSkillInjectedMessage(
      input,
      selectedSkill ?? templateSkill,
      readyAttachments.length > 0
    );
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    console.log(
      `[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`
    );
    if (attachmentsToSend) {
      console.log(
        '[handleSend] Attachment details:',
        attachmentsToSend.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          stagedPath: a.stagedPath,
          status: a.status,
          hasPreview: !!a.preview,
        }))
      );
    }
    setInput('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, attachmentsToSend, null);
    setExpertPickerOpen(false);
    setSelectedSkillId(null);
  }, [input, attachments, canSend, onSend, selectedSkill]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [stageBufferFiles]
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [stageBufferFiles]
  );

  return (
    <div
      className={cn(
        'relative z-10 w-full mx-auto transition-all duration-300',
        isEmpty ? 'px-5 py-4' : 'px-4 py-3',
        isEmpty ? 'max-w-4xl' : 'max-w-4xl'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input Box - 卡片式竖向布局：文本框在上，工具栏在下 */}
        <div
          data-testid="chat-composer-shell"
          className={cn(
            'panel-elevated tech-border relative rounded-[20px] border-border transition-all',
            dragOver && 'border-primary ring-1 ring-primary shadow-[0_0_14px_hsl(var(--glow)/0.12)]'
          )}
        >
          {/* 顶部光效装饰线 */}
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

          {/* 文本输入区：rounded-none 消除 textarea 自带圆角对文字的裁切 */}
          <div className="px-4 pt-4 pb-1">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={
                disabled ? t('composer.gatewayDisconnectedPlaceholder') : t('composer.placeholder')
              }
              disabled={disabled}
              className="min-h-[48px] max-h-[200px] w-full resize-none rounded-none border-0 bg-transparent p-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
              rows={1}
            />
          </div>

          {/* 底部工具栏：左侧选择器与图标，右侧发送 */}
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
            {/* 左侧：专家 + 模型 + 附件 */}
            <div className="flex items-center gap-1 min-w-0">
              {/* 专家选择器按钮 */}
              <div ref={expertPickerRef} className="relative w-[150px] shrink-0">
                <Button
                  data-testid="chat-agent-picker-button"
                  variant="ghost"
                  className={cn(
                    'h-8 w-full gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-foreground transition-colors',
                    'border border-border/70 bg-muted shadow-sm hover:bg-muted/80',
                    expertPickerOpen &&
                      'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                  onClick={() => {
                    if (!expertPickerOpen) {
                      setExpertPickerUpward(shouldOpenDropdownUpward(expertPickerRef.current, 280));
                      setExpertSearchQuery('');
                    }
                    setExpertPickerOpen((open) => !open);
                  }}
                  disabled={disabled || sending}
                  title={t('composer.pickAgent')}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 text-[11px]">
                    {currentExpertRuntime?.config.icon || <Bot className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">{effectiveTargetLabel}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                </Button>
                {/* 专家下拉面板 */}
                {expertPickerOpen && (
                  <div
                    className={cn(
                      'absolute left-0 z-20 w-full min-w-[200px] overflow-hidden rounded-xl panel-elevated border border-border/70 p-1 shadow-xl',
                      expertPickerUpward ? 'bottom-full mb-2' : 'top-full mt-2'
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setExpertPickerOpen(false);
                        textareaRef.current?.focus();
                      }
                    }}
                  >
                    <div className="relative mb-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={expertSearchQuery}
                        onChange={(e) => setExpertSearchQuery(e.target.value)}
                        placeholder={t('composer.searchExpert')}
                        className="h-8 w-full rounded-lg border border-border/70 bg-background/70 pl-8 pr-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/70"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {(() => {
                        const expertItems = filteredPickerItems.filter(
                          (i) => i.isExpert && !i.isTemplate
                        );
                        const templateItems = filteredPickerItems.filter((i) => i.isTemplate);
                        const otherItems = filteredPickerItems.filter((i) => !i.isExpert);

                        return (
                          <>
                            {expertItems.map((item) => (
                              <ExpertPickerItem
                                key={item.id}
                                item={item}
                                selected={!currentTemplateId && currentAgentId === item.agentId}
                                onSelect={() => {
                                  if (activeTemplate) setActiveTemplate(null);
                                  if (item.sessionKey && item.agentId !== currentAgentId) {
                                    switchSession(item.sessionKey);
                                  }
                                  setExpertPickerOpen(false);
                                  textareaRef.current?.focus();
                                }}
                              />
                            ))}
                            {templateItems.length > 0 && (
                              <div className="ml-3 mt-0.5 border-l border-border/50 pl-1">
                                {templateItems.map((item) => (
                                  <ExpertPickerItem
                                    key={item.id}
                                    item={item}
                                    selected={currentTemplateId === item.templateId}
                                    onSelect={() => {
                                      const tpl = templates.find((t) => t.id === item.templateId);
                                      if (tpl && item.sessionKey) {
                                        setActiveTemplate(tpl);
                                        switchSession(item.sessionKey);
                                      }
                                      setExpertPickerOpen(false);
                                      textareaRef.current?.focus();
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                            {otherItems.length > 0 &&
                              (expertItems.length > 0 || templateItems.length > 0) && (
                                <div className="my-1 border-t border-border/50" />
                              )}
                            {otherItems.length > 0 && (
                              <>
                                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                                  {t('composer.otherAgents')}
                                </div>
                                {otherItems.map((item) => (
                                  <ExpertPickerItem
                                    key={item.id}
                                    item={item}
                                    selected={!currentTemplateId && currentAgentId === item.agentId}
                                    onSelect={() => {
                                      if (activeTemplate) setActiveTemplate(null);
                                      if (item.sessionKey && item.agentId !== currentAgentId) {
                                        switchSession(item.sessionKey);
                                      }
                                      setExpertPickerOpen(false);
                                      textareaRef.current?.focus();
                                    }}
                                  />
                                ))}
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* 模型选择器 */}
              {(currentModelDisplay || currentModelRef || modelOptions.length > 0) && (
                <div ref={modelPickerRef} className="relative w-[150px] shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      'h-8 w-full gap-1.5 rounded-sm px-2.5 text-[11px] font-medium text-foreground',
                      'border border-border/70 bg-muted shadow-sm hover:bg-muted/80',
                      modelPickerOpen &&
                        'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                    )}
                    disabled={disabled || sending || switchingModel || modelOptions.length === 0}
                    onClick={() => {
                      if (!modelPickerOpen) {
                        setModelPickerUpward(shouldOpenDropdownUpward(modelPickerRef.current, 220));
                        setModelSearchQuery('');
                      }
                      setModelPickerOpen((open) => !open);
                    }}
                    title={t('composer.selectModel')}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {currentModelDisplay || formatModelLabel(currentModelRef) || 'Model'}
                    </span>
                    {switchingModel ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-60" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                    )}
                  </Button>
                  {modelPickerOpen && (
                    <div
                      className={cn(
                        'absolute left-0 z-20 w-full min-w-full overflow-hidden rounded-xl panel-elevated border border-border/70 p-1 shadow-xl',
                        modelPickerUpward ? 'bottom-full mb-2' : 'top-full mt-2'
                      )}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setModelPickerOpen(false);
                          textareaRef.current?.focus();
                        }
                      }}
                    >
                      <div className="relative mb-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={modelSearchQuery}
                          onChange={(e) => setModelSearchQuery(e.target.value)}
                          placeholder={t('composer.searchModel')}
                          className="h-8 w-full rounded-lg border border-border/70 bg-background/70 pl-8 pr-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/70"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {filteredModelOptions.map((option) => {
                          const selected = option.modelRef === currentModelRef;
                          return (
                            <button
                              key={option.modelRef}
                              type="button"
                              className={cn(
                                'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                                selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                              )}
                              onClick={async () => {
                                if (switchingModel || selected) {
                                  setModelPickerOpen(false);
                                  return;
                                }
                                setSwitchingModel(true);
                                try {
                                  const normalizedDefaultModelRef = (defaultModelRef || '').trim();
                                  await updateAgentModel(
                                    currentAgentId,
                                    normalizedDefaultModelRef &&
                                      option.modelRef === normalizedDefaultModelRef
                                      ? null
                                      : option.modelRef
                                  );
                                } finally {
                                  setSwitchingModel(false);
                                  setModelPickerOpen(false);
                                }
                              }}
                            >
                              <span className="min-w-0">
                                <span
                                  className={cn(
                                    'block truncate text-[11px] font-medium',
                                    selected ? 'text-primary-foreground' : 'text-foreground'
                                  )}
                                >
                                  {option.label}
                                </span>
                                <span
                                  className={cn(
                                    'block truncate text-[11px]',
                                    selected
                                      ? 'text-primary-foreground/75'
                                      : 'text-muted-foreground'
                                  )}
                                >
                                  {option.description}
                                </span>
                              </span>
                              <Check
                                className={cn(
                                  'h-4 w-4 shrink-0',
                                  selected ? 'opacity-100 text-primary-foreground' : 'opacity-0'
                                )}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Skill 选择器 */}
              <div ref={skillPickerRef} className="relative shrink-0">
                <Button
                  data-testid="chat-skill-picker-button"
                  variant="ghost"
                  className={cn(
                    'h-8 gap-1.5 rounded-sm px-2.5 text-[11px] font-medium transition-colors',
                    'border border-border/70 bg-muted shadow-sm hover:bg-muted/80',
                    selectedSkill &&
                      'border-primary bg-primary/10 text-primary hover:bg-primary/15',
                    skillPickerOpen &&
                      'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                  onClick={() => {
                    if (!skillPickerOpen) {
                      setSkillPickerUpward(shouldOpenDropdownUpward(skillPickerRef.current, 280));
                      setSkillSearchQuery('');
                    }
                    setSkillPickerOpen((open) => !open);
                  }}
                  disabled={disabled || sending}
                  title={t('composer.selectSkill')}
                >
                  <Wand2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[80px] truncate">
                    {selectedSkill ? selectedSkill.name : t('composer.skill')}
                  </span>
                  {selectedSkill && (
                    <X
                      className="h-3 w-3 shrink-0 opacity-60 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSkillId(null);
                      }}
                    />
                  )}
                </Button>
                {/* Skill 下拉面板 */}
                {skillPickerOpen && (
                  <div
                    className={cn(
                      'absolute left-0 z-20 w-56 overflow-hidden rounded-xl panel-elevated border border-border/70 p-1 shadow-xl',
                      skillPickerUpward ? 'bottom-full mb-2' : 'top-full mt-2'
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setSkillPickerOpen(false);
                        textareaRef.current?.focus();
                      }
                    }}
                  >
                    <div className="relative mb-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={skillSearchQuery}
                        onChange={(e) => setSkillSearchQuery(e.target.value)}
                        placeholder={t('composer.searchSkill')}
                        className="h-8 w-full rounded-lg border border-border/70 bg-background/70 pl-8 pr-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/70"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {filteredSkills.length === 0 ? (
                        <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                          {t('composer.noSkills')}
                        </div>
                      ) : (
                        filteredSkills.map((skill) => {
                          const isSelected = skill.id === selectedSkillId;
                          return (
                            <button
                              key={skill.id}
                              type="button"
                              className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                                isSelected
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-accent'
                              )}
                              onClick={() => {
                                setSelectedSkillId(isSelected ? null : skill.id);
                                setSkillPickerOpen(false);
                                setSkillSearchQuery('');
                                textareaRef.current?.focus();
                              }}
                            >
                              <span className="shrink-0 text-sm">
                                {skill.icon || <Wand2 className="h-3.5 w-3.5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span
                                  className={cn(
                                    'block truncate text-[11px] font-medium',
                                    isSelected ? 'text-primary-foreground' : 'text-foreground'
                                  )}
                                >
                                  {skill.name}
                                </span>
                                <span
                                  className={cn(
                                    'block truncate text-[11px]',
                                    isSelected
                                      ? 'text-primary-foreground/75'
                                      : 'text-muted-foreground'
                                  )}
                                >
                                  {skill.description}
                                </span>
                              </span>
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-primary-foreground" />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 附件按钮 */}
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-8 w-8 rounded-full text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
                onClick={pickFiles}
                disabled={disabled || sending}
                title={t('composer.attachFiles')}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* 右侧：发送按钮 */}
            <div className="flex shrink-0 items-center gap-2">
              {/* 发送 / 停止按钮：始终显示主色填充圆，无输入时降低透明度 */}
              <Button
                onClick={sending ? handleStop : handleSend}
                disabled={sending ? !canStop : !canSend}
                size="icon"
                className={cn(
                  'shrink-0 h-9 w-9 rounded-full transition-all bg-primary text-primary-foreground',
                  sending || canSend
                    ? 'shadow-[0_0_10px_hsl(var(--glow)/0.20)] hover:brightness-110'
                    : 'opacity-40'
                )}
                variant="ghost"
                title={sending ? t('composer.stop') : t('composer.send')}
              >
                {sending ? (
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                ) : (
                  <ArrowUp className="h-[16px] w-[16px]" strokeWidth={2.5} />
                )}
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 px-4 text-[11px] text-muted-foreground/60">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                gatewayStatus.state === 'running'
                  ? 'bg-green-500/80 shadow-[0_0_10px_rgba(34,197,94,0.6)]'
                  : 'bg-red-500/80'
              )}
            />
            <span>
              {gatewayStatus.state === 'running'
                ? t('composer.gatewayConnected')
                : gatewayStatus.state}
            </span>
          </div>
          {hasFailedAttachments && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-[11px]"
              onClick={() => {
                setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                void pickFiles();
              }}
            >
              {t('composer.retryFailedAttachments')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-background/60">
      {isImage ? (
        // Image thumbnail
        <div className="w-16 h-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        // Generic file card
        <div className="flex max-w-[200px] items-center gap-2 bg-muted/30 px-3 py-2">
          <FileIcon
            mimeType={attachment.mimeType}
            className="h-5 w-5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-[11px] text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-[11px] text-destructive font-medium px-1">Error</span>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-30 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function ExpertPickerItem({
  item,
  selected,
  onSelect,
}: {
  item: PickerItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const statusColor: Record<string, string> = {
    ready: 'bg-green-500',
    'setting-up': 'bg-yellow-500 animate-pulse',
    limited: 'bg-orange-500',
    unavailable: 'bg-red-500',
  };

  return (
    <button
      type="button"
      data-testid={`chat-expert-option-${item.id}`}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      )}
    >
      <div className="min-w-0 flex items-center gap-2">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
            selected
              ? 'bg-white/20 text-primary-foreground'
              : 'bg-black/5 text-foreground dark:bg-white/10'
          )}
        >
          {item.icon}
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              'flex items-center gap-1.5 truncate text-[11px] font-medium',
              selected ? 'text-primary-foreground' : 'text-foreground'
            )}
          >
            {item.label}
            {item.isExpert && item.status && (
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  statusColor[item.status] ?? statusColor.ready
                )}
              />
            )}
          </span>
          <span
            className={cn(
              'block truncate text-[11px]',
              selected ? 'text-primary-foreground/75' : 'text-muted-foreground'
            )}
          >
            {item.description}
          </span>
        </span>
      </div>
      <Check
        className={cn(
          'h-4 w-4 shrink-0',
          selected ? 'opacity-100 text-primary-foreground' : 'opacity-0'
        )}
      />
    </button>
  );
}
