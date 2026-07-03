# Taproot — Agent Instructions

Self-hosted fractal outliner (Roam-style). TypeScript npm-workspaces monorepo.

## Layout

- `shared/` — types (`Block`, `Page`, `Op`, payloads) + wikilink parsing. Source-only package, imported as `@taproot/shared`.
- `server/` — Hono + `@hono/node-ws`, SQLite via Drizzle (`better-sqlite3`). Runs with `tsx`, no build step. Schema bootstrapped with `CREATE TABLE IF NOT EXISTS` in `db.ts` (no migration tooling yet).
- `client/` — Vite + React 19 + Tailwind 4 (shadcn-style theme in `index.css`), zustand store, CodeMirror 6.

## Core invariants

- **All writes are ops** (`shared/src/types.ts` → `Op`). Client applies them optimistically (`client/src/actions.ts` → `dispatch`), POSTs to `/api/ops`, server applies transactionally (`server/src/ops.ts`) and broadcasts over `/ws`. Clients ignore their own echo via `clientId`. Never add a write path that bypasses ops.
- **IDs are client-generated** (nanoid). **Sibling order is fractional-index strings** (`fractional-indexing`), never integers.
- **`refs` is derived state**: rebuilt per block from `[[wikilinks]]` on every create/update in `ops.ts`. Referenced pages are auto-created (`ensurePage`). If you change wikilink syntax, change `shared/src/wikilinks.ts` only.
- Text updates are debounced 400 ms in `actions.ts`; structural ops must call `flushText()` first to preserve ordering.
- Blocks are single-line: Enter is intercepted, pasted newlines are stripped by the `singleLine` transaction filter in `BlockEditor.tsx`.

## Commands

```bash
npm run dev         # server :3000 + vite :5173 (proxy /api, /ws)
npm test            # vitest (shared + server op engine)
npm run typecheck   # tsc -p shared, server, client
npm run build       # client → client/dist, served by server in prod
```

## Conventions

- Strict TS everywhere; `verbatimModuleSyntax` — use `import type`.
- Prettier (single quotes, trailing commas); run `npm run format` before committing.
- Keyboard behavior lives in the `Prec.highest` keymap in `BlockEditor.tsx`; always guard new bindings with `completionStatus()` so the `[[` autocomplete keeps priority.
- Verify UI changes end-to-end in a browser (see `.claude/skills/verify/SKILL.md`), not just with tests.
