import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekToMarkdown, markdownToWeek } from '../shared/markdown.js';
import { emptyWeek, normalizeWeek } from '../shared/model.js';

const ID = '2026-W45';

function sample() {
  const w = emptyWeek(ID);
  w.pinned = [{ text: 'Submit application', done: false }];
  w.days[0].items.Academic = [{ text: 'Read paper A', done: true }, { text: 'Problem set 3', done: false }];
  w.days[2].items.Personal = [{ text: 'Gym', done: false }];
  w.summary = [{ text: 'Shipped the draft', done: true }];
  w.notes = 'Good week overall.\n\n- learned X';
  return w;
}

test('round-trips through Markdown', () => {
  const w = sample();
  const md = weekToMarkdown(w);
  assert.deepEqual(markdownToWeek(md, ID), normalizeWeek(w));
  assert.equal(weekToMarkdown(markdownToWeek(md, ID)), md); // stable output
});

test('Markdown layout is what agents expect', () => {
  const md = weekToMarkdown(sample());
  assert.match(md, /^# Week 2026-W45 \(2026-11-02 to 2026-11-08\)\n/);
  assert.match(md, /## Pinned\n\n- \[ \] Submit application\n/);
  assert.match(md, /## Mon 2026-11-02\n\n### Academic\n\n- \[x\] Read paper A\n- \[ \] Problem set 3\n\n### Work\n\n### Personal\n/);
  assert.match(md, /## Summary\n\n- \[x\] Shipped the draft\n\n## Notes\n\nGood week overall\.\n\n- learned X\n$/);
});

test('parser tolerates hand / agent edits', () => {
  const md = `# whatever title

## pinned
* [X] done thing
- plain bullet becomes a task

## Wednesday (2026-11-04)
### work
+ [ ] lower-case category merges with Work
### Health
- [ ] new category is kept

## Some random section
- [ ] ignored

## Mon 2026-10-26
- [ ] date outside this week is ignored
`;
  const w = markdownToWeek(md, ID);
  assert.deepEqual(w.pinned, [
    { text: 'done thing', done: true },
    { text: 'plain bullet becomes a task', done: false },
  ]);
  assert.deepEqual(w.categories, ['Academic', 'Work', 'Personal', 'Health']);
  const wed = w.days.find((d) => d.date === '2026-11-04');
  assert.deepEqual(wed.items.Work, [{ text: 'lower-case category merges with Work', done: false }]);
  assert.deepEqual(wed.items.Health, [{ text: 'new category is kept', done: false }]);
  assert.equal(w.days.flatMap((d) => Object.values(d.items).flat()).length, 2);
});

test('normalize strips newlines and empty items, rejects bad ids', () => {
  const w = emptyWeek(ID);
  w.days[1].items.Work = [{ text: 'multi\nline' }, { text: '   ' }];
  assert.deepEqual(normalizeWeek(w).days[1].items.Work, [{ text: 'multi line', done: false }]);
  assert.throws(() => normalizeWeek({ ...w, week: '2026-W44' }, ID), /mismatch/);
  assert.throws(() => normalizeWeek(w, 'nope'), /Invalid week/);
});
