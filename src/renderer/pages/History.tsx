import { Download, History as HistoryIcon, Recycle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HistoryDetails, HistoryEntry } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Card, EmptyState, Modal, PageHeader, Stat, cx } from '../components/ui';

export function History() {
  const { t, bytes, num, date } = useT();
  const toast = useApp((s) => s.toast);
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  const [details, setDetails] = useState<HistoryDetails | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const load = () => void api.history.list().then(setList);
  useEffect(load, []);

  const exp = async (f: 'json' | 'csv') => {
    const p = await api.history.export(f);
    if (p) toast(t('hist.exported', { path: p }), 'ok');
  };
  const total = (list ?? []).reduce((a, b) => a + b.bytes, 0);

  return (
    <div>
      <PageHeader
        icon={<HistoryIcon className="h-6 w-6" />}
        title={t('hist.title')}
        subtitle={t('hist.subtitle')}
        actions={
          <>
            <Button variant="ghost" icon={<Recycle className="h-4 w-4" />} onClick={() => api.system.openRecycleBin()}>{t('hist.openBin')}</Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => exp('json')}>{t('hist.exportJson')}</Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => exp('csv')}>{t('hist.exportCsv')}</Button>
            <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={!list?.length} onClick={() => setClearOpen(true)}>{t('hist.clear')}</Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-4">
        <Stat label={t('hist.totalRecovered')} value={bytes(total)} icon={<Recycle className="h-5 w-5" />} tone="ok" />
        <Stat label={t('hist.operations')} value={num(list?.length ?? 0)} icon={<HistoryIcon className="h-5 w-5" />} />
      </div>
      <Card className="!p-0 overflow-hidden">
        {list && list.length === 0 && <EmptyState icon={<HistoryIcon className="h-8 w-8" />} title={t('hist.empty')} />}
        {!!list?.length && (
          <div className="grid grid-cols-[170px_140px_minmax(0,1fr)_110px_110px_90px] gap-3 border-b border-line px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted">
            <span>{t('hist.date')}</span><span>{t('hist.mode')}</span><span>{t('hist.categories')}</span><span className="text-end">{t('hist.removed')}</span><span className="text-end">{t('hist.recovered')}</span><span className="text-end">{t('hist.errors')}</span>
          </div>
        )}
        {list?.map((h) => (
          <button key={h.id} onClick={() => api.history.details(h.id).then(setDetails)} className="grid w-full grid-cols-[170px_140px_minmax(0,1fr)_110px_110px_90px] items-center gap-3 border-b border-line/50 px-5 py-3 text-start text-sm hover:bg-panel2/60">
            <span className="tabular">{date(h.date)}</span>
            <span><span className={cx('rounded-md px-2 py-0.5 text-[11px]', h.mode === 'trash' ? 'bg-accent/15 text-accent2' : 'bg-danger/15 text-danger')}>{t(`hist.mode.${h.mode}`)}</span></span>
            <span className="truncate text-xs text-muted">{h.categories.map((c) => t(`cat.${c}.name`)).join(', ')}</span>
            <span className="tabular text-end">{num(h.removed)}</span>
            <span className="tabular text-end font-medium">{bytes(h.bytes)}</span>
            <span className={cx('tabular text-end', h.failed + h.skipped ? 'text-warn' : 'text-muted')}>{num(h.failed + h.skipped)}</span>
          </button>
        ))}
      </Card>
      <Modal open={!!details} onClose={() => setDetails(null)} wide title={details ? `${t('common.details')} · ${date(details.date)}` : ''}>
        {details && (
          <div>
            <div className="tabular mb-3 text-sm text-muted">{t(`hist.mode.${details.mode}`)} · {num(details.removed)} {t('hist.removed')} · {bytes(details.bytes)}</div>
            <div className="max-h-[50vh] divide-y divide-line overflow-auto rounded-xl border border-line text-xs">
              {details.items.slice(0, 2000).map((i, k) => (
                <div key={k} className="flex items-center gap-3 px-3 py-2">
                  <span className="path-ltr selectable min-w-0 flex-1 truncate" title={i.path}>{i.path}</span>
                  <span className="shrink-0 text-muted">{t(`cat.${i.categoryId}.name`)}</span>
                  <span className="tabular w-20 shrink-0 text-end">{bytes(i.size)}</span>
                  <span className={cx('w-28 shrink-0 text-end', i.status === 'recycled' || i.status === 'deleted' ? 'text-ok' : 'text-warn')} title={i.error}>
                    {t(`hist.status.${i.status}`)}{i.error ? ` · ${i.error.startsWith('clean.err.') ? t(i.error) : i.error}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title={t('hist.clear')}
        footer={<><Button variant="ghost" onClick={() => setClearOpen(false)}>{t('common.cancel')}</Button><Button variant="danger" onClick={async () => { await api.history.clear(); setClearOpen(false); load(); }}>{t('hist.clear')}</Button></>}
      >
        <p className="text-sm">{t('hist.clearConfirm')}</p>
      </Modal>
    </div>
  );
}
