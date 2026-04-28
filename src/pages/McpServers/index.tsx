/**
 * MCP Servers Page
 * Manage Model Context Protocol server configurations.
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, AlertCircle, Server, ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

// ── Types ─────────────────────────────────────────────────────────────

type McpServerTransport = 'stdio' | 'sse' | 'streamable-http';

interface McpServerSummary {
  name: string;
  transport: McpServerTransport;
  enabled: boolean;
  subscription: boolean;
  configured: boolean;
  preview: string;
}

interface McpServerEntry {
  name: string;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  subscription?: boolean;
}

interface McpServerListResponse {
  success: boolean;
  servers: McpServerSummary[];
  error?: string;
}

interface McpServerSaveResponse {
  success: boolean;
  server?: McpServerSummary;
  error?: string;
}

interface McpServerGetResponse {
  success: boolean;
  server?: McpServerEntry;
  error?: string;
}

// ── Key-Value list editor ──────────────────────────────────────────────

interface KvPair {
  key: string;
  value: string;
}

function KvEditor({
  items,
  onChange,
  keyLabel,
  valueLabel,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  items: KvPair[];
  onChange: (items: KvPair[]) => void;
  keyLabel: string;
  valueLabel: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}) {
  const handleAdd = () => {
    onChange([...items, { key: '', value: '' }]);
  };

  const handleRemove = (index: number) => {
    const next = [...items];
    next.splice(index, 1);
    onChange(next);
  };

  const handleChange = (index: number, field: 'key' | 'value', val: string) => {
    const next = items.map((item, i) =>
      i === index ? { ...item, [field]: val } : item
    );
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex gap-2 items-center">
          <Input
            value={item.key}
            onChange={(e) => handleChange(index, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1 h-9 font-mono text-xs rounded-lg border-black/10 dark:border-white/10"
          />
          <Input
            value={item.value}
            onChange={(e) => handleChange(index, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            className="flex-1 h-9 font-mono text-xs rounded-lg border-black/10 dark:border-white/10"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-lg"
            onClick={() => handleRemove(index)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={handleAdd}
        className="h-7 text-[11px] rounded-lg border-dashed border-black/10 dark:border-white/10 text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3 w-3 mr-1" /> {addLabel}
      </Button>
    </div>
  );
}

// ── Transport Badge ────────────────────────────────────────────────────

const transportLabels: Record<McpServerTransport, string> = {
  stdio: 'STDIO',
  sse: 'SSE',
  'streamable-http': 'HTTP',
};

const transportColors: Record<McpServerTransport, string> = {
  stdio: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
  sse: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  'streamable-http': 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
};

function TransportBadge({ transport }: { transport: McpServerTransport }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold font-mono',
        transportColors[transport] || transportColors.stdio
      )}
    >
      {transportLabels[transport] || transport}
    </span>
  );
}

// ── Empty State ────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation('mcp');
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 mb-5">
        <Server className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-[16px] font-semibold text-foreground mb-2">
        {t('noServers')}
      </h3>
      <p className="text-[13px] text-muted-foreground max-w-sm mb-6 leading-relaxed">
        {t('noServersHint')}
      </p>
      <Button
        onClick={onAdd}
        className="h-9 px-5 text-[13px] font-medium rounded-full bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm"
      >
        <Plus className="h-4 w-4 mr-1.5" />
        {t('addFirst')}
      </Button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export function McpServers() {
  const { t } = useTranslation('mcp');
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerEntry | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formTransport, setFormTransport] = useState<McpServerTransport>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState<string[]>([]);
  const [formEnv, setFormEnv] = useState<KvPair[]>([]);
  const [formUrl, setFormUrl] = useState('');
  const [formHeaders, setFormHeaders] = useState<KvPair[]>([]);
  const [formEnabled, setFormEnabled] = useState(true);
  const [isSubscriptionEdit, setIsSubscriptionEdit] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<McpServerSummary | null>(null);

  // ── Fetch servers ────────────────────────────────────────────────
  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await hostApiFetch<McpServerListResponse>('/api/mcp/servers');
      if (result.success) {
        setServers(result.servers || []);
      } else {
        setError(result.error || t('loadFailed'));
      }
    } catch (err) {
      setError(String(err) || t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  // ── Open add sheet ───────────────────────────────────────────────
  const handleOpenAdd = () => {
    setEditingServer(null);
    setFormName('');
    setFormTransport('stdio');
    setFormCommand('');
    setFormArgs([]);
    setFormEnv([]);
    setFormUrl('');
    setFormHeaders([]);
    setFormEnabled(true);
    setIsSubscriptionEdit(false);
    setSheetOpen(true);
  };

  // ── Open edit sheet ─────────────────────────────────────────────
  const handleOpenEdit = useCallback(async (name: string) => {
    try {
      const result = await hostApiFetch<McpServerGetResponse>(`/api/mcp/servers/${encodeURIComponent(name)}`);
      if (result.success && result.server) {
        const s = result.server;
        setEditingServer(s);
        setFormName(s.name);
        setFormTransport(s.transport);
        setFormCommand(s.command || '');
        setFormArgs(s.args || []);
        setFormEnv(
          s.env
            ? Object.entries(s.env).map(([key, value]) => ({ key, value }))
            : []
        );
        setFormUrl(s.url || '');
        setFormHeaders(
          s.headers
            ? Object.entries(s.headers).map(([key, value]) => ({ key, value }))
            : []
        );
        setFormEnabled(s.enabled !== false);
        setIsSubscriptionEdit(s.subscription === true);
        setSheetOpen(true);
      } else {
        toast.error(result.error || t('loadFailed'));
      }
    } catch (err) {
      toast.error(String(err) || t('loadFailed'));
    }
  }, [t]);

  // ── Save (add or update) ────────────────────────────────────────
  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error(t('validationNameRequired'));
      return;
    }
    if (formTransport === 'stdio' && !formCommand.trim()) {
      toast.error(t('validationCommandRequired'));
      return;
    }
    if (formTransport !== 'stdio' && !formUrl.trim()) {
      toast.error(t('validationUrlRequired'));
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        transport: formTransport,
        enabled: formEnabled,
      };

      if (formTransport === 'stdio') {
        body.command = formCommand.trim();
        if (formArgs.length > 0) body.args = formArgs.filter(Boolean);
        const envObj: Record<string, string> = {};
        for (const kv of formEnv) {
          if (kv.key.trim()) envObj[kv.key.trim()] = kv.value;
        }
        if (Object.keys(envObj).length > 0) body.env = envObj;
      } else {
        body.url = formUrl.trim();
        const headersObj: Record<string, string> = {};
        for (const kv of formHeaders) {
          if (kv.key.trim()) headersObj[kv.key.trim()] = kv.value;
        }
        if (Object.keys(headersObj).length > 0) body.headers = headersObj;
      }

      const isUpdate = !!editingServer;
      if (!isUpdate) {
        body.name = formName.trim();
      }

      const path = isUpdate
        ? `/api/mcp/servers/${encodeURIComponent(editingServer!.name)}`
        : '/api/mcp/servers';
      const method = isUpdate ? 'PUT' : 'POST';

      const result = await hostApiFetch<McpServerSaveResponse>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (result.success) {
        toast.success(t('savedSuccessfully', { name: formName.trim() }));
        setSheetOpen(false);
        void fetchServers();
      } else {
        toast.error(result.error || t('saveFailed'));
      }
    } catch (err) {
      toast.error(String(err) || t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle enabled ──────────────────────────────────────────────
  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      const result = await hostApiFetch<McpServerSaveResponse>(
        `/api/mcp/servers/${encodeURIComponent(name)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }
      );
      if (result.success) {
        toast.success(t('toggledEnabled', {
          name,
          state: enabled ? t('enabledState') : t('disabledState'),
        }));
        void fetchServers();
      } else {
        toast.error(result.error || t('saveFailed'));
      }
    } catch (err) {
      toast.error(String(err) || t('saveFailed'));
    }
  };

  // ── Delete ──────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(
        `/api/mcp/servers/${encodeURIComponent(deleteTarget.name)}`,
        { method: 'DELETE' }
      );
      if (result.success) {
        toast.success(t('deletedSuccessfully', { name: deleteTarget.name }));
        setDeleteTarget(null);
        void fetchServers();
      } else {
        toast.error(result.error || t('deleteFailed'));
      }
    } catch (err) {
      toast.error(String(err) || t('deleteFailed'));
    }
  };

  // ── Add arg ─────────────────────────────────────────────────────
  const handleAddArg = () => {
    setFormArgs([...formArgs, '']);
  };

  const handleArgChange = (index: number, value: string) => {
    const next = [...formArgs];
    next[index] = value;
    setFormArgs(next);
  };

  const handleRemoveArg = (index: number) => {
    setFormArgs(formArgs.filter((_, i) => i !== index));
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full px-6 py-6 md:px-10 md:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-xl font-display font-semibold text-foreground tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={fetchServers}
            disabled={loading}
            className="h-8 w-8 rounded-lg border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-muted-foreground hover:text-foreground"
            title={t('common:actions.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          {servers.length > 0 && (
            <Button
              onClick={handleOpenAdd}
              className="h-9 px-4 text-[13px] font-medium rounded-full bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t('addServer')}
            </Button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2 shrink-0">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <LoadingSpinner />
          </div>
        ) : servers.length === 0 ? (
          <EmptyState onAdd={handleOpenAdd} />
        ) : (
          <div className="flex flex-col gap-1">
            {servers.map((server) => (
              <div
                key={server.name}
                className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5 last:border-0"
                onClick={() => void handleOpenEdit(server.name)}
              >
                <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                  <div className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10">
                    <Server className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-[15px] font-semibold text-foreground truncate">
                        {server.name}
                      </h3>
                      <TransportBadge transport={server.transport} />
                      {server.subscription && (
                        <Badge
                          variant="secondary"
                          className="px-1.5 py-0 h-5 text-[10px] font-medium bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
                        >
                          {t('subscription')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[13px] text-muted-foreground truncate max-w-md">
                      {server.configured ? server.preview : '—'}
                    </p>
                  </div>
                </div>
                <div
                  className="flex items-center gap-4 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => void handleOpenEdit(server.name)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground"
                    title={t('actions.edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {!server.subscription && (
                    <button
                      onClick={() => setDeleteTarget(server)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title={t('actions.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <Switch
                    checked={server.enabled}
                    onCheckedChange={(checked) => void handleToggle(server.name, checked)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          className="w-full sm:max-w-[480px] p-0 flex flex-col border-l border-black/10 dark:border-white/10 bg-[#f3f1e9] dark:bg-card"
          side="right"
        >
          <SheetHeader className="px-6 py-5 border-b border-black/10 dark:border-white/10 shrink-0">
            <SheetTitle className="text-lg font-display font-semibold text-foreground tracking-tight">
              {editingServer ? t('editTitle') : t('addTitle')}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Server Name */}
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-foreground/80">
                {t('serverName')}
              </Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t('serverNameHint')}
                disabled={!!editingServer}
                className="h-9 font-mono text-xs rounded-lg border-black/10 dark:border-white/10"
              />
            </div>

            {/* Transport */}
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-foreground/80">
                {t('transport')}
              </Label>
              <p className="text-[11px] text-muted-foreground">{t('transportHint')}</p>
              <div className="flex gap-2">
                {(['stdio', 'sse', 'streamable-http'] as McpServerTransport[]).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setFormTransport(tp)}
                    disabled={isSubscriptionEdit && tp !== formTransport}
                    className={cn(
                      'flex-1 h-9 rounded-lg border text-xs font-medium transition-all',
                      formTransport === tp
                        ? 'border-[#0a84ff] bg-[#0a84ff]/10 text-[#0a84ff]'
                        : 'border-black/10 dark:border-white/10 text-muted-foreground hover:border-black/20 dark:hover:border-white/20',
                      isSubscriptionEdit && tp !== formTransport && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    {t(`transport${tp.charAt(0).toUpperCase() + tp.slice(1).replace(/-./g, (c) => c[1].toUpperCase())}` as any) || tp}
                  </button>
                ))}
              </div>
            </div>

            <Separator className="bg-black/5 dark:bg-white/5" />

            {/* Subscription warning */}
            {isSubscriptionEdit && (
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{t('subscriptionLabel')}</span>
              </div>
            )}

            {/* stdio fields */}
            {formTransport === 'stdio' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/80">
                    {t('command')}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{t('commandHint')}</p>
                  <Input
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    disabled={isSubscriptionEdit}
                    className="h-9 font-mono text-xs rounded-lg border-black/10 dark:border-white/10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/80">
                    {t('args')}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{t('argsHint')}</p>
                  <div className="space-y-1.5">
                    {formArgs.map((arg, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input
                          value={arg}
                          onChange={(e) => handleArgChange(i, e.target.value)}
                          placeholder={`--arg-${i + 1}`}
                          disabled={isSubscriptionEdit}
                          className="flex-1 h-9 font-mono text-xs rounded-lg border-black/10 dark:border-white/10"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-lg"
                          onClick={() => handleRemoveArg(i)}
                          disabled={isSubscriptionEdit}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddArg}
                    disabled={isSubscriptionEdit}
                    className="h-7 text-[11px] rounded-lg border-dashed border-black/10 dark:border-white/10 text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3 w-3 mr-1" /> {t('argsAdd')}
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/80">
                    {t('env')}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{t('envHint')}</p>
                  <KvEditor
                    items={formEnv}
                    onChange={isSubscriptionEdit ? () => {} : setFormEnv}
                    keyLabel={t('envKey')}
                    valueLabel={t('envValue')}
                    keyPlaceholder="KEY"
                    valuePlaceholder="value"
                    addLabel={t('envAdd')}
                  />
                </div>
              </>
            )}

            {/* SSE / HTTP fields */}
            {formTransport !== 'stdio' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/80">
                    {t('url')}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{t('urlHint')}</p>
                  <Input
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="https://mcp.example.com/sse"
                    disabled={isSubscriptionEdit}
                    className="h-9 font-mono text-xs rounded-lg border-black/10 dark:border-white/10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/80">
                    {t('headers')}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{t('headersHint')}</p>
                  <KvEditor
                    items={formHeaders}
                    onChange={isSubscriptionEdit ? () => {} : setFormHeaders}
                    keyLabel={t('headersKey')}
                    valueLabel={t('headersValue')}
                    keyPlaceholder="Authorization"
                    valuePlaceholder="Bearer sk-..."
                    addLabel={t('headersAdd')}
                  />
                </div>
              </>
            )}

            <Separator className="bg-black/5 dark:bg-white/5" />

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[13px] font-medium text-foreground/80">
                  {t('enabled')}
                </Label>
              </div>
              <Switch
                checked={formEnabled}
                onCheckedChange={setFormEnabled}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-black/10 dark:border-white/10 shrink-0 flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setSheetOpen(false)}
              className="h-9 text-[13px] rounded-full border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving}
              className="h-9 px-5 text-[13px] font-medium rounded-full bg-[#0a84ff] hover:bg-[#007aff] text-white shadow-sm"
            >
              {saving ? 'Saving...' : editingServer ? t('updateServer') : t('saveServer')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('deleteServer')}
        message={t('deleteConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default McpServers;
