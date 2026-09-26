// ═══ `.mht` / MHTML — the container, read at the byte level ═══
//
// ## What one of these files actually is
//
// An `.mht` is RFC 2557 MHTML: a `multipart/related` MIME message whose root part is the
// HTML and whose other parts are the images it references. One file carries a whole note,
// resources included, and therefore has no sibling folder to lose — which is the whole
// reason it survives a file pick with its images intact while a saved web page does not
// (see `buckets.ts` and `importHtmlFiles`).
//
// Read off `YinXiangBiJi.notes.mht` (2026-09-22) rather than from the RFC, because the
// RFC is a description of what a *conforming* writer emits and this is what the writer
// emits:
//
//   Date: …                       ← no Subject, no Content-ID anywhere in the file
//   MIME-Version: 1.0
//   Content-Type: multipart/related;
//       boundary="----=_NextPart_0001_458C_A658BA0D.F18E5CC6"     ← folded, and quoted
//   X-Mailer: Evernote  v7.04.30.9439
//
//   ------=_NextPart_0001_458C_A658BA0D.F18E5CC6
//   Content-Type: text/html; charset="utf-8"
//   Content-Transfer-Encoding: quoted-printable
//
//   ------=_NextPart_0001_458C_A658BA0D.F18E5CC6
//   Content-Type: image/png
//   Content-Transfer-Encoding: base64
//   Content-Location: YinXiangBiJi.notes_files/PC-2备份 23 (1).png
//
// So: the boundary is quoted, the Content-Type header is folded across two lines, there
// is a preamble, and the parts carry `Content-Location` rather than `Content-ID`. Each of
// those has a test in `scripts/test-import-mime.mts`, written against the RFC.
//
// ## Why bytes and not a string
//
// The obvious implementation is `file.text()` and then `indexOf` for the boundary. It is
// wrong, and wrong in a way that corrupts payloads silently: the WHATWG encoding standard
// aliases `iso-8859-1` to **windows-1252**, so a renderer has *no* byte-preserving
// `TextDecoder` — `new TextDecoder('latin1')` maps 0x80–0x9F to other code points. A JPEG
// whose bytes include 0x93 comes back as a different byte, and the image is subtly
// broken in a way nobody traces back to the importer.
//
// So the container is walked as `Uint8Array`, and the boundary is matched **anchored to
// line starts**. Two consequences, and both are the point:
//
//   - a boundary-looking string in the middle of a line is not a delimiter. Base64 never
//     produces one, but quoted-printable prose can, and a naive `indexOf` would split the
//     part there and hand the caller half a note.
//   - a *longer* boundary (`--boundaryXYZ`) is not a delimiter either. RFC 2046 requires
//     the delimiter be followed by LWSP and then CRLF or `--`, and that check is what
//     makes a prefix match impossible.
//
// Decoding to text happens **once**, at the end, for the HTML part only — and it goes
// through `decodeBytes`, so the charset chain stays in one place.
//
// ## Assumptions a real export could still falsify
//
//   - that the boundary is ASCII. RFC 2046 requires it, and `TextEncoder` is used to
//     search for it; a boundary with non-ASCII bytes would be searched for in its UTF-8
//     form, which is what the writer would have emitted anyway.
//   - that a part with no header block at all is the body (RFC 2045's default
//     `text/plain`). Handled, untested against a real file.
//   - that `Content-Transfer-Encoding` is one of `base64`, `quoted-printable`, `7bit`,
//     `8bit`, `binary`. Anything else is kept raw and counted, never guessed at.
//
// Zero dependencies: `text.ts` and `refs.ts` import nothing themselves, so this module
// runs under plain Node — `npx tsx scripts/test-import-mime.mts` — with no DOM.

import { basenameOf, localRef, refCandidates } from './refs';
import { b64ToBytes, bytesToB64, decodeBytes } from './text';
import type { ResolvedResource } from './types';

const LF = 0x0a;
const CR = 0x0d;
const DASH = 0x2d;
const SP = 0x20;
const TAB = 0x09;
const EQ = 0x3d;

export type MhtPart = {
  /** Lower-cased names → unfolded values. First occurrence wins. */
  headers: Map<string, string>;
  /** Lower-cased, parameters stripped: `text/html`, `image/png`. `text/plain` when the
   *  part declared nothing, which is RFC 2045's default and not a guess. */
  mediaType: string;
  /** Lower-cased parameter names → values, quotes and escapes removed. */
  params: Map<string, string>;
  /** The bytes, after `Content-Transfer-Encoding`. */
  body: Uint8Array;
  /** The raw header value, lower-cased; `''` when absent. */
  transferEncoding: string;
  /** `false` when the transfer encoding was not one this module implements: `body` then
   *  holds the part's raw octets and the caller is expected to count it. */
  decoded: boolean;
};

export type MhtDocument = {
  /** The root `text/html` part's bytes — **not** decoded, because the charset chain
   *  belongs to `text.ts` and the caller may want to check the size before decoding. */
  htmlBytes: Uint8Array;
  /** The root part's declared charset, if it declared one. */
  htmlCharset?: string;
  /** RFC 2047-decoded `Subject`, when the container has one. */
  subject?: string;
  /** Every non-root part, indexed under each name the HTML might use for it: the
   *  normalised `Content-Location`, its bare file name, the `Content-ID` with and
   *  without `cid:` and angle brackets, and any `name`/`filename` parameter. */
  resources: Map<string, MhtPart>;
  /** Every part, root first in file order — for counting, and for the caller's summary. */
  parts: MhtPart[];
  /** Parts that came back with `decoded: false`. */
  undecoded: number;
  /** The closing `--boundary--` line was never found: the file is truncated. */
  truncated: boolean;
};

// ─── Byte scanning ───

/** The first index of `seq` in `[from, to)`, or `-1`. */
function indexOfSeq(bytes: Uint8Array, seq: readonly number[], from: number, to: number): number {
  const first = seq[0];
  for (let i = from; i + seq.length <= to; i++) {
    if (bytes[i] !== first) continue;
    let k = 1;
    while (k < seq.length && bytes[i + k] === seq[k]) k++;
    if (k === seq.length) return i;
  }
  return -1;
}

function isLws(b: number | undefined): boolean {
  return b === SP || b === TAB;
}

function hexVal(b: number | undefined): number {
  if (b === undefined || Number.isNaN(b)) return -1;
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

/**
 * Where a part's header block ends and its body begins.
 *
 * The **first** blank line after `from` is the separator, by definition — the body's own
 * blank lines all come after it — so a forward search from `from` is exact rather than
 * heuristic. (This is why the search is not run over the whole file: a 100 MB part whose
 * body contains two consecutive newlines would be misread if the search started at 0.)
 *
 * The one case that needs a guard is a part with **no header block**: RFC 2045 makes
 * `Content-Type` optional, so a part may be nothing but a blank line and a body. Without
 * the guard the forward search would run into that body and find its first blank line,
 * turning prose into headers.
 */
function headerBlockEnd(bytes: Uint8Array, from: number, to: number): { headerEnd: number; bodyStart: number } {
  // A part that starts with the blank line itself has an empty header block.
  if (bytes[from] === LF) return { headerEnd: from, bodyStart: from + 1 };
  if (bytes[from] === CR && bytes[from + 1] === LF) return { headerEnd: from, bodyStart: from + 2 };

  const four = indexOfSeq(bytes, [CR, LF, CR, LF], from, to);
  const two = indexOfSeq(bytes, [LF, LF], from, to);
  if (four >= 0 && (two < 0 || four <= two)) return { headerEnd: four, bodyStart: four + 4 };
  if (two >= 0) return { headerEnd: two, bodyStart: two + 2 };

  // No blank line anywhere: no header block, so the whole chunk is the body.
  return { headerEnd: from, bodyStart: from };
}

/** Drop the EOL that precedes a boundary line — RFC 2046 makes it part of the delimiter,
 *  not part of the part. Without this every part ends with a stray newline. */
function stripTrailingEol(bytes: Uint8Array, start: number, end: number): number {
  if (end - 1 >= start && bytes[end - 1] === LF) end--;
  if (end - 1 >= start && bytes[end - 1] === CR) end--;
  return end;
}

// ─── Headers ───

/**
 * The header block as a map. Input is the block's **text**, decoded by the caller.
 *
 * Splitting on `\n` after decoding is safe where splitting the *body* on `\n` would not
 * be: 0x0A is never part of a multi-byte sequence in UTF-8, and is a single-byte control
 * code in GBK, so a decoded newline is always a newline.
 *
 * Folding is real in these files — the sample's own `Content-Type` is folded — and it is
 * unfolded by joining a continuation line onto the previous value. RFC 5322 says the
 * CRLF is removed and the leading whitespace *kept*; a space is inserted instead, which
 * is the same thing for every header this module reads and cannot glue two words together.
 */
function parseHeaders(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let name: string | null = null;
  let value = '';

  const flush = () => {
    if (name && !out.has(name)) out.set(name, value.trim()); // first occurrence wins
    name = null;
    value = '';
  };

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (isLws(line.charCodeAt(0))) {
      value += ' ' + line.trim();
      continue;
    }
    flush();
    const colon = line.indexOf(':');
    if (colon < 0) continue; // not a header line — a bare continuation is already handled
    name = line.slice(0, colon).trim().toLowerCase();
    value = line.slice(colon + 1).trim();
  }
  flush();
  return out;
}

/** Split a header value on top-level `;`, respecting quoted strings. A quoted value may
 *  contain a `;` — and a boundary may contain one too, since RFC 2046's `bchars` allows
 *  it — so a plain `split(';')` is not a shortcut here, it is a bug. */
function splitParams(value: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quoted) {
      cur += ch;
      if (ch === '\\' && i + 1 < value.length) {
        cur += value[++i];
        continue;
      }
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      cur += ch;
      continue;
    }
    if (ch === ';') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function unquote(v: string): string {
  const t = v.trim();
  if (!t.startsWith('"')) return t;
  return t.slice(1).replace(/"\s*$/, '').replace(/\\(.)/g, '$1');
}

/** `multipart/related; boundary="…"` → `{ mediaType: 'multipart/related', params }`. */
export function parseContentType(value: string): { mediaType: string; params: Map<string, string> } {
  const pieces = splitParams(value);
  const mediaType = (pieces.shift() ?? '').trim().toLowerCase();
  const params = new Map<string, string>();
  for (const piece of pieces) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const key = piece.slice(0, eq).trim().toLowerCase();
    if (!key || params.has(key)) continue;
    params.set(key, unquote(piece.slice(eq + 1)));
  }
  return { mediaType, params };
}

// ─── Transfer encodings ───

/** `=XX`, `=\r\n`, `=\n`, and a lone `=` left alone. Output is never longer than input,
 *  so one allocation of the input's length is enough — no per-byte array, which on a
 *  100 MB part would be 800 MB of boxed numbers. */
export function decodeQuotedPrintable(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== EQ) {
      out[n++] = b;
      continue;
    }
    // Soft line break: `=` immediately before CRLF or LF.
    let j = i + 1;
    if (bytes[j] === CR) j++;
    if (bytes[j] === LF) {
      i = j;
      continue;
    }
    const hi = hexVal(bytes[i + 1]);
    const lo = hexVal(bytes[i + 2]);
    if (hi >= 0 && lo >= 0) {
      out[n++] = hi * 16 + lo;
      i += 2;
      continue;
    }
    // Malformed. Keep the `=` rather than dropping a character the note contains — a
    // visible `=` is a note the user can fix, a missing one is a note that quietly
    // reads differently from the original.
    out[n++] = b;
  }
  return out.subarray(0, n);
}

const IS_B64 = (() => {
  const t = new Uint8Array(256);
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=') t[ch.charCodeAt(0)] = 1;
  return t;
})();

function stripAsciiWhitespace(bytes: Uint8Array): Uint8Array {
  let n = 0;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === LF || b === CR || b === SP || b === TAB) continue;
    out[n++] = b;
  }
  return out.subarray(0, n);
}

/**
 * Apply a part's `Content-Transfer-Encoding`. Never throws, and never guesses: an
 * encoding this module does not implement returns the raw octets with `decoded: false`
 * so the caller can say so, rather than being fed through a decoder that would produce
 * plausible garbage.
 */
function decodeTransfer(bytes: Uint8Array, encoding: string): { body: Uint8Array; decoded: boolean } {
  switch (encoding) {
    case 'base64': {
      const packed = stripAsciiWhitespace(bytes);
      // Validated byte by byte rather than by letting `atob` throw: the WHATWG decoder is
      // documented to *forgive* some malformed input, and a part that decodes to the
      // wrong bytes is worse than one reported as undecodable.
      for (let i = 0; i < packed.length; i++) {
        if (!IS_B64[packed[i]]) return { body: bytes, decoded: false };
      }
      try {
        return { body: b64ToBytes(new TextDecoder('latin1').decode(packed)), decoded: true };
      } catch {
        return { body: bytes, decoded: false };
      }
    }
    case 'quoted-printable':
      return { body: decodeQuotedPrintable(bytes), decoded: true };
    case '':
    case '7bit':
    case '8bit':
    case 'binary':
      return { body: bytes, decoded: true };
    default:
      return { body: bytes, decoded: false };
  }
}

// ─── RFC 2047 encoded words ───

const WORD = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g;

/** `=?GB2312?B?xOO6ww==?=` → `你好`. Used for `Subject` and for `name`/`filename`
 *  parameters, which is where a non-ASCII name shows up when it is not in
 *  `Content-Location`.
 *
 *  RFC 2231 (`name*=utf-8''%E4%B8%AD`) is **not** handled — nothing observed emits it,
 *  and a half-implementation would be harder to spot than an absence. */
export function decodeEncodedWords(value: string): string {
  if (!value.includes('=?')) return value;
  let out = '';
  let last = 0;
  let prevWasWord = false;
  let m: RegExpExecArray | null;
  WORD.lastIndex = 0;
  while ((m = WORD.exec(value)) !== null) {
    const between = value.slice(last, m.index);
    // Whitespace *between two adjacent encoded words* is a line-break artefact of the
    // encoder and is not part of the value: `=?utf-8?B?5Lit?= =?utf-8?B?5paH?=` is `中文`,
    // and keeping the space would put one in the middle of a word.
    if (!(prevWasWord && /^[ \t\r\n]*$/.test(between))) out += between;
    out += decodeWord(m[1], m[2], m[3]);
    prevWasWord = true;
    last = m.index + m[0].length;
  }
  return out + value.slice(last);
}

function qToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '_') {
      out[n++] = SP; // RFC 2047: `_` stands for the space, since a literal space cannot appear
      continue;
    }
    if (ch === '=') {
      const hi = hexVal(text.charCodeAt(i + 1));
      const lo = hexVal(text.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        out[n++] = hi * 16 + lo;
        i += 2;
        continue;
      }
    }
    out[n++] = ch.charCodeAt(0) & 0xff;
  }
  return out.subarray(0, n);
}

function decodeWord(charset: string, enc: string, text: string): string {
  if (enc === 'B' || enc === 'b') {
    try {
      return decodeBytes(b64ToBytes(text), charset);
    } catch {
      return `=?${charset}?${enc}?${text}?=`; // not base64 after all — show it as written
    }
  }
  return decodeBytes(qToBytes(text), charset);
}

// ─── Delimiters ───

type Delimiter = {
  /** Where the `--boundary` line starts. */
  lineStart: number;
  /** Where the line after it starts — i.e. where the part's headers begin. */
  nextLineStart: number;
  /** This is the `--boundary--` form. */
  close: boolean;
};

/**
 * Whether a delimiter line starts at `lineStart`, and what follows it.
 *
 * The two checks after the boundary itself are the whole reason this is not an
 * `indexOf`:
 *
 *   - `--boundaryXYZ` must **not** match. RFC 2046's `bcharsnospace` allows `-`, so a
 *     boundary that is a prefix of another is legal, and a prefix match would cut a part
 *     at the wrong line.
 *   - the delimiter must be followed by line-end, not by more text.
 */
function matchDelimiter(bytes: Uint8Array, lineStart: number, needle: Uint8Array): Delimiter | null {
  for (let k = 0; k < needle.length; k++) {
    if (bytes[lineStart + k] !== needle[k]) return null;
  }
  let p = lineStart + needle.length;
  while (isLws(bytes[p])) p++;
  let close = false;
  if (bytes[p] === DASH && bytes[p + 1] === DASH) {
    close = true;
    p += 2;
    while (isLws(bytes[p])) p++;
  }
  if (p >= bytes.length) return { lineStart, nextLineStart: p, close };
  if (bytes[p] === CR && bytes[p + 1] === LF) return { lineStart, nextLineStart: p + 2, close };
  if (bytes[p] === LF) return { lineStart, nextLineStart: p + 1, close };
  return null; // longer boundary, or text after the marker
}

/**
 * Read an MHTML container. Returns `null` only when the container itself is unreadable —
 * no header block, not `multipart/*`, no boundary, no parts, or no `text/html` part to
 * import. Everything below that is best-effort and reported through the return value:
 * one damaged part must not cost the note.
 */
export function readMht(raw: Uint8Array): MhtDocument | null {
  const top = headerBlockEnd(raw, 0, raw.length);
  if (top.headerEnd === 0 && top.bodyStart === 0) return null; // no blank line at all
  const topHeaders = parseHeaders(decodeBytes(raw.subarray(0, top.headerEnd)));
  const container = parseContentType(topHeaders.get('content-type') ?? '');
  if (!container.mediaType.startsWith('multipart/')) return null;
  const boundary = container.params.get('boundary');
  if (!boundary) return null;

  const needle = new TextEncoder().encode('--' + boundary);

  // Walk line starts and collect delimiters. Every line of the file is visited once and
  // the per-line check usually ends on the first byte, so this is a single pass with no
  // intermediate array of line offsets — which on a 100 MB file would be a million
  // numbers to hold for no reason.
  const delimiters: Delimiter[] = [];
  let pos = top.bodyStart;
  let truncated = true;
  while (pos <= raw.length) {
    const d = matchDelimiter(raw, pos, needle);
    if (d) {
      delimiters.push(d);
      if (d.close) {
        truncated = false;
        break;
      }
      pos = d.nextLineStart;
      continue;
    }
    const nl = raw.indexOf(LF, pos);
    if (nl < 0) break;
    pos = nl + 1;
  }
  if (delimiters.length === 0) return null;

  const parts: MhtPart[] = [];
  for (let k = 0; k < delimiters.length; k++) {
    if (delimiters[k].close) break;
    const start = delimiters[k].nextLineStart;
    const rawEnd = k + 1 < delimiters.length ? delimiters[k + 1].lineStart : raw.length;
    const end = stripTrailingEol(raw, start, rawEnd);

    const hb = headerBlockEnd(raw, start, end);
    const headers = parseHeaders(decodeBytes(raw.subarray(start, hb.headerEnd)));
    const ct = parseContentType(headers.get('content-type') ?? '');
    const transferEncoding = (headers.get('content-transfer-encoding') ?? '').trim().toLowerCase();
    const { body, decoded } = decodeTransfer(raw.subarray(hb.bodyStart, end), transferEncoding);

    parts.push({
      headers,
      mediaType: ct.mediaType || 'text/plain',
      params: ct.params,
      body,
      transferEncoding,
      decoded,
    });
  }
  if (parts.length === 0) return null;

  // RFC 2557: the root is the part the container's `start` parameter names, and the
  // first `text/html` part otherwise. Only the observed shape matters here — the sample
  // has one HTML part and it is first — but a container that names another start would
  // otherwise import its appendix instead of its note.
  const startId = (container.params.get('start') ?? '').replace(/^</, '').replace(/>$/, '').trim();
  const root =
    (startId
      ? parts.find((p) => p.mediaType === 'text/html' && stripBrackets(p.headers.get('content-id') ?? '') === startId)
      : undefined) ?? parts.find((p) => p.mediaType === 'text/html');
  if (!root) return null;

  const resources = new Map<string, MhtPart>();
  for (const p of parts) {
    if (p === root) continue;
    for (const key of partKeys(p)) if (!resources.has(key)) resources.set(key, p);
  }

  const subject = topHeaders.get('subject');

  return {
    htmlBytes: root.body,
    htmlCharset: root.params.get('charset') || container.params.get('charset') || undefined,
    subject: subject ? decodeEncodedWords(subject) : undefined,
    resources,
    parts,
    undecoded: parts.filter((p) => !p.decoded).length,
    truncated,
  };
}

function stripBrackets(value: string): string {
  return value.trim().replace(/^</, '').replace(/>$/, '').trim();
}

/**
 * Resolve one reference — an `<img src>` — against the container's parts.
 *
 * `cid:` is looked up **before** anything classifies the reference, and that ordering is
 * the whole subtlety here. RFC 2557 recommends addressing parts by `Content-ID`, so
 * `<img src="cid:abc@evernote">` is a reference to a *local* part; but `refs.ts` reads
 * `cid:` as a URL scheme and would call it external, which would leave the image alone
 * and count nothing. The observed export uses `Content-Location` and has no `cid:` at
 * all — this is for the writers that follow the RFC instead, and it is cheap enough to
 * keep correct rather than discover later.
 *
 * There is no `ambiguous` here: the container's index is first-wins by construction, and
 * one part claiming a `Content-ID` twice is a malformed file rather than an ambiguity to
 * report.
 */
export function resolveMhtResource(doc: MhtDocument, ref: string): ResolvedResource {
  const raw = ref.trim();
  if (!raw) return { kind: 'external' };

  const cid = /^cid:(.*)$/i.exec(raw);
  if (cid) {
    const id = stripBrackets(cid[1]);
    const part = doc.resources.get(id) ?? doc.resources.get(`cid:${id}`) ?? doc.resources.get(`<${id}>`);
    return part ? asResource(part, basenameOf(id) || id) : { kind: 'missing' };
  }

  if (localRef(raw) === null) return { kind: 'external' };

  for (const candidate of refCandidates(raw)) {
    // The index holds both the full `Content-Location` and its bare file name, so this
    // covers an HTML that kept the `_files` prefix and one that did not.
    const part = doc.resources.get(candidate) ?? doc.resources.get(basenameOf(candidate));
    if (part) return asResource(part, basenameOf(candidate) || candidate);
  }
  return { kind: 'missing' };
}

function asResource(part: MhtPart, name: string): ResolvedResource {
  return {
    kind: 'found',
    name: name || 'attachment',
    mime: part.mediaType,
    // The decoded length, which is what the note's image budget measures against after
    // `4 * ceil(n / 3)` — not the length of the base64 the part arrived as.
    size: part.body.length,
    read: async () => `data:${part.mediaType};base64,${bytesToB64(part.body)}`,
  };
}

/**
 * Every name a part could be asked for by.
 *
 * `Content-Location` is the one that matters for an 印象笔记 export — the HTML's `src` is
 * the same path — but `Content-ID` is what RFC 2557 recommends and what other writers
 * emit, and the `<img src="cid:…">` form is what those notes contain. Both are indexed,
 * plus the bare file name, because a writer that flattens the folder or an HTML that
 * references `image001.png` directly would otherwise find nothing.
 *
 * Over-indexing is free: a key that is never looked up costs a string, and the first
 * part to claim a name wins, which is file order.
 */
function partKeys(p: MhtPart): string[] {
  const keys: string[] = [];

  const loc = p.headers.get('content-location');
  if (loc) {
    const candidates = refCandidates(loc);
    keys.push(...candidates);
    const base = basenameOf(candidates[0] ?? loc);
    if (base) keys.push(base);
  }

  const cid = stripBrackets(p.headers.get('content-id') ?? '');
  if (cid) keys.push(cid, `cid:${cid}`, `<${cid}>`, basenameOf(cid));

  const name = p.params.get('name') || p.params.get('filename');
  if (name) {
    const decoded = decodeEncodedWords(name);
    keys.push(decoded, basenameOf(decoded));
  }

  return keys;
}
