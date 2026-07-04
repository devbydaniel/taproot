import {
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
});

export const blocks = sqliteTable(
  'blocks',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    orderKey: text('order_key').notNull(),
    text: text('text').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_blocks_page').on(table.pageId),
    index('idx_blocks_parent').on(table.parentId),
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
