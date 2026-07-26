import { parseTask, type Block } from '@taproot/shared';
import { useRef } from 'react';
import { renderedOffsetFromPoint, renderedToRaw } from '@/lib/clickpos';
import type { OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';
import { BlockContent } from './BlockContent';
import { BlockEditor } from './BlockEditor';

/**
 * Rendered block text that swaps to the CodeMirror editor when focused,
 * placing the cursor at the clicked position. Shared by the outline and the
 * linked-references section (variant 'ref' = text-only editing).
 */
export function EditableBlockText({
  block,
  ctx,
  variant = 'block',
  origin,
}: {
  block: Block;
  ctx: OutlineCtx;
  variant?: 'block' | 'ref';
  /** distinguishes this rendering when the block is on screen twice (outline + refs) */
  origin?: string;
}) {
  const isFocused = useStore(
    (s) => s.focused?.blockId === block.id && s.focused.origin === origin,
  );
  const setFocus = useStore((s) => s.setFocus);
  const contentRef = useRef<HTMLDivElement>(null);

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
    setFocus({ blockId: block.id, cursor, origin });
  };

  return (
    <div
      ref={contentRef}
      className="min-w-0 flex-1 cursor-text leading-6"
      onClick={isFocused ? undefined : focusAtPoint}
    >
      {isFocused ? (
        <BlockEditor
          blockId={block.id}
          ctx={ctx}
          variant={variant}
          origin={origin}
        />
      ) : (
        <BlockContent block={block} />
      )}
    </div>
  );
}
