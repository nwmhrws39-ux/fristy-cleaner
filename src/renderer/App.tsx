import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useEffect, type ReactElement } from 'react';
import { api } from './api';
import { initDefaultSelection, loadLatest, useApp } from './store';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { cx } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { QuickScan } from './pages/QuickScan';
import { DeepScan } from './pages/DeepScan';
import { Duplicates } from './pages/Duplicates';
import { LargeFiles } from './pages/LargeFiles';
import { TempFiles } from './pages/TempFiles';
import { DiskAnalyzer } from './pages/DiskAnalyzer';
import { AppManager } from './pages/AppManager';
import { History } from './pages/History';
import { SettingsPage } from './pages/Settings';
import type { ScanKind } from '@shared/types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PAGES: Record<string, () => ReactElement> = {
  '/': Dashboard,
  '/quick': QuickScan,
  '/deep': DeepScan,
  '/duplicates': Duplicates,
  '/large': LargeFiles,
  '/temp': TempFiles,
  '/analyzer': DiskAnalyzer,
  '/apps': AppManager,
  '/history': History,
  '/settings': SettingsPage,
};

export function App() {
  const settings = useApp((s) => s.settings);
  const route = useApp((s) => s.route);
  const toasts = useApp((s) => s.toasts);

  useEffect(() => {
    void api.settings.get().then((s) => useApp.getState().setSettings(s));
    void api.system.info().then((sys) => useApp.setState({ sys }));
    (['quick', 'deep', 'duplicates', 'large', 'analyze'] as ScanKind[]).forEach((k) => void loadLatest(k));
    void api.scan.active().then((list) => list.forEach((p) => useApp.setState((st) => ({ progress: { ...st.progress, [p.kind]: p } }))));
    const offs = [
      api.scan.onProgress((p) => useApp.setState((st) => ({ progress: { ...st.progress, [p.kind]: p } }))),
      api.scan.onComplete((s) => {
        useApp.setState((st) => ({
          progress: { ...st.progress, [s.kind]: undefined },
          ...(s.cancelled || s.errorMessage ? {} : { summaries: { ...st.summaries, [s.kind]: s }, live: { ...st.live, [s.kind]: true } }),
        }));
        if (s.errorMessage) useApp.getState().toast(s.errorMessage.split('\n')[0], 'error');
        if (!s.cancelled && !s.errorMessage) void initDefaultSelection(s);
      }),
      api.system.onNavigate((r) => useApp.getState().navigate(r)),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.classList.toggle('light', settings.theme === 'light');
    root.lang = settings.language;
    root.dir = settings.language === 'he' ? 'rtl' : 'ltr';
    const [r, g, b] = hexToRgb(settings.accent);
    root.style.setProperty('--accent', `${r} ${g} ${b}`);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
    root.style.setProperty('--accent2', `${mix(r)} ${mix(g)} ${mix(b)}`);
  }, [settings]);

  if (!settings) return <div className="h-full bg-bg" />;
  const Page = PAGES[route.split('?')[0]] ?? Dashboard;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="glow-bg relative min-w-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={route.split('?')[0]} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="mx-auto max-w-[1400px] px-8 py-7">
              <Page />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <div className="pointer-events-none fixed bottom-5 end-5 z-[60] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={cx('card pointer-events-auto flex max-w-md items-start gap-2 px-4 py-3 text-sm shadow-xl', t.kind === 'error' && 'border-danger/50')}>
              {t.kind === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-danger" /> : t.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" /> : <Info className="h-4 w-4 shrink-0 text-accent2" />}
              <span className="selectable break-words">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
