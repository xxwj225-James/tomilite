# Note Editor Bug Fix Log — 2026-07-20

## Code-Block Syntax Highlighting

### Problem

Code blocks in the editor have no syntax coloring — only a dark CSS background.

### Approaches Tried

| Approach                                                                                  | Result                                                         | Reason                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| highlight.js directly mutating `innerHTML`                                                | Highlighting works but click-to-position in code blocks breaks | DOM mutations break ProseMirror's position → DOM mapping                      |
| ProseMirror Decoration Plugin (module-level singleton)                                    | Editor content blank, not editable                             | The Note and Report editors share the same Plugin instance, conflicting state |
| ProseMirror Decoration Plugin (`$prose(() => new Plugin({...}))`, new instance each time) | ✅ Perfect                                                     | Each editor instance gets its own Plugin                                      |

### Final Solution

```
hljs.highlight(code) → HTML
  → parseTokens(HTML) → [{from, to, cls}]
    → Decoration.inline(from, to, {class: cls})
      → ProseMirror renders overlay <span>s (zero DOM mutation)
```

Key points:

- The Plugin is created inside the `$prose` factory (`$prose((ctx) => new Plugin({key: HL_KEY, ...}))`) to avoid sharing across editors
- `HL_KEY` (PluginKey) can be shared at module level, but Plugin instances cannot
- Refreshed every 2 seconds, combined with a position-bounds check `start + t.to <= pos + node.nodeSize`

---

## Panel Scrollbar

### Problem

After dragging the right panel wider than the window, there is no horizontal scrollbar.

### Fix

| CSS                  | Change                                                   | Effect                                         |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `.app-root`          | `overflow:hidden` → `overflow-x:auto; overflow-y:hidden` | Allows the root element to scroll horizontally |
| `.app-shell`         | Added `min-width:0`                                      | Allows flex children to shrink                 |
| `.app-viewport`      | Added `overflow-x:scroll; min-width:0`                   | Shows scrollbar when the panel overflows       |
| `.main-chat-wrapper` | Added `min-width:0`                                      | Same as above                                  |
| `.app-viewport-chat` | `flex:1 1 360px; min-width:360px`                        | Minimum width for the chat area                |
| `.panel--open`       | Added `width:auto; min-width:340px; flex-shrink:0`       | Panel cannot shrink                            |

---

## Pin-Button Persistence

### Problem

The pin button on the morning-brief greeting disappears after restart, and the pinned content is gone too.

### Fix

1. **Button disappears**: `saveMsg` didn't pass `pinnable:true`, and `switchSession` didn't load the `pinnable` field
   - Added the `ChatMessage.pinnable` column (schema v11)
   - `saveMsg` passes `pinnable`; `switchSession` restores `pinnable`
   - Greeting messages get a `tool:'greeting'` marker as a fallback check

2. **Pinned content disappears**: `pinnedText` is only React state, never persisted
   - `useState(() => localStorage.getItem('tl-pinned-text'))` reads on initialization
   - `useEffect` syncs it to localStorage

---

## Action Buttons (Polish/Translate/Summarize/Expand)

### Problem

After clicking, the AI only returns plain text — no Apply/Undo buttons.

### Root-Cause Analysis

1. **`stagedData` is never set** — after auto-apply consumes the `suggest_note_edit` result, `stagedData` stays null
2. **Action buttons bypass the normal `sendMessage` flow** — `sendMessageRef.current(text)` doesn't capture `noteSnapshot`, so the AI never receives the editor context
3. **The Guard model doesn't recognize the `[Note editor action:]` format** — no matching classification rule

### Fix

| File                               | Change                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.tsx`                          | Set `stagedData`: `{ title, content, original, type:'note' }`                                                                                                                |
| `App.tsx`                          | `sendMessage` gains a `noteActionPayload` parameter                                                                                                                          |
| `App.tsx`                          | `onNoteAction` only triggers AI for the 4 action types, filters out save notifications                                                                                       |
| `apps/api/src/agent/core/guard.ts` | When `[Note editor action:]` is detected, skip the guard model and route directly to `suggest_note_edit` (Step 2 of `classifyGuard`; was `agent.ts` at the time of this log) |
| `App.tsx`                          | Staged chat bubble: full Markdown-rendered preview of `_full?.content`                                                                                                       |

---

## Code Blocks and the Editor

### Code-block button

- Restored `createCodeBlockCommand` (previously changed to insert ``` characters), shows native code blocks with background

### Shift-Enter newline

- `$prose((ctx) => proseKeymap({'Shift-Enter': ...}))` — inserts `\n` inside code blocks

### Pasting external code

- Paste handler: `<pre>` / `<code>` HTML is allowed through (ProseMirror converts to code blocks), all other HTML → plain text

### Ctrl-Enter to exit code blocks

- Built-in ProseMirror behavior, no custom keymap needed

---

## saveMsg Race Condition

### Problem

When `currentSessionId` is empty, `saveMsg` calls `createSession` on every invocation; multiple calls within a short window create duplicate sessions.

### Fix

```ts
const sessionCreatingRef = useRef<Promise<string> | null>(null);
// reuse the in-flight session promise
if (!sessionCreatingRef.current) {
  sessionCreatingRef.current = api.chat.createSession('Chat 1').then(...)
}
sessionCreatingRef.current.then((sid) => doSave(sid));
```

---

## Other Fixes

- **TOC click crash**: removed the TOC from ContentPanel (DOM Range operations are incompatible with ProseMirror)
- **Frontend double obfuscation**: removed the second obfuscation pass on frontend index-*.js from `obfuscate.js` (the vite plugin already handles it) — note: `obfuscate.js` itself was later removed along with the obfuscation infrastructure (commit e2354d1), so this entry is historical only
- **export_to_excel / export_to_doc**: new agent tools supporting Excel/Word export
