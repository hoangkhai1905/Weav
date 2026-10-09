import { useEffect, useId, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { Copy, Trash2 } from 'lucide-react';
import {
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  type TemplateScope,
  type TemplateSummary,
  type TemplateVisibility,
} from '../../api/templates.api';
import { ConfirmModal } from '../common/ConfirmModal';
import { useI18nStore } from '../../store/useI18nStore';
import { TemplateCard } from './TemplateCard';
import { dialogBtn, dialogField } from './templateStyles';

const VISIBILITIES: TemplateVisibility[] = ['PRIVATE', 'UNLISTED', 'PUBLIC'];
const PAGE_SIZE = 12;

interface TemplateGalleryProps {
  scope: TemplateScope;
  onOpen: (template: TemplateSummary) => void;
}

export function TemplateGallery({ scope, onOpen }: TemplateGalleryProps) {
  const { t } = useI18nStore();
  const searchId = useId();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? 'anon');
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TemplateSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounce the search box so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Scoped by user (Của tôi) and workspace (Nhóm) so a switch never shows the previous one's private items.
  const listKey = ['templates', scope, scope === 'public' ? '' : userId, scope === 'workspace' ? workspaceId ?? 'active' : '', scope === 'public' ? query : ''];
  const list = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listTemplates(scope, { workspaceId: workspaceId ?? undefined, q: scope === 'public' ? query : undefined, page: pageParam, size: PAGE_SIZE }),
    getNextPageParam: (last, pages) => (pages.flatMap((page) => page.items).length < last.totalElements ? pages.length : undefined),
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const loading = list.isFetching;
  const error = list.isError ? (list.error instanceof Error ? list.error.message : t('tpl.error_load')) : null;
  const reload = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const changeVisibility = async (template: TemplateSummary, visibility: TemplateVisibility) => {
    setActionError(null);
    try {
      await updateTemplate(template.id, { visibility });
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t('tpl.action_failed'));
    }
  };

  const copyCode = async (template: TemplateSummary) => {
    setActionError(null);
    try {
      const code = template.shareCode ?? (await getTemplate(template.id)).shareCode;
      if (!code) throw new Error(t('tpl.action_failed'));
      if (!navigator.clipboard) throw new Error(t('tpl.action_failed'));
      await navigator.clipboard.writeText(code);
      setCopiedId(template.id);
      window.setTimeout(() => setCopiedId((current) => (current === template.id ? null : current)), 2000);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t('tpl.action_failed'));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteTemplate(pendingDelete.id);
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t('tpl.action_failed'));
    } finally {
      setPendingDelete(null);
      setDeleting(false);
    }
  };

  const emptyKey = scope === 'public' ? 'tpl.empty.community' : scope === 'workspace' ? 'tpl.empty.team' : 'tpl.empty.mine';

  return (
    <div className="space-y-3" data-testid={`template-gallery-${scope}`}>
      {scope === 'public' ? (
        <div>
          <label htmlFor={searchId} className="mb-1 block text-[11px] font-medium text-text-2">{t('tpl.search_label')}</label>
          <input
            id={searchId}
            data-testid="template-search"
            type="search"
            value={search}
            maxLength={100}
            placeholder={t('tpl.search_placeholder')}
            onChange={(event) => setSearch(event.target.value)}
            className={`${dialogField} max-w-sm`}
          />
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-err">{error}</p> : null}
      {actionError ? <p role="alert" className="text-xs text-err">{actionError}</p> : null}
      {!loading && !error && items.length === 0 ? <p className="text-sm text-muted-foreground">{t(emptyKey)}</p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onOpen={() => onOpen(template)}
            actions={scope === 'mine' ? (
              <>
                <label className="flex items-center gap-1 text-[11px] text-text-2">
                  <span>{t('tpl.visibility_label')}</span>
                  <select
                    data-testid={`template-visibility-${template.id}`}
                    value={template.visibility}
                    onChange={(event) => void changeVisibility(template, event.target.value as TemplateVisibility)}
                    className="rounded-md border border-border-strong bg-card px-1.5 py-1 text-[11px] text-foreground"
                  >
                    {VISIBILITIES.map((value) => <option key={value} value={value}>{t(`tpl.visibility.${value}`)}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => void copyCode(template)} className={`${dialogBtn} h-8`}>
                    <Copy size={12} aria-hidden="true" />
                    <span>{copiedId === template.id ? t('tpl.copied') : t('tpl.copy_code')}</span>
                  </button>
                  <button
                    type="button"
                    data-testid={`template-delete-${template.id}`}
                    aria-label={`${t('tpl.delete')}: ${template.name}`}
                    onClick={() => setPendingDelete(template)}
                    className={`${dialogBtn} h-8 text-err`}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => onOpen(template)} className={`${dialogBtn} h-8`}>{t('tpl.view')}</button>
            )}
          />
        ))}
      </div>
      {loading ? <p role="status" className="text-xs text-muted-foreground">{t('tpl.loading')}</p> : null}
      {list.hasNextPage && !loading ? (
        <button type="button" onClick={() => void list.fetchNextPage()} className={dialogBtn}>{t('tpl.load_more')}</button>
      ) : null}
      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={t('tpl.delete_title')}
        description={t('tpl.delete_body').replace('{name}', pendingDelete?.name ?? '')}
        confirmText={t('tpl.delete')}
        cancelText={t('tpl.cancel')}
        loading={deleting}
      />
    </div>
  );
}
