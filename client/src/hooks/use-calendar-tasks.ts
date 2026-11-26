import type { Block, TaskListItem } from '@taproot/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VisibleRange } from '@/hooks/use-google-events';
import { api } from '@/lib/api';
import { installMergedBlocks } from '@/lib/offline/sync';
import { useStore } from '@/store';

/**
 * The task blocks the calendar shows: every open task (dated or not, for the
 * sidebar too) plus the completed tasks dated in the visible range, which
 * stay on the calendar struck through. Membership comes from the fetches,
 * refetched when the range changes or remote ops arrive, plus locally spawned
 * recurrences; the blocks themselves are the live store copies, so ticking,
 * unticking and moving show immediately. Reads go through the offline cache;
 * a failed read keeps what is shown.
 */
export function useCalendarTasks(range: VisibleRange | null): {
  taskBlocks: Block[];
  /** a recurring completion spawned this instance; show it before a refetch */
  addSpawned: (id: string) => void;
} {
  const [openItems, setOpenItems] = useState<TaskListItem[]>([]);
  const [doneItems, setDoneItems] = useState<TaskListItem[]>([]);
  const [spawned, setSpawned] = useState<string[]>([]);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const blocks = useStore((s) => s.blocks);
  const start = range?.start;
  const end = range?.end;

  useEffect(() => {
    let cancelled = false;
    api.getTasks().then(
      (data) => {
        if (cancelled) return;
        installMergedBlocks(
          data.blocks ?? data.tasks.map((item) => item.block),
        );
        setOpenItems(data.tasks);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [remoteEpoch]);

  useEffect(() => {
    if (start === undefined || end === undefined) return;
    let cancelled = false;
    api.getDoneTasks(start, end).then(
      (data) => {
        if (cancelled) return;
        installMergedBlocks(data.tasks.map((item) => item.block));
        setDoneItems(data.tasks);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [start, end, remoteEpoch]);

  const taskBlocks = useMemo(() => {
    const ids = new Set([
      ...openItems.map((item) => item.block.id),
      ...doneItems.map((item) => item.block.id),
      ...spawned,
    ]);
    return [...ids].flatMap((id) => {
      const block = blocks[id];
      return block ? [block] : [];
    });
  }, [openItems, doneItems, spawned, blocks]);

  const addSpawned = useCallback(
    (id: string) => setSpawned((current) => [...current, id]),
    [],
  );
  return { taskBlocks, addSpawned };
}
