// Converts a week between its JSON shape (see model.js) and the Markdown file on disk.
// The Markdown file is the source of truth; see docs/DATA_FORMAT.md.
//
// The parser is deliberately forgiving so that people and AI agents can edit the
// file by hand: heading levels and checkbox styles are matched loosely, and plain
// "- text" bullets are read as unchecked tasks.

import { emptyWeek, normalizeWeek, DEFAULT_CATEGORIES, CATEGORY_ALIASES } from './model.js';
import { weekDates, weekdayIndex, WEEKDAY_SHORT } from './week.js';

const ITEM_RE = /^\s*[-*+]\s+(?:\[([ xX])\]\s*)?(.*)$/;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

export function weekToMarkdown(week) {
  const w = normalizeWeek(week);
  const dates = weekDates(w.week);
  const lines = [];
  const items = (list) => list.forEach((it) => lines.push(`- [${it.done ? 'x' : ' '}] ${it.text}`));

  lines.push(`# Week ${w.week} (${dates[0]} to ${dates[6]})`, '');
  lines.push('## Pinned', '');
  items(w.pinned);
  if (w.pinned.length) lines.push('');

  for (const day of w.days) {
    lines.push(`## ${WEEKDAY_SHORT[weekdayIndex(day.date)]} ${day.date}`, '');
    for (const cat of w.categories) {
      lines.push(`### ${cat}`, '');
      items(day.items[cat]);
      if (day.items[cat].length) lines.push('');
    }
  }

  lines.push('## Summary', '');
  items(w.summary);
  if (w.summary.length) lines.push('');

  lines.push('## Notes', '');
  if (w.notes) lines.push(w.notes, '');

  return lines.join('\n').replace(/\n+$/, '\n');
}

export function markdownToWeek(md, weekId) {
  const week = emptyWeek(weekId, []);
  week.categories = [...DEFAULT_CATEGORIES];
  const validDates = new Set(weekDates(weekId));
  const days = new Map(week.days.map((d) => [d.date, d]));
  const notes = [];

  // section: 'pinned' | 'summary' | 'day' | 'notes' | null
  let section = null;
  let day = null;
  let category = null;

  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const level = h ? h[1].length : 0;

    if (section === 'notes' && !(h && level <= 2)) {
      notes.push(line);
      continue;
    }

    if (h && level <= 2) {
      const title = h[2];
      const date = DATE_RE.exec(title)?.[1];
      category = null;
      day = null;
      if (level === 1) section = null;
      else if (/^pinned\b/i.test(title)) section = 'pinned';
      else if (/^summary\b/i.test(title)) section = 'summary';
      else if (/^notes\b/i.test(title)) section = 'notes';
      else if (date && validDates.has(date)) {
        section = 'day';
        day = days.get(date);
      } else section = null; // unknown or out-of-week section: ignored
      continue;
    }

    if (h && section === 'day') {
      category = CATEGORY_ALIASES[h[2].toLowerCase()] ?? h[2];
      if (!week.categories.some((c) => c.toLowerCase() === category.toLowerCase())) {
        week.categories.push(category);
      }
      continue;
    }

    const m = ITEM_RE.exec(line);
    if (!m || !m[2].trim()) continue;
    const item = { text: m[2], done: m[1] === 'x' || m[1] === 'X' };

    if (section === 'pinned') week.pinned.push(item);
    else if (section === 'summary') week.summary.push(item);
    else if (section === 'day' && category) {
      const key = Object.keys(day.items).find((c) => c.toLowerCase() === category.toLowerCase());
      (day.items[key ?? category] ??= []).push(item);
    }
  }

  week.notes = notes.join('\n');
  return normalizeWeek(week, weekId);
}
