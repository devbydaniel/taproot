import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PinFolder } from '@taproot/shared';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  PinOff,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import {
  createPinFolder,
  deletePinFolder,
  movePinnedItem,
  pinPageToFolder,
  renamePinFolder,
  setPinFolderCollapsed,
  togglePagePinned,
} from '@/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { buildPinRows, type PinRow } from '@/lib/pinTree';
import { useRightPane } from '@/lib/rightPane';
import { shouldOpenInRightPane } from '@/lib/rightPaneGesture';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';

/**
 * The pinned section is a one-level tree: folders and loose pinned pages share
 * one ordering, and a folder holds pages. It renders as a flat <ul> with the
 * children indented by a margin rather than as nested lists, which keeps the
 * dnd-kit setup flat — one SortableContext over every visible row.
 */

/** the li is the sortable node so restrictToParentElement spans the whole menu */
function SortableRow({
  id,
  draggable,
  className,
  children,
}: {
  id: string;
  /** off while renaming, so dragging in the text field selects instead */
  draggable: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !draggable });

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-50', className)}
      {...attributes}
      {...(draggable ? listeners : {})}
    >
      {children}
    </SidebarMenuItem>
  );
}

function FolderRow({
  folder,
  renaming,
  onStartRename,
  onFinishRename,
  onRequestDelete,
}: {
  folder: PinFolder;
  renaming: boolean;
  onStartRename: () => void;
  onFinishRename: () => void;
  onRequestDelete: () => void;
}) {
  const [draft, setDraft] = useState(folder.name);

  if (renaming) {
    return (
      <SortableRow id={folder.id} draggable={false}>
        <SidebarInput
          autoFocus
          value={draft}
          aria-label="Folder name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            renamePinFolder(folder.id, draft);
            onFinishRename();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') onFinishRename();
          }}
        />
      </SortableRow>
    );
  }

  return (
    <SortableRow id={folder.id} draggable>
      <SidebarMenuButton
        onClick={() => setPinFolderCollapsed(folder.id, !folder.collapsed)}
      >
        {/* the icon carries the open/closed state now that there's no chevron */}
        {folder.collapsed ? <Folder /> : <FolderOpen />}
        <span>{folder.name}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover title={`${folder.name} actions`}>
            <MoreHorizontal className="size-3.5" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(folder.name);
              onStartRename();
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onRequestDelete}>
            <Trash2 />
            Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SortableRow>
  );
}

function PageRow({
  row,
  active,
  folders,
}: {
  row: Extract<PinRow, { kind: 'page' }>;
  active: boolean;
  folders: PinFolder[];
}) {
  const { page, folderId } = row;
  const { open } = useRightPane();
  return (
    <SortableRow
      id={page.id}
      draggable
      className={cn(folderId !== null && 'ml-pin-indent')}
    >
      <SidebarMenuButton asChild isActive={active}>
        <Link
          href={`/p/${page.id}`}
          draggable={false}
          onClickCapture={(event) => {
            if (!shouldOpenInRightPane(event)) return;
            event.preventDefault();
            event.stopPropagation();
            open({ kind: 'page', id: page.id });
          }}
        >
          <span>{page.title}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover title={`${page.title} actions`}>
            <MoreHorizontal className="size-3.5" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          {folders.length > 0 && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {folders.map((folder) => (
                      <DropdownMenuItem
                        key={folder.id}
                        disabled={folder.id === folderId}
                        onSelect={() => pinPageToFolder(page.id, folder.id)}
                      >
                        <Folder />
                        {folder.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              {folderId !== null && (
                // dragging out is impossible when no top-level row sits below
                <DropdownMenuItem
                  onSelect={() => pinPageToFolder(page.id, null)}
                >
                  Move out of folder
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => togglePagePinned(page.id)}>
            <PinOff />
            Unpin
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SortableRow>
  );
}

export function PinnedSection({ location }: { location: string }) {
  const pages = useStore((s) => s.pages);
  const folders = useStore((s) => s.pinFolders);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PinFolder | null>(null);
  const rows = buildPinRows(pages, folders);

  const sensors = useSensors(
    // distance keeps plain clicks navigating; drags start after 5px of movement
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // long-press to drag on touch so the drawer still scrolls
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    movePinnedItem(active.id as string, over.id as string);
  };

  const pagesIn = (folder: PinFolder) =>
    pages.filter(
      (page) =>
        page.pinnedOrderKey !== null && page.pinnedFolderId === folder.id,
    ).length;

  /** an empty folder goes without a prompt; unpinning pages deserves one */
  const requestDelete = (folder: PinFolder) => {
    if (pagesIn(folder) === 0) deletePinFolder(folder.id);
    else setPendingDelete(folder);
  };
  const doomedPages = pendingDelete ? pagesIn(pendingDelete) : 0;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Pinned</SidebarGroupLabel>
      <SidebarGroupAction
        title="New folder"
        onClick={() => setRenamingId(createPinFolder('New folder'))}
      >
        <FolderPlus />
      </SidebarGroupAction>
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">
          Nothing pinned yet.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={rows.map((row) => row.id)}
            strategy={verticalListSortingStrategy}
          >
            <SidebarMenu>
              {rows.map((row) =>
                row.kind === 'folder' ? (
                  <FolderRow
                    key={row.id}
                    folder={row.folder}
                    renaming={renamingId === row.id}
                    onStartRename={() => setRenamingId(row.id)}
                    onFinishRename={() => setRenamingId(null)}
                    onRequestDelete={() => requestDelete(row.folder)}
                  />
                ) : (
                  <PageRow
                    key={row.id}
                    row={row}
                    active={location === `/p/${row.page.id}`}
                    folders={folders}
                  />
                ),
              )}
            </SidebarMenu>
          </SortableContext>
        </DndContext>
      )}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
            <DialogDescription>
              {doomedPages === 1
                ? 'The page inside will be unpinned. The page itself is not deleted.'
                : `The ${doomedPages} pages inside will be unpinned. The pages themselves are not deleted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deletePinFolder(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  );
}
