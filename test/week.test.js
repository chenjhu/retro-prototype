import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekIdOf, weekDates, shiftWeek, isValidWeekId, isValidDate } from '../shared/week.js';

test('ISO week ids, including year boundaries', () => {
  assert.equal(weekIdOf('2026-11-02'), '2026-W45');
  assert.equal(weekIdOf('2026-11-08'), '2026-W45'); // Sunday stays in the same week
  assert.equal(weekIdOf('2025-12-29'), '2026-W01'); // Monday belongs to next year's week 1
  assert.equal(weekIdOf('2027-01-01'), '2026-W53');
  assert.equal(weekIdOf('2021-01-03'), '2020-W53');
});

test('weekDates returns Monday..Sunday', () => {
  assert.deepEqual(weekDates('2026-W45'), [
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
  ]);
  assert.equal(weekDates('2026-W01')[0], '2025-12-29');
});

test('shiftWeek crosses years', () => {
  assert.equal(shiftWeek('2026-W53', 1), '2027-W01');
  assert.equal(shiftWeek('2027-W01', -1), '2026-W53');
  assert.equal(shiftWeek('2026-W45', -45), '2025-W52');
});

test('validation', () => {
  assert.ok(isValidWeekId('2026-W53'));
  assert.ok(!isValidWeekId('2025-W53')); // 2025 has 52 weeks
  assert.ok(!isValidWeekId('2026-W00'));
  assert.ok(!isValidWeekId('../etc'));
  assert.ok(!isValidDate('2026-02-30'));
});
