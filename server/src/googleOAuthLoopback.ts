import { createHash, randomBytes } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CALENDAR_READONLY_SCOPE,
  exchangeAuthCode,
  GOOGLE_AUTH_URL,
  type Fetch,
  type OAuthClient,
} from './google.js';

// OAuth loopback flow (installed-app clients) with PKCE: listen on a random
// 127.0.0.1 port, let the user consent in a browser, exchange the returned
// code for a refresh token. Used by mintGoogleToken.ts.

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

interface LoopbackOptions {
  client: OAuthClient;
  /** receives the consent URL to open in a browser */
  onAuthUrl: (url: string) => void;
  fetch?: Fetch;
  timeoutMs?: number;
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');

function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  pkce: { state: string; codeChallenge: string },
): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_READONLY_SCOPE,
    // offline + consent: Google returns a refresh token even on a re-grant
    access_type: 'offline',
    prompt: 'consent',
    state: pkce.state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

function reply(res: ServerResponse, status: number, message: string) {
  // no keep-alive: server.close() would otherwise wait for the browser's socket
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    Connection: 'close',
  });
  res.end(message);
}

/** Runs the consent flow and resolves with the refresh token. */
export function mintRefreshToken(options: LoopbackOptions): Promise<string> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(
    createHash('sha256').update(codeVerifier).digest(),
  );
  const state = base64url(randomBytes(16));

  return new Promise<string>((resolve, reject) => {
    let redirectUri = '';
    const server = createServer((req, res) => {
      const params = new URL(req.url ?? '/', redirectUri).searchParams;
      const code = params.get('code');
      const denied = params.get('error');
      // favicon and other stray requests: not the redirect
      if (!code && !denied) return reply(res, 404, 'not found');
      // a redirect this flow didn't start: ignore it, keep waiting
      if (params.get('state') !== state) {
        return reply(res, 400, 'state mismatch: ignored');
      }
      if (denied) {
        reply(res, 400, `authorization failed: ${denied}`);
        return finish(new Error(`authorization failed: ${denied}`));
      }
      exchangeAuthCode(fetchFn, options.client, {
        code: code ?? '',
        codeVerifier,
        redirectUri,
      }).then(
        (token) => {
          reply(res, 200, 'Taproot: refresh token received. Close this tab.');
          finish(null, token);
        },
        (error: unknown) => {
          reply(res, 500, 'code exchange failed, see the terminal');
          finish(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

    const timer = setTimeout(
      () => finish(new Error('timed out waiting for consent')),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    function finish(error: Error | null, token?: string) {
      clearTimeout(timer);
      server.close();
      if (error || token === undefined) reject(error ?? new Error('no token'));
      else resolve(token);
    }

    server.on('error', (error) => finish(error));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}`;
      options.onAuthUrl(
        buildAuthUrl(options.client.clientId, redirectUri, {
          state,
          codeChallenge,
        }),
      );
    });
  });
}
