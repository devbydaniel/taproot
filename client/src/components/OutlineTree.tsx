import type { Block } from '@taproot/shared';
import { useRef } from 'react';
import { Link } from 'wouter';
import { renderedOffsetFromPoint, renderedToRaw } from '@/lib/clickpos';
import { childrenOf, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';
import { BlockEditor } from './BlockEditor';
import { StaticText } from './StaticText';

export function OutlineTree({
  parentId,
  ctx,
}: {
  parentId: string | null;
  ctx: OutlineCtx;
}) {
  const blocks = useStore((s) => s.blocks);
  const children = childrenOf(blocks, ctx.pageId, parentId);
  return (
    <div>
      {children.map((block) => (
        <BlockRow key={block.id} block={block} ctx={ctx} />
      ))}
    </div>
  );
}

function BlockRow({ block, ctx }: { block: Block; ctx: OutlineCtx }) {
  const isFocused = useStore((s) => s.focused?.blockId === block.id);
  const hasKids = useStore((s) =>
    Object.values(s.blocks).some((b) => b.parentId === block.id),
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const setFocus = useStore((s) => s.setFocus);

  const focusAtPoint = (event: React.MouseEvent) => {
    if ((event.target as Element).closest('a')) return;
    const container = contentRef.current;
    let cursor: number | 'end' = 'end';
    if (container) {
      const rendered = renderedOffsetFromPoint(
        container,
        event.clientX,
        event.clientY,
      );
      if (rendered != null) cursor = renderedToRaw(block.text, rendered);
    }
    setFocus({ blockId: block.id, cursor });
  };

  return (
    <div>
      <div className="group flex items-start gap-1.5 py-[3px]">
        <Link
          href={`/b/${block.id}`}
          title="Zoom in"
          className="mt-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent"
        >
          <span
            className={
              'block rounded-full bg-muted-foreground/70 transition-all group-hover:bg-foreground/80 ' +
              (hasKids
                ? 'h-[7px] w-[7px] ring-3 ring-muted'
                : 'h-[6px] w-[6px]')
            }
          />
        </Link>
        <div
          ref={contentRef}
          className="min-w-0 flex-1 cursor-text leading-6"
          onClick={isFocused ? undefined : focusAtPoint}
        >
          {isFocused ? (
            <BlockEditor blockId={block.id} ctx={ctx} />
          ) : (
            <StaticText text={block.text} />
          )}
        </div>
      </div>
      {hasKids && (
        <div className="ml-[7px] border-l border-border pl-[23px]">
          <OutlineTree parentId={block.id} ctx={ctx} />
        </div>
      )}
    </div>
  );
}
