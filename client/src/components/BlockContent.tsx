import { parseTask, type Block } from '@taproot/shared';
import { Check } from 'lucide-react';
import { toggleTaskCheckbox } from '@/actions';
import { cn } from '@/lib/utils';
import { StaticText } from './StaticText';

/** Static (non-editing) block content, task-aware: TODO/DONE markers render as a checkbox. */
export function BlockContent({ block }: { block: Block }) {
  const task = parseTask(block.text);
  if (!task) return <StaticText text={block.text} />;

  const done = task.state === 'DONE';
  return (
    <>
      <button
        onClick={(event) => {
          event.stopPropagation();
          toggleTaskCheckbox(block.id);
        }}
        title={done ? 'Reopen task' : 'Complete task'}
        className={cn(
          'mr-1.5 inline-flex h-[15px] w-[15px] translate-y-[2px] items-center justify-center rounded-[4px] border transition-colors',
          done
            ? 'border-transparent bg-muted-foreground/50 text-background'
            : 'border-muted-foreground/60 hover:border-foreground',
        )}
      >
        {done && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </button>
      <StaticText
        text={task.rest}
        className={cn(done && 'text-muted-foreground line-through')}
      />
    </>
  );
}
