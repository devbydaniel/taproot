import { parseArgs } from 'node:util';
import { CALENDAR_ENV_VARS } from './calendarSync.js';
import { mintRefreshToken } from './googleOAuthLoopback.js';

// Mint the refresh token for the Google calendar sync:
//   TAPROOT_GOOGLE_CLIENT_ID=… TAPROOT_GOOGLE_CLIENT_SECRET=… \
//     npm run calendar:token -w server
// (or --client-id / --client-secret). The OAuth client must be a "Desktop
// app" client so Google accepts the 127.0.0.1 redirect. Prints the token on
// stdout; store it as TAPROOT_GOOGLE_REFRESH_TOKEN.

const { values } = parseArgs({
  options: {
    'client-id': { type: 'string' },
    'client-secret': { type: 'string' },
  },
});

const clientId =
  values['client-id'] ?? process.env[CALENDAR_ENV_VARS.clientId]?.trim();
const clientSecret =
  values['client-secret'] ??
  process.env[CALENDAR_ENV_VARS.clientSecret]?.trim();

if (!clientId || !clientSecret) {
  console.error(
    `usage: ${CALENDAR_ENV_VARS.clientId}=… ${CALENDAR_ENV_VARS.clientSecret}=… npm run calendar:token -w server\n` +
      '   or: npm run calendar:token -w server -- --client-id … --client-secret …',
  );
  process.exit(1);
}

try {
  const refreshToken = await mintRefreshToken({
    client: { clientId, clientSecret },
    onAuthUrl: (url) => {
      console.error(
        `Open this URL in the browser signed in to the calendar's Google account:\n\n${url}\n`,
      );
    },
  });
  console.error(`Store this as ${CALENDAR_ENV_VARS.refreshToken}:`);
  console.log(refreshToken);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
