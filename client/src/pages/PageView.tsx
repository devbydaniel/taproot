import {
  dailyLabel,
  formatDailyTitle,
  isDailyTitle,
  parseDailyTitle,
  shiftDailyTitle,
  todayTitle,
  type Page,
  type PagePayload,
} from '@taproot/shared';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Folder,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import * as actions from '@/actions';
import { DailyAgenda } from '@/components/DailyAgenda';
import { PageShell, type PageSurface } from '@/components/layout/PageShell';
import { LinkedRefs } from '@/components/LinkedRefs';
import { OutlineTree } from '@/components/OutlineTree';
import { PageTasks } from '@/components/PageTasks';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { api } from '@/lib/api';
import { installMergedBlocks, installPageSnapshot } from '@/lib/offline/sync';
import { hasChildren, visibleOrder, type OutlineCtx } from '@/lib/outline';
import { useRightPane } from '@/lib/rightPane';
import { useStore } from '@/store';

export function PageView({
  id,
  surface = 'main',
  onClose,
}: {
  id: string;
  surface?: PageSurface;
  onClose?: () => void;
}) {
  const [payload, setPayload] = useState<PagePayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const storePage = useStore((s) => s.pages.find((page) => page.id === id));
  const hasBlocks = useStore((s) =>
    Object.values(s.blocks).some((b) => b.pageId === id),
  );
  // pages already auto-focused, so remote-epoch refetches don't steal the cursor
  const autoFocused = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPage(id)
      .then((data) => {
        if (cancelled) return;
        installPageSnapshot(id, data.blocks);
        // linked-ref blocks live on other pages; merge them so checkbox
        // toggles in the references section render immediately
        installMergedBlocks(
          data.linkedRefs.flatMap((group) => [
            ...Object.values(group.ancestors).flat(),
            ...group.blocks,
          ]),
        );
        setPayload(data);
        if (surface === 'main' && autoFocused.current !== id) {
          autoFocused.current = id;
          const { blocks, setFocus } = useStore.getState();
          const order = visibleOrder(blocks, {
            pageId: id,
            rootParentId: null,
          });
          const last = order[order.length - 1];
          if (last) setFocus({ blockId: last.id, cursor: 'end' });
          else actions.appendBlock({ pageId: id, rootParentId: null });
        }
      })
      .catch(() => setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [id, remoteEpoch, surface]);

  if (notFound) {
    const message = (
      <p className="p-6 text-muted-foreground">This page does not exist.</p>
    );
    return surface === 'right' ? (
      <PageShell crumbs={[]} surface={surface} onClose={onClose}>
        {message}
      </PageShell>
    ) : (
      message
    );
  }
  if (!payload) {
    return surface === 'right' ? (
      <PageShell crumbs={[]} surface={surface} onClose={onClose}>
        <p className="p-6 text-muted-foreground">Loading…</p>
      </PageShell>
    ) : null;
  }

  const page = storePage ?? payload.page;
  const origin = surface === 'right' ? `right:page:${id}` : undefined;
  const ctx: OutlineCtx = { pageId: id, rootParentId: null, origin };

  const clickBelow = () => {
    const { blocks, setFocus } = useStore.getState();
    const order = visibleOrder(blocks, ctx);
    const last = order[order.length - 1];
    if (last && last.text === '' && !hasChildren(blocks, last.id)) {
      setFocus({ blockId: last.id, cursor: 'end', origin: ctx.origin });
    } else {
      actions.appendBlock(ctx);
    }
  };

  const isDaily = isDailyTitle(page.title);

  return (
    <PageShell
      crumbs={[
        isDaily
          ? { label: 'Journal', href: '/journal' }
          : { label: 'Pages', href: '/pages' },
        { label: page.title },
      ]}
      actions={
        <>
          <PagePinMenu pageId={id} />
          <PageRenameButton page={page} />
          <PageDeleteButton page={page} surface={surface} onClose={onClose} />
        </>
      }
      surface={surface}
      onClose={onClose}
    >
      <h1
        className={
          'text-lg font-semibold tracking-tight ' + (isDaily ? 'mb-1' : 'mb-4')
        }
      >
        {isDaily ? dailyLabel(page.title) : page.title}
      </h1>
      {isDaily && <DailyNav title={page.title} />}
      {isDaily && (
        <DailyAgenda
          key={id}
          pageId={id}
          pageTitle={page.title}
          origin={origin}
        />
      )}
      {hasBlocks ? (
        <OutlineTree parentId={null} ctx={ctx} />
      ) : (
        <button
          onClick={() => actions.appendBlock(ctx)}
          className="cursor-text text-sm text-muted-foreground hover:text-foreground"
        >
          Click to start writing…
        </button>
      )}
      <div className="h-24 cursor-text" onClick={clickBelow} />
      {!isDaily && (
        <PageTasks
          groups={payload.linkedRefs}
          currentPageTitle={page.title}
          origin={origin}
        />
      )}
      <LinkedRefs
        groups={payload.linkedRefs}
        currentPageId={payload.page.id}
        currentPageTitle={page.title}
        origin={origin}
      />
    </PageShell>
  );
}

function PageRenameButton({ page }: { page: Page }) {
  const pages = useStore((s) => s.pages);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(page.title);
  const title = draft.trim();
  const duplicate = pages.some(
    (item) => item.id !== page.id && item.title === title,
  );
  const canRename = title !== '' && title !== page.title && !duplicate;

  const setDialogOpen = (next: boolean) => {
    setOpen(next);
    if (next) setDraft(page.title);
  };

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title="Rename page"
        onClick={() => setDialogOpen(true)}
      >
        <Pencil />
      </Button>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canRename && actions.renamePage(page.id, title)) setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename page</DialogTitle>
            <DialogDescription>
              Wikilinks and tags that reference this page will be renamed too.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="rename-page-title" className="text-sm font-medium">
              Page title
            </label>
            <Input
              id="rename-page-title"
              autoFocus
              value={draft}
              aria-invalid={duplicate || undefined}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
            {duplicate && (
              <p className="text-sm text-destructive" role="alert">
                A page with this title already exists.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canRename}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PageDeleteButton({
  page,
  surface,
  onClose,
}: {
  page: Page;
  surface: PageSurface;
  onClose?: () => void;
}) {
  const [location, navigate] = useLocation();
  const { target: rightTarget, close: closeRight } = useRightPane();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        title="Delete page"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{page.title}”?</DialogTitle>
          <DialogDescription>
            This deletes the page and all of its blocks. Wikilinks and tags to
            this page will be converted to plain text. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (!actions.deletePage(page.id)) return;
              setOpen(false);
              if (rightTarget?.kind === 'page' && rightTarget.id === page.id)
                closeRight();
              else if (surface === 'right') onClose?.();
              if (surface === 'main' || location === `/p/${page.id}`)
                navigate('/pages');
            }}
          >
            Delete page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PagePinMenu({ pageId }: { pageId: string }) {
  // Store state makes pin and move operations update the menu optimistically.
  const page = useStore((s) => s.pages.find((p) => p.id === pageId));
  const pinFolders = useStore((s) => s.pinFolders);
  const pinned = page?.pinnedOrderKey != null;
  const pinLocation = pinned
    ? page.pinnedFolderId
      ? `folder:${page.pinnedFolderId}`
      : 'top-level'
    : '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={
            'size-7 ' + (pinned ? 'text-foreground' : 'text-muted-foreground')
          }
          title={pinned ? 'Change pin location' : 'Pin to sidebar'}
        >
          <Pin className={pinned ? 'fill-current' : ''} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Pin to</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={pinLocation}>
          <DropdownMenuRadioItem
            value="top-level"
            onSelect={() => actions.pinPageToFolder(pageId, null)}
          >
            <Pin />
            Top level
          </DropdownMenuRadioItem>
          {pinFolders.map((folder) => (
            <DropdownMenuRadioItem
              key={folder.id}
              value={`folder:${folder.id}`}
              onSelect={() => actions.pinPageToFolder(pageId, folder.id)}
            >
              <Folder />
              {folder.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {pinned && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.togglePagePinned(pageId)}>
              <PinOff />
              Unpin
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** prev/next day + calendar + Today controls shown under the title of a daily page */
function DailyNav({ title }: { title: string }) {
  const [, navigate] = useLocation();
  const [pickerOpen, setPickerOpen] = useState(false);

  const goTo = (target: string | null) => {
    if (!target) return;
    void api.pageByTitle(target).then((page) => navigate(`/p/${page.id}`));
  };

  return (
    <div className="mb-6 flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => goTo(shiftDailyTitle(title, -1))}
        title="Previous day"
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => goTo(shiftDailyTitle(title, 1))}
        title="Next day"
      >
        <ChevronRight />
      </Button>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Go to date"
          >
            <CalendarDays />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            weekStartsOn={1}
            selected={parseDailyTitle(title) ?? undefined}
            defaultMonth={parseDailyTitle(title) ?? undefined}
            onSelect={(date) => {
              if (!date) return;
              setPickerOpen(false);
              goTo(formatDailyTitle(date));
            }}
          />
        </PopoverContent>
      </Popover>
      {title !== todayTitle() && (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => goTo(todayTitle())}
        >
          Today
        </Button>
      )}
    </div>
  );
}
