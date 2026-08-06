import {
  bucketTasks,
  dailyDisplayLabel,
  parseDailyTitle,
  shiftDailyTitle,
  taskDueDate,
  taskHasPageLink,
  todayTitle,
  type TaskListItem,
} from '@taproot/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { BlockContent } from '@/components/BlockContent';
import { BulletLink } from '@/components/Bullet';
import { PageShell } from '@/components/layout/PageShell';
import { TaskDatePill } from '@/components/TaskDatePill';
import { api } from '@/lib/api';
import { installMergedBlocks } from '@/lib/offline/sync';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

export function TasksView() {
  const [items, setItems] = useState<TaskListItem[] | null>(null);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const blocks = useStore((s) => s.blocks);

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
    const live = items.map((item) => {
      const block = blocks[item.block.id] ?? item.block;
      return {
        ...item,
        block,
        dueDate: taskDueDate(block.text),
        hasPageLink: taskHasPageLink(block.text),
      };
    });
    return bucketTasks(live, todayTitle());
  }, [items, blocks]);

  if (!buckets) return null;
  const count =
    buckets.inbox.length +
    buckets.overdue.length +
    buckets.today.length +
    buckets.upcoming.length;

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
          <TaskSection title="Inbox" items={buckets.inbox} showAge />
          <TaskSection title="Overdue" items={buckets.overdue} alert />
          <TaskSection title="Today" items={buckets.today} />
          <UpcomingSection items={buckets.upcoming} />
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
  showAge = false,
  alert = false,
}: {
  title: string;
  items: TaskListItem[];
  showAge?: boolean;
  alert?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <SectionHeading title={title} count={items.length} alert={alert} />
      {items.map((item) => (
        <TaskRow key={item.block.id} item={item} showAge={showAge} />
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

function UpcomingSection({ items }: { items: TaskListItem[] }) {
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
            <TaskRow key={item.block.id} item={item} showAge={false} />
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

function TaskRow({ item, showAge }: { item: TaskListItem; showAge: boolean }) {
  const age = showAge ? ageLabel(item.block.createdAt) : null;
  return (
    <div className="flex items-start gap-1.5 py-[3px]">
      <BulletLink href={`/b/${item.block.id}`} />
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
      <TaskDatePill block={item.block} />
      <Link
        href={`/p/${item.page.id}`}
        className="mt-[3px] max-w-32 shrink-0 truncate text-xs text-muted-foreground hover:text-link hover:underline"
      >
        {dailyDisplayLabel(item.page.title) ?? item.page.title}
      </Link>
    </div>
  );
}
