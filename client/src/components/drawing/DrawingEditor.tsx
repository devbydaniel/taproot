import '@excalidraw/excalidraw/index.css';
import { Excalidraw, hashElementsVersion } from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
  NonDeleted,
  OrderedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { Block } from '@taproot/shared';
import { useEffect, useRef, useState } from 'react';
import * as actions from '@/actions';
import { parseScene } from '@/lib/excalidraw';
import { useTheme } from '@/lib/theme';
import { useStore } from '@/store';

const SAVE_DEBOUNCE_MS = 800;

interface PendingScene {
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}

/**
 * Fullscreen Excalidraw editor for one drawing block. This module is the only
 * importer of `@excalidraw/excalidraw` itself (and its CSS), so the whole
 * library stays in a lazy chunk — see DrawingBlock's React.lazy.
 */
export default function DrawingEditor({ block }: { block: Block }) {
  const theme = useTheme();
  // parsed once on mount: while open, this editor is the source of truth
  const [initialScene] = useState(() => parseScene(block.data));

  const pending = useRef<PendingScene | null>(null);
  const saved = useRef({
    version: initialScene ? hashElementsVersion(initialScene.elements) : 0,
    background: initialScene?.appState.viewBackgroundColor,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = () => {
    const scene = pending.current;
    if (!scene) return;
    const version = hashElementsVersion(scene.elements);
    const background = scene.appState.viewBackgroundColor;
    if (
      version === saved.current.version &&
      background === saved.current.background
    ) {
      return;
    }
    saved.current = { version, background };
    const elements = scene.elements.filter(
      (e): e is NonDeleted<ExcalidrawElement> & OrderedExcalidrawElement =>
        !e.isDeleted,
    );
    actions.saveDrawing(
      block.id,
      JSON.stringify({
        elements,
        appState: { viewBackgroundColor: background },
        files: scene.files,
      }),
    );
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // flush the last state even if the editor unmounts without Done
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      persistRef.current();
    },
    [],
  );

  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    persist();
    const { setOpenDrawing, setFocus } = useStore.getState();
    setOpenDrawing(null);
    setFocus({ blockId: block.id, cursor: 'end' });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">
          Drawing
        </span>
        <button
          onClick={close}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Done
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Excalidraw
          initialData={initialScene}
          theme={theme}
          onChange={(elements, appState, files) => {
            pending.current = { elements, appState, files };
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(persist, SAVE_DEBOUNCE_MS);
          }}
        />
      </div>
    </div>
  );
}
