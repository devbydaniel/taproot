import type { Page, PinFolder } from '@taproot/shared';
import { describe, expect, it } from 'vitest';
import { appendPinKey, buildPinRows, resolvePinDrop } from './pinTree';

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

describe('buildPinRows', () => {
  it('flattens the tree in display order', () => {
    const pages = [page('loose', 'a0'), page('child', 'a0', 'f')];
    const rows = buildPinRows(pages, [folder('f', 'a1')]);
    expect(rows.map((row) => [row.kind, row.id])).toEqual([
      ['page', 'loose'],
      ['folder', 'f'],
      ['page', 'child'],
    ]);
    expect(rows[2]).toMatchObject({ folderId: 'f' });
  });

  it('hides the children of a collapsed folder', () => {
    const rows = buildPinRows(
      [page('child', 'a0', 'f')],
      [folder('f', 'a0', true)],
    );
    expect(rows.map((row) => row.id)).toEqual(['f']);
  });
});

describe('resolvePinDrop', () => {
  it('reorders a page within its container', () => {
    const pages = [page('a', 'a0'), page('b', 'a1'), page('c', 'a2')];
    const [op] = resolvePinDrop(pages, [], 'c', 'a');
    expect(op).toMatchObject({
      type: 'set_page_pinned',
      id: 'c',
      folderId: null,
    });
    // lands before 'a', so its key must sort first
    expect(op?.type === 'set_page_pinned' && op.orderKey! < 'a0').toBe(true);
  });

  it('moves a page into the folder it was dropped on, at the end', () => {
    const pages = [page('loose', 'a5'), page('inside', 'a0', 'f')];
    const ops = resolvePinDrop(pages, [folder('f', 'a1')], 'loose', 'f');
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op).toMatchObject({
      type: 'set_page_pinned',
      id: 'loose',
      folderId: 'f',
    });
    // after 'inside', the folder's only page
    expect(op?.type === 'set_page_pinned' && op.orderKey! > 'a0').toBe(true);
  });

  it('expands a collapsed folder it drops a page into', () => {
    const ops = resolvePinDrop(
      [page('loose', 'a5')],
      [folder('f', 'a1', true)],
      'loose',
      'f',
    );
    expect(ops[1]).toEqual({
      type: 'set_pin_folder_collapsed',
      id: 'f',
      collapsed: false,
    });
  });

  it('does nothing when a page is dropped on the folder it is already in', () => {
    expect(
      resolvePinDrop(
        [page('inside', 'a0', 'f')],
        [folder('f', 'a1')],
        'inside',
        'f',
      ),
    ).toEqual([]);
  });

  it('splices a page into another container at the target slot', () => {
    const pages = [
      page('loose', 'a5'),
      page('first', 'a0', 'f'),
      page('second', 'a1', 'f'),
    ];
    const [op] = resolvePinDrop(pages, [folder('f', 'a1')], 'loose', 'second');
    expect(op).toMatchObject({ id: 'loose', folderId: 'f' });
    // between 'first' and 'second'
    const key = op?.type === 'set_page_pinned' ? op.orderKey! : '';
    expect(key > 'a0' && key < 'a1').toBe(true);
  });

  it('moves a page out of a folder onto a top-level page', () => {
    const pages = [page('top', 'a0'), page('inside', 'a0', 'f')];
    const [op] = resolvePinDrop(pages, [folder('f', 'a1')], 'inside', 'top');
    expect(op).toMatchObject({
      type: 'set_page_pinned',
      id: 'inside',
      folderId: null,
    });
    // takes over the slot it was dropped on, so it sorts before 'top'
    expect(op?.type === 'set_page_pinned' && op.orderKey! < 'a0').toBe(true);
  });

  it('reorders a folder among the top-level entries', () => {
    const pages = [page('a', 'a0'), page('c', 'a2')];
    const [op] = resolvePinDrop(pages, [folder('f', 'a1')], 'f', 'a');
    expect(op).toMatchObject({ type: 'move_pin_folder', id: 'f' });
    expect(op?.type === 'move_pin_folder' && op.orderKey < 'a0').toBe(true);
  });

  it('targets the folder slot when a folder is dropped on a page inside one', () => {
    // dragging f2 onto f1's child must place f2 at f1's top-level slot
    const pages = [page('child', 'a0', 'f1')];
    const folders = [folder('f1', 'a0'), folder('f2', 'a1')];
    const [op] = resolvePinDrop(pages, folders, 'f2', 'child');
    expect(op).toMatchObject({ type: 'move_pin_folder', id: 'f2' });
    expect(op?.type === 'move_pin_folder' && op.orderKey < 'a0').toBe(true);
  });

  it('ignores drops on itself and on unknown rows', () => {
    const pages = [page('a', 'a0')];
    expect(resolvePinDrop(pages, [], 'a', 'a')).toEqual([]);
    expect(resolvePinDrop(pages, [], 'a', 'ghost')).toEqual([]);
    expect(resolvePinDrop(pages, [], 'ghost', 'a')).toEqual([]);
  });
});

describe('appendPinKey', () => {
  it('appends after the last page of a folder', () => {
    const pages = [page('a', 'a0'), page('inside', 'a3', 'f')];
    expect(appendPinKey(pages, [folder('f', 'a1')], 'f') > 'a3').toBe(true);
  });

  it('appends after the last top-level entry, folders included', () => {
    // a folder sorting last owns the top-level keyspace: appending on pages
    // alone would mint 'a1' again and collide with it
    const key = appendPinKey([page('a', 'a0')], [folder('f', 'a1')], null);
    expect(key > 'a1').toBe(true);
  });
});
