import type { CalendarBroadcast, CalendarEventsPayload } from '@taproot/shared';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './app.js';
import { addDays, berlinIso, berlinMidnight } from './berlinTime.js';
import {
  createCalendarSync,
  loadCalendarConfig,
  SYNC_INTERVAL_MS,
  syncWindow,
  type CalendarConfig,
} from './calendarSync.js';
import { createStore, type Store } from './db.js';
import { GOOGLE_TOKEN_URL, type Fetch } from './google.js';
import { mintRefreshToken } from './googleOAuthLoopback.js';
import { getCalendarEvents } from './queries.js';

// Google is never called: a fake fetch answers the token endpoint and
// events.list from in-test state.

const NOW = Date.parse('2026-11-26T09:00:00Z');
const CONFIG: CalendarConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  calendarId: 'primary',
};
const RANGE = { start: '2026-11-01', end: '2027-02-01' };

type GoogleItem = Record<string, unknown>;

interface FakeGoogle {
  fetch: Fetch;
  /** items events.list returns; pages of `pageSize` */
  items: GoogleItem[];
  pageSize: number;
  /** when set, events.list answers with this status */
  eventsStatus: number | null;
  tokenStatus: number | null;
  tokenCalls: number;
  eventsUrls: URL[];
  authHeaders: string[];
}

function fakeGoogle(items: GoogleItem[] = []): FakeGoogle {
  let tokenSerial = 0;
  const fake: FakeGoogle = {
    items,
    pageSize: 2500,
    eventsStatus: null,
    tokenStatus: null,
    tokenCalls: 0,
    eventsUrls: [],
    authHeaders: [],
    fetch: (input, init) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
      );
      if (url.href === GOOGLE_TOKEN_URL) {
        fake.tokenCalls++;
        if (fake.tokenStatus !== null) {
          return Promise.resolve(
            Response.json(
              { error: 'invalid_grant', error_description: 'Token revoked.' },
              { status: fake.tokenStatus },
            ),
          );
        }
        tokenSerial++;
        return Promise.resolve(
          Response.json({
            access_token: `access-${tokenSerial}`,
            expires_in: 3599,
          }),
        );
      }
      fake.eventsUrls.push(url);
      fake.authHeaders.push(
        new Headers(init?.headers).get('Authorization') ?? '',
      );
      if (fake.eventsStatus !== null) {
        return Promise.resolve(
          Response.json(
            { error: { message: 'Backend Error' } },
            { status: fake.eventsStatus },
          ),
        );
      }
      const offset = Number(url.searchParams.get('pageToken') ?? 0);
      const next = offset + fake.pageSize;
      return Promise.resolve(
        Response.json({
          kind: 'calendar#events',
          items: fake.items.slice(offset, next),
          ...(next < fake.items.length ? { nextPageToken: String(next) } : {}),
        }),
      );
    },
  };
  return fake;
}

function timed(id: string, start: string, end: string, extra: GoogleItem = {}) {
  return {
    id,
    status: 'confirmed',
    summary: `Event ${id}`,
    start: { dateTime: start, timeZone: 'Europe/Berlin' },
    end: { dateTime: end, timeZone: 'Europe/Berlin' },
    htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
    ...extra,
  };
}

let store: Store;
let google: FakeGoogle;
let broadcasts: CalendarBroadcast[];
let now: number;

function sync(config = CONFIG) {
  return createCalendarSync(store, config, {
    fetch: google.fetch,
    now: () => now,
    broadcast: (message) => broadcasts.push(message),
  });
}

const events = (calendarId: string | null = 'primary') =>
  getCalendarEvents(store, calendarId, RANGE).events;

beforeEach(() => {
  store = createStore(':memory:');
  google = fakeGoogle();
  broadcasts = [];
  now = NOW;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('berlinTime', () => {
  it('finds Berlin midnight across both DST switches', () => {
    expect(berlinMidnight('2026-03-29')).toBe(Date.parse('2026-03-28T23:00Z'));
    expect(berlinMidnight('2026-03-30')).toBe(Date.parse('2026-03-29T22:00Z'));
    expect(berlinMidnight('2026-10-25')).toBe(Date.parse('2026-10-24T22:00Z'));
    expect(berlinMidnight('2026-10-26')).toBe(Date.parse('2026-10-25T23:00Z'));
  });

  it('formats instants with the Berlin offset', () => {
    expect(berlinIso(Date.parse('2026-11-26T13:00:00Z'))).toBe(
      '2026-11-26T14:00:00+01:00',
    );
    expect(berlinIso(Date.parse('2026-07-01T22:30:00Z'))).toBe(
      '2026-07-02T00:30:00+02:00',
    );
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('spans Berlin today −7 days through today +56 days', () => {
    // 23:30 UTC on the 25th is already the 26th in Berlin
    const window = syncWindow(Date.parse('2026-11-25T23:30:00Z'));
    expect(window.from).toBe(berlinMidnight('2026-11-19'));
    expect(window.to).toBe(berlinMidnight('2027-01-22'));
  });
});

describe('calendar config', () => {
  it('is off and silent without credentials', () => {
    expect(loadCalendarConfig({})).toBeNull();
    expect(
      loadCalendarConfig({
        TAPROOT_GOOGLE_CLIENT_ID: ' ',
        TAPROOT_GOOGLE_CALENDAR_ID: 'x',
      }),
    ).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('warns about a partial config and stays off', () => {
    expect(loadCalendarConfig({ TAPROOT_GOOGLE_CLIENT_ID: 'id' })).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      'calendar sync off: TAPROOT_GOOGLE_CLIENT_SECRET, TAPROOT_GOOGLE_REFRESH_TOKEN not set',
    );
  });

  it('defaults the calendar id to primary', () => {
    const env = {
      TAPROOT_GOOGLE_CLIENT_ID: 'id',
      TAPROOT_GOOGLE_CLIENT_SECRET: 'secret',
      TAPROOT_GOOGLE_REFRESH_TOKEN: 'token',
    };
    expect(loadCalendarConfig(env)?.calendarId).toBe('primary');
    expect(
      loadCalendarConfig({
        ...env,
        TAPROOT_GOOGLE_CALENDAR_ID: 'me@locaboo.com',
      })?.calendarId,
    ).toBe('me@locaboo.com');
  });
});

describe('unconfigured mode', () => {
  it('serves an empty list with status not_configured', async () => {
    const api = createApi(store, () => {});
    const res = await api.request(
      '/calendar/events?start=2026-11-23&end=2026-11-30',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CalendarEventsPayload;
    expect(body).toEqual({
      events: [],
      status: {
        state: 'not_configured',
        lastSuccessAt: null,
        lastError: null,
        lastErrorAt: null,
      },
    });
  });

  it('hides a cache left behind by removed credentials', async () => {
    google.items = [
      timed('a', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00'),
    ];
    await sync().sync();
    expect(events()).toHaveLength(1);
    expect(events(null)).toEqual([]);
  });

  it('rejects malformed ranges', async () => {
    const api = createApi(store, () => {}, 'primary');
    for (const query of [
      '',
      '?start=2026-11-23',
      '?start=2026-11-30&end=2026-11-23',
      '?start=2026-02-30&end=2026-03-02',
      '?start=2026-01-01&end=2028-01-01',
    ]) {
      const res = await api.request(`/calendar/events${query}`);
      expect(res.status, query).toBe(400);
    }
  });
});

describe('calendar sync', () => {
  it('stores timed events in Europe/Berlin and serves them by range', async () => {
    google.items = [
      timed('a', '2026-11-26T13:00:00Z', '2026-11-26T14:00:00Z', {
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
      }),
      timed('b', '2026-12-03T09:00:00+01:00', '2026-12-03T09:30:00+01:00', {
        status: 'tentative',
      }),
    ];
    await sync().sync();

    const api = createApi(store, () => {}, 'primary');
    const res = await api.request(
      '/calendar/events?start=2026-11-26&end=2026-11-27',
    );
    const body = (await res.json()) as CalendarEventsPayload;
    expect(body.events).toEqual([
      {
        id: 'a',
        title: 'Event a',
        start: '2026-11-26T14:00:00+01:00',
        end: '2026-11-26T15:00:00+01:00',
        allDay: false,
        status: 'confirmed',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        htmlLink: 'https://www.google.com/calendar/event?eid=a',
      },
    ]);
    expect(body.status).toEqual({
      state: 'ok',
      lastSuccessAt: NOW,
      lastError: null,
      lastErrorAt: null,
    });
    expect(events().map((e) => [e.id, e.status])).toEqual([
      ['a', 'confirmed'],
      ['b', 'tentative'],
    ]);
  });

  it('asks for the window with recurring events expanded', async () => {
    await sync().sync();
    const params = google.eventsUrls[0]?.searchParams;
    expect(google.eventsUrls[0]?.pathname).toBe(
      '/calendar/v3/calendars/primary/events',
    );
    expect(params?.get('singleEvents')).toBe('true');
    expect(params?.get('timeMin')).toBe('2026-11-18T23:00:00.000Z');
    expect(params?.get('timeMax')).toBe('2027-01-21T23:00:00.000Z');
    expect(google.authHeaders[0]).toBe('Bearer access-1');
  });

  it('hides declined and cancelled events', async () => {
    google.items = [
      timed('kept', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00', {
        attendees: [
          { email: 'other@example.com', responseStatus: 'declined' },
          { email: 'me@example.com', self: true, responseStatus: 'accepted' },
        ],
      }),
      timed(
        'declined',
        '2026-11-26T12:00:00+01:00',
        '2026-11-26T13:00:00+01:00',
        {
          attendees: [
            { email: 'me@example.com', self: true, responseStatus: 'declined' },
          ],
        },
      ),
      timed(
        'cancelled',
        '2026-11-27T12:00:00+01:00',
        '2026-11-27T13:00:00+01:00',
        {
          status: 'cancelled',
        },
      ),
      // cancelled recurring instances arrive with nothing but id and status
      { id: 'series_20261128T090000Z', status: 'cancelled' },
    ];
    await sync().sync();
    expect(events().map((e) => e.id)).toEqual(['kept']);
  });

  it('keeps all-day events as Berlin dates', async () => {
    google.items = [
      {
        id: 'holiday',
        status: 'confirmed',
        summary: '1. Weihnachtstag',
        start: { date: '2026-12-25' },
        end: { date: '2026-12-26' },
      },
      {
        id: 'vacation',
        status: 'confirmed',
        summary: 'Urlaub',
        start: { date: '2026-12-28' },
        end: { date: '2027-01-02' },
      },
    ];
    await sync().sync();
    expect(events()).toEqual([
      expect.objectContaining({
        id: 'holiday',
        start: '2026-12-25',
        end: '2026-12-26',
        allDay: true,
        meetLink: null,
        htmlLink: null,
      }),
      expect.objectContaining({
        id: 'vacation',
        start: '2026-12-28',
        end: '2027-01-02',
        allDay: true,
      }),
    ]);
    // the holiday is part of the 25th only
    const day = getCalendarEvents(store, 'primary', {
      start: '2026-12-26',
      end: '2026-12-27',
    });
    expect(day.events).toEqual([]);
  });

  it('replaces the window: deleted events go, moved events follow', async () => {
    const outside = timed(
      'old',
      '2026-11-02T10:00:00+01:00',
      '2026-11-02T11:00:00+01:00',
    );
    google.items = [
      outside,
      timed('stays', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00'),
      timed(
        'deleted',
        '2026-11-27T10:00:00+01:00',
        '2026-11-27T11:00:00+01:00',
      ),
    ];
    await sync().sync(); // the fake ignores the window: 'old' lands in the cache
    expect(events().map((e) => e.id)).toEqual(['old', 'stays', 'deleted']);
    expect(broadcasts).toHaveLength(1);

    // 'deleted' is gone in Google, 'old' was moved into the window
    google.items = [
      timed('old', '2026-11-30T10:00:00+01:00', '2026-11-30T11:00:00+01:00'),
      timed('stays', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00'),
    ];
    await sync().sync();
    expect(events().map((e) => [e.id, e.start])).toEqual([
      ['stays', '2026-11-26T10:00:00+01:00'],
      ['old', '2026-11-30T10:00:00+01:00'],
    ]);
    expect(broadcasts).toHaveLength(2);
  });

  it('keeps events before the window that Google no longer returns', async () => {
    google.items = [
      timed('past', '2026-11-20T10:00:00+01:00', '2026-11-20T11:00:00+01:00'),
    ];
    await sync().sync();
    // two weeks later the event has dropped out of the window
    now = NOW + 14 * 86_400_000;
    google.items = [];
    await sync().sync();
    expect(events().map((e) => e.id)).toEqual(['past']);
  });

  it('broadcasts only when the cached events change', async () => {
    google.items = [
      timed('a', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00'),
    ];
    const calendar = sync();
    await calendar.sync();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      type: 'calendar',
      status: { state: 'ok' },
    });
    now += SYNC_INTERVAL_MS;
    await calendar.sync();
    expect(broadcasts).toHaveLength(1);
    google.items = [
      timed('a', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00', {
        summary: 'Renamed',
      }),
    ];
    await calendar.sync();
    expect(broadcasts).toHaveLength(2);
    expect(events()[0]?.title).toBe('Renamed');
  });

  it('follows nextPageToken', async () => {
    google.pageSize = 2;
    google.items = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      timed(id, `2026-11-2${i}T10:00:00+01:00`, `2026-11-2${i}T11:00:00+01:00`),
    );
    await sync().sync();
    expect(events()).toHaveLength(5);
    expect(google.eventsUrls).toHaveLength(3);
  });

  it('keeps the cache and records the error when a sync fails', async () => {
    google.items = [
      timed('a', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00'),
    ];
    const calendar = sync();
    await calendar.sync();

    google.items = [];
    google.eventsStatus = 503;
    now += SYNC_INTERVAL_MS;
    await calendar.sync();
    await calendar.sync();

    const payload = getCalendarEvents(store, 'primary', RANGE);
    expect(payload.events.map((e) => e.id)).toEqual(['a']);
    expect(payload.status).toEqual({
      state: 'error',
      lastSuccessAt: NOW,
      lastError: 'events.list failed: HTTP 503: Backend Error',
      lastErrorAt: NOW + SYNC_INTERVAL_MS,
    });
    // the state change is broadcast once; a repeated failure is logged once
    expect(broadcasts.map((b) => b.status.state)).toEqual(['ok', 'error']);
    expect(console.error).toHaveBeenCalledTimes(1);

    google.eventsStatus = null;
    await calendar.sync();
    expect(getCalendarEvents(store, 'primary', RANGE).events).toEqual([]);
    expect(syncStatus()).toMatchObject({
      state: 'ok',
      lastError: null,
    });
    expect(broadcasts.at(-1)?.status.state).toBe('ok');
  });

  it('records a failed first sync and a failed token refresh', async () => {
    google.tokenStatus = 400;
    await sync().sync();
    const status = syncStatus();
    expect(status).toMatchObject({ state: 'error', lastSuccessAt: null });
    expect(status.lastError).toBe(
      'token refresh failed: HTTP 400: invalid_grant (Token revoked.)',
    );
    expect(status.lastError).not.toContain('refresh-token');
    expect(google.eventsUrls).toHaveLength(0);
  });

  it('records network failures', async () => {
    const offline: Fetch = () =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'),
        }),
      );
    await createCalendarSync(store, CONFIG, {
      fetch: offline,
      now: () => now,
      broadcast: () => {},
    }).sync();
    expect(syncStatus().lastError).toBe(
      'fetch failed: getaddrinfo ENOTFOUND oauth2.googleapis.com',
    );
  });

  it('reuses the access token until it expires, and drops it on 401', async () => {
    const calendar = sync();
    await calendar.sync();
    now += SYNC_INTERVAL_MS;
    await calendar.sync();
    expect(google.tokenCalls).toBe(1);

    google.eventsStatus = 401;
    await calendar.sync();
    google.eventsStatus = null;
    await calendar.sync();
    expect(google.tokenCalls).toBe(2);
    expect(google.authHeaders.at(-1)).toBe('Bearer access-2');

    now += 3600_000;
    await calendar.sync();
    expect(google.tokenCalls).toBe(3);
  });

  it('runs overlapping sync calls once', async () => {
    const calendar = sync();
    await Promise.all([calendar.sync(), calendar.sync()]);
    expect(google.eventsUrls).toHaveLength(1);
  });

  it('syncs at start and every five minutes', async () => {
    vi.useFakeTimers();
    const stop = sync().start();
    await vi.advanceTimersByTimeAsync(0);
    expect(google.eventsUrls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(google.eventsUrls).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(google.eventsUrls).toHaveLength(2);
  });

  it('drops the cache of a previously synced calendar', async () => {
    google.items = [
      timed('a', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00'),
    ];
    await sync().sync();
    const other = { ...CONFIG, calendarId: 'other@example.com' };
    // before its first success the new calendar shows nothing
    expect(events(other.calendarId)).toEqual([]);
    google.items = [];
    await sync(other).sync();
    expect(events(other.calendarId)).toEqual([]);
    expect(events('primary')).toEqual([]);
  });
});

describe('stored data', () => {
  it('persists only the listed fields', async () => {
    google.items = [
      timed('a', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00', {
        description: 'SECRET-DESCRIPTION',
        location: 'SECRET-LOCATION',
        creator: { email: 'SECRET-CREATOR@example.com' },
        organizer: { email: 'SECRET-ORGANIZER@example.com' },
        attendees: [
          { email: 'SECRET-ATTENDEE@example.com', responseStatus: 'accepted' },
          { email: 'me@example.com', self: true, responseStatus: 'accepted' },
        ],
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+49-SECRET-PIN' },
            { entryPointType: 'video', uri: 'https://meet.google.com/xyz' },
          ],
          conferenceSolution: { name: 'SECRET-SOLUTION' },
        },
        extendedProperties: { private: { note: 'SECRET-PROPERTY' } },
      }),
    ];
    await sync().sync();

    const rows = store.sqlite
      .prepare('SELECT * FROM calendar_events')
      .all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'all_day',
        'end_at',
        'html_link',
        'id',
        'meet_link',
        'start_at',
        'status',
        'title',
      ].sort(),
    );
    expect(rows[0]?.meet_link).toBe('https://meet.google.com/xyz');
    const dump =
      JSON.stringify(
        store.sqlite.prepare('SELECT * FROM calendar_sync').all(),
      ) + JSON.stringify(rows);
    expect(dump).not.toContain('SECRET');
    expect(dump).not.toContain('me@example.com');
    // and Google is asked for the needed fields only
    expect(google.eventsUrls[0]?.searchParams.get('fields')).not.toContain(
      'description',
    );
  });

  it('drops links that are not web URLs', async () => {
    google.items = [
      timed('a', '2026-11-26T10:00:00+01:00', '2026-11-26T11:00:00+01:00', {
        hangoutLink: 'javascript:alert(1)',
        htmlLink: 'not a url',
      }),
    ];
    await sync().sync();
    expect(events()[0]).toMatchObject({ meetLink: null, htmlLink: null });
  });
});

describe('refresh token minting', () => {
  it('runs the loopback flow with PKCE and returns the refresh token', async () => {
    let tokenRequest: URLSearchParams | null = null;
    const fakeFetch: Fetch = (_input, init) => {
      tokenRequest = new URLSearchParams(init?.body as string);
      return Promise.resolve(
        Response.json({ access_token: 'a', refresh_token: 'minted-token' }),
      );
    };
    let authUrl: URL | null = null;
    const minted = mintRefreshToken({
      client: { clientId: 'cid', clientSecret: 'csecret' },
      fetch: fakeFetch,
      onAuthUrl: (url) => {
        authUrl = new URL(url);
      },
    });
    await vi.waitFor(() => expect(authUrl).not.toBeNull());
    const params = (authUrl as unknown as URL).searchParams;
    expect(params.get('scope')).toBe(
      'https://www.googleapis.com/auth/calendar.readonly',
    );
    expect(params.get('access_type')).toBe('offline');
    const redirect = params.get('redirect_uri') ?? '';
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // a redirect with a foreign state is ignored
    const forged = await fetch(`${redirect}/?code=evil&state=forged`);
    expect(forged.status).toBe(400);
    expect(tokenRequest).toBeNull();

    const res = await fetch(
      `${redirect}/?code=the-code&state=${params.get('state')}`,
    );
    expect(res.status).toBe(200);
    await expect(minted).resolves.toBe('minted-token');

    const sent = tokenRequest as unknown as URLSearchParams;
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('the-code');
    expect(sent.get('client_secret')).toBe('csecret');
    expect(sent.get('redirect_uri')).toBe(redirect);
    const challenge = createHash('sha256')
      .update(sent.get('code_verifier') ?? '')
      .digest('base64url');
    expect(params.get('code_challenge')).toBe(challenge);
  });

  it('fails when consent is denied', async () => {
    let redirect = '';
    let state = '';
    const minted = mintRefreshToken({
      client: { clientId: 'cid', clientSecret: 'csecret' },
      fetch: () => Promise.reject(new Error('must not exchange')),
      onAuthUrl: (url) => {
        const params = new URL(url).searchParams;
        redirect = params.get('redirect_uri') ?? '';
        state = params.get('state') ?? '';
      },
    });
    // subscribe before the rejection happens
    const outcome = expect(minted).rejects.toThrow(
      'authorization failed: access_denied',
    );
    await vi.waitFor(() => expect(redirect).not.toBe(''));
    const res = await fetch(`${redirect}/?error=access_denied&state=${state}`);
    expect(res.status).toBe(400);
    await outcome;
  });
});

function syncStatus() {
  return getCalendarEvents(store, 'primary', RANGE).status;
}
