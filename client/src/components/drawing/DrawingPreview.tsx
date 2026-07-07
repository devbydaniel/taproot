import type {
  ExcalidrawElement,
  NonDeleted,
} from '@excalidraw/excalidraw/element/types';
import { useEffect, useRef, useState } from 'react';
import { loadExcalidraw, parseScene } from '@/lib/excalidraw';
import { useTheme } from '@/lib/theme';

type PreviewState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'ready'; svg: SVGSVGElement };

/**
 * Static SVG render of a drawing's scene. A live Excalidraw canvas per block
 * would be far too heavy for outline views — the SVG re-exports in
 * milliseconds whenever `data` changes (local save or remote broadcast).
 */
export function DrawingPreview({ data }: { data: string | null }) {
  const theme = useTheme();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = parseScene(data);
    const visible =
      scene?.elements.filter(
        (e): e is NonDeleted<ExcalidrawElement> => !e.isDeleted,
      ) ?? [];
    if (!scene || visible.length === 0) {
      setState({ status: 'empty' });
      return;
    }
    let cancelled = false;
    void loadExcalidraw()
      .then(({ exportToSvg }) =>
        exportToSvg({
          elements: visible,
          appState: {
            ...scene.appState,
            exportWithDarkMode: theme === 'dark',
          },
          files: scene.files,
          exportPadding: 12,
        }),
      )
      .then((svg) => {
        if (!cancelled) setState({ status: 'ready', svg });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'empty' });
      });
    return () => {
      cancelled = true;
    };
  }, [data, theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (state.status !== 'ready') {
      container.replaceChildren();
      return;
    }
    const { svg } = state;
    svg.style.maxWidth = '100%';
    svg.style.height = 'auto';
    container.replaceChildren(svg);
  }, [state]);

  if (state.status !== 'ready') {
    return (
      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
        {state.status === 'loading'
          ? 'Loading drawing…'
          : 'Empty drawing — double-click to draw'}
      </div>
    );
  }
  return <div ref={containerRef} className="flex justify-center" />;
}
