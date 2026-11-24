/** Scheduled scanning: pure date logic + a small runner. Scheduled scans never delete anything. */
import type { ScheduleSettings } from '../src/shared/types';

function atTime(d: Date, time: string): Date {
  const [h, m] = time.split(':').map((x) => parseInt(x, 10));
  const r = new Date(d);
  r.setHours(isFinite(h) ? h : 0, isFinite(m) ? m : 0, 0, 0);
  return r;
}

/** The first scheduled moment strictly after `after`. */
export function nextRun(s: ScheduleSettings, after: Date): Date {
  if (s.frequency === 'custom') return new Date(after.getTime() + Math.max(1, s.customHours) * 3600_000);
  let c = atTime(after, s.time);
  for (let i = 0; i < 400; i++) {
    const ok =
      s.frequency === 'daily' ||
      (s.frequency === 'weekly' && c.getDay() === s.weekday) ||
      (s.frequency === 'monthly' && c.getDate() === Math.min(28, Math.max(1, s.monthDay)));
    if (ok && c.getTime() > after.getTime()) return c;
    c = atTime(new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1), s.time);
  }
  return c;
}

/** A scan is due when the next run after the last run (or after the schedule was set up) has passed. */
export function isDue(s: ScheduleSettings, lastRunOrAnchor: number, now: number): boolean {
  if (!s.enabled) return false;
  return nextRun(s, new Date(lastRunOrAnchor)).getTime() <= now;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private get: () => { schedule: ScheduleSettings; lastRun: number; anchor: number },
    private run: () => Promise<void>,
  ) {}
  private running = false;

  start() {
    this.stop();
    this.timer = setInterval(() => void this.check(), 60_000);
    setTimeout(() => void this.check(), 15_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async check() {
    if (this.running) return;
    const { schedule, lastRun, anchor } = this.get();
    if (!isDue(schedule, Math.max(lastRun, anchor), Date.now())) return;
    this.running = true;
    try {
      await this.run();
    } finally {
      this.running = false;
    }
  }
}
