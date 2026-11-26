import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from '@fullcalendar/core';
import interactionPlugin, {
  type EventResizeDoneArg,
} from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { TaskListItem } from '@taproot/shared';
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { scheduleTask, toggleTaskCheckbox } from '@/actions';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { slotSchedule, taskEvent, type TaskEventProps } from '@/lib/calendar';
import { installMergedBlocks } from '@/lib/offline/sync';
import { useRightPane } from '@/lib/rightPane';
import { shouldOpenInRightPane } from '@/lib/rightPaneGesture';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

const VIEWS = [
  { type: 'timeGridWeek', label: 'Week' },
  { type: 'timeGridDay', label: 'Day' },
] as const;

const CLOCK_FORMAT = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
} as const;

/**
 * Week/day calendar of open dated tasks. Timed tasks are blocks, date-only
 * tasks sit in the all-day row. Moving, resizing and dropping on the all-day
 * row rewrite the task's date link and time token — ordinary update_text ops,
 * so they work offline and reach other clients like any edit.
 */
export function CalendarView() {
  const [items, setItems] = useState<TaskListItem[] | null>(null);
  // recurring completions spawn their next instance locally; it only joins
  // the fetched membership on the next refetch, so track it meanwhile
  const [spawned, setSpawned] = useState<string[]>([]);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const blocks = useStore((s) => s.blocks);
  const [, navigate] = useLocation();
  const { open } = useRightPane();
  const calendarRef = useRef<FullCalendar>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ title: string; type: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void api.getTasks().then((data) => {
      if (cancelled) return;
      installMergedBlocks(data.blocks ?? data.tasks.map((item) => item.block));
      setItems(data.tasks);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteEpoch]);

  // FullCalendar only tracks window resizes; the frame also changes width
  // when the app sidebar or the side pane opens
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(() =>
      calendarRef.current?.getApi().updateSize(),
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // membership comes from the fetch (plus local spawns); placement and
  // completion come from the live store copy, so edits show immediately
  const events = useMemo(() => {
    if (!items) return [];
    const ids = new Set([...items.map((item) => item.block.id), ...spawned]);
    return [...ids].flatMap((id) => {
      const block = blocks[id];
      const event = block ? taskEvent(block) : null;
      return event ? [event] : [];
    });
  }, [items, spawned, blocks]);

  const reschedule = (info: EventDropArg | EventResizeDoneArg) => {
    const { event } = info;
    const schedule = event.start
      ? slotSchedule(event.start, event.end, event.allDay)
      : null;
    if (!schedule || !scheduleTask(event.id, schedule.date, schedule.time))
      info.revert();
  };

  const onEventClick = (info: EventClickArg) => {
    info.jsEvent.preventDefault();
    const id = info.event.id;
    const target = info.jsEvent.target as Element;
    if (target.closest('[data-task-checkbox]')) {
      const nextId = toggleTaskCheckbox(id);
      if (nextId !== null) setSpawned((current) => [...current, nextId]);
    } else if (shouldOpenInRightPane(info.jsEvent)) {
      open({ kind: 'block', id });
    } else {
      navigate(`/b/${id}`);
    }
  };

  const calendar = () => calendarRef.current?.getApi();

  const actions = (
    <>
      <Button variant="ghost" size="sm" onClick={() => calendar()?.today()}>
        Today
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Previous"
        aria-label="Previous"
        onClick={() => calendar()?.prev()}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Next"
        aria-label="Next"
        onClick={() => calendar()?.next()}
      >
        <ChevronRight />
      </Button>
      <div className="ml-1 flex rounded-md bg-muted p-0.5">
        {VIEWS.map((option) => (
          <Button
            key={option.type}
            variant="ghost"
            size="xs"
            aria-pressed={view?.type === option.type}
            className={cn(
              'text-muted-foreground hover:bg-transparent',
              view?.type === option.type &&
                'bg-background text-foreground shadow-xs hover:bg-background',
            )}
            onClick={() => calendar()?.changeView(option.type)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </>
  );

  return (
    <PageShell
      crumbs={[{ label: 'Calendar' }, ...(view ? [{ label: view.title }] : [])]}
      actions={actions}
      fill
    >
      <div ref={frameRef} className="taproot-calendar min-h-0 flex-1">
        <FullCalendar
          ref={calendarRef}
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={false}
          height="100%"
          firstDay={1}
          nowIndicator
          editable
          eventResizableFromStart={false}
          slotDuration="00:30"
          snapDuration="00:15"
          defaultTimedEventDuration="00:30"
          scrollTime="07:00"
          allDayText="All day"
          slotLabelFormat={CLOCK_FORMAT}
          eventTimeFormat={CLOCK_FORMAT}
          dayHeaderFormat={{ weekday: 'short', day: 'numeric' }}
          events={events}
          eventClassNames="taproot-task"
          eventContent={(arg) => <TaskEventContent arg={arg} />}
          // a task's time never spans midnight
          eventAllow={(span) =>
            slotSchedule(span.start, span.end, span.allDay) !== null
          }
          eventDrop={reschedule}
          eventResize={reschedule}
          eventClick={onEventClick}
          datesSet={(arg: DatesSetArg) =>
            setView({ title: arg.view.title, type: arg.view.type })
          }
        />
      </div>
    </PageShell>
  );
}

function TaskEventContent({ arg }: { arg: EventContentArg }) {
  const { recurring } = arg.event.extendedProps as TaskEventProps;
  return (
    <div className="flex h-full min-w-0 items-start gap-1 overflow-hidden px-1 py-0.5 text-xs leading-4">
      <button
        type="button"
        data-task-checkbox
        title="Complete task"
        aria-label={`Complete ${arg.event.title}`}
        className="mt-px size-3 shrink-0 rounded-[3px] border border-primary bg-background hover:bg-primary/30"
      />
      <div className="min-w-0">
        <div className="truncate font-medium">
          {recurring && (
            <Repeat
              className="mr-0.5 inline size-2.5 align-[-1px]"
              strokeWidth={2.5}
            />
          )}
          {arg.event.title}
        </div>
        {arg.timeText && (
          <div className="truncate text-muted-foreground">{arg.timeText}</div>
        )}
      </div>
    </div>
  );
}
