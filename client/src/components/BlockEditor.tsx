import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import * as actions from '@/actions';
import type { OutlineCtx } from '@/lib/outline';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

interface Props {
  blockId: string;
  ctx: OutlineCtx;
  /** 'title' = the zoomed block rendered as a page heading */
  variant?: 'block' | 'title';
  className?: string;
}

function wikiCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^[\]]*$/);
  if (!match) return null;
  const query = context.state
    .sliceDoc(match.from + 2, context.pos)
    .toLowerCase();
  const titles = useStore.getState().pages.map((p) => p.title);
  const options = titles
    .filter((title) => title.toLowerCase().includes(query))
    .slice(0, 12)
    .map((title) => ({ label: title, apply: `${title}]]` }));
  if (options.length === 0) return null;
  return { from: match.from + 2, options, filter: false };
}

/** paste etc. must never introduce newlines — a block is a single line */
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.newDoc.sliceString(0).includes('\n')) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({
      from: fromA,
      to: toA,
      insert: inserted.toString().replace(/\n+/g, ' '),
    });
  });
  return [{ changes }];
});

export function BlockEditor({
  blockId,
  ctx,
  variant = 'block',
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const focused = useStore((s) => s.focused);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const boundaryMove = (view: EditorView, dir: -1 | 1): boolean => {
      if (completionStatus(view.state) === 'active') return false;
      const selection = view.state.selection.main;
      if (!selection.empty) return false;
      const moved = view.moveVertically(selection, dir > 0);
      if (moved.head !== selection.head) return false; // still inside this block's wrapped lines
      return actions.focusNeighbor(
        blockId,
        dir,
        ctx,
        dir > 0 ? 'start' : 'end',
      );
    };

    const editKeymap = Prec.highest(
      keymap.of([
        {
          key: 'Enter',
          run: (view) => {
            if (completionStatus(view.state) === 'active')
              return acceptCompletion(view);
            if (variant === 'title') {
              view.contentDOM.blur();
              return true;
            }
            actions.splitBlock(blockId, view.state.selection.main.head, ctx);
            return true;
          },
        },
        {
          key: 'Tab',
          run: (view) => {
            if (completionStatus(view.state) === 'active')
              return acceptCompletion(view);
            if (variant === 'title') return true;
            actions.indentBlock(blockId, view.state.selection.main.head, ctx);
            return true;
          },
        },
        {
          key: 'Shift-Tab',
          run: (view) => {
            if (variant === 'title') return true;
            actions.outdentBlock(blockId, view.state.selection.main.head, ctx);
            return true;
          },
        },
        {
          key: 'Backspace',
          run: (view) => {
            const selection = view.state.selection.main;
            if (variant === 'title' || !selection.empty || selection.head !== 0)
              return false;
            return actions.deleteEmptyBlock(blockId, ctx);
          },
        },
        {
          key: 'ArrowUp',
          run: (view) => (variant === 'title' ? false : boundaryMove(view, -1)),
        },
        { key: 'ArrowDown', run: (view) => boundaryMove(view, 1) },
        {
          key: 'ArrowLeft',
          run: (view) => {
            if (variant === 'title') return false;
            const selection = view.state.selection.main;
            if (!selection.empty || selection.head !== 0) return false;
            return actions.focusNeighbor(blockId, -1, ctx, 'end');
          },
        },
        {
          key: 'ArrowRight',
          run: (view) => {
            if (variant === 'title') return false;
            const selection = view.state.selection.main;
            if (!selection.empty || selection.head !== view.state.doc.length)
              return false;
            return actions.focusNeighbor(blockId, 1, ctx, 'start');
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            if (completionStatus(view.state) === 'active') return false;
            view.contentDOM.blur();
            return true;
          },
        },
      ]),
    );

    const view = new EditorView({
      state: EditorState.create({
        doc: useStore.getState().blocks[blockId]?.text ?? '',
        extensions: [
          editKeymap,
          history(),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          autocompletion({ override: [wikiCompletionSource] }),
          EditorView.lineWrapping,
          singleLine,
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              actions.updateText(blockId, update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => {
              actions.flushText();
              setTimeout(() => {
                const state = useStore.getState();
                const active = document.activeElement;
                if (
                  state.focused?.blockId === blockId &&
                  !active?.closest('.cm-editor')
                ) {
                  state.setFocus(null);
                }
              }, 0);
            },
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // ctx/variant are stable for the lifetime of a mounted block row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);

  // focus + cursor placement, re-applied whenever a new focus target is set
  useEffect(() => {
    const view = viewRef.current;
    if (!view || focused?.blockId !== blockId) return;
    const length = view.state.doc.length;
    const anchor =
      focused.cursor === 'start'
        ? 0
        : focused.cursor === 'end'
          ? length
          : Math.min(focused.cursor, length);
    view.focus();
    view.dispatch({ selection: { anchor } });
  }, [focused, blockId]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full',
        variant === 'title' && 'text-3xl font-bold',
        className,
      )}
    />
  );
}
