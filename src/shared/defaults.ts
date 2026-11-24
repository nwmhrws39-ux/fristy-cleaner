import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  theme: 'dark',
  accent: '#8b5cf6',
  startWithWindows: false,
  minimizeToTray: true,
  defaultScanLocations: [],
  excludedFolders: [],
  largeFileMinMB: 100,
  duplicateMinKB: 1024,
  oldDownloadDays: 90,
  installerDays: 30,
  skipRecentHours: 24,
  followLinks: false,
  skipCloudFilesForHashing: true,
  notifications: { scanComplete: true, scheduledFindings: true, minFindingsMB: 100 },
  schedule: { enabled: false, frequency: 'weekly', time: '19:00', weekday: 0, monthDay: 1, customHours: 72 },
  historyRetentionDays: 180,
  onboardingDone: false,
};

export const PERMANENT_CONFIRM_PHRASE = 'DELETE';
