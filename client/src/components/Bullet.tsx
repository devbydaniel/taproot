import { Link } from 'wouter';
import { cn } from '@/lib/utils';

/**
 * outline bullet: a dot that links to the block's zoom view; collapsed
 * blocks get the larger ringed dot (geometry tokens live in index.css)
 */
export function BulletLink({
  href,
  title = 'Zoom to block',
  collapsed = false,
}: {
  href: string;
  title?: string;
  collapsed?: boolean;
}) {
  return (
    <Link
      href={href}
      title={title}
      className="mt-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent"
    >
      <span
        className={cn(
          'block rounded-full bg-muted-foreground/70 transition-all group-hover:bg-foreground/80',
          collapsed
            ? 'size-bullet-dot-lg ring-3 ring-muted'
            : 'size-bullet-dot',
        )}
      />
    </Link>
  );
}
