import type { Op } from '@taproot/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import { pages } from './schema.js';
import type { Store } from './db.js';
import { applyOps } from './ops.js';

interface SeedNode {
  text: string;
  children?: SeedNode[];
}

function nodesToOps(
  pageId: string,
  parentId: string | null,
  nodes: SeedNode[],
): Op[] {
  const ops: Op[] = [];
  let orderKey: string | null = null;
  for (const node of nodes) {
    const id = nanoid();
    orderKey = generateKeyBetween(orderKey, null);
    ops.push({
      type: 'create_block',
      id,
      pageId,
      parentId,
      orderKey,
      text: node.text,
    });
    if (node.children) ops.push(...nodesToOps(pageId, id, node.children));
  }
  return ops;
}

export function seedIfEmpty(store: Store) {
  const existing = store.db.select().from(pages).limit(1).all();
  if (existing.length > 0) return;

  const welcomeId = nanoid();
  const ops: Op[] = [{ type: 'create_page', id: welcomeId, title: 'Welcome' }];
  ops.push(
    ...nodesToOps(welcomeId, null, [
      {
        text: 'Welcome to Taproot — a fractal outliner.',
        children: [
          {
            text: 'Every bullet is a block. Click a bullet dot to zoom into it.',
            children: [
              {
                text: 'A zoomed block behaves like a page — that is fractal outlining.',
              },
            ],
          },
          { text: 'Link pages with [[Ideas]] anywhere in your text.' },
          { text: 'Type [[ to autocomplete existing page titles.' },
        ],
      },
      {
        text: 'Keyboard: Enter splits, Tab indents, Shift-Tab outdents, Backspace on an empty bullet deletes it.',
      },
      {
        text: 'Every mention of a page shows up at the bottom of that page under Linked References — try opening [[Ideas]].',
      },
    ]),
  );
  applyOps(store, ops);
}
