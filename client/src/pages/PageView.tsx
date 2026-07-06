import {
  dailyLabel,
  isDailyTitle,
  shiftDailyTitle,
  todayTitle,
  type PagePayload,
} from '@taproot/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import * as actions from '@/actions';
import { LinkedRefs } from '@/components/LinkedRefs';
import { OutlineTree } from '@/components/OutlineTree';
import { api } from '@/lib/api';
import { hasChildren, visibleOrder, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';

export function PageView({ id }: { id: string }) {
  const [payload, setPayload] = useState<PagePayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const hasBlocks = useStore((s) =>
    Object.values(s.blocks).some((b) => b.pageId === id),
  );
  // pages already auto-focused, so remote-epoch refetches don't steal the cursor
  const autoFocused = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPage(id)
      .then((data) => {
        if (cancelled) return;
        useStore.getState().loadPageBlocks(id, data.blocks);
        // linked-ref blocks live on other pages; merge them so checkbox
        // toggles in the references section render immediately
        useStore
          .getState()
          .mergeBlocks(data.linkedRefs.flatMap((g) => g.blocks));
        setPayload(data);
        if (autoFocused.current !== id) {
          autoFocused.current = id;
          const { blocks, setFocus } = useStore.getState();
          const order = visibleOrder(blocks, {
            pageId: id,
            rootParentId: null,
          });
          const last = order[order.length - 1];
          if (last) setFocus({ blockId: last.id, cursor: 'end' });
          else actions.appendBlock({ pageId: id, rootParentId: null });
        }
      })
      .catch(() => setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [id, remoteEpoch]);

  if (notFound) {
    return (
      <p className="p-10 text-muted-foreground">This page does not exist.</p>
    );
  }
  if (!payload) return null;

  const ctx: OutlineCtx = { pageId: id, rootParentId: null };

  const clickBelow = () => {
    const { blocks, setFocus } = useStore.getState();
    const order = visibleOrder(blocks, ctx);
    const last = order[order.length - 1];
    if (last && last.text === '' && !hasChildren(blocks, last.id)) {
      setFocus({ blockId: last.id, cursor: 'end' });
    } else {
      actions.appendBlock(ctx);
    }
  };

  const isDaily = isDailyTitle(payload.page.title);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1
        className={
          'text-3xl font-bold tracking-tight ' + (isDaily ? 'mb-1' : 'mb-6')
        }
      >
        {payload.page.title}
      </h1>
      {isDaily && <DailyNav title={payload.page.title} />}
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
      <div className="h-24 cursor-text" onClick={clickBelow} />
      <LinkedRefs groups={payload.linkedRefs} />
    </div>
  );
}

/** prev/next day + Today controls shown under the title of a daily page */
function DailyNav({ title }: { title: string }) {
  const [, navigate] = useLocation();

  const goTo = (target: string | null) => {
    if (!target) return;
    void api.pageByTitle(target).then((page) => navigate(`/p/${page.id}`));
  };

  const navButton =
    'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

  return (
    <div className="mb-6 flex items-center gap-1">
      <span className="mr-2 text-sm text-muted-foreground">
        {dailyLabel(title)}
      </span>
      <button
        onClick={() => goTo(shiftDailyTitle(title, -1))}
        title="Previous day"
        className={navButton}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => goTo(shiftDailyTitle(title, 1))}
        title="Next day"
        className={navButton}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {title !== todayTitle() && (
        <button
          onClick={() => goTo(todayTitle())}
          className="rounded-md px-2 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Today
        </button>
      )}
    </div>
  );
}
