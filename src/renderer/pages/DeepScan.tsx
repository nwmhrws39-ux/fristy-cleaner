import { Radar } from 'lucide-react';
import { useState } from 'react';
import type { DeepDetectOptions } from '@shared/types';
import { api } from '../api';
import { loadLatest, useApp, useScan } from '../store';
import { useT } from '../i18n';
import { Button, Card, Checkbox, EmptyState, PageHeader } from '../components/ui';
import { LocationPicker } from '../components/LocationPicker';
import { ScanProgressPanel } from '../components/ScanProgressPanel';
import { CategoryResults, SelectionBar } from '../components/CategoryResults';
import { CleanFlow } from '../components/CleanFlow';
import { useSelection } from '../components/ItemTable';

const KEYS: (keyof DeepDetectOptions)[] = ['large', 'duplicates', 'emptyFolders', 'oldDownloads', 'installers', 'temp', 'caches'];

export function DeepScan() {
  const { t, bytes, num, date } = useT();
  const settings = useApp((s) => s.settings)!;
  const toast = useApp((s) => s.toast);
  const { progress, summary, live, running } = useScan('deep');
  const [roots, setRoots] = useState<string[]>(settings.defaultScanLocations);
  const [detect, setDetect] = useState<DeepDetectOptions>({ large: true, duplicates: true, emptyFolders: true, oldDownloads: true, installers: true, temp: true, caches: true });
  const [cleanIds, setCleanIds] = useState<number[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { set } = useSelection(summary?.scanId);

  const start = async () => {
    if (!roots.length) return toast(t('deep.noLocations'), 'error');
    try {
      await api.scan.start({ kind: 'deep', roots, detect });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <PageHeader icon={<Radar className="h-6 w-6" />} title={t('deep.title')} subtitle={t('deep.subtitle')} />
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Card title={t('deep.locations')}>
          <LocationPicker value={roots} onChange={setRoots} />
        </Card>
        <Card title={t('deep.detect')}>
          <div className="grid grid-cols-1 gap-2">
            {KEYS.map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox checked={detect[k]} onChange={(v) => setDetect({ ...detect, [k]: v })} />
                {t(`deep.detect.${k}`)}
              </label>
            ))}
          </div>
          <Button variant="primary" className="mt-4 w-full" icon={<Radar className="h-4 w-4" />} loading={running} disabled={!roots.length || !KEYS.some((k) => detect[k])} onClick={start}>
            {t('common.startScan')}
          </Button>
        </Card>
      </div>
      {progress && running && <div className="mb-6"><ScanProgressPanel p={progress} /></div>}
      {!summary && !running && <Card><EmptyState icon={<Radar className="h-8 w-8" />} title={t('results.noScan')} hint={t('results.noScanHint')} /></Card>}
      {summary && (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">{t('results.recoverable')}</div>
              <div className="tabular text-4xl font-semibold tracking-tight">{bytes(summary.totalBytes)}</div>
              <div className="path-ltr mt-1 text-xs text-muted">
                {t('results.lastScan', { date: date(summary.finishedAt) })} · {summary.roots.join(', ')} · {num(summary.filesScanned)} {t('common.files')}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                {summary.errors > 0 && `${t('results.errors', { n: num(summary.errors) })} · `}
                {t('results.linksSkipped', { n: num(summary.skippedLinks) })} · {t('results.protectedSkipped', { n: num(summary.protectedSkipped) })}
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
          <CategoryResults summary={summary} categories={summary.categories} live={live} reloadKey={reloadKey} />
          {live && <SelectionBar scanId={summary.scanId} onClean={setCleanIds} />}
          {cleanIds && (
            <CleanFlow open scanId={summary.scanId} ids={cleanIds} onClose={() => setCleanIds(null)} onDone={async () => { set([]); setReloadKey((k) => k + 1); await loadLatest('deep'); }} />
          )}
        </>
      )}
    </div>
  );
}
