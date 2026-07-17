import type { OpsBroadcast } from '@taproot/shared';
import { clientId } from './api';
import { kickDrain } from './offline/sync';
import { useStore } from '@/store';

let started = false;

export function startWs() {
  if (started) return;
  started = true;
  connect();
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    useStore.getState().setConnectivity('online');
    // replay whatever queued while offline, then refetch: the epoch bump
    // makes every mounted view pull post-replay server state, and ops we
    // missed while disconnected (broadcasts are fire-and-forget) come with
    // it. Bump even if the drain didn't finish — snapshot installs overlay
    // still-pending ops, so a refetch can't clobber unsynced edits.
    void kickDrain().finally(() => useStore.getState().bumpRemoteEpoch());
  };
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as OpsBroadcast;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the cast is an assumption; the payload is unvalidated wire JSON
      if (message.type !== 'ops' || message.clientId === clientId) return;
      useStore.getState().applyOps(message.ops);
      useStore.getState().bumpRemoteEpoch();
    } catch {
      // ignore malformed messages
    }
  };
  ws.onclose = () => {
    useStore.getState().setConnectivity('offline');
    setTimeout(connect, 2000);
  };
}
