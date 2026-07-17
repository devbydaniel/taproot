import type { Op, Page } from '@taproot/shared';

/**
 * Pure helpers for reconciling offline-created page ids with the server.
 * A queued create_page whose title already exists server-side (auto-created
 * via ensurePage or a wikilink while this client was offline) must be
 * dropped, and every queued block on it re-pointed at the server's page id.
 * Block ids never remap — they are only ever minted by this client.
 */

/** localId → serverId for queued create_page ops whose title exists remotely */
export function findPageRemaps(
  queuedOps: Op[],
  serverPages: Page[],
): Map<string, string> {
  const byTitle = new Map(serverPages.map((p) => [p.title, p.id]));
  const mapping = new Map<string, string>();
  for (const op of queuedOps) {
    if (op.type !== 'create_page') continue;
    const serverId = byTitle.get(op.title);
    if (serverId !== undefined && serverId !== op.id)
      mapping.set(op.id, serverId);
  }
  return mapping;
}

/**
 * Rewrite one record's ops through the mapping. Returns the input array
 * unchanged (same reference) when nothing matched, so callers can skip
 * persisting untouched records.
 */
export function remapOps(ops: Op[], mapping: Map<string, string>): Op[] {
  let touched = false;
  const out: Op[] = [];
  for (const op of ops) {
    if (op.type === 'create_page' && mapping.has(op.id)) {
      touched = true; // the server already has this page; drop the create
      continue;
    }
    if (op.type === 'create_block') {
      const serverId = mapping.get(op.pageId);
      if (serverId !== undefined) {
        touched = true;
        out.push({ ...op, pageId: serverId });
        continue;
      }
    }
    out.push(op);
  }
  return touched ? out : ops;
}
