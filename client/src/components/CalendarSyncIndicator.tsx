import type { CalendarSyncStatus } from '@taproot/shared';
import { CalendarCheck, CalendarClock, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatSyncTime } from '@/lib/calendar';
import { cn } from '@/lib/utils';

/**
 * Google calendar sync state: when it last synced, and a warning when the
 * last attempt failed (the cached events stay). Tap or click for the details.
 * Renders nothing while sync is not configured.
 */
export function CalendarSyncIndicator({
  status,
}: {
  status: CalendarSyncStatus | null;
}) {
  if (!status || status.state === 'not_configured') return null;
  const failed = status.state === 'error';
  const { label, detail, Icon } = summary(status);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          data-sync-state={status.state}
          title={`Google Calendar: ${detail}`}
          aria-label={`Google Calendar: ${detail}`}
          className={cn(
            'text-muted-foreground',
            failed && 'text-destructive hover:text-destructive',
          )}
        >
          <Icon />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-1 p-3 text-sm">
        <p className="font-medium">Google Calendar</p>
        {failed && <SyncFailure status={status} />}
        <p className="text-muted-foreground">
          {status.lastSuccessAt === null
            ? 'Not synced yet'
            : `Last successful sync ${formatSyncTime(status.lastSuccessAt)}`}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** the header button's label, its longer accessible form, and icon */
function summary(status: CalendarSyncStatus) {
  const time =
    status.lastSuccessAt === null ? null : formatSyncTime(status.lastSuccessAt);
  if (status.state === 'error') {
    // the warning icon carries the failure; the text says how stale it is
    const label = time ? `Last synced ${time}` : 'Sync failed';
    const detail = time ? `Sync failed; last synced ${time}` : label;
    return { label, detail, Icon: TriangleAlert };
  }
  const label = time ? `Synced ${time}` : 'Not synced yet';
  return { label, detail: label, Icon: time ? CalendarCheck : CalendarClock };
}

function SyncFailure({ status }: { status: CalendarSyncStatus }) {
  return (
    <p className="text-destructive">
      Last sync failed
      {status.lastErrorAt !== null &&
        ` at ${formatSyncTime(status.lastErrorAt)}`}
      {status.lastError && (
        <span className="block text-xs break-words text-muted-foreground">
          {status.lastError}
        </span>
      )}
    </p>
  );
}
