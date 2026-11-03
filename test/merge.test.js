import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWeeks } from '../shared/merge.js';
import { emptyWeek } from '../shared/model.js';

const ID = '2026-W45';

test('merge only adds; existing tasks and their state are kept', () => {
  const base = emptyWeek(ID);
  base.pinned = [{ text: 'Visa form', done: true }];
  base.days[0].items.Work = [{ text: 'Email Arup', done: false }];

  const incoming = emptyWeek(ID);
  incoming.pinned = [{ text: 'visa form', done: false }, { text: 'Wait for TEP', done: false }];
  incoming.days[0].items.Work = [{ text: 'Email Arup', done: true }, { text: 'Gen A Fellowship', done: true }];
  incoming.summary = [{ text: 'FCL is closing', done: false }];

  const { week, added } = mergeWeeks(base, incoming);
  assert.deepEqual(week.pinned, [
    { text: 'Visa form', done: true }, // not downgraded, not duplicated
    { text: 'Wait for TEP', done: false },
  ]);
  assert.deepEqual(week.days[0].items.Work, [
    { text: 'Email Arup', done: true }, // upgraded to done
    { text: 'Gen A Fellowship', done: true },
  ]);
  assert.deepEqual(week.summary, [{ text: 'FCL is closing', done: false }]);
  assert.equal(added.length, 3);
  assert.equal(base.pinned.length, 1); // input not mutated
});

test('merging the same file twice adds nothing the second time', () => {
  const incoming = emptyWeek(ID);
  incoming.days[1].items.Academic = [{ text: 'Read paper', done: false }];
  const once = mergeWeeks(emptyWeek(ID), incoming).week;
  assert.deepEqual(mergeWeeks(once, incoming).added, []);
});
