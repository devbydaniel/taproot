import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { isDailyTitle, type Op, type OpsBroadcast } from '@taproot/shared';
import {
  agentGetBlock,
  agentGetPage,
  agentJournal,
  agentOverview,
  agentPageRefs,
  agentPageTasks,
  agentSearch,
  agentTasks,
} from './agent.js';
import {
  agentAppendResultSchema,
  agentBlockPayloadSchema,
  agentDeleteResultSchema,
  agentJournalPayloadSchema,
  agentMoveResultSchema,
  agentOverviewSchema,
  agentPagePayloadSchema,
  agentPageRefsPayloadSchema,
  agentPageTasksPayloadSchema,
  agentSearchPayloadSchema,
  agentTaskResultSchema,
  agentTasksPayloadSchema,
  agentUpdateResultSchema,
  appendRequestSchema,
  isFailure,
  moveRequestSchema,
  pageTargetSchema,
  taskStateRequestSchema,
  updateTextRequestSchema,
} from './agentSchemas.js';
import {
  agentAppend,
  agentDelete,
  agentMove,
  agentSetTaskState,
  agentUpdateText,
} from './agentWrites.js';
import type { Store } from './db.js';

// ---------------------------------------------------------------------------
// Route layer for /api/agent. Each createRoute definition is simultaneously
// the runtime validator and the OpenAPI documentation (served at
// /api/agent/openapi.json via doc31 below), so neither can drift from the
// other; handlers are type-checked against the declared response schemas.
// ---------------------------------------------------------------------------

const errorSchema = z
  .object({
    error: z
      .string()
      .describe('What went wrong and what to do instead — written for agents'),
  })
  .openapi('Error');

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
  required: true,
});

const jsonResponse = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const badRequest = jsonResponse(errorSchema, 'Invalid input');
const notFound = jsonResponse(errorSchema, 'Unknown id');

const blockIdParams = z.object({
  id: z.string().describe('Block id (from any read or write response)'),
});

const searchQuerySchema = z.object({
  q: z
    .string()
    .min(1)
    .describe(
      'Search terms; every whitespace-separated term must appear (case-insensitive substring match)',
    ),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe('Max results, 1-100 (default 20)'),
  offset: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe('Skip this many results (default 0)'),
});

const journalQuerySchema = z.object({
  before: z
    .string()
    .refine(isDailyTitle)
    .optional()
    .describe('Cursor: only days strictly before this YYYY-MM-DD title'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe('Days to return, 1-100 (default 5)'),
});

const pageTasksQuerySchema = pageTargetSchema.extend({
  state: z
    .enum(['TODO', 'DONE', 'all'])
    .optional()
    .describe("Filter by task state (default 'TODO')"),
});

const routes = {
  overview: createRoute({
    method: 'get',
    path: '/overview',
    operationId: 'getOverview',
    summary: "Orientation: today's date, all pages, open-task count",
    responses: { 200: jsonResponse(agentOverviewSchema, 'Graph overview') },
  }),
  search: createRoute({
    method: 'get',
    path: '/search',
    operationId: 'search',
    summary: 'Full-text search over block text and page titles',
    request: { query: searchQuerySchema },
    responses: {
      200: jsonResponse(
        agentSearchPayloadSchema,
        'Matches with ancestor breadcrumbs',
      ),
      400: badRequest,
    },
  }),
  getPage: createRoute({
    method: 'get',
    path: '/page',
    operationId: 'getPage',
    summary: 'Read a page by title or date (created if missing)',
    request: { query: pageTargetSchema },
    responses: {
      200: jsonResponse(
        agentPagePayloadSchema,
        'The page, its block tree, and linked references',
      ),
      400: badRequest,
    },
  }),
  pageRefs: createRoute({
    method: 'get',
    path: '/page/refs',
    operationId: 'getPageRefs',
    summary: 'Linked references of a page (read-only, never creates)',
    request: { query: pageTargetSchema },
    responses: {
      200: jsonResponse(
        agentPageRefsPayloadSchema,
        'Blocks on other pages linking here, grouped by page',
      ),
      400: badRequest,
    },
  }),
  pageTasks: createRoute({
    method: 'get',
    path: '/page/tasks',
    operationId: 'getPageTasks',
    summary:
      'Tasks whose text links to a page, e.g. everything open for [[Project X]]',
    request: { query: pageTasksQuerySchema },
    responses: {
      200: jsonResponse(
        agentPageTasksPayloadSchema,
        'Matching tasks grouped by the page they live on',
      ),
      400: badRequest,
    },
  }),
  tasks: createRoute({
    method: 'get',
    path: '/tasks',
    operationId: 'listOpenTasks',
    summary: 'All open TODO tasks across the graph, grouped by page',
    responses: { 200: jsonResponse(agentTasksPayloadSchema, 'Open tasks') },
  }),
  journal: createRoute({
    method: 'get',
    path: '/journal',
    operationId: 'getJournal',
    summary: 'Recent daily pages, newest first',
    request: { query: journalQuerySchema },
    responses: {
      200: jsonResponse(
        agentJournalPayloadSchema,
        'Daily pages with blocks and linked references',
      ),
      400: badRequest,
    },
  }),
  getBlock: createRoute({
    method: 'get',
    path: '/block/{id}',
    operationId: 'getBlock',
    summary: 'Read a block and its subtree',
    request: { params: blockIdParams },
    responses: {
      200: jsonResponse(
        agentBlockPayloadSchema,
        'The block subtree with page and breadcrumb',
      ),
      404: notFound,
    },
  }),
  createBlocks: createRoute({
    method: 'post',
    path: '/blocks',
    operationId: 'createBlocks',
    summary: 'Append a tree of blocks to a page, date, or parent block',
    request: { body: jsonBody(appendRequestSchema) },
    responses: {
      200: jsonResponse(
        agentAppendResultSchema,
        'Created blocks with their ids',
      ),
      400: badRequest,
      404: notFound,
    },
  }),
  updateText: createRoute({
    method: 'patch',
    path: '/block/{id}',
    operationId: 'updateBlockText',
    summary:
      "Replace a block's text (wikilinks and task markers re-index automatically)",
    request: { params: blockIdParams, body: jsonBody(updateTextRequestSchema) },
    responses: {
      200: jsonResponse(agentUpdateResultSchema, 'The updated block'),
      400: badRequest,
      404: notFound,
    },
  }),
  setTaskState: createRoute({
    method: 'post',
    path: '/block/{id}/task',
    operationId: 'setTaskState',
    summary:
      'Set task state; completing a recurring task spawns the next instance',
    request: { params: blockIdParams, body: jsonBody(taskStateRequestSchema) },
    responses: {
      200: jsonResponse(
        agentTaskResultSchema,
        'New text, plus the spawned next instance if any',
      ),
      400: badRequest,
      404: notFound,
    },
  }),
  move: createRoute({
    method: 'post',
    path: '/block/{id}/move',
    operationId: 'moveBlock',
    summary:
      'Move a block within its page (new parent, or before/after a sibling)',
    request: { params: blockIdParams, body: jsonBody(moveRequestSchema) },
    responses: {
      200: jsonResponse(agentMoveResultSchema, 'The new position'),
      400: badRequest,
      404: notFound,
    },
  }),
  deleteBlock: createRoute({
    method: 'delete',
    path: '/block/{id}',
    operationId: 'deleteBlock',
    summary: 'Delete a block and its whole subtree',
    request: { params: blockIdParams },
    responses: {
      200: jsonResponse(agentDeleteResultSchema, 'What was deleted'),
      404: notFound,
    },
  }),
};

const apiDescription = `Taproot is an outliner: pages hold a tree of single-line blocks.

Concepts:
- Page titles are unique. Daily (journal) pages are titled YYYY-MM-DD.
- [[Page Title]] inside block text links to that page (auto-creating it) and makes the block appear in the target page's linked references.
- A block is a task iff its text starts with 'TODO ' or 'DONE '. Prefer the task endpoint over editing the marker yourself.
- An <every ...> token in a task makes it recurring; completing it via the task endpoint spawns the next instance.
- Blocks are ordered by their array position; ids come back from every read and write — keep them for follow-up edits.

Start with GET /overview. Errors are always {"error": "..."} and say what to do instead.`;

export function createAgentApi(
  store: Store,
  broadcast: (message: OpsBroadcast) => void,
) {
  // agent writes broadcast like any client's; browsers only suppress their
  // own clientId, so the fixed 'agent' id reaches every open tab
  const emit = (ops: Op[]) => {
    if (ops.length > 0) broadcast({ type: 'ops', clientId: 'agent', ops });
  };

  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) =>
            issue.path.length
              ? `${issue.path.join('.')}: ${issue.message}`
              : issue.message,
          )
          .join('; ');
        return c.json({ error: `invalid request — ${detail}` }, 400);
      }
    },
  })
    .openapi(routes.overview, (c) => c.json(agentOverview(store), 200))
    .openapi(routes.search, (c) => {
      const { q, limit, offset } = c.req.valid('query');
      return c.json(
        agentSearch(store, { q, limit: num(limit), offset: num(offset) }),
        200,
      );
    })
    .openapi(routes.getPage, (c) => {
      const out = agentGetPage(store, c.req.valid('query'));
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      emit(out.ops);
      return c.json(out.result, 200);
    })
    .openapi(routes.pageRefs, (c) => {
      const out = agentPageRefs(store, c.req.valid('query'));
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      return c.json(out, 200);
    })
    .openapi(routes.pageTasks, (c) => {
      const { state, ...target } = c.req.valid('query');
      const out = agentPageTasks(store, target, state);
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      return c.json(out, 200);
    })
    .openapi(routes.tasks, (c) => c.json(agentTasks(store), 200))
    .openapi(routes.journal, (c) => {
      const { before, limit } = c.req.valid('query');
      return c.json(agentJournal(store, { before, limit: num(limit) }), 200);
    })
    .openapi(routes.getBlock, (c) => {
      const out = agentGetBlock(store, c.req.valid('param').id);
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      return c.json(out, 200);
    })
    .openapi(routes.createBlocks, (c) => {
      const out = agentAppend(store, c.req.valid('json'));
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      emit(out.ops);
      return c.json(out.result, 200);
    })
    .openapi(routes.updateText, (c) => {
      const out = agentUpdateText(
        store,
        c.req.valid('param').id,
        c.req.valid('json').text,
      );
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      emit(out.ops);
      return c.json(out.result, 200);
    })
    .openapi(routes.setTaskState, (c) => {
      const out = agentSetTaskState(
        store,
        c.req.valid('param').id,
        c.req.valid('json').state,
      );
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      emit(out.ops);
      return c.json(out.result, 200);
    })
    .openapi(routes.move, (c) => {
      const out = agentMove(
        store,
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      emit(out.ops);
      return c.json(out.result, 200);
    })
    .openapi(routes.deleteBlock, (c) => {
      const out = agentDelete(store, c.req.valid('param').id);
      if (isFailure(out)) return c.json({ error: out.error }, out.status);
      emit(out.ops);
      return c.json(out.result, 200);
    })
    .doc31('/openapi.json', {
      openapi: '3.1.0',
      info: {
        title: 'Taproot Agent API',
        version: '1.0.0',
        description: apiDescription,
      },
      servers: [{ url: '/api/agent' }],
    });
}

const num = (value: string | undefined) =>
  value === undefined ? undefined : Number(value);
