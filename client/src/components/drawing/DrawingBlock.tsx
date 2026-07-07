import type { Block } from '@taproot/shared';
import { Maximize2, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import * as actions from '@/actions';
import type { OutlineCtx } from '@/lib/outline';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import { DrawingPreview } from './DrawingPreview';

const DrawingEditor = lazy(() => import('./DrawingEditor'));

/**
 * A drawing block in the outline: inline SVG preview with a hover toolbar,
 * expandable to a fullscreen Excalidraw editor. Focusable so arrow-key
 * navigation flows through it like any text block.
 */
export function DrawingBlock({
  block,
  ctx,
}: {
  block: Block;
  ctx: OutlineCtx;
}) {
  const isFocused = useStore((s) => s.focused?.blockId === block.id);
  const isOpen = useStore((s) => s.openDrawingId === block.id);
  const setFocus = useStore((s) => s.setFocus);
  const setOpenDrawing = useStore((s) => s.setOpenDrawing);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // arrow-nav from a neighbouring editor lands here: claim DOM focus
  useEffect(() => {
    if (isFocused && !isOpen) wrapperRef.current?.focus();
  }, [isFocused, isOpen]);

  const remove = () => {
    if (window.confirm('Delete this drawing?'))
      actions.deleteBlock(block.id, ctx);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const dir = event.key === 'ArrowUp' ? -1 : 1;
      actions.focusNeighbor(block.id, dir, ctx, dir < 0 ? 'end' : 'start');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Mod-Enter opens the editor; plain Enter adds a bullet below,
      // otherwise there is no way to keep writing after a drawing
      if (event.metaKey || event.ctrlKey) setOpenDrawing(block.id);
      else actions.splitBlock(block.id, 0, ctx);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      remove();
    }
  };

  return (
    <div className="group/drawing relative">
      <div
        ref={wrapperRef}
        tabIndex={0}
        role="button"
        aria-label="Drawing"
        onKeyDown={onKeyDown}
        onClick={() => setFocus({ blockId: block.id, cursor: 'end' })}
        onDoubleClick={() => setOpenDrawing(block.id)}
        onBlur={() => {
          // mirror BlockEditor: clear focus unless it moved into the overlay
          setTimeout(() => {
            const state = useStore.getState();
            if (
              state.focused?.blockId === block.id &&
              state.openDrawingId !== block.id &&
              document.activeElement !== wrapperRef.current
            ) {
              state.setFocus(null);
            }
          }, 0);
        }}
        className={cn(
          'max-h-72 cursor-default overflow-hidden rounded-md border border-border outline-none',
          isFocused && 'ring-2 ring-ring/50',
        )}
      >
        <DrawingPreview data={block.data} />
      </div>
      <div className="absolute top-1.5 right-1.5 flex gap-1 md:opacity-0 md:group-hover/drawing:opacity-100">
        <button
          title="Edit drawing"
          onClick={() => setOpenDrawing(block.id)}
          className="rounded-md border border-border bg-background/90 p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          title="Delete drawing"
          onClick={remove}
          className="rounded-md border border-border bg-background/90 p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {isOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
              <span className="text-sm text-muted-foreground">
                Loading drawing editor…
              </span>
            </div>
          }
        >
          <DrawingEditor block={block} />
        </Suspense>
      )}
    </div>
  );
}
