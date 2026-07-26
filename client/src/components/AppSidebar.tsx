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
import {
  BookOpen,
  FileText,
  ListTodo,
  Moon,
  PinOff,
  RefreshCw,
  Sprout,
  Sun,
  WifiOff,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { movePinnedPage, togglePagePinned } from '@/actions';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { toggleTheme, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { Page } from '@taproot/shared';

const NAV_ITEMS = [
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/pages', label: 'Pages', icon: FileText },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
] as const;

function SortablePinnedItem({ page, active }: { page: Page; active: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id });

  return (
    // the li is the sortable node so restrictToParentElement spans the menu
    <SidebarMenuItem
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(isDragging && 'opacity-50')}
      {...attributes}
      {...listeners}
    >
      <SidebarMenuButton asChild isActive={active}>
        <Link href={`/p/${page.id}`} draggable={false}>
          <span>{page.title}</span>
        </Link>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        title="Unpin"
        onClick={() => togglePagePinned(page.id)}
      >
        <PinOff className="size-3.5" />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

/** offline / pending-sync indicator; renders nothing when all is well */
function SyncStatus() {
  const connectivity = useStore((s) => s.connectivity);
  const pendingCount = useStore((s) => s.pendingCount);
  if (connectivity === 'offline') {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <WifiOff className="size-4" />
        {pendingCount > 0 ? `Offline · ${pendingCount} pending` : 'Offline'}
      </div>
    );
  }
  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" />
        Syncing…
      </div>
    );
  }
  return null;
}

export function AppSidebar() {
  const [location] = useLocation();
  const theme = useTheme();
  const { setOpenMobile } = useSidebar();
  const pages = useStore((s) => s.pages);
  const pinned = pages
    .filter((p) => p.pinnedOrderKey !== null)
    // code-point comparison: fractional-index keys are case-sensitive,
    // locale collation would put 'Zz' after 'a0'
    .sort((a, b) => (a.pinnedOrderKey! < b.pinnedOrderKey! ? -1 : 1));

  // the mobile drawer closes on any navigation
  useEffect(() => {
    setOpenMobile(false);
  }, [location, setOpenMobile]);

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
    movePinnedPage(
      active.id as string,
      pinned.findIndex((p) => p.id === over.id),
    );
  };

  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <Sprout className="size-5" />
          <span className="text-lg font-semibold tracking-tight">Taproot</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton asChild isActive={location === href}>
                  <Link href={href}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        {pinned.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            <DndContext
              sensors={sensors}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={pinned.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <SidebarMenu>
                  {pinned.map((page) => (
                    <SortablePinnedItem
                      key={page.id}
                      page={page}
                      active={location === `/p/${page.id}`}
                    />
                  ))}
                </SidebarMenu>
              </SortableContext>
            </DndContext>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SyncStatus />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
