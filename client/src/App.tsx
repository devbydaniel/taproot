import { useHotkey } from '@tanstack/react-hotkeys';
import { Menu, Search, Sprout } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { CommandPalette } from '@/components/CommandPalette';
import { Sidebar } from '@/components/Sidebar';
import { api } from '@/lib/api';
import { startWs } from '@/lib/ws';
import { JournalView } from '@/pages/JournalView';
import { PagesView } from '@/pages/PagesView';
import { PageView } from '@/pages/PageView';
import { TasksView } from '@/pages/TasksView';
import { ZoomView } from '@/pages/ZoomView';
import { useStore } from '@/store';

export function App() {
  const remoteEpoch = useStore((s) => s.remoteEpoch);
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    startWs();
  }, []);

  // the mobile drawer closes on any navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  useHotkey('Mod+J', () => navigate('/journal'));

  // keeps the store's page list fresh for the [[ autocomplete and the pages
  // view; location is a dep so auto-created pages show up after navigation
  useEffect(() => {
    void api.listPages().then((list) => useStore.getState().setPages(list));
  }, [remoteEpoch, location]);

  return (
    <div className="flex h-dvh">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            title="Menu"
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Sprout className="ml-1 h-5 w-5 text-foreground" />
          <span className="font-semibold tracking-tight">Taproot</span>
          <button
            onClick={() => setPaletteOpen(true)}
            title="Search pages"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
          >
            <Search className="h-5 w-5" />
          </button>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
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
        </main>
      </div>
    </div>
  );
}
