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
    type: z.literal('rename_page'),
    id,
    // guards stale/offline replays from undoing a newer rename
    oldTitle: z.string().min(1),
    title: z.string().trim().min(1),
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
    kind: z.enum(['text', 'drawing', 'doc']),
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
    // fractional index among its pinned siblings; null = unpin
    orderKey: z.string().min(1).nullable(),
    // pin folder to sit in; null/absent = top level. Optional so ops queued
    // offline before folders existed still validate; absent reads as null.
    folderId: id.nullable().optional(),
  }),
  z.object({
    type: z.literal('create_pin_folder'),
    id,
    name: z.string().min(1),
    // fractional index shared with the top-level pages' pinned order keys
    orderKey: z.string().min(1),
  }),
  z.object({
    type: z.literal('rename_pin_folder'),
    id,
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('move_pin_folder'),
    id,
    orderKey: z.string().min(1),
  }),
  z.object({
    type: z.literal('set_pin_folder_collapsed'),
    id,
    collapsed: z.boolean(),
  }),
  z.object({
    // unpins the pages inside; the folder is not a container for content
    type: z.literal('delete_pin_folder'),
    id,
  }),
]);

export type Op = z.infer<typeof opSchema>;

/**
 * The ops that touch only the pinned sidebar's folders. Interpreters branch on
 * this once and hand the group to a dedicated exhaustive switch, instead of
 * carrying five extra cases through the block/page reducers.
 */
export const PIN_FOLDER_OP_TYPES = [
  'create_pin_folder',
  'rename_pin_folder',
  'move_pin_folder',
  'set_pin_folder_collapsed',
  'delete_pin_folder',
] as const;

export type PinFolderOp = Extract<
  Op,
  { type: (typeof PIN_FOLDER_OP_TYPES)[number] }
>;

export function isPinFolderOp(op: Op): op is PinFolderOp {
  return (PIN_FOLDER_OP_TYPES as readonly string[]).includes(op.type);
}

export const opsRequestSchema = z.object({
  clientId: z.string().min(1),
  ops: z.array(opSchema).min(1),
});

export type OpsRequest = z.infer<typeof opsRequestSchema>;
