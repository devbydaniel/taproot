import { useState, type ReactNode } from 'react';
import { ContentHeader, type Crumb } from '@/components/layout/ContentHeader';

/**
 * shared frame for every route: a scroll viewport inside the inset panel
 * with a sticky blurred header and a centered content column
 */
export type PageSurface = 'main' | 'right';

export function PageShell({
  crumbs,
  actions,
  children,
  surface = 'main',
  onClose,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
  surface?: PageSurface;
  onClose?: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col p-4 pt-0 md:overflow-hidden md:rounded-xl">
      <div
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
      >
        <ContentHeader
          crumbs={crumbs}
          actions={actions}
          scrolled={scrolled}
          showSidebarTrigger={surface === 'main'}
          onClose={onClose}
        />
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-6 md:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}
