// ═══ HTML element → Markdown, via turndown ═══
//
// turndown is loaded lazily and kept behind this one function, the same way `xlsx`,
// `mammoth` and `pdfjs-dist` are behind their call sites in `useFileAttach.ts`: it is
// ~30 KB that only an import needs, and the notes panel is on the startup path.

let service: any = null;

/**
 * The configured converter: options plus the rule this importer needs.
 *
 * Exported separately from `htmlToMarkdown` because it is the part worth testing on its
 * own. The options and the rule decide what the Markdown looks like, and unlike the DOM
 * half they need no browser — turndown's Node build parses HTML with the same library the
 * browser build uses, so a rule can be checked here against the real turndown rather than
 * against a description of it.
 */
export async function createConverter(): Promise<any> {
  if (service) return service;
  const turn: any = await import('turndown');
  const gfm: any = await import('turndown-plugin-gfm');
  const TurndownService = turn.default ?? turn;
  const td = new TurndownService({
    headingStyle: 'atx', // `#` — what `marked` and the notes editor both render
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });
  // Tables, strikethrough and task lists. Without `gfm` every table in an imported
  // note becomes a run of paragraphs, and exports are full of tables.
  td.use((gfm.default ?? gfm).gfm);

  // Placeholders for the things an import could not carry over: an oversized image, a
  // PDF, an image whose file was not in the pick. The text is written verbatim into an
  // attribute rather than left as body text because turndown **escapes text nodes** — a
  // placeholder beginning `> [shot.png]` comes out as `\> \[shot.png\]`, which is markdown
  // for "the literal characters `> [shot.png]`". Only a rule can emit punctuation as
  // punctuation.
  //
  // The marker element carries visible text so that turndown's blank check — which runs
  // before rule lookup — does not discard it first.
  td.addRule('tlPlaceholder', {
    filter: (node: any) => node.nodeName === 'SPAN' && node.getAttribute('data-tl-ph') !== null,
    replacement: (_content: string, node: any) => '\n\n' + node.getAttribute('data-tl-ph') + '\n\n',
  });

  service = td;
  return td;
}

/**
 * Convert one element to Markdown.
 *
 * ## The element is serialised to a string, never handed to turndown directly
 *
 * turndown compares `nodeName` against two **uppercase** tables (`blockElements`,
 * `voidElements`) via `is(node, names) → names.indexOf(node.nodeName) >= 0`, while its rule
 * filters lowercase the name (`filter === node.nodeName.toLowerCase()`). A tree whose node
 * names are lowercase therefore matches every *rule* and no *structure*: `isBlock` is false
 * for `<div>`, `<p>` and `<h1>`, so all block structure flattens into one paragraph;
 * `isVoid` is false for `<img>` and `<br>`, so an image is an element with no text content
 * and turndown's blank check drops it silently. Nothing throws. The note just arrives
 * mangled.
 *
 * Serialising into an HTML document first — `innerHTML` on an HTML element — puts the tree
 * through the HTML parser, which is the shape turndown is written and tested against.
 *
 * **This guard was written for a `text/xml` tree and the current callers do not produce
 * one.** `parseHtmlNote` parses with `text/html`, whose node names are already uppercase,
 * so today the round-trip is redundant rather than load-bearing: it costs one extra parse
 * and normalises the markup on the way through. It stays because passing the node straight
 * through is a change to how every imported note is formatted — worth doing deliberately
 * with a fixture in hand, not as a footnote to removing an importer. Whichever happens
 * first, this paragraph is the thing to re-read.
 */
export async function htmlToMarkdown(root: Element): Promise<string> {
  const holder = document.createElement('div');
  holder.appendChild(document.importNode(root, true));
  const td = await createConverter();
  return String(td.turndown(holder.innerHTML)).trim();
}
