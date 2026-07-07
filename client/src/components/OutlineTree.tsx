import { parseTask, type Block } from '@taproot/shared';
import { ChevronRight } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'wouter';
import { setCollapsed } from '@/actions';
import { renderedOffsetFromPoint, renderedToRaw } from '@/lib/clickpos';
import { childrenOf, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';
import { BlockContent } from './BlockContent';
import { BlockEditor } from './BlockEditor';
import { DrawingBlock } from './drawing/DrawingBlock';

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
    if ((event.target as Element).closest('a,button')) return;
    const container = contentRef.current;
    // a task marker is hidden in rendered mode, so map clicks within the
    // visible rest and shift by the hidden prefix length
    const visible = parseTask(block.text)?.rest ?? block.text;
    const prefixLength = block.text.length - visible.length;
    let cursor: number | 'end' = 'end';
    if (container) {
      const rendered = renderedOffsetFromPoint(
        container,
        event.clientX,
        event.clientY,
      );
      if (rendered != null)
        cursor = renderedToRaw(visible, rendered) + prefixLength;
    }
    setFocus({ blockId: block.id, cursor });
  };

  return (
    <div>
      <div className="group relative flex items-start gap-1.5 py-[3px]">
        {hasKids && (
          <button
            onClick={() => setCollapsed(block.id, !block.collapsed)}
            title={block.collapsed ? 'Expand' : 'Collapse'}
            className="absolute top-[8px] -left-[16px] flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
          >
            <ChevronRight
              className={
                'h-3.5 w-3.5 transition-transform ' +
                (block.collapsed ? '' : 'rotate-90')
              }
            />
          </button>
        )}
        <Link
          href={`/b/${block.id}`}
          title="Zoom in"
          className="mt-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent"
        >
          <span
            className={
              'block rounded-full bg-muted-foreground/70 transition-all group-hover:bg-foreground/80 ' +
              (hasKids && block.collapsed
                ? 'h-[7px] w-[7px] ring-3 ring-muted'
                : 'h-[6px] w-[6px]')
            }
          />
        </Link>
        <div
          ref={contentRef}
          className={
            'min-w-0 flex-1 leading-6' +
            (block.kind === 'drawing' ? '' : ' cursor-text')
          }
          onClick={
            block.kind === 'drawing' || isFocused ? undefined : focusAtPoint
          }
        >
          {block.kind === 'drawing' ? (
            <DrawingBlock block={block} ctx={ctx} />
          ) : isFocused ? (
            <BlockEditor blockId={block.id} ctx={ctx} />
          ) : (
            <BlockContent block={block} />
          )}
        </div>
      </div>
      {hasKids && !block.collapsed && (
        <div className="ml-[7px] border-l border-border pl-[23px]">
          <OutlineTree parentId={block.id} ctx={ctx} />
        </div>
      )}
    </div>
  );
}
