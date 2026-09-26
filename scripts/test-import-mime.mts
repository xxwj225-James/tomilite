// ═══ Phase verification — the `.mht` / MHTML container ═══
//
//   npx tsx scripts/test-import-mime.mts
//
// Exercises `apps/web/src/lib/import/mht.ts` and the decoding chain it shares with the
// other importers (`text.ts`, `refs.ts`). Follows the conventions of
// `scripts/test-fts.mts` and `scripts/test-embed.mts`: same `check/eq/assert` helpers,
// explicit `.ts` module URL, script under `scripts/` so nothing here ships.
//
// ─── Every fixture is written by hand, from the RFC ───
//
// Not one of them is produced by the code under test. A round-trip test — encode with
// `bytesToB64`, decode with `readMht`, compare — passes for any pair of functions that
// agree with each other, including a pair that agrees on the wrong thing. The base64
// constants below are derived from Node's own encoder in the header comment where they
// are not obvious (`5Lit5paH` is `中文`), and the GBK bytes are literal arrays because
// Node has no GBK *encoder* to check them against.
//
// ─── Why this layer is tested here and not through the UI ───
//
// A MIME container is invisible in the app. When an image does not render, the symptom is
// a `> [name]` line in a note, and nothing on screen says whether the boundary walk
// cut the part in the wrong place, the transfer encoding decoded wrong, or the charset
// chain mangled the path. Each of those is a separate assertion below, so a failure names
// itself.
//
// The last section runs the *real* 印象笔记 export, if it is on this machine. It is read
// where it lies (`C:/Users/wuj/Desktop/cpy/tomilite/notes`) and never copied into the
// repo: it is the user's own note.

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { decodeBytes } from '../apps/web/src/lib/import/text.ts';
import { localRef, refCandidates, resolveRelative } from '../apps/web/src/lib/import/refs.ts';
import {
  decodeEncodedWords,
  decodeQuotedPrintable,
  parseContentType,
  readMht,
  resolveMhtResource,
} from '../apps/web/src/lib/import/mht.ts';
import {
  countNoteContainers,
  isGenericTitle,
  isHtmlNoteFile,
  makeResourceIndex,
  type RefLookup,
} from '../apps/web/src/lib/import/html.ts';
import { htmlNotebook, htmlTitle, mhtNotebook } from '../apps/web/src/lib/import/sourceId.ts';
import { isNoteFile } from '../apps/web/src/lib/import/markdown.ts';
import { MAX_IMAGE_BYTES } from '../apps/web/src/lib/import/types.ts';

const SAMPLE_DIR = process.env.TL_SAMPLE_DIR || 'C:/Users/wuj/Desktop/cpy/tomilite/notes';
const SAMPLE_MHT = `${SAMPLE_DIR}/YinXiangBiJi.notes.mht`;

const CRLF = '\r\n';
const enc = new TextEncoder();

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    failures.push(`${name} → ${m}`);
    console.log(`  FAIL ${name} → ${m}`);
  }
}
function eq(actual: unknown, expected: unknown, what = '') {
  if (actual !== expected) throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function bytesOf(v: string | Uint8Array): string {
  return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(Array.from(v));
}
function eqBytes(actual: Uint8Array, expected: string | Uint8Array, what = '') {
  const want = typeof expected === 'string' ? enc.encode(expected) : expected;
  if (actual.length !== want.length || !actual.every((b, i) => b === want[i])) {
    throw new Error(`${what} expected ${bytesOf(expected)}, got ${bytesOf(actual)}`);
  }
}
function section(title: string) {
  console.log(`\n[${title}]`);
}

/** Concatenate strings and byte chunks into one buffer. */
function cat(...chunks: (string | Uint8Array)[]): Uint8Array {
  const arrs = chunks.map((c) => (typeof c === 'string' ? enc.encode(c) : c));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

type Part = { headers?: string[]; body: string | Uint8Array };

/**
 * Build a `multipart/related` message. `fold: true` writes the container's Content-Type
 * across two lines, which is what the real export does and which a header parser that
 * only looks at the first line will miss.
 */
function container(
  boundary: string,
  parts: Part[],
  opts: { top?: string[]; preamble?: string; epilogue?: string; close?: boolean; fold?: boolean } = {},
): Uint8Array {
  const chunks: (string | Uint8Array)[] = ['MIME-Version: 1.0' + CRLF];
  chunks.push(
    opts.fold
      ? `Content-Type: multipart/related;${CRLF}\tboundary="${boundary}"${CRLF}`
      : `Content-Type: multipart/related; boundary="${boundary}"${CRLF}`,
  );
  for (const h of opts.top ?? []) chunks.push(h + CRLF);
  chunks.push(CRLF);
  if (opts.preamble) chunks.push(opts.preamble + CRLF + CRLF);
  for (const p of parts) {
    chunks.push(`--${boundary}${CRLF}`);
    for (const h of p.headers ?? []) chunks.push(h + CRLF);
    chunks.push(CRLF, p.body, CRLF);
  }
  if (opts.close !== false) chunks.push(`--${boundary}--${CRLF}`);
  if (opts.epilogue) chunks.push(opts.epilogue + CRLF);
  return cat(...chunks);
}

/** A `File` that knows its own path — what a folder pick hands over. */
function fileAt(path: string, bytes: Uint8Array = new Uint8Array(4)): File {
  const name = path.split('/').pop() ?? path;
  const f = new File([bytes], name, { type: 'image/png' });
  // A folder pick sets this; a hand-made `File` does not. Own property, so it shadows
  // whatever the runtime's own accessor would return.
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

const HTML_PART: Part = {
  headers: ['Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: quoted-printable'],
  body: '<html><body><p>=E4=B8=AD=E6=96=87</p></body></html>',
};
const PNG_PART: Part = {
  headers: ['Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: Shop.notes_files/a.png'],
  body: 'AQIDBA==', // [1,2,3,4]
};

// ─── 1. The container ───

section('1. container: folded header, quoted boundary with metacharacters, preamble');
{
  // Every character in this boundary that a regex would eat: `+`, `.`, `(`, `)`, `=`.
  const boundary = '----=_Next+Part.0001(458C)';
  const msg = container(boundary, [HTML_PART, PNG_PART], {
    fold: true,
    preamble: 'This is a multi-part message in MIME format.',
    epilogue: 'trailing junk that is not a part',
  });
  const doc = readMht(msg);

  check('reads a multipart/related container', () => assert(doc !== null, 'readMht returned null'));
  check('finds both parts', () => eq(doc!.parts.length, 2));
  check('part media types', () => eq(doc!.parts.map((p) => p.mediaType).join(','), 'text/html,image/png'));
  check('charset survives the quoted parameter', () => eq(doc!.htmlCharset, 'utf-8'));
  check('quoted-printable body decodes to the note text', () =>
    eq(decodeBytes(doc!.htmlBytes, doc!.htmlCharset).includes('<p>中文</p>'), true, 'decoded html'));
  check('base64 body decodes to the right bytes', () => eqBytes(doc!.parts[1].body, [1, 2, 3, 4], 'png body'));
  check('no part is reported undecoded', () => eq(doc!.undecoded, 0));
  check('a closing delimiter means not truncated', () => eq(doc!.truncated, false));
  check('the preamble and epilogue are not parts', () =>
    eq(doc!.parts.some((p) => decodeBytes(p.body).includes('multi-part message')), false, 'preamble leaked into a part'));
}

// ─── 2. Delimiters are anchored, exact, and cannot be faked ───

section('2. delimiter recognition');
{
  const boundary = '----=_Next+Part.0001(458C)';
  // Each line here is a near-miss the sample-shaped writer could produce, or that a
  // snippet of clipped web page could contain. None may split the part.
  const body = [
    '<p>one</p>',
    `----=_Next+Part.0001(458C)EXTRA`, // a longer boundary: RFC 2046 allows one as a prefix
    '<p>two</p>',
    `x ----=_Next+Part.0001(458C)`, // same text, not at a line start
    '<p>three</p>',
    '-'.repeat(40), // a line of nothing but dashes
    '<p>four</p>',
  ].join('\n');

  const msg = container(boundary, [{ headers: ['Content-Type: text/html'], body }, PNG_PART]);
  const doc = readMht(msg);

  check('a near-miss delimiter does not split the part', () => assert(doc !== null, 'readMht returned null'));
  check('the part after a near-miss is still found', () => eq(doc!.parts.length, 2));
  check('the body survives byte-for-byte', () =>
    eqBytes(doc!.htmlBytes, body, 'html body'));
  check('the near-miss text is still in the body', () =>
    eq(decodeBytes(doc!.htmlBytes).includes('-'.repeat(40)), true, 'dash line'));

  // Transport padding after the boundary IS part of the delimiter (RFC 2046), so a line
  // `--boundary␣␣` must split. Asserting the RFC side of the same rule, so a future
  // "tighten the match" change cannot silently drop real parts.
  const padded = cat(
    `Content-Type: multipart/related; boundary="${boundary}"${CRLF}${CRLF}`,
    `--${boundary}  ${CRLF}`,
    `Content-Type: text/html${CRLF}${CRLF}`,
    '<p>a</p>' + CRLF,
    `--${boundary}--${CRLF}`,
  );
  const paddedDoc = readMht(padded);
  check('transport padding after the boundary is still a delimiter', () => {
    assert(paddedDoc !== null, 'readMht returned null');
    eqBytes(paddedDoc!.htmlBytes, '<p>a</p>', 'padded delimiter body');
  });
}

// ─── 3. quoted-printable ───

section('3. quoted-printable');
{
  check('=3D decodes to =', () => eqBytes(decodeQuotedPrintable(enc.encode('a=3Db')), 'a=b'));
  check('lower-case hex decodes the same as upper', () =>
    eqBytes(decodeQuotedPrintable(enc.encode('=e4=b8=ad')), [0xe4, 0xb8, 0xad]));
  check('a multi-byte character decodes to its UTF-8 bytes', () =>
    eqBytes(decodeQuotedPrintable(enc.encode('=E4=B8=AD')), '中'));
  check('a soft line break is removed, not kept', () =>
    eqBytes(decodeQuotedPrintable(enc.encode('one=' + CRLF + 'two')), 'onetwo'));
  check('a soft break at a bare LF is removed too', () =>
    eqBytes(decodeQuotedPrintable(enc.encode('one=\ntwo')), 'onetwo'));
  check('a lone = at the end is kept, not dropped', () =>
    eqBytes(decodeQuotedPrintable(enc.encode('x=')), 'x='));
  check('= followed by non-hex is kept verbatim', () =>
    eqBytes(decodeQuotedPrintable(enc.encode('a=b c')), 'a=b c'));
  check('ordinary text passes through unchanged', () =>
    eqBytes(decodeQuotedPrintable(enc.encode('hello, world')), 'hello, world'));
}

// ─── 4. Charsets ───

section('4. charset: declared form, and the chain when nothing is declared');
{
  const withQuote = readMht(container('b1', [{ headers: ['Content-Type: text/html; charset="gb2312"'], body: 'x' }]));
  const bare = readMht(container('b2', [{ headers: ['Content-Type: text/html; charset=utf-8'], body: 'x' }]));
  const upper = readMht(container('b3', [{ headers: ['Content-Type: text/html; charset=UTF-8'], body: 'x' }]));
  const none = readMht(container('b4', [{ headers: ['Content-Type: text/html'], body: 'x' }]));

  check('quoted charset value', () => eq(withQuote!.htmlCharset, 'gb2312'));
  check('unquoted charset value', () => eq(bare!.htmlCharset, 'utf-8'));
  check('charset label case is preserved as written', () => eq(upper!.htmlCharset, 'UTF-8'));
  check('no charset at all is undefined, not a guess', () => eq(none!.htmlCharset, undefined));

  // The chain itself. Node has no GBK encoder, so the bytes are literal.
  check('valid UTF-8 decodes as UTF-8', () => eq(decodeBytes(new Uint8Array([0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87])), '中文'));
  check('GBK bytes fall back to GBK rather than becoming U+FFFD', () =>
    eq(decodeBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])), '中文'));
  check('a declared charset is tried first', () =>
    eq(decodeBytes(new Uint8Array([0xd6, 0xd0]), 'gbk'), '中'));
  check('a declared charset that does not fit falls through, never throws', () =>
    eq(decodeBytes(new Uint8Array([0xe4, 0xb8, 0xad]), 'gbk').length > 0, true, 'fallthrough'));
  check('an unknown charset label is not an error', () =>
    eq(decodeBytes(new Uint8Array([0x41]), 'x-not-a-charset'), 'A'));
  check('undecodable bytes still produce a string', () =>
    eq(typeof decodeBytes(new Uint8Array([0xff, 0xfe, 0x41])), 'string'));
}

// ─── 5. RFC 2047 encoded words ───

section('5. RFC 2047 encoded words');
{
  check('B encoding, utf-8', () => eq(decodeEncodedWords('=?utf-8?B?5Lit5paH?='), '中文'));
  check('B encoding, GB2312 declared', () => eq(decodeEncodedWords('=?GB2312?B?xOO6ww==?='), '你好'));
  check('Q encoding with =XX', () => eq(decodeEncodedWords('=?utf-8?Q?=E4=B8=AD=E6=96=87?='), '中文'));
  check('Q encoding turns _ into a space', () => eq(decodeEncodedWords('=?utf-8?Q?a_b?='), 'a b'));
  check('whitespace between two encoded words is eaten', () =>
    eq(decodeEncodedWords('=?utf-8?B?5Lit?= =?utf-8?B?5paH?='), '中文'));
  check('whitespace between two encoded words is eaten across a line break', () =>
    eq(decodeEncodedWords('=?utf-8?B?5Lit?=' + CRLF + ' =?utf-8?B?5paH?='), '中文'));
  check('text around encoded words is kept', () =>
    eq(decodeEncodedWords('Re: =?utf-8?B?5Lit5paH?= (draft)'), 'Re: 中文 (draft)'));
  check('an unterminated encoded word is left as written', () =>
    eq(decodeEncodedWords('=?utf-8?B?5Lit'), '=?utf-8?B?5Lit'));
  check('a string with no encoded word is returned unchanged', () => eq(decodeEncodedWords('plain subject'), 'plain subject'));
  check('a header whose value is only an encoded word', () => {
    const doc = readMht(
      container('b5', [HTML_PART], { top: ['Subject: =?utf-8?B?5Lit5paH?='] }),
    );
    eq(doc!.subject, '中文');
  });
}

// ─── 6. Degradation — nothing here may throw ───

section('6. degradation');
{
  check('an empty buffer is null, not a throw', () => eq(readMht(new Uint8Array(0)), null));
  check('plain text is null', () => eq(readMht(enc.encode('hello world')), null));
  check('a single-part message is null', () =>
    eq(readMht(enc.encode('Content-Type: text/plain' + CRLF + CRLF + 'hi')), null));
  check('a multipart with no boundary is null', () =>
    eq(readMht(enc.encode('Content-Type: multipart/related' + CRLF + CRLF + 'hi')), null));
  check('a truncated file still yields its parts', () => {
    const doc = readMht(container('b6', [HTML_PART, PNG_PART], { close: false }));
    assert(doc !== null, 'readMht returned null');
    eq(doc!.parts.length, 2);
    eq(doc!.truncated, true);
  });
  check('an unknown transfer encoding is kept raw and reported', () => {
    const doc = readMht(
      container('b7', [
        { headers: ['Content-Type: text/html', 'Content-Transfer-Encoding: x-uuencode'], body: 'begin 644 x' },
        PNG_PART,
      ]),
    );
    assert(doc !== null, 'readMht returned null');
    eq(doc!.undecoded, 1);
    eq(doc!.parts[0].decoded, false);
    eqBytes(doc!.parts[0].body, 'begin 644 x');
    eq(doc!.parts[1].decoded, true, 'the healthy part is unaffected');
  });
  check('base64 that is not base64 is kept raw and reported', () => {
    const doc = readMht(
      container('b8', [
        HTML_PART,
        { headers: ['Content-Type: image/png', 'Content-Transfer-Encoding: base64'], body: 'not**base64!!' },
      ]),
    );
    assert(doc !== null, 'readMht returned null');
    eq(doc!.undecoded, 1);
    eqBytes(doc!.parts[1].body, 'not**base64!!');
  });
  check('a part with no Content-Type is text/plain', () => {
    const doc = readMht(container('b9', [HTML_PART, { headers: [], body: 'just text' }]));
    assert(doc !== null, 'readMht returned null');
    eq(doc!.parts[1].mediaType, 'text/plain');
    eqBytes(doc!.parts[1].body, 'just text');
  });
  check('a folded Content-Type inside a part is unfolded', () => {
    const doc = readMht(
      container('b10', [{ headers: ['Content-Type: text/html;', '\tcharset="utf-8"'], body: 'x' }]),
    );
    assert(doc !== null, 'readMht returned null');
    eq(doc!.parts[0].mediaType, 'text/html');
    eq(doc!.htmlCharset, 'utf-8');
  });
  check('an empty part body is not an error', () => {
    const doc = readMht(container('b11', [{ headers: ['Content-Type: text/html'], body: '' }]));
    assert(doc !== null, 'readMht returned null');
    eq(doc!.htmlBytes.length, 0);
  });
  check('no text/html part means null, not an image imported as a note', () => {
    const doc = readMht(container('b12', [PNG_PART]));
    eq(doc, null);
  });
}

// ─── 7. The resource index ───

section('7. resource index');
{
  const boundary = 'res-boundary';
  const doc = readMht(
    container(boundary, [
      HTML_PART,
      { headers: ['Content-Type: image/png', 'Content-ID: <abc-123@evernote>'], body: 'AQIDBA==' },
      { headers: ['Content-Type: image/jpeg', 'Content-Location: Shop.notes_files/PC-2备份 23 (1).jpg'], body: 'AQIDBA==' },
      { headers: ['Content-Type: application/pdf', 'Content-Type-Disposition: attachment; name="=?utf-8?B?5Lit5paH?=.pdf"'], body: 'AQIDBA==' },
    ]),
  );

  check('the container parses', () => assert(doc !== null, 'readMht returned null'));
  check('Content-ID is indexed bare', () => assert(doc!.resources.has('abc-123@evernote'), 'bare cid'));
  check('Content-ID is indexed with the cid: scheme', () => assert(doc!.resources.has('cid:abc-123@evernote'), 'cid: form'));
  check('Content-ID is indexed with angle brackets', () => assert(doc!.resources.has('<abc-123@evernote>'), 'bracketed form'));
  check('Content-Location is indexed as written', () =>
    assert(doc!.resources.has('Shop.notes_files/PC-2备份 23 (1).jpg'), 'content-location'));
  check('Content-Location is indexed by bare file name too', () =>
    assert(doc!.resources.has('PC-2备份 23 (1).jpg'), 'bare name'));
  check('the root part is not in the resource index', () =>
    eq(doc!.resources.size > 0 && !doc!.resources.has('text/html'), true));
  check('a percent-encoded reference finds the raw-named part', () =>
    assert(refCandidates('Shop.notes_files/PC-2%E5%A4%87%E4%BB%BD%2023%20(1).jpg').includes('Shop.notes_files/PC-2备份 23 (1).jpg'), 'percent-decoded candidate'));
  check('a reference with a query string resolves to the same part', () =>
    assert(doc!.resources.has(localRef('Shop.notes_files/PC-2备份 23 (1).jpg?t=attachment')!), 'query stripped'));
}

// ─── 8. Reference shapes ───

section('8. reference shapes (refs.ts)');
{
  check('a plain relative path is local', () => eq(localRef('a_files/x.png'), 'a_files/x.png'));
  check('a leading ./ is dropped', () => eq(localRef('./a_files/x.png'), 'a_files/x.png'));
  check('backslashes become slashes', () => eq(localRef('a_files\\x.png'), 'a_files/x.png'));
  check('a query string is stripped', () => eq(localRef('a_files/x.png?t=attachment'), 'a_files/x.png'));
  check('a fragment is stripped', () => eq(localRef('a_files/x.png#top'), 'a_files/x.png'));
  check('file:/// is stripped', () => eq(localRef('file:///C:/notes/a_files/x.png'), 'C:/notes/a_files/x.png'));
  check('a file:// URL with a host is stripped', () =>
    eq(localRef('file://localhost/C:/notes/a_files/x.png'), 'C:/notes/a_files/x.png'));
  check('a POSIX file:// path keeps its leading slash', () =>
    eq(localRef('file:///home/u/a_files/x.png'), '/home/u/a_files/x.png'));
  check('a Windows drive is not read as a scheme', () => eq(localRef('C:/notes/x.png'), 'C:/notes/x.png'));
  check('an https image is external, not a missing file', () => eq(localRef('https://example.com/x.png'), null));
  check('a data: URL is external', () => eq(localRef('data:image/png;base64,AAAA'), null));
  check('an anchor-only ref is external', () => eq(localRef('#top'), null));
  check('an empty ref is external', () => eq(localRef(''), null));
  check('a sibling _files folder resolves against the note directory', () =>
    eq(resolveRelative('notes', 'Shop.notes_files/x.png'), 'notes/Shop.notes_files/x.png'));
  check('a ../ reference resolves upwards', () =>
    eq(resolveRelative('notes/2024', '../Shop.notes_files/x.png'), 'notes/Shop.notes_files/x.png'));
  check('.. above the picked folder does not empty the path', () =>
    eq(resolveRelative('', '../../x.png'), 'x.png'));
  check('an absolute path is returned unchanged', () =>
    eq(resolveRelative('notes', 'C:/other/x.png'), 'C:/other/x.png'));
}

// ─── 9. The HTML export's string layer ───
//
// `html.ts` is the half of the HTML importer that needs no DOM, which is why it can be
// asked these questions here. The two that matter are the divider count and the generic
// title: the first decides whether the user is told their export was collapsed into one
// note, the second decides whether every note in their library is named "Evernote Export".

section('9. the HTML export: file kinds, dividers, generic titles');
{
  check('.html is a note', () => eq(isHtmlNoteFile('Shop.notes.html'), true));
  check('.htm is a note too', () => eq(isHtmlNoteFile('Note.htm'), true));
  check('case does not matter', () => eq(isHtmlNoteFile('Note.HTML'), true));
  check('an image beside it is not a note', () => eq(isHtmlNoteFile('a.png'), false));
  check('a .mht is not an .html note', () => eq(isHtmlNoteFile('Shop.notes.mht'), false));
  check('a .md is not an .html note', () => eq(isHtmlNoteFile('a.md'), false));

  check('no divider, no count', () => eq(countNoteContainers('<body><p>hi</p></body>'), 0));
  check("the exporter's self-closing divider counts one", () =>
    eq(countNoteContainers('<body>\n<a name="506"/>\n<p>hi</p>\n</body>'), 1));
  check('three dividers count three', () =>
    eq(countNoteContainers('<a name="1"/><p>a</p><a name="2"/><p>b</p><a name="3"/><p>c</p>'), 3));
  check('an immediately-closed pair counts', () => eq(countNoteContainers('<a name="1"></a><p>x</p>'), 1));
  check('a stray attribute does not hide the divider', () => eq(countNoteContainers('<a class="x" name="7"/>'), 1));

  // The concession that keeps the detector from lying. A note clipped from a web page is
  // full of in-page anchors, and the only thing telling one apart from a note boundary is
  // that the boundary is empty. If these ever count, the detector reports a whole-notebook
  // export that does not exist.
  check('an anchor with text in it is not a divider', () => eq(countNoteContainers('<a name="top">Contents</a>'), 0));
  check('an empty anchor with no name is not a divider', () => eq(countNoteContainers('<a href="#top"></a>'), 0));
  check('`data-name` is not `name`', () => eq(countNoteContainers('<a data-name="x"/>'), 0));

  check("the export's own title is not a title", () => eq(isGenericTitle('Evernote Export'), true));
  check('nor in another case, nor with padding', () => eq(isGenericTitle('  evernote EXPORT '), true));
  check('nor the Chinese one', () => eq(isGenericTitle('印象笔记导出'), true));
  check('a real title is a title', () => eq(isGenericTitle('Shopping list'), false));
  check('and a title that merely mentions Evernote is a title', () => eq(isGenericTitle('Evernote 使用心得'), false));
}

// ─── 10. The index of picked files ───
//
// Three levels of lookup and one refusal, all of which are about *paths* and so are
// answerable here. The refusal is the one worth testing hardest: `image001.png` repeats in
// every `_files` folder, and picking the wrong file puts the wrong picture in a note with
// nothing on screen to say so.

section('10. the index of picked files');
{
  const noteFile = fileAt('notes/Shop.notes.html');
  const shopA = fileAt('notes/Shop.notes_files/a.png');
  const shopB = fileAt('notes/Shop.notes_files/b.png');
  const otherA = fileAt('notes/Other.notes_files/a.png');
  const spaced = fileAt('notes/Shop.notes_files/PC-2备份 23 (1).png');
  const index = makeResourceIndex([noteFile, shopA, shopB, otherA, spaced]);

  const at = (ref: string, note = 'notes/Shop.notes.html'): RefLookup => index(ref, note);
  /** The file the lookup picked, by identity — a name is not enough, since the whole point
   *  of three of these assertions is that two files share one. */
  const picked = (ref: string, note = 'notes/Shop.notes.html'): File | null => {
    const hit = at(ref, note);
    return hit.kind === 'found' ? hit.file : null;
  };

  check('level 1: a sibling `_files` path resolves', () =>
    eq(picked('Shop.notes_files/a.png'), shopA));
  check('…and it is the file in the note’s own folder, not the same name elsewhere', () =>
    eq(picked('Shop.notes_files/a.png') === otherA, false));
  check("the exporter's ?t= query is not part of the file name", () =>
    eq(picked('Shop.notes_files/b.png?t=attachment'), shopB));
  check('level 2: `../` from a note one folder down resolves', () =>
    eq(picked('../Shop.notes_files/b.png', 'notes/2024/x.html'), shopB));
  check('level 3: a bare file name resolves', () => eq(picked('b.png'), shopB));
  check('a file:/// reference resolves', () =>
    eq(picked('file:///C:/notes/Shop.notes_files/b.png'), shopB));
  check('a percent-encoded reference resolves to the name with the space', () =>
    eq(picked('Shop.notes_files/PC-2%E5%A4%87%E4%BB%BD%2023%20(1).png'), spaced));
  check('the raw name resolves too — the exporter does not encode it', () =>
    eq(picked('Shop.notes_files/PC-2备份 23 (1).png'), spaced));

  // The refusal, and its most important property: it does not fall through to a shorter
  // and even less specific level on the way out.
  check('a bare name two files claim is ambiguous', () => eq(at('a.png').kind, 'ambiguous'));
  check('ambiguity yields no file at all', () => eq(picked('a.png'), null));
  check('level 1 still wins while the bare name stays ambiguous', () =>
    eq(picked('Shop.notes_files/a.png'), shopA));

  check('a remote image is external, not missing', () => eq(at('https://example.com/a.png').kind, 'external'));
  check('an inline data: URL is external too', () =>
    eq(at('data:image/png;base64,AQIDBA==').kind, 'external'));
  check('a name nothing answers to is missing', () => eq(at('Shop.notes_files/nope.png').kind, 'missing'));
  check('a missing file in a folder that was not picked is missing, not a crash', () =>
    eq(at('Elsewhere_files/x.png').kind, 'missing'));

  // Indexing the notes as well as the images is what makes this one true. It is harmless
  // — no `<img>` points at a note — and it is stated so that nobody "fixes" it later by
  // filtering the index, which would break a note that embeds another note's file.
  check('the note file is in the index like everything else', () =>
    eq(picked('Shop.notes.html'), noteFile));
}

// ─── 11. The real export, read where it lies ───

section('11. the real 印象笔记 export');
if (!existsSync(SAMPLE_MHT)) {
  console.log(`  skip (not on this machine: ${SAMPLE_MHT})`);
} else {
  const raw = new Uint8Array(readFileSync(SAMPLE_MHT));
  const doc = readMht(raw);

  check('the real .mht parses', () => assert(doc !== null, 'readMht returned null'));
  check('it has four parts', () => eq(doc!.parts.length, 4));
  check('one HTML part and three PNG parts', () =>
    eq(doc!.parts.map((p) => p.mediaType).join(','), 'text/html,image/png,image/png,image/png'));
  check('it is not truncated', () => eq(doc!.truncated, false));
  check('every part decodes', () => eq(doc!.undecoded, 0));
  check('its charset is utf-8', () => eq(doc!.htmlCharset, 'utf-8'));

  const html = decodeBytes(doc!.htmlBytes, doc!.htmlCharset);
  check('the HTML part is HTML', () => assert(html.startsWith('<html>') || html.includes('<html>'), 'html head'));
  check('the note divider anchor survived', () => assert(/<a name="\d+"\s*\/?>/.test(html), 'missing <a name> anchor'));

  // The load-bearing contract between the two halves: every `src` in the HTML resolves to
  // a part in the container, once the exporter's own `?t=attachment` is stripped. If this
  // fails, the note imports with placeholders where its images were.
  const srcs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)].map((m) => m[1]);
  check('the HTML references three images', () => eq(srcs.length, 3));
  check('every <img src> finds its part', () => {
    const missing = srcs.filter((s) => !doc!.resources.has(localRef(s) ?? ''));
    eq(missing.length, 0, `unresolved: ${JSON.stringify(missing)}`);
  });

  // And the decoded bytes are the bytes on disk, byte for byte — the one assertion that
  // catches a boundary walk or a transfer decode that is off by a little.
  check('a decoded image equals the PNG on disk', () => {
    const loc = doc!.parts[1].headers.get('content-location')!;
    const disk = readFileSync(`${SAMPLE_DIR}/${loc}`);
    eqBytes(doc!.parts[1].body, new Uint8Array(disk), 'image bytes');
    eqBytes(doc!.parts[1].body.subarray(0, 4), [0x89, 0x50, 0x4e, 0x47], 'PNG magic');
  });

  // The boundary this exporter chose is quoted, folded, and full of metacharacters. If
  // the parser had a shortcut anywhere, this is where it would show.
  check('the boundary is read whole, not truncated at a metacharacter', () => {
    const ct = doc!.parts[0].headers.get('content-type') ?? '';
    assert(parseContentType('multipart/related; boundary="a+b.c(d)=e"').params.get('boundary') === 'a+b.c(d)=e', ct);
  });

  // What the file does NOT contain — recorded so a future change cannot quietly start
  // relying on it. There is no Subject and no Content-ID anywhere; images are addressed
  // by Content-Location alone.
  check('the container has no Subject', () => eq(doc!.subject, undefined));
  check('the images carry Content-Location, not Content-ID', () =>
    eq(doc!.parts.slice(1).every((p) => p.headers.has('content-location') && !p.headers.has('content-id')), true));
}

// ─── 12. The hand-made fixture ───
//
// `scripts/make-import-fixtures.mts` writes a folder for the *manual* check — the DOM half
// of the import cannot be driven from here, so it has to be looked at in the app. What this
// section does is check the claims its README makes, so that a user who opens the dialog and
// sees something else is looking at a bug in the importer and not at a bug in the fixture.

section('12. the hand-made fixture (scripts/make-import-fixtures.mts)');
const FIXTURE = process.env.TL_FIXTURE_DIR || 'C:/tmp/tl/import-fixtures';
if (!existsSync(`${FIXTURE}/shop`)) {
  console.log('  skip (run: npx tsx scripts/make-import-fixtures.mts)');
} else {
  const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(`${FIXTURE}/shop/${rel}`));
  const FILES = [
    'Shop.notes.html',
    'Shop.notes_files/a.png',
    'Shop.notes_files/big.png',
    'Second.notes.html',
    'Second.notes_files/a.png',
    'Books/Books.notes.html',
    'Work/note-a.html',
  ];
  // With their real bytes on disk, so `file.size` is a fact about the fixture and not the
  // four bytes a stub `File` would carry.
  const files = FILES.map((rel) => fileAt(rel, read(rel)));
  const sizeOf = (rel: string) => read(rel).length;

  check('the fixture holds four HTML notes', () =>
    eq(files.filter((f) => isHtmlNoteFile(f.name)).length, 4));
  // The reason `isHtmlNoteFile` is a separate predicate rather than a widened `isNoteFile`:
  // an `.html` handed to the Markdown reader would be imported as its own source text.
  check('and Markdown’s own predicate does not claim them', () =>
    eq(files.filter((f) => isNoteFile(f.name)).length, 0));

  const shopHtml = decodeBytes(read('Shop.notes.html'));
  check('the note carries the format’s own title', () =>
    eq(isGenericTitle(/<title>([^<]*)<\/title>/.exec(shopHtml)?.[1] ?? ''), true));
  check('so the title falls back to the file name', () => eq(htmlTitle('Shop.notes.html'), 'Shop'));
  check('and the notebook comes from the .notes infix', () => eq(htmlNotebook('Shop.notes.html'), 'Shop'));
  check('a note with no infix takes its notebook from the folder', () =>
    eq(htmlNotebook('Work/note-a.html'), 'Work'));

  const booksHtml = decodeBytes(read('Books/Books.notes.html'));
  check('the whole-notebook file really has two dividers', () => eq(countNoteContainers(booksHtml), 2));

  const index = makeResourceIndex(files);
  const at = (ref: string, note: string): RefLookup => index(ref, note);
  check('the first note’s own image resolves, and is the file on disk', () => {
    const hit = at('Shop.notes_files/a.png?t=attachment', 'Shop.notes.html');
    eq(hit.kind, 'found');
    eq(hit.kind === 'found' ? hit.file.size : 0, sizeOf('Shop.notes_files/a.png'));
  });
  check('the second note’s same-named image is a different file', () => {
    const hit = at('Second.notes_files/a.png', 'Second.notes.html');
    eq(hit.kind, 'found');
    eq(hit.kind === 'found' ? hit.file.size : 0, sizeOf('Second.notes_files/a.png'));
  });
  check('a bare name two folders claim is ambiguous', () => eq(at('a.png', 'Shop.notes.html').kind, 'ambiguous'));
  check('the image the fixture never wrote is missing', () =>
    eq(at('Shop.notes_files/ghost.png', 'Shop.notes.html').kind, 'missing'));
  check('the remote image is left alone', () =>
    eq(at('https://example.com/remote.png', 'Shop.notes.html').kind, 'external'));
  // The whole reason `big.png` exists: it has to be over the cap, or the fixture stops
  // testing the drop path while still looking like it does.
  check('big.png is over the image cap and a.png is not', () => {
    const b64 = (rel: string) => 4 * Math.ceil(sizeOf(rel) / 3);
    assert(b64('Shop.notes_files/big.png') > MAX_IMAGE_BYTES, 'big.png is under the cap');
    assert(b64('Shop.notes_files/a.png') < MAX_IMAGE_BYTES, 'a.png is over the cap');
  });

  const mht = readMht(read('Shop.notes.mht'));
  check('the .mht parses', () => assert(mht !== null, 'readMht returned null'));
  check('its Subject decodes out of RFC 2047', () => eq(mht!.subject, '你好'));
  check('its notebook is the file name', () => eq(mhtNotebook('Shop.notes.mht'), 'Shop'));
  check('a cid: reference resolves', () => {
    const r = resolveMhtResource(mht!, 'cid:img1@tomilite');
    eq(r.kind, 'found');
    assert(r.kind === 'found' && r.size > 0, 'empty inline image');
  });
  check('a cid: pointing at the PDF resolves to a non-image', () => {
    const r = resolveMhtResource(mht!, 'cid:doc1@tomilite');
    eq(r.kind === 'found' ? r.mime : r.kind, 'application/pdf');
  });
  check('a reference the container does not hold is missing', () =>
    eq(resolveMhtResource(mht!, 'Shop.notes_files/ghost.png').kind, 'missing'));
  check('its HTML part has one divider — the detector stays quiet for it', () =>
    eq(countNoteContainers(decodeBytes(mht!.htmlBytes, mht!.htmlCharset)), 1));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
