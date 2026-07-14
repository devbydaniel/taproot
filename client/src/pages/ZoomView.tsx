import type { ZoomPayload } from '@taproot/shared';
import { useEffect, useState } from 'react';
import * as actions from '@/actions';
import { BlockEditor } from '@/components/BlockEditor';
import { Breadcrumb } from '@/components/Breadcrumb';
import { DrawingBlock } from '@/components/drawing/DrawingBlock';
import { OutlineTree } from '@/components/OutlineTree';
import { StaticText } from '@/components/StaticText';
import { api } from '@/lib/api';
import { hasChildren, visibleOrder, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';

export function ZoomView({ id }: { id: string }) {
  const [payload, setPayload] = useState<ZoomPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const liveBlock = useStore((s) => s.blocks[id]);
  const isTitleFocused = useStore((s) => s.focused?.blockId === id);
  const setFocus = useStore((s) => s.setFocus);
  const hasBlocks = useStore((s) =>
    Object.values(s.blocks).some((b) => b.parentId === id),
  );

  useEffect(() => {
    let cancelled = false;
    api
      .getBlock(id)
      .then((data) => {
        if (cancelled) return;
        useStore.getState().mergeBlocks(data.blocks);
        setPayload(data);
      })
      .catch(() => setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [id, remoteEpoch]);

  if (notFound) {
    return (
      <p className="p-10 text-muted-foreground">This block does not exist.</p>
    );
  }
  if (!payload) return null;

  const ctx: OutlineCtx = { pageId: payload.page.id, rootParentId: id };
  const titleText = liveBlock?.text ?? payload.block.text;

  const clickBelow = () => {
    const { blocks } = useStore.getState();
    const order = visibleOrder(blocks, ctx);
    const last = order[order.length - 1];
    if (last && last.text === '' && !hasChildren(blocks, last.id)) {
      useStore.getState().setFocus({ blockId: last.id, cursor: 'end' });
    } else {
      actions.appendBlock(ctx);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <Breadcrumb
        page={payload.page}
        ancestors={payload.ancestors}
        className="mb-4"
      />

      <div className="mb-6">
        {(liveBlock ?? payload.block).kind === 'drawing' ? (
          <DrawingBlock block={liveBlock ?? payload.block} ctx={ctx} />
        ) : isTitleFocused ? (
          <BlockEditor blockId={id} ctx={ctx} variant="title" />
        ) : (
          <h1
            className="cursor-text text-3xl font-bold tracking-tight"
            onClick={() => setFocus({ blockId: id, cursor: 'end' })}
          >
            <StaticText text={titleText} />
          </h1>
        )}
      </div>

      {hasBlocks ? (
        <OutlineTree parentId={id} ctx={ctx} />
      ) : (
        <button
          onClick={() => actions.appendBlock(ctx)}
          className="cursor-text text-sm text-muted-foreground hover:text-foreground"
        >
          Click to start writing…
        </button>
      )}
      <div className="h-24 cursor-text" onClick={clickBelow} />
    </div>
  );
}
