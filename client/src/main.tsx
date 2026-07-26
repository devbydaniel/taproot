import { todayTitle } from '@taproot/shared';
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
  // warm today's page in the offline cache (title:… and page:…) so the
  // journal opens offline; the results are discarded
  refreshCaches: () =>
    void api
      .pageByTitle(todayTitle())
      .then((page) => api.getPage(page.id))
      .catch(() => undefined),
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
