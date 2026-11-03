import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { createApi, createStore } from '../public/js/store.js';

let server, base, dataDir;
const ID = '2026-W45';

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-review-'));
  server = createApp({ dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('GET a missing week returns an empty template without creating a file', async () => {
  const res = await fetch(`${base}/api/weeks/2026-W40`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.version, 'empty');
  assert.equal(body.days.length, 7);
  assert.ok(!fs.existsSync(path.join(dataDir, '2026-W40.md')));
});

test('PUT writes Markdown; If-Match guards against overwriting newer edits', async () => {
  const w = await (await fetch(`${base}/api/weeks/${ID}`)).json();
  w.days[0].items.Work.push({ text: 'Email Prof. Li', done: false });

  const put = (body, version) =>
    fetch(`${base}/api/weeks/${ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': `"${version}"` },
      body: JSON.stringify(body),
    });

  const ok = await put(w, w.version);
  assert.equal(ok.status, 200);
  const saved = await ok.json();
  const file = fs.readFileSync(path.join(dataDir, `${ID}.md`), 'utf8');
  assert.match(file, /### Work\n\n- \[ \] Email Prof\. Li\n/);

  const stale = await put(w, w.version); // same old version again
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.version, saved.version);
});

test('raw Markdown and export endpoints', async () => {
  const md = await (await fetch(`${base}/api/weeks/${ID}.md`)).text();
  assert.match(md, /^# Week 2026-W45/);
  const exp = await (await fetch(`${base}/api/export`)).json();
  assert.deepEqual(exp.weeks.map((w) => w.week), [ID]);
});

test('rejects bad ids and path traversal', async () => {
  assert.equal((await fetch(`${base}/api/weeks/2026-W99`)).status, 400);
  assert.equal((await fetch(`${base}/api/weeks/..%2F..%2Fetc`)).status, 404);
  assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 404);
  assert.equal((await fetch(`${base}/shared/week.js`)).status, 200);
});

test('live event fires when the file is edited outside the app', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  await reader.read(); // retry header
  fs.appendFileSync(path.join(dataDir, `${ID}.md`), '\n');
  let text = '';
  while (!text.includes('week-changed')) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"week":"2026-W45"/);
  ctrl.abort();
});

test('store: edits autosave, and concurrent agent edits are merged not lost', async () => {
  const store = createStore({ api: createApi(base), saveDelay: 10 });
  await store.load(ID);
  const loc = { list: 'day', date: '2026-11-03', category: 'Academics' };
  const id = store.addItem(loc, 'Lecture notes');
  store.toggle(loc, id, true);

  // Meanwhile an agent appends a pinned task directly in the Markdown file.
  const file = path.join(dataDir, `${ID}.md`);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## Pinned\n\n', '## Pinned\n\n- [ ] From agent\n'));

  await store.flush();
  const md = fs.readFileSync(file, 'utf8');
  assert.match(md, /- \[ \] From agent/);
  assert.match(md, /## Tue 2026-11-03\n\n### Academics\n\n- \[x\] Lecture notes/);
  assert.match(md, /Email Prof\. Li/);
  assert.equal(store.hasUnsaved, false);
});
