// Placeholder view. Behaviour is complete; the visual design will be replaced
// once the Figma mock-ups are ready. All state lives in store.js.

import { createStore, connectLive } from './store.js';
import { shiftWeek, weekdayIndex, WEEKDAY_SHORT, todayLocal, currentWeekId } from '/shared/week.js';

const store = createStore();
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  n.append(...children.flat().filter((c) => c != null));
  return n;
};

const locKey = (loc) => (loc.list === 'pinned' ? 'pinned' : `${loc.date}|${loc.category}`);
let activeCategory = 0;
let pendingFocus = null; // { id, caret }

// ---------- rendering

function itemList(loc) {
  const items = store.listAt(loc);
  return el(
    'div',
    { class: 'cell-body', dataset: { loc: locKey(loc) } },
    el(
      'ul',
      { class: 'items' },
      items.map((it) =>
        el(
          'li',
          { class: `item${it.done ? ' done' : ''}`, dataset: { id: it.id } },
          el('input', {
            type: 'checkbox',
            checked: it.done,
            'aria-label': 'Done',
            onchange: (e) => store.toggle(loc, it.id, e.target.checked),
          }),
          el('input', {
            type: 'text',
            class: 'text',
            value: it.text,
            enterkeyhint: 'next',
            'aria-label': 'Task',
            // Don't re-render mid-composition or Chinese/Japanese IME input breaks.
            oninput: (e) => !e.isComposing && commitText(e.target, loc, it.id),
            oncompositionend: (e) => commitText(e.target, loc, it.id),
            onkeydown: (e) => onItemKey(e, loc, it.id),
            onblur: (e) => {
              if (!e.target.value.trim() && store.listAt(loc).some((x) => x.id === it.id)) {
                setTimeout(() => store.listAt(loc).some((x) => x.id === it.id && !x.text.trim()) && store.remove(loc, it.id));
              }
            },
          }),
        ),
      ),
    ),
    el('button', { type: 'button', class: 'add', onclick: () => addAndFocus(loc) }, '+ Add'),
  );
}

function commitText(input, loc, id) {
  if (store.listAt(loc).find((x) => x.id === id)?.text === input.value) return;
  pendingFocus = { id, caret: input.selectionStart };
  store.setText(loc, id, input.value);
}

function addAndFocus(loc, index) {
  const id = store.addItem(loc, '', index);
  pendingFocus = { id, caret: 0 };
  render();
}

function onItemKey(e, loc, id) {
  if (e.isComposing) return; // IME (e.g. Chinese input) is still composing
  const list = store.listAt(loc);
  const i = list.findIndex((x) => x.id === id);
  if (e.key === 'Enter') {
    e.preventDefault();
    addAndFocus(loc, i + 1);
  } else if (e.key === 'Backspace' && e.target.value === '') {
    e.preventDefault();
    const prev = list[i - 1];
    store.remove(loc, id);
    if (prev) pendingFocus = { id: prev.id, caret: prev.text.length };
    render();
  }
}

function render() {
  const { week, status, error, weekId } = store.state;
  $('#week-title').textContent = weekId ?? '…';
  $('#this-week').hidden = weekId === currentWeekId();
  $('#save-status').textContent =
    { loading: 'Loading…', saving: 'Saving…', offline: 'Offline, will retry', error: `Error: ${error}` }[status] ??
    (store.hasUnsaved ? 'Unsaved' : 'Saved');
  if (!week) return;

  // Remember focus so re-rendering doesn't interrupt typing.
  const activeLi = document.activeElement?.closest?.('.item');
  if (!pendingFocus && activeLi && document.activeElement.classList.contains('text')) {
    pendingFocus = { id: activeLi.dataset.id, caret: document.activeElement.selectionStart };
  }

  $('#pinned').replaceChildren(itemList({ list: 'pinned' }));

  const today = todayLocal();
  $('#tabs').replaceChildren(
    ...week.categories.map((c, i) =>
      el('button', { type: 'button', class: i === activeCategory ? 'active' : '', onclick: () => goToCategory(i) }, c),
    ),
  );

  const board = $('#board');
  const scroll = board.scrollLeft;
  board.style.setProperty('--categories', week.categories.length);
  board.replaceChildren(
    el(
      'div',
      { class: 'col day-col', 'aria-hidden': 'true' },
      el('div', { class: 'col-head' }, ''),
      week.days.map((d) =>
        el('div', { class: `day-label${d.date === today ? ' today' : ''}` }, dayLabel(d.date)),
      ),
    ),
    ...week.categories.map((c) =>
      el(
        'div',
        { class: 'col cat-col', dataset: { category: c } },
        el('div', { class: 'col-head' }, c),
        week.days.map((d) =>
          el(
            'div',
            { class: `cell${d.date === today ? ' today' : ''}` },
            el('div', { class: 'cell-day' }, dayLabel(d.date)),
            itemList({ list: 'day', date: d.date, category: c }),
          ),
        ),
      ),
    ),
  );
  board.scrollLeft = scroll;

  if (pendingFocus) {
    const input = document.querySelector(`.item[data-id="${pendingFocus.id}"] .text`);
    if (input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(pendingFocus.caret, pendingFocus.caret);
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    pendingFocus = null;
  }
}

function dayLabel(date) {
  const [, m, d] = date.split('-');
  return `${WEEKDAY_SHORT[weekdayIndex(date)]} ${Number(m)}/${Number(d)}`;
}

// ---------- mobile: one category per screen, swipe to switch (CSS scroll-snap)

function goToCategory(i) {
  const col = $('#board').querySelectorAll('.cat-col')[i];
  col?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
}

$('#board').addEventListener(
  'scroll',
  () => {
    const board = $('#board');
    const i = Math.round(board.scrollLeft / board.clientWidth);
    if (i !== activeCategory) {
      activeCategory = i;
      $('#tabs').querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === i));
    }
  },
  { passive: true },
);

// ---------- week navigation

function openWeek(id) {
  history.replaceState(null, '', `#${id}`);
  store.load(id);
}
document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const id = store.state.weekId;
  if (action === 'prev-week') openWeek(shiftWeek(id, -1));
  if (action === 'next-week') openWeek(shiftWeek(id, 1));
  if (action === 'this-week') openWeek(currentWeekId());
});

store.subscribe(render);
connectLive(store);
window.addEventListener('beforeunload', (e) => {
  if (store.hasUnsaved) {
    store.flush();
    e.preventDefault();
  }
});
document.addEventListener('visibilitychange', () => document.hidden && store.flush());

const fromHash = location.hash.slice(1);
openWeek(/^\d{4}-W\d{2}$/.test(fromHash) ? fromHash : currentWeekId());
