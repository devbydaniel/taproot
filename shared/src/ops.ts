import { z } from 'zod';

/**
 * All writes are expressed as small idempotent operations. The client applies
 * them optimistically and posts them to the server; the server validates them
 * against these schemas at the HTTP boundary, applies them transactionally,
 * maintains the derived indexes, and broadcasts them to other clients.
 *
 * The zod schemas are the single source of truth for op shapes — the TS types
 * are inferred from them, so compile-time types and runtime validation cannot
 * drift apart.
 */

const id = z.string().min(1);

export const opSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_page'),
    id,
    title: z.string().min(1),
  }),
  z.object({
    type: z.literal('create_block'),
    id,
    pageId: id,
    // null = top-level block of the page
    parentId: id.nullable(),
    // fractional index key; siblings sort lexicographically
    orderKey: z.string().min(1),
    text: z.string(),
  }),
  z.object({
    type: z.literal('update_text'),
    id,
    text: z.string(),
  }),
  z.object({
    type: z.literal('move_block'),
    id,
    parentId: id.nullable(),
    orderKey: z.string().min(1),
  }),
  z.object({
    type: z.literal('delete_block'),
    id,
  }),
  z.object({
    type: z.literal('set_collapsed'),
    id,
    collapsed: z.boolean(),
  }),
  z.object({
    type: z.literal('set_kind'),
    id,
    kind: z.enum(['text', 'drawing']),
  }),
  z.object({
    type: z.literal('update_data'),
    id,
    // opaque payload for non-text kinds; bounded so a scene can't blow up
    // request bodies or the WebSocket broadcast
    data: z.string().max(2_000_000).nullable(),
  }),
  z.object({
    type: z.literal('set_page_pinned'),
    id,
    // fractional index among pinned pages; null = unpin
    orderKey: z.string().min(1).nullable(),
  }),
]);

export type Op = z.infer<typeof opSchema>;

export const opsRequestSchema = z.object({
  clientId: z.string().min(1),
  ops: z.array(opSchema).min(1),
});

export type OpsRequest = z.infer<typeof opsRequestSchema>;
