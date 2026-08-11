import {
  dailyLabel,
  formatDailyTitle,
  isDailyTitle,
  parseDailyTitle,
  shiftDailyTitle,
  todayTitle,
  type PagePayload,
} from '@taproot/shared';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Folder,
  Pin,
  PinOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import * as actions from '@/actions';
import { DailyAgenda } from '@/components/DailyAgenda';
import { PageShell } from '@/components/layout/PageShell';
import { LinkedRefs } from '@/components/LinkedRefs';
import { OutlineTree } from '@/components/OutlineTree';
import { PageTasks } from '@/components/PageTasks';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { api } from '@/lib/api';
import { installMergedBlocks, installPageSnapshot } from '@/lib/offline/sync';
import { hasChildren, visibleOrder, type OutlineCtx } from '@/lib/outline';
import { useStore } from '@/store';

export function PageView({ id }: { id: string }) {
  const [payload, setPayload] = useState<PagePayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const remoteEpoch = useStore((s) => s.remoteEpoch);
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
        installMergedBlocks(data.linkedRefs.flatMap((g) => g.blocks));
        setPayload(data);
        if (autoFocused.current !== id) {
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
  }, [id, remoteEpoch]);

  if (notFound) {
    return (
      <p className="p-10 text-muted-foreground">This page does not exist.</p>
    );
  }
  if (!payload) return null;

  const ctx: OutlineCtx = { pageId: id, rootParentId: null };

  const clickBelow = () => {
    const { blocks, setFocus } = useStore.getState();
    const order = visibleOrder(blocks, ctx);
    const last = order[order.length - 1];
    if (last && last.text === '' && !hasChildren(blocks, last.id)) {
      setFocus({ blockId: last.id, cursor: 'end' });
    } else {
      actions.appendBlock(ctx);
    }
  };

  const isDaily = isDailyTitle(payload.page.title);

  return (
    <PageShell
      crumbs={[
        isDaily
          ? { label: 'Journal', href: '/journal' }
          : { label: 'Pages', href: '/pages' },
        { label: payload.page.title },
      ]}
      actions={<PagePinMenu pageId={id} />}
    >
      <h1
        className={
          'text-lg font-semibold tracking-tight ' + (isDaily ? 'mb-1' : 'mb-4')
        }
      >
        {isDaily ? dailyLabel(payload.page.title) : payload.page.title}
      </h1>
      {isDaily && <DailyNav title={payload.page.title} />}
      {isDaily && <DailyAgenda pageId={id} pageTitle={payload.page.title} />}
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
          currentPageTitle={payload.page.title}
        />
      )}
      <LinkedRefs
        groups={payload.linkedRefs}
        currentPageId={payload.page.id}
        currentPageTitle={payload.page.title}
      />
    </PageShell>
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
