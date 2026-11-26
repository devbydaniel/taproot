import type { EventContentArg } from '@fullcalendar/core';
import { Check, Repeat, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarEventProps } from '@/lib/calendar';

/** What a calendar event shows: a Google event or a task block. */
export function CalendarEventContent({ arg }: { arg: EventContentArg }) {
  const props = arg.event.extendedProps as CalendarEventProps;
  if (props.kind === 'google')
    return <GoogleEventContent arg={arg} meet={props.meet} />;
  return (
    <TaskEventContent arg={arg} recurring={props.recurring} done={props.done} />
  );
}

/** a Google event: title and time, a camera when it has a Meet call */
function GoogleEventContent({
  arg,
  meet,
}: {
  arg: EventContentArg;
  meet: boolean;
}) {
  return (
    <div className="h-full min-w-0 overflow-hidden px-1 py-0.5 text-xs leading-4">
      <div className="truncate font-medium">
        {meet && (
          <Video
            className="mr-0.5 inline size-3 align-[-2px]"
            strokeWidth={2.25}
            aria-label="Video call"
          />
        )}
        {arg.event.title}
      </div>
      {arg.timeText && (
        <div className="truncate text-muted-foreground">{arg.timeText}</div>
      )}
    </div>
  );
}

/** a task: checkbox, title and time; a done one checked and struck through */
function TaskEventContent({
  arg,
  recurring,
  done,
}: {
  arg: EventContentArg;
  recurring: boolean;
  done: boolean;
}) {
  const action = done ? 'Reopen' : 'Complete';
  return (
    <div className="flex h-full min-w-0 items-start gap-1 overflow-hidden px-1 py-0.5 text-xs leading-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        data-task-checkbox
        title={`${action} task`}
        aria-label={`${action} ${arg.event.title}`}
        className={cn(
          'mt-px flex size-3 shrink-0 items-center justify-center rounded-[3px] border',
          done
            ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground/70'
            : 'border-primary bg-background hover:bg-primary/30',
        )}
      >
        {done && <Check className="size-2.5" strokeWidth={3} />}
      </button>
      <div className={cn('min-w-0', done && 'text-muted-foreground')}>
        <div className={cn('truncate font-medium', done && 'line-through')}>
          {recurring && (
            <Repeat
              className="mr-0.5 inline size-2.5 align-[-1px]"
              strokeWidth={2.5}
            />
          )}
          {arg.event.title}
        </div>
        {arg.timeText && (
          <div className="truncate text-muted-foreground">{arg.timeText}</div>
        )}
      </div>
    </div>
  );
}
