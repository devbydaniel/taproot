import { isDailyTitle } from '@taproot/shared';
import { FileText } from 'lucide-react';
import { Link } from 'wouter';
import { useStore } from '@/store';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function PagesView() {
  const pages = useStore((s) => s.pages);
  const nonDaily = pages.filter((page) => !isDailyTitle(page.title));

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="mb-8 flex items-baseline gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Pages</h1>
        <span className="text-sm text-muted-foreground">
          {nonDaily.length} {nonDaily.length === 1 ? 'page' : 'pages'}
        </span>
      </div>
      {nonDaily.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pages yet — create one from the sidebar or link it with
          [[brackets]].
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {nonDaily.map((page) => (
            <li key={page.id}>
              <Link
                href={`/p/${page.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {page.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dateFormat.format(page.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
