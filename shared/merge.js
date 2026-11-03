// Merge new tasks into an existing week without touching what is already there.
// Used by scripts/merge.js so people and agents can add entries safely.

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function mergeList(target, incoming, added, where) {
  for (const it of incoming) {
    const existing = target.find((x) => same(x.text, it.text));
    if (existing) {
      if (it.done && !existing.done) existing.done = true; // only ever upgrade to done
      continue;
    }
    target.push({ text: it.text, done: it.done });
    added.push(`${where}: ${it.text}`);
  }
}

/**
 * Returns { week, added } where `week` is `base` plus every item from `incoming`
 * that isn't already present (matched by text, case-insensitive). Nothing is removed.
 */
export function mergeWeeks(base, incoming) {
  if (base.week !== incoming.week) throw new Error(`Week mismatch: ${base.week} vs ${incoming.week}`);
  const week = structuredClone(base);
  const added = [];

  for (const c of incoming.categories) if (!week.categories.includes(c)) week.categories.push(c);
  mergeList(week.pinned, incoming.pinned, added, 'Pinned');
  mergeList(week.summary, incoming.summary, added, 'Summary');
  for (const day of incoming.days) {
    const target = week.days.find((d) => d.date === day.date);
    for (const [cat, list] of Object.entries(day.items)) {
      if (!list.length) continue;
      target.items[cat] ??= [];
      mergeList(target.items[cat], list, added, `${day.date} ${cat}`);
    }
  }
  if (incoming.notes && !week.notes.includes(incoming.notes)) {
    week.notes = [week.notes, incoming.notes].filter(Boolean).join('\n\n');
    added.push('Notes');
  }
  return { week, added };
}
