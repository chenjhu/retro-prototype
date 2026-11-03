// UI-agnostic client state for one week: loading, edits, debounced autosave,
// conflict merging and live reload when the file changes on disk (e.g. an AI
// agent edited the Markdown). The UI only calls actions and re-renders on change.
//
// Item locations:  { list: 'pinned' }, { list: 'summary' }
//                  or { list: 'day', date: 'YYYY-MM-DD', category: 'Work' }
// Items carry a client-only `id` for rendering; it is never saved.

let nextId = 1;
const newId = () => `i${nextId++}`;

const withIds = (week) => ({
  ...week,
  pinned: week.pinned.map((it) => ({ ...it, id: newId() })),
  summary: (week.summary ?? []).map((it) => ({ ...it, id: newId() })),
  days: week.days.map((d) => ({
    ...d,
    items: Object.fromEntries(Object.entries(d.items).map(([c, l]) => [c, l.map((it) => ({ ...it, id: newId() }))])),
  })),
});

const stripIds = (week) => ({
  week: week.week,
  categories: week.categories,
  pinned: week.pinned.map(({ text, done }) => ({ text, done })),
  summary: week.summary.map(({ text, done }) => ({ text, done })),
  days: week.days.map((d) => ({
    date: d.date,
    items: Object.fromEntries(Object.entries(d.items).map(([c, l]) => [c, l.map(({ text, done }) => ({ text, done }))])),
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

export function createApi(base = '', fetchImpl = (...a) => fetch(...a)) {
  const json = async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
    return { status: res.status, body };
  };
  return {
    config: () => fetchImpl(`${base}/api/config`).then(json).then((r) => r.body),
    getWeek: (id) => fetchImpl(`${base}/api/weeks/${id}`).then(json).then((r) => r.body),
    putWeek: (id, week, version) =>
      fetchImpl(`${base}/api/weeks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"${version}"` },
        body: JSON.stringify(week),
      }).then(json),
  };
}

export function createStore({ api = createApi(), saveDelay = 400 } = {}) {
  const state = {
    status: 'idle', // idle | loading | ready | saving | offline | error
    error: null,
    weekId: null,
    week: null, // with ids, plus `dates`
    version: null,
  };
  const listeners = new Set();
  let ops = []; // unsaved ops, oldest first
  let inflight = null;
  let timer = null;
  let retryMs = 1000;

  const emit = () => listeners.forEach((fn) => fn(state));
  const set = (patch) => {
    Object.assign(state, patch);
    emit();
  };

  async function load(weekId) {
    await flush();
    set({ status: 'loading', weekId, error: null });
    try {
      const w = await api.getWeek(weekId);
      if (state.weekId !== weekId) return; // user navigated away meanwhile
      set({ status: 'ready', week: withIds(w), version: w.version });
    } catch (e) {
      set({ status: 'error', error: e.message });
    }
  }

  function mutate(op) {
    if (!state.week) throw new Error('No week loaded');
    applyOp(state.week, op);
    ops.push(op);
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
          const merged = withIds(body.current);
          for (const op of ops) applyOp(merged, op);
          Object.assign(state, { week: merged, version: body.current.version });
        } else {
          state.version = body.version;
          ops.splice(0, sending);
        }
        retryMs = 1000;
        set({ status: 'ready', error: null });
      } catch (e) {
        set({ status: e.status ? 'error' : 'offline', error: e.message });
        retryMs = Math.min(retryMs * 2, 30000);
        timer = setTimeout(save, retryMs);
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

  /** Re-check the server (e.g. when the app comes back to the foreground). */
  async function refresh() {
    if (!state.weekId) return;
    if (ops.length || inflight) return save(); // a conflict there merges in remote changes
    try {
      const w = await api.getWeek(state.weekId);
      if (w.version !== state.version && !ops.length && !inflight && w.week === state.weekId) {
        set({ status: 'ready', error: null, week: withIds(w), version: w.version });
      }
    } catch (e) {
      set({ status: 'offline', error: e.message });
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
