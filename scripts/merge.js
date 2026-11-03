#!/usr/bin/env node
// Add tasks from a Markdown file into Retro, without overwriting anything.
//
//   node scripts/merge.js path/to/file.md            (Retro must be running: `retro`)
//   RETRO_URL=http://localhost:4173 node scripts/merge.js file.md
//
// The file uses the normal week format (docs/DATA_FORMAT.md); only the sections you
// want to add need to be there. The week is taken from the first YYYY-MM-DD date or
// "YYYY-Www" in the file. Tasks already present (same text) are skipped.

import fs from 'node:fs';
import { markdownToWeek } from '../shared/markdown.js';
import { mergeWeeks } from '../shared/merge.js';
import { weekIdOf, isValidWeekId } from '../shared/week.js';

const file = process.argv[2];
const base = (process.env.RETRO_URL ?? 'http://localhost:4173').replace(/\/$/, '');
if (!file) {
  console.error('Usage: node scripts/merge.js <file.md>');
  process.exit(1);
}

const md = fs.readFileSync(file, 'utf8');
const weekId = /\b(\d{4}-W\d{2})\b/.exec(md)?.[1] ?? weekIdOf(/\b(\d{4}-\d{2}-\d{2})\b/.exec(md)?.[1] ?? '');
if (!isValidWeekId(weekId)) {
  console.error('Could not tell which week this is: put a date like 2026-11-02 in a "##" day heading.');
  process.exit(1);
}
const incoming = markdownToWeek(md, weekId);

async function attempt() {
  const res = await fetch(`${base}/api/weeks/${weekId}`);
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const current = await res.json();
  const { week, added } = mergeWeeks(current, incoming);
  if (!added.length) return [];
  const put = await fetch(`${base}/api/weeks/${weekId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': `"${current.version}"` },
    body: JSON.stringify(week),
  });
  if (put.status === 409) return null; // changed meanwhile; try again
  if (!put.ok) throw new Error(`PUT ${put.status}: ${(await put.json()).error}`);
  return added;
}

try {
  let added = null;
  for (let i = 0; i < 3 && added === null; i++) added = await attempt();
  if (added === null) throw new Error('the week kept changing; try again');
  if (!added.length) console.log(`Nothing new for ${weekId}; everything is already there.`);
  else {
    console.log(`Added ${added.length} to ${weekId}:`);
    for (const a of added) console.log(`  + ${a}`);
  }
} catch (e) {
  const down = e.cause?.code === 'ECONNREFUSED';
  console.error(down ? `Retro isn't running at ${base}. Start it first (retro), then run this again.` : `Failed: ${e.message}`);
  process.exit(1);
}
