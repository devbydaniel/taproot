import type { EventContentArg } from '@fullcalendar/core';
import { Repeat, Video } from 'lucide-react';
import type { CalendarEventProps } from '@/lib/calendar';

/** What a calendar event shows: a Google event or a task block. */
export function CalendarEventContent({ arg }: { arg: EventContentArg }) {
  const props = arg.event.extendedProps as CalendarEventProps;
  if (props.kind === 'google')
    return <GoogleEventContent arg={arg} meet={props.meet} />;
  return <TaskEventContent arg={arg} recurring={props.recurring} />;
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

function TaskEventContent({
  arg,
  recurring,
}: {
  arg: EventContentArg;
  recurring: boolean;
}) {
  return (
    <div className="flex h-full min-w-0 items-start gap-1 overflow-hidden px-1 py-0.5 text-xs leading-4">
      <button
        type="button"
        data-task-checkbox
        title="Complete task"
        aria-label={`Complete ${arg.event.title}`}
        className="mt-px size-3 shrink-0 rounded-[3px] border border-primary bg-background hover:bg-primary/30"
      />
      <div className="min-w-0">
        <div className="truncate font-medium">
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
