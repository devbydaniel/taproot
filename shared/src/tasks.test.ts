import { describe, expect, it } from 'vitest';
import {
  assignTaskPage,
  bucketAgenda,
  bucketTasks,
  cycleTaskState,
  parseTask,
  rescheduleTask,
  taskDueDate,
  taskHasPageLink,
  withTaskState,
} from './tasks.js';
import type { Block, TaskListItem } from './types.js';

describe('parseTask', () => {
  it('parses TODO and DONE markers', () => {
    expect(parseTask('TODO buy milk')).toEqual({
      state: 'TODO',
      rest: 'buy milk',
    });
    expect(parseTask('DONE buy milk')).toEqual({
      state: 'DONE',
      rest: 'buy milk',
    });
  });

  it('parses a bare marker with no text', () => {
    expect(parseTask('TODO')).toEqual({ state: 'TODO', rest: '' });
  });

  it('rejects non-prefix and lowercase markers', () => {
    expect(parseTask('do TODO later')).toBeNull();
    expect(parseTask('todo x')).toBeNull();
    expect(parseTask('TODOx')).toBeNull();
  });
});

describe('withTaskState / cycleTaskState', () => {
  it('adds, swaps, and removes markers', () => {
    expect(withTaskState('buy milk', 'TODO')).toBe('TODO buy milk');
    expect(withTaskState('TODO buy milk', 'DONE')).toBe('DONE buy milk');
    expect(withTaskState('DONE buy milk', null)).toBe('buy milk');
  });

  it('cycles plain → TODO → DONE → plain', () => {
    expect(cycleTaskState('x')).toBe('TODO x');
    expect(cycleTaskState('TODO x')).toBe('DONE x');
    expect(cycleTaskState('DONE x')).toBe('x');
  });
});

describe('taskDueDate', () => {
  it('returns null when there is no daily link', () => {
    expect(taskDueDate('TODO buy milk')).toBeNull();
    expect(taskDueDate('TODO fix [[Project]]')).toBeNull();
  });

  it('returns the first daily page reference in text order', () => {
    expect(taskDueDate('TODO x #2026-08-02 [[2026-08-01]]')).toBe('2026-08-02');
  });

  it('skips page links before the daily link', () => {
    expect(taskDueDate('TODO x [[Project]] [[2026-07-15]]')).toBe('2026-07-15');
  });

  it('rejects impossible calendar dates', () => {
    expect(taskDueDate('TODO x [[2026-02-30]]')).toBeNull();
  });
});

describe('taskHasPageLink', () => {
  it('is false for no links or daily-only links', () => {
    expect(taskHasPageLink('TODO buy milk')).toBe(false);
    expect(taskHasPageLink('TODO x [[2026-07-15]]')).toBe(false);
  });

  it('is true for non-daily links and tags, including impossible dates', () => {
    expect(taskHasPageLink('TODO x [[Project]]')).toBe(true);
    expect(taskHasPageLink('TODO x #project')).toBe(true);
    expect(taskHasPageLink('TODO x #[[Big Project]] [[2026-07-15]]')).toBe(
      true,
    );
    expect(taskHasPageLink('TODO x [[2026-02-30]]')).toBe(true);
  });
});

describe('rescheduleTask', () => {
  it('rewrites the first daily link in place', () => {
    expect(rescheduleTask('TODO x [[2026-08-01]] end', '2026-08-05')).toBe(
      'TODO x [[2026-08-05]] end',
    );
  });

  it('skips page links and only touches the daily link', () => {
    expect(
      rescheduleTask('TODO [[Project]] [[2026-08-01]]', '2026-08-02'),
    ).toBe('TODO [[Project]] [[2026-08-02]]');
  });

  it('rewrites dates represented as tags without changing their markup', () => {
    expect(rescheduleTask('TODO x #2026-08-01', '2026-08-05')).toBe(
      'TODO x #2026-08-05',
    );
    expect(rescheduleTask('TODO x #[[2026-08-01]]', '2026-08-05')).toBe(
      'TODO x #[[2026-08-05]]',
    );
  });

  it('appends a link when the task is undated', () => {
    expect(rescheduleTask('TODO buy milk', '2026-08-05')).toBe(
      'TODO buy milk [[2026-08-05]]',
    );
  });

  it('removes the link and collapses whitespace on unschedule', () => {
    expect(rescheduleTask('TODO x [[2026-08-01]] end', null)).toBe(
      'TODO x end',
    );
    expect(rescheduleTask('TODO x [[2026-08-01]]', null)).toBe('TODO x');
    expect(rescheduleTask('TODO plain', null)).toBe('TODO plain');
  });
});

describe('assignTaskPage', () => {
  it('appends a page link', () => {
    expect(assignTaskPage('TODO buy milk', 'Groceries')).toBe(
      'TODO buy milk [[Groceries]]',
    );
  });

  it('appends to a bare marker without double spaces', () => {
    expect(assignTaskPage('TODO ', 'Groceries')).toBe('TODO [[Groceries]]');
  });

  it('is a no-op when the page is already referenced, case-insensitively', () => {
    expect(assignTaskPage('TODO x [[Groceries]]', 'groceries')).toBe(
      'TODO x [[Groceries]]',
    );
    expect(assignTaskPage('TODO x #groceries', 'Groceries')).toBe(
      'TODO x #groceries',
    );
  });

  it('leaves daily links and recurrence tokens untouched', () => {
    expect(
      assignTaskPage('TODO x <every week> [[2026-08-01]]', 'Project'),
    ).toBe('TODO x <every week> [[2026-08-01]] [[Project]]');
  });
});

describe('bucketTasks', () => {
  const TODAY = '2026-07-12';
  let nextId = 0;

  function item(text: string, createdAt = 0): TaskListItem {
    const id = `b${nextId++}`;
    return {
      block: {
        id,
        pageId: 'p1',
        parentId: null,
        orderKey: 'a0',
        text,
        kind: 'text',
        data: null,
        collapsed: false,
        createdAt,
        updatedAt: createdAt,
      },
      page: {
        id: 'p1',
        title: 'Page',
        createdAt: 0,
        pinnedOrderKey: null,
        pinnedFolderId: null,
      },
      dueDate: taskDueDate(text),
      hasPageLink: taskHasPageLink(text),
    };
  }

  const texts = (list: TaskListItem[]) => list.map((i) => i.block.text);

  it('splits overdue, today, and upcoming; inbox for bare tasks', () => {
    const buckets = bucketTasks(
      [
        item('TODO overdue [[2026-07-10]]'),
        item('TODO today [[2026-07-12]]'),
        item('TODO later [[2026-07-20]]'),
        item('TODO bare'),
      ],
      TODAY,
    );
    expect(texts(buckets.overdue)).toEqual(['TODO overdue [[2026-07-10]]']);
    expect(texts(buckets.today)).toEqual(['TODO today [[2026-07-12]]']);
    expect(texts(buckets.upcoming)).toEqual(['TODO later [[2026-07-20]]']);
    expect(texts(buckets.inbox)).toEqual(['TODO bare']);
  });

  it('a date wins over a page link — dated tasks never land in the inbox', () => {
    const buckets = bucketTasks(
      [item('TODO x [[Project]] [[2026-07-01]]')],
      TODAY,
    );
    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.inbox).toHaveLength(0);
  });

  it('drops undated tasks that link to a page', () => {
    const buckets = bucketTasks([item('TODO x [[Project]]')], TODAY);
    expect(buckets.inbox).toHaveLength(0);
    expect(buckets.overdue).toHaveLength(0);
    expect(buckets.today).toHaveLength(0);
    expect(buckets.upcoming).toHaveLength(0);
  });

  it('sorts overdue/upcoming by date then createdAt, inbox/today by createdAt', () => {
    const buckets = bucketTasks(
      [
        item('TODO b [[2026-07-10]]', 2),
        item('TODO a [[2026-07-10]]', 1),
        item('TODO c [[2026-07-01]]', 3),
        item('TODO t2 [[2026-07-12]]', 7),
        item('TODO t1 [[2026-07-12]]', 6),
        item('TODO new', 5),
        item('TODO old', 4),
      ],
      TODAY,
    );
    expect(texts(buckets.overdue)).toEqual([
      'TODO c [[2026-07-01]]',
      'TODO a [[2026-07-10]]',
      'TODO b [[2026-07-10]]',
    ]);
    expect(texts(buckets.today)).toEqual([
      'TODO t1 [[2026-07-12]]',
      'TODO t2 [[2026-07-12]]',
    ]);
    expect(texts(buckets.inbox)).toEqual(['TODO old', 'TODO new']);
  });
});

describe('bucketAgenda', () => {
  const TODAY = '2026-07-12';
  let nextId = 0;

  function blk(
    text: string,
    opts: { id?: string; parentId?: string | null; orderKey?: string } = {},
  ): Block {
    return {
      id: opts.id ?? `b${nextId++}`,
      pageId: 'daily',
      parentId: opts.parentId ?? null,
      orderKey: opts.orderKey ?? 'a0',
      text,
      kind: 'text',
      data: null,
      collapsed: false,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  function item(text: string, createdAt = 0, block?: Block): TaskListItem {
    return {
      block: block ?? { ...blk(text), pageId: 'other', createdAt },
      page: {
        id: 'other',
        title: 'Page',
        createdAt: 0,
        pinnedOrderKey: null,
        pinnedFolderId: null,
      },
      dueDate: taskDueDate(text),
      hasPageLink: taskHasPageLink(text),
    };
  }

  const itemTexts = (list: TaskListItem[]) => list.map((i) => i.block.text);
  const blockTexts = (list: Block[]) => list.map((b) => b.text);

  it('splits overdue, due-this-day, and on-page tasks on today’s page', () => {
    const buckets = bucketAgenda(
      [
        item('TODO overdue [[2026-07-10]]'),
        item('TODO today [[2026-07-12]]'),
        item('TODO later [[2026-07-20]]'),
        item('TODO bare'),
      ],
      [blk('TODO on page'), blk('TODO planned here [[2026-07-20]]')],
      TODAY,
      TODAY,
    );
    expect(itemTexts(buckets.overdue)).toEqual(['TODO overdue [[2026-07-10]]']);
    expect(itemTexts(buckets.dueThisDay)).toEqual([
      'TODO today [[2026-07-12]]',
    ]);
    expect(blockTexts(buckets.onPage)).toEqual([
      'TODO on page',
      'TODO planned here [[2026-07-20]]',
    ]);
  });

  it('suppresses overdue on other days but keeps that day’s tasks', () => {
    const buckets = bucketAgenda(
      [item('TODO old [[2026-07-01]]'), item('TODO that day [[2026-07-11]]')],
      [],
      '2026-07-11',
      TODAY,
    );
    expect(buckets.overdue).toHaveLength(0);
    expect(itemTexts(buckets.dueThisDay)).toEqual([
      'TODO that day [[2026-07-11]]',
    ]);
  });

  it('never counts undated tasks as overdue', () => {
    const buckets = bucketAgenda(
      [item('TODO bare'), item('TODO linked [[Project]]')],
      [],
      TODAY,
      TODAY,
    );
    expect(buckets.overdue).toHaveLength(0);
    expect(buckets.dueThisDay).toHaveLength(0);
  });

  it('claims dated on-page blocks for the dated sections', () => {
    const dueHere = blk('TODO here [[2026-07-12]]');
    const overdueHere = blk('TODO stale here [[2026-07-01]]');
    const buckets = bucketAgenda(
      [item(dueHere.text, 0, dueHere), item(overdueHere.text, 0, overdueHere)],
      [dueHere, overdueHere, blk('TODO plain')],
      TODAY,
      TODAY,
    );
    expect(itemTexts(buckets.overdue)).toEqual([overdueHere.text]);
    expect(itemTexts(buckets.dueThisDay)).toEqual([dueHere.text]);
    expect(blockTexts(buckets.onPage)).toEqual(['TODO plain']);
  });

  it('excludes DONE and plain blocks from on-page tasks', () => {
    const buckets = bucketAgenda(
      [],
      [blk('DONE finished'), blk('just a note'), blk('TODO open')],
      TODAY,
      TODAY,
    );
    expect(blockTexts(buckets.onPage)).toEqual(['TODO open']);
  });

  it('walks the page outline depth-first regardless of input order', () => {
    const root2 = blk('TODO second root', { id: 'r2', orderKey: 'a2' });
    const root1 = blk('TODO first root', { id: 'r1', orderKey: 'a1' });
    const child = blk('TODO child', { parentId: 'r1', orderKey: 'a0' });
    const grandchild = blk('TODO grandchild', {
      parentId: child.id,
      orderKey: 'a0',
    });
    const buckets = bucketAgenda(
      [],
      [root2, grandchild, root1, child],
      TODAY,
      TODAY,
    );
    expect(blockTexts(buckets.onPage)).toEqual([
      'TODO first root',
      'TODO child',
      'TODO grandchild',
      'TODO second root',
    ]);
  });

  it('sorts overdue by date then createdAt, due-this-day by createdAt', () => {
    const buckets = bucketAgenda(
      [
        item('TODO b [[2026-07-10]]', 2),
        item('TODO a [[2026-07-10]]', 1),
        item('TODO c [[2026-07-01]]', 3),
        item('TODO t2 [[2026-07-12]]', 7),
        item('TODO t1 [[2026-07-12]]', 6),
      ],
      [],
      TODAY,
      TODAY,
    );
    expect(itemTexts(buckets.overdue)).toEqual([
      'TODO c [[2026-07-01]]',
      'TODO a [[2026-07-10]]',
      'TODO b [[2026-07-10]]',
    ]);
    expect(itemTexts(buckets.dueThisDay)).toEqual([
      'TODO t1 [[2026-07-12]]',
      'TODO t2 [[2026-07-12]]',
    ]);
  });
});
