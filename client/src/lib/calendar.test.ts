import type { Block, CalendarEvent } from '@taproot/shared';
import { describe, expect, it } from 'vitest';
import {
  dayWindowRowHeight,
  formatSyncTime,
  googleEvent,
  placeTask,
  sidebarReferenceOptions,
  sidebarTasks,
  slotSchedule,
  taskDuration,
  taskEvent,
  taskLabel,
} from './calendar';

function block(text: string, id = 'b1', createdAt = 0): Block {
  return {
    id,
    pageId: 'p1',
    parentId: null,
    orderKey: 'a0',
    text,
    kind: 'text',
    data: null,
    collapsed: false,
    createdAt,
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

describe('dayWindowRowHeight', () => {
  it('fits the 08:00–20:00 half-hour rows into the visible height', () => {
    expect(dayWindowRowHeight(738)).toBe(30.75);
    expect(dayWindowRowHeight(480)).toBe(20);
  });

  it('keeps rows readable on very short screens', () => {
    expect(dayWindowRowHeight(120)).toBe(12);
  });
});

describe('taskEvent', () => {
  it('places a timed task as a block on its day', () => {
    expect(taskEvent(block('TODO x [[2026-08-01]] <14:00-15:00>'))).toEqual({
      id: 'b1',
      title: 'x',
      classNames: ['taproot-task'],
      extendedProps: { kind: 'task', recurring: false, done: false },
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

  it('keeps a done task in its slot, marked done and read-only', () => {
    expect(taskEvent(block('DONE x [[2026-08-01]] <14:00>'))).toEqual({
      id: 'b1',
      title: 'x',
      classNames: ['taproot-task', 'taproot-task-done'],
      extendedProps: { kind: 'task', recurring: false, done: true },
      editable: false,
      start: '2026-08-01T14:00',
      end: '2026-08-01T14:30',
      allDay: false,
    });
    expect(
      taskEvent(block('DONE x [[2026-08-01]] <every week>')),
    ).toMatchObject({
      start: '2026-08-01',
      allDay: true,
      editable: false,
      extendedProps: { recurring: true, done: true },
    });
  });

  it('skips undated and non-task blocks', () => {
    expect(taskEvent(block('DONE x <14:00>'))).toBeNull();
    expect(taskEvent(block('TODO x <14:00>'))).toBeNull();
    expect(taskEvent(block('x [[2026-08-01]] <14:00>'))).toBeNull();
  });

  it('labels an empty task', () => {
    expect(taskEvent(block('TODO [[2026-08-01]]'))?.title).toBe(
      'Untitled task',
    );
  });
});

function google(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'g1',
    title: 'Standup',
    start: '2026-08-03T09:00:00+02:00',
    end: '2026-08-03T09:15:00+02:00',
    allDay: false,
    status: 'confirmed',
    meetLink: 'https://meet.google.com/abc-defg-hij',
    htmlLink: 'https://www.google.com/calendar/event?eid=g1',
    ...overrides,
  };
}

describe('googleEvent', () => {
  it('is a read-only timed event that links to its Meet call', () => {
    expect(googleEvent(google())).toEqual({
      id: 'google:g1',
      title: 'Standup',
      start: '2026-08-03T09:00:00+02:00',
      end: '2026-08-03T09:15:00+02:00',
      allDay: false,
      editable: false,
      classNames: ['taproot-google'],
      extendedProps: {
        kind: 'google',
        link: 'https://meet.google.com/abc-defg-hij',
        meet: true,
      },
    });
  });

  it('links to the event in Google Calendar without a Meet link', () => {
    expect(googleEvent(google({ meetLink: null })).extendedProps).toEqual({
      kind: 'google',
      link: 'https://www.google.com/calendar/event?eid=g1',
      meet: false,
    });
    expect(
      googleEvent(google({ meetLink: null, htmlLink: null })).extendedProps,
    ).toMatchObject({ link: null });
  });

  it('puts all-day events in the all-day row, still read-only', () => {
    expect(
      googleEvent(
        google({ start: '2026-08-03', end: '2026-08-05', allDay: true }),
      ),
    ).toMatchObject({
      start: '2026-08-03',
      end: '2026-08-05',
      allDay: true,
      editable: false,
    });
  });

  it('marks tentative events and names untitled ones', () => {
    const event = googleEvent(google({ status: 'tentative', title: '' }));
    expect(event.title).toBe('(No title)');
    expect(event.classNames).toEqual([
      'taproot-google',
      'taproot-google-tentative',
    ]);
  });
});

describe('formatSyncTime', () => {
  const now = new Date(2026, 7, 3, 16, 0);

  it('shows only the clock time for a sync today', () => {
    const at = new Date(2026, 7, 3, 9, 5);
    expect(formatSyncTime(at.getTime(), now)).toBe(
      at.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    );
  });

  it('adds the date for an older sync', () => {
    const at = new Date(2026, 7, 1, 9, 5);
    const text = formatSyncTime(at.getTime(), now);
    expect(text).not.toBe(formatSyncTime(at.getTime(), at));
    expect(text).toContain(formatSyncTime(at.getTime(), at));
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

describe('taskDuration', () => {
  it("is the time token's length, dated or not, else the default", () => {
    expect(taskDuration('TODO x [[2026-08-01]] <09:00-10:30>')).toBe(90);
    expect(taskDuration('TODO x <09:00-09:45>')).toBe(45);
    expect(taskDuration('TODO x <25:00>')).toBe(30);
    expect(taskDuration('TODO x')).toBe(30);
  });
});

describe('placeTask', () => {
  const at = (day: number, hours: number, minutes = 0) =>
    new Date(2026, 7, day, hours, minutes);

  it('gives an undated task the date and a default-length time', () => {
    expect(placeTask('TODO x', at(6, 9), false)).toEqual({
      date: '2026-08-06',
      time: { start: 540, end: 570 },
    });
  });

  it("moves a dated task, keeping its time's duration", () => {
    expect(
      placeTask('TODO x [[2026-08-01]] <14:00-15:15>', at(6, 9), false),
    ).toEqual({ date: '2026-08-06', time: { start: 540, end: 615 } });
  });

  it('sets only the date in the all-day row', () => {
    expect(placeTask('TODO x <14:00>', at(6, 0), true)).toEqual({
      date: '2026-08-06',
      time: null,
    });
  });

  it('refuses a slot that would run past midnight', () => {
    expect(placeTask('TODO x <09:00-10:00>', at(6, 23, 30), false)).toBeNull();
    expect(placeTask('TODO x', at(6, 23, 30), false)?.time).toEqual({
      start: 1410,
      end: 1440,
    });
  });
});

describe('sidebar tasks', () => {
  const tasks = [
    block('TODO late [[2026-08-03]] <10:00> [[Anna]]', 'late', 1),
    block('TODO early [[2026-08-03]] <08:00>', 'early', 2),
    block('TODO allday [[2026-08-03]] [[Bob]]', 'allday', 3),
    block('TODO first [[2026-08-01]]', 'first', 4),
    block('TODO new inbox [[Anna]] #Bob', 'new', 6),
    block('TODO old inbox', 'old', 5),
    block('DONE done [[Anna]]', 'done', 0),
    block('note [[Anna]]', 'note', 0),
  ];
  const ids = (blocks: Block[]) => blocks.map((b) => b.id);

  it('lists every open task for All: unscheduled first, then by date and time', () => {
    expect(ids(sidebarTasks(tasks, new Set()))).toEqual([
      'old',
      'new',
      'first',
      'allday',
      'early',
      'late',
    ]);
  });

  it('keeps exactly the open tasks linking to a selected reference', () => {
    expect(ids(sidebarTasks(tasks, new Set(['Anna'])))).toEqual([
      'new',
      'late',
    ]);
    expect(ids(sidebarTasks(tasks, new Set(['Anna', 'Bob'])))).toEqual([
      'new',
      'allday',
      'late',
    ]);
  });

  it('offers every non-daily reference of the given tasks', () => {
    expect(sidebarReferenceOptions(sidebarTasks(tasks, new Set()))).toEqual([
      'Anna',
      'Bob',
    ]);
  });
});
