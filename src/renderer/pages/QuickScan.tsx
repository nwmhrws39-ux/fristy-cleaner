import { Recycle, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PERMANENT_CONFIRM_PHRASE } from '@shared/defaults';
import { api } from '../api';
import { loadLatest, useApp, useScan } from '../store';
import { useT } from '../i18n';
import { Button, Card, EmptyState, Modal, PageHeader, TextInput } from '../components/ui';
import { ScanProgressPanel } from '../components/ScanProgressPanel';
import { CategoryResults, SelectionBar } from '../components/CategoryResults';
import { CleanFlow } from '../components/CleanFlow';
import { useSelection } from '../components/ItemTable';

export const TEMP_CATEGORY_IDS = ['windowsTemp', 'userTemp', 'appCache', 'browserCache', 'thumbnails', 'crashDumps', 'oldLogs'];

export function QuickScan() {
  return <CategoryScanPage variant="quick" />;
}

export function CategoryScanPage({ variant }: { variant: 'quick' | 'temp' }) {
  const { t, bytes, num, date } = useT();
  const route = useApp((s) => s.route);
  const toast = useApp((s) => s.toast);
  const sys = useApp((s) => s.sys);
  const { progress, summary, live, running } = useScan('quick');
  const [cleanIds, setCleanIds] = useState<number[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const { set } = useSelection(summary?.scanId);

  const start = async () => {
    try {
      await api.scan.start({ kind: 'quick' });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  useEffect(() => {
    if (route.includes('autostart=1') && !running) {
      useApp.getState().navigate(route.split('?')[0]);
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const cats = summary?.categories.filter((c) => (variant === 'temp' ? TEMP_CATEGORY_IDS.includes(c.id) : c.id !== 'recycleBin')) ?? [];
  const recycle = summary?.categories.find((c) => c.id === 'recycleBin');
  const total = cats.reduce((a, c) => a + c.bytes, 0);

  return (
    <div>
      <PageHeader
        icon={variant === 'quick' ? <Zap className="h-6 w-6" /> : <Trash2 className="h-6 w-6" />}
        title={t(variant === 'quick' ? 'quick.title' : 'temp.title')}
        subtitle={t(variant === 'quick' ? 'quick.subtitle' : 'temp.subtitle')}
        actions={<Button variant="primary" icon={<Zap className="h-4 w-4" />} loading={running} onClick={start}>{summary ? t('common.rescan') : t('common.startScan')}</Button>}
      />
      {variant === 'temp' && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3 text-sm"><ShieldCheck className="h-5 w-5 shrink-0 text-ok" />{t('temp.never')}</div>
      )}
      {progress && running && <div className="mb-6"><ScanProgressPanel p={progress} /></div>}
      {!summary && !running && (
        <Card><EmptyState icon={<Zap className="h-8 w-8" />} title={t('results.noScan')} hint={t('results.noScanHint')} action={<Button variant="primary" onClick={start}>{t('common.scanNow')}</Button>} /></Card>
      )}
      {summary && (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">{t('results.recoverable')}</div>
              <div className="tabular text-4xl font-semibold tracking-tight">{bytes(total)}</div>
              <div className="mt-1 text-xs text-muted">
                {t('results.lastScan', { date: date(summary.finishedAt) })} · {num(summary.filesScanned)} {t('common.files')}
                {summary.errors > 0 && ` · ${t('results.errors', { n: num(summary.errors) })}`}
              </div>
            </div>
            {live && (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={async () => set(await api.scan.ids(summary.scanId, undefined, true))}>{t('common.selectRecommended')}</Button>
                <Button size="sm" variant="ghost" onClick={() => set([])}>{t('common.selectNone')}</Button>
              </div>
            )}
          </div>
          {!live && <div className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">{t('results.summaryOnly')}</div>}
          {sys && !sys.isAdmin && summary.categories.some((c) => c.id === 'windowsTemp' && c.inaccessible > 0) && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm">
              <span>{t('set.adminNo')}</span>
              <Button size="sm" variant="outline" onClick={() => api.system.relaunchAsAdmin()}>{t('set.relaunchAdmin')}</Button>
            </div>
          )}
          <CategoryResults summary={summary} categories={cats} live={live} reloadKey={reloadKey} detailed={variant === 'temp'} />
          {variant === 'quick' && recycle && (
            <Card className="mt-4">
              <div className="flex items-center gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-danger/10 text-danger"><Recycle className="h-5 w-5" /></div>
                <div className="flex-1">
                  <div className="font-medium">{t('cat.recycleBin.name')}</div>
                  <div className="text-xs text-muted">{t('cat.recycleBin.desc')} {t('quick.recycleManual')}</div>
                </div>
                <div className="tabular text-end"><div className="text-lg font-semibold">{bytes(recycle.bytes)}</div><div className="text-[11px] text-muted">{num(recycle.count)} {t('common.items')}</div></div>
                <Button size="sm" variant="ghost" onClick={() => api.system.openRecycleBin()}>{t('quick.openRecycle')}</Button>
                <Button size="sm" variant="danger" disabled={!recycle.count} onClick={() => setEmptyOpen(true)}>{t('quick.emptyRecycle')}</Button>
              </div>
            </Card>
          )}
          {live && <SelectionBar scanId={summary.scanId} onClean={setCleanIds} />}
          {cleanIds && (
            <CleanFlow
              open
              scanId={summary.scanId}
              ids={cleanIds}
              onClose={() => setCleanIds(null)}
              onDone={async () => {
                set([]);
                setReloadKey((k) => k + 1);
                await loadLatest('quick');
              }}
            />
          )}
          {recycle && <EmptyRecycleModal open={emptyOpen} onClose={() => setEmptyOpen(false)} count={recycle.count} size={bytes(recycle.bytes)} onDone={() => loadLatest('quick')} />}
        </>
      )}
    </div>
  );
}

function EmptyRecycleModal({ open, onClose, count, size, onDone }: { open: boolean; onClose(): void; count: number; size: string; onDone(): void }) {
  const { t, num } = useT();
  const toast = useApp((s) => s.toast);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPhrase(''), [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('quick.emptyRecycleTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={phrase !== PERMANENT_CONFIRM_PHRASE}
            onClick={async () => {
              setBusy(true);
              const r = await api.recycleBin.empty(phrase);
              setBusy(false);
              if (r.ok) {
                toast(t('quick.recycleEmptied'), 'ok');
                onDone();
                onClose();
              } else toast(r.error || t('common.error'), 'error');
            }}
          >
            {t('quick.emptyRecycle')}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t('quick.emptyRecycleWarn', { count: num(count), size })}</p>
      <div className="mb-1.5 mt-4 text-xs text-danger">{t('clean.typeToConfirm', { phrase: PERMANENT_CONFIRM_PHRASE })}</div>
      <TextInput value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={PERMANENT_CONFIRM_PHRASE} dir="ltr" />
    </Modal>
  );
}
