import { registerSW } from 'virtual:pwa-register';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the app-shell service worker. autoUpdate: the page reloads once
 * a new version activates — safe, since every edit is persisted per-op. The
 * SPA rarely navigates (which is what normally triggers SW update checks),
 * so poll for an updated sw.js hourly. No-op in dev and over plain http
 * (service workers require a secure context: https or localhost).
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
    },
  });
}
