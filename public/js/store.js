// UI-agnostic client state for one week: loading, edits, debounced autosave,
// conflict merging and live reload when the file changes on disk (e.g. an AI
// agent edited the Markdown). The UI only calls actions and re-renders on change.
//
// Offline: every edit is also written to this device's storage straight away
// (week + unsent edits). If the Mac can't be reached, the app keeps working from
// that copy, survives being closed, and sends the edits once it's back, merging
// them onto whatever changed on the Mac in the meantime.
//
// Item locations:  { list: 'pinned' }, { list: 'summary' }
//                  or { list: 'day', date: 'YYYY-MM-DD', category: 'Work' }
// Items carry a client-only `id` for rendering; it is never saved.

import { emptyWeek } from '../../shared/model.js';
import { weekDates } from '../../shared/week.js';

// Ids must stay unique across app restarts (saved edits refer to them).
const SESSION = Math.random().toString(36).slice(2, 7);
let nextId = 1;
const newId = () => `${SESSION}${nextId++}`;

const withIds = (week) => ({
  ...week,
  pinned: week.pinned.map((it) => ({ ...it, id: newId() })),
  summary: (week.summary ?? []).map((it) => ({ ...it, id: newId() })),
  days: week.days.map((d) => ({
    ...d,
    items: Object.fromEntries(Object.entries(d.items).map(([c, l]) => [c, l.map((it) => ({ ...it, id: newId() }))])),
  })),
});

const plain = ({ text, done, highlight }) => (highlight ? { text, done, highlight } : { text, done });

const stripIds = (week) => ({
  week: week.week,
  categories: week.categories,
  pinned: week.pinned.map(plain),
  summary: week.summary.map(plain),
  days: week.days.map((d) => ({
    date: d.date,
    items: Object.fromEntries(Object.entries(d.items).map(([c, l]) => [c, l.map(plain)])),
  })),
  notes: week.notes,
});

function listAt(week, loc) {
  if (loc.list === 'pinned') return week.pinned;
  if (loc.list === 'summary') return week.summary;
  const day = week.days.find((d) => d.date === loc.date);
  if (!day) throw new Error(`No day ${loc.date} in ${week.week}`);
  return (day.items[loc.category] ??= []);
}

// An op is applied to a week draft. Items are located by id when available, and by
// their text at the time of the op when replaying onto a newer server copy.
function findIndex(list, ref) {
  let i = ref.id ? list.findIndex((it) => it.id === ref.id) : -1;
  if (i === -1) i = list.findIndex((it) => it.text === ref.text);
  return i;
}

function applyOp(week, op) {
  const list = listAt(week, op.loc);
  switch (op.type) {
    case 'add': {
      const item = { id: op.id, text: op.text, done: false };
      const at = op.index == null ? list.length : Math.min(op.index, list.length);
      list.splice(at, 0, item);
      return;
    }
    case 'update': {
      const i = findIndex(list, op.ref);
      if (i !== -1) Object.assign(list[i], op.patch);
      return;
    }
    case 'remove': {
      const i = findIndex(list, op.ref);
      if (i !== -1) list.splice(i, 1);
      return;
    }
    case 'move': {
      const i = findIndex(list, op.ref);
      if (i === -1) return;
      const [item] = list.splice(i, 1);
      const dest = listAt(week, op.to);
      dest.splice(Math.min(op.index ?? dest.length, dest.length), 0, item);
      return;
    }
    default:
      throw new Error(`Unknown op ${op.type}`);
  }
}

/**
 * Apply unsent edits on top of a (newer) server copy. If an earlier send actually
 * reached the Mac but its reply was lost, the server copy already contains the new
 * tasks: those re-added duplicates are dropped.
 */
function replay(base, ops) {
  const added = new Set();
  for (const op of ops) {
    applyOp(base, op);
    if (op.type === 'add') added.add(op.id);
  }
  if (!added.size) return base;
  const lists = [base.pinned, base.summary, ...base.days.flatMap((d) => Object.values(d.items))];
  for (const list of lists) {
    const existing = new Set(list.filter((it) => !added.has(it.id)).map((it) => it.text.trim()));
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (added.has(it.id) && it.text.trim() && existing.has(it.text.trim())) list.splice(i, 1);
    }
  }
  return base;
}

export function createApi(base = '', fetchImpl = (...a) => fetch(...a), { timeoutMs = 5000 } = {}) {
  // An unreachable Mac can leave a request hanging for a minute; give up sooner.
  const go = (url, opts = {}) =>
    fetchImpl(url, typeof AbortSignal?.timeout === 'function' ? { ...opts, signal: AbortSignal.timeout(timeoutMs) } : opts);
  const json = async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
    return { status: res.status, body };
  };
  return {
    config: () => go(`${base}/api/config`).then(json).then((r) => r.body),
    getWeek: (id) => go(`${base}/api/weeks/${id}`).then(json).then((r) => r.body),
    putWeek: (id, week, version) =>
      go(`${base}/api/weeks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"${version}"` },
        body: JSON.stringify(week),
      }).then(json),
  };
}

/** Per-week copy on this device: { week (with ids), version, ops }. */
function createLocalCopy(storage) {
  const key = (id) => `retro.week.${id}`;
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    read: (id) => (storage ? safe(() => JSON.parse(storage.getItem(key(id))), null) : null),
    write: (id, snap) => storage && safe(() => storage.setItem(key(id), JSON.stringify(snap))),
    /** Week ids that still have edits waiting to be sent. */
    pending: () =>
      storage
        ? safe(() => {
            const ids = [];
            for (let i = 0; i < storage.length; i++) {
              const k = storage.key(i);
              if (!k?.startsWith('retro.week.')) continue;
              const snap = safe(() => JSON.parse(storage.getItem(k)), null);
              if (snap?.ops?.length) ids.push(k.slice('retro.week.'.length));
            }
            return ids;
          }, [])
        : [],
  };
}

const defaultStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. storage blocked in a private window
  }
};

export function createStore({ api = createApi(), saveDelay = 400, storage = defaultStorage() } = {}) {
  const state = {
    status: 'idle', // idle | loading | ready | saving | offline | error
    error: null,
    weekId: null,
    week: null, // with ids, plus `dates`
    version: null,
  };
  const listeners = new Set();
  const local = createLocalCopy(storage);
  let ops = []; // unsaved ops, oldest first
  let inflight = null;
  let timer = null;
  let retryMs = 1000;

  const emit = () => listeners.forEach((fn) => fn(state));
  const set = (patch) => {
    Object.assign(state, patch);
    emit();
  };
  /** Keep this device's copy of the open week (and its unsent edits) current. */
  const persist = () => state.week && local.write(state.weekId, { week: state.week, version: state.version, ops });

  async function load(weekId) {
    await flush();
    clearTimeout(timer);
    if (ops.length) persist(); // couldn't send: they stay on the device for syncPending()
    ops = [];
    set({ status: 'loading', weekId, error: null });

    const saved = local.read(weekId);
    if (saved?.ops?.length) {
      // Edits made earlier that never reached the Mac: show them now, send them next.
      ops = saved.ops;
      set({ status: 'ready', week: saved.week, version: saved.version });
      save();
      return;
    }
    try {
      const w = await api.getWeek(weekId);
      if (state.weekId !== weekId) return; // user navigated away meanwhile
      set({ status: 'ready', week: withIds(w), version: w.version });
      persist();
    } catch (e) {
      if (state.weekId !== weekId) return;
      if (e.status) return set({ status: 'error', error: e.message });
      // Can't reach the Mac: carry on with the copy on this device (or a blank week).
      const fallback = saved ?? { week: withIds({ ...emptyWeek(weekId), dates: weekDates(weekId) }), version: 'empty' };
      set({ status: 'offline', error: e.message, week: fallback.week, version: fallback.version });
    }
  }

  function mutate(op) {
    if (!state.week) throw new Error('No week loaded');
    applyOp(state.week, op);
    ops.push(op);
    persist(); // on the device immediately, whatever happens to the network
    emit();
    clearTimeout(timer);
    timer = setTimeout(save, saveDelay);
  }

  async function save() {
    clearTimeout(timer);
    if (inflight) return inflight.then(() => (ops.length ? save() : undefined));
    if (!ops.length) return;
    const sending = ops.length;
    const weekId = state.weekId;
    set({ status: 'saving' });
    inflight = (async () => {
      try {
        const { status, body } = await api.putWeek(weekId, stripIds(state.week), state.version);
        if (status === 409) {
          // Someone else (another device or an agent) changed the file. Replay our
          // unsaved ops on top of their version, then try again.
          const merged = replay(withIds(body.current), ops);
          Object.assign(state, { week: merged, version: body.current.version });
        } else {
          state.version = body.version;
          ops.splice(0, sending);
        }
        persist();
        retryMs = 1000;
        set({ status: 'ready', error: null });
      } catch (e) {
        set({ status: e.status ? 'error' : 'offline', error: e.message });
        retryMs = Math.min(retryMs * 2, 30000);
        timer = setTimeout(save, retryMs);
        timer?.unref?.(); // (Node only) a pending retry shouldn't keep a script alive
      } finally {
        inflight = null;
        emit();
      }
    })();
    await inflight;
    if (ops.length && state.status === 'ready') return save();
  }

  async function flush() {
    if (ops.length || inflight) await save();
  }

  /** Re-check the server (back online, app back in the foreground, reconnected). */
  async function refresh() {
    syncPending();
    if (!state.weekId) return;
    if (ops.length || inflight) return save(); // a conflict there merges in remote changes
    try {
      const w = await api.getWeek(state.weekId);
      if (ops.length || inflight || w.week !== state.weekId) return;
      if (w.version !== state.version) set({ week: withIds(w), version: w.version });
      persist();
      if (state.status !== 'ready') set({ status: 'ready', error: null });
    } catch (e) {
      if (!e.status) set({ status: 'offline', error: e.message });
    }
  }

  /** Send edits still waiting on this device for weeks other than the open one. */
  let syncing = false;
  async function syncPending() {
    if (syncing) return;
    syncing = true;
    try {
      for (const id of local.pending()) {
        if (id === state.weekId) continue; // the open week goes through save()
        const saved = local.read(id);
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = await api.getWeek(id);
          const merged = replay(withIds(current), saved.ops);
          const { status, body } = await api.putWeek(id, stripIds(merged), current.version);
          if (status === 409) continue; // changed again meanwhile
          local.write(id, { week: merged, version: body.version, ops: [] });
          break;
        }
      }
    } catch {
      // still offline: try again next time
    } finally {
      syncing = false;
    }
  }

  /** Call when the server reports that a week file changed on disk. */
  function onRemoteChange({ week, version }) {
    if (week !== state.weekId || version === state.version) return;
    if (ops.length || inflight) return save(); // will 409 and merge
    return load(week);
  }

  const ref = (loc, id) => {
    const it = listAt(state.week, loc).find((x) => x.id === id);
    if (!it) throw new Error(`Item ${id} not found`);
    return { id, text: it.text };
  };

  return {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load,
    flush,
    refresh,
    syncPending,
    onRemoteChange,
    get hasUnsaved() {
      return ops.length > 0 || Boolean(inflight);
    },

    // ---- actions
    addItem(loc, text = '', index) {
      const id = newId();
      mutate({ type: 'add', loc, id, text, index });
      return id;
    },
    setText(loc, id, text) {
      const r = ref(loc, id);
      if (r.text !== text) mutate({ type: 'update', loc, ref: r, patch: { text } });
    },
    toggle(loc, id, done) {
      const r = ref(loc, id);
      const item = listAt(state.week, loc).find((x) => x.id === id);
      mutate({ type: 'update', loc, ref: r, patch: { done: done ?? !item.done } });
    },
    toggleHighlight(loc, id) {
      const item = listAt(state.week, loc).find((x) => x.id === id);
      mutate({ type: 'update', loc, ref: ref(loc, id), patch: { highlight: !item.highlight } });
    },
    remove(loc, id) {
      mutate({ type: 'remove', loc, ref: ref(loc, id) });
    },
    move(loc, id, to, index) {
      mutate({ type: 'move', loc, ref: ref(loc, id), to, index });
    },
    listAt: (loc) => listAt(state.week, loc),
  };
}

/** Browser only: subscribe to server-sent file-change events. */
export function connectLive(store, { base = '', onHello } = {}) {
  if (typeof EventSource === 'undefined') return () => {};
  const es = new EventSource(`${base}/api/events`);
  es.addEventListener('week-changed', (e) => store.onRemoteChange(JSON.parse(e.data)));
  // Sent on every (re)connect: carries the app version, and is the moment to catch up
  // on anything missed while the connection was down.
  es.addEventListener('hello', (e) => {
    onHello?.(JSON.parse(e.data));
    store.refresh();
  });
  return () => es.close();
}
