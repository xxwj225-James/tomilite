// ═══ The two DOM rewrites the importers share ═══
//
// Both replace an element in a parsed tree with something turndown knows how to render,
// and both have to run **before** turndown sees the tree. `htmlNote.ts` is the only caller
// — the Markdown path has no DOM at all, and `.mht` reaches these through the same
// `parseHtmlNote` the `.html` path uses.
//
// Zero imports on purpose. A module of DOM utilities that pulls in nothing can be read
// without following an import graph.

/** Replace an element with a marked span the converter turns into `text` verbatim. */
export function placeholder(doc: Document, el: Element, text: string): void {
  const span = doc.createElement('span');
  span.setAttribute('data-tl-ph', text);
  // Visible text so turndown's blank check does not drop it before the rule runs; if
  // the rule were ever to stop matching, this is what the user sees instead of nothing.
  span.textContent = '📎';
  el.parentNode?.replaceChild(span, el);
}

/** Replace an element with an image whose bytes are already inline. */
export function inlineImage(doc: Document, el: Element, src: string, name: string): void {
  const img = doc.createElement('img');
  // The same shape `MarkdownEditor` writes for a pasted image, so an imported note
  // behaves like one the user made: it renders, and it exports.
  img.setAttribute('src', src);
  img.setAttribute('alt', name);
  el.parentNode?.replaceChild(img, el);
}
