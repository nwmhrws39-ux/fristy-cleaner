import { FolderPlus, Lock, Settings as SettingsIcon, ShieldCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Settings } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Card, Field, NumberInput, PageHeader, Segmented, Select, TextInput, Toggle, cx } from '../components/ui';

const ACCENTS = ['#8b5cf6', '#a855f7', '#6366f1', '#d946ef', '#ec4899', '#3b82f6', '#14b8a6', '#f59e0b'];

export function SettingsPage() {
  const { t, lang } = useT();
  const s = useApp((st) => st.settings)!;
  const sys = useApp((st) => st.sys);
  const update = useApp((st) => st.updateSettings);
  const set = (p: Partial<Settings>) => void update(p);
  const weekdays = Array.from({ length: 7 }, (_, i) => ({ value: i, label: new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', { weekday: 'long' }).format(new Date(2026, 0, 4 + i)) }));

  return (
    <div className="space-y-4">
      <PageHeader icon={<SettingsIcon className="h-6 w-6" />} title={t('set.title')} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t('set.general')}>
          <div className="divide-y divide-line">
            <Field label={t('set.startWithWindows')} desc={t('set.startWithWindowsDesc')}><Toggle checked={s.startWithWindows} onChange={(v) => set({ startWithWindows: v })} /></Field>
            <Field label={t('set.minimizeToTray')} desc={t('set.minimizeToTrayDesc')}><Toggle checked={s.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} /></Field>
            <Field label={t('set.language')}><Segmented value={s.language} onChange={(v) => set({ language: v })} options={[{ value: 'en', label: 'English' }, { value: 'he', label: 'עברית' }]} /></Field>
          </div>
        </Card>
        <Card title={t('set.appearance')}>
          <div className="divide-y divide-line">
            <Field label={t('set.theme')}><Segmented value={s.theme} onChange={(v) => set({ theme: v })} options={[{ value: 'dark', label: t('set.dark') }, { value: 'light', label: t('set.light') }]} /></Field>
            <Field label={t('set.accent')}>
              <div className="flex items-center gap-2">
                {ACCENTS.map((c) => (
                  <button key={c} aria-label={c} onClick={() => set({ accent: c })} className={cx('h-7 w-7 rounded-full border-2 transition', s.accent === c ? 'scale-110 border-fg' : 'border-transparent')} style={{ background: c }} />
                ))}
                <input type="color" value={s.accent} onChange={(e) => set({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent" />
              </div>
            </Field>
          </div>
        </Card>
        <Card title={t('set.scanning')} className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-x-10 xl:grid-cols-2">
            <div className="divide-y divide-line">
              <PathList label={t('set.defaultLocations')} desc={t('set.defaultLocationsDesc')} value={s.defaultScanLocations} onChange={(v) => set({ defaultScanLocations: v })} />
              <PathList label={t('set.excluded')} desc={t('set.excludedDesc')} value={s.excludedFolders} onChange={(v) => set({ excludedFolders: v })} />
            </div>
            <div className="divide-y divide-line">
              <Field label={t('set.largeMin')}><NumberInput value={s.largeFileMinMB} min={1} onChange={(v) => set({ largeFileMinMB: v })} /></Field>
              <Field label={t('set.dupMin')}><NumberInput value={s.duplicateMinKB} min={0} onChange={(v) => set({ duplicateMinKB: v })} /></Field>
              <Field label={t('set.recentHours')}><NumberInput value={s.skipRecentHours} min={0} onChange={(v) => set({ skipRecentHours: v })} /></Field>
              <Field label={t('set.oldDownloadDays')}><NumberInput value={s.oldDownloadDays} min={1} onChange={(v) => set({ oldDownloadDays: v })} /></Field>
              <Field label={t('set.installerDays')}><NumberInput value={s.installerDays} min={1} onChange={(v) => set({ installerDays: v })} /></Field>
              <Field label={t('set.followLinks')} desc={t('set.followLinksDesc')}><Toggle checked={s.followLinks} onChange={(v) => set({ followLinks: v })} /></Field>
              <Field label={t('set.skipCloud')} desc={t('set.skipCloudDesc')}><Toggle checked={s.skipCloudFilesForHashing} onChange={(v) => set({ skipCloudFilesForHashing: v })} /></Field>
            </div>
          </div>
        </Card>
        <Card title={t('set.schedule')} subtitle={t('set.scheduleNote')}>
          <div className="divide-y divide-line">
            <Field label={t('set.scheduleEnabled')}><Toggle checked={s.schedule.enabled} onChange={(v) => set({ schedule: { ...s.schedule, enabled: v } })} /></Field>
            <Field label={t('set.frequency')}>
              <Segmented value={s.schedule.frequency} onChange={(v) => set({ schedule: { ...s.schedule, frequency: v } })} options={(['daily', 'weekly', 'monthly', 'custom'] as const).map((f) => ({ value: f, label: t(`set.${f}`) }))} />
            </Field>
            {s.schedule.frequency !== 'custom' && (
              <Field label={t('set.time')}><TextInput type="time" value={s.schedule.time} onChange={(e) => set({ schedule: { ...s.schedule, time: e.target.value || '19:00' } })} /></Field>
            )}
            {s.schedule.frequency === 'weekly' && <Field label={t('set.weekday')}><Select value={s.schedule.weekday} options={weekdays} onChange={(v) => set({ schedule: { ...s.schedule, weekday: v } })} /></Field>}
            {s.schedule.frequency === 'monthly' && <Field label={t('set.monthDay')}><NumberInput value={s.schedule.monthDay} min={1} max={28} onChange={(v) => set({ schedule: { ...s.schedule, monthDay: Math.min(28, Math.max(1, v)) } })} /></Field>}
            {s.schedule.frequency === 'custom' && <Field label={t('set.customHours')}><NumberInput value={s.schedule.customHours} min={1} onChange={(v) => set({ schedule: { ...s.schedule, customHours: Math.max(1, v) } })} /></Field>}
          </div>
        </Card>
        <Card title={t('set.notifications')}>
          <div className="divide-y divide-line">
            <Field label={t('set.notifyComplete')}><Toggle checked={s.notifications.scanComplete} onChange={(v) => set({ notifications: { ...s.notifications, scanComplete: v } })} /></Field>
            <Field label={t('set.notifyScheduled')}><Toggle checked={s.notifications.scheduledFindings} onChange={(v) => set({ notifications: { ...s.notifications, scheduledFindings: v } })} /></Field>
            <Field label={t('set.minFindings')}><NumberInput value={s.notifications.minFindingsMB} min={0} onChange={(v) => set({ notifications: { ...s.notifications, minFindingsMB: v } })} /></Field>
          </div>
        </Card>
        <Card title={t('set.history')}>
          <Field label={t('set.retention')}><NumberInput value={s.historyRetentionDays} min={0} onChange={(v) => set({ historyRetentionDays: v })} /></Field>
        </Card>
        <Card title={t('set.admin')}>
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-2 text-sm text-muted"><Lock className="h-4 w-4 shrink-0" />{sys?.isAdmin ? t('set.adminYes') : t('set.adminNo')}</p>
            {sys?.isWindows && !sys.isAdmin && <Button size="sm" variant="outline" onClick={() => api.system.relaunchAsAdmin()}>{t('set.relaunchAdmin')}</Button>}
          </div>
        </Card>
        <Card title={t('set.privacy')} className="xl:col-span-2">
          <p className="flex gap-2 text-sm text-muted"><ShieldCheck className="h-5 w-5 shrink-0 text-ok" />{t('set.privacyDesc')}</p>
          <p className="mt-3 text-xs text-muted">FRISTY Cleaner · {t('set.version', { v: sys?.version ?? '' })}</p>
        </Card>
      </div>
    </div>
  );
}

function PathList({ label, desc, value, onChange }: { label: string; desc: string; value: string[]; onChange(v: string[]): void }): ReactNode {
  const { t } = useT();
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm">{label}</div>
          <div className="mt-0.5 text-xs text-muted">{desc}</div>
        </div>
        <Button size="sm" variant="outline" icon={<FolderPlus className="h-4 w-4" />} onClick={async () => {
          const r = await api.system.pickFolders();
          if (r?.length) onChange(Array.from(new Set([...value, ...r])));
        }}>{t('common.add')}</Button>
      </div>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((p) => (
            <span key={p} className="path-ltr inline-flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs">
              {p}
              <button aria-label={t('common.remove')} onClick={() => onChange(value.filter((x) => x !== p))} className="text-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
