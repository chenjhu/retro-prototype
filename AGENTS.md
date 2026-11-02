# Notes for AI agents

- The user's weekly plans live in `data/YYYY-Www.md` (or `$DATA_DIR`). The format is in
  `docs/DATA_FORMAT.md`. Read those files directly; no server needed.
- To add or update tasks, edit the Markdown file following that format, or use the
  HTTP API documented there when the server is running.
- Code layout: `server.js` (zero-dependency Node server), `shared/` (week math, data
  model, Markdown parser/serializer; used by server and browser), `public/` (web UI;
  `store.js` holds state and sync, `app.js` is the view). Tests: `npm test`.
