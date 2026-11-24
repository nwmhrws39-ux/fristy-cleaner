import { AppWindow, ExternalLink, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { InstalledApp } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Card, EmptyState, Modal, PageHeader, Segmented, TextInput } from '../components/ui';

export function AppManager() {
  const { t, bytes, num, date } = useT();
  const sys = useApp((s) => s.sys);
  const toast = useApp((s) => s.toast);
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'name' | 'size' | 'date'>('name');
  const [confirm, setConfirm] = useState<InstalledApp | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setApps(await api.apps.list());
    } catch (e) {
      toast((e as Error).message, 'error');
      setApps([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), []);

  const list = useMemo(() => {
    const s = q.toLowerCase();
    const f = (apps ?? []).filter((a) => !s || a.name.toLowerCase().includes(s) || a.publisher.toLowerCase().includes(s));
    if (sort === 'size') f.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));
    else if (sort === 'date') f.sort((a, b) => (b.installDate ?? 0) - (a.installDate ?? 0));
    return f;
  }, [apps, q, sort]);
  const totalSize = list.reduce((a, b) => a + (b.sizeBytes ?? 0), 0);

  return (
    <div>
      <PageHeader
        icon={<AppWindow className="h-6 w-6" />}
        title={t('apps.title')}
        subtitle={t('apps.subtitle')}
        actions={
          <>
            <Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />} onClick={() => api.apps.openWindowsSettings()}>{t('apps.openSettings')}</Button>
            <Button icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={load}>{t('common.refresh')}</Button>
          </>
        }
      />
      {sys && !sys.isWindows ? (
        <Card><EmptyState icon={<AppWindow className="h-8 w-8" />} title={t('common.notWindows')} /></Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted" />
              <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} className="w-72 ps-9" />
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular text-xs text-muted">{t('apps.count', { n: num(list.length) })} · {bytes(totalSize)}</span>
              <Segmented<'name' | 'size' | 'date'> value={sort} onChange={setSort} options={[{ value: 'name', label: t('apps.sortName') }, { value: 'size', label: t('apps.sortSize') }, { value: 'date', label: t('apps.sortDate') }]} />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px_100px_120px] gap-3 border-b border-line px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted">
            <span>{t('common.name')}</span><span>{t('apps.publisher')}</span><span>{t('apps.installed')}</span><span className="text-end">{t('apps.size')}</span><span />
          </div>
          {!apps && <div className="p-6 text-sm text-muted">{t('common.loading')}</div>}
          {list.map((a) => (
            <div key={a.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px_100px_120px] items-center gap-3 border-b border-line/50 px-5 py-2.5 text-sm hover:bg-panel2/60">
              <div className="min-w-0">
                <div className="truncate font-medium">{a.name}</div>
                <div className="path-ltr truncate text-[11px] text-muted" title={a.location}>{a.version}{a.location ? ` · ${a.location}` : ''} · {t(a.scope === 'user' ? 'apps.user' : 'apps.machine')}</div>
              </div>
              <div className="truncate text-muted">{a.publisher || '—'}</div>
              <div className="tabular text-xs text-muted">{a.installDate ? date(a.installDate, false) : '—'}</div>
              <div className="tabular text-end">{a.sizeBytes ? bytes(a.sizeBytes) : t('apps.unknownSize')}</div>
              <div className="flex justify-end gap-1">
                {a.location && <Button size="sm" variant="ghost" onClick={() => api.system.showInFolder(a.location)} title={t('common.openLocation')}><ExternalLink className="h-4 w-4" /></Button>}
                <Button size="sm" variant="outline" disabled={!a.hasUninstaller} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirm(a)}>{t('apps.uninstall')}</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? t('apps.uninstallTitle', { name: confirm.name }) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const a = confirm!;
                setConfirm(null);
                const r = await api.apps.uninstall(a.id);
                if (r.ok) toast(t('apps.started', { name: a.name }), 'ok');
                else toast(r.error || t('common.error'), 'error');
              }}
            >
              {t('apps.uninstall')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('apps.uninstallDesc')}</p>
      </Modal>
    </div>
  );
}
