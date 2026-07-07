import type { Block } from '@taproot/shared';
import { describe, expect, it } from 'vitest';
import { visibleOrder } from './outline';

function block(
  id: string,
  parentId: string | null,
  orderKey: string,
  collapsed = false,
): Block {
  return {
    id,
    pageId: 'p1',
    parentId,
    orderKey,
    text: id,
    kind: 'text',
    data: null,
    collapsed,
    createdAt: 0,
    updatedAt: 0,
  };
}

function byId(list: Block[]): Record<string, Block> {
  return Object.fromEntries(list.map((b) => [b.id, b]));
}

describe('visibleOrder with collapsed blocks', () => {
  // a (collapsed) > a1 > a1a, then b
  const blocks = byId([
    block('a', null, 'a0', true),
    block('a1', 'a', 'a0'),
    block('a1a', 'a1', 'a0'),
    block('b', null, 'a1'),
  ]);

  it('includes a collapsed block but skips its descendants', () => {
    const order = visibleOrder(blocks, { pageId: 'p1', rootParentId: null });
    expect(order.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('hides expanded blocks nested under a collapsed ancestor', () => {
    const order = visibleOrder(blocks, { pageId: 'p1', rootParentId: null });
    expect(order.map((b) => b.id)).not.toContain('a1a');
  });

  it('treats the zoom root as expanded even when collapsed', () => {
    const order = visibleOrder(blocks, { pageId: 'p1', rootParentId: 'a' });
    expect(order.map((b) => b.id)).toEqual(['a1', 'a1a']);
  });

  it('preserves sibling order around a collapsed subtree', () => {
    const withMore = byId([
      block('x', null, 'a0'),
      ...Object.values(blocks),
      block('c', null, 'a2'),
    ]);
    const order = visibleOrder(withMore, { pageId: 'p1', rootParentId: null });
    expect(order.map((b) => b.id)).toEqual(['x', 'a', 'b', 'c']);
  });
});
