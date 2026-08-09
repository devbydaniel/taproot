import {
  extractPageReferences,
  isPinFolderOp,
  parseTask,
  type Op,
  type Page,
  type PinFolderOp,
  type TaskState,
} from '@taproot/shared';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Store } from './db.js';
import { blocks, pages, pinFolders, refs, tasks } from './schema.js';

export function ensurePage(store: Store, title: string): Page {
  const existing = store.db
    .select()
    .from(pages)
    .where(eq(pages.title, title))
    .get();
  if (existing) return existing;
  const page: Page = {
    id: nanoid(),
    title,
    createdAt: Date.now(),
    pinnedOrderKey: null,
    pinnedFolderId: null,
  };
  store.db.insert(pages).values(page).run();
  return page;
}

/** Re-derive the refs index for one block from the page references in its text. */
function updateRefs(store: Store, blockId: string, text: string) {
  store.db.delete(refs).where(eq(refs.blockId, blockId)).run();
  for (const title of extractPageReferences(text)) {
    const page = ensurePage(store, title);
    store.db
      .insert(refs)
      .values({ blockId, pageId: page.id })
      .onConflictDoNothing()
      .run();
  }
}

/** Re-derive the task index for one block from its TODO/DONE marker. */
function updateTaskIndex(store: Store, blockId: string, text: string) {
  const parsed = parseTask(text);
  if (!parsed) {
    store.db.delete(tasks).where(eq(tasks.blockId, blockId)).run();
    return;
  }
  const existing = store.db
    .select()
    .from(tasks)
    .where(eq(tasks.blockId, blockId))
    .get();
  const completedAt =
    parsed.state === 'DONE'
      ? existing?.state === 'DONE'
        ? existing.completedAt
        : Date.now()
      : null;
  store.db
    .insert(tasks)
    .values({ blockId, state: parsed.state, completedAt })
    .onConflictDoUpdate({
      target: tasks.blockId,
      set: { state: parsed.state, completedAt },
    })
    .run();
}

type TextBlock = { id: string; text: string };

/** Rebuild refs and create missing targets without an N+1 page lookup. */
function reindexRefs(store: Store, textBlocks: TextBlock[]) {
  const pageIds = new Map(
    (
      store.sqlite.prepare('SELECT id, title FROM pages').all() as {
        id: string;
        title: string;
      }[]
    ).map((page) => [page.title, page.id]),
  );
  const references = textBlocks.flatMap((block) =>
    extractPageReferences(block.text).map((title) => ({
      blockId: block.id,
      title,
    })),
  );
  const insertPage = store.sqlite.prepare(
    'INSERT INTO pages (id, title, created_at) VALUES (?, ?, ?)',
  );
  for (const { title } of references) {
    if (pageIds.has(title)) continue;
    const id = nanoid();
    insertPage.run(id, title, Date.now());
    pageIds.set(title, id);
  }

  store.sqlite.prepare('DELETE FROM refs').run();
  const insertRef = store.sqlite.prepare(
    'INSERT INTO refs (block_id, page_id) VALUES (?, ?)',
  );
  for (const { blockId, title } of references) {
    insertRef.run(blockId, pageIds.get(title)!);
  }
}

/**
 * Reconcile the derived indexes with text blocks at startup. Refs can be
 * rebuilt wholesale; tasks are diffed so completedAt survives restarts.
 * The exported name is retained for callers from before refs needed backfill.
 */
export function reindexTasks(store: Store) {
  store.sqlite.transaction(() => {
    const textBlocks = store.sqlite
      .prepare("SELECT id, text FROM blocks WHERE kind = 'text'")
      .all() as TextBlock[];
    reindexRefs(store, textBlocks);

    const parsed = new Map<string, TaskState>();
    for (const { id, text } of textBlocks) {
      const task = parseTask(text);
      if (task) parsed.set(id, task.state);
    }

    const indexed = store.sqlite
      .prepare('SELECT block_id AS blockId FROM tasks')
      .all() as { blockId: string }[];
    const deleteStale = store.sqlite.prepare(
      'DELETE FROM tasks WHERE block_id = ?',
    );
    for (const { blockId } of indexed) {
      if (!parsed.has(blockId)) deleteStale.run(blockId);
    }

    const upsert = store.sqlite.prepare(`
      INSERT INTO tasks (block_id, state, completed_at)
      VALUES (@blockId, @state, @completedAt)
      ON CONFLICT(block_id) DO UPDATE SET
        state = excluded.state,
        completed_at = CASE
          WHEN excluded.state != 'DONE' THEN NULL
          WHEN tasks.state = 'DONE' THEN tasks.completed_at
          ELSE excluded.completed_at
        END
    `);
    const now = Date.now();
    for (const [blockId, state] of parsed) {
      upsert.run({
        blockId,
        state,
        completedAt: state === 'DONE' ? now : null,
      });
    }
  })();
}

function wouldCreateCycle(
  store: Store,
  blockId: string,
  newParentId: string | null,
): boolean {
  let current = newParentId;
  while (current) {
    if (current === blockId) return true;
    const row = store.db
      .select({ parentId: blocks.parentId })
      .from(blocks)
      .where(eq(blocks.id, current))
      .get();
    current = row?.parentId ?? null;
  }
  return false;
}

function applyPinFolderOp(store: Store, op: PinFolderOp) {
  switch (op.type) {
    case 'create_pin_folder': {
      // the offline queue replays ops, so creation must be idempotent
      store.db
        .insert(pinFolders)
        .values({
          id: op.id,
          name: op.name,
          orderKey: op.orderKey,
          collapsed: false,
          createdAt: Date.now(),
        })
        .onConflictDoNothing()
        .run();
      break;
    }
    case 'rename_pin_folder': {
      store.db
        .update(pinFolders)
        .set({ name: op.name })
        .where(eq(pinFolders.id, op.id))
        .run();
      break;
    }
    case 'move_pin_folder': {
      store.db
        .update(pinFolders)
        .set({ orderKey: op.orderKey })
        .where(eq(pinFolders.id, op.id))
        .run();
      break;
    }
    case 'set_pin_folder_collapsed': {
      store.db
        .update(pinFolders)
        .set({ collapsed: op.collapsed })
        .where(eq(pinFolders.id, op.id))
        .run();
      break;
    }
    case 'delete_pin_folder': {
      // a folder holds no content: its pages are unpinned, not deleted. This
      // has to run first — the FK on pages.pinned_folder_id has no ON DELETE
      // action, so a leftover reference would abort the transaction.
      store.db
        .update(pages)
        .set({ pinnedOrderKey: null, pinnedFolderId: null })
        .where(eq(pages.pinnedFolderId, op.id))
        .run();
      store.db.delete(pinFolders).where(eq(pinFolders.id, op.id)).run();
      break;
    }
    default: {
      op satisfies never;
      break;
    }
  }
}

function applyOp(store: Store, op: Op) {
  const now = Date.now();
  if (isPinFolderOp(op)) {
    applyPinFolderOp(store, op);
    return;
  }
  switch (op.type) {
    case 'create_page': {
      store.db
        .insert(pages)
        .values({ id: op.id, title: op.title, createdAt: now })
        .onConflictDoNothing()
        .run();
      break;
    }
    case 'create_block': {
      store.db
        .insert(blocks)
        .values({
          id: op.id,
          pageId: op.pageId,
          parentId: op.parentId,
          orderKey: op.orderKey,
          text: op.text,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      updateRefs(store, op.id, op.text);
      updateTaskIndex(store, op.id, op.text);
      break;
    }
    case 'update_text': {
      const { changes } = store.db
        .update(blocks)
        .set({ text: op.text, updatedAt: now })
        .where(eq(blocks.id, op.id))
        .run();
      // The block is gone (deleted here or on another client while this op sat
      // in an offline queue). The edit is dropped, and so are its derived rows
      // — writing refs/tasks for a missing block violates their foreign keys
      // and would fail the whole batch.
      if (changes === 0) break;
      updateRefs(store, op.id, op.text);
      updateTaskIndex(store, op.id, op.text);
      break;
    }
    case 'move_block': {
      if (wouldCreateCycle(store, op.id, op.parentId)) break;
      store.db
        .update(blocks)
        .set({ parentId: op.parentId, orderKey: op.orderKey, updatedAt: now })
        .where(eq(blocks.id, op.id))
        .run();
      break;
    }
    case 'delete_block': {
      // children and refs cascade via foreign keys
      store.db.delete(blocks).where(eq(blocks.id, op.id)).run();
      break;
    }
    case 'set_collapsed': {
      // presentation state, not content: updatedAt stays untouched
      store.db
        .update(blocks)
        .set({ collapsed: op.collapsed })
        .where(eq(blocks.id, op.id))
        .run();
      break;
    }
    case 'set_kind': {
      store.db
        .update(blocks)
        .set({ kind: op.kind, updatedAt: now })
        .where(eq(blocks.id, op.id))
        .run();
      break;
    }
    case 'update_data': {
      // data is an opaque payload — deliberately no updateRefs/updateTaskIndex:
      // a drawing whose scene JSON contains "[[foo]]" or "TODO" must not
      // pollute the derived indexes
      store.db
        .update(blocks)
        .set({ data: op.data, updatedAt: now })
        .where(eq(blocks.id, op.id))
        .run();
      break;
    }
    case 'set_page_pinned': {
      store.db
        .update(pages)
        .set({
          pinnedOrderKey: op.orderKey,
          // an unpinned page never keeps a stale folder; absent folderId
          // (ops queued before folders existed) means top level
          pinnedFolderId: op.orderKey === null ? null : (op.folderId ?? null),
        })
        .where(eq(pages.id, op.id))
        .run();
      break;
    }
    default: {
      // exhaustiveness: adding an Op variant is a compile error here until handled
      op satisfies never;
      break;
    }
  }
}

export function applyOps(store: Store, ops: Op[]) {
  store.sqlite.transaction(() => {
    for (const op of ops) applyOp(store, op);
  })();
}

/**
 * Replace a doc block's markdown from the HTTP API. Refuses blocks that are
 * missing or not kind 'doc' (returns null → 404) so the endpoint can never
 * stomp a drawing scene or a text block's data. Returns the applied ops for
 * the route layer to broadcast.
 */
export function saveDocMarkdown(
  store: Store,
  blockId: string,
  markdown: string,
): Op[] | null {
  const block = store.db
    .select({ kind: blocks.kind })
    .from(blocks)
    .where(eq(blocks.id, blockId))
    .get();
  if (!block || block.kind !== 'doc') return null;
  const ops: Op[] = [{ type: 'update_data', id: blockId, data: markdown }];
  applyOps(store, ops);
  return ops;
}
