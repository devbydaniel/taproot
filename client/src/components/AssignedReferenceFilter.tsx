import { Filter } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './ui/combobox';

const ALL_OPTION = '\u0000all';

/** Selection state shared by the Tasks and Linked References section filters. */
export function useAssignedReferenceFilter(
  options: string[],
  resetKey: string,
) {
  const [selectedTitles, setSelectedTitles] = useState<Set<string>>(new Set());

  useEffect(() => setSelectedTitles(new Set()), [resetKey]);

  // A live edit can remove the selected reference from every item. Return to
  // All rather than leaving an invisible, permanently empty filter active.
  useEffect(() => {
    const available = new Set(options);
    setSelectedTitles((current) => {
      if ([...current].every((title) => available.has(title))) return current;
      return new Set([...current].filter((title) => available.has(title)));
    });
  }, [options]);

  return { selectedTitles, setSelectedTitles };
}

export function AssignedReferenceFilter({
  options,
  selectedTitles,
  onSelectedTitlesChange,
}: {
  options: string[];
  selectedTitles: ReadonlySet<string>;
  onSelectedTitlesChange: (titles: Set<string>) => void;
}) {
  const filtering = selectedTitles.size > 0;
  const items = [ALL_OPTION, ...options];
  const value = filtering ? [...selectedTitles] : [ALL_OPTION];

  return (
    <Combobox
      items={items}
      multiple
      value={value}
      onValueChange={(nextValue) => {
        if (!filtering && nextValue.length > 1) {
          onSelectedTitlesChange(
            new Set(nextValue.filter((item) => item !== ALL_OPTION)),
          );
        } else if (nextValue.includes(ALL_OPTION)) {
          onSelectedTitlesChange(new Set());
        } else {
          onSelectedTitlesChange(new Set(nextValue));
        }
      }}
      itemToStringValue={(item) => (item === ALL_OPTION ? 'All' : item)}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Filter by assigned reference"
            title="Filter by assigned reference"
          />
        }
        className={cn(
          'ml-auto -mr-1 [&_[data-slot=combobox-trigger-icon]]:hidden',
          filtering
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Filter />
      </ComboboxTrigger>
      <ComboboxContent align="end" className="w-64">
        <ComboboxInput
          showTrigger={false}
          placeholder="Search references…"
          autoFocus
        />
        <ComboboxEmpty>No references found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item === ALL_OPTION ? 'All' : item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
