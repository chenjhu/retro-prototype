// Offline: edits survive losing the Mac and closing the app, then reach the file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { createApi, createStore } from '../public/js/store.js';

let server, base, dataDir;
const W = '2026-W45';
const file = (id = W) => path.join(dataDir, `${id}.md`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-offline-'));
  server = createApp({ dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** localStorage stand-in (one per "phone"). */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/** A network we can switch off, or make "lose" the reply after the Mac got the request. */
function network() {
  const net = { mode: 'online' };
  net.fetch = async (url, opts) => {
    if (net.mode === 'offline') throw new TypeError('fetch failed');
    const res = await fetch(url, opts);
    if (net.mode === 'lose-replies' && opts?.method === 'PUT') throw new TypeError('connection lost');
    return res;
  };
  return net;
}

const phone = (net, storage) => createStore({ api: createApi(base, net.fetch, { timeoutMs: 2000 }), saveDelay: 10, storage });
const mon = { list: 'day', date: '2026-11-02', category: 'Work' };

test('edits made offline survive closing the app and are sent later', async () => {
  const net = network();
  const storage = memoryStorage();
  let app = phone(net, storage);
  await app.load(W);

  net.mode = 'offline';
  const id = app.addItem(mon, '');
  app.setText(mon, id, 'Written on the train');
  await app.flush();
  assert.equal(app.state.status, 'offline');
  assert.ok(!fs.existsSync(file()) || !fs.readFileSync(file(), 'utf8').includes('Written on the train'));

  // The app is closed and opened again, still offline: the edit is still there.
  app = phone(net, storage);
  await app.load(W);
  assert.deepEqual(app.listAt(mon).map((i) => i.text), ['Written on the train']);

  // Back online: it reaches the Mac.
  net.mode = 'online';
  await app.refresh();
  await app.flush();
  assert.match(fs.readFileSync(file(), 'utf8'), /### Work\n\n- \[ \] Written on the train/);
  assert.equal(app.hasUnsaved, false);
});

test('opening the app with the Mac unreachable shows the last copy', async () => {
  const net = network();
  const storage = memoryStorage();
  let app = phone(net, storage);
  await app.load(W); // seen once while online
  net.mode = 'offline';
  app = phone(net, storage);
  await app.load(W);
  assert.equal(app.state.status, 'offline');
  assert.deepEqual(app.listAt(mon).map((i) => i.text), ['Written on the train']);
});

test('a week never opened before can still be edited offline', async () => {
  const net = network();
  net.mode = 'offline';
  const app = phone(net, memoryStorage());
  await app.load('2026-W50');
  assert.equal(app.state.week.days.length, 7);
  app.addItem({ list: 'pinned' }, 'Plan for December');
  await app.flush();
  net.mode = 'online';
  await app.refresh();
  await app.flush();
  assert.match(fs.readFileSync(file('2026-W50'), 'utf8'), /## Pinned\n\n- \[ \] Plan for December/);
});

test('offline edits and edits on the Mac meanwhile are both kept', async () => {
  const net = network();
  const app = phone(net, memoryStorage());
  await app.load(W);
  net.mode = 'offline';
  app.addItem({ list: 'pinned' }, 'From the phone');
  await app.flush();

  // Meanwhile on the Mac (or by an agent):
  fs.writeFileSync(file(), fs.readFileSync(file(), 'utf8').replace('## Pinned\n\n', '## Pinned\n\n- [ ] From the Mac\n'));

  net.mode = 'online';
  await app.refresh();
  await app.flush();
  const md = fs.readFileSync(file(), 'utf8');
  assert.match(md, /- \[ \] From the Mac/);
  assert.match(md, /- \[ \] From the phone/);
});

test('a reply lost after the Mac saved does not create duplicates', async () => {
  const net = network();
  const app = phone(net, memoryStorage());
  await app.load(W);
  net.mode = 'lose-replies';
  app.addItem({ list: 'summary' }, 'Saved but unconfirmed');
  await app.flush(); // the Mac wrote it, the phone never heard back
  assert.equal(app.hasUnsaved, true);
  net.mode = 'online';
  await app.refresh();
  await app.flush();
  const count = (fs.readFileSync(file(), 'utf8').match(/Saved but unconfirmed/g) ?? []).length;
  assert.equal(count, 1);
});

test('edits waiting for another week are sent too', async () => {
  const net = network();
  const storage = memoryStorage();
  const app = phone(net, storage);
  await app.load('2026-W46');
  net.mode = 'offline';
  app.addItem({ list: 'pinned' }, 'Next week task');
  await app.flush();
  await app.load(W); // move on to another week while still offline
  await sleep(20);
  net.mode = 'online';
  await app.refresh(); // also sends what's waiting for W46
  await sleep(200);
  assert.match(fs.readFileSync(file('2026-W46'), 'utf8'), /- \[ \] Next week task/);
  assert.deepEqual(JSON.parse(storage.getItem('retro.week.2026-W46')).ops, []);
});

test('switching weeks never carries unsent edits into the other week', async () => {
  const net = network();
  const app = phone(net, memoryStorage());
  await app.load('2026-W47');
  net.mode = 'offline';
  app.addItem({ list: 'pinned' }, 'Belongs to W47');
  await app.flush();
  await app.load('2026-W48');
  assert.deepEqual(app.listAt({ list: 'pinned' }), []);
  net.mode = 'online';
  await app.refresh();
  await sleep(200);
  assert.ok(!fs.existsSync(file('2026-W48')) || !fs.readFileSync(file('2026-W48'), 'utf8').includes('Belongs to W47'));
  assert.match(fs.readFileSync(file('2026-W47'), 'utf8'), /Belongs to W47/);
});
