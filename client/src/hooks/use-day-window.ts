import type FullCalendar from '@fullcalendar/react';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { DAY_WINDOW, SLOT_MINUTES, dayWindowRowHeight } from '@/lib/calendar';

/** set on the frame; index.css sizes the time-grid rows with it */
const ROW_HEIGHT_VAR = '--taproot-slot-height';

/** the time grid's scroll container (FullCalendar's liquid-height scroller) */
function timeScroller(frame: HTMLElement): HTMLElement | null {
  return (
    frame
      .querySelector('.fc-timegrid-body')
      ?.closest<HTMLElement>('.fc-scroller') ?? null
  );
}

/**
 * Size the time grid so the day window (08:00–20:00) fills the visible
 * height, and scroll each new grid to its start; the rest of the day stays a
 * scroll away. FullCalendar has no such option — rows are a fixed CSS height
 * — so this measures the grid's scroller and sets the row height whenever the
 * scroller changes size (window, side pane, a growing all-day row), keeping
 * the time at the top in place. Returns the handler for FullCalendar's
 * viewDidMount: a view switch brings a new scroller to watch.
 */
export function useDayWindow(
  frameRef: RefObject<HTMLElement | null>,
  calendarRef: RefObject<FullCalendar | null>,
): () => void {
  const observerRef = useRef<ResizeObserver | null>(null);
  const watchedRef = useRef<HTMLElement | null>(null);
  // the grid that already got its initial scroll to the window start
  const scrolledRef = useRef<HTMLElement | null>(null);

  const fit = useCallback(() => {
    const frame = frameRef.current;
    const calendar = calendarRef.current?.getApi();
    const scroller = watchedRef.current;
    const slots = frame?.querySelector<HTMLTableElement>(
      '.fc-timegrid-slots table',
    );
    if (!frame || !calendar || !scroller || !slots) return;
    if (scroller.clientHeight === 0 || slots.rows.length === 0) return;
    const rowHeight = () =>
      slots.getBoundingClientRect().height / slots.rows.length;
    const target = dayWindowRowHeight(scroller.clientHeight);
    const before = rowHeight();
    const initial = scrolledRef.current !== scroller;
    scrolledRef.current = scroller;
    // a fresh grid of the right size was scrolled by FullCalendar (scrollTime)
    if (Math.abs(before - target) < 0.1) return;
    const topRows = scroller.scrollTop / before;
    // the rows' borders add to the CSS height: correct by what was measured
    let css =
      parseFloat(frame.style.getPropertyValue(ROW_HEIGHT_VAR)) || before;
    for (let pass = 0; pass < 2; pass++) {
      const off = target - rowHeight();
      if (Math.abs(off) < 0.1) break;
      css += off;
      frame.style.setProperty(ROW_HEIGHT_VAR, `${css}px`);
    }
    calendar.updateSize();
    scroller.scrollTop =
      (initial ? DAY_WINDOW.start / SLOT_MINUTES : topRows) * rowHeight();
  }, [frameRef, calendarRef]);

  const watch = useCallback(() => {
    const frame = frameRef.current;
    const observer = observerRef.current;
    if (!frame || !observer) return;
    const scroller = timeScroller(frame);
    if (scroller === watchedRef.current) return;
    if (watchedRef.current) observer.unobserve(watchedRef.current);
    watchedRef.current = scroller;
    // observing reports the current size too, which fits the new grid
    if (scroller) observer.observe(scroller);
  }, [frameRef]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // FullCalendar only tracks window resizes; the frame also changes width
    // when the app sidebar or the side pane opens
    const observer = new ResizeObserver(() => {
      calendarRef.current?.getApi().updateSize();
      fit();
    });
    observerRef.current = observer;
    observer.observe(frame);
    watch();
    return () => {
      observer.disconnect();
      observerRef.current = null;
      watchedRef.current = null;
    };
  }, [frameRef, calendarRef, fit, watch]);

  return watch;
}
