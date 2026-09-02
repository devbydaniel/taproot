import {
  collectAssignedReferenceTitles,
  matchesAssignedReferenceFilter,
  type Block,
  type LinkedRefGroup,
} from '@taproot/shared';
import { useMemo } from 'react';
import type { OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';
import {
  AssignedReferenceFilter,
  useAssignedReferenceFilter,
} from './AssignedReferenceFilter';
import { BlockContent } from './BlockContent';
import { RefBreadcrumb } from './Breadcrumb';
import { BulletLink } from './Bullet';
import { EditableBlockText } from './EditableBlockText';

export function LinkedRefs({
  groups,
  currentPageId,
  currentPageTitle,
  origin,
}: {
  groups: LinkedRefGroup[];
  currentPageId: string;
  currentPageTitle: string;
  origin?: string;
}) {
  const storeBlocks = useStore((s) => s.blocks);
  const rootBlock = (id: string) => storeBlocks[id];
  const rootTexts = groups.flatMap((group) =>
    group.rootIds.flatMap((id) => {
      const block = rootBlock(id);
      return block ? [block.text] : [];
    }),
  );
  const options = collectAssignedReferenceTitles(rootTexts, currentPageTitle);
  const { selectedTitles, setSelectedTitles } = useAssignedReferenceFilter(
    options,
    currentPageTitle,
  );
  const visibleGroups = groups.flatMap((group) => {
    const rootIds = group.rootIds.filter((id) => {
      const block = rootBlock(id);
      return (
        block !== undefined &&
        matchesAssignedReferenceFilter(
          block.text,
          currentPageTitle,
          selectedTitles,
        )
      );
    });
    return rootIds.length > 0 ? [{ ...group, rootIds }] : [];
  });
  const count = visibleGroups.reduce(
    (sum, group) => sum + group.rootIds.length,
    0,
  );

  return (
    <section className="mt-16 border-t pt-6 pb-24">
      <h2 className="mb-4 flex items-center text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        <span>
          Linked References
          {count > 0 && <span className="ml-2 font-normal">{count}</span>}
        </span>
        <AssignedReferenceFilter
          options={options}
          selectedTitles={selectedTitles}
          onSelectedTitlesChange={setSelectedTitles}
        />
      </h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No linked references yet. Mention this page as a [[wikilink]] or #tag
          anywhere and the bullet will show up here.
        </p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No linked references match this filter.
        </p>
      ) : (
        visibleGroups.map((group) => (
          <RefGroupCard
            key={group.page.id}
            group={group}
            hostPageId={currentPageId}
            origin={origin}
          />
        ))
      )}
    </section>
  );
}

/** One page's worth of outline; text is editable in place. */
function RefGroupCard({
  group,
  hostPageId,
  origin,
}: {
  group: LinkedRefGroup;
  /** the page whose refs section this is — scopes the focus origin so the
   * same block rendered elsewhere (outline, another day's refs) stays static */
  hostPageId: string;
  /** pane origin, when this references section is rendered outside the main view */
  origin?: string;
}) {
  const storeBlocks = useStore((s) => s.blocks);
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
    .map((id) => storeBlocks[id])
    .filter((block): block is Block => block !== undefined);

  const focusOrigin = origin
    ? `${origin}:refs:${hostPageId}`
    : `refs:${hostPageId}`;
  const ctx: OutlineCtx = {
    pageId: group.page.id,
    rootParentId: null,
    origin: focusOrigin,
  };

  return (
    <div className="mb-6 rounded-xl border bg-muted/30 px-4 py-3">
      {roots.map((root, i) => (
        <div key={root.id} className={i > 0 ? 'mt-4' : undefined}>
          <RefBreadcrumb
            page={group.page}
            ancestors={group.ancestors[root.id] ?? []}
            className="mb-1 font-medium"
          />
          <RefRow
            block={root}
            byParent={byParent}
            ctx={ctx}
            contextRootBlockId={group.ancestors[root.id]?.[0]?.id ?? root.id}
          />
        </div>
      ))}
    </div>
  );
}

function RefRow({
  block,
  byParent,
  ctx,
  contextRootBlockId,
}: {
  block: Block;
  byParent: Map<string, Block[]>;
  ctx: OutlineCtx;
  contextRootBlockId: string;
}) {
  const live = useStore((s) => s.blocks[block.id]);
  const children = byParent.get(block.id) ?? [];
  if (!live) return null;
  return (
    <div>
      <div className="flex items-start gap-1.5 py-[3px]">
        <BulletLink
          blockId={block.id}
          ctx={ctx}
          contextRootBlockId={contextRootBlockId}
        />
        {live.kind === 'text' ? (
          <EditableBlockText
            block={live}
            ctx={ctx}
            variant="ref"
            origin={ctx.origin}
          />
        ) : (
          <div className="min-w-0 flex-1 leading-6">
            <BlockContent block={live} />
          </div>
        )}
      </div>
      {children.length > 0 && (
        <div className="ml-outline-guide border-l border-border pl-outline-indent">
          {children.map((child) => (
            <RefRow
              key={child.id}
              block={child}
              byParent={byParent}
              ctx={ctx}
              contextRootBlockId={contextRootBlockId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
