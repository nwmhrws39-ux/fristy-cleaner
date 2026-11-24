// Types shared between the Electron main process, the scanner worker and the renderer.

export type ScanKind = 'quick' | 'deep' | 'duplicates' | 'large' | 'analyze';
export type RiskLevel = 'safe' | 'review' | 'caution';
export type Language = 'en' | 'he';
export type Theme = 'dark' | 'light';

export interface DeepDetectOptions {
  large: boolean;
  duplicates: boolean;
  emptyFolders: boolean;
  oldDownloads: boolean;
  installers: boolean;
  temp: boolean;
  caches: boolean;
}

export interface ScanRequest {
  kind: ScanKind;
  /** Folders / drive roots to scan. Ignored by quick scans (they use known locations). */
  roots?: string[];
  /** Optional subset of quick-scan category ids. */
  categories?: string[];
  detect?: Partial<DeepDetectOptions>;
  largeMinBytes?: number;
  dupMinBytes?: number;
  /** Set by the scheduler; never changes cleaning behaviour (scans never delete). */
  scheduled?: boolean;
}

export interface CategoryInfo {
  id: string;
  count: number;
  bytes: number;
  risk: RiskLevel;
  /** Whether items in this category are pre-selected in the UI (never for personal files). */
  autoSelect: boolean;
  /** Locations that were scanned for this category. */
  locations: string[];
  /** Locations that could not be read (permission denied, missing...). */
  inaccessible: number;
}

export interface ResultItem {
  id: number;
  path: string;
  size: number;
  mtime: number;
  ctime: number;
  categoryId: string;
  /** i18n key explaining why the item is considered removable. */
  reason: string;
  reasonArgs?: Record<string, string | number>;
  risk: RiskLevel;
  isDir: boolean;
  /** Located inside a personal folder (Documents, Desktop, Pictures...). Never auto-selected. */
  personal: boolean;
  groupId?: number;
  ext: string;
}

export interface DuplicateGroup {
  id: number;
  size: number;
  hash: string;
  items: ResultItem[];
  /** Space recoverable if all but one copy were removed. */
  recoverable: number;
}

export type ScanPhase = 'starting' | 'enumerating' | 'hashing' | 'finalizing' | 'done' | 'cancelled' | 'error';

export interface ScanProgress {
  scanId: string;
  kind: ScanKind;
  phase: ScanPhase;
  paused: boolean;
  filesScanned: number;
  dirsScanned: number;
  bytesScanned: number;
  currentPath: string;
  elapsedMs: number;
  /** null when no reliable estimate is available. */
  etaMs: number | null;
  errors: number;
  hashedBytes: number;
  hashTotalBytes: number;
  itemsFound: number;
  bytesFound: number;
}

export interface ScanSummary {
  scanId: string;
  kind: ScanKind;
  startedAt: number;
  finishedAt: number;
  roots: string[];
  categories: CategoryInfo[];
  /** Unique (per path) totals across all categories. */
  totalBytes: number;
  totalCount: number;
  filesScanned: number;
  dirsScanned: number;
  bytesScanned: number;
  errors: number;
  skippedLinks: number;
  protectedSkipped: number;
  cancelled: boolean;
  scheduled: boolean;
  errorMessage?: string;
  duplicateGroups?: number;
}

export type SortKey = 'size' | 'name' | 'type' | 'path' | 'mtime';

export interface ItemQuery {
  categoryId?: string;
  offset: number;
  limit: number;
  sortBy?: SortKey;
  sortDir?: 'asc' | 'desc';
  search?: string;
  minSize?: number;
}

export interface ItemPage {
  items: ResultItem[];
  total: number;
  totalBytes: number;
}

export interface GroupPage {
  groups: DuplicateGroup[];
  total: number;
  recoverable: number;
}

/* ---------- Disk analyzer ---------- */

export interface TreeEntry {
  /** Directory node id, or -1 for files. */
  id: number;
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  fileCount: number;
  dirCount: number;
  mtime: number;
  hasChildren: boolean;
}

export interface TreeChildren {
  node: TreeEntry;
  breadcrumb: { id: number; name: string }[];
  children: TreeEntry[];
  /** Files in this directory that were not kept individually (summarised). */
  otherFiles: { count: number; bytes: number };
}

export interface ExtStat {
  ext: string;
  bytes: number;
  count: number;
}

export interface AnalyzerOverview {
  roots: TreeEntry[];
  extStats: ExtStat[];
  largestFiles: TreeEntry[];
  largestFolders: TreeEntry[];
}

/* ---------- Cleaning ---------- */

export type CleanMode = 'trash' | 'permanent';

export interface CleanEstimate {
  count: number;
  bytes: number;
  personalCount: number;
  folderCount: number;
  categories: { id: string; count: number; bytes: number }[];
  /** Duplicate groups where the selection would remove every copy (these are refused). */
  allCopiesGroups: number;
}

export interface CleanRequest {
  scanId: string;
  itemIds: number[];
  mode: CleanMode;
  /** Must be true: the renderer only sets it after the confirmation dialog. */
  confirmed: boolean;
  /** Required for permanent deletion: user typed confirmation phrase. */
  permanentConfirmation?: string;
}

export interface CleanProgress {
  done: number;
  total: number;
  bytes: number;
  current: string;
}

export type CleanItemStatus = 'recycled' | 'deleted' | 'skipped' | 'failed';

export interface CleanItemResult {
  path: string;
  size: number;
  categoryId: string;
  status: CleanItemStatus;
  error?: string;
}

export interface CleanResult {
  historyId: number;
  mode: CleanMode;
  removed: number;
  failed: number;
  skipped: number;
  bytesRecovered: number;
  durationMs: number;
  issues: CleanItemResult[];
}

/* ---------- History ---------- */

export interface HistoryEntry {
  id: number;
  date: number;
  mode: CleanMode | 'empty-recycle-bin';
  removed: number;
  failed: number;
  skipped: number;
  bytes: number;
  categories: string[];
  source: string;
}

export interface HistoryDetails extends HistoryEntry {
  items: CleanItemResult[];
}

/* ---------- System ---------- */

export interface DriveInfo {
  root: string;
  label: string;
  fileSystem: string;
  type: string;
  total: number;
  free: number;
  used: number;
}

export interface SystemInfo {
  platform: string;
  isWindows: boolean;
  isAdmin: boolean;
  version: string;
  home: string;
  knownFolders: Record<string, string>;
}

export interface InstalledApp {
  id: string;
  name: string;
  publisher: string;
  version: string;
  installDate: number | null;
  sizeBytes: number | null;
  location: string;
  hasUninstaller: boolean;
  scope: 'machine' | 'user';
}

export interface RecycleBinInfo {
  supported: boolean;
  count: number;
  bytes: number;
}

export interface DashboardStats {
  drives: DriveInfo[];
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  recoverableBytes: number | null;
  unnecessaryFiles: number | null;
  lastScanAt: number | null;
  totalRecovered: number;
  cleaningsCount: number;
}

/* ---------- Settings ---------- */

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface ScheduleSettings {
  enabled: boolean;
  frequency: ScheduleFrequency;
  /** HH:MM local time */
  time: string;
  /** 0 = Sunday */
  weekday: number;
  monthDay: number;
  customHours: number;
}

export interface Settings {
  language: Language;
  theme: Theme;
  accent: string;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  defaultScanLocations: string[];
  excludedFolders: string[];
  largeFileMinMB: number;
  duplicateMinKB: number;
  oldDownloadDays: number;
  installerDays: number;
  /** Files modified more recently than this are never offered from temp/cache categories. */
  skipRecentHours: number;
  followLinks: boolean;
  skipCloudFilesForHashing: boolean;
  notifications: { scanComplete: boolean; scheduledFindings: boolean; minFindingsMB: number };
  schedule: ScheduleSettings;
  historyRetentionDays: number;
  onboardingDone: boolean;
}
