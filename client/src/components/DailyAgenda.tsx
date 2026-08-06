import {
  bucketAgenda,
  dailyDisplayLabel,
  parseTask,
  taskDueDate,
  taskHasPageLink,
  todayTitle,
  type Block,
  type TaskListItem,
} from '@taproot/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { BlockContent } from '@/components/BlockContent';
import { BulletLink } from '@/components/Bullet';
import { api } from '@/lib/api';
import { installMergedBlocks } from '@/lib/offline/sync';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

interface Chip {
  href: string;
  label: string;
}

/**
 * Agenda card at the top of a daily page: overdue tasks (shown on the real
 * today only), tasks due on the displayed day, and open TODOs from the page's
 * own outline. Like PageTasks, membership is sticky while mounted: completing
 * a task strikes it through but keeps the row until the page is left. Each
 * block lives in exactly one section — the latest classification wins.
 */
export function DailyAgenda({
  pageId,
  pageTitle,
}: {
  pageId: string;
  pageTitle: string;
}) {
  const [items, setItems] = useState<TaskListItem[] | null>(null);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const blocks = useStore((s) => s.blocks);
  const everOverdue = useRef(new Map<string, TaskListItem>());
  const everDue = useRef(new Map<string, TaskListItem>());
  const everOnPage = useRef(new Set<string>());

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

  // wait for the task list: bucketing on-page blocks before dated tasks can
  // claim them would stick a dated task into "On this page" permanently
  if (!items) return null;

  const today = todayTitle();
  // re-derive date facts from the live store copy so edits move rows between
  // sections immediately; the fetch only controls membership
  const live = items.map((item) => {
    const block = blocks[item.block.id] ?? item.block;
    return {
      ...item,
      block,
      dueDate: taskDueDate(block.text),
      hasPageLink: taskHasPageLink(block.text),
    };
  });
  const pageBlocks = Object.values(blocks).filter((b) => b.pageId === pageId);
  const buckets = bucketAgenda(live, pageBlocks, pageTitle, today);

  for (const item of buckets.overdue) {
    everOverdue.current.set(item.block.id, item);
    everDue.current.delete(item.block.id);
    everOnPage.current.delete(item.block.id);
  }
  for (const item of buckets.dueThisDay) {
    everDue.current.set(item.block.id, item);
    everOverdue.current.delete(item.block.id);
    everOnPage.current.delete(item.block.id);
  }
  for (const block of buckets.onPage) {
    if (everOverdue.current.has(block.id) || everDue.current.has(block.id)) {
      continue;
    }
    everOnPage.current.add(block.id);
  }

  // rows render from the store only: deleted blocks and de-tasked text drop out
  const taskRows = (
    sticky: Map<string, TaskListItem>,
    chip: (item: TaskListItem) => Chip | null,
  ) =>
    [...sticky.values()].flatMap((item) => {
      const block = blocks[item.block.id];
      if (!block || !parseTask(block.text)) return [];
      return [{ block, chip: chip(item) }];
    });

  const overdueRows = taskRows(everOverdue.current, (item) => ({
    href: `/p/${item.page.id}`,
    label: dailyDisplayLabel(item.page.title) ?? item.page.title,
  }));
  const dueRows = taskRows(everDue.current, (item) =>
    item.page.id === pageId
      ? null
      : {
          href: `/p/${item.page.id}`,
          label: dailyDisplayLabel(item.page.title) ?? item.page.title,
        },
  );
  const onPageRows = [...everOnPage.current].flatMap((id) => {
    const block = blocks[id];
    if (!block || !parseTask(block.text)) return [];
    return [{ block, chip: null }];
  });

  if (overdueRows.length + dueRows.length + onPageRows.length === 0) {
    return null;
  }

  return (
    <section className="mb-6 rounded-xl border bg-muted/30 px-4 py-3">
      <AgendaSection title="Overdue" alert rows={overdueRows} />
      <AgendaSection
        title={pageTitle === today ? 'Due today' : 'Due this day'}
        rows={dueRows}
      />
      <AgendaSection title="On this page" rows={onPageRows} />
    </section>
  );
}

function AgendaSection({
  title,
  rows,
  alert = false,
}: {
  title: string;
  rows: { block: Block; chip: Chip | null }[];
  alert?: boolean;
}) {
  if (rows.length === 0) return null;
  const openCount = rows.filter(
    ({ block }) => parseTask(block.text)?.state === 'TODO',
  ).length;
  return (
    <div className="mb-4 last:mb-0">
      <h2
        className={cn(
          'mb-1 text-sm font-semibold tracking-wide uppercase',
          alert ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {title}
        {openCount > 0 && <span className="ml-2 font-normal">{openCount}</span>}
      </h2>
      {rows.map(({ block, chip }) => (
        <div key={block.id} className="flex items-start gap-1.5 py-[3px]">
          <BulletLink href={`/b/${block.id}`} />
          <div className="min-w-0 flex-1 leading-6">
            <BlockContent block={block} />
          </div>
          {chip && (
            <Link
              href={chip.href}
              className="mt-[3px] max-w-32 shrink-0 truncate text-xs text-muted-foreground hover:text-link hover:underline"
            >
              {chip.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
