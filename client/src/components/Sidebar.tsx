import { isDailyTitle, todayTitle } from '@taproot/shared';
import { BookOpen, CalendarDays, ListTodo, Plus, Sprout } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

const navItemClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
    active
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-foreground/80 hover:bg-accent/60',
  );

export function Sidebar() {
  const pages = useStore((s) => s.pages);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const [location, navigate] = useLocation();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    void api.listPages().then((list) => useStore.getState().setPages(list));
  }, [remoteEpoch, location]);

  const createPage = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    const page = await api.pageByTitle(title);
    setDraft('');
    navigate(`/p/${page.id}`);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center gap-2 px-4 pt-5 pb-3">
        <Sprout className="h-5 w-5 text-foreground" />
        <span className="text-lg font-semibold tracking-tight">Taproot</span>
      </div>
      <form
        onSubmit={(event) => void createPage(event)}
        className="flex gap-1.5 px-3 pb-3"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New page…"
          className="h-8 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        />
        <button
          type="submit"
          title="Create page"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </form>
      <nav className="px-2 pb-2">
        <button
          onClick={() => {
            // recomputed per click so an open app survives midnight
            void api
              .pageByTitle(todayTitle())
              .then((page) => navigate(`/p/${page.id}`));
          }}
          className={navItemClass(false)}
        >
          <CalendarDays className="h-4 w-4" />
          Today
        </button>
        <Link href="/journal" className={navItemClass(location === '/journal')}>
          <BookOpen className="h-4 w-4" />
          Journal
        </Link>
        <Link href="/tasks" className={navItemClass(location === '/tasks')}>
          <ListTodo className="h-4 w-4" />
          Tasks
        </Link>
      </nav>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Pages
        </p>
        {pages
          .filter((page) => !isDailyTitle(page.title))
          .map((page) => {
            const href = `/p/${page.id}`;
            const active = location === href;
            return (
              <Link
                key={page.id}
                href={href}
                className={cn(
                  'block truncate rounded-md px-2 py-1 text-sm transition-colors',
                  active
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/60',
                )}
              >
                {page.title}
              </Link>
            );
          })}
      </nav>
    </aside>
  );
}
