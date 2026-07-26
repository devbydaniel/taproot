import { todayTitle } from '@taproot/shared';
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/lib/api';

/**
 * The journal is today's daily page: resolve (and auto-create) it, then hand
 * off to PageView via its /p/:id route. Day-to-day navigation lives in the
 * DailyNav controls on the page itself.
 */
export function JournalView() {
  const [, navigate] = useLocation();

  useEffect(() => {
    let cancelled = false;
    void api.pageByTitle(todayTitle()).then((page) => {
      if (!cancelled) navigate(`/p/${page.id}`, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}
