import {
  BookOpen,
  FileText,
  ListTodo,
  Moon,
  PinOff,
  Sprout,
  Sun,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { togglePagePinned } from '@/actions';
import { toggleTheme, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

const navItemClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
    active
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-foreground/80 hover:bg-accent/60',
  );

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [location] = useLocation();
  const theme = useTheme();
  const pages = useStore((s) => s.pages);
  const pinned = pages
    .filter((p) => p.pinnedOrderKey !== null)
    .sort((a, b) => a.pinnedOrderKey!.localeCompare(b.pinnedOrderKey!));

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          // mobile: overlay drawer; ≥md: the original static column
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r',
          'bg-background transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
          'md:static md:translate-x-0 md:bg-muted/30 md:transition-none',
        )}
      >
        <div className="flex items-center gap-2 px-4 pt-5 pb-3">
          <Sprout className="h-5 w-5 text-foreground" />
          <span className="text-lg font-semibold tracking-tight">Taproot</span>
        </div>
        <nav className="px-2 pb-2">
          <Link
            href="/journal"
            className={navItemClass(location === '/journal')}
          >
            <BookOpen className="h-4 w-4" />
            Journal
          </Link>
          <Link href="/pages" className={navItemClass(location === '/pages')}>
            <FileText className="h-4 w-4" />
            Pages
          </Link>
          <Link href="/tasks" className={navItemClass(location === '/tasks')}>
            <ListTodo className="h-4 w-4" />
            Tasks
          </Link>
        </nav>
        {pinned.length > 0 && (
          <nav className="px-2 pb-2">
            <div className="px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Pinned
            </div>
            {pinned.map((page) => (
              <Link
                key={page.id}
                href={`/p/${page.id}`}
                className={cn(
                  'group',
                  navItemClass(location === `/p/${page.id}`),
                )}
              >
                <span className="min-w-0 flex-1 truncate">{page.title}</span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    togglePagePinned(page.id);
                  }}
                  title="Unpin"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
                >
                  <PinOff className="h-3.5 w-3.5" />
                </button>
              </Link>
            ))}
          </nav>
        )}
        <div className="mt-auto px-2 pb-3">
          <button onClick={toggleTheme} className={navItemClass(false)}>
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>
    </>
  );
}
