import { isDailyTitle } from '@taproot/shared';
import { Link } from 'wouter';
import { useStore } from '@/store';

export function PagesView() {
  const pages = useStore((s) => s.pages);
  const nonDaily = pages.filter((page) => !isDailyTitle(page.title));

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Pages</h1>
      {nonDaily.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pages yet.</p>
      ) : (
        <ul>
          {nonDaily.map((page) => (
            <li key={page.id}>
              <Link
                href={`/p/${page.id}`}
                className="block truncate rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/60"
              >
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
