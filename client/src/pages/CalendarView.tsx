import type {
  CalendarApi,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
} from '@fullcalendar/core';
import interactionPlugin, {
  type DateClickArg,
  type DropArg,
  type EventResizeDoneArg,
} from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import {
  formatDailyTitle,
  type Block,
  type CalendarSyncStatus,
  type TaskListItem,
} from '@taproot/shared';
import { useHotkey } from '@tanstack/react-hotkeys';
import { ChevronLeft, ChevronRight, ListTodo } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { scheduleTask, toggleTaskCheckbox } from '@/actions';
import { useAssignedReferenceFilter } from '@/components/AssignedReferenceFilter';
import {
  CalendarTaskSidebar,
  SIDEBAR_TASK_ATTR,
} from '@/components/CalendarTaskSidebar';
import { CalendarEventContent } from '@/components/CalendarEventContent';
import { CalendarSyncIndicator } from '@/components/CalendarSyncIndicator';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { useGoogleEvents, type VisibleRange } from '@/hooks/use-google-events';
import { useMediaQuery } from '@/hooks/use-media-query';
import { api } from '@/lib/api';
import {
  placeTask,
  sidebarReferenceOptions,
  sidebarTasks,
  slotSchedule,
  taskEvent,
  taskLabel,
  type CalendarEventProps,
} from '@/lib/calendar';
import { installMergedBlocks } from '@/lib/offline/sync';
import { useRightPane } from '@/lib/rightPane';
import { shouldOpenInRightPane } from '@/lib/rightPaneGesture';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

const VIEWS = [
  { type: 'timeGridWeek', label: 'Week' },
  { type: 'timeGridDay', label: 'Day' },
] as const;

const SHORT_TITLE_FORMAT = { month: 'short', day: 'numeric' } as const;

const CLOCK_FORMAT = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
} as const;

/** phones get the day view and the task sidebar as a drawer */
const NARROW_QUERY = '(max-width: 767px)';
/** touch-first devices schedule by tap-then-tap; nothing drags on touch */
const TOUCH_QUERY = '(pointer: coarse)';

/**
 * Week/day calendar of open dated tasks. Timed tasks are blocks, date-only
 * tasks sit in the all-day row. Moving, resizing and dropping on the all-day
 * row rewrite the task's date link and time token — ordinary update_text ops,
 * so they work offline and reach other clients like any edit. A sidebar of
 * open tasks (filtered by reference) schedules them: drag one onto a slot, or
 * pick it and then click/tap a slot (the only way on touch and phones).
 * Synced Google events sit alongside, read-only; clicking one opens its Meet
 * call or the event in Google Calendar.
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
  const [range, setRange] = useState<VisibleRange | null>(null);
  const google = useGoogleEvents(range);
  const narrow = useMediaQuery(NARROW_QUERY);
  const touch = useMediaQuery(TOUCH_QUERY);
  const tapOnly = narrow || touch;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

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
  const taskBlocks = useMemo(() => {
    if (!items) return [];
    const ids = new Set([...items.map((item) => item.block.id), ...spawned]);
    return [...ids].flatMap((id) => {
      const block = blocks[id];
      return block ? [block] : [];
    });
  }, [items, spawned, blocks]);

  const events = useMemo(
    () => [
      ...google.events,
      ...taskBlocks.flatMap((block) => {
        const event = taskEvent(block);
        return event ? [event] : [];
      }),
    ],
    [google.events, taskBlocks],
  );

  const openTasks = useMemo(
    () => sidebarTasks(taskBlocks, new Set()),
    [taskBlocks],
  );
  const options = useMemo(
    () => sidebarReferenceOptions(openTasks),
    [openTasks],
  );
  const { selectedTitles, setSelectedTitles } = useAssignedReferenceFilter(
    options,
    'calendar',
  );
  const sidebarList = useMemo(
    () => sidebarTasks(openTasks, selectedTitles),
    [openTasks, selectedTitles],
  );

  // a picked task that got completed or deleted meanwhile is no longer pickable
  const picked: Block | undefined = openTasks.find(
    (block) => block.id === pickedId,
  );
  useHotkey('Escape', () => setPickedId(null), { enabled: pickedId !== null });

  const onPick = (id: string) => {
    setPickedId((current) => (current === id ? null : id));
    setDrawerOpen(false);
  };

  /** Land a sidebar task on the calendar; false when it can't go there. */
  const place = (id: string, start: Date, allDay: boolean): boolean => {
    const block = blocks[id];
    const schedule = block ? placeTask(block.text, start, allDay) : null;
    if (!schedule) return false;
    scheduleTask(id, schedule.date, schedule.time);
    return true;
  };

  const onDateClick = (info: DateClickArg) => {
    if (picked && place(picked.id, info.date, info.allDay)) setPickedId(null);
  };

  const onDrop = (info: DropArg) => {
    const id = info.draggedEl.getAttribute(SIDEBAR_TASK_ATTR);
    if (id === null) return;
    place(id, info.date, info.allDay);
    if (id === pickedId) setPickedId(null);
  };

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
    const props = info.event.extendedProps as CalendarEventProps;
    if (props.kind === 'google') {
      if (props.link) window.open(props.link, '_blank', 'noopener,noreferrer');
      return;
    }
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

  const sidebar = (portalContainer?: HTMLElement | null) => (
    <CalendarTaskSidebar
      tasks={sidebarList}
      options={options}
      selectedTitles={selectedTitles}
      onSelectedTitlesChange={setSelectedTitles}
      draggable={!tapOnly}
      pickedId={picked?.id ?? null}
      onPick={onPick}
      portalContainer={portalContainer}
    />
  );

  const actions = (
    <CalendarActions
      syncStatus={google.status}
      calendar={calendar}
      viewType={view?.type}
      compact={narrow}
      tasksOpen={narrow ? drawerOpen : sidebarOpen}
      onTasks={() =>
        narrow ? setDrawerOpen(true) : setSidebarOpen((open) => !open)
      }
    />
  );

  return (
    <PageShell
      // a phone header only has room for the (short) date range
      crumbs={[
        ...(narrow ? [] : [{ label: 'Calendar' }]),
        ...(view ? [{ label: view.title }] : []),
      ]}
      actions={actions}
      fill
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {picked && (
            <PickBanner
              label={taskLabel(picked.text) || 'Untitled task'}
              verb={tapOnly ? 'Tap' : 'Click'}
              onCancel={() => setPickedId(null)}
            />
          )}
          <div
            ref={frameRef}
            className={cn(
              'taproot-calendar min-h-0 flex-1',
              picked && 'taproot-picking',
            )}
          >
            <FullCalendar
              ref={calendarRef}
              plugins={[timeGridPlugin, interactionPlugin]}
              initialView={narrow ? 'timeGridDay' : 'timeGridWeek'}
              headerToolbar={false}
              height="100%"
              firstDay={1}
              nowIndicator
              titleFormat={narrow ? SHORT_TITLE_FORMAT : undefined}
              // no dragging on touch: tasks move by tap-then-tap from the sidebar
              editable={!tapOnly}
              droppable={!tapOnly}
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
              eventContent={(arg) => <CalendarEventContent arg={arg} />}
              // a task's time never spans midnight
              eventAllow={(span) =>
                slotSchedule(span.start, span.end, span.allDay) !== null
              }
              eventDrop={reschedule}
              eventResize={reschedule}
              eventClick={onEventClick}
              dateClick={onDateClick}
              drop={onDrop}
              datesSet={(arg: DatesSetArg) => {
                setView({ title: arg.view.title, type: arg.view.type });
                setRange({
                  start: formatDailyTitle(arg.start),
                  end: formatDailyTitle(arg.end),
                });
              }}
            />
          </div>
          {/* phones (below md = NARROW_QUERY): the header has no room left */}
          <div className="flex justify-end pt-1 empty:hidden md:hidden">
            <CalendarSyncIndicator status={google.status} />
          </div>
        </div>
        {!narrow && sidebarOpen && (
          <aside className="ml-3 w-64 shrink-0 border-l pt-1 pl-1">
            {sidebar()}
          </aside>
        )}
      </div>
      {narrow && (
        <TaskDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          {sidebar}
        </TaskDrawer>
      )}
    </PageShell>
  );
}

/**
 * Header actions: Google sync state (not on phones), task sidebar toggle,
 * today/back/forward, view switch.
 */
function CalendarActions({
  syncStatus,
  calendar,
  viewType,
  compact,
  tasksOpen,
  onTasks,
}: {
  syncStatus: CalendarSyncStatus | null;
  calendar: () => CalendarApi | undefined;
  viewType: string | undefined;
  compact: boolean;
  tasksOpen: boolean;
  onTasks: () => void;
}) {
  return (
    <>
      {!compact && <CalendarSyncIndicator status={syncStatus} />}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Tasks"
        aria-label="Tasks"
        aria-pressed={tasksOpen}
        onClick={onTasks}
      >
        <ListTodo />
      </Button>
      <Button
        variant="ghost"
        size={compact ? 'xs' : 'sm'}
        onClick={() => calendar()?.today()}
      >
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
      <ViewSwitch
        current={viewType}
        compact={compact}
        onChange={(type) => calendar()?.changeView(type)}
      />
    </>
  );
}

/**
 * The task sidebar on phones: a modal drawer. Its content is rendered with
 * the drawer element, so popups inside can portal into it — the modal blocks
 * pointer events and focus everywhere else.
 */
function TaskDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: (container: HTMLElement | null) => ReactNode;
}) {
  const [drawer, setDrawer] = useState<HTMLElement | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={setDrawer}
        side="right"
        showCloseButton={false}
        // Escape in the open filter popup closes just the popup
        onEscapeKeyDown={(event) => {
          if (drawer?.querySelector('[data-slot=combobox-content]'))
            event.preventDefault();
        }}
        className="gap-0 pt-3"
      >
        <SheetTitle className="sr-only">Tasks</SheetTitle>
        <SheetDescription className="sr-only">
          Pick a task, then tap a slot to schedule it.
        </SheetDescription>
        {children(drawer)}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Week/day toggle; `compact` (phones, where the header is tight) is a single
 * button naming the other view.
 */
function ViewSwitch({
  current,
  compact,
  onChange,
}: {
  current: string | undefined;
  compact: boolean;
  onChange: (type: string) => void;
}) {
  if (compact) {
    const other = VIEWS.find((option) => option.type !== current) ?? VIEWS[0];
    return (
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        title={`${other.label} view`}
        onClick={() => onChange(other.type)}
      >
        {other.label}
      </Button>
    );
  }
  return (
    <div className="ml-1 flex rounded-md bg-muted p-0.5">
      {VIEWS.map((option) => (
        <Button
          key={option.type}
          variant="ghost"
          size="xs"
          aria-pressed={current === option.type}
          className={cn(
            'text-muted-foreground hover:bg-transparent',
            current === option.type &&
              'bg-background text-foreground shadow-xs hover:bg-background',
          )}
          onClick={() => onChange(option.type)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function PickBanner({
  label,
  verb,
  onCancel,
}: {
  label: string;
  verb: string;
  onCancel: () => void;
}) {
  return (
    <div
      role="status"
      className="mx-1 mb-2 flex items-center gap-2 rounded-md bg-accent px-3 py-1 text-sm text-accent-foreground"
    >
      <span className="min-w-0 flex-1 truncate">
        {verb} a slot to schedule <span className="font-medium">{label}</span>
      </span>
      <Button variant="ghost" size="xs" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
