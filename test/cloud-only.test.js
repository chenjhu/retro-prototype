// OneDrive "Files On-Demand": a week file moved to the cloud can't be read by the
// background service (macOS errno -11). The app must explain it and keep working.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { createApi, createStore } from '../public/js/store.js';

let server, base, dataDir;
const W = '2026-W47';
const cloudOnly = new Set([W]); // files OneDrive has moved off the Mac
let attempts = 0;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-cloud-'));
  fs.writeFileSync(path.join(dataDir, `${W}.md`), '## Pinned\n\n- [ ] Already on the Mac\n');
  const readFile = async (file, enc) => {
    if (cloudOnly.has(path.basename(file, '.md'))) {
      attempts++;
      throw Object.assign(new Error('Unknown system error -11'), { errno: -11, code: 'Unknown system error -11', syscall: 'read' });
    }
    return fsp.readFile(file, enc);
  };
  server = createApp({ dataDir, readFile });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

test('reading a cloud-only file: retried, then a clear 503 instead of "Internal error"', async () => {
  attempts = 0;
  const res = await fetch(`${base}/api/weeks/${W}`);
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.match(body.error, /OneDrive.*Always Keep on This Device/);
  assert.equal(attempts, 3);
});

test('saving to a cloud-only file is a 503 too (not a "bad request")', async () => {
  const res = await fetch(`${base}/api/weeks/${W}`, { method: 'PUT', body: JSON.stringify({ week: W, pinned: [] }) });
  assert.equal(res.status, 503);
  assert.match(fs.readFileSync(path.join(dataDir, `${W}.md`), 'utf8'), /Already on the Mac/); // untouched
});

test('the page keeps working and catches up once the folder is kept on the Mac', async () => {
  const app = createStore({ api: createApi(base, fetch, { timeoutMs: 5000 }), saveDelay: 10, storage: memoryStorage() });
  await app.load(W);
  assert.equal(app.state.status, 'unavailable');
  assert.equal(app.state.week.days.length, 7); // a usable week, not a blank page

  app.addItem({ list: 'pinned' }, 'Added while the file was in the cloud');
  await app.flush();
  assert.equal(app.state.status, 'unavailable');
  assert.equal(app.hasUnsaved, true);

  cloudOnly.delete(W); // the user chose "Always Keep on This Device"
  await app.refresh();
  await app.flush();
  const md = fs.readFileSync(path.join(dataDir, `${W}.md`), 'utf8');
  assert.match(md, /- \[ \] Already on the Mac/); // nothing on the Mac was lost
  assert.match(md, /- \[ \] Added while the file was in the cloud/);
  assert.equal(app.state.status, 'ready');
  assert.equal(app.hasUnsaved, false);
});
