import { describe, expect, it } from 'vitest';
import { isDue, nextRun } from '../electron/scheduler';
import type { ScheduleSettings } from '../src/shared/types';

const base: ScheduleSettings = { enabled: true, frequency: 'daily', time: '19:00', weekday: 0, monthDay: 1, customHours: 72 };

describe('scheduler', () => {
  it('computes daily, weekly, monthly and custom runs', () => {
    const from = new Date(2026, 0, 7, 20, 0); // Wed 7 Jan 2026 20:00
    expect(nextRun(base, from)).toEqual(new Date(2026, 0, 8, 19, 0));
    expect(nextRun(base, new Date(2026, 0, 7, 18, 0))).toEqual(new Date(2026, 0, 7, 19, 0));
    expect(nextRun({ ...base, frequency: 'weekly', weekday: 0 }, from)).toEqual(new Date(2026, 0, 11, 19, 0));
    expect(nextRun({ ...base, frequency: 'monthly', monthDay: 3 }, from)).toEqual(new Date(2026, 1, 3, 19, 0));
    expect(nextRun({ ...base, frequency: 'custom', customHours: 6 }, from)).toEqual(new Date(2026, 0, 8, 2, 0));
  });
  it('is due only after the scheduled moment and never when disabled', () => {
    const last = new Date(2026, 0, 7, 20, 0).getTime();
    expect(isDue(base, last, new Date(2026, 0, 8, 18, 59).getTime())).toBe(false);
    expect(isDue(base, last, new Date(2026, 0, 8, 19, 0).getTime())).toBe(true);
    expect(isDue({ ...base, enabled: false }, last, new Date(2027, 0, 1).getTime())).toBe(false);
  });
});
