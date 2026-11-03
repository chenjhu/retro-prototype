// Retro: view controller. Three modes, switched by tapping:
//   pinned  – "Pinned for this week" expands
//   day     – a day label: that day expands (the default, on today)
//   summary – "Summary" expands
// All data and syncing lives in store.js; this file only renders and handles input.

import { createStore, connectLive } from './store.js';
import { renderItems, focusItem, autosize, autosizeAll } from './items.js';
import { attachSwipe } from './gestures.js';
import {
  shiftWeek,
  weekdayIndex,
  weekDates,
  weekIdOf,
  isValidWeekId,
  WEEKDAY_SHORT,
  todayLocal,
  currentWeekId,
} from '/shared/week.js';

const store = createStore();
const $ = (id) => document.getElementById(id);
const body = document.body;
const track = $('days-track');

const PLUS_SMALL =
  '<svg viewBox="0 0 17 17" aria-hidden="true"><circle cx="8.5" cy="8.5" r="8"/><path d="M8.5 5v7M5 8.5h7"/></svg>';

// ---------- UI state (not part of the data)

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('retro.ui')) ?? {};
  } catch {
    return {};
  }
})();
const ui = {
  mode: ['pinned', 'day', 'summary'].includes(saved.mode) ? saved.mode : 'day',
  category: saved.category ?? null,
  focusDate: null,
};
const persist = () => {
  try {
    localStorage.setItem('retro.ui', JSON.stringify({ mode: ui.mode, category: ui.category }));
  } catch {}
};

const categories = () => store.state.week?.categories ?? [];
const catIndex = () => Math.max(0, categories().indexOf(ui.category));
const dayLoc = (date) => ({ list: 'day', date, category: ui.category });

function encodeLoc(loc) {
  return loc.list === 'day' ? `day|${loc.date}|${loc.category}` : loc.list;
}
function decodeLoc(s) {
  const [list, date, category] = s.split('|');
  return list === 'day' ? { list, date, category } : { list };
}

// ---------- Rendering

let lastDone = null;

function render() {
  const { week, weekId } = store.state;
  if (!weekId) return;
  $('week-no').textContent = `W${weekId.slice(6)}`;
  $('week-year').textContent = weekId.slice(0, 4);
  renderPickers(weekId);
  renderSync();
  if (!week) return;

  if (!categories().includes(ui.category)) ui.category = categories()[0];
  if (!week.days.some((d) => d.date === ui.focusDate)) ui.focusDate = defaultFocus();

  const done =
    week.pinned.filter((i) => i.done).length +
    week.days.reduce((n, d) => n + Object.values(d.items).flat().filter((i) => i.done).length, 0);
  const doneEl = $('done-count');
  if (lastDone !== null && done > lastDone) pop(doneEl.parentElement.querySelector('svg'));
  doneEl.textContent = done;
  lastDone = done;

  renderItems(document.querySelector('.pinned .items'), week.pinned);
  renderItems(document.querySelector('.summary .items'), week.summary);
  renderSwitcher();
  renderDays();
  layout();
}

// ---------- Week / year pickers (native <select>s overlaid on "W45" and "2026")

const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
let pickerYear = null;

function renderPickers(weekId) {
  const year = Number(weekId.slice(0, 4));
  const now = currentWeekId();
  const ws = $('week-select');
  const ys = $('year-select');
  if (pickerYear !== year || ws.dataset.now !== now) {
    pickerYear = year;
    ws.dataset.now = now;
    const opts = [`<option value="now">This week · W${now.slice(6)} ${now.slice(0, 4)}</option>`];
    for (let w = 1; w <= 53; w++) {
      const id = `${year}-W${String(w).padStart(2, '0')}`;
      if (!isValidWeekId(id)) continue;
      const d = weekDates(id);
      opts.push(`<option value="${id}">W${w} · ${md(d[0])} – ${md(d[6])}</option>`);
    }
    ws.innerHTML = opts.join('');
    const thisYear = Number(now.slice(0, 4));
    const years = new Set();
    for (let y = Math.min(year, thisYear - 5); y <= Math.max(year, thisYear + 5); y++) years.add(y);
    ys.innerHTML = [...years].map((y) => `<option value="${y}">${y}</option>`).join('');
  }
  ws.value = weekId;
  ys.value = String(year);
}

$('week-select').addEventListener('change', (e) => {
  const id = e.target.value === 'now' ? currentWeekId() : e.target.value;
  goToWeek(id);
});
$('year-select').addEventListener('change', (e) => {
  const week = store.state.weekId.slice(6);
  let id = `${e.target.value}-W${week}`;
  if (!isValidWeekId(id)) id = `${e.target.value}-W52`; // that year has no week 53
  goToWeek(id);
});

function goToWeek(id) {
  const cur = store.state.weekId;
  if (id === cur) return renderPickers(cur);
  openWeek(id, id > cur ? 1 : -1);
}

function renderSync() {
  const { status, error } = store.state;
  $('sync').textContent =
    status === 'offline' ? 'offline · will retry' : status === 'error' ? `error: ${error}` : '';
}

function renderSwitcher() {
  const cats = categories();
  const i = catIndex();
  const n = cats.length;
  $('cat-active').textContent = cats[i] ?? '';
  $('cat-prev').textContent = n > 1 ? cats[(i - 1 + n) % n] : '';
  $('cat-next').textContent = n > 2 ? cats[(i + 1) % n] : '';
}

function renderDays() {
  const { week } = store.state;
  const today = todayLocal();
  // Key on the data's own week id: while a new week is loading, state.week is still the old one.
  if (track.dataset.week !== week.week) {
    track.dataset.week = week.week;
    track.replaceChildren(
      ...week.days.map((d) => {
        const row = document.createElement('div');
        row.className = 'day';
        row.dataset.date = d.date;
        const [, m, dd] = d.date.split('-');
        row.innerHTML = `
          <div class="day-side">
            <button type="button" class="day-label"><span class="d">${WEEKDAY_SHORT[weekdayIndex(d.date)]}</span> <span class="d">${Number(m)}/${Number(dd)}</span></button>
            <button type="button" class="add-mini" aria-label="Add task">${PLUS_SMALL}</button>
          </div>
          <ul class="items"></ul>`;
        return row;
      }),
    );
  }
  for (const row of track.children) {
    const date = row.dataset.date;
    const day = week.days.find((d) => d.date === date);
    row.classList.toggle('today', date === today);
    row.classList.toggle('past', date < today);
    row.classList.toggle('focus', ui.mode === 'day' && date === ui.focusDate);
    const ul = row.querySelector('.items');
    const key = encodeLoc(dayLoc(date));
    const switched = ul.dataset.loc !== key;
    if (switched) {
      ul.dataset.loc = key;
      ul.replaceChildren();
    }
    renderItems(ul, day.items[ui.category] ?? [], { animate: !switched });
  }
}

const cssPx = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

/** Height of a day row when it is not focused (mirrors the .day rules in style.css). */
function compactRowHeight(row) {
  const first = row === track.firstElementChild;
  const last = row === track.lastElementChild;
  const items = row.querySelector('.items').offsetHeight; // wrapped tasks can span several lines
  const natural = (first ? 8 : 7) + Math.max(items, 20) + (last ? 24 : 6) + (last ? 0 : 1);
  return Math.max(last ? 0 : cssPx('--row') + 1, natural);
}

/** Heights that CSS can't animate on its own (they depend on content). */
function layout() {
  const box = $('pinned');
  const inner = $('pinned-inner');
  const closed = box.querySelector('.section-title').offsetHeight;
  // Leave room under the list for the ● + button (33px tall, 12px from the bottom).
  const open = Math.max(closed + cssPx('--focus-extra'), inner.offsetHeight + 33 + 12 + 10);
  box.style.height = `${ui.mode === 'pinned' ? open : closed}px`;

  // The focused day takes exactly the space Pinned gives up when it closes, so the rows
  // below it don't move when switching between pinned and day mode.
  for (const row of track.children) {
    row.style.minHeight = row.classList.contains('focus')
      ? `${compactRowHeight(row) + open - closed}px`
      : '';
  }

  const sb = $('summary-body');
  sb.style.height = `${ui.mode === 'summary' ? sb.firstElementChild.offsetHeight : 0}px`;
}

function pop(el) {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ---------- Modes

function setMode(mode, date) {
  if (mode === 'day') ui.focusDate = date ?? ui.focusDate ?? defaultFocus();
  if (mode === ui.mode && (mode !== 'day' || !date)) return;
  ui.mode = mode;
  persist();
  body.classList.remove('mode-pinned', 'mode-day', 'mode-summary');
  body.classList.add(`mode-${mode}`);
  render();

  // Bring the newly opened section into view once it has finished growing.
  const target =
    mode === 'pinned' ? null : mode === 'summary' ? $('summary') : track.querySelector('.day.focus');
  if (mode === 'pinned') window.scrollTo({ top: 0, behavior: 'smooth' });
  else
    setTimeout(() => {
      const r = target.getBoundingClientRect();
      if (r.bottom > innerHeight || r.top < 0) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 430);
}

function defaultFocus() {
  const today = todayLocal();
  const dates = store.state.week?.days.map((d) => d.date) ?? [];
  return dates.includes(today) ? today : dates[0];
}

// ---------- Category switching (tap or swipe)

let animating = false;

async function changeCategory(step, fromDx = 0) {
  const n = categories().length;
  if (n < 2 || animating) return;
  animating = true;
  document.activeElement?.blur?.();
  const w = track.offsetWidth;
  const out = { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' };
  const sw = $('switcher');
  await Promise.all([
    track.animate([{ transform: `translateX(${fromDx}px)`, opacity: 1 - Math.abs(fromDx) / w }, { transform: `translateX(${-step * w * 0.35}px)`, opacity: 0 }], out).finished,
    sw.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-step * 18}px)`, opacity: 0 }], out).finished,
  ]);
  ui.category = categories()[(catIndex() + step + n) % n];
  persist();
  render();
  const inn = { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' };
  track.getAnimations().forEach((a) => a.cancel());
  sw.getAnimations().forEach((a) => a.cancel());
  track.animate([{ transform: `translateX(${step * w * 0.35}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], inn);
  await sw.animate([{ transform: `translateX(${step * 18}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], inn).finished;
  animating = false;
}

attachSwipe($('days'), {
  onMove: (dx) => {
    if (animating) return;
    const w = track.offsetWidth;
    track.style.transform = `translateX(${dx}px)`;
    track.style.opacity = String(1 - Math.min(0.7, Math.abs(dx) / w));
  },
  onEnd: (dir, dx) => {
    if (animating) return;
    track.style.transform = '';
    track.style.opacity = '';
    if (dir) changeCategory(dir, dx);
    else
      track.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
  },
});

// ---------- Week switching (swipe the header; tap to return to this week)

async function openWeek(id, step = 0) {
  history.replaceState(null, '', `#${id}`);
  const app = document.querySelector('.app');
  if (step) await app.animate([{ opacity: 1 }, { opacity: 0, transform: `translateX(${-step * 24}px)` }], { duration: 140, fill: 'forwards' }).finished;
  lastDone = null;
  await store.load(id);
  if (step) {
    app.getAnimations().forEach((a) => a.cancel());
    app.animate([{ opacity: 0, transform: `translateX(${step * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

attachSwipe($('hdr'), {
  threshold: 50,
  onEnd: (dir) => dir && openWeek(shiftWeek(store.state.weekId, dir), dir),
});

// ---------- Input handling (delegated)

function locOf(el) {
  const ul = el.closest('.items');
  return ul && decodeLoc(ul.dataset.loc);
}

function addAndFocus(loc, index) {
  const id = store.addItem(loc, '', index); // renders synchronously…
  focusItem(id); // …so focusing here still counts as the user's tap (iOS keyboard opens)
}

document.addEventListener('click', (e) => {
  const t = e.target;
  let el;
  if ((el = t.closest('.item .cb'))) {
    store.toggle(locOf(el), el.closest('.item').dataset.id);
  } else if ((el = t.closest('[data-add]'))) {
    addAndFocus({ list: el.dataset.add });
  } else if ((el = t.closest('.add-mini'))) {
    addAndFocus(dayLoc(el.closest('.day').dataset.date));
  } else if ((el = t.closest('.day-label'))) {
    setMode('day', el.closest('.day').dataset.date);
  } else if ((el = t.closest('[data-mode]'))) {
    setMode(el.dataset.mode);
  } else if ((el = t.closest('[data-cat-step]'))) {
    changeCategory(Number(el.dataset.catStep));
  }
});

function commitText(input) {
  if (input.value.includes('\n')) input.value = input.value.replace(/\s*\n+\s*/g, ' '); // e.g. pasted text
  const li = input.closest('.item');
  const loc = locOf(input);
  const item = store.listAt(loc).find((x) => x.id === li.dataset.id);
  if (item && item.text !== input.value) store.setText(loc, item.id, input.value);
}

document.addEventListener('input', (e) => {
  if (!e.target.classList.contains('text')) return;
  // Don't commit mid-composition, or Chinese/Japanese IME input breaks…
  if (!e.isComposing) return commitText(e.target);
  // …but still let the field grow while composing.
  autosize(e.target);
  layout();
});
document.addEventListener('compositionend', (e) => {
  if (e.target.classList.contains('text')) commitText(e.target);
});

document.addEventListener('keydown', (e) => {
  const input = e.target;
  if (!input.classList?.contains('text') || e.isComposing || e.keyCode === 229) return;
  const loc = locOf(input);
  const list = store.listAt(loc);
  const id = input.closest('.item').dataset.id;
  const i = list.findIndex((x) => x.id === id);
  if (e.key === 'Enter') {
    e.preventDefault();
    if (input.value.trim()) addAndFocus(loc, i + 1);
    else input.blur();
  } else if (e.key === 'Backspace' && input.value === '') {
    e.preventDefault();
    const prev = list[i - 1];
    store.remove(loc, id);
    if (prev) focusItem(prev.id);
  }
});

// Leaving an empty task removes it.
document.addEventListener('focusout', (e) => {
  const input = e.target;
  if (!input.classList?.contains('text') || input.value.trim()) return;
  const loc = locOf(input);
  const id = input.closest('.item')?.dataset.id;
  setTimeout(() => {
    const item = store.state.week && store.listAt(loc).find((x) => x.id === id);
    if (item && !item.text.trim() && document.activeElement !== input) store.remove(loc, id);
  });
});

// ---------- Boot

body.classList.add('no-anim');
body.classList.remove('mode-pinned', 'mode-day', 'mode-summary');
body.classList.add(`mode-${ui.mode}`);
store.subscribe(render);

// ---------- Staying current
// A page added to the iPhone home screen is never reloaded by iOS: it is just woken up
// from the background. So when the server is running newer code than this page, save
// and reload; and whenever the app comes back, catch up on data and on the date.

let loadedApp = null;
async function checkApp(app) {
  if (!app) return;
  if (loadedApp === null) loadedApp = app;
  else if (app !== loadedApp) {
    await store.flush();
    location.reload();
  }
}
connectLive(store, { onHello: ({ app }) => checkApp(app) });

let lastToday = todayLocal();
function checkDate() {
  const today = todayLocal();
  if (today === lastToday) return;
  const was = lastToday;
  lastToday = today;
  const viewing = store.state.weekId;
  // The week rolled over while showing "this week": follow it to the new week.
  if (viewing && viewing === weekIdOf(was) && viewing !== currentWeekId()) {
    openWeek(currentWeekId(), 1);
    return;
  }
  if (ui.focusDate === was) ui.focusDate = today; // keep "today" in focus
  render();
}

async function onForeground() {
  checkDate();
  store.refresh();
  try {
    const cfg = await (await fetch('/api/config', { cache: 'no-store' })).json();
    checkApp(cfg.app);
  } catch {}
}

window.addEventListener('resize', () => {
  autosizeAll();
  layout();
});
document.addEventListener('visibilitychange', () => (document.hidden ? store.flush() : onForeground()));
window.addEventListener('pageshow', (e) => e.persisted && onForeground());
window.addEventListener('pagehide', () => store.flush());
setInterval(checkDate, 60 * 1000); // midnight while the app is open

const fromHash = location.hash.slice(1);
openWeek(/^\d{4}-W\d{2}$/.test(fromHash) ? fromHash : currentWeekId()).then(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('no-anim')));
});
