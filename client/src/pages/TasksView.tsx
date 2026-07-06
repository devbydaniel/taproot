import type { LinkedRefGroup } from '@taproot/shared';
import { useEffect, useState } from 'react';
import { RefGroupCard } from '@/components/LinkedRefs';
import { api } from '@/lib/api';
import { useStore } from '@/store';

export function TasksView() {
  const [groups, setGroups] = useState<LinkedRefGroup[] | null>(null);
  const remoteEpoch = useStore((s) => s.remoteEpoch);

  useEffect(() => {
    let cancelled = false;
    void api.getTasks().then((data) => {
      if (cancelled) return;
      useStore.getState().mergeBlocks(data.groups.flatMap((g) => g.blocks));
      setGroups(data.groups);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteEpoch]);

  if (!groups) return null;
  const count = groups.reduce((sum, group) => sum + group.rootIds.length, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Tasks</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {count} open {count === 1 ? 'task' : 'tasks'}
      </p>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing open. Start a bullet with “TODO ” anywhere and it will show up
          here.
        </p>
      ) : (
        groups.map((group) => (
          <RefGroupCard key={group.page.id} group={group} showAge />
        ))
      )}
    </div>
  );
}
