import type { YouTubeVideo as YouTubeVideoData } from '@taproot/shared';
import { Youtube } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

/** Right-side disclosure action and on-demand privacy-enhanced YouTube player. */
export function YouTubePreview({ video }: { video: YouTubeVideoData }) {
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const label = open ? 'Hide YouTube preview' : 'Show YouTube preview';

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title={label}
        aria-label={label}
        aria-controls={open ? previewId : undefined}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={cn(
          'absolute top-0 right-0 z-10 text-muted-foreground opacity-100 md:opacity-0 md:group-hover/youtube:opacity-100 focus-visible:opacity-100',
          open && 'bg-accent text-foreground md:opacity-100',
        )}
      >
        <Youtube />
      </Button>
      {open && (
        <div
          id={previewId}
          className="mt-2 aspect-video max-w-2xl overflow-hidden rounded-lg border bg-muted"
        >
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.id}`}
            title="YouTube video player"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      )}
    </>
  );
}
