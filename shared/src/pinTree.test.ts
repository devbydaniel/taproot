import { describe, expect, it } from 'vitest';
import { buildPinTree, pinnedSiblings, topLevelOrderKeys } from './pinTree.js';
import type { Page, PinFolder } from './types.js';

const page = (
  id: string,
  pinnedOrderKey: string | null,
  pinnedFolderId: string | null = null,
): Page => ({
  id,
  title: id,
  createdAt: 0,
  pinnedOrderKey,
  pinnedFolderId,
});

const folder = (
  id: string,
  orderKey: string,
  collapsed = false,
): PinFolder => ({
  id,
  name: id,
  orderKey,
  collapsed,
  createdAt: 0,
});

describe('buildPinTree', () => {
  it('interleaves folders and loose pages in one top-level ordering', () => {
    const pages = [page('a', 'a0'), page('c', 'a2'), page('unpinned', null)];
    const folders = [folder('f', 'a1')];
    expect(
      buildPinTree(pages, folders).map((node) =>
        node.type === 'folder' ? node.folder.id : node.page.id,
      ),
    ).toEqual(['a', 'f', 'c']);
  });

  it('nests the pages of a folder in their own order', () => {
    const pages = [page('second', 'a1', 'f'), page('first', 'a0', 'f')];
    const nodes = buildPinTree(pages, [folder('f', 'a0')]);
    expect(nodes).toEqual([
      {
        type: 'folder',
        folder: folder('f', 'a0'),
        pages: [page('first', 'a0', 'f'), page('second', 'a1', 'f')],
      },
    ]);
  });

  it('sorts by code point, not locale collation', () => {
    // localeCompare would put 'Zz' after 'a0'
    const pages = [page('lower', 'a0'), page('upper', 'Zz')];
    expect(
      buildPinTree(pages, []).map((node) =>
        node.type === 'page' ? node.page.id : '',
      ),
    ).toEqual(['upper', 'lower']);
  });

  it('drops unpinned pages and keeps empty folders', () => {
    expect(buildPinTree([page('x', null, 'f')], [folder('f', 'a0')])).toEqual([
      { type: 'folder', folder: folder('f', 'a0'), pages: [] },
    ]);
  });

  it('falls back to top level when the folder is gone', () => {
    expect(buildPinTree([page('orphan', 'a0', 'missing')], [])).toEqual([
      { type: 'page', page: page('orphan', 'a0', 'missing') },
    ]);
  });
});

describe('pinnedSiblings', () => {
  it('returns the ordered pages of one container', () => {
    const pages = [
      page('top', 'a0'),
      page('in-b', 'a1', 'f'),
      page('in-a', 'a0', 'f'),
    ];
    expect(pinnedSiblings(pages, 'f').map((p) => p.id)).toEqual([
      'in-a',
      'in-b',
    ]);
    expect(pinnedSiblings(pages, null).map((p) => p.id)).toEqual(['top']);
  });
});

describe('topLevelOrderKeys', () => {
  it('lists the keys of the shared top-level keyspace', () => {
    expect(
      topLevelOrderKeys(
        [page('a', 'a0'), page('c', 'a2')],
        [folder('f', 'a1')],
      ),
    ).toEqual(['a0', 'a1', 'a2']);
  });
});
