import type { EventInput } from '@fullcalendar/core';
import type {
  CalendarEventsPayload,
  CalendarSyncStatus,
} from '@taproot/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { googleEvent } from '@/lib/calendar';
import { useStore } from '@/store';

/**
 * The server syncs every 5 minutes but only announces changes; refetching on
 * the same beat keeps the shown last-sync time current.
 */
const SYNC_REFRESH_MS = 5 * 60_000;

/** the visible dates, as daily titles; end exclusive */
export interface VisibleRange {
  start: string;
  end: string;
}

/**
 * Synced Google events for the visible range, as calendar events, plus the
 * sync status (null until the first read). Refetched when the range changes,
 * when the server announces a calendar change or the websocket reconnects,
 * and periodically while sync is configured. Reads go through the offline
 * cache, so the last fetched events stay visible offline; a failed read
 * keeps what is shown.
 */
export function useGoogleEvents(range: VisibleRange | null): {
  events: EventInput[];
  status: CalendarSyncStatus | null;
} {
  const calendarEpoch = useStore((s) => s.calendarEpoch);
  const [payload, setPayload] = useState<CalendarEventsPayload | null>(null);
  const [tick, setTick] = useState(0);
  const syncing = payload !== null && payload.status.state !== 'not_configured';
  const start = range?.start;
  const end = range?.end;

  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => setTick((n) => n + 1), SYNC_REFRESH_MS);
    return () => clearInterval(timer);
  }, [syncing]);

  useEffect(() => {
    if (start === undefined || end === undefined) return;
    let cancelled = false;
    api.getCalendarEvents(start, end).then(
      (data) => {
        if (!cancelled) setPayload(data);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [start, end, calendarEpoch, tick]);

  const events = useMemo(
    () => payload?.events.map(googleEvent) ?? [],
    [payload],
  );
  return { events, status: payload?.status ?? null };
}
