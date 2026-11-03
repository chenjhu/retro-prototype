// Retro — a zero-dependency local server.
//
// Stores one Markdown file per ISO week in DATA_DIR (default ./data), serves the
// web UI, and exposes a small JSON API. Run:  node server   (or: npm start)
// Env: PORT (default 4173), HOST (default 0.0.0.0 so your phone on the same
// network can reach it), DATA_DIR.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { weekToMarkdown, markdownToWeek } from '../shared/markdown.js';
import { emptyWeek, normalizeWeek, DEFAULT_CATEGORIES } from '../shared/model.js';
import { isValidWeekId, currentWeekId, todayLocal, weekDates } from '../shared/week.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const versionOf = (text) =>
  text == null ? 'empty' : crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

const BACKUP_DAYS = 30;

/** Fingerprint of the web app's code. Changes whenever public/ or shared/ change, so
 *  open pages (including ones added to the iPhone home screen) know to reload. */
function appVersion() {
  const hash = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else hash.update(name).update(fs.readFileSync(p));
    }
  };
  walk(path.join(ROOT, 'public'));
  walk(path.join(ROOT, 'shared'));
  return hash.digest('hex').slice(0, 12);
}

/** Keep a copy of the format guide (checkbox rules, abbreviations…) inside the data
 *  folder, so an agent given only that folder knows how to read it. */
function writeDataReadme(dataDir) {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'DATA_FORMAT.md'), 'utf8');
  const text =
    '<!-- Written by Retro on startup from docs/DATA_FORMAT.md in the app. Edits here are overwritten. -->\n\n' + guide;
  const dest = path.join(dataDir, 'README.md');
  try {
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === text) return;
    fs.writeFileSync(dest, text);
  } catch (e) {
    console.warn(`Could not write ${dest}: ${e.message}`);
  }
}

export function createApp({ dataDir = path.join(ROOT, 'data') } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  writeDataReadme(dataDir);
  const APP = appVersion();
  const fileFor = (id) => path.join(dataDir, `${id}.md`);
  const clients = new Set();

  async function readWeek(id) {
    let text = null;
    try {
      text = await fsp.readFile(fileFor(id), 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const week = text == null ? emptyWeek(id) : markdownToWeek(text, id);
    return { week, version: versionOf(text), markdown: text ?? weekToMarkdown(week) };
  }

  // Serialise writes per file so concurrent PUTs can't interleave.
  const locks = new Map();
  function withLock(id, fn) {
    const prev = locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(id, next.catch(() => {}));
    return next;
  }

  async function writeWeek(id, input, ifMatch) {
    return withLock(id, async () => {
      const current = await readWeek(id);
      if (ifMatch && ifMatch !== current.version) {
        return { conflict: true, ...current };
      }
      const week = normalizeWeek(input, id);
      const markdown = weekToMarkdown(week);
      if (current.version !== 'empty' && markdown !== current.markdown) await backup(id);
      const tmp = `${fileFor(id)}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, markdown, 'utf8');
      await fsp.rename(tmp, fileFor(id)); // atomic replace
      return { conflict: false, week, version: versionOf(markdown), markdown };
    });
  }

  // Safety net: the first time a week file changes on a given day, keep a copy of it
  // as it was in DATA_DIR/.backups/YYYY-MM-DD/. Only the last BACKUP_DAYS days are kept.
  const backupRoot = path.join(dataDir, '.backups');
  async function backup(id) {
    const dir = path.join(backupRoot, todayLocal());
    const dest = path.join(dir, `${id}.md`);
    if (fs.existsSync(dest)) return;
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(fileFor(id), dest);
    const days = (await fsp.readdir(backupRoot)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (const old of days.slice(0, -BACKUP_DAYS)) {
      await fsp.rm(path.join(backupRoot, old), { recursive: true, force: true });
    }
  }

  async function listWeeks() {
    const names = await fsp.readdir(dataDir);
    return names
      .filter((n) => n.endsWith('.md') && isValidWeekId(n.slice(0, -3)))
      .map((n) => n.slice(0, -3))
      .sort();
  }

  // ---- Live updates: notify browsers when any week file changes (incl. edits by agents)
  const pending = new Map();
  const watcher = fs.watch(dataDir, (_event, filename) => {
    if (!filename || !filename.endsWith('.md')) return;
    const id = filename.slice(0, -3);
    if (!isValidWeekId(id)) return;
    clearTimeout(pending.get(id));
    pending.set(
      id,
      setTimeout(async () => {
        pending.delete(id);
        const { version } = await readWeek(id).catch(() => ({ version: null }));
        const msg = `event: week-changed\ndata: ${JSON.stringify({ week: id, version })}\n\n`;
        for (const res of clients) res.write(msg);
      }, 120),
    );
  });

  // ---- HTTP helpers
  const send = (res, status, body, headers = {}) => {
    const isText = typeof body === 'string';
    res.writeHead(status, {
      'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(isText ? body : JSON.stringify(body, null, 2));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error('Body too large'), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  async function serveStatic(res, baseDir, rel) {
    const file = path.resolve(baseDir, '.' + path.posix.normalize('/' + rel));
    if (!file.startsWith(baseDir + path.sep)) return send(res, 404, 'Not found');
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    } catch {
      send(res, 404, 'Not found');
    }
  }

  // ---- Routes
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    let m;

    if (p === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        app: APP,
        today: todayLocal(),
        currentWeek: currentWeekId(),
        defaultCategories: DEFAULT_CATEGORIES,
      });
    }

    if (p === '/api/weeks' && req.method === 'GET') {
      return send(res, 200, { weeks: await listWeeks() });
    }

    if ((m = /^\/api\/weeks\/([^/]+?)(\.md)?$/.exec(p))) {
      const [, id, asMarkdown] = m;
      if (!isValidWeekId(id)) return send(res, 400, { error: `Invalid week id: ${id}` });

      if (req.method === 'GET') {
        const r = await readWeek(id);
        if (asMarkdown) {
          return send(res, 200, r.markdown, { 'Content-Type': 'text/markdown; charset=utf-8', ETag: `"${r.version}"` });
        }
        return send(res, 200, { ...r.week, dates: weekDates(id), version: r.version }, { ETag: `"${r.version}"` });
      }

      if (req.method === 'PUT') {
        const raw = await readBody(req);
        let input;
        if (asMarkdown) input = markdownToWeek(raw, id);
        else {
          try {
            input = JSON.parse(raw);
          } catch {
            return send(res, 400, { error: 'Body is not valid JSON' });
          }
        }
        const ifMatch = req.headers['if-match']?.replace(/^W\//, '').replace(/"/g, '') || null;
        let r;
        try {
          r = await writeWeek(id, input, ifMatch);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        const body = { ...r.week, dates: weekDates(id), version: r.version };
        if (r.conflict) return send(res, 409, { error: 'Version conflict', current: body });
        return send(res, 200, body, { ETag: `"${r.version}"` });
      }

      return send(res, 405, { error: 'Method not allowed' });
    }

    if (p === '/api/export' && req.method === 'GET') {
      const weeks = [];
      for (const id of await listWeeks()) weeks.push((await readWeek(id)).week);
      return send(res, 200, { exportedAt: new Date().toISOString(), weeks });
    }

    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      res.write(`event: hello\ndata: ${JSON.stringify({ app: APP })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    if (p.startsWith('/shared/')) return serveStatic(res, path.join(ROOT, 'shared'), p.slice('/shared/'.length));
    return serveStatic(res, path.join(ROOT, 'public'), p === '/' ? 'index.html' : p);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, e.status ?? 500, { error: e.status ? e.message : 'Internal error' });
      else res.end();
    });
  });

  server.on('close', () => {
    watcher.close();
    for (const res of clients) res.end();
  });

  return server;
}

// ---- Entry point
const entry = process.argv[1] && fs.existsSync(process.argv[1]) ? fs.realpathSync(process.argv[1]) : '';
const self = fs.realpathSync(fileURLToPath(import.meta.url));
if (entry === self || entry === path.dirname(self)) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '0.0.0.0';
  const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data'));
  const server = createApp({ dataDir });
  server.listen(port, host, () => {
    console.log(`Retro running. Data: ${dataDir}`);
    console.log(`  This computer:  http://localhost:${port}`);
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  Phone (same Wi-Fi): http://${a.address}:${port}`);
      }
    }
  });
}
