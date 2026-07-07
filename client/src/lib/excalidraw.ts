import type {
  ExcalidrawElement,
  NonDeleted,
} from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

/**
 * What a drawing block persists in `block.data`: a trimmed Excalidraw scene.
 * Deliberately not the full serialized appState — most of it is ephemeral UI
 * state, and some of it (collaborators) doesn't survive a JSON round-trip.
 */
export interface DrawingScene {
  elements: readonly ExcalidrawElement[];
  appState: { viewBackgroundColor?: string };
  files: BinaryFiles;
}

interface ExportToSvgOpts {
  elements: readonly NonDeleted<ExcalidrawElement>[];
  appState?: Partial<Omit<AppState, 'offsetTop' | 'offsetLeft'>>;
  files: BinaryFiles | null;
  exportPadding?: number;
}

/**
 * The package's d.ts re-exports exportToSvg from '@excalidraw/utils', which
 * it doesn't ship — retype the (real) runtime export here so type-aware lint
 * doesn't see an error type. Signature copied from utils/export.d.ts.
 */
type ExcalidrawModule = Omit<
  typeof import('@excalidraw/excalidraw'),
  'exportToSvg'
> & {
  exportToSvg: (opts: ExportToSvgOpts) => Promise<SVGSVGElement>;
};

/**
 * The single dynamic-import point for Excalidraw (~500 kB gzipped): the
 * chunk only loads once a drawing block is actually on screen.
 */
export function loadExcalidraw(): Promise<ExcalidrawModule> {
  return import('@excalidraw/excalidraw');
}

export function parseScene(data: string | null): DrawingScene | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Partial<DrawingScene>;
    return {
      elements: parsed.elements ?? [],
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
    };
  } catch {
    return null;
  }
}
