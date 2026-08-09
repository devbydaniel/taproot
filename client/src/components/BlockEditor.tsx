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
import {
  cycleTaskState,
  findPageReferences,
  shiftDailyTitle,
  suggestDailyTitles,
} from '@taproot/shared';
import { useEffect, useRef } from 'react';
import * as actions from '@/actions';
import type { OutlineCtx } from '@/lib/outline';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

interface Props {
  blockId: string;
  ctx: OutlineCtx;
  /**
   * 'title' = the zoomed block rendered as a page heading;
   * 'ref' = text-only editing in a linked-references row — structural keys
   * (split/indent/outdent/delete/neighbor-nav/collapse) are disabled because
   * the source page is only partially loaded in the store
   */
  variant?: 'block' | 'title' | 'ref';
  /** must match the store's focused.origin — see FocusTarget */
  origin?: string;
  className?: string;
}

function wikiCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^[\]]*$/);
  if (!match) return null;
  const raw = context.state.sliceDoc(match.from + 2, context.pos);
  const query = raw.toLowerCase();
  // natural-language dates ("tomorrow", "next wed", "in 3 days") resolve to
  // daily-page links; they rank above title matches and shadow duplicates
  const dateOptions = suggestDailyTitles(raw).map((s) => ({
    label: s.title,
    detail: s.label,
    apply: `${s.title}]]`,
  }));
  const dateTitles = new Set(dateOptions.map((o) => o.label));
  const titles = useStore.getState().pages.map((p) => p.title);
  const options = [
    ...dateOptions,
    ...titles
      .filter(
        (title) =>
          title.toLowerCase().includes(query) && !dateTitles.has(title),
      )
      .slice(0, 12)
      .map((title) => ({ label: title, apply: `${title}]]` })),
  ];
  if (options.length === 0) return null;
  return { from: match.from + 2, options, filter: false };
}

/**
 * Slash commands: a block whose whole text is `/…` offers block-level
 * transformations. Add future commands here.
 */
const SLASH_COMMANDS = [
  { name: 'draw', detail: 'insert a drawing', run: actions.convertToDrawing },
  { name: 'write', detail: 'write a document', run: actions.convertToDoc },
] as const;

function makeSlashCompletionSource(blockId: string) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/^\/[a-zA-Z]*$/);
    if (!match) return null;
    const query = context.state
      .sliceDoc(match.from + 1, context.pos)
      .toLowerCase();
    const options = SLASH_COMMANDS.filter((cmd) =>
      cmd.name.startsWith(query),
    ).map((cmd) => ({
      label: `/${cmd.name}`,
      detail: cmd.detail,
      apply: () => cmd.run(blockId),
    }));
    if (options.length === 0) return null;
    return { from: match.from, filter: false, options };
  };
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
  origin,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const focused = useStore((s) => s.focused);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // only the outline variant may change tree structure or move focus
    const structural = variant === 'block';

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

    // Alt-↑/↓ on a YYYY-MM-DD page reference reschedules it by a day;
    // the updateListener turns the edit into a normal update_text op
    const shiftDateAtCursor = (view: EditorView, days: number): boolean => {
      if (completionStatus(view.state) === 'active') return false;
      const head = view.state.selection.main.head;
      for (const reference of findPageReferences(view.state.doc.toString())) {
        if (head < reference.from || head > reference.to) continue;
        const shifted = shiftDailyTitle(reference.title, days);
        if (!shifted) return false;
        view.dispatch({
          changes: {
            from: reference.titleFrom,
            to: reference.titleTo,
            insert: shifted,
          },
          selection: {
            anchor: Math.min(
              head,
              reference.titleFrom +
                shifted.length +
                (reference.to - reference.titleTo),
            ),
          },
        });
        return true;
      }
      return false;
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
            // in refs Enter must be consumed: falling through would insert
            // a space via the singleLine filter
            if (!structural) return true;
            // fallback for a dismissed completion popup
            const slash = SLASH_COMMANDS.find(
              (cmd) => view.state.doc.toString().trim() === `/${cmd.name}`,
            );
            if (slash) {
              slash.run(blockId);
              return true;
            }
            // Enter on an empty bullet outdents instead of splitting
            if (
              view.state.doc.length === 0 &&
              actions.outdentBlock(blockId, 0, ctx)
            ) {
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
            if (!structural) return true;
            actions.indentBlock(blockId, view.state.selection.main.head, ctx);
            return true;
          },
        },
        {
          key: 'Shift-Tab',
          run: (view) => {
            if (!structural) return true;
            actions.outdentBlock(blockId, view.state.selection.main.head, ctx);
            return true;
          },
        },
        {
          key: 'Backspace',
          run: (view) => {
            const selection = view.state.selection.main;
            if (!structural || !selection.empty || selection.head !== 0)
              return false;
            return actions.deleteEmptyBlock(blockId, ctx);
          },
        },
        {
          key: 'Alt-ArrowUp',
          run: (view) => shiftDateAtCursor(view, 1),
        },
        {
          key: 'Alt-ArrowDown',
          run: (view) => shiftDateAtCursor(view, -1),
        },
        {
          key: 'ArrowUp',
          run: (view) => (structural ? boundaryMove(view, -1) : false),
        },
        {
          key: 'ArrowDown',
          run: (view) => (variant === 'ref' ? false : boundaryMove(view, 1)),
        },
        {
          key: 'ArrowLeft',
          run: (view) => {
            if (!structural) return false;
            const selection = view.state.selection.main;
            if (!selection.empty || selection.head !== 0) return false;
            return actions.focusNeighbor(blockId, -1, ctx, 'end');
          },
        },
        {
          key: 'ArrowRight',
          run: (view) => {
            if (!structural) return false;
            const selection = view.state.selection.main;
            if (!selection.empty || selection.head !== view.state.doc.length)
              return false;
            return actions.focusNeighbor(blockId, 1, ctx, 'start');
          },
        },
        {
          key: 'Mod-ArrowUp',
          run: (view) => {
            if (completionStatus(view.state) === 'active') return false;
            if (variant === 'title') return false;
            // refs ignore collapsed state — consume to avoid Cmd-↑ scroll
            if (structural) actions.setCollapsed(blockId, true);
            return true; // consume even on leaf blocks (no Cmd-↑ scroll)
          },
        },
        {
          key: 'Mod-ArrowDown',
          run: (view) => {
            if (completionStatus(view.state) === 'active') return false;
            if (variant === 'title') return false;
            if (structural) actions.setCollapsed(blockId, false);
            return true;
          },
        },
        {
          // cycle task state: plain → TODO → DONE → plain
          key: 'Mod-Enter',
          run: (view) => {
            const old = view.state.doc.toString();
            const next = cycleTaskState(old);
            const head = view.state.selection.main.head;
            const anchor = Math.max(
              0,
              Math.min(next.length, head + (next.length - old.length)),
            );
            view.dispatch({
              changes: { from: 0, to: old.length, insert: next },
              selection: { anchor },
            });
            return true;
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
          autocompletion({
            override: structural
              ? [wikiCompletionSource, makeSlashCompletionSource(blockId)]
              : [wikiCompletionSource],
          }),
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
                  state.focused.origin === origin &&
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
    if (!view || focused?.blockId !== blockId || focused.origin !== origin)
      return;
    const length = view.state.doc.length;
    const anchor =
      focused.cursor === 'start'
        ? 0
        : focused.cursor === 'end'
          ? length
          : Math.min(focused.cursor, length);
    view.focus();
    view.dispatch({ selection: { anchor } });
  }, [focused, blockId, origin]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-full',
        variant === 'title' && 'text-lg font-semibold',
        className,
      )}
    />
  );
}
