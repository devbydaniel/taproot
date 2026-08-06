/**
 * Label for a doc block's collapsed outline row: the first markdown heading,
 * or the first non-empty line when there is none. Null for an empty doc.
 */
export function docTitle(data: string | null): string | null {
  if (!data) return null;
  for (const line of data.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    return (heading ? heading[1]! : trimmed).trim() || null;
  }
  return null;
}
