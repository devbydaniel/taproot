import {
  bucketTasks,
  dailyDisplayLabel,
  todayTitle,
  type TaskListItem,
} from '@taproot/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { BlockContent } from '@/components/BlockContent';
import { api } from '@/lib/api';
import { useStore } from '@/store';

export function TasksView() {
  const [items, setItems] = useState<TaskListItem[] | null>(null);
  const remoteEpoch = useStore((s) => s.remoteEpoch);

  useEffect(() => {
    let cancelled = false;
    void api.getTasks().then((data) => {
      if (cancelled) return;
      useStore.getState().mergeBlocks(data.tasks.map((item) => item.block));
      setItems(data.tasks);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteEpoch]);

  const buckets = useMemo(
    () => (items ? bucketTasks(items, todayTitle()) : null),
    [items],
  );

  if (!buckets) return null;
  const count =
    buckets.inbox.length + buckets.due.length + buckets.planned.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Tasks</h1>
      <p className="mb-8 text-sm text-muted-foreground">
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
          <TaskSection title="Due" items={buckets.due} />
          <TaskSection title="Planned" items={buckets.planned} />
        </>
      )}
    </div>
  );
}

function TaskSection({
  title,
  items,
  showAge = false,
}: {
  title: string;
  items: TaskListItem[];
  showAge?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        <span className="ml-2 font-normal">{items.length}</span>
      </h2>
      {items.map((item) => (
        <TaskRow key={item.block.id} item={item} showAge={showAge} />
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
  // prefer the store's copy so checkbox toggles render immediately
  const live = useStore((s) => s.blocks[item.block.id]) ?? item.block;
  const age = showAge ? ageLabel(live.createdAt) : null;
  return (
    <div className="flex items-start gap-1.5 py-[3px]">
      <Link
        href={`/b/${item.block.id}`}
        title="Zoom to block"
        className="mt-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-accent"
      >
        <span className="block h-[6px] w-[6px] rounded-full bg-muted-foreground/70" />
      </Link>
      <div className="min-w-0 flex-1 leading-6">
        <BlockContent block={live} />
        {age && (
          <span
            title="Age of this task"
            className="ml-2 rounded-sm bg-muted px-1 py-0.5 text-[11px] text-muted-foreground/80"
          >
            {age}
          </span>
        )}
      </div>
      <Link
        href={`/p/${item.page.id}`}
        className="mt-[3px] max-w-32 shrink-0 truncate text-xs text-muted-foreground hover:text-link hover:underline"
      >
        {dailyDisplayLabel(item.page.title) ?? item.page.title}
      </Link>
    </div>
  );
}
