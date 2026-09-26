// ═══ Bytes ↔ text, and the timestamp shape ═══
//
// The encoding helpers every importer needs. Lifted out of `markdown.ts` when the HTML and
// MHTML importers arrived and would otherwise have been the third and fourth copies of
// "decode these bytes, but not as UTF-8 if that is wrong".
//
// Zero imports, like `buckets.ts` and `mht.ts`: `TextDecoder` and `atob` are globals, so
// this module can be exercised directly under Node (see `scripts/test-import-mime.mts`)
// without a DOM or an import graph behind it.

/**
 * The decoding chain, in the order that keeps the most notes readable.
 *
 * `File.text()` assumes UTF-8, and a file that is not UTF-8 does not fail loudly — it
 * decodes with U+FFFD replacement characters, so a note written in a Windows editor on a
 * Chinese system arrives as a page of `�` and the user's only clue is that the import
 * "worked".
 *
 * `fatal: true` makes the decoder throw on invalid UTF-8 instead of substituting, which
 * turns "silently mangled" into a signal. The fallback is Chromium's built-in GBK
 * decoder — no new dependency, and available everywhere this app runs. A file that is
 * neither is decoded leniently as UTF-8, i.e. the old behaviour, because a mangled note
 * still beats no note.
 *
 * A declared charset is tried **first but never exclusively**. A part that announces
 * `charset=utf-8` while holding GBK bytes is a real thing in exports, and honouring the
 * declaration absolutely would turn exactly the notes this chain exists for back into
 * mojibake. An unknown label is not an error either: `TextDecoder` throws `RangeError`,
 * which drops through to the same chain as a file that declared nothing.
 */
export function decodeBytes(bytes: ArrayBuffer | Uint8Array, charset?: string): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (charset) {
    try {
      return new TextDecoder(charset, { fatal: true }).decode(buf);
    } catch {
      /* unknown label, or the bytes do not fit it — both fall through */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}

/** Read one file as text through the chain above. */
export async function readText(file: File): Promise<string> {
  return decodeBytes(await file.arrayBuffer());
}

/** Base64 → bytes. */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Bytes → base64.
 *
 * Chunked, and the chunking is not a micro-optimisation: `String.fromCharCode(...bytes)`
 * spreads every byte as a call argument, so a 5 MB image overflows the call stack. That
 * failure lands in the middle of an import that was working until the user picked a note
 * with a bigger picture in it, which makes it look like the note is the problem.
 */
export function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Epoch milliseconds → this codebase's naive-UTC stamp (`YYYY-MM-DD HH:MM:SS`), the
 * shape every `*At` column holds. Built from the ISO string rather than from the local
 * getters so the value is the instant the file was last written, not that instant
 * shifted by the user's timezone offset.
 *
 * A three-line copy of what `nowDbUtc()` does in `lib/dbTime.ts`, which takes no
 * argument and so cannot be reused for a timestamp that is not "now".
 */
export function utcStampOf(ms: number): string | undefined {
  if (!ms || !Number.isFinite(ms)) return undefined;
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
}
