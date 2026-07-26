import { useSyncExternalStore } from 'react';

// module-scope open state so the header search button and the palette itself
// can share it without prop-drilling through the route tree (mirrors theme.ts)
let open = false;
const listeners = new Set<() => void>();

export function setPaletteOpen(next: boolean): void {
  open = next;
  for (const l of listeners) l();
}

export function openPalette(): void {
  setPaletteOpen(true);
}

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => open,
  );
}
