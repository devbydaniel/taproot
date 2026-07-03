import type { OpsBroadcast } from '@taproot/shared';
import { clientId } from './api';
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
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as OpsBroadcast;
      if (message.type !== 'ops' || message.clientId === clientId) return;
      useStore.getState().applyOps(message.ops);
      useStore.getState().bumpRemoteEpoch();
    } catch {
      // ignore malformed messages
    }
  };
  ws.onclose = () => {
    setTimeout(connect, 2000);
  };
}
