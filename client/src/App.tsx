import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Sidebar } from '@/components/Sidebar';
import { api } from '@/lib/api';
import { startWs } from '@/lib/ws';
import { PageView } from '@/pages/PageView';
import { TasksView } from '@/pages/TasksView';
import { ZoomView } from '@/pages/ZoomView';

function HomeRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    void api
      .pageByTitle('Welcome')
      .then((page) => navigate(`/p/${page.id}`, { replace: true }));
  }, [navigate]);
  return null;
}

export function App() {
  useEffect(() => {
    startWs();
  }, []);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Switch>
          <Route path="/tasks" component={TasksView} />
          <Route path="/p/:id">
            {(params) => <PageView key={params.id} id={params.id} />}
          </Route>
          <Route path="/b/:id">
            {(params) => <ZoomView key={params.id} id={params.id} />}
          </Route>
          <Route path="/" component={HomeRedirect} />
          <Route>
            <p className="p-10 text-muted-foreground">Not found.</p>
          </Route>
        </Switch>
      </main>
    </div>
  );
}
