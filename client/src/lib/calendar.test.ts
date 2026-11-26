import type { Block } from '@taproot/shared';
import { describe, expect, it } from 'vitest';
import { slotSchedule, taskEvent, taskLabel } from './calendar';

function block(text: string): Block {
  return {
    id: 'b1',
    pageId: 'p1',
    parentId: null,
    orderKey: 'a0',
    text,
    kind: 'text',
    data: null,
    collapsed: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('taskLabel', () => {
  it('drops marker, date, time and recurrence; keeps page titles', () => {
    expect(
      taskLabel(
        'TODO call [[Anna]] about #budget [[2026-08-01]] <14:00-15:00> <every week> soon',
      ),
    ).toBe('call Anna about budget soon');
  });

  it('keeps invalid tokens and later daily links as prose', () => {
    expect(taskLabel('TODO x <25:00> [[2026-08-01]] [[2026-08-02]]')).toBe(
      'x <25:00> 2026-08-02',
    );
  });
});

describe('taskEvent', () => {
  it('places a timed task as a block on its day', () => {
    expect(taskEvent(block('TODO x [[2026-08-01]] <14:00-15:00>'))).toEqual({
      id: 'b1',
      title: 'x',
      extendedProps: { recurring: false },
      start: '2026-08-01T14:00',
      end: '2026-08-01T15:00',
      allDay: false,
    });
  });

  it('ends a task that runs to midnight at the next day start', () => {
    expect(taskEvent(block('TODO x [[2026-08-31]] <23:45>'))).toMatchObject({
      start: '2026-08-31T23:45',
      end: '2026-09-01T00:00',
    });
  });

  it('puts a date-only task in the all-day row, not stretchable', () => {
    expect(
      taskEvent(block('TODO x [[2026-08-01]] <every week>')),
    ).toMatchObject({
      start: '2026-08-01',
      allDay: true,
      durationEditable: false,
      extendedProps: { recurring: true },
    });
  });

  it('skips done, undated and non-task blocks', () => {
    expect(taskEvent(block('DONE x [[2026-08-01]] <14:00>'))).toBeNull();
    expect(taskEvent(block('TODO x <14:00>'))).toBeNull();
    expect(taskEvent(block('x [[2026-08-01]] <14:00>'))).toBeNull();
  });

  it('labels an empty task', () => {
    expect(taskEvent(block('TODO [[2026-08-01]]'))?.title).toBe(
      'Untitled task',
    );
  });
});

describe('slotSchedule', () => {
  const at = (day: number, hours: number, minutes = 0) =>
    new Date(2026, 7, day, hours, minutes);

  it('reads a timed span on one day', () => {
    expect(slotSchedule(at(2, 10), at(2, 11, 15), false)).toEqual({
      date: '2026-08-02',
      time: { start: 600, end: 675 },
    });
  });

  it('gives a span without an end the default duration', () => {
    expect(slotSchedule(at(2, 9), null, false)).toEqual({
      date: '2026-08-02',
      time: { start: 540, end: 570 },
    });
    expect(slotSchedule(at(2, 23, 45), null, false)?.time).toEqual({
      start: 1425,
      end: 1440,
    });
  });

  it('treats the next midnight as the end of the day', () => {
    expect(slotSchedule(at(2, 23), at(3, 0), false)?.time).toEqual({
      start: 1380,
      end: 1440,
    });
  });

  it('rejects spans that cross midnight', () => {
    expect(slotSchedule(at(2, 23), at(3, 0, 30), false)).toBeNull();
    expect(slotSchedule(at(2, 10), at(4, 0), false)).toBeNull();
  });

  it('drops the time in the all-day row', () => {
    expect(slotSchedule(at(5, 0), at(6, 0), true)).toEqual({
      date: '2026-08-05',
      time: null,
    });
  });
});
