import { useHotkey } from '@tanstack/react-hotkeys';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { api } from '@/lib/api';
import { setPaletteOpen, usePaletteOpen } from '@/lib/palette';
import { useStore } from '@/store';

export function CommandPalette() {
  const open = usePaletteOpen();
  const [query, setQuery] = useState('');
  const pages = useStore((s) => s.pages);
  const [, navigate] = useLocation();

  useHotkey('Mod+K', () => {
    setQuery('');
    setPaletteOpen(!open);
  });

  const onOpenChange = (next: boolean) => {
    setPaletteOpen(next);
    if (!next) setQuery('');
  };

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

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search pages"
      description="Search pages by title or create a new one"
      showCloseButton={false}
      // pin near the top so the dialog doesn't jump as the list filters
      className="top-[20%] translate-y-0"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search pages…"
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {pages.map((page) => (
          <CommandItem
            key={page.id}
            value={page.title}
            onSelect={() => go(page.id)}
          >
            <FileText className="text-muted-foreground" />
            <span className="truncate">{page.title}</span>
          </CommandItem>
        ))}
        {showCreate && (
          <CommandItem
            forceMount
            value={`create:${trimmed}`}
            onSelect={() => void createAndGo()}
          >
            <Plus className="text-muted-foreground" />
            <span className="truncate">Create page “{trimmed}”</span>
          </CommandItem>
        )}
      </CommandList>
    </CommandDialog>
  );
}
