// Keyed rendering of checkbox lists. Existing <li> nodes are reused so focus,
// caret position and CSS transitions survive re-renders.

const CHECK = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5.2 4.2 7.5 8 2.6"/></svg>';

function createItem(it, animate) {
  const li = document.createElement('li');
  li.className = 'item';
  li.dataset.id = it.id;
  if (animate) {
    li.classList.add('enter');
    li.addEventListener('animationend', () => li.classList.remove('enter'), { once: true });
  }

  const cb = document.createElement('button');
  cb.type = 'button';
  cb.className = 'cb';
  cb.setAttribute('role', 'checkbox');
  cb.setAttribute('aria-label', 'Done');
  cb.innerHTML = CHECK;

  // A one-row textarea that grows with its content, so long tasks wrap inside their
  // column instead of running off the screen. Enter never inserts a newline (see app.js).
  const input = document.createElement('textarea');
  input.className = 'text';
  input.rows = 1;
  input.enterKeyHint = 'next';
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'sentences');
  input.spellcheck = false; // no red squiggles
  input.setAttribute('aria-label', 'Task');

  li.append(cb, input);
  return li;
}

function updateItem(li, it) {
  li.classList.toggle('done', it.done);
  li.querySelector('.cb').setAttribute('aria-checked', String(it.done));
  const input = li.querySelector('.text');
  if (input.value !== it.text && document.activeElement !== input) input.value = it.text;
}

/** Fit a task's textarea to its wrapped text. */
export function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

export function autosizeAll(root = document) {
  root.querySelectorAll('textarea.text').forEach(autosize);
}

/** Make `ul` show `items` (each with a stable client `id`). */
export function renderItems(ul, items, { animate = true } = {}) {
  const existing = new Map();
  for (const li of ul.children) existing.set(li.dataset.id, li);

  let ref = ul.firstElementChild;
  for (const it of items) {
    let li = existing.get(it.id);
    if (li) existing.delete(it.id);
    else li = createItem(it, animate);
    updateItem(li, it);
    if (li === ref) ref = ref.nextElementSibling;
    else ul.insertBefore(li, ref);
  }
  for (const li of existing.values()) li.remove();
  autosizeAll(ul);
}

export function focusItem(id, atEnd = true) {
  const input = document.querySelector(`.item[data-id="${id}"] .text`);
  if (!input) return;
  input.focus({ preventScroll: true });
  const pos = atEnd ? input.value.length : 0;
  input.setSelectionRange(pos, pos);
  // Keep the field above the on-screen keyboard.
  input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
