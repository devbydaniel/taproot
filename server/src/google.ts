import { z } from 'zod';

// Google OAuth + Calendar REST, read-only. Every response is validated at this
// boundary; error messages carry Google's status and error code, never tokens.

export const CALENDAR_READONLY_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const REQUEST_TIMEOUT_MS = 30_000;
// 2500 per page (Google's max) × 40 pages is far beyond a 9-week window;
// the cap only stops a runaway pagination loop
const MAX_PAGES = 40;

export type Fetch = typeof fetch;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
});

const oauthErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

const apiErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});

const eventTimeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
});

// only what the sync reads; z.object strips everything else
const googleEventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  start: eventTimeSchema.optional(),
  end: eventTimeSchema.optional(),
  hangoutLink: z.string().optional(),
  htmlLink: z.string().optional(),
  conferenceData: z
    .object({
      entryPoints: z
        .array(
          z.object({
            entryPointType: z.string().optional(),
            uri: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  attendees: z
    .array(
      z.object({
        self: z.boolean().optional(),
        responseStatus: z.string().optional(),
      }),
    )
    .optional(),
});

export type GoogleEvent = z.infer<typeof googleEventSchema>;

const eventsPageSchema = z.object({
  items: z.array(googleEventSchema).optional(),
  nextPageToken: z.string().optional(),
});

// partial response: ask Google only for the fields above
const EVENT_FIELDS =
  'nextPageToken,items(id,status,summary,start,end,hangoutLink,htmlLink,' +
  'conferenceData/entryPoints(entryPointType,uri),attendees(self,responseStatus))';

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function failure(what: string, response: Response) {
  const body = await readJson(response);
  const oauth = oauthErrorSchema.safeParse(body);
  const api = apiErrorSchema.safeParse(body);
  const detail = oauth.success
    ? `: ${oauth.data.error}${oauth.data.error_description ? ` (${oauth.data.error_description})` : ''}`
    : api.success
      ? `: ${api.data.error.message}`
      : '';
  return new GoogleApiError(
    `${what} failed: HTTP ${response.status}${detail}`,
    response.status,
  );
}

async function postToken(
  fetchFn: Fetch,
  what: string,
  params: Record<string, string>,
) {
  const response = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(what, response);
  const parsed = tokenResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    throw new GoogleApiError(`${what} failed: malformed response`, 200);
  }
  return parsed.data;
}

export interface AccessToken {
  value: string;
  /** epoch ms after which the token must not be used */
  expiresAt: number;
}

export async function refreshAccessToken(
  fetchFn: Fetch,
  client: OAuthClient & { refreshToken: string },
  now: number,
): Promise<AccessToken> {
  const token = await postToken(fetchFn, 'token refresh', {
    grant_type: 'refresh_token',
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: client.refreshToken,
  });
  // a minute of slack so a token never expires mid-request
  const lifetimeMs = (token.expires_in ?? 3600) * 1000 - 60_000;
  return { value: token.access_token, expiresAt: now + lifetimeMs };
}

/** Authorization-code exchange of the loopback flow; returns the refresh token. */
export async function exchangeAuthCode(
  fetchFn: Fetch,
  client: OAuthClient,
  grant: { code: string; codeVerifier: string; redirectUri: string },
): Promise<string> {
  const token = await postToken(fetchFn, 'code exchange', {
    grant_type: 'authorization_code',
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: grant.code,
    code_verifier: grant.codeVerifier,
    redirect_uri: grant.redirectUri,
  });
  if (!token.refresh_token) {
    throw new GoogleApiError(
      'code exchange returned no refresh token (revoke the app grant and retry)',
      200,
    );
  }
  return token.refresh_token;
}

/**
 * events.list with singleEvents=true (recurring events expanded by Google)
 * over [timeMin, timeMax), all pages.
 */
export async function listEvents(
  fetchFn: Fetch,
  accessToken: string,
  query: { calendarId: string; timeMin: number; timeMax: number },
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(
      `${CALENDAR_API}/calendars/${encodeURIComponent(query.calendarId)}/events`,
    );
    url.search = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: new Date(query.timeMin).toISOString(),
      timeMax: new Date(query.timeMax).toISOString(),
      timeZone: 'Europe/Berlin',
      maxResults: '2500',
      fields: EVENT_FIELDS,
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const response = await fetchFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await failure('events.list', response);
    const parsed = eventsPageSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      throw new GoogleApiError('events.list failed: malformed response', 200);
    }
    events.push(...(parsed.data.items ?? []));
    pageToken = parsed.data.nextPageToken;
    if (!pageToken) return events;
  }
  throw new GoogleApiError('events.list failed: too many pages', 200);
}
