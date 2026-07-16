import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createAgentApi } from './agentApi.js';
import { isFailure, type AgentBlockNode } from './agentSchemas.js';
import {
  agentAppend,
  agentDelete,
  agentMove,
  agentSetTaskState,
  agentUpdateText,
} from './agentWrites.js';
import { createApi } from './app.js';
import { createStore, type Store } from './db.js';
import { ensurePage } from './ops.js';
import { getPagePayload, listPages } from './queries.js';

let store: Store;

beforeEach(() => {
  store = createStore(':memory:');
});

/** Unwrap a success result; fails the test on an AgentFailure. */
function ok<T>(value: T): Exclude<T, { error: string; status: number }> {
  if (isFailure(value)) {
    throw new Error(`unexpected failure: ${value.error}`);
  }
  return value as Exclude<T, { error: string; status: number }>;
}

const texts = (nodes: AgentBlockNode[] | undefined): string[] =>
  (nodes ?? []).map((n) => n.text);

describe('agentAppend', () => {
  it('creates the page and nested blocks for a new title', () => {
    const out = ok(
      agentAppend(store, {
        page: 'Project X',
        blocks: [
          {
            text: 'Kickoff',
            children: [{ text: 'agenda' }, { text: 'notes' }],
          },
          { text: 'Second' },
        ],
      }),
    );
    expect(out.ops[0]).toMatchObject({
      type: 'create_page',
      title: 'Project X',
    });
    expect(out.result.page.title).toBe('Project X');

    const page = ok(agentGetPage(store, { title: 'Project X' }));
    expect(texts(page.result.blocks)).toEqual(['Kickoff', 'Second']);
    expect(texts(page.result.blocks[0]?.children)).toEqual(['agenda', 'notes']);
    // the echoed ids are the real block ids
    expect(page.result.blocks[0]?.id).toBe(out.result.created[0]?.id);
    expect(page.result.blocks[0]?.children?.[1]?.id).toBe(
      out.result.created[0]?.children?.[1]?.id,
    );
  });

  it('resolves natural-language dates to daily pages', () => {
    const now = new Date('2026-07-12T10:00');
    const out = ok(
      agentAppend(store, { date: 'tomorrow', blocks: [{ text: 'hi' }] }, now),
    );
    expect(out.result.page.title).toBe('2026-07-13');

    const bad = agentAppend(store, {
      date: 'whenever',
      blocks: [{ text: 'x' }],
    });
    expect(isFailure(bad) && bad.status).toBe(400);
  });

  it('requires exactly one target', () => {
    const none = agentAppend(store, { blocks: [{ text: 'x' }] });
    expect(isFailure(none) && none.status).toBe(400);
    const both = agentAppend(store, {
      page: 'A',
      date: 'today',
      blocks: [{ text: 'x' }],
    });
    expect(isFailure(both) && both.status).toBe(400);
  });

  it('inserts under a parent block at first/last position', () => {
    const seeded = ok(
      agentAppend(store, {
        page: 'Home',
        blocks: [{ text: 'parent', children: [{ text: 'middle' }] }],
      }),
    );
    const parentId = seeded.result.created[0]!.id;
    ok(
      agentAppend(store, {
        parentBlockId: parentId,
        blocks: [{ text: 'end' }],
      }),
    );
    ok(
      agentAppend(store, {
        parentBlockId: parentId,
        position: 'first',
        blocks: [{ text: 'start' }],
      }),
    );

    const zoom = ok(agentGetBlock(store, parentId));
    expect(texts(zoom.block.children)).toEqual(['start', 'middle', 'end']);
    expect(zoom.pageTitle).toBe('Home');

    const missing = agentAppend(store, {
      parentBlockId: 'nope',
      blocks: [{ text: 'x' }],
    });
    expect(isFailure(missing) && missing.status).toBe(404);
  });

  it('splits multi-line text into sibling blocks', () => {
    const out = ok(
      agentAppend(store, { page: 'Notes', blocks: [{ text: 'a\r\nb\n\nc' }] }),
    );
    expect(texts(out.result.created)).toEqual(['a', 'b', 'c']);

    const ambiguous = agentAppend(store, {
      page: 'Notes',
      blocks: [{ text: 'a\nb', children: [{ text: 'child' }] }],
    });
    expect(isFailure(ambiguous) && ambiguous.status).toBe(400);
  });
});

describe('agentGetPage', () => {
  it('get-or-create is idempotent and returns nested linked refs', () => {
    ok(
      agentAppend(store, {
        page: 'Journal notes',
        blocks: [{ text: 'about [[Topic]]', children: [{ text: 'detail' }] }],
      }),
    );
    const first = ok(agentGetPage(store, { title: 'Topic' }));
    expect(first.ops).toHaveLength(0); // wikilink already auto-created it
    const again = ok(agentGetPage(store, { title: 'Topic' }));
    expect(again.result.page.id).toBe(first.result.page.id);

    expect(first.result.linkedRefs).toHaveLength(1);
    const group = first.result.linkedRefs[0]!;
    expect(group.pageTitle).toBe('Journal notes');
    expect(texts(group.blocks)).toEqual(['about [[Topic]]']);
    expect(texts(group.blocks[0]?.children)).toEqual(['detail']);
  });

  it('creates a page on first read and emits the op', () => {
    const out = ok(agentGetPage(store, { title: 'Brand New' }));
    expect(out.ops[0]).toMatchObject({
      type: 'create_page',
      title: 'Brand New',
    });
    expect(listPages(store).map((p) => p.title)).toContain('Brand New');
  });

  it('since time-scopes the linkedRefs but not the page own blocks', () => {
    ok(agentAppend(store, { page: 'Topic', blocks: [{ text: 'own note' }] }));
    ok(
      agentAppend(store, {
        date: '2026-07-10',
        blocks: [{ text: 'early [[Topic]]' }],
      }),
    );
    ok(
      agentAppend(store, {
        date: '2026-07-14',
        blocks: [{ text: 'late [[Topic]]' }],
      }),
    );
    ok(
      agentAppend(store, {
        page: 'Named',
        blocks: [{ text: 'named [[Topic]]' }],
      }),
    );

    const scoped = ok(agentGetPage(store, { title: 'Topic' }, '2026-07-12'));
    // own blocks are untouched by since
    expect(texts(scoped.result.blocks)).toEqual(['own note']);
    // the pre-since daily group drops; later daily and named pages stay
    expect(scoped.result.linkedRefs.map((g) => g.pageTitle)).toEqual([
      '2026-07-14',
      'Named',
    ]);
  });
});

describe('agentSetTaskState', () => {
  it('completing a recurring task spawns the next instance after it', () => {
    const now = new Date('2026-07-12T10:00');
    const out = ok(
      agentAppend(store, {
        page: 'Chores',
        blocks: [
          { text: 'TODO water plants <every 3 days> [[2026-07-10]]' },
          { text: 'after' },
        ],
      }),
    );
    const taskId = out.result.created[0]!.id;

    const done = ok(agentSetTaskState(store, taskId, 'DONE', now));
    expect(done.result.text).toMatch(/^DONE water plants/);
    expect(done.result.spawned?.text).toBe(
      'TODO water plants <every 3 days> [[2026-07-13]]',
    );
    const page = ok(agentGetPage(store, { title: 'Chores' }));
    expect(texts(page.result.blocks)).toEqual([
      'DONE water plants <every 3 days> [[2026-07-10]]',
      'TODO water plants <every 3 days> [[2026-07-13]]',
      'after',
    ]);

    // DONE on an already-DONE task must not spawn again
    const repeat = ok(agentSetTaskState(store, taskId, 'DONE', now));
    expect(repeat.result.spawned).toBeNull();

    // 'none' strips the marker and clears the task index
    const spawnedId = done.result.spawned!.id;
    ok(agentSetTaskState(store, spawnedId, 'none', now));
    const open = agentTasks(store);
    expect(open.groups).toHaveLength(0);
  });
});

describe('agentUpdateText', () => {
  it('updates text and rejects newlines and unknown blocks', () => {
    const out = ok(
      agentAppend(store, { page: 'P', blocks: [{ text: 'old' }] }),
    );
    const id = out.result.created[0]!.id;
    ok(agentUpdateText(store, id, 'new [[Linked]]'));
    expect(listPages(store).map((p) => p.title)).toContain('Linked');

    const multi = agentUpdateText(store, id, 'a\nb');
    expect(isFailure(multi) && multi.status).toBe(400);
    const missing = agentUpdateText(store, 'nope', 'x');
    expect(isFailure(missing) && missing.status).toBe(404);
  });
});

describe('agentMove', () => {
  function seed() {
    const out = ok(
      agentAppend(store, {
        page: 'Doc',
        blocks: [
          { text: 'a', children: [{ text: 'a1' }] },
          { text: 'b' },
          { text: 'c' },
        ],
      }),
    );
    const [a, b, c] = out.result.created;
    return { a: a!, a1: a!.children![0]!, b: b!, c: c! };
  }

  it('moves after a sibling and to the page top level', () => {
    const { a, a1, c } = seed();
    ok(agentMove(store, c.id, { afterBlockId: a.id }));
    ok(agentMove(store, a1.id, { parentBlockId: null, position: 'first' }));
    const page = ok(agentGetPage(store, { title: 'Doc' }));
    expect(texts(page.result.blocks)).toEqual(['a1', 'a', 'c', 'b']);
  });

  it('rejects cycles instead of silently ignoring them', () => {
    const { a, a1 } = seed();
    const cycle = agentMove(store, a.id, { parentBlockId: a1.id });
    expect(isFailure(cycle) && cycle.status).toBe(400);
    const self = agentMove(store, a.id, { parentBlockId: a.id });
    expect(isFailure(self) && self.status).toBe(400);
  });

  it('rejects cross-page moves and ambiguous bodies', () => {
    const { a } = seed();
    const other = ok(
      agentAppend(store, { page: 'Other', blocks: [{ text: 'x' }] }),
    );
    const cross = agentMove(store, a.id, {
      parentBlockId: other.result.created[0]!.id,
    });
    expect(isFailure(cross) && cross.status).toBe(400);
    const ambiguous = agentMove(store, a.id, {
      parentBlockId: null,
      afterBlockId: a.id,
    });
    expect(isFailure(ambiguous) && ambiguous.status).toBe(400);
  });
});

describe('agentDelete', () => {
  it('deletes the subtree and reports the descendant count', () => {
    const out = ok(
      agentAppend(store, {
        page: 'Doc',
        blocks: [
          {
            text: 'root',
            children: [{ text: 'kid', children: [{ text: 'grandkid' }] }],
          },
          { text: 'stays' },
        ],
      }),
    );
    const del = ok(agentDelete(store, out.result.created[0]!.id));
    expect(del.result.deleted.descendants).toBe(2);
    const page = ok(agentGetPage(store, { title: 'Doc' }));
    expect(texts(page.result.blocks)).toEqual(['stays']);
  });
});

describe('agentSearch', () => {
  it('ANDs terms case-insensitively and reports page matches', () => {
    ok(
      agentAppend(store, {
        page: 'Alpha',
        blocks: [
          {
            text: 'context',
            children: [{ text: 'Water the GARDEN plants' }],
          },
          { text: 'water only' },
        ],
      }),
    );
    ok(agentAppend(store, { page: 'Garden log', blocks: [{ text: 'misc' }] }));

    const out = agentSearch(store, { q: 'water garden' });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.text).toBe('Water the GARDEN plants');
    expect(out.results[0]?.pageTitle).toBe('Alpha');
    expect(out.results[0]?.breadcrumb).toEqual(['context']);
    expect(out.pageMatches).toEqual([]);

    const byTitle = agentSearch(store, { q: 'garden' });
    expect(byTitle.pageMatches).toEqual(['Garden log']);
  });

  it('treats LIKE wildcards literally and paginates with hasMore', () => {
    ok(
      agentAppend(store, {
        page: 'P',
        blocks: [{ text: '100% done' }, { text: '100 pieces done' }],
      }),
    );
    const literal = agentSearch(store, { q: '100%' });
    expect(literal.results.map((r) => r.text)).toEqual(['100% done']);

    const page = ok(
      agentAppend(store, {
        page: 'Q',
        blocks: [{ text: 'match 1\nmatch 2\nmatch 3' }],
      }),
    );
    expect(page.result.created).toHaveLength(3);
    const first = agentSearch(store, { q: 'match', limit: 2 });
    expect(first.results).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const rest = agentSearch(store, { q: 'match', limit: 2, offset: 2 });
    expect(rest.results).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
  });
});

describe('agentPageRefs', () => {
  it('returns nested linked refs without creating missing pages', () => {
    ok(
      agentAppend(store, {
        page: 'Source',
        blocks: [{ text: 'see [[Target]]', children: [{ text: 'why' }] }],
      }),
    );
    const out = ok(agentPageRefs(store, { title: 'Target' }));
    expect(out.page?.title).toBe('Target');
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]?.pageTitle).toBe('Source');
    expect(texts(out.groups[0]?.blocks[0]?.children)).toEqual(['why']);

    const missing = ok(agentPageRefs(store, { title: 'Nowhere' }));
    expect(missing.page).toBeNull();
    expect(missing.groups).toEqual([]);
    expect(listPages(store).map((p) => p.title)).not.toContain('Nowhere');
  });

  it('since drops dated groups before it, keeping later dates and named pages', () => {
    ok(
      agentAppend(store, {
        date: '2026-07-10',
        blocks: [{ text: 'early [[T]]' }],
      }),
    );
    ok(
      agentAppend(store, {
        date: '2026-07-12',
        blocks: [{ text: 'on-day [[T]]' }],
      }),
    );
    ok(
      agentAppend(store, {
        date: '2026-07-14',
        blocks: [{ text: 'late [[T]]' }],
      }),
    );
    ok(
      agentAppend(store, {
        page: 'Project',
        blocks: [{ text: 'named [[T]]' }],
      }),
    );

    const filtered = ok(agentPageRefs(store, { title: 'T' }, '2026-07-12'));
    // since is inclusive: the boundary day stays; only strictly-earlier days drop
    expect(filtered.groups.map((g) => g.pageTitle)).toEqual([
      '2026-07-14',
      '2026-07-12',
      'Project',
    ]);

    // without since every group is returned (dailies newest-first, then named)
    const all = ok(agentPageRefs(store, { title: 'T' }));
    expect(all.groups.map((g) => g.pageTitle)).toEqual([
      '2026-07-14',
      '2026-07-12',
      '2026-07-10',
      'Project',
    ]);
  });

  it('since leaves a page with only non-daily refs untouched', () => {
    ok(agentAppend(store, { page: 'Source', blocks: [{ text: 'see [[T]]' }] }));
    const out = ok(agentPageRefs(store, { title: 'T' }, '2026-07-12'));
    expect(out.groups.map((g) => g.pageTitle)).toEqual(['Source']);
  });
});

describe('agentPageTasks', () => {
  it('filters tasks linking to the page by state', () => {
    ok(
      agentAppend(store, {
        page: 'Inbox',
        blocks: [
          { text: 'TODO ship [[Project X]]' },
          { text: 'DONE spec [[Project X]]' },
          { text: 'plain note on [[Project X]]' },
        ],
      }),
    );
    const open = ok(agentPageTasks(store, { title: 'Project X' }));
    expect(open.groups[0]?.tasks.map((t) => t.text)).toEqual([
      'TODO ship [[Project X]]',
    ]);
    const done = ok(agentPageTasks(store, { title: 'Project X' }, 'DONE'));
    expect(done.groups[0]?.tasks.map((t) => t.text)).toEqual([
      'DONE spec [[Project X]]',
    ]);
    const all = ok(agentPageTasks(store, { title: 'Project X' }, 'all'));
    expect(all.groups[0]?.tasks).toHaveLength(2);
  });
});

describe('overview, tasks, journal', () => {
  it('summarizes the graph in one call each', () => {
    const now = new Date('2026-07-12T10:00');
    ok(
      agentAppend(
        store,
        {
          date: 'today',
          blocks: [{ text: 'TODO review', children: [{ text: 'sub' }] }],
        },
        now,
      ),
    );
    ok(agentAppend(store, { page: 'Empty ideas', blocks: [{ text: 'one' }] }));

    const overview = agentOverview(store, now);
    expect(overview.today).toBe('2026-07-12');
    expect(overview.openTasks).toBe(1);
    expect(
      overview.pages.find((p) => p.title === '2026-07-12')?.blockCount,
    ).toBe(2);

    const tasks = agentTasks(store);
    expect(tasks.groups[0]?.pageTitle).toBe('2026-07-12');
    expect(texts(tasks.groups[0]?.tasks[0]?.children)).toEqual(['sub']);

    const journal = agentJournal(store, {});
    expect(journal.days.map((d) => d.date)).toEqual(['2026-07-12']);
    expect(texts(journal.days[0]?.blocks)).toEqual(['TODO review']);
  });
});

describe('routes', () => {
  it('broadcasts agent writes with clientId "agent"', async () => {
    const broadcast = vi.fn();
    const api = createApi(store, broadcast);
    const res = await api.request('/agent/blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: 'Via HTTP', blocks: [{ text: 'hello' }] }),
    });
    expect(res.status).toBe(200);
    expect(broadcast).toHaveBeenCalledOnce();
    expect(broadcast.mock.calls[0]![0]).toMatchObject({
      type: 'ops',
      clientId: 'agent',
    });
    const body = (await res.json()) as { created: { id: string }[] };
    expect(
      getPagePayload(store, ensurePage(store, 'Via HTTP').id)?.blocks[0]?.id,
    ).toBe(body.created[0]!.id);
  });

  it('returns instructive JSON errors', async () => {
    const api = createApi(store, vi.fn());
    const invalid = await api.request('/agent/blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: 'X' }),
    });
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { error: string };
    expect(typeof invalidBody.error).toBe('string');

    const missing = await api.request('/agent/block/nope', {
      method: 'DELETE',
    });
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error: string };
    expect(missingBody.error).toContain('nope');

    const badSince = await api.request(
      '/agent/page/refs?title=T&since=2026-7-1',
    );
    expect(badSince.status).toBe(400);
    const badSinceBody = (await badSince.json()) as { error: string };
    expect(badSinceBody.error).toContain('since');
    expect(badSinceBody.error).toContain('YYYY-MM-DD');
  });

  it('does not broadcast pure reads', async () => {
    ensurePage(store, 'Existing');
    const broadcast = vi.fn();
    const api = createApi(store, broadcast);
    const res = await api.request('/agent/page?title=Existing');
    expect(res.status).toBe(200);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('openapi', () => {
  interface OpenApiDoc {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown> };
  }

  async function fetchDoc() {
    const api = createAgentApi(store, vi.fn());
    const res = await api.request('/openapi.json');
    expect(res.status).toBe(200);
    return { api, doc: (await res.json()) as OpenApiDoc };
  }

  it('serves a document covering every agent route', async () => {
    const { api, doc } = await fetchDoc();
    expect(doc.openapi).toBe('3.1.0');

    // every mounted route (minus the doc itself) must be documented; Hono
    // lists validator middleware as extra route entries, so dedupe
    const documented = new Set(
      Object.entries(doc.paths).flatMap(([path, ops]) =>
        Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );
    const mounted = new Set(
      api.routes
        .filter((r) => r.path !== '/openapi.json' && r.method !== 'ALL')
        .map((r) => `${r.method} ${r.path.replace(/:([A-Za-z]+)/g, '{$1}')}`),
    );
    for (const route of mounted) {
      expect(documented, `missing from openapi.json: ${route}`).toContain(
        route,
      );
    }
    // and nothing documented that isn't mounted (stale entries)
    for (const route of documented) {
      expect(mounted, `documented but not mounted: ${route}`).toContain(route);
    }
  });

  it('has resolvable $refs and annotated request schemas', async () => {
    const { doc } = await fetchDoc();
    const schemas = doc.components.schemas;
    const refs: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (key === '$ref' && typeof child === 'string') refs.push(child);
          else walk(child);
        }
      }
    };
    walk(doc);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.replace('#/components/schemas/', '');
      expect(schemas[name], `unresolved $ref: ${ref}`).toBeDefined();
    }

    // the recursive input node refs itself and carries its field docs
    const inputNode = schemas['InputNode'] as {
      properties: { text: { description?: string }; children: unknown };
    };
    expect(inputNode.properties.text.description).toContain('[[Page Title]]');
    expect(JSON.stringify(inputNode.properties.children)).toContain(
      '#/components/schemas/InputNode',
    );
  });
});
