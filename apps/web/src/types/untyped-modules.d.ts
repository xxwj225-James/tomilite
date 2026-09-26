// ═══ Modules that ship no type declarations ═══
//
// Both are real dependencies of this app (see apps/web/package.json) and neither ships a
// `.d.ts`. `@types/turndown` exists, but **`@types/turndown-plugin-gfm` does not** —
// `npm view @types/turndown-plugin-gfm` is a 404 — so installing types would fix one of the
// two errors and leave this file needed for the other. Stating both here keeps one concern
// in one place instead of splitting it across a dependency and a declaration.
//
// Deliberately `any` rather than a hand-written interface. `lib/import/htmlToMarkdown.ts`
// imports each module inside a function and narrows it to `any` on the next line, because it
// uses one method of each and because turndown is loaded lazily (~30 KB) to keep the notes
// panel off the startup path. A precise interface here would be a second description of a
// library no other file in the repo touches, and nothing would keep it honest.

declare module 'turndown';
declare module 'turndown-plugin-gfm';
