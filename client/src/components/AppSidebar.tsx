import {
  BookOpen,
  FileText,
  ListTodo,
  Moon,
  RefreshCw,
  Sprout,
  Sun,
  WifiOff,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { PinnedSection } from '@/components/PinnedSection';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { toggleTheme, useTheme } from '@/lib/theme';
import { useStore } from '@/store';

const NAV_ITEMS = [
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/pages', label: 'Pages', icon: FileText },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
] as const;

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

  // the mobile drawer closes on any navigation
  useEffect(() => {
    setOpenMobile(false);
  }, [location, setOpenMobile]);

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
        <PinnedSection location={location} />
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
