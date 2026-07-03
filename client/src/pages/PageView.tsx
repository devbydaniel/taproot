import type { PagePayload } from '@taproot/shared';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    api
      .getPage(id)
      .then((data) => {
        if (cancelled) return;
        useStore.getState().loadPageBlocks(id, data.blocks);
        setPayload(data);
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

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">
        {payload.page.title}
      </h1>
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
