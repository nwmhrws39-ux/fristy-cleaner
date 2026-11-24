import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Info, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CategoryInfo, ScanSummary } from '@shared/types';
import { api } from '../api';
import { useT } from '../i18n';
import { ItemTable, useSelection } from './ItemTable';
import { Button, Checkbox, cx, RiskBadge } from './ui';

/** Category list with expandable per-file tables; used by Quick Scan, Deep Scan and Temporary Files. */
export function CategoryResults({ summary, categories, live, reloadKey, detailed }: { summary: ScanSummary; categories: CategoryInfo[]; live: boolean; reloadKey: unknown; detailed?: boolean }) {
  const { t, bytes, num } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const { sel, update } = useSelection(summary.scanId);
  const [catIds, setCatIds] = useState<Record<string, number[]>>({});

  const idsFor = async (id: string) => {
    if (catIds[id]) return catIds[id];
    const ids = await api.scan.ids(summary.scanId, id);
    setCatIds((c) => ({ ...c, [id]: ids }));
    return ids;
  };

  return (
    <div className="space-y-2.5">
      {categories.map((c) => {
        const ids = catIds[c.id];
        const selCount = ids ? ids.filter((i) => sel.has(i)).length : undefined;
        const isOpen = open === c.id;
        const selectable = live && c.id !== 'recycleBin' && c.count > 0;
        return (
          <motion.div layout key={c.id} className="card overflow-hidden">
            <div className="flex cursor-pointer items-center gap-4 px-5 py-4 hover:bg-panel2/40" onClick={() => selectable && setOpen(isOpen ? null : c.id)}>
              {selectable ? (
                <CatCheckbox scanId={summary.scanId} id={c.id} idsFor={idsFor} sel={sel} update={update} known={selCount} total={c.count} />
              ) : (
                <span className="w-[18px]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t(`cat.${c.id}.name`)}</span>
                  <RiskBadge risk={c.risk} />
                  {c.autoSelect && c.count > 0 && <span className="inline-flex items-center gap-1 text-[10px] text-accent2"><Sparkles className="h-3 w-3" />{t('common.selectRecommended')}</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted">{t(`cat.${c.id}.desc`)}</div>
              </div>
              <div className="tabular text-end">
                <div className="text-lg font-semibold">{bytes(c.bytes)}</div>
                <div className="text-[11px] text-muted">{num(c.count)} {t('common.items')}</div>
              </div>
              {selectable && <ChevronDown className={cx('h-5 w-5 text-muted transition', isOpen && 'rotate-180')} />}
            </div>
            {(detailed || isOpen) && (
              <div className="flex gap-2 border-t border-line/60 bg-panel2/40 px-5 py-2.5 text-xs text-muted">
                <Info className="h-4 w-4 shrink-0 text-accent2" />
                <span><b className="font-medium text-fg">{t('temp.effect')}:</b> {t(`cat.${c.id}.effect`)}</span>
              </div>
            )}
            {detailed && c.locations.length > 0 && (
              <div className="path-ltr border-t border-line/60 px-5 py-2 text-[11px] text-muted">{t('temp.locations')}: {c.locations.slice(0, 4).join(' · ')}{c.locations.length > 4 ? ` +${c.locations.length - 4}` : ''}</div>
            )}
            {c.inaccessible > 0 && c.id !== 'recycleBin' && <div className="border-t border-line/60 px-5 py-2 text-[11px] text-warn">{t('results.inaccessible', { n: c.inaccessible })}</div>}
            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden border-t border-line">
                  <ItemTable scanId={summary.scanId} categoryId={c.id} reloadKey={reloadKey} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}

function CatCheckbox({ id, idsFor, sel, update, known, total }: { scanId: string; id: string; idsFor(id: string): Promise<number[]>; sel: Set<number>; update(fn: (s: Set<number>) => void): void; known?: number; total: number }) {
  const [ids, setIds] = useState<number[] | null>(null);
  useEffect(() => {
    void idsFor(id).then(setIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const n = known ?? (ids ? ids.filter((i) => sel.has(i)).length : 0);
  return (
    <Checkbox
      checked={n > 0 && n === total}
      indeterminate={n > 0 && n < total}
      onChange={async (v) => {
        const all = await idsFor(id);
        update((s) => all.forEach((i) => (v ? s.add(i) : s.delete(i))));
      }}
    />
  );
}

export function SelectionBar({ scanId, onClean, extra }: { scanId: string; onClean(ids: number[]): void; extra?: React.ReactNode }) {
  const { t, bytes, num } = useT();
  const { sel } = useSelection(scanId);
  const [est, setEst] = useState({ bytes: 0, count: 0 });
  useEffect(() => {
    let alive = true;
    const h = setTimeout(() => void api.clean.estimate(scanId, [...sel]).then((e) => alive && setEst({ bytes: e.bytes, count: e.count })), 120);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [scanId, sel]);
  return (
    <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-between gap-4 rounded-2xl border border-accent/30 bg-panel/95 px-5 py-3 shadow-glow backdrop-blur">
      <div className="tabular text-sm">
        <span className="text-muted">{t('common.selected')}: </span>
        <span className="font-semibold">{t('results.selectedSummary', { count: num(est.count), size: bytes(est.bytes) })}</span>
        <div className="text-[11px] text-muted">{t('results.nothingAuto')}</div>
      </div>
      <div className="flex items-center gap-2">
        {extra}
        <Button variant="primary" disabled={sel.size === 0} onClick={() => onClean([...sel])}>{t('common.cleanSelected')}</Button>
      </div>
    </div>
  );
}
