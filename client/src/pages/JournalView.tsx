import { dailyLabel, todayTitle, type JournalDay } from '@taproot/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import * as actions from '@/actions';
import { RefGroupCard } from '@/components/LinkedRefs';
import { OutlineTree } from '@/components/OutlineTree';
import { api } from '@/lib/api';
import { installMergedBlocks, installPageSnapshot } from '@/lib/offline/sync';
import { visibleOrder, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';

const PAGE_SIZE = 20;

export function JournalView() {
  const [days, setDays] = useState<JournalDay[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  // how many days the view has loaded, so epoch refetches cover the whole window
  const loadedLimit = useRef(PAGE_SIZE);
  // today already auto-focused, so remote-epoch refetches don't steal the cursor
  const autoFocused = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const todayPage = await api.pageByTitle(todayTitle()); // ensure today's page exists
      const data = await api.getJournal({ limit: loadedLimit.current });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by the cleanup closure; TS can't see cross-closure writes
      if (cancelled) return;
      // offline, the cached journal window may predate today's page — the
      // one pageByTitle just ensured (or created locally); synthesize it
      const days = data.days.some((d) => d.page.title === todayPage.title)
        ? data.days
        : [{ page: todayPage, blocks: [], linkedRefs: [] }, ...data.days];
      for (const day of days) installPageSnapshot(day.page.id, day.blocks);
      // ref blocks live on other pages; merge them so checkbox toggles in
      // the references sections render immediately (same as PageView)
      installMergedBlocks(
        days.flatMap((day) => day.linkedRefs.flatMap((g) => g.blocks)),
      );
      setDays(days);
      setHasMore(data.hasMore);
      const today = days.find((d) => d.page.title === todayTitle());
      if (!autoFocused.current && today) {
        autoFocused.current = true;
        const ctx: OutlineCtx = { pageId: today.page.id, rootParentId: null };
        const { blocks, setFocus } = useStore.getState();
        const order = visibleOrder(blocks, ctx);
        const last = order[order.length - 1];
        if (last) setFocus({ blockId: last.id, cursor: 'end' });
        else actions.appendBlock(ctx);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteEpoch]);

  const loadMore = async () => {
    const last = days?.[days.length - 1];
    if (!last) return;
    const data = await api.getJournal({
      before: last.page.title,
      limit: PAGE_SIZE,
    });
    for (const day of data.days) installPageSnapshot(day.page.id, day.blocks);
    installMergedBlocks(
      data.days.flatMap((day) => day.linkedRefs.flatMap((g) => g.blocks)),
    );
    setDays([...days, ...data.days]);
    setHasMore(data.hasMore);
    loadedLimit.current += data.days.length;
  };

  if (!days) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Journal</h1>
      {days.map((day) => (
        <DaySection key={day.page.id} day={day} />
      ))}
      {hasMore && (
        <button
          onClick={() => void loadMore()}
          className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function DaySection({ day }: { day: JournalDay }) {
  const pageId = day.page.id;
  const hasBlocks = useStore((s) =>
    Object.values(s.blocks).some((b) => b.pageId === pageId),
  );
  const isToday = day.page.title === todayTitle();
  // past days with nothing written and no mentions stay out of the journal;
  // today always shows
  if (!hasBlocks && !isToday && day.linkedRefs.length === 0) return null;

  const ctx: OutlineCtx = { pageId, rootParentId: null };

  return (
    <section className="mb-10">
      <div className="mb-2 flex items-baseline gap-3">
        <Link
          href={`/p/${pageId}`}
          className="text-xl font-semibold tracking-tight hover:underline"
        >
          {day.page.title}
        </Link>
        <span className="text-sm text-muted-foreground">
          {isToday ? 'Today' : dailyLabel(day.page.title)}
        </span>
      </div>
      {hasBlocks ? (
        <OutlineTree parentId={null} ctx={ctx} />
      ) : (
        <button
          onClick={() => actions.appendBlock(ctx)}
          className="cursor-text text-sm text-muted-foreground hover:text-foreground"
        >
          Click to start writing…
        </button>
      )}
      {day.linkedRefs.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Linked References
          </h3>
          {day.linkedRefs.map((group) => (
            <RefGroupCard key={group.page.id} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}
