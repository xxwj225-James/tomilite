// ═══ Fixtures for the saved-web-page / web-archive import, written outside the repo ═══
//
//   npx tsx scripts/make-import-fixtures.mts
//
// Writes a small but deliberately awkward export to `C:/tmp/tl/import-fixtures/` (override
// with `TL_FIXTURE_DIR`) so the import can be checked by hand — select the files in `shop/`
// in the import dialog and read the summary against the expectations printed below. It
// exists because the only real export on hand holds **one note**, so most of the paths that
// matter (two notes in one pick, an image that resolves, an image that does not, a title
// that arrives through RFC 2047) would otherwise go unexercised until a second real export
// shows up.
//
// **What the file picker costs, and where the rest of the coverage went.** The import
// dialog takes files, not folders, and a file pick can only reach one folder's contents —
// so the `_files` companions below can never be in the same pick as the note that
// references them. Most of what this fixture was built to check (the image cap, an
// ambiguous name, a missing file) is therefore no longer reachable through the UI at all;
// those cases are asserted directly against `makeResourceIndex` in
// `scripts/test-import-mime.mts` §12, which is now the coverage that matters. What is left
// for the manual check is note-level: titles, notebooks, the divider warning, the `.mht`'s
// own inline image.
//
// Never written into the repository: it is test data, and it is this script's output rather
// than a committed artifact, so it cannot drift from the parsers it tests.
//
// The images are real PNGs built here with `node:zlib` — a bare `Buffer.alloc` would decode
// as a broken image, and "the picture really renders" is one of the things being checked.
// Modelled on a real 印象笔记 export (2026-09-22): the `.notes` infix in the file names, the
// `_files` folder, and the `<title>` are its shape, not invented.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = process.env.TL_FIXTURE_DIR || 'C:/tmp/tl/import-fixtures';
const CRLF = '\r\n';
const enc = new TextEncoder();

// ─── A minimal PNG encoder ───

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(enc.encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function cat(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Truecolour, no alpha, filter 0 on every row — enough for a viewer and nothing more. */
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type 2 (truecolour)
  return cat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  );
}

/** A gradient — compresses small, which is what a normal screenshot does. */
function smallImage(seed: number): Uint8Array {
  return png(240, 160, (x, y) => [(x * 255 / 240) | 0, (y * 255 / 160) | 0, (seed * 40) % 256]);
}

/**
 * Noise from a fixed LCG, so the file is deterministic and still **incompressible**.
 *
 * Size is the point: it has to exceed `MAX_IMAGE_BYTES` (256 KB of base64, measured on the
 * payload) and a compressible picture of any dimension would not.
 */
function bigImage(): Uint8Array {
  let s = 12345;
  // xorshift32, not the usual `s * 1103515245 + 12345` LCG: the LCG's output is linear
  // enough in adjacent values that deflate takes 786 KB of it down to 22 KB — the file
  // would be under the image cap and this fixture would quietly stop testing it. Measured,
  // not assumed.
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s >>> 24) & 0xff;
  };
  return png(512, 512, () => [next(), next(), next()]);
}

// ─── The note bodies ───

const FOLDERS = {
  shopNote: 'shop/Shop.notes.html',
  shopImg: 'shop/Shop.notes_files/a.png',
  bigImg: 'shop/Shop.notes_files/big.png',
  second: 'shop/Second.notes.html',
  secondImg: 'shop/Second.notes_files/a.png',
  mht: 'shop/Shop.notes.mht',
  books: 'shop/Books/Books.notes.html',
  work: 'shop/Work/note-a.html',
};

function page(title: string, body: string): string {
  return [
    '<html><head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    `<title>${title}</title>`,
    '</head><body>',
    body,
    '</body></html>',
  ].join('\n');
}

// `Evernote Export` is the format's own title on every file — the importer must refuse it
// and fall back to the file name, which is why it is the title here.
const SHOP_HTML = page(
  'Evernote Export',
  [
    '<a name="501"/>',
    '<p>第一篇：图片应当渲染出来，而不是变成一行占位。</p>',
    '<p><img src="Shop.notes_files/a.png?t=attachment" type="image/png"/></p>',
    // Past `MAX_IMAGE_BYTES` → a named placeholder, counted as `dropped`.
    '<p><img src="Shop.notes_files/big.png?t=attachment"/></p>',
    // A bare name two `_files` folders both hold → refused as ambiguous, not guessed.
    '<p><img src="a.png"/></p>',
    // Referenced by the export but not written by this script → `missing` + a warning.
    '<p><img src="Shop.notes_files/ghost.png?t=attachment"/></p>',
    // Remote: left exactly as it is, counted as nothing. Expect a broken-image icon.
    '<p><img src="https://example.com/remote.png"/></p>',
  ].join('\n'),
);

// The same bare file name as the first note's, in a different `_files` folder: proves the
// reference is resolved against the note's own directory rather than by name.
const SECOND_HTML = page(
  'Evernote Export',
  ['<a name="502"/>', '<p>第二篇：这张图必须来自 Second.notes_files，而不是 Shop 的那张。</p>', '<p><img src="Second.notes_files/a.png"/></p>'].join('\n'),
);

// Two dividers — the detector warns and the file still imports as **one** note.
const BOOKS_HTML = page(
  'Evernote Export',
  ['<a name="601"/>', '<p>这一页里有两个分隔标记。</p>', '<a name="602"/>', '<p>导入后应当只有一篇笔记，并有一条「2 notes in one file」的提示。</p>'].join('\n'),
);

// The multi-page shape: one HTML per note, no `.notes` infix, notebook from the folder.
const WORK_HTML = page('Evernote Export', ['<p>多页导出里的普通一篇，没有分隔标记。</p>'].join('\n'));

// ─── The .mht container ───
//
// Dirty on purpose, in the three ways the real exporter is dirty: the boundary is quoted,
// the `Content-Type` header is **folded** across two lines, and the container carries a
// preamble before the first delimiter. A parser with a shortcut anywhere fails here.

const BOUNDARY = '----=_NextPart_TL0001_00000001';

function mhtPart(headers: string[], body: string | Uint8Array): Uint8Array {
  return cat(enc.encode(`--${BOUNDARY}${CRLF}${headers.join(CRLF)}${CRLF}${CRLF}`), typeof body === 'string' ? enc.encode(body) : body, enc.encode(CRLF));
}

function b64(bytes: Uint8Array): string {
  // 76-character lines, as any base64 encoder writes them.
  return Buffer.from(bytes).toString('base64').replace(/(.{76})/g, `$1${CRLF}`);
}

function buildMht(): Uint8Array {
  const inline = smallImage(7);
  const html = page(
    'Evernote Export',
    [
      '<a name="701"/>',
      '<h2>一篇 .mht</h2>',
      '<p>标题应当来自容器的 Subject 头（RFC 2047），显示为「你好」。</p>',
      '<p><img src="cid:img1@tomilite"/></p>',
      '<p>下面这张引用的部分不存在，应当显示占位并在汇总里点名 ghost.png。</p>',
      '<p><img src="Shop.notes_files/ghost.png"/></p>',
      '<p>这一张指向一个非图片部分，应当计入 attachments 并显示占位。</p>',
      '<p><img src="cid:doc1@tomilite"/></p>',
    ].join('\n'),
  );

  const top = [
    'MIME-Version: 1.0',
    'Content-Type: multipart/related;',
    `\tboundary="${BOUNDARY}"`,
    'X-Mailer: Evernote  v7.04.30.9439',
    // 你好, in GB2312 — the encoding the observed export's headers actually use.
    'Subject: =?GB2312?B?xOO6ww==?=',
    'Date: Tue, 22 Sep 2026 10:00:00 +0800',
  ].join(CRLF);

  return cat(
    enc.encode(`${top}${CRLF}${CRLF}`),
    enc.encode(`This is a multi-part message in MIME format.${CRLF}${CRLF}`),
    // 8bit rather than quoted-printable: the QP path is covered by hand-written fixtures in
    // `scripts/test-import-mime.mts`, and a fixture that also has to be a correct QP encoder
    // would report its own bugs as the importer's.
    mhtPart(['Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: 8bit'], html),
    mhtPart(
      [
        'Content-Type: image/png; name="tl-inline.png"',
        'Content-Transfer-Encoding: base64',
        'Content-ID: <img1@tomilite>',
        'Content-Location: Shop.notes_files/tl-inline.png',
      ],
      b64(inline),
    ),
    mhtPart(
      ['Content-Type: application/pdf; name="doc1.pdf"', 'Content-Transfer-Encoding: base64', 'Content-ID: <doc1@tomilite>'],
      b64(enc.encode('%PDF-1.4\n% not a real PDF — the importer never opens it.\n')),
    ),
    enc.encode(`--${BOUNDARY}--${CRLF}`),
  );
}

// ─── Write it out ───

rmSync(OUT, { recursive: true, force: true });
const write = (rel: string, data: string | Uint8Array) => {
  const full = `${OUT}/${rel}`;
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, data);
  return typeof data === 'string' ? enc.encode(data).length : data.length;
};

const written: Array<[string, number]> = [
  [FOLDERS.shopNote, write(FOLDERS.shopNote, SHOP_HTML)],
  [FOLDERS.shopImg, write(FOLDERS.shopImg, smallImage(3))],
  [FOLDERS.bigImg, write(FOLDERS.bigImg, bigImage())],
  [FOLDERS.second, write(FOLDERS.second, SECOND_HTML)],
  [FOLDERS.secondImg, write(FOLDERS.secondImg, smallImage(5))],
  [FOLDERS.mht, write(FOLDERS.mht, buildMht())],
  [FOLDERS.books, write(FOLDERS.books, BOOKS_HTML)],
  [FOLDERS.work, write(FOLDERS.work, WORK_HTML)],
];

const README = `import fixtures — select files in the import dialog, not folders.

The dialog takes a file pick, and a file pick reaches one folder's contents. So the pick
that works is the three files directly inside shop/:

  Shop.notes.html   Second.notes.html   Shop.notes.mht

Expected result: 3 notes, and one of them is missing a great deal.

  Shop      ← Shop.notes.html and Shop.notes.mht (the .notes infix names the notebook,
              so both land in the same notebook)
  Second    ← Second.notes.html

Summary should read:

  created:      3
  images:       1   the .mht's own PNG, referenced by cid: — it travels inside the file
  dropped:      6   4 in Shop.notes.html (a.png, big.png, bare a.png, ghost.png),
                    1 in Second.notes.html (a.png), 1 in the .mht (ghost.png)
  attachments:  1   the .mht's PDF, embedded as an <img>
  warnings:     three missing-image lines, one per file, each naming the first one it
                could not find — none for the divider, since Books/ is not in this pick

There should be NO "images: 2". That count is what a folder pick produced, and the two
resolvable images it counted both live in a _files folder the picker cannot reach. Every
image reference in an .html note is now a placeholder line, and the summary says so. That
is the accepted cost of one button (see docs/architecture.md §6.16); the .mht is unaffected
because its resources are inside the file.

One note, titled 你好 (RFC 2047 GB2312 in the container's Subject), carries the .mht.

Also selectable, and worth doing once — these two sit in subfolders, so they need their own
pick (navigate into Books/, then Work/):

  - Books/Books.notes.html holds two note dividers → the detector warns and the file
    imports as ONE note. Splitting it is out of scope by decision, not by oversight.
  - Work/note-a.html is the multi-page shape: no .notes infix, so the notebook comes from
    the path and it is filed as "Work".
  - Work/index.html is what a real multi-page export also contains and this fixture does
    not: expect it as another note if you add one.

Deliberately awkward, and no longer reachable through the UI — these are asserted against
makeResourceIndex in scripts/test-import-mime.mts §12 instead:

  - big.png is over the 256 KB image cap and must become a placeholder, not be inlined.
  - a.png is referenced bare and exists in TWO _files folders → ambiguous → placeholder.
    Its full relative path still resolves, so the first note's own a.png would render.
  - ghost.png is referenced and never written → missing → placeholder + a named warning.
  - https://example.com/remote.png is left as it is — a broken-image icon is correct.

Re-run this script any time; it deletes and rewrites the folder.
`;

write('README.txt', README);

console.log(`wrote ${OUT}\n`);
for (const [rel, size] of written) console.log(`  ${String(size).padStart(8)}  ${rel}`);
console.log(`  ${String(README.length).padStart(8)}  README.txt`);
console.log(`\nSelect the files directly inside "${OUT}/shop" in the import dialog, then read README.txt.`);
