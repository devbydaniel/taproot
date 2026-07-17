import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { api, listPagesUncached, postOps } from './lib/api';
import { initOffline } from './lib/offline/sync';
import { registerServiceWorker } from './lib/sw';

registerServiceWorker();

// the op queue must be hydrated before the first render so snapshot installs
// can overlay not-yet-synced ops from the start; if IndexedDB is unavailable
// the app still renders and writes degrade to direct POSTs
initOffline({
  post: postOps,
  listServerPages: listPagesUncached,
  // getJournal writes through to the offline cache; the result is discarded
  refreshCaches: () => void api.getJournal().catch(() => undefined),
})
  .catch((err: unknown) => {
    console.error('offline support unavailable', err);
  })
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
