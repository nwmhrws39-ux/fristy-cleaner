import { motion } from 'framer-motion';
import { CalendarClock, CheckCircle2, Copy, Database, FileStack, HardDrive, Layers, PieChart as PieIcon, Recycle, ShieldCheck, Sparkles, Trash2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { DashboardStats, DriveInfo } from '@shared/types';
import { api } from '../api';
import { useApp, useScan } from '../store';
import { useT } from '../i18n';
import { Button, Card, Stat } from '../components/ui';
import { Logo } from '../components/Logo';
import { usePalette } from '../charts';

export function Dashboard() {
  const { t, bytes, num, date } = useT();
  const navigate = useApp((s) => s.navigate);
  const quick = useScan('quick');
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    void api.dashboard.stats().then(setStats);
  }, [quick.summary?.scanId, quick.summary?.totalBytes]);

  const usedPct = stats && stats.totalBytes ? stats.usedBytes / stats.totalBytes : 0;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card glow-bg relative overflow-hidden p-8">
        <div className="flex items-center justify-between gap-8">
          <div className="flex items-center gap-5">
            <Logo size={64} />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{t('dash.welcome')}</h1>
              <p className="mt-1 text-muted">{t('dash.subtitle')}</p>
              <p className="mt-3 max-w-xl text-xs text-muted">{t('dash.scanHint')}</p>
            </div>
          </div>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
            <Button variant="primary" size="lg" className="h-16 rounded-2xl px-10 text-lg" icon={<Zap className="h-6 w-6" />} loading={quick.running} onClick={() => navigate('/quick?autostart=1')}>
              {t('common.scanNow')}
            </Button>
          </motion.div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label={t('dash.total')} value={bytes(stats?.totalBytes)} sub={stats ? t('dash.usage', { used: bytes(stats.usedBytes), total: bytes(stats.totalBytes) }) : ' '} icon={<HardDrive className="h-5 w-5" />} />
        <Stat label={t('dash.used')} value={bytes(stats?.usedBytes)} sub={`${Math.round(usedPct * 100)}%`} icon={<Database className="h-5 w-5" />} />
        <Stat label={t('dash.free')} value={bytes(stats?.freeBytes)} sub={stats ? `${Math.round((1 - usedPct) * 100)}%` : ' '} icon={<PieIcon className="h-5 w-5" />} />
        <Stat label={t('dash.recoverable')} value={stats?.recoverableBytes != null ? bytes(stats.recoverableBytes) : '—'} sub={stats?.recoverableBytes == null ? t('dash.runQuick') : t('nav.quick')} icon={<Sparkles className="h-5 w-5" />} />
        <Stat label={t('dash.unnecessary')} value={stats?.unnecessaryFiles != null ? num(stats.unnecessaryFiles) : '—'} sub={t('common.files')} icon={<Trash2 className="h-5 w-5" />} />
        <Stat label={t('dash.lastScan')} value={<span className="text-lg">{stats?.lastScanAt ? date(stats.lastScanAt) : t('dash.never')}</span>} icon={<CalendarClock className="h-5 w-5" />} />
        <Stat label={t('dash.recovered')} value={bytes(stats?.totalRecovered ?? 0)} sub={t('dash.cleanings', { n: num(stats?.cleaningsCount ?? 0) })} icon={<Recycle className="h-5 w-5" />} tone="ok" />
        <Card className="flex flex-col justify-center" title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-ok" />{t('dash.safety')}</span>}>
          <ul className="space-y-1.5 text-xs text-muted">
            {[1, 2, 3, 4].map((i) => (
              <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />{t(`dash.safety.${i}`)}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={t('dash.drives')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {stats?.drives.map((d) => <DriveCard key={d.root} d={d} />)}
          {!stats && <div className="text-sm text-muted">{t('common.loading')}</div>}
        </div>
      </Card>

      <Card title={t('dash.quickActions')}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { r: '/deep', k: 'nav.deep', icon: Layers },
            { r: '/duplicates', k: 'nav.duplicates', icon: Copy },
            { r: '/large', k: 'nav.large', icon: FileStack },
            { r: '/analyzer', k: 'nav.analyzer', icon: PieIcon },
          ].map(({ r, k, icon: Icon }) => (
            <motion.button whileHover={{ y: -2 }} key={r} onClick={() => navigate(r)} className="flex items-center gap-3 rounded-xl border border-line bg-panel2 p-4 text-start transition hover:border-accent/50">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent2"><Icon className="h-5 w-5" /></span>
              <span className="text-sm font-medium">{t(k)}</span>
            </motion.button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function DriveCard({ d }: { d: DriveInfo }) {
  const { t, bytes } = useT();
  const pal = usePalette();
  const OTHER = pal.other;
  const pct = d.total ? d.used / d.total : 0;
  const data = [
    { name: t('dash.used'), value: d.used, fill: pal.used },
    { name: t('dash.free'), value: d.free, fill: OTHER },
  ];
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-panel2/60 p-4">
      <div className="relative h-24 w-24 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={32} outerRadius={46} startAngle={90} endAngle={-270} stroke={pal.surface} strokeWidth={2} isAnimationActive={false}>
              {data.map((x) => <Cell key={x.name} fill={x.fill} />)}
            </Pie>
            <Tooltip
              formatter={(v: number) => bytes(v)}
              contentStyle={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))', borderRadius: 10, fontSize: 12, color: 'rgb(var(--fg))' }}
              itemStyle={{ color: 'rgb(var(--fg))' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="tabular pointer-events-none absolute inset-0 grid place-items-center text-sm font-semibold">{Math.round(pct * 100)}%</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-accent2" />
          <span className="path-ltr font-medium">{d.root}</span>
          {d.label && <span className="truncate text-sm text-muted">{d.label}</span>}
          {d.fileSystem && <span className="rounded bg-panel px-1.5 text-[10px] text-muted">{d.fileSystem}</span>}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: OTHER }}>
          <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: pal.used }} />
        </div>
        <div className="tabular mt-2 flex justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: pal.used }} />{t('dash.used')} {bytes(d.used)}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: OTHER }} />{t('dash.free')} {bytes(d.free)}</span>
        </div>
      </div>
    </div>
  );
}
