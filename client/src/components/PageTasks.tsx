import { parseTask, type Block, type LinkedRefGroup } from '@taproot/shared';
import { useRef } from 'react';
import { useStore } from '@/store';
import { BlockContent } from './BlockContent';

/**
 * Open tasks that link to this page, shown below the page content. Membership
 * is "was open at any point while this view was mounted": checking a task
 * strikes it through but keeps the row until the page is left or reloaded.
 */
export function PageTasks({ groups }: { groups: LinkedRefGroup[] }) {
  const storeBlocks = useStore((s) => s.blocks);
  const everOpen = useRef(new Set<string>());

  // the referencing blocks themselves, preferring the live store copy
  const roots = groups.flatMap((group) =>
    group.rootIds
      .map((id) => storeBlocks[id] ?? group.blocks.find((b) => b.id === id))
      .filter((block): block is Block => block !== undefined),
  );

  for (const root of roots) {
    if (parseTask(root.text)?.state === 'TODO') everOpen.current.add(root.id);
  }

  const rows = roots.filter(
    (block) => everOpen.current.has(block.id) && parseTask(block.text),
  );
  if (rows.length === 0) return null;

  const openCount = rows.filter(
    (block) => parseTask(block.text)?.state === 'TODO',
  ).length;

  return (
    <section className="mt-16 border-t pt-6">
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Tasks
        {openCount > 0 && <span className="ml-2 font-normal">{openCount}</span>}
      </h2>
      {rows.map((block) => (
        <div key={block.id} className="py-[3px] leading-6">
          <BlockContent block={block} />
        </div>
      ))}
    </section>
  );
}
