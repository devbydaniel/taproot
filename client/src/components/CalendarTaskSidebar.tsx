import { Draggable } from '@fullcalendar/interaction';
import { findRecurrence, taskDueDate, type Block } from '@taproot/shared';
import { Repeat } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { AssignedReferenceFilter } from '@/components/AssignedReferenceFilter';
import { BulletLink } from '@/components/Bullet';
import { TaskDatePill } from '@/components/TaskDatePill';
import { taskDuration, taskLabel } from '@/lib/calendar';
import { cn } from '@/lib/utils';

/** Marks a sidebar row; the value is the task's block id. */
export const SIDEBAR_TASK_ATTR = 'data-calendar-task';

/**
 * Open tasks next to the calendar, filtered by assigned reference. A task is
 * scheduled by dragging it onto a slot (`draggable`, pointer devices) or by
 * picking it here and then clicking/tapping a slot — the calendar view owns
 * both landings. Dated tasks are listed too, so they can be moved the same way.
 */
export function CalendarTaskSidebar({
  tasks,
  options,
  selectedTitles,
  onSelectedTitlesChange,
  draggable,
  pickedId,
  onPick,
  portalContainer,
}: {
  /** already filtered and ordered (see sidebarTasks) */
  tasks: Block[];
  options: string[];
  selectedTitles: ReadonlySet<string>;
  onSelectedTitlesChange: (titles: Set<string>) => void;
  draggable: boolean;
  pickedId: string | null;
  onPick: (id: string) => void;
  /** where the filter popup renders; the drawer passes itself */
  portalContainer?: HTMLElement | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // FullCalendar's external dragging; create:false because the dropped task
  // shows up through its own text change, not as a calendar-owned event
  useEffect(() => {
    const list = listRef.current;
    if (!draggable || !list) return;
    const dragging = new Draggable(list, {
      itemSelector: `[${SIDEBAR_TASK_ATTR}]`,
      eventData: (el) => ({
        title: el.dataset.title,
        duration: { minutes: Number(el.dataset.duration) },
        create: false,
      }),
    });
    return () => dragging.destroy();
  }, [draggable]);

  const unscheduled = tasks.filter((block) => !taskDueDate(block.text));
  const scheduled = tasks.filter((block) => taskDueDate(block.text));
  const selection =
    selectedTitles.size === 0 ? 'All' : [...selectedTitles].join(', ');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-1 pb-2">
        <h2 className="shrink-0 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Tasks
          <span className="ml-2 font-normal">{tasks.length}</span>
        </h2>
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={selection}
        >
          {selection}
        </span>
        <AssignedReferenceFilter
          options={options}
          selectedTitles={selectedTitles}
          onSelectedTitlesChange={onSelectedTitlesChange}
          portalContainer={portalContainer}
        />
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">
        {draggable
          ? 'Drag a task onto the calendar, or click it and then a slot.'
          : 'Tap a task, then a slot to schedule it.'}
      </p>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {tasks.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">
            {selectedTitles.size === 0
              ? 'No open tasks.'
              : 'No tasks match this filter.'}
          </p>
        ) : (
          <>
            <TaskGroup
              title="Unscheduled"
              tasks={unscheduled}
              draggable={draggable}
              pickedId={pickedId}
              onPick={onPick}
            />
            <TaskGroup
              title="Scheduled"
              tasks={scheduled}
              draggable={draggable}
              pickedId={pickedId}
              onPick={onPick}
            />
          </>
        )}
      </div>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  draggable,
  pickedId,
  onPick,
}: {
  title: string;
  tasks: Block[];
  draggable: boolean;
  pickedId: string | null;
  onPick: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="mb-3">
      <h3 className="mb-1 px-2 text-xs font-medium text-muted-foreground">
        {title}
        <span className="ml-1.5 font-normal">{tasks.length}</span>
      </h3>
      {tasks.map((block) => (
        <TaskRow
          key={block.id}
          block={block}
          draggable={draggable}
          picked={block.id === pickedId}
          onPick={onPick}
        />
      ))}
    </section>
  );
}

function TaskRow({
  block,
  draggable,
  picked,
  onPick,
}: {
  block: Block;
  draggable: boolean;
  picked: boolean;
  onPick: (id: string) => void;
}) {
  const label = taskLabel(block.text) || 'Untitled task';
  const recurring = findRecurrence(block.text) !== null;
  // Dated tasks show the pill below the title so the title keeps the row's
  // width; undated ones keep the small schedule button on the right.
  const dated = taskDueDate(block.text) !== null;
  const pill = (
    <OwnClicks>
      <TaskDatePill block={block} />
    </OwnClicks>
  );
  return (
    <div
      {...{ [SIDEBAR_TASK_ATTR]: block.id }}
      data-title={label}
      data-duration={taskDuration(block.text)}
      role="button"
      tabIndex={0}
      aria-pressed={picked}
      onClick={() => onPick(block.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onPick(block.id);
      }}
      className={cn(
        'flex items-start gap-1.5 rounded-md px-2 py-[3px] text-sm outline-none select-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
        draggable ? 'cursor-grab' : 'cursor-pointer',
        picked && 'bg-accent ring-1 ring-primary hover:bg-accent',
      )}
    >
      <OwnClicks>
        <BulletLink
          blockId={block.id}
          ctx={{ pageId: block.pageId, rootParentId: null }}
          title="Open task"
        />
      </OwnClicks>
      <div className="min-w-0 flex-1 leading-6 break-words">
        {recurring && (
          <Repeat
            className="mr-1 inline size-3 align-[-1px] text-muted-foreground"
            strokeWidth={2.5}
          />
        )}
        {label}
        {dated && <div className="flex pb-0.5">{pill}</div>}
      </div>
      {!dated && pill}
    </div>
  );
}

/**
 * The bullet opens the task and the pill reschedules it in place: keep their
 * clicks (and those in the pill's portalled popover, which bubble through the
 * React tree) from also picking the row.
 */
function OwnClicks({ children }: { children: ReactNode }) {
  return (
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      {children}
    </span>
  );
}
