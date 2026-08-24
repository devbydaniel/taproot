import { findYouTubeVideo, type ZoomPayload } from '@taproot/shared';
import { useEffect, useState } from 'react';
import * as actions from '@/actions';
import { BlockEditor } from '@/components/BlockEditor';
import { renderedPreview } from '@/components/Breadcrumb';
import { PageShell, type PageSurface } from '@/components/layout/PageShell';
import { DocBlock } from '@/components/doc/DocBlock';
import { DrawingBlock } from '@/components/drawing/DrawingBlock';
import { OutlineTree } from '@/components/OutlineTree';
import { StaticText } from '@/components/StaticText';
import { YouTubePreview } from '@/components/YouTubePreview';
import { api } from '@/lib/api';
import { installMergedBlocks } from '@/lib/offline/sync';
import { hasChildren, visibleOrder, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';

export function ZoomView({
  id,
  surface = 'main',
  onClose,
}: {
  id: string;
  surface?: PageSurface;
  onClose?: () => void;
}) {
  const [payload, setPayload] = useState<ZoomPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const liveBlock = useStore((s) => s.blocks[id]);
  const origin = surface === 'right' ? `right:block:${id}` : undefined;
  const isTitleFocused = useStore(
    (s) => s.focused?.blockId === id && s.focused.origin === origin,
  );
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

  if (notFound || !payload)
    return (
      <ZoomStatus
        message={notFound ? 'This block does not exist.' : 'Loading…'}
        surface={surface}
        showOnMain={notFound}
        onClose={onClose}
      />
    );

  const ctx: OutlineCtx = {
    pageId: payload.page.id,
    rootParentId: id,
    origin,
  };
  const rootBlock = liveBlock ?? payload.block;

  const clickBelow = () => {
    const { blocks } = useStore.getState();
    const order = visibleOrder(blocks, ctx);
    const last = order[order.length - 1];
    if (last && last.text === '' && !hasChildren(blocks, last.id)) {
      useStore
        .getState()
        .setFocus({ blockId: last.id, cursor: 'end', origin: ctx.origin });
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
      surface={surface}
      onClose={onClose}
    >
      <ZoomTitle
        block={rootBlock}
        ctx={ctx}
        isFocused={isTitleFocused}
        onFocus={() =>
          setFocus({ blockId: id, cursor: 'end', origin: ctx.origin })
        }
      />

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

function ZoomTitle({
  block,
  ctx,
  isFocused,
  onFocus,
}: {
  block: ZoomPayload['block'];
  ctx: OutlineCtx;
  isFocused: boolean;
  onFocus: () => void;
}) {
  if (block.kind === 'drawing')
    return (
      <div className="mb-6">
        <DrawingBlock block={block} ctx={ctx} />
      </div>
    );
  if (block.kind === 'doc')
    return (
      <div className="mb-6">
        <DocBlock block={block} ctx={ctx} />
      </div>
    );
  if (isFocused)
    return (
      <div className="mb-6">
        <BlockEditor
          blockId={block.id}
          ctx={ctx}
          variant="title"
          origin={ctx.origin}
        />
      </div>
    );

  const video = findYouTubeVideo(block.text);
  return (
    <div className="group/youtube relative mb-6">
      <h1
        className={
          'cursor-text text-lg font-semibold tracking-tight' +
          (video ? ' pr-7' : '')
        }
        onClick={onFocus}
      >
        <StaticText text={block.text} />
      </h1>
      {video && <YouTubePreview key={video.id} video={video} />}
    </div>
  );
}

function ZoomStatus({
  message,
  surface,
  showOnMain,
  onClose,
}: {
  message: string;
  surface: PageSurface;
  showOnMain: boolean;
  onClose?: () => void;
}) {
  const content = <p className="p-6 text-muted-foreground">{message}</p>;
  if (surface === 'main') return showOnMain ? content : null;
  return (
    <PageShell crumbs={[]} surface={surface} onClose={onClose}>
      {content}
    </PageShell>
  );
}
