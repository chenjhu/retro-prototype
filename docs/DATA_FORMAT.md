# Data format (for people and AI agents)

All data is plain Markdown on local disk: **one file per ISO week** in the data
directory (default `./data`, override with `DATA_DIR`).

```
data/
  2026-W44.md
  2026-W45.md
```

Weeks follow ISO-8601: they start on **Monday**, and `2026-W45` = 2026-11-02 … 2026-11-08.

## File layout

```markdown
# Week 2026-W45 (2026-11-02 to 2026-11-08)

## Pinned

- [ ] Submit visa form
- [x] Book flights

## Mon 2026-11-02

### Academic

- [x] Read paper A
- [ ] Problem set 3

### Work

### Personal

## Tue 2026-11-03

...one "##" section per day, Mon to Sun...

## Summary

- [ ] Deep work blocks worked well
- [x] Next week: start earlier on problem sets

## Notes

Free-form Markdown, kept verbatim (weekly reflection, plans, etc.).
```

Rules:

| Element | Meaning |
|---|---|
| `## Pinned` | Tasks that must get done this week, not tied to a day |
| `## <anything> YYYY-MM-DD` | A day. Only the date matters; the weekday name is cosmetic |
| `### <Category>` under a day | A column. Default: `Academic`, `Work`, `Personal`. New names become new columns |
| `## Summary` | End-of-week review points (checkbox list) |
| `- [ ] text` / `- [x] text` | Open / done task. One line per task |
| `## Notes` | Free text until the next `##` heading |

Renamed categories: older files may use an old name; it is read as the new one
(`Academics` → `Academic`). The list lives in `CATEGORY_ALIASES` in `shared/model.js`.

## Compatibility promise

Files written by any earlier version must keep loading with nothing lost. Fixtures of
each format version live in `test/fixtures/` and are checked by `npm test`; never edit
them, add a new one when the format changes.

## Backups

Before a week file is first changed on a given day, the server copies it to
`DATA_DIR/.backups/YYYY-MM-DD/<week>.md`. The last 30 days are kept.

## Editing the file directly (agents welcome)

The app watches the folder, so open browsers update within a moment of a file
change. The parser is forgiving:

- `*`, `+` or `-` bullets; `[x]` or `[X]` both mean done.
- A bullet without a checkbox (`- text`) becomes an open task.
- Category names match case-insensitively (`### work` goes into `Work`).
- Sections with dates outside the file's week, and unknown `##` sections, are ignored.
- The app rewrites the file in the canonical layout above on the next save, so
  anything outside these rules (comments, extra text inside day sections) is dropped.
  Put free text in `## Notes`.

Write atomically if you can (write a temp file, then rename) to avoid the app
reading a half-written file.

## HTTP API (while the server runs)

| Method & path | Returns |
|---|---|
| `GET /api/config` | `{ today, currentWeek, defaultCategories }` |
| `GET /api/weeks` | `{ weeks: ["2026-W44", ...] }`: weeks that have a file |
| `GET /api/weeks/2026-W45` | Week as JSON (an empty template if no file yet) plus `version` |
| `GET /api/weeks/2026-W45.md` | The raw Markdown |
| `PUT /api/weeks/2026-W45` | Replace the week with a JSON body. Send `If-Match: "<version>"` to get `409` instead of overwriting newer changes |
| `PUT /api/weeks/2026-W45.md` | Same, with a Markdown body |
| `GET /api/export` | Every week as JSON, for feeding into planning prompts |
| `GET /api/events` | Server-sent events: `week-changed {week, version}` |

JSON shape:

```json
{
  "week": "2026-W45",
  "categories": ["Academic", "Work", "Personal"],
  "pinned": [{ "text": "Submit visa form", "done": false }],
  "summary": [{ "text": "Deep work blocks worked well", "done": false }],
  "days": [
    { "date": "2026-11-02", "items": { "Academic": [{ "text": "Read paper A", "done": true }], "Work": [], "Personal": [] } }
  ],
  "notes": "",
  "dates": ["2026-11-02", "..."],
  "version": "3f2a9c..."
}
```
