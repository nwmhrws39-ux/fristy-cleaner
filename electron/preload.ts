/**
 * Preload script: exposes a narrow, typed API to the sandboxed renderer. No Node.js APIs are exposed.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { FristyApi } from '../src/shared/api';

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args);
function on<T>(ch: string, cb: (v: T) => void) {
  const l = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(ch, l);
  return () => {
    ipcRenderer.removeListener(ch, l);
  };
}

const api: FristyApi = {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximizedChange: (cb) => on('window:maximized', cb),
  },
  system: {
    info: () => invoke('system:info'),
    drives: () => invoke('system:drives'),
    pickFolders: () => invoke('system:pickFolders'),
    showInFolder: (p) => invoke('system:showInFolder', p),
    openRecycleBin: () => invoke('system:openRecycleBin'),
    relaunchAsAdmin: () => invoke('system:relaunchAsAdmin'),
    onNavigate: (cb) => on('nav', cb),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  scan: {
    start: (req) => invoke('scan:start', req),
    pause: (id) => invoke('scan:pause', id),
    resume: (id) => invoke('scan:resume', id),
    cancel: (id) => invoke('scan:cancel', id),
    active: () => invoke('scan:active'),
    latest: (kind) => invoke('scan:latest', kind),
    summary: (id) => invoke('scan:summary', id),
    items: (id, q) => invoke('scan:items', id, q),
    ids: (id, cat, autoOnly) => invoke('scan:ids', id, cat, autoOnly),
    groups: (id, o, l, s) => invoke('scan:groups', id, o, l, s),
    defaultDuplicateSelection: (id) => invoke('scan:defaultDuplicateSelection', id),
    thumbnail: (id, itemId) => invoke('scan:thumbnail', id, itemId),
    onProgress: (cb) => on('scan:progress', cb),
    onComplete: (cb) => on('scan:complete', cb),
  },
  analyzer: {
    overview: (id) => invoke('analyzer:overview', id),
    children: (id, nodeId) => invoke('analyzer:children', id, nodeId),
  },
  clean: {
    estimate: (id, ids) => invoke('clean:estimate', id, ids),
    execute: (req) => invoke('clean:execute', req),
    onProgress: (cb) => on('clean:progress', cb),
  },
  recycleBin: {
    info: () => invoke('recycle:info'),
    empty: (c) => invoke('recycle:empty', c),
  },
  apps: {
    list: () => invoke('apps:list'),
    uninstall: (id) => invoke('apps:uninstall', id),
    openWindowsSettings: () => invoke('apps:openWindowsSettings'),
  },
  history: {
    list: (limit) => invoke('history:list', limit),
    details: (id) => invoke('history:details', id),
    export: (f) => invoke('history:export', f),
    clear: () => invoke('history:clear'),
  },
  dashboard: {
    stats: () => invoke('dashboard:stats'),
  },
};

contextBridge.exposeInMainWorld('fristy', api);
