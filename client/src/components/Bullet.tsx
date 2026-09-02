import { PanelRightOpen, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { deleteBlock } from '@/actions';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { oldestAncestorId, type OutlineCtx } from '@/lib/outline';
import { useRightPane } from '@/lib/rightPane';
import { shouldOpenInRightPane } from '@/lib/rightPaneGesture';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

/**
 * outline bullet: a dot that links to the block's zoom view; collapsed
 * blocks get the larger ringed dot (geometry tokens live in index.css)
 */
export function BulletLink({
  blockId,
  ctx,
  title = 'Zoom to block',
  collapsed = false,
  contextRootBlockId,
}: {
  blockId: string;
  ctx: OutlineCtx;
  title?: string;
  collapsed?: boolean;
  contextRootBlockId?: string;
}) {
  const { target, open, close } = useRightPane();
  const inferredContextRootId = useStore((state) =>
    oldestAncestorId(state.blocks, blockId),
  );
  const contextRootId = contextRootBlockId ?? inferredContextRootId;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          href={`/b/${blockId}`}
          title={title}
          // wouter deliberately skips modified clicks before calling onClick,
          // so capture the Shift gesture before its navigation handler.
          onClickCapture={(event) => {
            if (!shouldOpenInRightPane(event)) return;
            event.preventDefault();
            event.stopPropagation();
            open({ kind: 'block', id: blockId });
          }}
          className="mt-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent"
        >
          <span
            className={cn(
              'block rounded-full bg-muted-foreground/70 transition-all group-hover:bg-foreground/80',
              collapsed
                ? 'size-bullet-dot-lg ring-3 ring-muted'
                : 'size-bullet-dot',
            )}
          />
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          className="hidden md:flex"
          onSelect={() =>
            open({
              kind: 'block',
              id: contextRootId,
              revealBlockId: blockId,
            })
          }
        >
          <PanelRightOpen />
          Show context in side pane
        </ContextMenuItem>
        <ContextMenuSeparator className="hidden md:block" />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            deleteBlock(blockId, ctx);
            if (target?.kind === 'block' && target.id === blockId) close();
          }}
        >
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
