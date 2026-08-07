import {
  dailyDisplayLabel,
  daysUntilWeekday,
  formatDailyTitle,
  parseDailyTitle,
  shiftDailyTitle,
  taskDueDate,
  todayTitle,
  type Block,
} from '@taproot/shared';
import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { rescheduleTask } from '@/actions';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Clickable due-date chip on a task row: quick reschedules (Today / Tomorrow /
 * next Monday / Clear) plus a calendar. All picks are text rewrites of the
 * task's first daily link. Pass open/onOpenChange to control the popover from
 * outside (keyboard triage); Escape handling then belongs to the controller.
 */
export function TaskDatePill({
  block,
  open,
  onOpenChange,
}: {
  block: Block;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const dueDate = taskDueDate(block.text);
  const today = todayTitle();
  const overdue = dueDate !== null && dueDate < today;

  const pick = (title: string | null) => {
    setOpen(false);
    rescheduleTask(block.id, title);
  };

  const quick = [
    { label: 'Today', title: today },
    { label: 'Tomorrow', title: shiftDailyTitle(today, 1)! },
    {
      label: 'Next week',
      title: shiftDailyTitle(today, daysUntilWeekday(1, new Date()))!,
    },
  ];

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {dueDate === null ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Schedule"
            className="mt-[1px] shrink-0 text-muted-foreground/50 hover:text-foreground"
          >
            <CalendarPlus />
          </Button>
        ) : (
          <button
            title="Reschedule"
            className={cn(
              'mt-[3px] shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] whitespace-nowrap transition-colors',
              overdue
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {dailyDisplayLabel(dueDate)}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="end"
        onEscapeKeyDown={controlled ? (e) => e.preventDefault() : undefined}
        onCloseAutoFocus={controlled ? (e) => e.preventDefault() : undefined}
      >
        <div className="flex items-center gap-1 border-b p-2">
          {quick.map((option) => (
            <Button
              key={option.label}
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => pick(option.title)}
            >
              {option.label}
            </Button>
          ))}
          {dueDate !== null && (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => pick(null)}
            >
              Clear
            </Button>
          )}
        </div>
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={
            dueDate ? (parseDailyTitle(dueDate) ?? undefined) : undefined
          }
          defaultMonth={
            dueDate ? (parseDailyTitle(dueDate) ?? undefined) : undefined
          }
          onSelect={(date) => {
            if (date) pick(formatDailyTitle(date));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
