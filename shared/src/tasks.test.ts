import { describe, expect, it } from 'vitest';
import {
  bucketTasks,
  cycleTaskState,
  parseTask,
  taskDueDate,
  taskHasPageLink,
  withTaskState,
} from './tasks.js';
import type { TaskListItem } from './types.js';

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

  it('returns the first daily link in text order', () => {
    expect(taskDueDate('TODO x [[2026-08-02]] [[2026-08-01]]')).toBe(
      '2026-08-02',
    );
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

  it('is true for non-daily links, including impossible dates', () => {
    expect(taskHasPageLink('TODO x [[Project]]')).toBe(true);
    expect(taskHasPageLink('TODO x [[Project]] [[2026-07-15]]')).toBe(true);
    expect(taskHasPageLink('TODO x [[2026-02-30]]')).toBe(true);
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
      page: { id: 'p1', title: 'Page', createdAt: 0, pinnedOrderKey: null },
      dueDate: taskDueDate(text),
      hasPageLink: taskHasPageLink(text),
    };
  }

  const texts = (list: TaskListItem[]) => list.map((i) => i.block.text);

  it('buckets by date vs today, inbox for bare tasks', () => {
    const buckets = bucketTasks(
      [
        item('TODO overdue [[2026-07-10]]'),
        item('TODO today [[2026-07-12]]'),
        item('TODO later [[2026-07-20]]'),
        item('TODO bare'),
      ],
      TODAY,
    );
    expect(texts(buckets.due)).toEqual([
      'TODO overdue [[2026-07-10]]',
      'TODO today [[2026-07-12]]',
    ]);
    expect(texts(buckets.planned)).toEqual(['TODO later [[2026-07-20]]']);
    expect(texts(buckets.inbox)).toEqual(['TODO bare']);
  });

  it('a date wins over a page link — dated tasks never land in the inbox', () => {
    const buckets = bucketTasks(
      [item('TODO x [[Project]] [[2026-07-01]]')],
      TODAY,
    );
    expect(buckets.due).toHaveLength(1);
    expect(buckets.inbox).toHaveLength(0);
  });

  it('drops undated tasks that link to a page', () => {
    const buckets = bucketTasks([item('TODO x [[Project]]')], TODAY);
    expect(buckets.inbox).toHaveLength(0);
    expect(buckets.due).toHaveLength(0);
    expect(buckets.planned).toHaveLength(0);
  });

  it('sorts due/planned by date then createdAt, inbox by createdAt', () => {
    const buckets = bucketTasks(
      [
        item('TODO b [[2026-07-10]]', 2),
        item('TODO a [[2026-07-10]]', 1),
        item('TODO c [[2026-07-01]]', 3),
        item('TODO new', 5),
        item('TODO old', 4),
      ],
      TODAY,
    );
    expect(texts(buckets.due)).toEqual([
      'TODO c [[2026-07-01]]',
      'TODO a [[2026-07-10]]',
      'TODO b [[2026-07-10]]',
    ]);
    expect(texts(buckets.inbox)).toEqual(['TODO old', 'TODO new']);
  });
});
