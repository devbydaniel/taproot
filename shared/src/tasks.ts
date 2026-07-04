export type TaskState = 'TODO' | 'DONE';

const TASK_RE = /^(TODO|DONE)(?: |$)/;

/** A block is a task iff its text starts with a task marker. */
export function parseTask(
  text: string,
): { state: TaskState; rest: string } | null {
  const match = TASK_RE.exec(text);
  if (!match) return null;
  return { state: match[1] as TaskState, rest: text.slice(match[0].length) };
}

/** Replace (or remove, with null) the task marker, keeping the rest of the text. */
export function withTaskState(text: string, state: TaskState | null): string {
  const parsed = parseTask(text);
  const rest = parsed ? parsed.rest : text;
  return state === null ? rest : `${state} ${rest}`;
}

/** Cmd-Enter cycle: plain → TODO → DONE → plain. */
export function cycleTaskState(text: string): string {
  const parsed = parseTask(text);
  if (!parsed) return withTaskState(text, 'TODO');
  return withTaskState(text, parsed.state === 'TODO' ? 'DONE' : null);
}
