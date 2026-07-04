# Taproot

A self-hosted fractal outliner — Roam-style outlining in a single container.

- **`[[Wiki links]]`** anywhere in a bullet; pages are auto-created on first mention
- **Fractal zoom** — click any bullet dot to make that block the page (breadcrumbs lead back up)
- **Linked references** — every page lists the bullets (with their subtrees) that mention it
- **Tasks** — start a bullet with `TODO` to make it a task (checkbox in the UI, Cmd-Enter cycles TODO → DONE); all open tasks aggregate in the Tasks view, grouped by page with age hints
- **Keyboard-first** — Enter splits, Tab/Shift-Tab indent/outdent, Backspace deletes empty bullets, arrows cross block boundaries, `[[` autocompletes page titles

## Stack

TypeScript monorepo: React 19 + CodeMirror 6 (one editor per focused block) + Tailwind 4/shadcn-style UI · Hono on Node with WebSocket live updates · SQLite via Drizzle. All writes are small idempotent ops with client-generated IDs and fractional-index ordering — designed so offline queueing can be added later without a data-layer rewrite.

## Development

```bash
npm install
npm run dev        # server on :3000, Vite client on :5173
```

Open http://localhost:5173. The SQLite file lives in `data/taproot.db` (override with `TAPROOT_DB`).

```bash
npm test           # vitest: wikilink parsing + op engine
npm run typecheck
```

## Production / self-hosting

```bash
npm run build      # builds the client; the server serves client/dist
npm start          # everything on :3000
```

Or with Docker:

```bash
docker build -t taproot .
docker run -p 3000:3000 -v taproot-data:/data taproot
```

No auth built in — put it behind a reverse proxy (Authelia, basic auth, Tailscale) if exposed.

## Data model

Three tables: `pages` (id, title), `blocks` (id, page_id, parent_id, order_key, text), `refs` (block_id, page_id — derived by parsing `[[...]]` on every write). Linked references and zoom views are plain indexed queries. Blocks are the atomic unit; markdown export would be a projection, not the storage format.
