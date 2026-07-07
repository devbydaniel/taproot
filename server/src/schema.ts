import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  title: text('title').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  // fractional index among pinned pages; null = not pinned
  pinnedOrderKey: text('pinned_order_key'),
});

export const blocks = sqliteTable(
  'blocks',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    // deleting a block cascades to its whole subtree via this self-reference
    parentId: text('parent_id'),
    orderKey: text('order_key').notNull(),
    text: text('text').notNull().default(''),
    kind: text('kind', { enum: ['text', 'drawing'] })
      .notNull()
      .default('text'),
    // opaque payload for non-text kinds (drawing: scene JSON); never indexed
    data: text('data'),
    // children hidden in outline views; persisted UI state, not content
    collapsed: integer('collapsed', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_blocks_page').on(table.pageId),
    index('idx_blocks_parent').on(table.parentId),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'blocks_parent_id_fk',
    }).onDelete('cascade'),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    blockId: text('block_id')
      .primaryKey()
      .references(() => blocks.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    completedAt: integer('completed_at'),
  },
  (table) => [index('idx_tasks_state').on(table.state)],
);

export const refs = sqliteTable(
  'refs',
  {
    blockId: text('block_id')
      .notNull()
      .references(() => blocks.id, { onDelete: 'cascade' }),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.blockId, table.pageId] }),
    index('idx_refs_page').on(table.pageId),
  ],
);
