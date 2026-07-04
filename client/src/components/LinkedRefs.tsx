import type { Block, LinkedRefGroup } from '@taproot/shared';
import { useMemo } from 'react';
import { Link } from 'wouter';
import { useStore } from '@/store';
import { BlockContent } from './BlockContent';

export function LinkedRefs({ groups }: { groups: LinkedRefGroup[] }) {
  const count = groups.reduce((sum, group) => sum + group.rootIds.length, 0);
  return (
    <section className="mt-16 border-t pt-6 pb-24">
      <h2 className="mb-4 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Linked References
        {count > 0 && <span className="ml-2 font-normal">{count}</span>}
      </h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No linked references yet. Mention this page as a [[wikilink]] anywhere
          and the bullet will show up here.
        </p>
      ) : (
        groups.map((group) => (
          <RefGroupCard key={group.page.id} group={group} />
        ))
      )}
    </section>
  );
}

/** One page's worth of read-only outline; also used by the Tasks view. */
export function RefGroupCard({
  group,
  showAge = false,
}: {
  group: LinkedRefGroup;
  showAge?: boolean;
}) {
  const byParent = useMemo(() => {
    const map = new Map<string, Block[]>();
    for (const block of group.blocks) {
      if (block.parentId === null) continue;
      const siblings = map.get(block.parentId) ?? [];
      siblings.push(block);
      map.set(block.parentId, siblings);
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
    }
    return map;
  }, [group]);

  const roots = group.rootIds
    .map((id) => group.blocks.find((block) => block.id === id))
    .filter((block): block is Block => block !== undefined);

  return (
    <div className="mb-6 rounded-lg border bg-muted/30 px-4 py-3">
      <Link
        href={`/p/${group.page.id}`}
        className="mb-1 inline-block text-sm font-medium text-link hover:underline"
      >
        {group.page.title}
      </Link>
      {roots.map((root) => (
        <RefRow
          key={root.id}
          block={root}
          byParent={byParent}
          showAge={showAge}
        />
      ))}
    </div>
  );
}

function ageLabel(createdAt: number): string | null {
  const days = Math.floor((Date.now() - createdAt) / 86_400_000);
  if (days < 2) return null;
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

function RefRow({
  block,
  byParent,
  showAge = false,
}: {
  block: Block;
  byParent: Map<string, Block[]>;
  showAge?: boolean;
}) {
  // prefer the store's copy so checkbox toggles render immediately
  const live = useStore((s) => s.blocks[block.id]) ?? block;
  const children = byParent.get(block.id) ?? [];
  const age = showAge ? ageLabel(live.createdAt) : null;
  return (
    <div>
      <div className="flex items-start gap-1.5 py-[3px]">
        <Link
          href={`/b/${block.id}`}
          title="Zoom to block"
          className="mt-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-accent"
        >
          <span className="block h-[6px] w-[6px] rounded-full bg-muted-foreground/70" />
        </Link>
        <div className="min-w-0 flex-1 leading-6">
          <BlockContent block={live} />
          {age && (
            <span
              title="Age of this task"
              className="ml-2 rounded-sm bg-muted px-1 py-0.5 text-[11px] text-muted-foreground/80"
            >
              {age}
            </span>
          )}
        </div>
      </div>
      {children.length > 0 && (
        <div className="ml-[7px] border-l border-border pl-[23px]">
          {children.map((child) => (
            <RefRow key={child.id} block={child} byParent={byParent} />
          ))}
        </div>
      )}
    </div>
  );
}
