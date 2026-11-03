// The in-memory shape of one week. This is what the JSON API returns and accepts.
//
// {
//   week: "2026-W45",
//   categories: ["Academic", "Work", "Personal"],   // column order
//   pinned: [{ text, done }],
//   days: [ { date: "2026-11-02", items: { Academic: [{ text, done }], ... } }, ... 7 days ],
//   summary: [{ text, done }],                        // end-of-week review points
//   notes: ""                                         // free-form markdown, kept verbatim
// }

import { weekDates, isValidWeekId } from './week.js';

export const DEFAULT_CATEGORIES = ['Academic', 'Work', 'Personal'];

// Old category names that existing files may still use → current name.
// Add an entry here whenever a category is renamed, so old data keeps loading.
export const CATEGORY_ALIASES = { academics: 'Academic' };

export function emptyWeek(weekId, categories = DEFAULT_CATEGORIES) {
  return {
    week: weekId,
    categories: [...categories],
    pinned: [],
    summary: [],
    days: weekDates(weekId).map((date) => ({
      date,
      items: Object.fromEntries(categories.map((c) => [c, []])),
    })),
    notes: '',
  };
}

const cleanText = (t) => String(t ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();

// An item is { text, done } plus `highlight: true` when highlighted (omitted otherwise,
// so plain items keep their original two-field shape).
function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((it) => {
      const item = { text: cleanText(it?.text), done: Boolean(it?.done) };
      if (it?.highlight) item.highlight = true;
      return item;
    })
    .filter((it) => it.text !== '');
}

/**
 * Validate and normalise untrusted input (from the browser, an agent, or the parser)
 * into a well-formed week. Throws on structural problems; silently drops empty items.
 */
export function normalizeWeek(input, weekId = input?.week) {
  if (!isValidWeekId(weekId)) throw new Error(`Invalid week id: ${weekId}`);
  if (input?.week && input.week !== weekId) {
    throw new Error(`Week mismatch: body says ${input.week}, expected ${weekId}`);
  }

  const categories = [];
  const seen = new Set();
  const addCategory = (c) => {
    const raw = cleanText(c);
    const name = CATEGORY_ALIASES[raw.toLowerCase()] ?? raw;
    if (!name) return null;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      categories.push(name);
    }
    return categories.find((x) => x.toLowerCase() === key);
  };
  (Array.isArray(input?.categories) && input.categories.length ? input.categories : DEFAULT_CATEGORIES)
    .forEach(addCategory);

  const out = emptyWeek(weekId, []);
  const byDate = new Map((Array.isArray(input?.days) ? input.days : []).map((d) => [d?.date, d]));

  for (const day of out.days) {
    const src = byDate.get(day.date)?.items ?? {};
    for (const [rawCat, list] of Object.entries(src)) {
      const cat = addCategory(rawCat);
      if (cat) day.items[cat] = [...(day.items[cat] ?? []), ...cleanItems(list)];
    }
  }
  for (const day of out.days) {
    day.items = Object.fromEntries(categories.map((c) => [c, day.items[c] ?? []]));
  }

  out.categories = categories;
  out.pinned = cleanItems(input?.pinned);
  out.summary = cleanItems(input?.summary);
  out.notes = typeof input?.notes === 'string' ? input.notes.replace(/\r\n/g, '\n').trim() : '';
  return out;
}
