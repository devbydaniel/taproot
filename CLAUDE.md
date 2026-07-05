# Taproot

Self-hosted fractal outliner (Roam-style): pages of nested blocks, `[[wikilinks]]` with linked references, TODO/DONE tasks, a daily-notes journal. TypeScript npm-workspaces monorepo.

## Commands

```bash
npm run dev                 # server :3000 + vite :5173 (proxy /api, /ws)
npm test                    # vitest (shared + server op engine)
npm run typecheck           # tsc -p shared, server, client
npm run format              # prettier
npm run build               # client → client/dist, served by server in prod
npm run db:generate -w server   # regenerate migrations after editing schema.ts
```

## Layout

- `shared/` — the domain core, pure (no Node APIs, no DB, no HTTP — it runs in the browser too): op schemas (`ops.ts`), entity/payload types (`types.ts`), wikilink parsing, task parsing, daily-title logic. Source-only package, imported as `@taproot/shared`.
- `server/` — Hono + `@hono/node-ws`, SQLite via drizzle (`better-sqlite3`, synchronous). Runs with `tsx`, no build step.
  - `schema.ts` — drizzle tables, **the single source of truth for the DB schema**
  - `drizzle/` — generated migrations, applied by `migrate()` in `db.ts` at startup
  - `ops.ts` — write path: op interpreter + derived-index upkeep
  - `queries.ts` — read path: returns payload types from `shared/`
  - `index.ts` — routes + WebSocket broadcast, no logic
- `client/` — Vite + React 19 + Tailwind 4 (shadcn-style theme in `index.css`), zustand store, CodeMirror 6.

## The write model — every mutation is an Op

The one big architectural rule. `Op` shapes are defined **once**, as zod schemas in `shared/src/ops.ts`; the TS types are inferred from them (`z.infer`), so compile-time types and runtime validation cannot drift.

Flow: client applies ops optimistically (`client/src/actions.ts` → `dispatch`) → POST `/api/ops` → server validates with `opsRequestSchema.safeParse` at the boundary → `applyOps` runs them in one transaction → broadcast over `/ws` → other clients apply them (clients ignore their own echo via `clientId`).

- IDs are **client-generated** (nanoid). Sibling order is **fractional-index strings** (`fractional-indexing`), never integers.
- Text updates are debounced 400 ms in `actions.ts`; structural ops must call `flushText()` first to preserve op ordering.
- Task state changes are plain `update_text` ops — never a separate write path.

## Invariants — do not break

1. **All writes go through `applyOps`** (`server/src/ops.ts`). Never INSERT/UPDATE tables from anywhere else (`reindexTasks` is the one documented exception).
2. **`refs` and `tasks` are derived state**, recomputed from block text on every create/update and rebuilt at startup by `reindexTasks`. Never written from `queries.ts`, never hand-edited. Block text is the source of truth.
3. **Wikilink syntax lives only in `shared/src/wikilinks.ts`**; task-marker syntax only in `shared/src/tasks.ts` (a block is a task iff its text starts with `TODO `/`DONE `). Referenced pages are auto-created (`ensurePage`).
4. **`shared/` stays pure** — importing Node or server modules there breaks the client.
5. **Routes contain no logic**: parse/validate → call one function from `ops.ts`/`queries.ts` → serialize.
6. **Server functions take `store: Store` as the first argument**; tests use `createStore(':memory:')`.
7. **Schema changes happen in `schema.ts` only**, then `npm run db:generate -w server`. Never hand-write DDL; migrations run automatically at startup.
8. **No N+1 queries**: when a query touches a set of pages/blocks, batch with `inArray` (see `groupByPage`), don't loop single-row queries.
9. Blocks are single-line: Enter is intercepted; pasted newlines are stripped by the `singleLine` transaction filter in `BlockEditor.tsx`.

## Recipe: add a new write operation

1. Add a variant to `opSchema` in `shared/src/ops.ts` — the `Op` type updates by inference.
2. The compiler now errors at every site that must handle it (exhaustive `op satisfies never` switches): implement it in `applyOp` (`server/src/ops.ts`) and `applyOpToBlocks` (`client/src/store.ts`).
3. If the op writes block text, keep `updateRefs` + `updateTaskIndex` in the loop.
4. Emit it from a client action (`client/src/actions.ts`) via `dispatch` — persistence, validation, and broadcast come for free.
5. Test in `server/src/ops.test.ts` through `applyOps` + a query function.

## Recipe: add a new read view

1. Payload type in `shared/src/types.ts`.
2. Query function in `server/src/queries.ts` returning it (batched queries, invariant 8).
3. Route in `server/src/index.ts` (thin, invariant 5).
4. Client fetch in `client/src/lib/api.ts`.
5. Test in `server/src/ops.test.ts`: write ops, assert on the query result.

## Conventions

- Strict TS everywhere; `verbatimModuleSyntax` — use `import type`.
- Prettier (single quotes, trailing commas); run `npm run format` before committing.
- Keyboard behavior lives in the `Prec.highest` keymap in `BlockEditor.tsx`; guard new bindings with `completionStatus()` so the `[[` autocomplete keeps priority.
- Tests go through the public seam (ops in, queries out) against `:memory:` — don't assert on private table state unless testing the index itself.
- Verify UI changes end-to-end in a browser (see `.claude/skills/verify/SKILL.md`), not just with tests.
