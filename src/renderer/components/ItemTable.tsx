import { ArrowDown, ArrowUp, FileIcon, Folder, FolderOpen, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ItemPage, ResultItem, SortKey } from '@shared/types';
import { baseName, dirName } from '@shared/format';
import { api } from '../api';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Checkbox, cx, RiskBadge } from './ui';

const PAGE = 100;

export function useSelection(scanId: string | undefined) {
  const sel = useApp((s) => (scanId ? s.selection[scanId] : undefined)) ?? new Set<number>();
  const setSelection = useApp((s) => s.setSelection);
  const update = (fn: (s: Set<number>) => void) => {
    if (!scanId) return;
    const n = new Set(sel);
    fn(n);
    setSelection(scanId, n);
  };
  return { sel, update, set: (ids: Iterable<number>) => scanId && setSelection(scanId, new Set(ids)) };
}

export function ItemTable({
  scanId, categoryId, minSize, search, showCategory, defaultSort = 'size', reloadKey,
}: { scanId: string; categoryId?: string; minSize?: number; search?: string; showCategory?: boolean; defaultSort?: SortKey; reloadKey?: unknown }) {
  const { t, bytes, date, num } = useT();
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>(defaultSort);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [data, setData] = useState<ItemPage | null>(null);
  const { sel, update } = useSelection(scanId);

  useEffect(() => setPage(0), [scanId, categoryId, minSize, search, sortBy, dir]);
  useEffect(() => {
    let alive = true;
    void api.scan.items(scanId, { categoryId, offset: page * PAGE, limit: PAGE, sortBy, sortDir: dir, search: search || undefined, minSize }).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [scanId, categoryId, page, sortBy, dir, search, minSize, reloadKey]);

  if (!data) return <div className="p-6 text-sm text-muted">{t('common.loading')}</div>;
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const pageIds = data.items.map((i) => i.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((i) => sel.has(i));
  const someOnPage = pageIds.some((i) => sel.has(i));

  const header = (key: SortKey, label: string, cls = '') => (
    <button
      className={cx('flex items-center gap-1 hover:text-fg', sortBy === key && 'text-fg', cls)}
      onClick={() => {
        if (sortBy === key) setDir(dir === 'asc' ? 'desc' : 'asc');
        else {
          setSortBy(key);
          setDir(key === 'name' || key === 'path' || key === 'type' ? 'asc' : 'desc');
        }
      }}
    >
      {label}
      {sortBy === key && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-col">
      <div className="grid grid-cols-[28px_minmax(0,1fr)_110px_130px_44px] items-center gap-3 border-b border-line px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted">
        <Checkbox checked={allOnPage} indeterminate={!allOnPage && someOnPage} onChange={(v) => update((s) => pageIds.forEach((i) => (v ? s.add(i) : s.delete(i))))} label="page" />
        <div className="flex gap-4">
          {header('name', t('common.name'))}
          {header('path', t('common.location'))}
          {header('type', t('common.type'))}
        </div>
        {header('size', t('common.size'), 'justify-end')}
        {header('mtime', t('common.modified'))}
        <span />
      </div>
      {data.items.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">{t('results.emptyHint')}</div>}
      <div>
        {data.items.map((it) => (
          <Row key={it.id} it={it} checked={sel.has(it.id)} onToggle={(v) => update((s) => (v ? s.add(it.id) : s.delete(it.id)))} showCategory={showCategory} />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
        <span className="tabular">{num(data.total)} {t('common.items')} · {bytes(data.totalBytes)}</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.prev')}</Button>
            <span className="tabular">{t('common.page', { page: page + 1, pages })}</span>
            <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
          </div>
        )}
      </div>
    </div>
  );

  function Row({ it, checked, onToggle, showCategory }: { it: ResultItem; checked: boolean; onToggle(v: boolean): void; showCategory?: boolean }) {
    return (
      <div
        onClick={() => onToggle(!checked)}
        className={cx('group grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_110px_130px_44px] items-center gap-3 border-b border-line/50 px-4 py-2 text-sm transition hover:bg-panel2/70', checked && 'bg-accent/[0.06]')}
      >
        <Checkbox checked={checked} onChange={onToggle} label={baseName(it.path)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {it.isDir ? <Folder className="h-4 w-4 shrink-0 text-accent2" /> : <FileIcon className="h-4 w-4 shrink-0 text-muted" />}
            <span className="path-ltr truncate font-medium">{baseName(it.path)}</span>
            {it.personal && (
              <span className="inline-flex items-center gap-1 rounded-md bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
                <ShieldAlert className="h-3 w-3" />
                {t('common.personal')}
              </span>
            )}
            {showCategory && <span className="shrink-0 rounded-md bg-panel2 px-1.5 py-0.5 text-[10px] text-muted">{t(`cat.${it.categoryId}.name`)}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
            <span className="path-ltr truncate" title={it.path}>{dirName(it.path)}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">{t(it.reason, it.reasonArgs)}</span>
            <RiskBadge risk={it.risk} />
          </div>
        </div>
        <div className="tabular text-end font-medium">{bytes(it.size)}</div>
        <div className="tabular text-xs text-muted">{it.mtime ? date(it.mtime, false) : '—'}</div>
        <button
          title={t('common.openLocation')}
          onClick={(e) => {
            e.stopPropagation();
            void api.system.showInFolder(it.path);
          }}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted opacity-0 transition hover:bg-panel hover:text-accent2 group-hover:opacity-100"
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>
    );
  }
}
