import { BookOpen, FileText, ListTodo, Sprout } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';

const navItemClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
    active
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-foreground/80 hover:bg-accent/60',
  );

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center gap-2 px-4 pt-5 pb-3">
        <Sprout className="h-5 w-5 text-foreground" />
        <span className="text-lg font-semibold tracking-tight">Taproot</span>
      </div>
      <nav className="px-2 pb-2">
        <Link href="/journal" className={navItemClass(location === '/journal')}>
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
    </aside>
  );
}
