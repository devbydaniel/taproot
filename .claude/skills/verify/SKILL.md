---
name: verify
description: Build, run, and drive Taproot end-to-end in a headless browser to verify changes
---

# Verify Taproot

## Build & launch

```bash
npm run build                      # client → client/dist
npm run start &                    # serves API + client on :3000 (db: data/taproot.db)
curl -s http://localhost:3000/api/pages   # readiness probe; fresh db seeds Welcome + Ideas
```

For a throwaway DB: `TAPROOT_DB=$(mktemp -d)/t.db npm run start`.

## Drive it (bb headless Chrome)

`bb open http://localhost:3000` redirects to the Welcome page. Useful selectors:
`.cm-editor` / `.cm-content` (focused block editor), `.cm-tooltip-autocomplete`
(the `[[` popup), `aside input` (new-page field), `main a` (bullet dots link to
`/b/<id>` = zoom, wikilinks navigate to `/p/<id>`).

CodeMirror accepts synthetic events — this is the whole trick:

```bash
# type into the focused editor
bb js "document.execCommand('insertText', false, 'text with [[Wel')"
# press a key (Enter/Tab/Backspace/arrows; add shiftKey: true for Shift-Tab)
bb js "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))"
```

## Flows worth driving after a change

1. Click block text → editor mounts; type; wait >400 ms (debounce); confirm via
   `curl /api/pages/<id>` that text persisted.
2. `[[` → autocomplete visible → Enter accepts (must NOT split the block).
3. Enter splits · Tab indents · Shift-Tab outdents · Backspace on empty deletes —
   then assert parentIds via the API.
4. Click a bullet dot → zoom view (`/b/<id>`): block text becomes the title,
   breadcrumbs at top.
5. Open a referenced page → Linked References section lists the referencing
   bullet plus its subtree.

## Gotchas

- `bb js` evaluates a single expression — wrap statements in an IIFE.
- Ops are debounced; always `sleep 1` before asserting via the API.
- Node 26 needs `better-sqlite3` ≥ 12 (native build fails on v11).
