import type {
  AnalyzerOverview, CleanEstimate, CleanProgress, CleanRequest, CleanResult, DashboardStats, DriveInfo,
  GroupPage, HistoryDetails, HistoryEntry, InstalledApp, ItemPage, ItemQuery, RecycleBinInfo, ScanKind,
  ScanProgress, ScanRequest, ScanSummary, Settings, SystemInfo, TreeChildren,
} from './types';

export type Unsubscribe = () => void;

/** API exposed to the renderer through contextBridge as window.fristy. */
export interface FristyApi {
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe;
  };
  system: {
    info(): Promise<SystemInfo>;
    drives(): Promise<DriveInfo[]>;
    pickFolders(): Promise<string[] | null>;
    showInFolder(path: string): Promise<void>;
    openRecycleBin(): Promise<void>;
    relaunchAsAdmin(): Promise<boolean>;
    onNavigate(cb: (route: string) => void): Unsubscribe;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  scan: {
    start(req: ScanRequest): Promise<string>;
    pause(scanId: string): Promise<void>;
    resume(scanId: string): Promise<void>;
    cancel(scanId: string): Promise<void>;
    active(): Promise<ScanProgress[]>;
    latest(kind: ScanKind): Promise<ScanSummary | null>;
    summary(scanId: string): Promise<ScanSummary | null>;
    items(scanId: string, query: ItemQuery): Promise<ItemPage>;
    ids(scanId: string, categoryId?: string, autoOnly?: boolean): Promise<number[]>;
    groups(scanId: string, offset: number, limit: number, sort: 'recoverable' | 'size' | 'count'): Promise<GroupPage>;
    defaultDuplicateSelection(scanId: string): Promise<number[]>;
    thumbnail(scanId: string, itemId: number): Promise<string | null>;
    onProgress(cb: (p: ScanProgress) => void): Unsubscribe;
    onComplete(cb: (s: ScanSummary) => void): Unsubscribe;
  };
  analyzer: {
    overview(scanId: string): Promise<AnalyzerOverview | null>;
    children(scanId: string, nodeId: number): Promise<TreeChildren | null>;
  };
  clean: {
    estimate(scanId: string, itemIds: number[]): Promise<CleanEstimate>;
    execute(req: CleanRequest): Promise<CleanResult>;
    onProgress(cb: (p: CleanProgress) => void): Unsubscribe;
  };
  recycleBin: {
    info(): Promise<RecycleBinInfo>;
    empty(confirmation: string): Promise<{ ok: boolean; error?: string; historyId?: number }>;
  };
  apps: {
    list(): Promise<InstalledApp[]>;
    uninstall(id: string): Promise<{ ok: boolean; error?: string }>;
    openWindowsSettings(): Promise<void>;
  };
  history: {
    list(limit?: number): Promise<HistoryEntry[]>;
    details(id: number): Promise<HistoryDetails | null>;
    export(format: 'json' | 'csv'): Promise<string | null>;
    clear(): Promise<void>;
  };
  dashboard: {
    stats(): Promise<DashboardStats>;
  };
}
