// Retro: view controller. Three modes, switched by tapping:
//   pinned  – "Pinned for this week" expands
//   day     – a day label: that day expands (the default, on today)
//   summary – "Summary" expands
// All data and syncing lives in store.js; this file only renders and handles input.

import { createStore, connectLive } from './store.js';
import { renderItems, focusItem, autosize, autosizeAll, syncMark } from './items.js';
import { attachSwipe } from './gestures.js';
import { createWheel } from './wheel.js';
import {
  shiftWeek,
  weekdayIndex,
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
  if (pickerOpen) renderPicker(weekId);
  renderSync();
  if (!week) return;

  if (!categories().includes(ui.category)) ui.category = busiestCategory(week);
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

// ---------- Week picker: tap "W45 2026" to fold out two wheels (week, year)

const makeWeekId = (year, week) => `${year}-W${String(week).padStart(2, '0')}`;
const weeksIn = (year) => (isValidWeekId(makeWeekId(year, 53)) ? 53 : 52);
let pickerOpen = false;

const weekWheel = createWheel($('wheel-week'), { onSettle: () => pickFromWheels() });
const yearWheel = createWheel($('wheel-year'), {
  onSettle: (year) => {
    fillWeekWheel(year); // 52 or 53 weeks
    pickFromWheels();
  },
});

function fillWeekWheel(year) {
  const n = weeksIn(year);
  if (weekWheel.count !== n) {
    weekWheel.count = n;
    weekWheel.setValues(Array.from({ length: n }, (_, i) => i + 1), (w) => `W${w}`);
  }
}

function fillYearWheel(year) {
  const now = Number(currentWeekId().slice(0, 4));
  const from = Math.min(year, now - 5);
  const to = Math.max(year, now + 5);
  if (yearWheel.range !== `${from}-${to}`) {
    yearWheel.range = `${from}-${to}`;
    yearWheel.setValues(Array.from({ length: to - from + 1 }, (_, i) => from + i));
  }
}

/** Point the wheels at the week on screen (unless the user is turning them). */
function renderPicker(id) {
  const year = Number(id.slice(0, 4));
  const week = Number(id.slice(6));
  if (!yearWheel.busy) {
    fillYearWheel(year);
    yearWheel.setValue(year);
  }
  if (!weekWheel.busy && !yearWheel.busy) {
    fillWeekWheel(year);
    weekWheel.setValue(week);
  }
  $('picker-now').hidden = id === currentWeekId();
}

function pickFromWheels() {
  const year = yearWheel.value;
  const week = Math.min(weekWheel.value, weeksIn(year));
  const id = makeWeekId(year, week);
  if (id !== store.state.weekId) openWeek(id);
}

function setPicker(open) {
  if (open === pickerOpen) return;
  pickerOpen = open;
  body.classList.toggle('picker-open', open);
  $('week').setAttribute('aria-expanded', String(open));
  $('picker').setAttribute('aria-hidden', String(!open));
  if (open) renderPicker(store.state.weekId);
  $('picker').style.height = open ? `${$('picker-inner').offsetHeight}px` : '0px';
  if (open) requestAnimationFrame(() => (weekWheel.paint(), yearWheel.paint()));
}

/** First visit on this device (nothing remembered yet): open the category with the most
 *  tasks today, else this week, so a fresh home-screen app doesn't open on an empty list. */
function busiestCategory(week) {
  const today = week.days.find((d) => d.date === todayLocal());
  const count = (c, days) => days.reduce((n, d) => n + (d.items[c]?.length ?? 0), 0);
  const pick = (days) => week.categories.reduce((best, c) => (count(c, days) > count(best, days) ? c : best));
  if (today && week.categories.some((c) => today.items[c]?.length)) return pick([today]);
  return pick(week.days);
}

function renderSync() {
  const { status, error } = store.state;
  $('sync').textContent =
    // Offline is fine: edits are kept on this device and sent when the Mac is back.
    status === 'offline' ? 'offline'
    : status === 'unavailable' ? 'Mac can’t read the data · saved here'
    : status === 'error' ? `error: ${error}` : '';
}

function renderSwitcher() {
  const cats = categories();
  const i = catIndex();
  const n = cats.length;
  $('cat-active').textContent = cats[i] ?? '';
  $('cat-prev').textContent = n > 1 ? cats[(i - 1 + n) % n] : '';
  $('cat-next').textContent = n > 2 ? cats[(i + 1) % n] : '';
  // Desktop: one heading per column instead of the switcher.
  const heads = $('col-heads');
  if (isDesktop() && heads.dataset.cats !== cats.join('|')) {
    heads.dataset.cats = cats.join('|');
    heads.replaceChildren(
      document.createElement('span'), // above the day labels
      ...cats.map((c) => Object.assign(document.createElement('span'), { className: 'col-head', textContent: c })),
    );
  }
}

// ---------- Desktop: wide screens show every category side by side.
// Phones keep the one-category-at-a-time layout exactly as before.

const desktopMQ = matchMedia('(min-width: 900px)');
const isDesktop = () => desktopMQ.matches;
desktopMQ.addEventListener('change', () => {
  track.dataset.week = ''; // rebuild the rows for the other layout
  $('col-heads').dataset.cats = '';
  render();
});

function dayRowHTML(date, cats) {
  const [, m, dd] = date.split('-');
  const side = `
    <div class="day-side">
      <button type="button" class="day-label"><span class="d">${WEEKDAY_SHORT[weekdayIndex(date)]}</span> <span class="d">${Number(m)}/${Number(dd)}</span></button>
      <button type="button" class="add-mini" aria-label="Add task">${PLUS_SMALL}</button>
    </div>`;
  if (!cats) return `${side}<ul class="items"></ul>`; // phone
  return (
    side +
    cats
      .map(
        (c) => `<div class="cell" data-cat="${c.replace(/"/g, '&quot;')}"><ul class="items"></ul>` +
          `<button type="button" class="add-cell" aria-label="Add task">${PLUS_SMALL}</button></div>`,
      )
      .join('')
  );
}

function renderDays() {
  const { week } = store.state;
  const today = todayLocal();
  const desktop = isDesktop();
  // Key on the data's own week id (while a new week is loading, state.week is still the
  // old one) and, on desktop, on the set of columns.
  const layoutKey = desktop ? `${week.week}|${week.categories.join('|')}` : week.week;
  if (track.dataset.week !== layoutKey) {
    track.dataset.week = layoutKey;
    document.documentElement.style.setProperty('--cats', week.categories.length); // shared with the headings
    track.replaceChildren(
      ...week.days.map((d) => {
        const row = document.createElement('div');
        row.className = 'day';
        row.dataset.date = d.date;
        row.innerHTML = dayRowHTML(d.date, desktop ? week.categories : null);
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
    for (const ul of row.querySelectorAll('.items')) {
      const category = desktop ? ul.parentElement.dataset.cat : ui.category;
      const key = encodeLoc({ list: 'day', date, category });
      const switched = ul.dataset.loc !== key;
      if (switched) {
        ul.dataset.loc = key;
        ul.replaceChildren();
      }
      renderItems(ul, day.items[category] ?? [], { animate: !switched });
    }
  }
}

const cssPx = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

/** Height of a day row when it is not focused (mirrors the .day rules in style.css). */
function compactRowHeight(row) {
  const first = row === track.firstElementChild;
  const last = row === track.lastElementChild;
  // wrapped tasks can span several lines; on desktop the tallest column counts
  const items = Math.max(...[...row.querySelectorAll('.items')].map((ul) => ul.offsetHeight));
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
    if (animating || isDesktop()) return; // every category is already visible on desktop
    const w = track.offsetWidth;
    track.style.transform = `translateX(${dx}px)`;
    track.style.opacity = String(1 - Math.min(0.7, Math.abs(dx) / w));
  },
  onEnd: (dir, dx) => {
    if (animating || isDesktop()) return;
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
  // The week is deliberately NOT kept in the address: a remembered #2026-W45 used to
  // pin the app to an old week after a reload. The app always starts from today.
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
  // Week picker: the title toggles it; a tap anywhere else folds it away.
  if (t.closest('#week')) return setPicker(!pickerOpen);
  if (t.closest('#picker-now')) return openWeek(currentWeekId());
  if (t.closest('#picker')) return;
  if (pickerOpen) setPicker(false);

  if ((el = t.closest('.item .cb'))) {
    if (longPressed) return void (longPressed = false); // that press highlighted instead
    store.toggle(locOf(el), el.closest('.item').dataset.id);
  } else if ((el = t.closest('[data-add]'))) {
    addAndFocus({ list: el.dataset.add });
  } else if ((el = t.closest('.add-mini'))) {
    addAndFocus(dayLoc(el.closest('.day').dataset.date));
  } else if ((el = t.closest('.add-cell'))) {
    addAndFocus({ list: 'day', date: el.closest('.day').dataset.date, category: el.closest('.cell').dataset.cat });
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

// Long-press a task's checkbox to highlight it (tap still ticks it).
const LONG_PRESS_MS = 450;
let pressTimer = null;
let pressStart = null;
let longPressed = false;
document.addEventListener('pointerdown', (e) => {
  const cb = e.target.closest?.('.item .cb');
  if (!cb) return;
  longPressed = false;
  pressStart = { x: e.clientX, y: e.clientY };
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    longPressed = true;
    store.toggleHighlight(locOf(cb), cb.closest('.item').dataset.id);
  }, LONG_PRESS_MS);
});
const cancelPress = () => {
  clearTimeout(pressTimer);
  pressTimer = null;
};
document.addEventListener('pointerup', cancelPress);
document.addEventListener('pointercancel', cancelPress);
document.addEventListener('pointermove', (e) => {
  if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
});
document.addEventListener('contextmenu', (e) => e.target.closest?.('.item .cb') && e.preventDefault());

document.addEventListener('input', (e) => {
  if (!e.target.classList.contains('text')) return;
  syncMark(e.target); // keep the highlighter layer in step with every keystroke
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
  lastToday = today;
  // A new day: go to today, whichever week was on screen, and open it.
  const now = currentWeekId();
  const viewing = store.state.weekId;
  if (ui.mode === 'day') ui.focusDate = today;
  if (viewing && viewing !== now) {
    if (pickerOpen) setPicker(false);
    openWeek(now, now > viewing ? 1 : -1);
    return;
  }
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
window.addEventListener('online', () => store.refresh()); // send waiting edits right away

// Keep the app's files on the device so it opens without the Mac. Browsers only allow
// this over HTTPS (or on localhost), e.g. via Tailscale's https://… address.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
setInterval(checkDate, 60 * 1000); // midnight while the app is open
window.addEventListener('focus', checkDate); // some ways back into the app skip visibilitychange

// Always open on the real current week (by this device's date). Clear any week an older
// version left in the address so it can't come back.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
openWeek(currentWeekId()).then(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('no-anim')));
});
