import type { Block } from '@taproot/shared';
import { ChevronRight } from 'lucide-react';
import { setCollapsed } from '@/actions';
import { childrenOf, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';
import { cn } from '@/lib/utils';
import { BulletLink } from './Bullet';
import { DocBlock } from './doc/DocBlock';
import { DrawingBlock } from './drawing/DrawingBlock';
import { EditableBlockText } from './EditableBlockText';

export function OutlineTree({
  parentId,
  ctx,
  forcedExpandedIds,
  highlightedBlockId,
}: {
  parentId: string | null;
  ctx: OutlineCtx;
  forcedExpandedIds?: ReadonlySet<string>;
  highlightedBlockId?: string;
}) {
  const blocks = useStore((s) => s.blocks);
  const children = childrenOf(blocks, ctx.pageId, parentId);
  return (
    <div>
      {children.map((block) => (
        <BlockRow
          key={block.id}
          block={block}
          ctx={ctx}
          forcedExpandedIds={forcedExpandedIds}
          highlightedBlockId={highlightedBlockId}
        />
      ))}
    </div>
  );
}

function BlockRow({
  block,
  ctx,
  forcedExpandedIds,
  highlightedBlockId,
}: {
  block: Block;
  ctx: OutlineCtx;
  forcedExpandedIds?: ReadonlySet<string>;
  highlightedBlockId?: string;
}) {
  const hasKids = useStore((s) =>
    Object.values(s.blocks).some((b) => b.parentId === block.id),
  );

  const forceExpanded = forcedExpandedIds?.has(block.id) ?? false;
  const expanded = hasKids && (!block.collapsed || forceExpanded);

  return (
    <div>
      <div
        data-outline-block-id={block.id}
        className={cn(
          'group relative flex items-start gap-1.5 rounded-md py-[3px] transition-colors',
          highlightedBlockId === block.id && 'bg-accent ring-1 ring-ring/20',
        )}
      >
        {hasKids && (
          <button
            onClick={() => setCollapsed(block.id, !block.collapsed)}
            title={block.collapsed ? 'Expand' : 'Collapse'}
            className="absolute top-[8px] -left-[16px] flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
          >
            <ChevronRight
              className={
                'h-3.5 w-3.5 transition-transform ' +
                (expanded ? 'rotate-90' : '')
              }
            />
          </button>
        )}
        <BulletLink
          blockId={block.id}
          ctx={ctx}
          title="Zoom in"
          collapsed={hasKids && !expanded}
        />
        {block.kind === 'drawing' ? (
          <div className="min-w-0 flex-1 leading-6">
            <DrawingBlock block={block} ctx={ctx} />
          </div>
        ) : block.kind === 'doc' ? (
          <div className="min-w-0 flex-1 leading-6">
            <DocBlock block={block} ctx={ctx} />
          </div>
        ) : (
          <EditableBlockText block={block} ctx={ctx} origin={ctx.origin} />
        )}
      </div>
      {expanded && (
        <div className="ml-outline-guide border-l border-border pl-outline-indent">
          <OutlineTree
            parentId={block.id}
            ctx={ctx}
            forcedExpandedIds={forcedExpandedIds}
            highlightedBlockId={highlightedBlockId}
          />
        </div>
      )}
    </div>
  );
}
