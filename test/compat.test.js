// Data stability: files written by earlier versions of the app must keep loading
// with nothing lost. Never edit the fixtures; add a new one when the format changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { markdownToWeek, weekToMarkdown } from '../shared/markdown.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('v1 files (with the old "Academics" name) load completely', () => {
  const w = markdownToWeek(fixture('v1-2026-W45.md'), '2026-W45');
  assert.deepEqual(w.categories, ['Academic', 'Work', 'Personal']);
  assert.deepEqual(w.pinned, [
    { text: 'Visa form', done: false },
    { text: 'Book flights', done: true },
  ]);
  assert.deepEqual(w.days[0].items, {
    Academic: [
      { text: 'Read paper A', done: true },
      { text: 'Problem set 3', done: false },
    ],
    Work: [{ text: 'Team sync', done: false }],
    Personal: [],
  });
  assert.deepEqual(w.days[1].items.Personal, [{ text: 'Gym', done: false }]);
  assert.deepEqual(w.summary, [{ text: 'Deep work blocks worked well', done: false }]);
});

test('re-saving a v1 file keeps every task', () => {
  const count = (md) => (md.match(/^- \[[ x]\] /gm) ?? []).length;
  const v1 = fixture('v1-2026-W45.md');
  const resaved = weekToMarkdown(markdownToWeek(v1, '2026-W45'));
  assert.equal(count(resaved), count(v1));
  assert.match(resaved, /### Academic\n\n- \[x\] Read paper A/);
});
