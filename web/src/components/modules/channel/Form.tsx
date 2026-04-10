import { AutoGroupType, ChannelType, type Channel, useFetchModel } from '@/api/endpoints/channel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/common/Toast';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Search, Upload } from 'lucide-react';

export interface ChannelKeyFormItem {
  id?: number;
  enabled: boolean;
  channel_key: string;
  status_code?: number;
  last_use_time_stamp?: number;
  total_cost?: number;
  remark?: string;
  rpm_limit?: number;
  concurrency_limit?: number;
  cooldown_on_429_sec?: number;
}

export interface ChannelFormData {
  name: string;
  type: ChannelType;
  base_urls: Channel['base_urls'];
  custom_header: Channel['custom_header'];
  channel_proxy: string;
  param_override: string;
  keys: ChannelKeyFormItem[];
  model: string;
  custom_model: string;
  enabled: boolean;
  proxy: boolean;
  auto_sync: boolean;
  auto_group: AutoGroupType;
  match_regex: string;
}

export interface ChannelFormProps {
  formData: ChannelFormData;
  onFormDataChange: (data: ChannelFormData) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
  submitText: string;
  pendingText: string;
  onCancel?: () => void;
  cancelText?: string;
  idPrefix?: string;
}

interface SelectedModelItem {
  name: string;
  source: 'auto' | 'custom';
}

export function ChannelForm({
                              formData,
                              onFormDataChange,
                              onSubmit,
                              isPending,
                              submitText,
                              pendingText,
                              onCancel,
                              cancelText,
                              idPrefix = 'channel',
                            }: ChannelFormProps) {
  const t = useTranslations('channel.form');

  useEffect(() => {
    if (!formData.base_urls || formData.base_urls.length === 0) {
      onFormDataChange({ ...formData, base_urls: [{ url: '', delay: 0 }] });
      return;
    }
    if (!formData.keys || formData.keys.length === 0) {
      onFormDataChange({ ...formData, keys: [{ enabled: true, channel_key: '', rpm_limit: 0, concurrency_limit: 0, cooldown_on_429_sec: 30 }] });
      return;
    }
    if (!formData.custom_header || formData.custom_header.length === 0) {
      onFormDataChange({ ...formData, custom_header: [{ header_key: '', header_value: '' }] });
    }
  }, [formData, onFormDataChange]);

  const autoModels = useMemo(
      () => (formData.model ? formData.model.split(',').map((m) => m.trim()).filter(Boolean) : []),
      [formData.model]
  );
  const customModels = useMemo(
      () => (formData.custom_model ? formData.custom_model.split(',').map((m) => m.trim()).filter(Boolean) : []),
      [formData.custom_model]
  );

  const [customModelInput, setCustomModelInput] = useState('');
  const [availableSearch, setAvailableSearch] = useState('');
  const [availableFetchedModels, setAvailableFetchedModels] = useState<string[]>([]);
  const [checkedSelectedModels, setCheckedSelectedModels] = useState<string[]>([]);
  const [checkedAvailableModels, setCheckedAvailableModels] = useState<string[]>([]);
  const [availableExpanded, setAvailableExpanded] = useState(false);
  const [importExpanded, setImportExpanded] = useState(false);
  const [importValue, setImportValue] = useState('');

  const fetchModel = useFetchModel();

  const effectiveKey =
      formData.keys.find((k) => k.enabled && k.channel_key.trim())?.channel_key.trim() || '';

  const updateModels = (nextAuto: string[], nextCustom: string[]) => {
    const model = nextAuto.join(',');
    const custom_model = nextCustom.join(',');
    if (formData.model === model && formData.custom_model === custom_model) return;
    onFormDataChange({ ...formData, model, custom_model });
  };

  const selectedModels = useMemo<SelectedModelItem[]>(() => ([
    ...autoModels.map((name) => ({ name, source: 'auto' as const })),
    ...customModels.map((name) => ({ name, source: 'custom' as const })),
  ]), [autoModels, customModels]);

  const selectedNameSet = useMemo(() => new Set(selectedModels.map((item) => item.name)), [selectedModels]);

  const availableModels = useMemo(() => {
    const merged = new Set<string>([...availableFetchedModels, ...autoModels]);
    return Array.from(merged)
        .filter((name) => !selectedNameSet.has(name))
        .sort((a, b) => a.localeCompare(b));
  }, [availableFetchedModels, autoModels, selectedNameSet]);

  const normalizedAvailableSearch = availableSearch.trim().toLowerCase();
  const normalizedCheckedSelectedModels = useMemo(
      () => checkedSelectedModels.filter((name) => selectedNameSet.has(name)),
      [checkedSelectedModels, selectedNameSet]
  );
  const checkedSelectedSet = useMemo(() => new Set(normalizedCheckedSelectedModels), [normalizedCheckedSelectedModels]);

  const filteredAvailableModels = useMemo(() => {
    return normalizedAvailableSearch
        ? availableModels.filter((name) => name.toLowerCase().includes(normalizedAvailableSearch))
        : availableModels;
  }, [availableModels, normalizedAvailableSearch]);
  const normalizedCheckedAvailableModels = useMemo(
      () => checkedAvailableModels.filter((name) => filteredAvailableModels.includes(name)),
      [checkedAvailableModels, filteredAvailableModels]
  );
  const checkedAvailableSet = useMemo(() => new Set(normalizedCheckedAvailableModels), [normalizedCheckedAvailableModels]);
  const allFilteredAvailableChecked = filteredAvailableModels.length > 0 && normalizedCheckedAvailableModels.length === filteredAvailableModels.length;

  const selectedCountLabel = `${t('modelSelected')} (${selectedModels.length})`;
  const availableCountLabel = `${t('modelAvailable')} (${availableModels.length})`;

  const visibleAvailableModels = useMemo(() => {
    return availableExpanded || normalizedAvailableSearch ? filteredAvailableModels : filteredAvailableModels.slice(0, 24);
  }, [availableExpanded, filteredAvailableModels, normalizedAvailableSearch]);
  const hasMoreAvailableModels = !normalizedAvailableSearch && filteredAvailableModels.length > 24;

  const handleRefreshModels = async () => {
    if (!formData.base_urls?.[0]?.url || !effectiveKey) return;
    fetchModel.mutate(
        {
          type: formData.type,
          base_urls: formData.base_urls,
          keys: formData.keys
              .filter((k) => k.channel_key.trim())
              .map((k) => ({ enabled: k.enabled, channel_key: k.channel_key.trim() })),
          proxy: formData.proxy,
          channel_proxy: formData.channel_proxy?.trim() || null,
          match_regex: formData.match_regex.trim() || null,
          custom_header: formData.custom_header?.filter((h) => h.header_key.trim()) || [],
        },
        {
          onSuccess: (data) => {
            if (data && data.length > 0) {
              setAvailableFetchedModels(Array.from(new Set(data.map((m) => m.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
              setAvailableExpanded(false);
              toast.success(t('modelRefreshSuccess'));
            } else {
              setAvailableFetchedModels([]);
              setAvailableExpanded(false);
              toast.warning(t('modelRefreshEmpty'));
            }
          },
          onError: (error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            toast.error(t('modelRefreshFailed'), { description: errorMessage });
          },
        }
    );
  };

  const handleToggleAvailableModel = (model: string) => {
    setCheckedAvailableModels((current) => (
        current.includes(model)
            ? current.filter((name) => name !== model)
            : [...current, model]
    ));
  };

  const handleSelectAllAvailableModels = () => {
    setCheckedAvailableModels(filteredAvailableModels);
  };

  const handleInvertAvailableModels = () => {
    setCheckedAvailableModels(filteredAvailableModels.filter((name) => !checkedAvailableSet.has(name)));
  };

  const handleClearAvailableChecked = () => {
    setCheckedAvailableModels([]);
  };

  const handleAddCheckedModels = () => {
    if (normalizedCheckedAvailableModels.length === 0) return;
    const nextAuto = Array.from(new Set([...autoModels, ...normalizedCheckedAvailableModels]));
    updateModels(nextAuto, customModels);
    setCheckedAvailableModels([]);
  };


  const handleAddCustomModel = (model: string) => {
    const trimmedModel = model.trim();
    if (!trimmedModel || customModels.includes(trimmedModel) || autoModels.includes(trimmedModel)) {
      setCustomModelInput('');
      return;
    }
    updateModels(autoModels, [...customModels, trimmedModel]);
    setCustomModelInput('');
  };

  const handleRemoveAutoModel = (model: string) => {
    updateModels(autoModels.filter((name) => name !== model), customModels);
  };

  const handleRemoveCustomModel = (model: string) => {
    updateModels(autoModels, customModels.filter((name) => name !== model));
  };

  const handleCustomModelKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (customModelInput.trim()) handleAddCustomModel(customModelInput);
    }
  };

  const handleClearSelectedModels = () => {
    updateModels([], []);
    setCheckedSelectedModels([]);
  };

  const handleToggleSelectedModel = (model: string) => {
    setCheckedSelectedModels((current) => (
        current.includes(model)
            ? current.filter((name) => name !== model)
            : [...current, model]
    ));
  };

  const handleRemoveCheckedModels = () => {
    if (normalizedCheckedSelectedModels.length === 0) return;
    const checkedSet = new Set(normalizedCheckedSelectedModels);
    updateModels(
        autoModels.filter((name) => !checkedSet.has(name)),
        customModels.filter((name) => !checkedSet.has(name))
    );
    setCheckedSelectedModels([]);
  };

  const parseImportedKeys = (value: string) => {
    const seen = new Set((formData.keys ?? []).map((key) => key.channel_key.trim()).filter(Boolean));
    const imported: ChannelKeyFormItem[] = [];
    const defaultRpmLimit = formData.keys[0]?.rpm_limit ?? 0;
    const defaultConcurrencyLimit = formData.keys[0]?.concurrency_limit ?? 0;
    const defaultCooldownOn429Sec = formData.keys[0]?.cooldown_on_429_sec ?? 30;

    value.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const separatorIndex = (() => {
        const pipeIndex = trimmed.indexOf('|');
        if (pipeIndex >= 0) return pipeIndex;
        return trimmed.indexOf(',');
      })();

      const channelKey = (separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed).trim();
      const remark = (separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : '').trim();
      if (!channelKey || seen.has(channelKey)) return;
      seen.add(channelKey);
      imported.push({
        enabled: true,
        channel_key: channelKey,
        remark,
        rpm_limit: defaultRpmLimit,
        concurrency_limit: defaultConcurrencyLimit,
        cooldown_on_429_sec: defaultCooldownOn429Sec,
      });
    });

    return imported;
  };

  const handleImportKeys = () => {
    const imported = parseImportedKeys(importValue);
    if (imported.length === 0) {
      toast.warning(t('keyImportEmpty'));
      return;
    }

    const currentKeys = formData.keys ?? [];
    const nextKeys = currentKeys.length === 1 && !currentKeys[0]?.channel_key.trim()
        ? imported
        : [...currentKeys, ...imported];

    onFormDataChange({
      ...formData,
      keys: nextKeys,
    });
    setImportValue('');
    setImportExpanded(false);
    toast.success(t('keyImportSuccess', { count: imported.length }));
  };

  const getKeyStatusMeta = (statusCode?: number) => {
    if (statusCode === 200) return { label: t('keyStatusAvailable'), className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' };
    if (statusCode === 401 || statusCode === 403) return { label: t('keyStatusInvalid'), className: 'bg-rose-500/10 text-rose-600 border-rose-500/20' };
    if (statusCode === 429) return { label: t('keyStatusRateLimited'), className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };
    if (statusCode && statusCode >= 500) return { label: t('keyStatusServerError'), className: 'bg-orange-500/10 text-orange-600 border-orange-500/20' };
    return { label: t('keyStatusUnknown'), className: 'bg-muted text-muted-foreground border-border' };
  };

  const formatLastUsed = (timestamp?: number) => {
    if (!timestamp) return t('keyLastUsedNever');
    return new Date(timestamp * 1000).toLocaleString();
  };

  const handleAddKey = () => {
    const defaultRpmLimit = formData.keys[0]?.rpm_limit ?? 0;
    const defaultConcurrencyLimit = formData.keys[0]?.concurrency_limit ?? 0;
    const defaultCooldownOn429Sec = formData.keys[0]?.cooldown_on_429_sec ?? 30;

    onFormDataChange({
      ...formData,
      keys: [
        ...formData.keys,
        {
          enabled: true,
          channel_key: '',
          rpm_limit: defaultRpmLimit,
          concurrency_limit: defaultConcurrencyLimit,
          cooldown_on_429_sec: defaultCooldownOn429Sec,
        },
      ],
    });
  };

  const handleUpdateKey = (idx: number, patch: Partial<ChannelKeyFormItem>) => {
    const next = formData.keys.map((k, i) => (i === idx ? { ...k, ...patch } : k));
    onFormDataChange({ ...formData, keys: next });
  };

  const syncAllKeysAdvanced = (patch: Pick<ChannelKeyFormItem, 'rpm_limit' | 'concurrency_limit' | 'cooldown_on_429_sec'>) => {
    onFormDataChange({
      ...formData,
      keys: (formData.keys ?? []).map((key) => ({ ...key, ...patch })),
    });
  };

  const channelRpmLimit = formData.keys[0]?.rpm_limit ?? 0;
  const channelConcurrencyLimit = formData.keys[0]?.concurrency_limit ?? 0;
  const channelCooldownOn429Sec = formData.keys[0]?.cooldown_on_429_sec ?? 30;

  const handleRemoveKey = (idx: number) => {
    const curr = formData.keys ?? [];
    if (curr.length <= 1) return;
    const next = curr.filter((_, i) => i !== idx);
    onFormDataChange({ ...formData, keys: next });
  };

  const handleAddBaseUrl = () => {
    onFormDataChange({
      ...formData,
      base_urls: [...(formData.base_urls ?? []), { url: '', delay: 0 }],
    });
  };

  const handleUpdateBaseUrl = (idx: number, patch: Partial<Channel['base_urls'][number]>) => {
    const next = (formData.base_urls ?? []).map((u, i) => (i === idx ? { ...u, ...patch } : u));
    onFormDataChange({ ...formData, base_urls: next });
  };

  const handleRemoveBaseUrl = (idx: number) => {
    const curr = formData.base_urls ?? [];
    if (curr.length <= 1) return;
    onFormDataChange({ ...formData, base_urls: curr.filter((_, i) => i !== idx) });
  };

  const handleAddHeader = () => {
    onFormDataChange({
      ...formData,
      custom_header: [...(formData.custom_header ?? []), { header_key: '', header_value: '' }],
    });
  };

  const handleUpdateHeader = (idx: number, patch: Partial<Channel['custom_header'][number]>) => {
    const next = (formData.custom_header ?? []).map((h, i) => (i === idx ? { ...h, ...patch } : h));
    onFormDataChange({ ...formData, custom_header: next });
  };

  const handleRemoveHeader = (idx: number) => {
    const curr = formData.custom_header ?? [];
    if (curr.length <= 1) return;
    onFormDataChange({ ...formData, custom_header: curr.filter((_, i) => i !== idx) });
  };

  return (
      <form onSubmit={onSubmit} className="space-y-4 px-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium text-card-foreground">
              {t('name')}
            </label>
            <Input
                className='rounded-xl'
                id={`${idPrefix}-name`}
                type="text"
                value={formData.name}
                onChange={(event) => onFormDataChange({ ...formData, name: event.target.value })}
                required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor={`${idPrefix}-type`} className="text-sm font-medium text-card-foreground">
              {t('type')}
            </label>
            <Select
                value={String(formData.type)}
                onValueChange={(value) => onFormDataChange({ ...formData, type: Number(value) as ChannelType })}
            >
              <SelectTrigger id={`${idPrefix}-type`} className="rounded-xl w-full border border-border px-4 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='rounded-xl'>
                <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIChat)}>{t('typeOpenAIChat')}</SelectItem>
                <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIResponse)}>{t('typeOpenAIResponse')}</SelectItem>
                <SelectItem className='rounded-xl' value={String(ChannelType.Anthropic)}>{t('typeAnthropic')}</SelectItem>
                <SelectItem className='rounded-xl' value={String(ChannelType.Gemini)}>{t('typeGemini')}</SelectItem>
                <SelectItem className='rounded-xl' value={String(ChannelType.Volcengine)}>{t('typeVolcengine')}</SelectItem>
                <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIEmbedding)}>{t('typeOpenAIEmbedding')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-card-foreground">
              {t('baseUrls')} {formData.base_urls.length > 0 ? `(${formData.base_urls.length})` : ''}
            </label>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddBaseUrl}
                className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
            >
              <Plus className="h-3 w-3 mr-1" />
              {t('add')}
            </Button>
          </div>
          <div className="space-y-2">
            {(formData.base_urls ?? []).map((u, idx) => (
                <div key={`baseurl-${idx}`} className="flex items-center gap-2">
                  <Input
                      id={`${idPrefix}-base-${idx}`}
                      type="url"
                      value={u.url}
                      onChange={(e) => handleUpdateBaseUrl(idx, { url: e.target.value })}
                      placeholder={t('baseUrlUrl')}
                      required={idx === 0}
                      className="rounded-xl flex-1"
                  />
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveBaseUrl(idx)}
                      disabled={(formData.base_urls ?? []).length <= 1}
                      className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive disabled:opacity-40 hover:bg-transparent"
                      title="Remove"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-card-foreground">
              {t('apiKey')} {formData.keys.length > 0 ? `(${formData.keys.length})` : ''}
            </label>
            <div className="flex items-center gap-1">
              <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setImportExpanded((value) => !value)}
                  className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
              >
                <Upload className="h-3 w-3 mr-1" />
                {t('keyImport')}
              </Button>
              <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleAddKey}
                  className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
              >
                <Plus className="h-3 w-3 mr-1" />
                {t('add')}
              </Button>
            </div>
          </div>
          {importExpanded && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
                <div className="text-xs text-muted-foreground">{t('keyImportHint')}</div>
                <textarea
                    value={importValue}
                    onChange={(e) => setImportValue(e.target.value)}
                    placeholder={t('keyImportPlaceholder')}
                    className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex justify-end gap-2">
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setImportExpanded(false);
                        setImportValue('');
                      }}
                      className="rounded-xl"
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                      type="button"
                      size="sm"
                      onClick={handleImportKeys}
                      disabled={!importValue.trim()}
                      className="rounded-xl"
                  >
                    {t('keyImportApply')}
                  </Button>
                </div>
              </div>
          )}
          <div className="space-y-2">
            {(formData.keys ?? []).map((k, idx) => {
              const statusMeta = getKeyStatusMeta(k.status_code);
              return (
                  <div key={k.id ?? `new-${idx}`} className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center gap-2">
                      <Input
                          type="text"
                          value={k.channel_key}
                          onChange={(e) => handleUpdateKey(idx, { channel_key: e.target.value })}
                          placeholder={t('apiKey')}
                          required={idx === 0}
                          className="rounded-xl flex-1"
                      />
                      <Input
                          type="text"
                          value={k.remark ?? ''}
                          onChange={(e) => handleUpdateKey(idx, { remark: e.target.value })}
                          placeholder={t('remark')}
                          className="rounded-xl w-32"
                      />
                      <Switch
                          checked={k.enabled}
                          onCheckedChange={(checked) => handleUpdateKey(idx, { enabled: checked })}
                      />
                      <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveKey(idx)}
                          disabled={(formData.keys ?? []).length <= 1}
                          className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-transparent disabled:opacity-40"
                          title="Remove"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className={statusMeta.className}>
                        {statusMeta.label}
                        {k.status_code ? ` · ${k.status_code}` : ''}
                      </Badge>
                      <Badge variant="outline" className="border-border bg-background/70 text-muted-foreground">
                        {t('keyLastUsed')}: {formatLastUsed(k.last_use_time_stamp)}
                      </Badge>
                      <Badge variant="outline" className="border-border bg-background/70 text-muted-foreground">
                        {t('keyTotalCost')}: {Number(k.total_cost ?? 0).toFixed(4)}
                      </Badge>
                    </div>
                  </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-card-foreground">{t('model')}</label>
          </div>
          <input type="hidden" value={formData.model || formData.custom_model} required />

          <div className="space-y-3 rounded-xl border border-border/60 bg-card p-3 sm:p-4">
            <div className="space-y-2">
              <div className="relative">
                <Input
                    id={`${idPrefix}-model-custom`}
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={handleCustomModelKeyDown}
                    placeholder={t('modelCustomPlaceholder')}
                    className="rounded-xl pr-10"
                />
                {customModelInput.trim() && !customModels.includes(customModelInput.trim()) && !autoModels.includes(customModelInput.trim()) && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAddCustomModel(customModelInput)}
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        title={t('modelAdd')}
                    >
                      <Plus className="size-4" />
                    </Button>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{t('modelCustomHint')}</div>
            </div>

            <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-card-foreground">{selectedCountLabel}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveCheckedModels}
                      disabled={normalizedCheckedSelectedModels.length === 0}
                      className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t('modelRemoveChecked')}
                  </Button>
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearSelectedModels}
                      disabled={selectedModels.length === 0}
                      className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t('modelClearAll')}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedModels.length > 0 ? selectedModels.map((item) => {
                  const isChecked = checkedSelectedSet.has(item.name);
                  return (
                      <div
                          key={`${item.source}-${item.name}`}
                          className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-background'}`}
                      >
                        <button
                            type="button"
                            onClick={() => handleToggleSelectedModel(item.name)}
                            className="flex min-w-0 items-center text-left"
                        >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-card-foreground">{item.name}</span>
                        <span className="block text-xs leading-none text-muted-foreground">
                          {item.source === 'auto' ? t('modelSourceAuto') : t('modelSourceCustom')}
                        </span>
                      </span>
                        </button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (item.source === 'auto') {
                                handleRemoveAutoModel(item.name);
                              } else {
                                handleRemoveCustomModel(item.name);
                              }
                            }}
                            className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
                            title={t('modelRemove')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                  );
                }) : (
                    <div className="flex h-16 w-full items-center justify-center rounded-lg border border-dashed border-border/50 bg-background/60 text-xs text-muted-foreground">
                      {t('modelNoSelected')}
                    </div>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-card-foreground">{availableCountLabel}</div>
                </div>
                <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5 min-[980px]:flex-nowrap">
                  <div className="relative min-w-[220px] flex-1 min-[980px]:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={availableSearch}
                        onChange={(e) => setAvailableSearch(e.target.value)}
                        placeholder={t('modelSearchPlaceholder')}
                        className="h-9 rounded-xl border-border/60 bg-background pl-9 pr-3 text-sm shadow-none focus-visible:border-border/60 focus-visible:ring-0"
                    />
                  </div>
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectAllAvailableModels}
                      disabled={filteredAvailableModels.length === 0 || allFilteredAvailableChecked}
                      className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t('modelSelectAll')}
                  </Button>
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleInvertAvailableModels}
                      disabled={filteredAvailableModels.length === 0}
                      className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t('modelInvertSelection')}
                  </Button>
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearAvailableChecked}
                      disabled={normalizedCheckedAvailableModels.length === 0}
                      className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t('modelClear')}
                  </Button>
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRefreshModels}
                      disabled={!formData.base_urls?.[0]?.url || !effectiveKey || fetchModel.isPending}
                      className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {fetchModel.isPending ? `${t('modelRefresh')}...` : t('modelRefresh')}
                  </Button>
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleAddCheckedModels}
                      disabled={normalizedCheckedAvailableModels.length === 0}
                      className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t('modelAddSelected')}
                  </Button>
                </div>
                {hasMoreAvailableModels && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAvailableExpanded((value) => !value)}
                        className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {availableExpanded ? t('modelShowLess') : t('modelShowMore')}
                    </Button>
                )}
              </div>

              <div className="rounded-lg border border-border/50 bg-background/60 p-3">
                <div className="flex flex-wrap gap-2">
                  {visibleAvailableModels.length > 0 ? visibleAvailableModels.map((model) => {
                    const isChecked = checkedAvailableSet.has(model);
                    return (
                        <button
                            key={model}
                            type="button"
                            onClick={() => handleToggleAvailableModel(model)}
                            className={`inline-flex max-w-full items-center rounded-lg border px-3 py-2 text-sm text-card-foreground transition-colors ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-border/50 bg-background hover:bg-muted/70'}`}
                        >
                          <span className="truncate">{model}</span>
                        </button>
                    );
                  }) : (
                      <div className="flex h-16 w-full items-center justify-center rounded-lg border border-dashed border-border/50 bg-background/60 text-xs text-muted-foreground">
                        {normalizedAvailableSearch ? t('modelSearchAvailableEmpty') : t('modelAvailableEmpty')}
                      </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Accordion type="single" collapsible className="w-full border rounded-xl bg-card">
          <AccordionItem value="advanced" className="border-none">
            <AccordionTrigger className="text-sm font-medium text-card-foreground py-3 px-4 hover:no-underline hover:bg-muted/30 rounded-xl transition-colors">
              {t('advanced')}
            </AccordionTrigger>
            <AccordionContent className="pt-4 px-4 pb-4 space-y-4 border-t">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor={`${idPrefix}-auto-group`} className="text-sm font-medium text-card-foreground">
                    {t('autoGroup')}
                  </label>
                  <Select
                      value={String(formData.auto_group)}
                      onValueChange={(value) => onFormDataChange({ ...formData, auto_group: Number(value) as AutoGroupType })}
                  >
                    <SelectTrigger id={`${idPrefix}-auto-group`} className="rounded-xl w-full border border-border px-4 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className='rounded-xl'>
                      <SelectItem className='rounded-xl' value={String(AutoGroupType.None)}>{t('autoGroupNone')}</SelectItem>
                      <SelectItem className='rounded-xl' value={String(AutoGroupType.Fuzzy)}>{t('autoGroupFuzzy')}</SelectItem>
                      <SelectItem className='rounded-xl' value={String(AutoGroupType.Exact)}>{t('autoGroupExact')}</SelectItem>
                      <SelectItem className='rounded-xl' value={String(AutoGroupType.Regex)}>{t('autoGroupRegex')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label htmlFor={`${idPrefix}-channel-proxy`} className="text-sm font-medium text-card-foreground">
                    {t('channelProxy')}
                  </label>
                  <Input
                      id={`${idPrefix}-channel-proxy`}
                      type="text"
                      value={formData.channel_proxy}
                      onChange={(e) => onFormDataChange({ ...formData, channel_proxy: e.target.value })}
                      placeholder={t('channelProxyPlaceholder')}
                      className="rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-card-foreground">
                    {t('customHeader')} {formData.custom_header.length > 0 ? `(${formData.custom_header.length})` : ''}
                  </label>
                  <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleAddHeader}
                      className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {t('customHeaderAdd')}
                  </Button>
                </div>
                <div className="space-y-2">
                  {(formData.custom_header ?? []).map((h, idx) => (
                      <div key={`hdr-${idx}`} className="flex items-center gap-2">
                        <Input
                            type="text"
                            value={h.header_key}
                            onChange={(e) => handleUpdateHeader(idx, { header_key: e.target.value })}
                            placeholder={t('customHeaderKey')}
                            className="rounded-xl flex-1"
                        />
                        <Input
                            type="text"
                            value={h.header_value}
                            onChange={(e) => handleUpdateHeader(idx, { header_value: e.target.value })}
                            placeholder={t('customHeaderValue')}
                            className="rounded-xl flex-1"
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveHeader(idx)}
                            disabled={(formData.custom_header ?? []).length <= 1}
                            className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-transparent disabled:opacity-40"
                            title="Remove"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor={`${idPrefix}-match-regex`} className="text-sm font-medium text-card-foreground">
                  {t('matchRegex')}
                </label>
                <Input
                    id={`${idPrefix}-match-regex`}
                    type="text"
                    value={formData.match_regex}
                    onChange={(e) => onFormDataChange({ ...formData, match_regex: e.target.value })}
                    placeholder={t('matchRegexPlaceholder')}
                    className="rounded-xl"
                />
              </div>

              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-card-foreground">{t('keyAdvancedTitle')}</div>
                  <div className="text-xs text-muted-foreground">{t('keyAdvancedHint')}</div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-card-foreground">{t('rpmLimit')}</label>
                    <Input
                        type="number"
                        min={0}
                        value={channelRpmLimit}
                        onChange={(e) => syncAllKeysAdvanced({ rpm_limit: Number(e.target.value || 0), concurrency_limit: channelConcurrencyLimit, cooldown_on_429_sec: channelCooldownOn429Sec })}
                        placeholder={t('rpmLimitPlaceholder')}
                        className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-card-foreground">{t('concurrencyLimit')}</label>
                    <Input
                        type="number"
                        min={0}
                        value={channelConcurrencyLimit}
                        onChange={(e) => syncAllKeysAdvanced({ rpm_limit: channelRpmLimit, concurrency_limit: Number(e.target.value || 0), cooldown_on_429_sec: channelCooldownOn429Sec })}
                        placeholder={t('concurrencyLimitPlaceholder')}
                        className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-card-foreground">{t('cooldownOn429Sec')}</label>
                    <Input
                        type="number"
                        min={0}
                        value={channelCooldownOn429Sec}
                        onChange={(e) => syncAllKeysAdvanced({ rpm_limit: channelRpmLimit, concurrency_limit: channelConcurrencyLimit, cooldown_on_429_sec: Number(e.target.value || 0) })}
                        placeholder={t('cooldownOn429SecPlaceholder')}
                        className="rounded-xl"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor={`${idPrefix}-param-override`} className="text-sm font-medium text-card-foreground">
                  {t('paramOverride')}
                </label>
                <textarea
                    id={`${idPrefix}-param-override`}
                    value={formData.param_override}
                    onChange={(e) => onFormDataChange({ ...formData, param_override: e.target.value })}
                    placeholder={t('paramOverridePlaceholder')}
                    className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="sticky bottom-0 pt-2 flex flex-col-reverse sm:flex-row justify-end gap-3 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} className="rounded-xl" disabled={isPending}>
                {cancelText ?? t('cancel')}
              </Button>
          )}
          <Button type="submit" className="rounded-xl" disabled={isPending}>
            {isPending ? pendingText : submitText}
          </Button>
        </div>
      </form>
  );
}
