import { create } from 'zustand';
import type { ScanKind, ScanProgress, ScanSummary, Settings, SystemInfo } from '@shared/types';
import { api } from './api';

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'error';
  text: string;
}

interface AppState {
  settings: Settings | null;
  sys: SystemInfo | null;
  route: string;
  progress: Partial<Record<ScanKind, ScanProgress>>;
  summaries: Partial<Record<ScanKind, ScanSummary | null>>;
  /** Whether the full results of the summary are available in this session. */
  live: Partial<Record<ScanKind, boolean>>;
  selection: Record<string, Set<number>>;
  toasts: Toast[];
  navigate(route: string): void;
  setSettings(s: Settings): void;
  updateSettings(p: Partial<Settings>): Promise<void>;
  setSelection(scanId: string, s: Set<number>): void;
  toast(text: string, kind?: Toast['kind']): void;
}

let toastId = 1;

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  sys: null,
  route: '/',
  progress: {},
  summaries: {},
  live: {},
  selection: {},
  toasts: [],
  navigate: (route) => set({ route }),
  setSettings: (settings) => set({ settings }),
  updateSettings: async (p) => {
    const cur = get().settings;
    if (cur) set({ settings: { ...cur, ...p } });
    const s = await api.settings.set(p);
    set({ settings: s });
  },
  setSelection: (scanId, s) => set({ selection: { ...get().selection, [scanId]: s } }),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 5000);
  },
}));

/** Loads the latest summary of a scan kind and wires selection defaults after a scan completes. */
export async function loadLatest(kind: ScanKind) {
  const s = await api.scan.latest(kind);
  const live = s ? !!(await api.scan.summary(s.scanId)) : false;
  useApp.setState((st) => ({ summaries: { ...st.summaries, [kind]: s }, live: { ...st.live, [kind]: live } }));
}

export async function initDefaultSelection(s: ScanSummary) {
  let ids: number[] = [];
  if (s.kind === 'duplicates') ids = await api.scan.defaultDuplicateSelection(s.scanId);
  else if (s.kind === 'quick' || s.kind === 'deep') ids = await api.scan.ids(s.scanId, undefined, true);
  useApp.getState().setSelection(s.scanId, new Set(ids));
}

export function useScan(kind: ScanKind) {
  const progress = useApp((s) => s.progress[kind]);
  const summary = useApp((s) => s.summaries[kind]);
  const live = useApp((s) => !!s.live[kind]);
  const running = !!progress && !['done', 'cancelled', 'error'].includes(progress.phase);
  return { progress, summary, live, running };
}
