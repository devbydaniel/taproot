import { extractWikilinks, type Op, type Page } from '@taproot/shared';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Store } from './db.js';
import { blocks, pages, refs } from './schema.js';

export function ensurePage(store: Store, title: string): Page {
  const existing = store.db
    .select()
    .from(pages)
    .where(eq(pages.title, title))
    .get();
  if (existing) return existing;
  const page: Page = { id: nanoid(), title, createdAt: Date.now() };
  store.db.insert(pages).values(page).run();
  return page;
}

/** Re-derive the refs index for one block from the [[wikilinks]] in its text. */
function updateRefs(store: Store, blockId: string, text: string) {
  store.db.delete(refs).where(eq(refs.blockId, blockId)).run();
  for (const title of extractWikilinks(text)) {
    const page = ensurePage(store, title);
    store.db
      .insert(refs)
      .values({ blockId, pageId: page.id })
      .onConflictDoNothing()
      .run();
  }
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

function applyOp(store: Store, op: Op) {
  const now = Date.now();
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
      break;
    }
    case 'update_text': {
      store.db
        .update(blocks)
        .set({ text: op.text, updatedAt: now })
        .where(eq(blocks.id, op.id))
        .run();
      updateRefs(store, op.id, op.text);
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
  }
}

export function applyOps(store: Store, ops: Op[]) {
  store.sqlite.transaction(() => {
    for (const op of ops) applyOp(store, op);
  })();
}
