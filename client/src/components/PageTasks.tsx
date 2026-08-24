import {
  collectAssignedReferenceTitles,
  matchesAssignedReferenceFilter,
  parseTask,
  type Block,
  type LinkedRefGroup,
} from '@taproot/shared';
import { useRef } from 'react';
import { useStore } from '@/store';
import {
  AssignedReferenceFilter,
  useAssignedReferenceFilter,
} from './AssignedReferenceFilter';
import { BlockContent } from './BlockContent';
import { BulletLink } from './Bullet';

/**
 * Open tasks that link to this page, shown below the page content. Membership
 * is "was open at any point while this view was mounted": checking a task
 * strikes it through but keeps the row until the page is left or reloaded.
 */
export function PageTasks({
  groups,
  currentPageTitle,
  origin,
}: {
  groups: LinkedRefGroup[];
  currentPageTitle: string;
  origin?: string;
}) {
  const storeBlocks = useStore((s) => s.blocks);
  const everOpen = useRef(new Set<string>());

  const roots = groups.flatMap((group) =>
    group.rootIds
      .map((id) => storeBlocks[id])
      .filter((block): block is Block => block !== undefined),
  );

  for (const root of roots) {
    if (parseTask(root.text)?.state === 'TODO') everOpen.current.add(root.id);
  }

  const rows = roots.filter(
    (block) => everOpen.current.has(block.id) && parseTask(block.text),
  );
  const options = collectAssignedReferenceTitles(
    rows.map((block) => block.text),
    currentPageTitle,
  );
  const { selectedTitles, setSelectedTitles } = useAssignedReferenceFilter(
    options,
    currentPageTitle,
  );
  const visibleRows = rows.filter((block) =>
    matchesAssignedReferenceFilter(
      block.text,
      currentPageTitle,
      selectedTitles,
    ),
  );

  if (rows.length === 0) return null;

  const openCount = visibleRows.filter(
    (block) => parseTask(block.text)?.state === 'TODO',
  ).length;

  return (
    <section className="mt-16 border-t pt-6">
      <h2 className="mb-1 flex items-center text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        <span>
          Tasks
          {openCount > 0 && (
            <span className="ml-2 font-normal">{openCount}</span>
          )}
        </span>
        <AssignedReferenceFilter
          options={options}
          selectedTitles={selectedTitles}
          onSelectedTitlesChange={setSelectedTitles}
        />
      </h2>
      {visibleRows.length === 0 ? (
        <p className="text-sm font-normal tracking-normal text-muted-foreground normal-case">
          No tasks match this filter.
        </p>
      ) : (
        visibleRows.map((block) => (
          <div key={block.id} className="flex items-start gap-1.5 py-[3px]">
            <BulletLink
              blockId={block.id}
              ctx={{ pageId: block.pageId, rootParentId: null, origin }}
            />
            <div className="min-w-0 flex-1 leading-6">
              <BlockContent block={block} />
            </div>
          </div>
        ))
      )}
    </section>
  );
}
