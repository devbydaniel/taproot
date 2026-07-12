import { z } from '@hono/zod-openapi';
import type { Op } from '@taproot/shared';

// ---------------------------------------------------------------------------
// Shapes of the agent API, defined once as zod schemas like the op shapes:
// the routes in agentApi.ts cite them in createRoute definitions, which
// generate the OpenAPI document AND type-check the handlers against them —
// docs and code cannot drift. The .openapi('Name') tag is the
// components/schemas name. Response schemas are never used to parse at
// runtime; TS types are inferred from them.
// ---------------------------------------------------------------------------

// the status parameter narrows per function so each route can declare (and
// the compiler can enforce) exactly the error codes it may actually return
export interface AgentFailure<S extends 400 | 404 = 400 | 404> {
  error: string;
  status: S;
}

/** Ops were applied; the route must broadcast them (clientId 'agent'). */
export interface AgentWrite<T> {
  ops: Op[];
  result: T;
}

export function isFailure(value: unknown): value is AgentFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    'status' in value
  );
}

export const fail = <S extends 400 | 404>(
  status: S,
  error: string,
): AgentFailure<S> => ({
  error,
  status,
});

// ---------------------------------------------------------------------------
// Block trees: agents see nested {id, text, children} — never orderKeys
// (order is array order), never collapsed/timestamps, and drawing payloads
// stay opaque (kind marks them, data is withheld).
// ---------------------------------------------------------------------------

export interface AgentBlockNode {
  id: string;
  text: string;
  kind?: 'drawing';
  children?: AgentBlockNode[];
}

const agentBlockNodeSchema: z.ZodType<AgentBlockNode> = z
  .lazy(() =>
    z.object({
      id: z.string(),
      text: z
        .string()
        .describe('Block text — [[wikilinks]] and TODO/DONE markers verbatim'),
      kind: z
        .literal('drawing')
        .optional()
        .describe(
          'Present only for drawing blocks; their content is opaque — do not edit their text',
        ),
      children: z
        .array(agentBlockNodeSchema)
        .optional()
        .describe('Child blocks in display order'),
    }),
  )
  .openapi('BlockNode');

const pageRefSchema = z.object({ id: z.string(), title: z.string() });

const agentRefGroupSchema = z
  .object({
    pageTitle: z.string().describe('The page the referencing blocks live on'),
    blocks: z
      .array(agentBlockNodeSchema)
      .describe('Referencing blocks with their full subtrees'),
  })
  .openapi('RefGroup');
export type AgentRefGroup = z.infer<typeof agentRefGroupSchema>;

// ---------------------------------------------------------------------------
// Page addressing: agents name pages by title or by natural-language date
// phrase ("today", "next friday", "15.7."), never by id.
// ---------------------------------------------------------------------------

export const DATE_VOCABULARY =
  'today/tomorrow/yesterday, weekday names ("wed", "next wed"), "next week", ' +
  '"in N days/weeks", "jul 15" / "15 jul" / "15.7." / "15.7.2027", ' +
  'a bare day of month ("15"), or an ISO date (2026-07-15)';

export const pageTargetSchema = z.object({
  title: z
    .string()
    .optional()
    .describe('Exact page title. Pass exactly one of title or date.'),
  date: z
    .string()
    .optional()
    .describe(
      `Natural-language date resolved to a daily page: ${DATE_VOCABULARY}`,
    ),
});
export type PageTarget = z.infer<typeof pageTargetSchema>;

// ---------------------------------------------------------------------------
// Read payloads
// ---------------------------------------------------------------------------

export const agentOverviewSchema = z
  .object({
    today: z.string().describe("Today's daily-page title (YYYY-MM-DD)"),
    pages: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          blockCount: z.number(),
          pinned: z.boolean(),
        }),
      )
      .describe('Every page in the graph, alphabetical by title'),
    openTasks: z.number().describe('Number of open TODO blocks in the graph'),
  })
  .openapi('Overview');
export type AgentOverview = z.infer<typeof agentOverviewSchema>;

const agentSearchResultSchema = z
  .object({
    blockId: z.string(),
    pageTitle: z.string(),
    text: z.string(),
    breadcrumb: z
      .array(z.string())
      .describe('Ancestor block texts, outermost first'),
  })
  .openapi('SearchResult');

export const agentSearchPayloadSchema = z
  .object({
    results: z
      .array(agentSearchResultSchema)
      .describe('Blocks matching every term, most recently updated first'),
    pageMatches: z
      .array(z.string())
      .describe('Page titles matching every term (max 10)'),
    hasMore: z.boolean(),
  })
  .openapi('SearchPayload');
export type AgentSearchPayload = z.infer<typeof agentSearchPayloadSchema>;

export const agentPagePayloadSchema = z
  .object({
    page: pageRefSchema,
    blocks: z.array(agentBlockNodeSchema).describe("The page's own block tree"),
    linkedRefs: z
      .array(agentRefGroupSchema)
      .describe('Blocks on other pages that [[link]] to this page'),
  })
  .openapi('PagePayload');
export type AgentPagePayload = z.infer<typeof agentPagePayloadSchema>;

export const agentBlockPayloadSchema = z
  .object({
    pageTitle: z.string(),
    breadcrumb: z
      .array(z.object({ id: z.string(), text: z.string() }))
      .describe('Ancestor blocks, outermost first'),
    block: agentBlockNodeSchema,
  })
  .openapi('BlockPayload');
export type AgentBlockPayload = z.infer<typeof agentBlockPayloadSchema>;

const agentTaskGroupSchema = z
  .object({
    pageTitle: z.string().describe('The page the task blocks live on'),
    tasks: z
      .array(agentBlockNodeSchema)
      .describe('Task blocks with their full subtrees'),
  })
  .openapi('TaskGroup');
export type AgentTaskGroup = z.infer<typeof agentTaskGroupSchema>;

export const agentTasksPayloadSchema = z
  .object({
    groups: z
      .array(agentTaskGroupSchema)
      .describe('Daily pages first (newest first), then named pages A-Z'),
  })
  .openapi('TasksPayload');

export const agentPageRefsPayloadSchema = z
  .object({
    page: pageRefSchema
      .nullable()
      .describe('null when the page does not exist (this read never creates)'),
    groups: z.array(agentRefGroupSchema),
  })
  .openapi('PageRefsPayload');
export type AgentPageRefsPayload = z.infer<typeof agentPageRefsPayloadSchema>;

export const agentPageTasksPayloadSchema = z
  .object({
    page: pageRefSchema
      .nullable()
      .describe('null when the page does not exist (this read never creates)'),
    groups: z
      .array(agentTaskGroupSchema)
      .describe('Matching tasks grouped by the page they live on'),
  })
  .openapi('PageTasksPayload');
export type AgentPageTasksPayload = z.infer<typeof agentPageTasksPayloadSchema>;

export const agentJournalPayloadSchema = z
  .object({
    days: z
      .array(
        z.object({
          date: z.string().describe('Daily-page title (YYYY-MM-DD)'),
          blocks: z.array(agentBlockNodeSchema),
          linkedRefs: z.array(agentRefGroupSchema),
        }),
      )
      .describe('Daily pages, newest first'),
    hasMore: z.boolean(),
  })
  .openapi('JournalPayload');
export type AgentJournalPayload = z.infer<typeof agentJournalPayloadSchema>;

// ---------------------------------------------------------------------------
// Write requests and results
// ---------------------------------------------------------------------------

export interface AgentInputNode {
  text: string;
  children?: AgentInputNode[];
}

const inputNodeSchema: z.ZodType<AgentInputNode> = z
  .lazy(() =>
    z.object({
      text: z
        .string()
        .describe(
          "Single line of block text. May contain [[Page Title]] wikilinks (linked pages auto-create), a leading 'TODO ' or 'DONE ' task marker, and an <every ...> recurrence rule (e.g. '<every 3 days>', '<every monday>').",
        ),
      children: z
        .array(inputNodeSchema)
        .optional()
        .describe('Nested child blocks'),
    }),
  )
  .openapi('InputNode');

export const appendRequestSchema = z
  .object({
    page: z
      .string()
      .optional()
      .describe(
        'Target page by exact title; created if missing. Pass exactly one of page, date, or parentBlockId.',
      ),
    date: z
      .string()
      .optional()
      .describe(
        `Target daily page by natural-language date (created if missing): ${DATE_VOCABULARY}`,
      ),
    parentBlockId: z
      .string()
      .optional()
      .describe('Insert the new blocks as children of this existing block'),
    position: z
      .enum(['first', 'last'])
      .optional()
      .describe("Placement among existing siblings (default 'last')"),
    blocks: z
      .array(inputNodeSchema)
      .min(1)
      .describe(
        'Block trees to create, in order. Text containing newlines (and no children) is split into consecutive sibling blocks.',
      ),
  })
  .openapi('AppendRequest');
export type AppendRequest = z.infer<typeof appendRequestSchema>;

export const agentAppendResultSchema = z
  .object({
    page: pageRefSchema.describe(
      'The page written to (created if it was missing)',
    ),
    created: z
      .array(agentBlockNodeSchema)
      .describe(
        'The created blocks with their server-generated ids — keep the ids for follow-up edits',
      ),
  })
  .openapi('AppendResult');
export type AgentAppendResult = z.infer<typeof agentAppendResultSchema>;

export const updateTextRequestSchema = z
  .object({
    text: z
      .string()
      .describe('Replacement text for the block (single line, no newlines)'),
  })
  .openapi('UpdateTextRequest');

export const agentUpdateResultSchema = z
  .object({ id: z.string(), text: z.string() })
  .openapi('UpdateTextResult');

export const taskStateRequestSchema = z
  .object({
    state: z
      .enum(['TODO', 'DONE', 'none'])
      .describe(
        "'DONE' on an open recurring task (<every ...>) also creates the next instance; 'none' removes the task marker",
      ),
  })
  .openapi('TaskStateRequest');

export const agentTaskResultSchema = z
  .object({
    id: z.string(),
    text: z.string().describe('The block text after the state change'),
    spawned: z
      .object({ id: z.string(), text: z.string() })
      .nullable()
      .describe(
        'Next instance auto-created when completing a recurring (<every ...>) task; null otherwise',
      ),
  })
  .openapi('TaskResult');
export type AgentTaskResult = z.infer<typeof agentTaskResultSchema>;

export const moveRequestSchema = z
  .object({
    parentBlockId: z
      .string()
      .nullable()
      .optional()
      .describe(
        'New parent block id, or null for the page top level. Same page only. Pass exactly one of parentBlockId, afterBlockId, or beforeBlockId.',
      ),
    position: z
      .enum(['first', 'last'])
      .optional()
      .describe(
        "Placement among the new siblings (default 'last'); only used with parentBlockId",
      ),
    afterBlockId: z
      .string()
      .optional()
      .describe('Place the block directly after this sibling'),
    beforeBlockId: z
      .string()
      .optional()
      .describe('Place the block directly before this sibling'),
  })
  .openapi('MoveRequest');
export type MoveRequest = z.infer<typeof moveRequestSchema>;

export const agentMoveResultSchema = z
  .object({
    id: z.string(),
    parentId: z
      .string()
      .nullable()
      .describe('The new parent block id, or null for the page top level'),
    pageTitle: z.string(),
  })
  .openapi('MoveResult');
export type AgentMoveResult = z.infer<typeof agentMoveResultSchema>;

export const agentDeleteResultSchema = z
  .object({
    deleted: z.object({
      id: z.string(),
      descendants: z
        .number()
        .describe('How many descendant blocks were deleted with it'),
    }),
  })
  .openapi('DeleteResult');
export type AgentDeleteResult = z.infer<typeof agentDeleteResultSchema>;
