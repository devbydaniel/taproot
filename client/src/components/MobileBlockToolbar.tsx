import {
  IndentDecrease,
  IndentIncrease,
  Link,
  SquareCheck,
} from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  canIndent: boolean;
  canOutdent: boolean;
  onIndent: () => void;
  onOutdent: () => void;
  onAddTodo: () => void;
  onInsertPageRef: () => void;
}

/** Mobile-only actions in document flow, directly below the active block. */
export function MobileBlockToolbar({
  canIndent,
  canOutdent,
  onIndent,
  onOutdent,
  onAddTodo,
  onInsertPageRef,
}: Props) {
  const preserveEditorFocus = (event: React.PointerEvent) => {
    event.preventDefault();
  };

  return (
    <div
      role="toolbar"
      aria-label="Block editing"
      data-mobile-block-toolbar
      className="mt-1 flex cursor-default flex-wrap items-center gap-1 rounded-md bg-muted/50 p-1 md:hidden"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        disabled={!canOutdent}
        aria-label="Outdent block"
        title="Outdent block"
        onPointerDown={preserveEditorFocus}
        onClick={onOutdent}
      >
        <IndentDecrease />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        disabled={!canIndent}
        aria-label="Indent block"
        title="Indent block"
        onPointerDown={preserveEditorFocus}
        onClick={onIndent}
      >
        <IndentIncrease />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label="Mark block as TODO"
        title="Mark block as TODO"
        onPointerDown={preserveEditorFocus}
        onClick={onAddTodo}
      >
        <SquareCheck />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label="Insert page reference"
        title="Insert page reference"
        onPointerDown={preserveEditorFocus}
        onClick={onInsertPageRef}
      >
        <Link />
      </Button>
    </div>
  );
}
