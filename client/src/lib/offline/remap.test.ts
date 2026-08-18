import type { Op, Page } from '@taproot/shared';
import { describe, expect, it } from 'vitest';
import { findPageRemaps, remapOps } from './remap';

const page = (id: string, title: string): Page => ({
  id,
  title,
  createdAt: 0,
  pinnedOrderKey: null,
  pinnedFolderId: null,
});

const ops: Op[] = [
  { type: 'create_page', id: 'loc1', title: '2026-07-17' },
  {
    type: 'create_block',
    id: 'b1',
    pageId: 'loc1',
    parentId: null,
    orderKey: 'a0',
    text: 'hi',
  },
  { type: 'update_text', id: 'b1', text: 'hi there' },
];

describe('findPageRemaps', () => {
  it('maps a queued create_page onto an existing server page with the same title', () => {
    const mapping = findPageRemaps(ops, [page('srv1', '2026-07-17')]);
    expect(mapping).toEqual(new Map([['loc1', 'srv1']]));
  });

  it('ignores new titles and pages already under the same id', () => {
    expect(findPageRemaps(ops, [page('x', 'Other')]).size).toBe(0);
    expect(findPageRemaps(ops, [page('loc1', '2026-07-17')]).size).toBe(0);
  });
});

describe('remapOps', () => {
  it('drops the create_page and re-points blocks at the server id', () => {
    const mapping = new Map([['loc1', 'srv1']]);
    expect(remapOps(ops, mapping)).toEqual([
      {
        type: 'create_block',
        id: 'b1',
        pageId: 'srv1',
        parentId: null,
        orderKey: 'a0',
        text: 'hi',
      },
      { type: 'update_text', id: 'b1', text: 'hi there' },
    ]);
  });

  it('re-points a rename of an offline-created page at the server id', () => {
    const rename: Op[] = [
      {
        type: 'rename_page',
        id: 'loc1',
        oldTitle: 'Old',
        title: 'New',
      },
    ];
    expect(remapOps(rename, new Map([['loc1', 'srv1']]))).toEqual([
      {
        type: 'rename_page',
        id: 'srv1',
        oldTitle: 'Old',
        title: 'New',
      },
    ]);
  });

  it('re-points deletion of an offline-created page at the server id', () => {
    const deletion: Op[] = [
      { type: 'delete_page', id: 'loc1', title: 'Temporary' },
    ];
    expect(remapOps(deletion, new Map([['loc1', 'srv1']]))).toEqual([
      { type: 'delete_page', id: 'srv1', title: 'Temporary' },
    ]);
  });

  it('returns the same array reference when nothing matches', () => {
    expect(remapOps(ops, new Map([['other', 'x']]))).toBe(ops);
  });
});
