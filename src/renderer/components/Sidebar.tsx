import { motion } from 'framer-motion';
import { AppWindow, Copy, FileStack, Gauge, HardDrive, History, Layers, Radar, Settings, ThermometerSnowflake, Zap } from 'lucide-react';
import { useApp } from '../store';
import { useT } from '../i18n';
import { cx } from './ui';

export const NAV = [
  { section: 'nav.section.overview', items: [{ route: '/', key: 'nav.dashboard', icon: Gauge }] },
  {
    section: 'nav.section.scan',
    items: [
      { route: '/quick', key: 'nav.quick', icon: Zap, kind: 'quick' },
      { route: '/deep', key: 'nav.deep', icon: Radar, kind: 'deep' },
      { route: '/duplicates', key: 'nav.duplicates', icon: Copy, kind: 'duplicates' },
      { route: '/large', key: 'nav.large', icon: FileStack, kind: 'large' },
      { route: '/temp', key: 'nav.temp', icon: ThermometerSnowflake },
    ],
  },
  {
    section: 'nav.section.tools',
    items: [
      { route: '/analyzer', key: 'nav.analyzer', icon: Layers, kind: 'analyze' },
      { route: '/apps', key: 'nav.apps', icon: AppWindow },
      { route: '/history', key: 'nav.history', icon: History },
      { route: '/settings', key: 'nav.settings', icon: Settings },
    ],
  },
] as const;

export function Sidebar() {
  const { t } = useT();
  const route = useApp((s) => s.route.split('?')[0]);
  const navigate = useApp((s) => s.navigate);
  const progress = useApp((s) => s.progress);
  return (
    <nav className="flex w-60 shrink-0 flex-col border-e border-line bg-panel/60 px-3 py-4">
      {NAV.map((sec) => (
        <div key={sec.section} className="mb-4">
          <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/80">{t(sec.section)}</div>
          {sec.items.map((it) => {
            const active = route === it.route;
            const Icon = it.icon;
            const p = 'kind' in it ? progress[it.kind] : undefined;
            const running = p && !['done', 'cancelled', 'error'].includes(p.phase);
            return (
              <button
                key={it.route}
                onClick={() => navigate(it.route)}
                className={cx('relative mb-0.5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition', active ? 'text-fg' : 'text-muted hover:bg-panel2 hover:text-fg')}
              >
                {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-accent/30 bg-accent/15" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <Icon className={cx('relative h-[18px] w-[18px]', active && 'text-accent2')} />
                <span className="relative">{t(it.key)}</span>
                {running && <span className="relative ms-auto h-2 w-2 animate-pulse rounded-full bg-accent2" />}
              </button>
            );
          })}
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2 rounded-xl border border-line bg-panel2/60 p-3 text-[11px] text-muted">
        <HardDrive className="h-4 w-4 shrink-0 text-accent2" />
        <span>{t('dash.safety.1')}</span>
      </div>
    </nav>
  );
}
