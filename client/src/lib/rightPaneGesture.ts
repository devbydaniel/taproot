interface PointerModifiers {
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Exact Shift + primary-button gesture; other modifiers retain their old behavior. */
export function isRightPaneGesture(event: PointerModifiers): boolean {
  return (
    event.button === 0 &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

/** The right pane is desktop-only; narrow viewports keep existing navigation. */
export function shouldOpenInRightPane(event: PointerModifiers): boolean {
  return (
    isRightPaneGesture(event) && window.matchMedia('(min-width: 768px)').matches
  );
}
