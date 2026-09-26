// ═══ Reference strings → the key a resource is looked up by ═══
//
// Both new importers have to answer the same question — "does this note's
// `<img src="…">` / `Content-Location: …` name one of the files I was handed?" — from two
// different directions: `htmlNote.ts` resolves a `<img>` against the picked folder, and
// `mht.ts` builds an index out of MIME part headers. If each owned its own normalisation
// the two would drift, and the failure would be silent: an image that renders in one
// export shape and becomes a `> [name]` placeholder in the other.
//
// Zero imports, so `mht.ts` stays runnable under plain Node (`scripts/test-import-mime.mts`).
//
// ## What a real 印象笔记 export actually writes
//
// Observed in `YinXiangBiJi.notes.html` (2026-09-22):
//
//   <img src="YinXiangBiJi.notes_files/8F6CEA81-….png?t=attachment" type="image/png"
//        data-filename="8F6CEA81-….png"/>
//
// and in the `.mht` twin, a part header:
//
//   Content-Location: YinXiangBiJi.notes_files/PC-2备份 23 (1).png
//
// Three things follow from those two lines, and each is a rule below:
//
//   - the `src` carries a **query string** the part header does not. `?t=attachment` is
//     the exporter's own marker, not part of the file name; matching the raw values
//     without stripping it would match nothing at all.
//   - the path is **relative and not percent-encoded** — it contains a space and
//     parentheses. So the raw form is the one that matches the file on disk, and
//     percent-decoding is a fallback rather than the main path.
//   - the value is **not ASCII**: `Content-Location` carries raw UTF-8 bytes, and the
//     `src` attribute carries raw UTF-8 characters. Neither is RFC 2047, neither is
//     percent-encoded. So a header parser that assumed ASCII would mangle the only
//     image whose name is not an exporter-generated GUID.

/**
 * A ref that names something outside this import — a remote image in a clipped note, an
 * inline `data:` URL, a `mailto:`, a bare `#anchor`.
 *
 * These are **not** resolution failures and must not be counted as missing files: a note
 * clipped from the web is full of `https://…` images that were never in the export, and
 * reporting each one as a missing attachment would bury the real ones.
 */
function isExternal(ref: string): boolean {
  if (!ref) return true;
  if (ref.startsWith('#') || ref.startsWith('data:')) return true;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(ref);
  if (!m) return false;
  // A single letter is a Windows drive, not a scheme: `C:/notes/a.png` is a local file
  // and `c:` would otherwise be read as the scheme of a URL.
  if (m[1].length === 1) return false;
  return !/^file$/i.test(m[1]); // `file:` is local; `http:`, `mailto:`, `blob:` are not
}

/** `file:///C:/a/b.png` → `C:/a/b.png`. Anything else with a scheme is left alone. */
function stripFileScheme(ref: string): string {
  const m = /^file:\/\/([^/]*)(\/.*)$/i.exec(ref);
  let path = m ? m[2] : ref.replace(/^file:/i, '');
  // `file:///C:/x` has three slashes: the authority is empty, and the third slash belongs
  // to it, not to the path. Dropping it is right exactly when a drive letter follows —
  // `file:///home/x` is a POSIX absolute path and keeps its slash.
  if (/^\/[a-z]:/i.test(path)) path = path.slice(1);
  return path;
}

/**
 * The local path a ref names, normalised — or `null` when it names something else.
 *
 * Normalisation is deliberately **only** what the two observed shapes require: strip the
 * query and fragment, turn `\` into `/`, drop a leading `./`, and collapse the empty
 * segments a doubled separator produces. It does **not** resolve `..` — that needs the
 * note's own directory and is `resolveRelative`'s job — and it does **not** change case,
 * because the file on disk has whatever case it has and guessing is how two different
 * files become one.
 */
export function localRef(ref: string): string | null {
  if (!ref) return null;
  let s = ref.trim();
  if (!s) return null;
  if (isExternal(s)) return null;
  s = stripFileScheme(s);
  // Query and fragment first: the exporter appends `?t=attachment`, and a `#` or `?`
  // inside a *file name* is the only case this can hurt, which no filesystem allows on
  // the platforms this app runs on anyway.
  s = s.split('#')[0].split('?')[0];
  s = s.replace(/\\/g, '/');
  s = s.replace(/\/{2,}/g, '/');
  s = s.replace(/^\.\//, '');
  return s;
}

/** The last segment of a path, query and fragment already stripped. `''` for `''`. */
export function basenameOf(value: string): string {
  const s = value.split('#')[0].split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
}

/**
 * Every string a reference might legitimately be indexed under, best first.
 *
 * Two forms, because two producers describe the same file differently and both are in
 * play: the exporter writes the raw name (observed above), while a browser reading an
 * `img.src` **property** hands back a percent-encoded path. Indexing both means a lookup
 * works whether the caller read the attribute or the property.
 *
 * Returns `[]` for a ref that is not local, which is how a caller tells "this note has a
 * remote image — leave it alone" apart from "this file is missing".
 */
export function refCandidates(ref: string): string[] {
  const norm = localRef(ref);
  if (!norm) return [];
  const out = [norm];
  const decoded = percentDecode(norm);
  if (decoded !== norm) out.push(decoded);
  return out;
}

/** `decodeURIComponent`, for a string that may not be encoded at all. A file named
 *  `100%.png` makes the decoder throw, and throwing away the reference because of a
 *  stray `%` would lose an image that is sitting right there. */
export function percentDecode(value: string): string {
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A ref resolved against the directory the note itself lives in.
 *
 * Needed because `_files` sits **beside** the note, not below it: the exporter writes
 * `YinXiangBiJi.notes_files/x.png`, which is relative to the note's directory, and a
 * note the user filed one level deeper would write `../Shop.notes_files/x.png`. Both
 * have to land on the same file as the one the picker handed over.
 *
 * An absolute path is returned unchanged: there is nothing to resolve it against, and
 * pretending otherwise would silently rewrite `C:/notes/a.png` into the picked folder.
 */
export function resolveRelative(noteDir: string, ref: string): string {
  const norm = localRef(ref);
  if (!norm) return '';
  if (/^[a-z]:\//i.test(norm) || norm.startsWith('/')) return norm;

  const base = noteDir ? localRef(noteDir) : '';
  const segs = (base ? base.split('/') : []).concat(norm.split('/'));
  const out: string[] = [];
  for (const seg of segs) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      // Above the picked folder there is nothing left to point at. Dropping the `..`
      // rather than letting it empty the stack keeps `../../x.png` looking for `x.png`
      // instead of resolving to `''` — the lookup then fails by *not matching*, which
      // is a counted placeholder, rather than by matching the wrong file.
      if (out.length) out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/** The directory part of a relative path. `''` for a bare file name. */
export function dirOf(relativePath: string): string {
  const norm = localRef(relativePath) ?? relativePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i < 0 ? '' : norm.slice(0, i);
}
