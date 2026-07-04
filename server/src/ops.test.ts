import type { Op } from '@taproot/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, type Store } from './db.js';
import { applyOps, ensurePage, reindexTasks } from './ops.js';
import {
  getPagePayload,
  getTaskGroups,
  getZoomPayload,
  listPages,
} from './queries.js';

let store: Store;

beforeEach(() => {
  store = createStore(':memory:');
});

function setupPage(title: string) {
  return ensurePage(store, title);
}

describe('applyOps', () => {
  it('creates blocks and auto-creates referenced pages', () => {
    const page = setupPage('Home');
    const ops: Op[] = [
      {
        type: 'create_block',
        id: 'b1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'hello [[World]]',
      },
    ];
    applyOps(store, ops);

    const titles = listPages(store).map((p) => p.title);
    expect(titles).toContain('World');

    const world = ensurePage(store, 'World');
    const payload = getPagePayload(store, world.id);
    expect(payload?.linkedRefs).toHaveLength(1);
    expect(payload?.linkedRefs[0]?.blocks.map((b) => b.id)).toEqual(['b1']);
  });

  it('updates refs when text changes', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: '[[A]]',
      },
    ]);
    applyOps(store, [{ type: 'update_text', id: 'b1', text: 'now [[B]]' }]);

    const a = ensurePage(store, 'A');
    const b = ensurePage(store, 'B');
    expect(getPagePayload(store, a.id)?.linkedRefs).toHaveLength(0);
    expect(getPagePayload(store, b.id)?.linkedRefs).toHaveLength(1);
  });

  it('includes the full subtree of a referencing block in linked refs', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'root',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'about [[Topic]]',
      },
      {
        type: 'create_block',
        id: 'child',
        pageId: page.id,
        parentId: 'root',
        orderKey: 'a0',
        text: 'detail',
      },
      {
        type: 'create_block',
        id: 'grandchild',
        pageId: page.id,
        parentId: 'child',
        orderKey: 'a0',
        text: 'more',
      },
      {
        type: 'create_block',
        id: 'unrelated',
        pageId: page.id,
        parentId: null,
        orderKey: 'a1',
        text: 'other',
      },
    ]);

    const topic = ensurePage(store, 'Topic');
    const refGroup = getPagePayload(store, topic.id)?.linkedRefs[0];
    expect(refGroup?.rootIds).toEqual(['root']);
    expect(refGroup?.blocks.map((b) => b.id).sort()).toEqual([
      'child',
      'grandchild',
      'root',
    ]);
  });

  it('folds nested matches into the top-most matching block', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'outer',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: '[[T]] outer',
      },
      {
        type: 'create_block',
        id: 'inner',
        pageId: page.id,
        parentId: 'outer',
        orderKey: 'a0',
        text: '[[T]] inner',
      },
    ]);
    const t = ensurePage(store, 'T');
    const group = getPagePayload(store, t.id)?.linkedRefs[0];
    expect(group?.rootIds).toEqual(['outer']);
  });

  it('deletes a block subtree with cascading refs', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'root',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'r',
      },
      {
        type: 'create_block',
        id: 'child',
        pageId: page.id,
        parentId: 'root',
        orderKey: 'a0',
        text: '[[X]]',
      },
    ]);
    applyOps(store, [{ type: 'delete_block', id: 'root' }]);

    expect(getPagePayload(store, page.id)?.blocks).toHaveLength(0);
    const x = ensurePage(store, 'X');
    expect(getPagePayload(store, x.id)?.linkedRefs).toHaveLength(0);
  });

  it('ignores moves that would create a cycle', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'a',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'a',
      },
      {
        type: 'create_block',
        id: 'b',
        pageId: page.id,
        parentId: 'a',
        orderKey: 'a0',
        text: 'b',
      },
    ]);
    applyOps(store, [
      { type: 'move_block', id: 'a', parentId: 'b', orderKey: 'a0' },
    ]);

    const payload = getPagePayload(store, page.id);
    const a = payload?.blocks.find((blk) => blk.id === 'a');
    expect(a?.parentId).toBeNull();
  });

  it('builds zoom payloads with ancestors and subtree', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'top',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'top',
      },
      {
        type: 'create_block',
        id: 'mid',
        pageId: page.id,
        parentId: 'top',
        orderKey: 'a0',
        text: 'mid',
      },
      {
        type: 'create_block',
        id: 'leaf',
        pageId: page.id,
        parentId: 'mid',
        orderKey: 'a0',
        text: 'leaf',
      },
    ]);

    const zoom = getZoomPayload(store, 'mid');
    expect(zoom?.ancestors.map((b) => b.id)).toEqual(['top']);
    expect(zoom?.blocks.map((b) => b.id).sort()).toEqual(['leaf', 'mid']);
    expect(zoom?.page.title).toBe('Home');
  });
});

describe('task index', () => {
  const block = (
    id: string,
    pageId: string,
    text: string,
    parentId: string | null = null,
  ): Op => ({
    type: 'create_block',
    id,
    pageId,
    parentId,
    orderKey: id,
    text,
  });

  it('indexes TODO blocks and aggregates them by page', () => {
    const home = setupPage('Home');
    const work = setupPage('Work');
    applyOps(store, [
      block('t1', home.id, 'TODO buy milk'),
      block('t2', work.id, 'TODO ship release'),
      block('t3', work.id, 'plain note'),
    ]);

    const groups = getTaskGroups(store);
    expect(groups.map((g) => g.page.title)).toEqual(['Home', 'Work']);
    expect(groups[1]?.rootIds).toEqual(['t2']);
  });

  it('includes the subtree of a task and folds nested tasks', () => {
    const home = setupPage('Home');
    applyOps(store, [
      block('outer', home.id, 'TODO plan trip'),
      block('inner', home.id, 'TODO book hotel', 'outer'),
      block('note', home.id, 'flights are cheap tuesday', 'outer'),
    ]);

    const groups = getTaskGroups(store);
    expect(groups[0]?.rootIds).toEqual(['outer']);
    expect(groups[0]?.blocks.map((b) => b.id).sort()).toEqual([
      'inner',
      'note',
      'outer',
    ]);
  });

  it('drops tasks from the open list when marked DONE and clears completedAt on reopen', () => {
    const home = setupPage('Home');
    applyOps(store, [block('t1', home.id, 'TODO x')]);
    applyOps(store, [{ type: 'update_text', id: 't1', text: 'DONE x' }]);
    expect(getTaskGroups(store)).toHaveLength(0);

    applyOps(store, [{ type: 'update_text', id: 't1', text: 'TODO x' }]);
    expect(getTaskGroups(store)[0]?.rootIds).toEqual(['t1']);
  });

  it('removes the index entry when the marker is removed or the block deleted', () => {
    const home = setupPage('Home');
    applyOps(store, [
      block('t1', home.id, 'TODO x'),
      block('t2', home.id, 'TODO y'),
    ]);
    applyOps(store, [{ type: 'update_text', id: 't1', text: 'x' }]);
    applyOps(store, [{ type: 'delete_block', id: 't2' }]);
    expect(getTaskGroups(store)).toHaveLength(0);
  });

  it('backfills via reindexTasks', () => {
    const home = setupPage('Home');
    applyOps(store, [block('t1', home.id, 'TODO x')]);
    // simulate a database whose index is missing/stale
    store.sqlite.exec('DELETE FROM tasks');
    expect(getTaskGroups(store)).toHaveLength(0);
    reindexTasks(store);
    expect(getTaskGroups(store)[0]?.rootIds).toEqual(['t1']);
  });
});
