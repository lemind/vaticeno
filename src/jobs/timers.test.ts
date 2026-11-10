// The feed's systemd timers carry the same times as SCHEDULES, the one job list (src/jobs/scheduler.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SCHEDULES, TIMER_JOBS } from './scheduler.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "23 9,18 * * *" → ["*/09:23", "*/18:23"]; "11 15 * * 2-4" → ["Tue/15:11", "Wed/15:11", "Thu/15:11"].
function fromCron(expr: string): string[] {
  const [m, h, , , dow] = expr.split(' ') as [
    string,
    string,
    string,
    string,
    string,
  ];
  const days =
    dow === '*'
      ? ['*']
      : dow.includes('-')
        ? DAYS.slice(Number(dow.split('-')[0]), Number(dow.split('-')[1]) + 1)
        : [DAYS[Number(dow)]!];
  return days.flatMap((d) =>
    h.split(',').map((hh) => `${d}/${hh.padStart(2, '0')}:${m.padStart(2, '0')}`),
  );
}

function fromTimer(text: string): string[] {
  return [
    ...text.matchAll(
      /^OnCalendar=(?:(\w+)(?:\.\.(\w+))? )?\*-\*-\* (\d\d):(\d\d):00 UTC$/gm,
    ),
  ].flatMap(([, from, to, hh, mm]) => {
    const days = !from
      ? ['*']
      : to
        ? DAYS.slice(DAYS.indexOf(from), DAYS.indexOf(to) + 1)
        : [from];
    return days.map((d) => `${d}/${hh}:${mm}`);
  });
}

test('every feed timer fires exactly when SCHEDULES says', () => {
  for (const job of TIMER_JOBS) {
    const timer = readFileSync(`deploy/vaticeno-content-${job}.timer`, 'utf8');
    assert.deepEqual(fromTimer(timer).sort(), fromCron(SCHEDULES[job]).sort(), job);
    assert.match(timer, new RegExp(`^Unit=vaticeno-content@${job}\\.service$`, 'm'));
  }
});
