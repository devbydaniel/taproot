import { IndentDecrease, IndentIncrease } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from './ui/button';

interface Props {
  canIndent: boolean;
  canOutdent: boolean;
  onIndent: () => void;
  onOutdent: () => void;
}

/**
 * Keep a fixed element against the bottom of the visual viewport. Mobile
 * browsers leave the layout viewport behind the software keyboard, so plain
 * `bottom: 0` is not sufficient (notably on iOS Safari).
 */
function useVisualViewportBottomOffset() {
  const measure = () => {
    const viewport = window.visualViewport;
    if (!viewport) return 0;
    return Math.max(
      0,
      Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
    );
  };
  const [offset, setOffset] = useState(measure);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setOffset(measure()));
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return offset;
}

export function MobileBlockToolbar({
  canIndent,
  canOutdent,
  onIndent,
  onOutdent,
}: Props) {
  const isMobile = useIsMobile();
  const bottomOffset = useVisualViewportBottomOffset();

  if (!isMobile) return null;

  const preserveEditorFocus = (event: React.PointerEvent) => {
    event.preventDefault();
  };

  return createPortal(
    <div
      role="toolbar"
      aria-label="Block editing"
      data-mobile-block-toolbar
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur-sm"
      style={{ transform: `translate3d(0, -${bottomOffset}px, 0)` }}
    >
      <div className="mx-auto flex min-h-12 max-w-3xl items-center gap-1 overflow-x-auto px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          className="h-11 px-3"
          disabled={!canOutdent}
          aria-label="Outdent block"
          onPointerDown={preserveEditorFocus}
          onClick={onOutdent}
        >
          <IndentDecrease />
          Outdent
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 px-3"
          disabled={!canIndent}
          aria-label="Indent block"
          onPointerDown={preserveEditorFocus}
          onClick={onIndent}
        >
          <IndentIncrease />
          Indent
        </Button>
      </div>
    </div>,
    document.body,
  );
}
