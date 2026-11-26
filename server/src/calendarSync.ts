import type { CalendarBroadcast } from '@taproot/shared';
import { and, asc, gt, lt, ne } from 'drizzle-orm';
import { addDays, berlinDate, berlinMidnight } from './berlinTime.js';
import type { Store } from './db.js';
import {
  GoogleApiError,
  listEvents,
  refreshAccessToken,
  type AccessToken,
  type Fetch,
  type GoogleEvent,
} from './google.js';
import { getCalendarSyncStatus } from './queries.js';
import { calendarEvents, calendarSync } from './schema.js';

// Mirrors one Google calendar into calendar_events, read-only. This module is
// the only writer of calendar_events and calendar_sync — the second
// documented exception to "all writes go through applyOps" (CLAUDE.md): the
// tables are an external cache, not user content.

export const SYNC_INTERVAL_MS = 5 * 60_000;
const DAYS_BACK = 7;
const DAYS_AHEAD = 56;
const MAX_ERROR_LENGTH = 500;

export const CALENDAR_ENV_VARS = {
  clientId: 'TAPROOT_GOOGLE_CLIENT_ID',
  clientSecret: 'TAPROOT_GOOGLE_CLIENT_SECRET',
  refreshToken: 'TAPROOT_GOOGLE_REFRESH_TOKEN',
  calendarId: 'TAPROOT_GOOGLE_CALENDAR_ID',
} as const;

export interface CalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

/**
 * Sync config from the environment; null = sync off. Silent when no
 * credential is set (tasks-only mode is a normal setup); warns once when
 * only some are, since that is a deployment mistake.
 */
export function loadCalendarConfig(
  env: Record<string, string | undefined>,
): CalendarConfig | null {
  const read = (name: string) => env[name]?.trim() ?? '';
  const credentials = {
    clientId: read(CALENDAR_ENV_VARS.clientId),
    clientSecret: read(CALENDAR_ENV_VARS.clientSecret),
    refreshToken: read(CALENDAR_ENV_VARS.refreshToken),
  };
  const missing = (Object.keys(credentials) as (keyof typeof credentials)[])
    .filter((key) => credentials[key] === '')
    .map((key) => CALENDAR_ENV_VARS[key]);
  if (missing.length === 3) return null;
  if (missing.length > 0) {
    console.warn(`calendar sync off: ${missing.join(', ')} not set`);
    return null;
  }
  return {
    ...credentials,
    calendarId: read(CALENDAR_ENV_VARS.calendarId) || 'primary',
  };
}

type EventRow = typeof calendarEvents.$inferInsert;

interface SyncWindow {
  /** epoch ms, inclusive */
  from: number;
  /** epoch ms, exclusive */
  to: number;
}

/** Berlin today −7 days through today +56 days, whole days */
export function syncWindow(now: number): SyncWindow {
  const today = berlinDate(now);
  return {
    from: berlinMidnight(addDays(today, -DAYS_BACK)),
    to: berlinMidnight(addDays(today, DAYS_AHEAD + 1)),
  };
}

/** only http(s) links reach the client, which opens them on click */
function webUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

function eventSpan(
  event: GoogleEvent,
): Pick<EventRow, 'startAt' | 'endAt' | 'allDay'> | null {
  const { start, end } = event;
  if (start?.date && end?.date) {
    return {
      startAt: berlinMidnight(start.date),
      endAt: berlinMidnight(end.date),
      allDay: true,
    };
  }
  if (start?.dateTime && end?.dateTime) {
    const startAt = Date.parse(start.dateTime);
    const endAt = Date.parse(end.dateTime);
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) return null;
    return { startAt, endAt, allDay: false };
  }
  return null;
}

/** The stored projection of a Google event; null = hidden (cancelled, declined, unusable). */
function toEventRow(event: GoogleEvent): EventRow | null {
  if (event.status === 'cancelled') return null;
  const self = event.attendees?.find((attendee) => attendee.self);
  if (self?.responseStatus === 'declined') return null;
  const span = eventSpan(event);
  if (!span || span.endAt < span.startAt) return null;
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video',
  );
  return {
    id: event.id,
    title: event.summary ?? '',
    ...span,
    status: event.status === 'tentative' ? 'tentative' : 'confirmed',
    meetLink: webUrl(event.hangoutLink) ?? webUrl(video?.uri),
    htmlLink: webUrl(event.htmlLink),
  };
}

/** events overlapping the window — the set events.list returns for it */
function overlaps(window: SyncWindow) {
  return and(
    lt(calendarEvents.startAt, window.to),
    gt(calendarEvents.endAt, window.from),
  );
}

function cachedWindow(store: Store, window: SyncWindow) {
  return store.db
    .select()
    .from(calendarEvents)
    .where(overlaps(window))
    .orderBy(asc(calendarEvents.id))
    .all();
}

/**
 * Atomically replace the cached window with the fetched events and record the
 * success. Returns whether the cached events changed.
 */
function replaceWindow(
  store: Store,
  calendarId: string,
  window: SyncWindow,
  rows: EventRow[],
  now: number,
): boolean {
  return store.sqlite.transaction(() => {
    // the calendar id changed since the last sync: the cache is another
    // calendar's, drop it whole
    const foreign = store.db
      .delete(calendarSync)
      .where(ne(calendarSync.calendarId, calendarId))
      .run();
    const wiped =
      foreign.changes > 0 && store.db.delete(calendarEvents).run().changes > 0;

    const before = JSON.stringify(cachedWindow(store, window));
    store.db.delete(calendarEvents).where(overlaps(window)).run();
    for (const row of rows) {
      // an event moved into the window from outside it still has its old row
      store.db
        .insert(calendarEvents)
        .values(row)
        .onConflictDoUpdate({ target: calendarEvents.id, set: row })
        .run();
    }
    const after = JSON.stringify(cachedWindow(store, window));

    store.db
      .insert(calendarSync)
      .values({ calendarId, lastSuccessAt: now, lastError: null })
      .onConflictDoUpdate({
        target: calendarSync.calendarId,
        set: { lastSuccessAt: now, lastError: null, lastErrorAt: null },
      })
      .run();
    return wiped || before !== after;
  })();
}

/** Record a failed attempt; the cached events and lastSuccessAt stay. */
function recordFailure(
  store: Store,
  calendarId: string,
  message: string,
  now: number,
) {
  const lastError = message.slice(0, MAX_ERROR_LENGTH);
  store.db
    .insert(calendarSync)
    .values({ calendarId, lastError, lastErrorAt: now })
    .onConflictDoUpdate({
      target: calendarSync.calendarId,
      set: { lastError, lastErrorAt: now },
    })
    .run();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // fetch wraps network failures: the cause names the actual problem
    const cause =
      error.cause instanceof Error ? `: ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

interface SyncDeps {
  broadcast: (message: CalendarBroadcast) => void;
  fetch?: Fetch;
  now?: () => number;
}

export function createCalendarSync(
  store: Store,
  config: CalendarConfig,
  deps: SyncDeps,
) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  let token: AccessToken | null = null;
  let inFlight: Promise<void> | null = null;
  let loggedError: string | null = null;

  async function accessToken(): Promise<string> {
    if (!token || now() >= token.expiresAt) {
      token = await refreshAccessToken(fetchFn, config, now());
    }
    return token.value;
  }

  async function fetchRows(window: SyncWindow): Promise<EventRow[]> {
    const events = await listEvents(fetchFn, await accessToken(), {
      calendarId: config.calendarId,
      timeMin: window.from,
      timeMax: window.to,
    });
    const rows = new Map<string, EventRow>();
    for (const event of events) {
      const row = toEventRow(event);
      if (row) rows.set(row.id, row);
    }
    return [...rows.values()];
  }

  async function run() {
    const before = getCalendarSyncStatus(store, config.calendarId);
    // computed once: a sync running across midnight replaces exactly the
    // window it asked Google for
    const window = syncWindow(now());
    let changed = false;
    try {
      const rows = await fetchRows(window);
      changed = replaceWindow(store, config.calendarId, window, rows, now());
      if (loggedError !== null) console.info('calendar sync recovered');
      loggedError = null;
    } catch (error) {
      // a revoked/expired access token: mint a fresh one next time
      if (error instanceof GoogleApiError && error.status === 401) token = null;
      const message = errorMessage(error);
      recordFailure(store, config.calendarId, message, now());
      // log a failure once, not every 5 minutes while it persists
      if (message !== loggedError) console.error(`calendar sync: ${message}`);
      loggedError = message;
    }
    const after = getCalendarSyncStatus(store, config.calendarId);
    if (changed || after.state !== before.state) {
      deps.broadcast({ type: 'calendar', status: after });
    }
  }

  /** One sync; concurrent calls share the running one. */
  function sync(): Promise<void> {
    inFlight ??= run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /** Sync now and every SYNC_INTERVAL_MS; returns a stop function. */
  function start(): () => void {
    void sync();
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { sync, start };
}
