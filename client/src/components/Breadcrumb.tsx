import { segmentText, type Block, type Page } from '@taproot/shared';
import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';

function renderedPreview(block: Block, max = 40): string {
  if (block.kind === 'drawing') return 'Drawing';
  const rendered = segmentText(block.text)
    .map((segment) =>
      segment.type === 'text'
        ? segment.value
        : segment.type === 'url'
          ? segment.url
          : segment.title,
    )
    .join('');
  if (rendered.trim() === '') return 'Untitled';
  return rendered.length > max ? `${rendered.slice(0, max)}…` : rendered;
}

/** Page › ancestor › ancestor trail; the page links to /p/:id, ancestors zoom to /b/:id. */
export function Breadcrumb({
  page,
  ancestors,
  className,
}: {
  page: Page;
  ancestors: Block[];
  className?: string;
}) {
  return (
    <nav
      className={cn(
        'flex flex-wrap items-center gap-1 text-sm text-muted-foreground',
        className,
      )}
    >
      <Link
        href={`/p/${page.id}`}
        className="hover:text-foreground hover:underline"
      >
        {page.title}
      </Link>
      {ancestors.map((ancestor) => (
        <Fragment key={ancestor.id}>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link
            href={`/b/${ancestor.id}`}
            className="hover:text-foreground hover:underline"
          >
            {renderedPreview(ancestor)}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
