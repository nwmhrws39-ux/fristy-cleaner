import { FileStack, Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { loadLatest, useApp, useScan } from '../store';
import { useT } from '../i18n';
import { Button, Card, EmptyState, NumberInput, PageHeader, Segmented, TextInput } from '../components/ui';
import { LocationPicker } from '../components/LocationPicker';
import { ScanProgressPanel } from '../components/ScanProgressPanel';
import { SelectionBar } from '../components/CategoryResults';
import { CleanFlow } from '../components/CleanFlow';
import { ItemTable, useSelection } from '../components/ItemTable';

const MB = 1024 * 1024;
const PRESETS = ['100', '500', '1024', '5120', '10240', 'custom'] as const;

export function LargeFiles() {
  const { t, bytes, num, date } = useT();
  const settings = useApp((s) => s.settings)!;
  const toast = useApp((s) => s.toast);
  const { progress, summary, live, running } = useScan('large');
  const [roots, setRoots] = useState<string[]>(settings.defaultScanLocations);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(PRESETS.includes(String(settings.largeFileMinMB) as never) ? (String(settings.largeFileMinMB) as never) : 'custom');
  const [customMB, setCustomMB] = useState(settings.largeFileMinMB);
  const [search, setSearch] = useState('');
  const [cleanIds, setCleanIds] = useState<number[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { set } = useSelection(summary?.scanId);
  const minMB = preset === 'custom' ? Math.max(1, customMB) : Number(preset);

  const start = async () => {
    if (!roots.length) return toast(t('deep.noLocations'), 'error');
    try {
      await api.scan.start({ kind: 'large', roots, largeMinBytes: Math.min(minMB, 100) * MB });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <PageHeader icon={<FileStack className="h-6 w-6" />} title={t('large.title')} subtitle={t('large.subtitle')} />
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto]">
        <Card title={t('deep.locations')}>
          <LocationPicker value={roots} onChange={setRoots} />
        </Card>
        <Card title={t('large.threshold')}>
          <Segmented<(typeof PRESETS)[number]> value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ value: p, label: p === 'custom' ? t('large.custom') : bytes(Number(p) * MB, 0) }))} />
          {preset === 'custom' && <div className="mt-3"><NumberInput value={customMB} min={1} onChange={setCustomMB} /> <span className="text-xs text-muted">MB</span></div>}
          <Button variant="primary" className="mt-4 w-full" icon={<FileStack className="h-4 w-4" />} loading={running} disabled={!roots.length} onClick={start}>{t('common.startScan')}</Button>
        </Card>
      </div>
      {progress && running && <div className="mb-6"><ScanProgressPanel p={progress} /></div>}
      {!summary && !running && <Card><EmptyState icon={<FileStack className="h-8 w-8" />} title={t('results.noScan')} hint={t('results.noScanHint')} /></Card>}
      {summary && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="path-ltr text-xs text-muted">{t('results.lastScan', { date: date(summary.finishedAt) })} · {summary.roots.join(', ')} · {num(summary.filesScanned)} {t('common.files')}</div>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted" />
              <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('large.filterType')} className="w-72 ps-9" />
            </div>
          </div>
          {!live && <div className="mb-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">{t('results.summaryOnly')}</div>}
          {live && (
            <Card className="!p-0 overflow-hidden">
              <ItemTable scanId={summary.scanId} minSize={minMB * MB} search={search} reloadKey={reloadKey} />
            </Card>
          )}
          {live && <SelectionBar scanId={summary.scanId} onClean={setCleanIds} />}
          {cleanIds && <CleanFlow open scanId={summary.scanId} ids={cleanIds} onClose={() => setCleanIds(null)} onDone={async () => { set([]); setReloadKey((k) => k + 1); await loadLatest('large'); }} />}
        </>
      )}
    </div>
  );
}
