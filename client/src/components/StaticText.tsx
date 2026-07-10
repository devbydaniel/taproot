import { segmentText } from '@taproot/shared';
import { useLocation } from 'wouter';
import { api } from '@/lib/api';
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

/** Rendered (non-editing) block text: wikilinks and URLs become clickable, markup hidden. */
export function StaticText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [, navigate] = useLocation();

  if (text === '') {
    // invisible placeholder keeps empty rows clickable at full height
    return <span className={cn('select-none opacity-0', className)}>·</span>;
  }

  const openPage = async (event: React.MouseEvent, title: string) => {
    event.preventDefault();
    event.stopPropagation();
    const page = await api.pageByTitle(title);
    navigate(`/p/${page.id}`);
  };

  return (
    <span className={className}>
      {segmentText(text).map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : segment.type === 'url' ? (
          <UrlLink key={index} url={segment.url} />
        ) : (
          <a
            key={index}
            href={`/p/${encodeURIComponent(segment.title)}`}
            onClick={(event) => void openPage(event, segment.title)}
            className="cursor-pointer text-link hover:underline"
          >
            {segment.title}
          </a>
        ),
      )}
    </span>
  );
}
