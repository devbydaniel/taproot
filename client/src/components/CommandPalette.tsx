import { useHotkey } from '@tanstack/react-hotkeys';
import { Command } from 'cmdk';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/lib/api';
import { useStore } from '@/store';

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const pages = useStore((s) => s.pages);
  const [, navigate] = useLocation();

  useHotkey('Mod+K', () => {
    setQuery('');
    onOpenChange(!open);
  });

  const go = (id: string) => {
    onOpenChange(false);
    navigate(`/p/${id}`);
  };

  const createAndGo = async () => {
    const page = await api.pageByTitle(query.trim());
    go(page.id);
  };

  const trimmed = query.trim();
  const showCreate =
    trimmed !== '' &&
    !pages.some((p) => p.title.toLowerCase() === trimmed.toLowerCase());

  const itemClass =
    'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground';

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
      label="Search pages"
      overlayClassName="fixed inset-0 z-50 bg-black/40"
      contentClassName="fixed top-[20%] left-1/2 z-50 w-full max-w-md -translate-x-1/2 px-4"
    >
      <div className="overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          autoFocus
          placeholder="Search pages…"
          className="h-11 w-full border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-80 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            No results.
          </Command.Empty>
          {pages.map((page) => (
            <Command.Item
              key={page.id}
              value={page.title}
              onSelect={() => go(page.id)}
              className={itemClass}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{page.title}</span>
            </Command.Item>
          ))}
          {showCreate && (
            <Command.Item
              forceMount
              value={`create:${trimmed}`}
              onSelect={() => void createAndGo()}
              className={itemClass}
            >
              <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Create page “{trimmed}”</span>
            </Command.Item>
          )}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
