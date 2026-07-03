import { segmentText } from '@taproot/shared';
import { useLocation } from 'wouter';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Rendered (non-editing) block text: wikilinks become clickable, markup hidden. */
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
