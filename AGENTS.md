# Notes for AI agents

- The user's weekly plans live in `data/YYYY-Www.md` (or `$DATA_DIR`). The format is in
  `docs/DATA_FORMAT.md`. Read those files directly; no server needed.
- For outreach lines (a person or organisation), `[ ]` = contacted, no reply yet and
  `[x]` = they replied / relationship established. See "What a checkbox means for
  outreach" in `docs/DATA_FORMAT.md` before summarising or planning from the data.
- `- [ ] ==text==` = a highlighted (important) task; the `==` are markup, not part of the text.
- Tags in task text: `(L)` = in contact on LinkedIn, `(LC)` = LinkedIn connection
  request only. Full list under "Abbreviations" in `docs/DATA_FORMAT.md`.
- To add tasks, prefer `node scripts/merge.js <file.md>` while the server runs: it only
  appends (skips tasks already present), so it can't clobber the user's data. Otherwise
  edit the Markdown file following that format, or use the HTTP API documented there.
- Code layout:
  - `server/index.js`: zero-dependency Node server (files, JSON API, live events, static files)
  - `shared/`: week math, data model, Markdown parser/serializer (used by server and browser)
  - `public/js/store.js`: client state, autosave, conflict merge, offline copy + unsent edits in
    localStorage (`retro.week.<id>`), sent later via `syncPending()` (UI-agnostic)
  - `public/sw.js`: service worker, network-first cache of the app's own files (never data)
  - `scripts/service.sh`: macOS launchd background service
  - `public/js/app.js`: view controller (modes, gestures); `items.js` keyed list rendering
  - `public/css/style.css`: UI, measured from the Figma mock-ups (`docs/design/`)
- Tests: `npm test`.
