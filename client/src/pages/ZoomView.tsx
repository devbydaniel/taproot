import { findYouTubeVideo, type ZoomPayload } from '@taproot/shared';
import { useEffect, useState } from 'react';
import * as actions from '@/actions';
import { BlockEditor } from '@/components/BlockEditor';
import { renderedPreview } from '@/components/Breadcrumb';
import { PageShell } from '@/components/layout/PageShell';
import { DocBlock } from '@/components/doc/DocBlock';
import { DrawingBlock } from '@/components/drawing/DrawingBlock';
import { OutlineTree } from '@/components/OutlineTree';
import { StaticText } from '@/components/StaticText';
import { YouTubePreview } from '@/components/YouTubePreview';
import { api } from '@/lib/api';
import { installMergedBlocks } from '@/lib/offline/sync';
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
        installMergedBlocks(data.blocks);
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
  const rootBlock = liveBlock ?? payload.block;
  const titleText = rootBlock.text;
  const video =
    rootBlock.kind === 'text' && !isTitleFocused
      ? findYouTubeVideo(titleText)
      : null;

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
    <PageShell
      crumbs={[
        { label: payload.page.title, href: `/p/${payload.page.id}` },
        ...payload.ancestors.map((ancestor) => ({
          label: renderedPreview(ancestor),
          href: `/b/${ancestor.id}`,
        })),
      ]}
    >
      <div className="mb-6">
        {rootBlock.kind === 'drawing' ? (
          <DrawingBlock block={rootBlock} ctx={ctx} />
        ) : rootBlock.kind === 'doc' ? (
          <DocBlock block={rootBlock} ctx={ctx} />
        ) : isTitleFocused ? (
          <BlockEditor blockId={id} ctx={ctx} variant="title" />
        ) : (
          <div className="group/youtube relative">
            <h1
              className={
                'cursor-text text-lg font-semibold tracking-tight' +
                (video ? ' pr-7' : '')
              }
              onClick={() => setFocus({ blockId: id, cursor: 'end' })}
            >
              <StaticText text={titleText} />
            </h1>
            {video && <YouTubePreview key={video.id} video={video} />}
          </div>
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
    </PageShell>
  );
}
