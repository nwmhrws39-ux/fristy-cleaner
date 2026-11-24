import { Copy, FolderOpen, Image as ImageIcon, Lock, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DuplicateGroup, GroupPage, ResultItem } from '@shared/types';
import { baseName, dirName } from '@shared/format';
import { api } from '../api';
import { loadLatest, useApp, useScan } from '../store';
import { useT } from '../i18n';
import { Button, Card, Checkbox, cx, EmptyState, PageHeader, Segmented, Select } from '../components/ui';
import { LocationPicker } from '../components/LocationPicker';
import { ScanProgressPanel } from '../components/ScanProgressPanel';
import { SelectionBar } from '../components/CategoryResults';
import { CleanFlow } from '../components/CleanFlow';
import { useSelection } from '../components/ItemTable';

const PAGE = 25;
const IMG = /\.(jpe?g|png|gif|webp|bmp|ico|heic|tiff?)$/i;

export function Duplicates() {
  const { t, bytes, num, date } = useT();
  const settings = useApp((s) => s.settings)!;
  const toast = useApp((s) => s.toast);
  const { progress, summary, live, running } = useScan('duplicates');
  const [roots, setRoots] = useState<string[]>(settings.defaultScanLocations);
  const [minKB, setMinKB] = useState(settings.duplicateMinKB);
  const [sort, setSort] = useState<'recoverable' | 'size' | 'count'>('recoverable');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<GroupPage | null>(null);
  const [cleanIds, setCleanIds] = useState<number[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { sel, update, set } = useSelection(summary?.scanId);

  useEffect(() => {
    if (!summary || !live) return setData(null);
    void api.scan.groups(summary.scanId, page * PAGE, PAGE, sort).then(setData);
  }, [summary?.scanId, live, page, sort, reloadKey]);

  const start = async () => {
    if (!roots.length) return toast(t('deep.noLocations'), 'error');
    setPage(0);
    try {
      await api.scan.start({ kind: 'duplicates', roots, dupMinBytes: minKB * 1024 });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const allButOne = async () => {
    if (!summary) return;
    const ids: number[] = [];
    for (let off = 0; ; off += 500) {
      const p = await api.scan.groups(summary.scanId, off, 500, 'recoverable');
      for (const g of p.groups) g.items.slice(1).forEach((i) => ids.push(i.id)); // items[0] is the kept copy
      if (off + 500 >= p.total) break;
    }
    set(ids);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div>
      <PageHeader icon={<Copy className="h-6 w-6" />} title={t('dup.title')} subtitle={t('dup.subtitle')} />
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Card title={t('deep.locations')} subtitle={t('dup.method')}>
          <LocationPicker value={roots} onChange={setRoots} />
        </Card>
        <Card title={t('dup.minSize')}>
          <Select<number> value={minKB} onChange={setMinKB} options={[1, 64, 1024, 10240, 102400].map((v) => ({ value: v, label: bytes(v * 1024) }))} />
          <Button variant="primary" className="mt-4 w-full" icon={<Copy className="h-4 w-4" />} loading={running} disabled={!roots.length} onClick={start}>{t('common.startScan')}</Button>
        </Card>
      </div>
      {progress && running && <div className="mb-6"><ScanProgressPanel p={progress} /></div>}
      {!summary && !running && <Card><EmptyState icon={<Copy className="h-8 w-8" />} title={t('results.noScan')} hint={t('results.noScanHint')} /></Card>}
      {summary && (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex gap-8">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted">{t('dup.recoverable')}</div>
                <div className="tabular text-4xl font-semibold tracking-tight">{bytes(summary.totalBytes)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted">{t('dup.groups')}</div>
                <div className="tabular text-4xl font-semibold tracking-tight">{num(summary.duplicateGroups ?? 0)}</div>
              </div>
            </div>
            {live && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">{t('dup.sort')}</span>
                <Segmented value={sort} onChange={(v) => { setSort(v); setPage(0); }} options={(['recoverable', 'size', 'count'] as const).map((v) => ({ value: v, label: t(`dup.sort.${v}`) }))} />
                <Button size="sm" variant="ghost" onClick={async () => set(await api.scan.defaultDuplicateSelection(summary.scanId))}>{t('dup.selectDefault')}</Button>
                <Button size="sm" variant="ghost" onClick={allButOne}>{t('dup.selectAllButOne')}</Button>
                <Button size="sm" variant="ghost" onClick={() => set([])}>{t('common.selectNone')}</Button>
              </div>
            )}
          </div>
          <div className="mb-3 text-[11px] text-muted">{t('results.lastScan', { date: date(summary.finishedAt) })} · {t('dup.personalNote')}</div>
          {!live && <div className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">{t('results.summaryOnly')}</div>}
          {live && data && data.total === 0 && <Card><EmptyState icon={<Copy className="h-8 w-8" />} title={t('results.empty')} hint={t('results.emptyHint')} /></Card>}
          <div className="space-y-3">
            {data?.groups.map((g) => <GroupCard key={g.id} g={g} scanId={summary.scanId} sel={sel} toggle={(id, v) => update((s) => (v ? s.add(id) : s.delete(id)))} />)}
          </div>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.prev')}</Button>
              <span className="tabular">{t('common.page', { page: page + 1, pages })}</span>
              <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
            </div>
          )}
          {live && <SelectionBar scanId={summary.scanId} onClean={setCleanIds} />}
          {cleanIds && (
            <CleanFlow open scanId={summary.scanId} ids={cleanIds} onClose={() => setCleanIds(null)} onDone={async () => { set([]); setReloadKey((k) => k + 1); await loadLatest('duplicates'); }} />
          )}
        </>
      )}
    </div>
  );
}

function GroupCard({ g, scanId, sel, toggle }: { g: DuplicateGroup; scanId: string; sel: Set<number>; toggle(id: number, v: boolean): void }) {
  const { t, bytes } = useT();
  const selected = g.items.filter((i) => sel.has(i.id)).length;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel2/50 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="path-ltr truncate font-medium">{baseName(g.items[0]?.path ?? '')}</span>
          <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] text-accent2">{t('dup.copies', { n: g.items.length })}</span>
          <span className="tabular text-xs text-muted">{t('dup.each', { size: bytes(g.size) })}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="path-ltr hidden font-mono text-[10px] text-muted lg:inline" title={g.hash}>SHA-256 {g.hash.slice(0, 16)}…</span>
          <span className="tabular text-sm font-semibold">{bytes(g.recoverable)}</span>
        </div>
      </div>
      {g.items.map((it, idx) => (
        <DupRow key={it.id} it={it} scanId={scanId} kept={idx === 0} checked={sel.has(it.id)} lastUnselected={!sel.has(it.id) && selected === g.items.length - 1} onToggle={(v) => toggle(it.id, v)} />
      ))}
    </div>
  );
}

function DupRow({ it, scanId, kept, checked, lastUnselected, onToggle }: { it: ResultItem; scanId: string; kept: boolean; checked: boolean; lastUnselected: boolean; onToggle(v: boolean): void }) {
  const { t, date } = useT();
  const [thumb, setThumb] = useState<string | null | undefined>(undefined);
  const isImg = IMG.test(it.path);
  useEffect(() => {
    if (isImg) void api.scan.thumbnail(scanId, it.id).then(setThumb);
  }, [scanId, it.id, isImg]);
  return (
    <div className={cx('group flex items-center gap-4 border-b border-line/50 px-5 py-2.5 last:border-0 hover:bg-panel2/50', checked && 'bg-accent/[0.06]')}>
      {/* The last unselected copy of a group cannot be selected: at least one copy always stays. */}
      <Checkbox checked={checked} disabled={lastUnselected} onChange={onToggle} />
      <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-panel2">
        {thumb ? <img src={thumb} alt={t('dup.preview')} className="h-full w-full object-cover" /> : <ImageIcon className={cx('h-5 w-5', isImg ? 'text-muted' : 'text-line')} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="path-ltr truncate text-sm" title={it.path}>{it.path}</span>
          {kept && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-ok/15 px-1.5 py-0.5 text-[10px] text-ok"><Lock className="h-3 w-3" />{t('dup.kept')}</span>}
          {it.personal && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn"><ShieldAlert className="h-3 w-3" />{t('common.personal')}</span>}
        </div>
        <div className="tabular mt-0.5 text-[11px] text-muted">
          {t('common.created')}: {date(it.ctime)} · {t('common.modified')}: {date(it.mtime)} · <span className="path-ltr">{dirName(it.path)}</span>
        </div>
      </div>
      <button title={t('common.openLocation')} onClick={() => api.system.showInFolder(it.path)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel hover:text-accent2">
        <FolderOpen className="h-4 w-4" />
      </button>
    </div>
  );
}
