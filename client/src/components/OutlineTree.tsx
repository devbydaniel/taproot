import type { Block } from '@taproot/shared';
import { ChevronRight } from 'lucide-react';
import { setCollapsed } from '@/actions';
import { childrenOf, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';
import { BulletLink } from './Bullet';
import { DocBlock } from './doc/DocBlock';
import { DrawingBlock } from './drawing/DrawingBlock';
import { EditableBlockText } from './EditableBlockText';

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
  const hasKids = useStore((s) =>
    Object.values(s.blocks).some((b) => b.parentId === block.id),
  );

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
        <BulletLink
          href={`/b/${block.id}`}
          title="Zoom in"
          collapsed={hasKids && block.collapsed}
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
          <EditableBlockText block={block} ctx={ctx} />
        )}
      </div>
      {hasKids && !block.collapsed && (
        <div className="ml-outline-guide border-l border-border pl-outline-indent">
          <OutlineTree parentId={block.id} ctx={ctx} />
        </div>
      )}
    </div>
  );
}
