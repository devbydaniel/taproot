import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from '@/store';

export type RightPaneTarget =
  | { kind: 'page'; id: string }
  | { kind: 'block'; id: string; revealBlockId?: string };

interface RightPaneContextValue {
  target: RightPaneTarget | null;
  open: (target: RightPaneTarget) => void;
  close: () => void;
}

const RightPaneContext = createContext<RightPaneContextValue | null>(null);

function clearRightPaneFocus() {
  const store = useStore.getState();
  if (store.focused?.origin?.startsWith('right:')) store.setFocus(null);
}

export function RightPaneProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<RightPaneTarget | null>(null);
  const targetBlockExists = useStore(
    (state) =>
      target?.kind !== 'block' || state.blocks[target.id] !== undefined,
  );
  const open = useCallback((next: RightPaneTarget) => {
    clearRightPaneFocus();
    setTarget(next);
  }, []);
  const close = useCallback(() => {
    clearRightPaneFocus();
    setTarget(null);
  }, []);
  useEffect(() => {
    if (!targetBlockExists) close();
  }, [close, targetBlockExists]);

  const value = useMemo(() => ({ target, open, close }), [target, open, close]);

  return (
    <RightPaneContext.Provider value={value}>
      {children}
    </RightPaneContext.Provider>
  );
}

export function useRightPane(): RightPaneContextValue {
  const value = useContext(RightPaneContext);
  if (!value)
    throw new Error('useRightPane must be used inside RightPaneProvider');
  return value;
}
