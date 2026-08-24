import {
  bucketTasks,
  dailyDisplayLabel,
  daysUntilWeekday,
  isDailyTitle,
  parseDailyTitle,
  shiftDailyTitle,
  taskDueDate,
  taskHasPageLink,
  todayTitle,
  type TaskListItem,
} from '@taproot/shared';
import { useHotkey } from '@tanstack/react-hotkeys';
import { FileText, FolderInput, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  assignTaskToPage,
  rescheduleTask,
  toggleTaskCheckbox,
} from '@/actions';
import { BlockContent } from '@/components/BlockContent';
import { BulletLink } from '@/components/Bullet';
import { PageShell } from '@/components/layout/PageShell';
import { TaskDatePill } from '@/components/TaskDatePill';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { api } from '@/lib/api';
import { installMergedBlocks } from '@/lib/offline/sync';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

type PickerKind = 'date' | 'assign';

/** Keyboard-cursor state threaded to the rows; rows are addressed by block id. */
interface Selection {
  selectedId: string | null;
  picker: PickerKind | null;
  select: (id: string) => void;
  openPicker: (id: string, picker: PickerKind) => void;
  closePicker: () => void;
}

export function TasksView() {
  const [items, setItems] = useState<TaskListItem[] | null>(null);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const blocks = useStore((s) => s.blocks);
  const [, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getTasks().then((data) => {
      if (cancelled) return;
      installMergedBlocks(data.tasks.map((item) => item.block));
      setItems(data.tasks);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteEpoch]);

  // re-derive date/link facts from the live store copy so a reschedule moves
  // the row between sections immediately; the fetch only controls membership
  const buckets = useMemo(() => {
    if (!items) return null;
    const live = items.flatMap((item) => {
      const block = blocks[item.block.id];
      return block
        ? [
            {
              ...item,
              block,
              dueDate: taskDueDate(block.text),
              hasPageLink: taskHasPageLink(block.text),
            },
          ]
        : [];
    });
    return bucketTasks(live, todayTitle());
  }, [items, blocks]);

  // flat render order across all sections; the keyboard cursor walks this list
  const orderedIds = useMemo(
    () =>
      buckets
        ? [
            ...buckets.inbox,
            ...buckets.overdue,
            ...buckets.today,
            ...buckets.upcoming,
          ].map((item) => item.block.id)
        : [],
    [buckets],
  );

  // auto-advance: when the selected row leaves the list (assigned away,
  // completed + refetched, deleted), move the cursor to the row that took its
  // former place instead of dropping the selection
  const prevOrderedRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevOrderedRef.current;
    prevOrderedRef.current = orderedIds;
    if (selectedId === null || orderedIds.includes(selectedId)) return;
    const index = prev.indexOf(selectedId);
    const next =
      index === -1
        ? null
        : (orderedIds[Math.min(index, orderedIds.length - 1)] ?? null);
    setSelectedId(next);
    setPicker(null);
  }, [orderedIds, selectedId]);

  const move = (delta: 1 | -1) => {
    if (orderedIds.length === 0) return;
    const index = selectedId === null ? -1 : orderedIds.indexOf(selectedId);
    const next =
      index === -1
        ? delta === 1
          ? 0
          : orderedIds.length - 1
        : Math.min(Math.max(index + delta, 0), orderedIds.length - 1);
    setSelectedId(orderedIds[next]!);
  };

  const withSelected = (fn: (id: string) => void) => () => {
    if (selectedId !== null) fn(selectedId);
  };

  // While a picker popover is open its own keyboard handling wins (the
  // calendar focuses buttons, which the hotkey library does not treat as
  // inputs), so everything except Escape is disabled instead of guarded.
  const idle = { enabled: picker === null };
  useHotkey('J', () => move(1), idle);
  useHotkey('ArrowDown', () => move(1), idle);
  useHotkey('K', () => move(-1), idle);
  useHotkey('ArrowUp', () => move(-1), idle);
  useHotkey(
    'T',
    withSelected((id) => rescheduleTask(id, todayTitle())),
    idle,
  );
  useHotkey(
    'W',
    withSelected((id) =>
      rescheduleTask(
        id,
        shiftDailyTitle(todayTitle(), daysUntilWeekday(1, new Date())),
      ),
    ),
    idle,
  );
  useHotkey(
    'S',
    withSelected(() => setPicker('date')),
    idle,
  );
  useHotkey(
    'A',
    withSelected(() => setPicker('assign')),
    idle,
  );
  useHotkey('X', withSelected(toggleTaskCheckbox), idle);
  useHotkey('D', withSelected(toggleTaskCheckbox), idle);
  useHotkey(
    'Enter',
    withSelected((id) => navigate(`/b/${id}`)),
    idle,
  );
  // single owner of Escape: the popovers preventDefault their own close
  useHotkey('Escape', () => {
    if (picker !== null) setPicker(null);
    else setSelectedId(null);
  });

  const selection: Selection = {
    selectedId,
    picker,
    select: setSelectedId,
    openPicker: (id, kind) => {
      setSelectedId(id);
      setPicker(kind);
    },
    closePicker: () => setPicker(null),
  };

  if (!buckets) return null;
  const count = orderedIds.length;

  return (
    <PageShell crumbs={[{ label: 'Tasks' }]}>
      <p className="mb-6 text-sm text-muted-foreground">
        {count} open {count === 1 ? 'task' : 'tasks'}
      </p>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing open. Start a bullet with “TODO ” anywhere and it will show up
          here.
        </p>
      ) : (
        <>
          <TaskSection
            title="Inbox"
            items={buckets.inbox}
            selection={selection}
            showAge
          />
          <TaskSection
            title="Overdue"
            items={buckets.overdue}
            selection={selection}
            alert
          />
          <TaskSection
            title="Today"
            items={buckets.today}
            selection={selection}
          />
          <UpcomingSection items={buckets.upcoming} selection={selection} />
        </>
      )}
    </PageShell>
  );
}

function SectionHeading({
  title,
  count,
  alert = false,
}: {
  title: string;
  count: number;
  alert?: boolean;
}) {
  return (
    <h2
      className={cn(
        'mb-2 text-sm font-semibold tracking-wide uppercase',
        alert ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {title}
      <span className="ml-2 font-normal">{count}</span>
    </h2>
  );
}

function TaskSection({
  title,
  items,
  selection,
  showAge = false,
  alert = false,
}: {
  title: string;
  items: TaskListItem[];
  selection: Selection;
  showAge?: boolean;
  alert?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <SectionHeading title={title} count={items.length} alert={alert} />
      {items.map((item) => (
        <TaskRow
          key={item.block.id}
          item={item}
          selection={selection}
          showAge={showAge}
        />
      ))}
    </section>
  );
}

/** "September" (year appended when it differs from the current one). */
function monthLabel(dueDate: string): string {
  const date = parseDailyTitle(dueDate)!;
  return date.toLocaleDateString('en-US', {
    month: 'long',
    ...(date.getFullYear() !== new Date().getFullYear() && {
      year: 'numeric',
    }),
  });
}

/** Upcoming, pre-sorted by date: one group per day for a week, then by month. */
function upcomingGroups(items: TaskListItem[], today: string) {
  const horizon = shiftDailyTitle(today, 7)!;
  const groups: { key: string; label: string; items: TaskListItem[] }[] = [];
  for (const item of items) {
    const date = item.dueDate!;
    const byDay = date <= horizon;
    const key = byDay ? date : date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({
        key,
        label: byDay ? dailyDisplayLabel(date)! : monthLabel(date),
        items: [item],
      });
    }
  }
  return groups;
}

function UpcomingSection({
  items,
  selection,
}: {
  items: TaskListItem[];
  selection: Selection;
}) {
  if (items.length === 0) return null;
  const groups = upcomingGroups(items, todayTitle());
  return (
    <section className="mb-8">
      <SectionHeading title="Upcoming" count={items.length} />
      {groups.map((group) => (
        <div key={group.key} className="mb-4">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {group.label}
          </h3>
          {group.items.map((item) => (
            <TaskRow
              key={item.block.id}
              item={item}
              selection={selection}
              showAge={false}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

function ageLabel(createdAt: number): string | null {
  const days = Math.floor((Date.now() - createdAt) / 86_400_000);
  if (days < 2) return null;
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

function TaskRow({
  item,
  selection,
  showAge,
}: {
  item: TaskListItem;
  selection: Selection;
  showAge: boolean;
}) {
  const id = item.block.id;
  const selected = selection.selectedId === id;
  const picker = selected ? selection.picker : null;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const age = showAge ? ageLabel(item.block.createdAt) : null;

  return (
    <Popover
      open={picker === 'assign'}
      onOpenChange={(open) => {
        if (!open) selection.closePicker();
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={rowRef}
          data-selected={selected || undefined}
          onClick={() => selection.select(id)}
          className={cn(
            'group -mx-2 flex items-start gap-1.5 rounded-md px-2 py-[3px]',
            selected && 'bg-accent',
          )}
        >
          <BulletLink
            blockId={id}
            ctx={{ pageId: item.block.pageId, rootParentId: null }}
          />
          <div className="min-w-0 flex-1 leading-6">
            <BlockContent block={item.block} />
            {age && (
              <span
                title="Age of this task"
                className="ml-2 rounded-sm bg-muted px-1 py-0.5 text-[11px] text-muted-foreground/80"
              >
                {age}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Assign to page"
            onClick={(event) => {
              event.stopPropagation();
              selection.openPicker(id, 'assign');
            }}
            className={cn(
              'mt-[1px] shrink-0 text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100',
              selected && 'opacity-100',
            )}
          >
            <FolderInput />
          </Button>
          <TaskDatePill
            block={item.block}
            open={picker === 'date'}
            onOpenChange={(open) =>
              open ? selection.openPicker(id, 'date') : selection.closePicker()
            }
          />
          <Link
            href={`/p/${item.page.id}`}
            className="mt-[3px] max-w-32 shrink-0 truncate text-xs text-muted-foreground hover:text-link hover:underline"
          >
            {dailyDisplayLabel(item.page.title) ?? item.page.title}
          </Link>
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-72 p-0"
        align="end"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <AssignPageCommand
          onPick={(title) => {
            selection.closePicker();
            assignTaskToPage(id, title);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Page picker for filing a task under a page; daily pages are excluded —
 * scheduling owns those. Typing an unknown title offers creation; the server
 * auto-creates the page when the wikilink lands. */
function AssignPageCommand({ onPick }: { onPick: (title: string) => void }) {
  const [query, setQuery] = useState('');
  const allPages = useStore((s) => s.pages);
  const pages = allPages.filter((p) => !isDailyTitle(p.title));
  const trimmed = query.trim();
  const showCreate =
    trimmed !== '' &&
    !pages.some((p) => p.title.toLowerCase() === trimmed.toLowerCase());

  return (
    <Command>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Assign to page…"
      />
      <CommandList>
        <CommandEmpty>No pages.</CommandEmpty>
        {pages.map((page) => (
          <CommandItem
            key={page.id}
            value={page.title}
            onSelect={() => onPick(page.title)}
          >
            <FileText className="text-muted-foreground" />
            <span className="truncate">{page.title}</span>
          </CommandItem>
        ))}
        {showCreate && (
          <CommandItem
            forceMount
            value={`create:${trimmed}`}
            onSelect={() => onPick(trimmed)}
          >
            <Plus className="text-muted-foreground" />
            <span className="truncate">Create page “{trimmed}”</span>
          </CommandItem>
        )}
      </CommandList>
    </Command>
  );
}
