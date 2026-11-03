# Notes for AI agents

- The user's weekly plans live in `data/YYYY-Www.md` (or `$DATA_DIR`). The format is in
  `docs/DATA_FORMAT.md`. Read those files directly; no server needed.
- To add or update tasks, edit the Markdown file following that format, or use the
  HTTP API documented there when the server is running.
- Code layout:
  - `server/index.js`: zero-dependency Node server (files, JSON API, live events, static files)
  - `shared/`: week math, data model, Markdown parser/serializer (used by server and browser)
  - `public/js/store.js`: client state, autosave, conflict merge (UI-agnostic)
  - `public/js/app.js`: view controller (modes, gestures); `items.js` keyed list rendering
  - `public/css/style.css`: UI, measured from the Figma mock-ups (`docs/design/`)
- Tests: `npm test`.
