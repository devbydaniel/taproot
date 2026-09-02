import { opsRequestSchema, type Op } from '@taproot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentGetPage } from './agent.js';
import { createApi } from './app.js';
import { createStore, type Store } from './db.js';
import { applyOps, ensurePage, reindexTasks } from './ops.js';
import {
  getJournal,
  getPagePayload,
  getTaskGroups,
  getTaskList,
  getZoomPayload,
  listPages,
  listPinFolders,
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

  it('creates pages and linked references from tags', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'work on #project and #[[Project Alpha]]',
      },
    ]);

    expect(listPages(store).map((item) => item.title)).toEqual(
      expect.arrayContaining(['project', 'Project Alpha']),
    );
    for (const title of ['project', 'Project Alpha']) {
      const target = ensurePage(store, title);
      expect(
        getPagePayload(store, target.id)?.linkedRefs[0]?.blocks.map(
          (block) => block.id,
        ),
      ).toEqual(['b1']);
    }
  });

  it('backfills tags in existing blocks when derived indexes are rebuilt', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'legacy text',
      },
    ]);
    store.sqlite
      .prepare('UPDATE blocks SET text = ? WHERE id = ?')
      .run('#legacy-tag', 'b1');

    reindexTasks(store);

    const target = ensurePage(store, 'legacy-tag');
    expect(getPagePayload(store, target.id)?.linkedRefs[0]?.rootIds).toEqual([
      'b1',
    ]);
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

  it('renames a page and all exact wikilink and tag references', () => {
    const home = setupPage('Home');
    const target = setupPage('Old');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: home.id,
        parentId: null,
        orderKey: 'a0',
        text: 'TODO [[Old]] #Old #[[Old]] [[Old News]] [[Other]]',
      },
    ]);

    applyOps(store, [
      {
        type: 'rename_page',
        id: target.id,
        oldTitle: 'Old',
        title: 'New Name',
      },
    ]);

    const payload = getPagePayload(store, target.id);
    expect(payload?.page.title).toBe('New Name');
    expect(getPagePayload(store, home.id)?.blocks[0]?.text).toBe(
      'TODO [[New Name]] #[[New Name]] #[[New Name]] [[Old News]] [[Other]]',
    );
    expect(payload?.linkedRefs[0]?.rootIds).toEqual(['b1']);
    expect(getTaskList(store).tasks[0]?.block.id).toBe('b1');
    expect(
      getPagePayload(store, ensurePage(store, 'Other').id)?.linkedRefs[0]
        ?.rootIds,
    ).toEqual(['b1']);
  });

  it('makes page renames idempotent and ignores stale or conflicting titles', () => {
    const page = setupPage('First');
    setupPage('Taken');
    const rename: Op = {
      type: 'rename_page',
      id: page.id,
      oldTitle: 'First',
      title: 'Second',
    };

    applyOps(store, [rename]);
    applyOps(store, [rename]);
    applyOps(store, [
      {
        type: 'rename_page',
        id: page.id,
        oldTitle: 'First',
        title: 'Stale',
      },
      {
        type: 'rename_page',
        id: page.id,
        oldTitle: 'Second',
        title: 'Taken',
      },
    ]);

    expect(getPagePayload(store, page.id)?.page.title).toBe('Second');
  });

  it('deletes a page and converts incoming references to plain text', () => {
    const home = setupPage('Home');
    const doomed = setupPage('Doomed');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'source',
        pageId: home.id,
        parentId: null,
        orderKey: 'a0',
        text: 'TODO [[Doomed]] #Doomed #[[Doomed]] [[Other]]',
      },
      {
        type: 'create_block',
        id: 'doomed-block',
        pageId: doomed.id,
        parentId: null,
        orderKey: 'a0',
        text: 'page content',
      },
    ]);

    applyOps(store, [{ type: 'delete_page', id: doomed.id, title: 'Doomed' }]);

    expect(getPagePayload(store, doomed.id)).toBeNull();
    expect(getPagePayload(store, home.id)?.blocks[0]?.text).toBe(
      'TODO Doomed Doomed Doomed [[Other]]',
    );
    expect(getTaskList(store).tasks[0]?.block.id).toBe('source');
    expect(
      getPagePayload(store, ensurePage(store, 'Other').id)?.linkedRefs[0]
        ?.rootIds,
    ).toEqual(['source']);
    expect(listPages(store).map((page) => page.title)).not.toContain('Doomed');
  });

  it('ignores a page deletion carrying a stale title', () => {
    const page = setupPage('Current');
    applyOps(store, [{ type: 'delete_page', id: page.id, title: 'Previous' }]);
    expect(getPagePayload(store, page.id)?.page.title).toBe('Current');
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

  it('includes each root ancestor chain in linked refs, outermost first', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'top',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'top level',
      },
      {
        type: 'create_block',
        id: 'mid',
        pageId: page.id,
        parentId: 'top',
        orderKey: 'a0',
        text: 'middle',
      },
      {
        type: 'create_block',
        id: 'nested-ref',
        pageId: page.id,
        parentId: 'mid',
        orderKey: 'a0',
        text: 'mentions [[Target]]',
      },
      {
        type: 'create_block',
        id: 'top-ref',
        pageId: page.id,
        parentId: null,
        orderKey: 'a1',
        text: 'also [[Target]]',
      },
    ]);

    const target = ensurePage(store, 'Target');
    const refGroup = getPagePayload(store, target.id)?.linkedRefs[0];
    expect(refGroup?.rootIds).toEqual(['nested-ref', 'top-ref']);
    expect(refGroup?.ancestors['nested-ref']?.map((b) => b.id)).toEqual([
      'top',
      'mid',
    ]);
    expect(refGroup?.ancestors['top-ref']).toEqual([]);
  });

  it('orders linked ref groups with newer daily notes first', () => {
    const older = setupPage('2026-01-05');
    const newer = setupPage('2026-07-04');
    const named = setupPage('Projects');
    const block = (id: string, pageId: string) =>
      ({
        type: 'create_block',
        id,
        pageId,
        parentId: null,
        orderKey: 'a0',
        text: 'see [[Target]]',
      }) as const;
    applyOps(store, [
      block('b1', older.id),
      block('b2', newer.id),
      block('b3', named.id),
    ]);

    const target = ensurePage(store, 'Target');
    const groups = getPagePayload(store, target.id)?.linkedRefs;
    expect(groups?.map((g) => g.page.title)).toEqual([
      '2026-07-04',
      '2026-01-05',
      'Projects',
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

  it('drops a text update for a block that no longer exists', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'here',
      },
      { type: 'delete_block', id: 'b1' },
    ]);

    // a stale op replayed from an offline queue: the block is gone, so its
    // derived refs/tasks rows must not be written (they would FK-fail and
    // reject the whole batch)
    expect(() => {
      applyOps(store, [
        { type: 'update_text', id: 'b1', text: 'TODO ping [[X]]' },
      ]);
    }).not.toThrow();

    const x = ensurePage(store, 'X');
    expect(getPagePayload(store, x.id)?.linkedRefs).toHaveLength(0);
    expect(getTaskList(store).tasks).toHaveLength(0);
    expect(getPagePayload(store, page.id)?.blocks).toHaveLength(0);
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

  it('preserves completedAt of DONE tasks across reindexTasks', () => {
    const home = setupPage('Home');
    applyOps(store, [block('t1', home.id, 'TODO x')]);
    applyOps(store, [{ type: 'update_text', id: 't1', text: 'DONE x' }]);
    store.sqlite
      .prepare('UPDATE tasks SET completed_at = ? WHERE block_id = ?')
      .run(123, 't1');

    reindexTasks(store);

    const row = store.sqlite
      .prepare(
        'SELECT completed_at AS completedAt FROM tasks WHERE block_id = ?',
      )
      .get('t1') as { completedAt: number };
    expect(row.completedAt).toBe(123);
  });

  it('drops index entries whose block no longer parses as a task', () => {
    const home = setupPage('Home');
    applyOps(store, [
      block('t1', home.id, 'TODO x'),
      block('t2', home.id, 'TODOx not a task'),
    ]);
    // simulate a stale index: t1's marker was removed behind the index's
    // back, t2 was wrongly indexed
    store.sqlite
      .prepare("UPDATE blocks SET text = 'plain' WHERE id = ?")
      .run('t1');
    store.sqlite
      .prepare("INSERT INTO tasks (block_id, state) VALUES ('t2', 'TODO')")
      .run();

    reindexTasks(store);
    expect(getTaskGroups(store)).toHaveLength(0);
  });
});

describe('getTaskList', () => {
  const block = (id: string, pageId: string, text: string): Op => ({
    type: 'create_block',
    id,
    pageId,
    parentId: null,
    orderKey: id,
    text,
  });

  const itemById = (id: string) =>
    getTaskList(store).tasks.find((item) => item.block.id === id);

  it('returns a bare task as undated with no page link', () => {
    const home = setupPage('Home');
    applyOps(store, [block('t1', home.id, 'TODO buy milk')]);

    const item = itemById('t1');
    expect(item?.dueDate).toBeNull();
    expect(item?.hasPageLink).toBe(false);
    expect(item?.page.title).toBe('Home');
  });

  it('treats a daily link as a date, not a page link', () => {
    // the daily link auto-creates a page via ensurePage, but must still
    // count as a date only
    const home = setupPage('Home');
    applyOps(store, [block('t1', home.id, 'TODO ship [[2026-07-10]]')]);

    const item = itemById('t1');
    expect(item?.dueDate).toBe('2026-07-10');
    expect(item?.hasPageLink).toBe(false);
  });

  it('flags non-daily links, alone or alongside a date', () => {
    const home = setupPage('Home');
    applyOps(store, [
      block('t1', home.id, 'TODO fix [[Project]]'),
      block('t2', home.id, 'TODO ship [[Project]] [[2026-08-01]]'),
    ]);

    expect(itemById('t1')).toMatchObject({ dueDate: null, hasPageLink: true });
    expect(itemById('t2')).toMatchObject({
      dueDate: '2026-08-01',
      hasPageLink: true,
    });
  });

  it('derives the date from block text, not the page the task lives on', () => {
    const day = setupPage('2026-07-10');
    applyOps(store, [block('t1', day.id, 'TODO call dentist')]);

    const item = itemById('t1');
    expect(item?.dueDate).toBeNull();
    expect(item?.page.title).toBe('2026-07-10');
  });

  it('lists nested open tasks as flat items, includes their subtrees, and tracks text updates', () => {
    const home = setupPage('Home');
    applyOps(store, [
      { ...block('outer', home.id, 'TODO plan trip') },
      {
        type: 'create_block',
        id: 'inner',
        pageId: home.id,
        parentId: 'outer',
        orderKey: 'a0',
        text: 'TODO book hotel',
      },
      {
        type: 'create_block',
        id: 'note',
        pageId: home.id,
        parentId: 'outer',
        orderKey: 'a1',
        text: 'compare refundable rates',
      },
    ]);
    const initial = getTaskList(store);
    expect(initial.tasks.map((i) => i.block.id).sort()).toEqual([
      'inner',
      'outer',
    ]);
    expect(initial.blocks?.map((item) => item.id).sort()).toEqual([
      'inner',
      'note',
      'outer',
    ]);

    applyOps(store, [
      { type: 'update_text', id: 'inner', text: 'DONE book hotel' },
      { type: 'update_text', id: 'outer', text: 'plan trip' },
    ]);
    expect(getTaskList(store)).toMatchObject({ tasks: [], blocks: [] });
  });
});

describe('getJournal', () => {
  it('returns only daily pages, newest first, with their blocks', () => {
    setupPage('Welcome');
    setupPage('2026 goals'); // starts with digits but not date-shaped
    setupPage('2026-02-30'); // date-shaped but not a real date
    const day1 = setupPage('2026-07-01');
    setupPage('2026-07-03');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: day1.id,
        parentId: null,
        orderKey: 'a0',
        text: 'wrote this on the first',
      },
    ]);

    const journal = getJournal(store);
    expect(journal.days.map((d) => d.page.title)).toEqual([
      '2026-07-03',
      '2026-07-01',
    ]);
    expect(journal.days[1]?.blocks.map((b) => b.id)).toEqual(['b1']);
    expect(journal.hasMore).toBe(false);
  });

  it('paginates with a title cursor and reports hasMore', () => {
    setupPage('2026-07-01');
    setupPage('2026-07-02');
    setupPage('2026-07-03');

    const first = getJournal(store, { limit: 2 });
    expect(first.days.map((d) => d.page.title)).toEqual([
      '2026-07-03',
      '2026-07-02',
    ]);
    expect(first.hasMore).toBe(true);

    const rest = getJournal(store, { before: '2026-07-02', limit: 2 });
    expect(rest.days.map((d) => d.page.title)).toEqual(['2026-07-01']);
    expect(rest.hasMore).toBe(false);
  });

  it('clamps out-of-range limits', () => {
    setupPage('2026-07-01');
    setupPage('2026-07-02');
    expect(getJournal(store, { limit: 0 }).days).toHaveLength(1);
    expect(getJournal(store, { limit: Number.NaN }).days).toHaveLength(2);
  });

  it('attaches linked references to each day', () => {
    const home = setupPage('Home');
    setupPage('2026-07-01');
    setupPage('2026-07-02');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: home.id,
        parentId: null,
        orderKey: 'a0',
        text: 'ship it on [[2026-07-01]]',
      },
      {
        type: 'create_block',
        id: 'b2',
        pageId: home.id,
        parentId: null,
        orderKey: 'a1',
        text: 'review on [[2026-07-02]]',
      },
    ]);

    const journal = getJournal(store);
    const byTitle = new Map(journal.days.map((d) => [d.page.title, d]));
    expect(
      byTitle.get('2026-07-01')?.linkedRefs[0]?.blocks.map((b) => b.id),
    ).toEqual(['b1']);
    expect(byTitle.get('2026-07-01')?.linkedRefs[0]?.page.title).toBe('Home');
    expect(
      byTitle.get('2026-07-02')?.linkedRefs[0]?.blocks.map((b) => b.id),
    ).toEqual(['b2']);
  });
});

describe('collapse state', () => {
  function setupTree() {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'parent',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'parent',
      },
      {
        type: 'create_block',
        id: 'child',
        pageId: page.id,
        parentId: 'parent',
        orderKey: 'a0',
        text: 'child',
      },
    ]);
    return page;
  }

  it('new blocks default to expanded', () => {
    const page = setupTree();
    const payload = getPagePayload(store, page.id);
    expect(payload?.blocks.every((b) => !b.collapsed)).toBe(true);
  });

  it('set_collapsed round-trips through getPagePayload', () => {
    const page = setupTree();
    applyOps(store, [{ type: 'set_collapsed', id: 'parent', collapsed: true }]);
    let parent = getPagePayload(store, page.id)?.blocks.find(
      (b) => b.id === 'parent',
    );
    expect(parent?.collapsed).toBe(true);

    applyOps(store, [
      { type: 'set_collapsed', id: 'parent', collapsed: false },
    ]);
    parent = getPagePayload(store, page.id)?.blocks.find(
      (b) => b.id === 'parent',
    );
    expect(parent?.collapsed).toBe(false);
  });

  it('is a silent no-op for unknown block ids', () => {
    const page = setupTree();
    applyOps(store, [{ type: 'set_collapsed', id: 'nope', collapsed: true }]);
    expect(getPagePayload(store, page.id)?.blocks).toHaveLength(2);
  });

  it('survives move_block', () => {
    const page = setupTree();
    applyOps(store, [
      {
        type: 'create_block',
        id: 'other',
        pageId: page.id,
        parentId: null,
        orderKey: 'a1',
        text: 'other',
      },
      { type: 'set_collapsed', id: 'parent', collapsed: true },
      { type: 'move_block', id: 'parent', parentId: 'other', orderKey: 'a0' },
    ]);
    const parent = getPagePayload(store, page.id)?.blocks.find(
      (b) => b.id === 'parent',
    );
    expect(parent?.parentId).toBe('other');
    expect(parent?.collapsed).toBe(true);
  });

  it('is carried by getZoomPayload', () => {
    setupTree();
    applyOps(store, [{ type: 'set_collapsed', id: 'child', collapsed: true }]);
    const zoom = getZoomPayload(store, 'parent');
    expect(zoom?.blocks.find((b) => b.id === 'child')?.collapsed).toBe(true);
  });

  it('does not disturb the task index or linked refs', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 't1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'TODO ship [[Topic]]',
      },
    ]);
    applyOps(store, [{ type: 'set_collapsed', id: 't1', collapsed: true }]);

    const groups = getTaskGroups(store);
    expect(groups.flatMap((g) => g.blocks.map((b) => b.id))).toContain('t1');
    const topic = ensurePage(store, 'Topic');
    expect(getPagePayload(store, topic.id)?.linkedRefs).toHaveLength(1);
  });
});

describe('page pinning', () => {
  it('pins a page via set_page_pinned', () => {
    const page = setupPage('Projects');
    applyOps(store, [{ type: 'set_page_pinned', id: page.id, orderKey: 'a0' }]);

    const row = listPages(store).find((p) => p.id === page.id);
    expect(row?.pinnedOrderKey).toBe('a0');
  });

  it('unpins with a null orderKey', () => {
    const page = setupPage('Projects');
    applyOps(store, [{ type: 'set_page_pinned', id: page.id, orderKey: 'a0' }]);
    applyOps(store, [{ type: 'set_page_pinned', id: page.id, orderKey: null }]);

    const row = listPages(store).find((p) => p.id === page.id);
    expect(row?.pinnedOrderKey).toBeNull();
  });

  it('reorders by re-pinning with a new orderKey', () => {
    const page = setupPage('Projects');
    applyOps(store, [{ type: 'set_page_pinned', id: page.id, orderKey: 'a1' }]);
    applyOps(store, [{ type: 'set_page_pinned', id: page.id, orderKey: 'a0' }]);

    const row = listPages(store).find((p) => p.id === page.id);
    expect(row?.pinnedOrderKey).toBe('a0');
  });

  it('is a silent no-op for unknown page ids', () => {
    const page = setupPage('Projects');
    applyOps(store, [{ type: 'set_page_pinned', id: 'nope', orderKey: 'a0' }]);

    const row = listPages(store).find((p) => p.id === page.id);
    expect(row?.pinnedOrderKey).toBeNull();
  });

  it('new pages default to unpinned', () => {
    setupPage('Fresh');
    const row = listPages(store).find((p) => p.title === 'Fresh');
    expect(row?.pinnedOrderKey).toBeNull();
  });
});

describe('pin folders', () => {
  const pageRow = (id: string) => listPages(store).find((p) => p.id === id);

  function setupFolder(id = 'f1', name = 'Work', orderKey = 'a0') {
    applyOps(store, [{ type: 'create_pin_folder', id, name, orderKey }]);
    return id;
  }

  it('creates a folder, expanded by default', () => {
    setupFolder();
    const folders = listPinFolders(store);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({
      id: 'f1',
      name: 'Work',
      orderKey: 'a0',
      collapsed: false,
    });
    expect(folders[0]?.createdAt).toBeGreaterThan(0);
  });

  it('lists folders by order key', () => {
    setupFolder('f2', 'Second', 'a1');
    setupFolder('f1', 'First', 'a0');
    expect(listPinFolders(store).map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('creating the same folder twice is idempotent (offline replay)', () => {
    setupFolder();
    applyOps(store, [
      { type: 'create_pin_folder', id: 'f1', name: 'Other', orderKey: 'a5' },
    ]);
    expect(listPinFolders(store)).toHaveLength(1);
    expect(listPinFolders(store)[0]?.name).toBe('Work');
  });

  it('renames, moves and collapses a folder', () => {
    setupFolder();
    applyOps(store, [
      { type: 'rename_pin_folder', id: 'f1', name: 'Renamed' },
      { type: 'move_pin_folder', id: 'f1', orderKey: 'a9' },
      { type: 'set_pin_folder_collapsed', id: 'f1', collapsed: true },
    ]);
    expect(listPinFolders(store)[0]).toMatchObject({
      name: 'Renamed',
      orderKey: 'a9',
      collapsed: true,
    });
  });

  it('puts a page in a folder and takes it back out', () => {
    const folder = setupFolder();
    const page = setupPage('Roadmap');
    applyOps(store, [
      {
        type: 'set_page_pinned',
        id: page.id,
        orderKey: 'a0',
        folderId: folder,
      },
    ]);
    expect(pageRow(page.id)).toMatchObject({
      pinnedOrderKey: 'a0',
      pinnedFolderId: 'f1',
    });

    applyOps(store, [
      { type: 'set_page_pinned', id: page.id, orderKey: 'a1', folderId: null },
    ]);
    expect(pageRow(page.id)).toMatchObject({
      pinnedOrderKey: 'a1',
      pinnedFolderId: null,
    });
  });

  it('unpinning clears the folder too', () => {
    const folder = setupFolder();
    const page = setupPage('Roadmap');
    applyOps(store, [
      {
        type: 'set_page_pinned',
        id: page.id,
        orderKey: 'a0',
        folderId: folder,
      },
      // an unpin op carries no folder; the page must not keep a stale one
      { type: 'set_page_pinned', id: page.id, orderKey: null },
    ]);
    expect(pageRow(page.id)).toMatchObject({
      pinnedOrderKey: null,
      pinnedFolderId: null,
    });
  });

  it('accepts set_page_pinned without folderId (ops queued before folders)', () => {
    const page = setupPage('Roadmap');
    const parsed = opsRequestSchema.safeParse({
      clientId: 'c1',
      ops: [{ type: 'set_page_pinned', id: page.id, orderKey: 'a0' }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    applyOps(store, parsed.data.ops);
    expect(pageRow(page.id)).toMatchObject({
      pinnedOrderKey: 'a0',
      pinnedFolderId: null,
    });
  });

  it('deleting a folder unpins the pages inside it', () => {
    const folder = setupFolder();
    const inside = setupPage('Roadmap');
    const outside = setupPage('Inbox');
    applyOps(store, [
      {
        type: 'set_page_pinned',
        id: inside.id,
        orderKey: 'a0',
        folderId: folder,
      },
      { type: 'set_page_pinned', id: outside.id, orderKey: 'a1' },
      { type: 'delete_pin_folder', id: folder },
    ]);

    expect(listPinFolders(store)).toEqual([]);
    expect(pageRow(inside.id)).toMatchObject({
      pinnedOrderKey: null,
      pinnedFolderId: null,
    });
    // the page itself survives, and pins outside the folder are untouched
    expect(pageRow(inside.id)?.title).toBe('Roadmap');
    expect(pageRow(outside.id)?.pinnedOrderKey).toBe('a1');
  });

  it('is a silent no-op for unknown folder ids', () => {
    setupFolder();
    applyOps(store, [
      { type: 'rename_pin_folder', id: 'nope', name: 'Ghost' },
      { type: 'move_pin_folder', id: 'nope', orderKey: 'a9' },
      { type: 'set_pin_folder_collapsed', id: 'nope', collapsed: true },
      { type: 'delete_pin_folder', id: 'nope' },
    ]);
    expect(listPinFolders(store)[0]).toMatchObject({
      name: 'Work',
      orderKey: 'a0',
      collapsed: false,
    });
  });
});

describe('drawing blocks', () => {
  function setupDrawing(text = '/draw') {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'd1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text,
      },
    ]);
    // conversion as the client dispatches it: clear text, then switch kind
    applyOps(store, [
      { type: 'update_text', id: 'd1', text: '' },
      { type: 'set_kind', id: 'd1', kind: 'drawing' },
    ]);
    return page;
  }

  it('new blocks default to kind text with no data', () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'b1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'plain',
      },
    ]);
    const block = getPagePayload(store, page.id)?.blocks[0];
    expect(block?.kind).toBe('text');
    expect(block?.data).toBeNull();
  });

  it('converts a block via update_text + set_kind', () => {
    const page = setupDrawing();
    const block = getPagePayload(store, page.id)?.blocks[0];
    expect(block?.kind).toBe('drawing');
    expect(block?.text).toBe('');
  });

  it('stores data verbatim without touching refs or tasks', () => {
    const page = setupDrawing();
    const data = '{"elements":[{"text":"see [[Ghost]] TODO x"}]}';
    applyOps(store, [{ type: 'update_data', id: 'd1', data }]);

    const block = getPagePayload(store, page.id)?.blocks[0];
    expect(block?.data).toBe(data);
    // scene JSON is opaque: no page auto-created, no task indexed
    expect(listPages(store).map((p) => p.title)).not.toContain('Ghost');
    expect(getTaskGroups(store)).toHaveLength(0);
  });

  it('keeps drawing data out of reindexTasks', () => {
    setupDrawing();
    applyOps(store, [
      { type: 'update_data', id: 'd1', data: 'TODO looks like a task' },
    ]);
    reindexTasks(store);
    expect(getTaskGroups(store)).toHaveLength(0);
  });

  it('cascades delete_block through a drawing with children', () => {
    const page = setupDrawing();
    applyOps(store, [
      {
        type: 'create_block',
        id: 'child',
        pageId: page.id,
        parentId: 'd1',
        orderKey: 'a0',
        text: 'note under drawing',
      },
    ]);
    applyOps(store, [{ type: 'delete_block', id: 'd1' }]);
    expect(getPagePayload(store, page.id)?.blocks).toHaveLength(0);
  });

  it('carries kind and data through zoom payloads', () => {
    setupDrawing();
    applyOps(store, [
      { type: 'update_data', id: 'd1', data: '{"elements":[]}' },
    ]);
    const zoom = getZoomPayload(store, 'd1');
    expect(zoom?.block.kind).toBe('drawing');
    expect(zoom?.block.data).toBe('{"elements":[]}');
  });

  it('update_data is a silent no-op for unknown block ids', () => {
    const page = setupDrawing();
    applyOps(store, [{ type: 'update_data', id: 'nope', data: 'x' }]);
    expect(getPagePayload(store, page.id)?.blocks).toHaveLength(1);
  });
});

describe('doc blocks', () => {
  function setupDoc() {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 'doc1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: '/write',
      },
    ]);
    // conversion as the client dispatches it: clear text, then switch kind
    applyOps(store, [
      { type: 'update_text', id: 'doc1', text: '' },
      { type: 'set_kind', id: 'doc1', kind: 'doc' },
    ]);
    return page;
  }

  it('converts a block via update_text + set_kind', () => {
    const page = setupDoc();
    const block = getPagePayload(store, page.id)?.blocks[0];
    expect(block?.kind).toBe('doc');
    expect(block?.text).toBe('');
  });

  it('stores markdown verbatim without touching refs or tasks', () => {
    const page = setupDoc();
    const markdown = '# Notes\n\nsee [[Ghost]]\n\nTODO buy milk';
    applyOps(store, [{ type: 'update_data', id: 'doc1', data: markdown }]);

    const block = getPagePayload(store, page.id)?.blocks[0];
    expect(block?.data).toBe(markdown);
    // markdown is opaque: no page auto-created, no task indexed
    expect(listPages(store).map((p) => p.title)).not.toContain('Ghost');
    expect(getTaskGroups(store)).toHaveLength(0);
    reindexTasks(store);
    expect(getTaskGroups(store)).toHaveLength(0);
  });

  it('marks doc blocks opaque in agent payloads', () => {
    const page = setupDoc();
    applyOps(store, [{ type: 'update_data', id: 'doc1', data: '# secret' }]);
    const result = agentGetPage(store, { title: page.title });
    expect(result).toMatchObject({
      result: { blocks: [{ id: 'doc1', kind: 'doc', text: '' }] },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('GET /docs/:blockId returns raw markdown as text/markdown', async () => {
    setupDoc();
    const markdown = '# Title\n\nbody with **bold**';
    applyOps(store, [{ type: 'update_data', id: 'doc1', data: markdown }]);

    const api = createApi(store, vi.fn());
    const res = await api.request('/docs/doc1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toBe(markdown);
  });

  it('GET /docs/:blockId returns empty body for a never-saved doc', async () => {
    setupDoc();
    const api = createApi(store, vi.fn());
    const res = await api.request('/docs/doc1');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('GET /docs/:blockId 404s for unknown ids and non-doc blocks', async () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 't1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'plain text block',
      },
    ]);
    const api = createApi(store, vi.fn());
    expect((await api.request('/docs/nope')).status).toBe(404);
    expect((await api.request('/docs/t1')).status).toBe(404);
  });

  it('PUT /docs/:blockId saves markdown and broadcasts as clientId "api"', async () => {
    const page = setupDoc();
    const broadcast = vi.fn();
    const api = createApi(store, broadcast);
    const markdown = '# Updated\n\nvia HTTP';

    const res = await api.request('/docs/doc1', {
      method: 'PUT',
      body: markdown,
    });
    expect(res.status).toBe(200);
    expect(broadcast).toHaveBeenCalledOnce();
    expect(broadcast.mock.calls[0]![0]).toMatchObject({
      type: 'ops',
      clientId: 'api',
      ops: [{ type: 'update_data', id: 'doc1', data: markdown }],
    });
    expect(await (await api.request('/docs/doc1')).text()).toBe(markdown);
    expect(getPagePayload(store, page.id)?.blocks[0]?.data).toBe(markdown);
  });

  it('PUT /docs/:blockId 404s for non-doc blocks without writing', async () => {
    const page = setupPage('Home');
    applyOps(store, [
      {
        type: 'create_block',
        id: 't1',
        pageId: page.id,
        parentId: null,
        orderKey: 'a0',
        text: 'keep me',
      },
    ]);
    const broadcast = vi.fn();
    const api = createApi(store, broadcast);
    const res = await api.request('/docs/t1', { method: 'PUT', body: '# no' });
    expect(res.status).toBe(404);
    expect(broadcast).not.toHaveBeenCalled();
    expect(getPagePayload(store, page.id)?.blocks[0]?.data).toBeNull();
  });

  it('PUT /docs/:blockId rejects oversized bodies with 413', async () => {
    setupDoc();
    const broadcast = vi.fn();
    const api = createApi(store, broadcast);
    const res = await api.request('/docs/doc1', {
      method: 'PUT',
      body: 'x'.repeat(2_000_001),
    });
    expect(res.status).toBe(413);
    expect(broadcast).not.toHaveBeenCalled();
    expect(await (await api.request('/docs/doc1')).text()).toBe('');
  });
});
