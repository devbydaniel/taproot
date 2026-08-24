import {
  dailyDisplayLabel,
  findRecurrence,
  segmentText,
} from '@taproot/shared';
import { Hash, Repeat } from 'lucide-react';
import { useLocation } from 'wouter';
import { api } from '@/lib/api';
import { useRightPane } from '@/lib/rightPane';
import { shouldOpenInRightPane } from '@/lib/rightPaneGesture';
import { cn } from '@/lib/utils';

function faviconUrl(url: string): string | null {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/** External URL as a clickable link, prefixed by the site's favicon when it loads. */
function UrlLink({ url }: { url: string }) {
  const favicon = faviconUrl(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="cursor-pointer break-all text-link hover:underline"
    >
      {favicon && (
        <img
          src={favicon}
          alt=""
          className="mr-1 inline size-4 align-text-bottom"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      )}
      {url}
    </a>
  );
}

/** Plain text run; a <every ...> recurrence token renders as a muted pill, raw text on hover. */
function TextRun({ value }: { value: string }) {
  const recurrence = findRecurrence(value);
  if (!recurrence) return <span>{value}</span>;
  const raw = value.slice(recurrence.from, recurrence.to);
  return (
    <span>
      {value.slice(0, recurrence.from)}
      <span
        title={raw}
        className="mx-0.5 inline-flex select-none items-center gap-1 rounded-sm bg-muted px-1 align-[2px] text-[11px] leading-4 text-muted-foreground/80"
      >
        <Repeat className="h-2.5 w-2.5" strokeWidth={2.5} />
        {raw.slice(1, -1).trim()}
      </span>
      {value.slice(recurrence.to)}
    </span>
  );
}

/** Rendered block text: page references and URLs become clickable, markup hidden. */
export function StaticText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [, navigate] = useLocation();
  const { open } = useRightPane();

  if (text === '') {
    // invisible placeholder keeps empty rows clickable at full height
    return <span className={cn('select-none opacity-0', className)}>·</span>;
  }

  const openPage = async (event: React.MouseEvent, title: string) => {
    const openOnRight = shouldOpenInRightPane(event);
    event.preventDefault();
    event.stopPropagation();
    const page = await api.pageByTitle(title);
    if (openOnRight) open({ kind: 'page', id: page.id });
    else navigate(`/p/${page.id}`);
  };

  return (
    <span className={className}>
      {segmentText(text).map((segment, index) => {
        if (segment.type === 'text')
          return <TextRun key={index} value={segment.value} />;
        if (segment.type === 'url')
          return <UrlLink key={index} url={segment.url} />;
        if (segment.type === 'tag') {
          return (
            <a
              key={index}
              href={`/p/${encodeURIComponent(segment.title)}`}
              onClick={(event) => void openPage(event, segment.title)}
              title={segment.raw}
              className="mx-0.5 inline-flex cursor-pointer select-none items-center gap-0.5 rounded-sm bg-muted px-1 align-[1px] text-[11px] leading-4 text-muted-foreground/80 hover:bg-accent hover:text-accent-foreground"
            >
              <Hash className="h-2.5 w-2.5" strokeWidth={2.5} />
              {segment.title}
            </a>
          );
        }
        // daily links display as Today/Tomorrow/"Wed, Jul 15"; the stored
        // text keeps the ISO title, hover reveals it
        const daily = dailyDisplayLabel(segment.title);
        return (
          <a
            key={index}
            href={`/p/${encodeURIComponent(segment.title)}`}
            onClick={(event) => void openPage(event, segment.title)}
            title={daily ? segment.title : undefined}
            className="cursor-pointer text-link hover:underline"
          >
            {daily ?? segment.title}
          </a>
        );
      })}
    </span>
  );
}
