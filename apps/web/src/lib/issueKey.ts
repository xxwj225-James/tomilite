/**
 * The number a person reads for a task.
 *
 * A local task is `TL-7`. A task mirrored from another tracker shows **its own
 * tracker's** number — Redmine's `#1234` — because that is the number its commits, its
 * emails and the user's colleagues all use. Rendering `TL-437` for Redmine #1234 would
 * leave the real number visible only in the issue body's provenance line, which is not
 * where anyone looks for it.
 *
 * ## Why `issueNumber` is not simply set to the tracker's id
 *
 * That would make this function unnecessary and would even make `git.ts`'s
 * `/(fix|close|resolve)\s+#(\d+)/` scanner resolve the right row for free. It is not done
 * because `Issue.issueNumber` has no unique constraint — the only index on the table is
 * `(projectId, status)` — while three code paths already treat `(projectId, issueNumber)`
 * as an identity (`issue.update`, `issueTools.getIssue`, `mcp.ts`'s `get_issue`). The
 * local `max + 1` sequence would eventually reach a Redmine number, and from that moment
 * two rows share a number and `findFirst` returns an arbitrary one: the user edits what
 * they believe is their own task and changes a mirrored ticket instead. Silent, and not
 * recoverable by looking at either row. Reserving a high band (`100000+`) is worse — the
 * sequence would jump there, and every task the user created afterwards would be
 * `TL-100001`.
 *
 * Duplicated from `apps/api/src/lib/taskScope.ts`, which needs the same string for the
 * standup brief, the agent's tools and the MCP server. The web bundle cannot import from
 * the API package; same arrangement as `lib/dbTime.ts`.
 *
 * ## Why `issueNumber` stays required
 *
 * The web callers read their row out of an editor-state type that declares
 * `issueNumber?: number` — a task being typed into the editor has no number YET. Every one
 * of them calls this only after checking that number, but TypeScript does not carry an
 * `if (row.issueNumber)` proof into an argument whose parameter requires it, so those call
 * sites hand over `{ ...row, issueNumber: row.issueNumber }`. That spread is the price of
 * keeping this parameter exact, and it is deliberate: accepting `number | undefined` here
 * would mean inventing a display value for a task with no number — a case that does not
 * exist — and would put a fabricated `TL-undefined` one refactor away from the sidebar.
 */
export function issueKey(i: {
  issueNumber: number;
  source?: string | null;
  sourceId?: string | null;
}): string {
  return i.source === 'redmine' && i.sourceId ? '#' + i.sourceId : 'TL-' + i.issueNumber;
}
