import { Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { deleteBlock } from '@/actions';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { OutlineCtx } from '@/lib/outline';
import { cn } from '@/lib/utils';

/**
 * outline bullet: a dot that links to the block's zoom view; collapsed
 * blocks get the larger ringed dot (geometry tokens live in index.css)
 */
export function BulletLink({
  blockId,
  ctx,
  title = 'Zoom to block',
  collapsed = false,
}: {
  blockId: string;
  ctx: OutlineCtx;
  title?: string;
  collapsed?: boolean;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          href={`/b/${blockId}`}
          title={title}
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
          variant="destructive"
          onSelect={() => deleteBlock(blockId, ctx)}
        >
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
