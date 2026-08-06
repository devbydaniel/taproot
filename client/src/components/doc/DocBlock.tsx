import type { Block } from '@taproot/shared';
import { FileText, Maximize2, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import * as actions from '@/actions';
import { docTitle } from '@/lib/doc';
import type { OutlineCtx } from '@/lib/outline';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

const DocEditor = lazy(() => import('./DocEditor'));

/**
 * A doc block in the outline: a one-line label row (icon + first heading),
 * expandable to a fullscreen markdown editor. Focusable so arrow-key
 * navigation flows through it like any text block.
 */
export function DocBlock({ block, ctx }: { block: Block; ctx: OutlineCtx }) {
  const isFocused = useStore((s) => s.focused?.blockId === block.id);
  const isOpen = useStore((s) => s.openDocId === block.id);
  const setFocus = useStore((s) => s.setFocus);
  const setOpenDoc = useStore((s) => s.setOpenDoc);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // arrow-nav from a neighbouring editor lands here: claim DOM focus
  useEffect(() => {
    if (isFocused && !isOpen) wrapperRef.current?.focus();
  }, [isFocused, isOpen]);

  const remove = () => {
    if (window.confirm('Delete this document?'))
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
      // otherwise there is no way to keep writing after a document
      if (event.metaKey || event.ctrlKey) setOpenDoc(block.id);
      else actions.splitBlock(block.id, 0, ctx);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      remove();
    }
  };

  return (
    <div className="group/doc relative">
      <div
        ref={wrapperRef}
        tabIndex={0}
        role="button"
        aria-label="Document"
        onKeyDown={onKeyDown}
        onClick={() => setFocus({ blockId: block.id, cursor: 'end' })}
        onDoubleClick={() => setOpenDoc(block.id)}
        onBlur={() => {
          // mirror BlockEditor: clear focus unless it moved into the overlay
          setTimeout(() => {
            const state = useStore.getState();
            if (
              state.focused?.blockId === block.id &&
              state.openDocId !== block.id &&
              document.activeElement !== wrapperRef.current
            ) {
              state.setFocus(null);
            }
          }, 0);
        }}
        className={cn(
          'flex cursor-default items-center gap-2 rounded-md border border-border px-2.5 py-1.5 outline-none',
          isFocused && 'ring-2 ring-ring/50',
        )}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            'truncate text-sm',
            docTitle(block.data) ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {docTitle(block.data) ?? 'Empty document'}
        </span>
      </div>
      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 gap-1 md:opacity-0 md:group-hover/doc:opacity-100">
        <button
          title="Edit document"
          onClick={() => setOpenDoc(block.id)}
          className="rounded-md border border-border bg-background/90 p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          title="Delete document"
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
                Loading document editor…
              </span>
            </div>
          }
        >
          <DocEditor block={block} />
        </Suspense>
      )}
    </div>
  );
}
