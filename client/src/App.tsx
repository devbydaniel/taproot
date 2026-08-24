import { useHotkey } from '@tanstack/react-hotkeys';
import { useEffect } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { AppSidebar } from '@/components/AppSidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { api } from '@/lib/api';
import { installPages, installPinFolders } from '@/lib/offline/sync';
import { RightPaneProvider, useRightPane } from '@/lib/rightPane';
import { startWs } from '@/lib/ws';
import { JournalView } from '@/pages/JournalView';
import { PagesView } from '@/pages/PagesView';
import { PageView } from '@/pages/PageView';
import { TasksView } from '@/pages/TasksView';
import { ZoomView } from '@/pages/ZoomView';
import { useStore } from '@/store';

export function App() {
  return (
    <RightPaneProvider>
      <AppWorkspace />
    </RightPaneProvider>
  );
}

function AppWorkspace() {
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const { target, close } = useRightPane();
  const [location, navigate] = useLocation();

  useEffect(() => {
    startWs();
  }, []);

  useHotkey('Mod+J', () => navigate('/journal'));

  // keeps the store's page list fresh for the [[ autocomplete and the pages
  // view; location is a dep so auto-created pages show up after navigation
  useEffect(() => {
    void api.listPages().then((list) => installPages(list));
    void api.listPinFolders().then((list) => installPinFolders(list));
  }, [remoteEpoch, location]);

  return (
    <SidebarProvider
      className="h-svh"
      defaultOpen={!document.cookie.includes('sidebar_state=false')}
    >
      <CommandPalette />
      <AppSidebar />
      <SidebarInset className="md:peer-data-[variant=inset]:[box-shadow:var(--shadow-sidebar-inset)]">
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <Switch>
              <Route path="/journal" component={JournalView} />
              <Route path="/pages" component={PagesView} />
              <Route path="/tasks" component={TasksView} />
              <Route path="/p/:id">
                {(params) => <PageView key={params.id} id={params.id} />}
              </Route>
              <Route path="/b/:id">
                {(params) => <ZoomView key={params.id} id={params.id} />}
              </Route>
              <Route path="/">
                <Redirect to="/journal" replace />
              </Route>
              <Route>
                <p className="p-10 text-muted-foreground">Not found.</p>
              </Route>
            </Switch>
          </div>
          {target && (
            <aside
              aria-label="Side pane"
              className="hidden min-h-0 min-w-0 w-1/2 shrink-0 border-l md:block"
            >
              {target.kind === 'page' ? (
                <PageView
                  key={`right:page:${target.id}`}
                  id={target.id}
                  surface="right"
                  onClose={close}
                />
              ) : (
                <ZoomView
                  key={`right:block:${target.id}`}
                  id={target.id}
                  surface="right"
                  onClose={close}
                />
              )}
            </aside>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
