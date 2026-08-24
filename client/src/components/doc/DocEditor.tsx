import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Block } from '@taproot/shared';
import { useEffect, useRef, useState } from 'react';
import * as actions from '@/actions';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';

const SAVE_DEBOUNCE_MS = 800;

// CSS-variable tokens from index.css, so both themes work without switching
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: 'var(--foreground)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--primary)' },
  { tag: tags.url, color: 'var(--primary)' },
  { tag: tags.monospace, color: 'var(--accent-foreground)' },
  { tag: tags.quote, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--foreground)' },
  { tag: tags.meta, color: 'var(--muted-foreground)' },
  { tag: tags.processingInstruction, color: 'var(--muted-foreground)' },
]);

// spacing lives on the wrapper div: index.css's `.cm-editor .cm-content`
// reset (padding: 0, line-height: inherit) out-ranks theme-injected rules,
// so .cm-content styles set here would be silently overridden
const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '0.9375rem', lineHeight: '1.7' },
  '.cm-scroller': { overflow: 'auto' },
});

/**
 * Fullscreen markdown editor for one doc block. This module is the only
 * importer of `@codemirror/lang-markdown` (and its highlight deps), so they
 * stay in a lazy chunk — see DocBlock's React.lazy.
 */
export default function DocEditor({
  block,
  origin,
}: {
  block: Block;
  origin?: string;
}) {
  // captured once on mount: while open, this editor is the source of truth.
  // Remote ops (e.g. a PUT /api/docs) update the store but not the open
  // editor; the next debounced save last-writer-wins, like DrawingEditor.
  const [initialDoc] = useState(() => block.data ?? '');
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const pending = useRef<string | null>(null);
  const lastSaved = useRef(initialDoc);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = () => {
    const markdown = pending.current;
    if (markdown === null || markdown === lastSaved.current) return;
    lastSaved.current = markdown;
    actions.saveDoc(block.id, markdown);
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    persist();
    const { setOpenDoc, setFocus } = useStore.getState();
    setOpenDoc(null);
    setFocus({ blockId: block.id, cursor: 'end', origin });
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          Prec.highest(
            keymap.of([
              { key: 'Escape', run: () => (closeRef.current(), true) },
            ]),
          ),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            pending.current = update.state.doc.toString();
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(
              () => persistRef.current(),
              SAVE_DEBOUNCE_MS,
            );
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;
    view.focus();

    // flush the last state even if the editor unmounts without Done
    return () => {
      if (timer.current) clearTimeout(timer.current);
      persistRef.current();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: the open editor owns the doc
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">
          Document
        </span>
        <Button size="sm" onClick={close}>
          Done
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={containerRef}
          className="mx-auto h-full w-full max-w-3xl px-6 pt-14 pb-6"
        />
      </div>
    </div>
  );
}
