/**
 * Local SQLite storage (sql.js / WebAssembly build, so no native module has to be compiled for
 * Windows). The database file lives in the user's AppData folder and is never uploaded anywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import type { CleanItemResult, HistoryDetails, HistoryEntry, ScanKind, ScanSummary } from '../src/shared/types';

export class Store {
  private saveTimer: NodeJS.Timeout | null = null;

  private constructor(private db: Database, private file: string) {}

  static async open(file: string): Promise<Store> {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) as unknown as ArrayBuffer });
    let db: Database;
    try {
      db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
      db.exec('SELECT 1');
    } catch {
      // Corrupt database: keep a backup and start fresh rather than refusing to start.
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      db = new SQL.Database();
    }
    const store = new Store(db, file);
    store.migrate();
    return store;
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at INTEGER, finished_at INTEGER,
        total_bytes INTEGER, total_count INTEGER, summary TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS scans_kind ON scans(kind, finished_at);
      CREATE TABLE IF NOT EXISTS cleanings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, mode TEXT NOT NULL, removed INTEGER,
        failed INTEGER, skipped INTEGER, bytes INTEGER, categories TEXT, source TEXT);
      CREATE TABLE IF NOT EXISTS cleaning_items (
        cleaning_id INTEGER NOT NULL, path TEXT NOT NULL, size INTEGER, category TEXT, status TEXT, error TEXT);
      CREATE INDEX IF NOT EXISTS cleaning_items_cid ON cleaning_items(cleaning_id);
    `);
  }

  /** Debounced atomic write to disk. */
  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const data = this.db.export();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, this.file);
  }

  private all<T>(sql: string, params: (string | number | null)[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  getKV<T>(key: string): T | undefined {
    const r = this.all<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])[0];
    if (!r) return undefined;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return undefined;
    }
  }

  setKV(key: string, value: unknown) {
    this.db.run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
    this.persist();
  }

  saveScan(s: ScanSummary) {
    this.db.run('INSERT OR REPLACE INTO scans(id, kind, started_at, finished_at, total_bytes, total_count, summary) VALUES(?,?,?,?,?,?,?)', [
      s.scanId, s.kind, s.startedAt, s.finishedAt, s.totalBytes, s.totalCount, JSON.stringify(s),
    ]);
    // Keep the last 50 scan summaries per kind.
    this.db.run('DELETE FROM scans WHERE kind = ? AND id NOT IN (SELECT id FROM scans WHERE kind = ? ORDER BY finished_at DESC LIMIT 50)', [s.kind, s.kind]);
    this.persist();
  }

  latestScan(kind?: ScanKind): ScanSummary | null {
    const rows = kind
      ? this.all<{ summary: string }>('SELECT summary FROM scans WHERE kind = ? AND summary NOT LIKE \'%"cancelled":true%\' ORDER BY finished_at DESC LIMIT 1', [kind])
      : this.all<{ summary: string }>('SELECT summary FROM scans ORDER BY finished_at DESC LIMIT 1');
    return rows[0] ? (JSON.parse(rows[0].summary) as ScanSummary) : null;
  }

  addCleaning(entry: Omit<HistoryEntry, 'id'>, items: CleanItemResult[]): number {
    this.db.run('INSERT INTO cleanings(date, mode, removed, failed, skipped, bytes, categories, source) VALUES(?,?,?,?,?,?,?,?)', [
      entry.date, entry.mode, entry.removed, entry.failed, entry.skipped, entry.bytes, JSON.stringify(entry.categories), entry.source,
    ]);
    const id = Number(this.all<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id);
    this.db.exec('BEGIN');
    const stmt = this.db.prepare('INSERT INTO cleaning_items(cleaning_id, path, size, category, status, error) VALUES(?,?,?,?,?,?)');
    try {
      for (const it of items) stmt.run([id, it.path, it.size, it.categoryId, it.status, it.error ?? null]);
    } finally {
      stmt.free();
      this.db.exec('COMMIT');
    }
    this.persist();
    return id;
  }

  private rowToEntry(r: Record<string, unknown>): HistoryEntry {
    return {
      id: Number(r.id), date: Number(r.date), mode: r.mode as HistoryEntry['mode'], removed: Number(r.removed),
      failed: Number(r.failed), skipped: Number(r.skipped), bytes: Number(r.bytes),
      categories: JSON.parse(String(r.categories || '[]')), source: String(r.source || ''),
    };
  }

  listCleanings(limit = 500): HistoryEntry[] {
    return this.all<Record<string, unknown>>('SELECT * FROM cleanings ORDER BY date DESC LIMIT ?', [limit]).map((r) => this.rowToEntry(r));
  }

  cleaningDetails(id: number): HistoryDetails | null {
    const r = this.all<Record<string, unknown>>('SELECT * FROM cleanings WHERE id = ?', [id])[0];
    if (!r) return null;
    const items = this.all<Record<string, unknown>>('SELECT * FROM cleaning_items WHERE cleaning_id = ? LIMIT 100000', [id]).map((i) => ({
      path: String(i.path), size: Number(i.size), categoryId: String(i.category), status: i.status as CleanItemResult['status'],
      error: i.error ? String(i.error) : undefined,
    }));
    return { ...this.rowToEntry(r), items };
  }

  totals(): { bytes: number; count: number } {
    const r = this.all<{ b: number; c: number }>('SELECT COALESCE(SUM(bytes),0) AS b, COUNT(*) AS c FROM cleanings')[0];
    return { bytes: Number(r.b), count: Number(r.c) };
  }

  pruneHistory(retentionDays: number) {
    if (!retentionDays || retentionDays <= 0) return;
    const cutoff = Date.now() - retentionDays * 86400_000;
    this.db.run('DELETE FROM cleaning_items WHERE cleaning_id IN (SELECT id FROM cleanings WHERE date < ?)', [cutoff]);
    this.db.run('DELETE FROM cleanings WHERE date < ?', [cutoff]);
    this.persist();
  }

  clearHistory() {
    this.db.exec('DELETE FROM cleaning_items; DELETE FROM cleanings;');
    this.persist();
  }
}
