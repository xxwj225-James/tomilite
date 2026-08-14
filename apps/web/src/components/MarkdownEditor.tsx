import { useEffect, useRef, useState } from 'react';
import { useLang } from '@/stores/useLang';
import { t } from '@/lib/i18n';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { Editor, rootCtx, defaultValueCtx, rootAttrsCtx, editorViewCtx, editorViewOptionsCtx, schemaCtx } from '@milkdown/kit/core';
import {
  commonmark, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand,
  wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  wrapInBlockquoteCommand, createCodeBlockCommand, insertHrCommand,
  toggleLinkCommand, insertImageCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  gfm, toggleStrikethroughCommand, insertTableCommand,
  deleteSelectedCellsCommand, setAlignCommand,
  selectRowCommand, selectColCommand, selectTableCommand,
} from '@milkdown/kit/preset/gfm';
import { columnResizingPlugin } from '@milkdown/preset-gfm';
import { history } from '@milkdown/kit/plugin/history';
import { keymap as proseKeymap } from '@milkdown/prose/keymap';
import { replaceAll, callCommand } from '@milkdown/kit/utils';
import { isInTable } from 'prosemirror-tables';
import { $prose, $mark } from '@milkdown/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import powershell from 'highlight.js/lib/languages/powershell';
import ini from 'highlight.js/lib/languages/ini';

function _regLang(name: string, mod: any) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, mod);
}
_regLang('javascript', javascript); _regLang('js', javascript);
_regLang('typescript', typescript); _regLang('ts', typescript);
_regLang('python', python);         _regLang('py', python);
_regLang('bash', bash);             _regLang('sh', bash);
_regLang('json', json);
_regLang('css', css);
_regLang('sql', sql);
_regLang('xml', xml);               _regLang('html', xml);
_regLang('markdown', xml);
_regLang('powershell', powershell); _regLang('ps1', powershell);
_regLang('toml', ini);               _regLang('ini', ini);

const HL_KEY = new PluginKey('hl');

// ─── Custom marks: text color + background highlight ───
// @ts-expect-error Milkdown MarkSchema compat
const textColorMark = $mark('textColor', () => ({
  attrs: { color: {} },
  parseDOM: [{
    style: 'color',
    getAttrs: (v: string) => v ? { color: v } : null,
  }],
  toDOM: (mark: any) => ['span', { style: `color:${mark.attrs.color || '#ef4444'}` }, 0],
}));

// @ts-expect-error Milkdown MarkSchema compat
const highlightMark = $mark('highlight', () => ({
  attrs: { color: {} },
  parseDOM: [{
    style: 'background-color',
    getAttrs: (v: string) => v ? { color: v } : null,
  }],
  toDOM: (mark: any) => ['span', { style: `background-color:${mark.attrs.color || '#fecaca'}` }, 0],
}));

// ─── Parse highlight.js HTML → token positions ───
const _hlDiv = typeof document !== 'undefined' ? document.createElement('div') : null;
function parseTokens(html: string): Array<{ from: number; to: number; cls: string }> {
  const tokens: Array<{ from: number; to: number; cls: string }> = [];
  if (!_hlDiv) return tokens;
  _hlDiv.innerHTML = html;
  let p = 0;
  (function walk(n: ChildNode, c: string) {
    if (n.nodeType === 3) { const l = (n.textContent || '').length; if (c && l) tokens.push({ from: p, to: p + l, cls: c }); p += l; }
    else if (n.nodeType === 1) { const el = n as HTMLElement; const nc = el.className && el.className !== 'hljs' ? el.className : c; for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i], nc); }
  })(_hlDiv, '');
  return tokens;
}

// ─── Build highlight decorations for code blocks ───
function buildHLDecos(doc: any): DecorationSet {
  const decos: any[] = [];
  try {
    doc.descendants((node: any, pos: number) => {
      if (node.type.name !== 'code_block') return;
      const code = node.textContent || '';
      if (!code) return;
      const lang = node.attrs?.language || '';
      let html: string;
      try {
        html = (lang && hljs.getLanguage(lang))
          ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(code).value;
      } catch { return; }
      const tokens = parseTokens(html);
      const start = pos + 1;
      const maxPos = pos + node.nodeSize - 1;
      for (const t of tokens) {
        const fromPos = start + t.from;
        const toPos = start + t.to;
        if (t.from < t.to && fromPos >= start && toPos <= maxPos) {
          decos.push(Decoration.inline(fromPos, toPos, { class: t.cls }));
        }
      }
    });
  } catch {}
  return DecorationSet.create(doc, decos);
}

interface Props {
  value: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  height?: string;
}

interface Tool {
  label: string;
  title: string;
  cmd?: any;
  cmdArg?: any;
  blockCmd?: any;
  blockCmdArg?: any;
  insert?: string;
  insertAfter?: string;
}

function getTools(lang: string): Tool[] {
  return [
    { label: 'B', title: t('md.bold', lang), cmd: toggleStrongCommand },
    { label: 'I', title: t('md.italic', lang), cmd: toggleEmphasisCommand },
    { label: 'S', title: t('md.strikethrough', lang), cmd: toggleStrikethroughCommand },
    { label: '`', title: t('md.inlineCode', lang), cmd: toggleInlineCodeCommand },
    { label: 'H1', title: t('md.heading1', lang), blockCmd: wrapInHeadingCommand, blockCmdArg: 1 },
    { label: 'H2', title: t('md.heading2', lang), blockCmd: wrapInHeadingCommand, blockCmdArg: 2 },
    { label: 'H3', title: t('md.heading3', lang), blockCmd: wrapInHeadingCommand, blockCmdArg: 3 },
    { label: '•', title: t('md.bulletList', lang), blockCmd: wrapInBulletListCommand },
    { label: '1.', title: t('md.numberedList', lang), blockCmd: wrapInOrderedListCommand },
    { label: '"', title: t('md.blockquote', lang), blockCmd: wrapInBlockquoteCommand },
    { label: '</>', title: t('md.codeBlock', lang), blockCmd: createCodeBlockCommand },
    { label: '🔗', title: t('md.link', lang) },
    { label: '📷', title: t('md.image', lang) },
    { label: 'A', title: t('md.textColor', lang) },
    { label: '█', title: t('md.highlight', lang) },
    { label: '⊞', title: t('md.insertTable', lang), blockCmd: insertTableCommand },
    { label: '―', title: t('md.horizontalRule', lang), blockCmd: insertHrCommand },
    { label: '☑', title: t('md.taskList', lang), insert: '\n- [ ] ' },
  ];
}

function getTableTools(lang: string): Tool[] {
  return [
    { label: '+↥', title: t('md.addRowAbove', lang) },
    { label: '+↧', title: t('md.addRowBelow', lang) },
    { label: '+⇤', title: t('md.addColLeft', lang) },
    { label: '+⇥', title: t('md.addColRight', lang) },
    { label: '⌫R', title: t('md.deleteRow', lang) },
    { label: '⌫C', title: t('md.deleteCol', lang) },
    { label: '⛶', title: t('md.deleteTable', lang) },
    { label: '⟵', title: t('md.alignLeft', lang), blockCmd: setAlignCommand, blockCmdArg: 'left' },
    { label: '⟺', title: t('md.alignCenter', lang), blockCmd: setAlignCommand, blockCmdArg: 'center' },
    { label: '⟶', title: t('md.alignRight', lang), blockCmd: setAlignCommand, blockCmdArg: 'right' },
  ];
}

const TEXT_COLORS: { hex: string; label: string }[] = [
  { hex: '#ef4444', label: 'Red' }, { hex: '#f97316', label: 'Orange' },
  { hex: '#eab308', label: 'Yellow' }, { hex: '#22c55e', label: 'Green' },
  { hex: '#3b82f6', label: 'Blue' }, { hex: '#a855f7', label: 'Purple' },
  { hex: '#ec4899', label: 'Pink' }, { hex: '#6b7280', label: 'Gray' },
  { hex: '#ffffff', label: 'White' }, { hex: '#1e293b', label: 'Black' },
];
const HIGHLIGHT_COLORS: { hex: string; label: string }[] = [
  { hex: '#fecaca', label: 'Red' }, { hex: '#fed7aa', label: 'Orange' },
  { hex: '#fef08a', label: 'Yellow' }, { hex: '#bbf7d0', label: 'Green' },
  { hex: '#bfdbfe', label: 'Blue' }, { hex: '#e9d5ff', label: 'Purple' },
  { hex: '#fbcfe8', label: 'Pink' }, { hex: '#e2e8f0', label: 'Gray' },
  { hex: '#ffffff', label: 'White' }, { hex: '#e2e8f0', label: 'Slate' },
];

function insertBlock(editor: any, before: string, after: string) {
  editor.action((ctx: any) => {
    const view = ctx.get(editorViewCtx);
    if (!view) return;
    const { state } = view;
    const { from, to } = state.selection;
    const sel = state.doc.textBetween(from, to);
    const tr = state.tr.insertText(before + sel + after, from, to);
    const newPos = from + before.length + sel.length + after.length;
    tr.setSelection(TextSelection.create(tr.doc, newPos));
    view.dispatch(tr);
    view.focus();
  });
}

function toggleMark(editor: any, cmd: any, arg?: any) {
  editor.action((ctx: any) => {
    if (arg !== undefined) {
      callCommand(cmd.key, arg)(ctx);
    } else {
      callCommand(cmd.key)(ctx);
    }
  });
}

function colorGetMarkdown(editor: any): string {
  return editor.action((ctx: any) => {
    const view = ctx.get(editorViewCtx);
    if (!view) return '';
    const doc = view.state.doc;
    const result: string[] = [];
    doc.forEach((block: any) => {
      const blockText = serializeBlock(block);
      if (blockText) result.push(blockText);
    });
    return result.join('\n\n');
  });
}

function serializeBlock(node: any): string {
  if (!node) return '';
  const type = node.type.name;

  if (type === 'hr' || type === 'horizontal_rule') return '---';
  if (type === 'code_block') {
    const lang = node.attrs?.language || '';
    return '```' + lang + '\n' + (node.textContent || '') + '\n```';
  }
  if (type === 'bullet_list' || type === 'ordered_list') return serializeList(node);
  if (type === 'blockquote') {
    const lines: string[] = [];
    node.forEach((child: any) => {
      const s = serializeBlock(child);
      if (s) s.split('\n').forEach(line => lines.push(line ? '> ' + line : '>'));
    });
    return lines.join('\n');
  }
  if (type === 'table') return serializeTable(node);

  if (node.isTextblock) {
    let prefix = '';
    if (type === 'heading') prefix = '#'.repeat(node.attrs.level || 1) + ' ';
    const line: string[] = [];
    node.forEach((child: any) => {
      if (child.isText) line.push(serializeInline(child));
      else if (child.type.name === 'image') line.push(`![${child.attrs.alt || ''}](${child.attrs.src || ''})`);
      else if (child.type.name === 'hard_break') line.push('\n');
      else if (child.isInline) line.push(child.textContent || '');
    });
    const text = prefix + line.join('');
    return text;
  }

  const fallback: string[] = [];
  node.forEach((child: any) => {
    const s = serializeBlock(child);
    if (s) fallback.push(s);
  });
  return fallback.join('\n');
}

function serializeList(node: any): string {
  const items: string[] = [];
  const ordered = node.type.name === 'ordered_list';
  let idx = node.attrs?.start || 1;

  node.forEach((item: any) => {
    const lines: string[] = [];
    item.forEach((child: any) => {
      const serialized = serializeBlock(child);
      if (serialized) lines.push(serialized);
    });
    const prefix = ordered ? `${idx++}. ` : '- ';
    const itemText = lines.join('\n').split('\n').map((line, i) => {
      return i === 0 ? prefix + line : '  ' + line;
    }).join('\n');
    items.push(itemText);
  });
  return items.join('\n');
}

function serializeTable(node: any): string {
  const rows: string[] = [];
  let headerAlignments: string[] = [];

  node.forEach((row: any, _offset: number, rowIndex: number) => {
    const cells: string[] = [];
    row.forEach((cell: any) => {
      let text = '';
      cell.forEach((child: any) => {
        if (child.isText) { text += serializeInline(child); }
        else if (child.isTextblock) {
          child.forEach((inline: any) => {
            if (inline.isText) text += serializeInline(inline);
            else text += inline.textContent || '';
          });
        } else { text += child.textContent || ''; }
      });

      let formattedText = text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
      cells.push(formattedText);

      // Capture header cell alignment for column separator
      if (rowIndex === 0) {
        const align = cell.attrs?.alignment || cell.attrs?.align || 'left';
        headerAlignments.push(align);
      }
    });

    rows.push('| ' + cells.join(' | ') + ' |');

    if (rowIndex === 0) {
      const sep = headerAlignments.map(a => {
        if (a === 'center') return ':---:';
        if (a === 'right') return '---:';
        return ':---'; // left or default
      }).join('|');
      rows.push('| ' + sep + ' |');
    }
  });
  return rows.join('\n');
}

function serializeInline(node: any): string {
  let text = node.text || '';
  const marks = node.marks || [];

  let styleStr = '';
  let isStrong = false, isEm = false, isCode = false, isStrike = false, linkHref = '';

  for (const mark of marks) {
    if (mark.type.name === 'textColor') {
      styleStr += `color:${mark.attrs.color};`;
    } else if (mark.type.name === 'highlight') {
      styleStr += `background-color:${mark.attrs.color};`;
    } else if (mark.type.name === 'strong') isStrong = true;
    else if (mark.type.name === 'em') isEm = true;
    else if (mark.type.name === 'code') isCode = true;
    else if (mark.type.name === 'strikethrough') isStrike = true;
    else if (mark.type.name === 'link') linkHref = mark.attrs?.href || '';
  }

  if (styleStr) {
    text = `<span style="${styleStr}">${text}</span>`;
  }

  if (isCode) text = '`' + text + '`';
  if (isStrike) text = `~~${text}~~`;
  if (isEm) text = `*${text}*`;
  if (isStrong) text = `**${text}**`;
  if (linkHref) text = `[${text}](${linkHref})`;

  return text;
}

function execBlockCmd(ed: any, cmd: any, arg?: any) {
  if (arg !== undefined) {
    cmd.run(arg);
  } else {
    cmd.run();
  }
}

/**
 * Core: elegantly solve Cell node alignment and rendering binding via NodeView
 */
class CellNodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  node: any;

  constructor(node: any, isHeader: boolean) {
    this.node = node;
    this.dom = document.createElement(isHeader ? 'th' : 'td');
    this.contentDOM = this.dom; // mount content
    this.updateStyle(node);
  }

  updateStyle(node: any) {
    const align = node.attrs?.alignment || node.attrs?.align || 'left';
    this.dom.style.setProperty('text-align', align, 'important');
    this.dom.setAttribute('align', align);
  }

  update(node: any) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.updateStyle(node);
    return true; // tell ProseMirror the node can update in place on existing DOM, no destroy+redraw needed
  }
}

function MilkdownInner({ value, onChange, readOnly }: Props) {
  const lang = useLang();
  useEditor((root: HTMLElement) => {
    root.style.height = '100%';
    root.style.outline = 'none';
    const ed = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, value || '');
        ctx.set(rootAttrsCtx, { spellcheck: 'false', translate: 'no', class: 'milkdown-editor' });
        ctx.set(editorViewOptionsCtx, {
          editable: () => !readOnly,
          handleDOMEvents: {
            keydown: (_view: any, event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'Backspace' || event.key === 'Delete') {
                const st = _view.state;
                if (isInTable(st)) { }
              }
              return false;
            },
            paste: (view: any, event: Event) => {
              // VS Code / Claude Code terminal copy: clipboard has vscode-editor-data.
              // Milkdown inserts raw text into code_block, bypassing HTML parsing.
              // The plain text contains <span style="..."> tags from terminal ANSI→HTML.
              // Strip those tags before insertion so they don't become literal text.
              const ce = event as ClipboardEvent;
              if (ce.clipboardData?.types?.includes('vscode-editor-data')) {
                event.preventDefault();
                const plain = (ce.clipboardData.getData('text/plain') || '')
                  .replace(/<span\b[^>]*>/gi, '').replace(/<\/span>/gi, '')
                  .replace(/<div\b[^>]*>/gi, '').replace(/<\/div>/gi, '')
                  .replace(/<p\b[^>]*>/gi, '\n').replace(/<\/p>/gi, '');
                view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(plain)));
                return true;
              }
              // Normal HTML paste: let ProseMirror handle it; transformPastedHTML strips styles
              return false;
            },
            transformPastedHTML: (html: string) => {
              // Strip inline style attrs from pasted HTML (web pages, rich editors, etc.)
              // Prevents <span style="color:..."> from being captured by textColor/highlight
              // marks and serialized back as raw HTML tags in markdown output.
              return html.replace(/\sstyle\s*=\s*"[^"]*"/gi, '').replace(/\sstyle\s*=\s*'[^']*'/gi, '');
            },
          },
        });
      })
      .use(commonmark)
      .use($prose(() => proseKeymap({
        'Enter': (state: any, dispatch: any) => {
          if (!isInTable(state)) return false;
          if (dispatch) dispatch(state.tr.insertText('\n', state.selection.from));
          return true;
        },
      })))
      .use(gfm)
      .use(columnResizingPlugin)
      // Use NodeView to fully own Cell view updates
      .use($prose(() => {
        return new Plugin({
          props: {
            nodeViews: {
              table_cell: (node) => new CellNodeView(node, false),
              table_header: (node) => new CellNodeView(node, true),
            },
          },
        });
      }))
      .use($prose(() => new Plugin({
        view(editorView: any) {
          let _startY = 0, _startHeights: number[] = [], _cells: HTMLElement[] = [];
          const onMove = (e: MouseEvent) => {
            const cell = (e.target as HTMLElement).closest('td,th') as HTMLElement | null;
            if (!cell) { editorView.dom.style.cursor = ''; return; }
            const r = cell.getBoundingClientRect();
            if (e.clientY > r.bottom - 6) { editorView.dom.style.cursor = 'row-resize'; return; }
            if (editorView.dom.style.cursor === 'row-resize') editorView.dom.style.cursor = '';
          };
          const onDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const cell = (e.target as HTMLElement).closest('td,th') as HTMLElement | null;
            if (!cell) return;
            const r = cell.getBoundingClientRect();
            if (e.clientY > r.bottom - 6) {
              e.preventDefault(); e.stopPropagation();
              const row = cell.closest('tr') as HTMLElement;
              _cells = Array.from(row.querySelectorAll('td,th'));
              _startHeights = _cells.map(c => c.getBoundingClientRect().height);
              _startY = e.clientY;
              editorView.setProps({ editable: () => false });
              const onUp = () => {
                document.removeEventListener('mousemove', onDrag);
                document.removeEventListener('mouseup', onUp);
                editorView.setProps({ editable: () => true });
              };
              const onDrag = (ev: MouseEvent) => {
                const delta = ev.clientY - _startY;
                _cells.forEach((c, i) => c.style.setProperty('height', Math.max(20, _startHeights[i] + delta) + 'px', 'important'));
              };
              document.addEventListener('mousemove', onDrag);
              document.addEventListener('mouseup', onUp);
            }
          };
          editorView.dom.addEventListener('mousemove', onMove);
          editorView.dom.addEventListener('mousedown', onDown, true);
          return { destroy() { editorView.dom.removeEventListener('mousemove', onMove); editorView.dom.removeEventListener('mousedown', onDown, true); } };
        },
      })))
      .use(textColorMark)
      .use(highlightMark)
      .use(history)
      .use($prose(() => new Plugin({
        key: new PluginKey('tableActiveTracker'),
        view() {
          return { update(v: any) { setTableActive(isInTable(v.state)); } };
        },
      })))
      .use($prose(() => new Plugin({
        key: HL_KEY,
        state: {
          init() { return DecorationSet.empty; },
          apply(tr, old) {
            const meta = tr.getMeta(HL_KEY);
            if (meta?.decos) return meta.decos;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations(s: any) { return this.getState(s); } },
      })))
      .use($prose(() => proseKeymap({
        'Shift-Enter': (state: any, dispatch: any) => {
          const { $from } = state.selection;
          if ($from.parent.type.name === 'code_block') {
            if (dispatch) dispatch(state.tr.insertText('\n', $from.pos).scrollIntoView());
            return true;
          }
          return false;
        },
      })));
    return ed;
  }, []);

  const [loading, getInstance] = useInstance();
  const editor = getInstance();

  useEffect(() => {
    if (!editor || loading) return;
    editor.action((ctx: any) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;
      const s = view.state.schema;
      const roleMap: Record<string, string> = {
        table: 'table', table_row: 'row', table_header_row: 'row',
        table_cell: 'cell', table_header: 'header_cell',
      };
      Object.entries(roleMap).forEach(([name, role]) => {
        if (s.nodes[name]) (s.nodes[name].spec as any).tableRole = role;
      });
    });
  }, [editor, loading]);

  const lastMdRef = useRef(value);
  const lastExternalValueRef = useRef(value);
  const [promptState, setPromptState] = useState<{ type: 'link' | 'image'; label: string } | null>(null);
  const [colorPicker, setColorPicker] = useState<{ type: 'text' | 'bg'; label: string } | null>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const savedSelRef = useRef<{ from: number; to: number } | null>(null);
  const [tableActive, setTableActive] = useState(false);

  useEffect(() => {
    if (editor && !loading) {
      try {
        editor.action((ctx: any) => {
          const view = ctx.get(editorViewCtx);
          if (view) view.setProps({ editable: () => !readOnly });
        });
      } catch (e) { console.error('[MarkdownEditor] setProps editable failed:', e); }
    }
  }, [readOnly, editor, loading]);

  useEffect(() => {
    if (!editor || loading) return;
    const refresh = () => {
      editor.action((ctx: any) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;
        const decos = buildHLDecos(view.state.doc);
        view.dispatch(view.state.tr.setMeta(HL_KEY, { decos }));
      });
    };
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [editor, loading]);

  useEffect(() => {
    if (!editor || loading || !onChange) return;
    const iv = setInterval(() => {
      if (readOnly) return;
      try {
        const md = colorGetMarkdown(editor) || '';
        if (md !== lastMdRef.current) {
          lastMdRef.current = md;
          onChange(md);
        }
      } catch (e) { console.error('[MarkdownEditor] polling failed:', e); }
    }, 300);
    return () => clearInterval(iv);
  }, [editor, loading, onChange, readOnly]);

  useEffect(() => {
    if (editor && !loading && value !== undefined) {
      if (value === lastMdRef.current) return;
      if (value === lastExternalValueRef.current) return;
      try {
        const cur = colorGetMarkdown(editor) || '';
        if (cur !== value) {
          let focused = false;
          editor.action((ctx: any) => {
            const view = ctx.get(editorViewCtx);
            if (view?.hasFocus()) focused = true;
          });
          if (focused) return;
          lastExternalValueRef.current = value;
          lastMdRef.current = value;
          editor.action(replaceAll(value || ''));
        }
      } catch (e) { console.error('[MarkdownEditor] replaceAll failed:', e); }
    }
  }, [value, editor, loading]);

  const applyColor = (color: string, type: 'text' | 'bg') => {
    if (!editor) return;
    editor.action((ctx: any) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;
      const { state } = view;
      const { from, to } = state.selection;
      const markType = type === 'text' ? state.schema.marks.textColor : state.schema.marks.highlight;
      if (from !== to) {
        const mark = markType.create({ color });
        view.dispatch(state.tr.addMark(from, to, mark));
      }
      view.focus();
    });
    setColorPicker(null);
    const md = colorGetMarkdown(editor) || '';
    lastMdRef.current = md;
    onChange?.(md);
  };

  const submitPrompt = (url: string) => {
    if (!promptState || !editor) return;

    editor.action((ctx: any) => {
      const view = ctx.get(editorViewCtx);
      if (!view) return;

      const s = savedSelRef.current;
      if (s && s.from !== s.to) {
        const $from = view.state.doc.resolve(s.from);
        const $to = view.state.doc.resolve(s.to);
        view.dispatch(view.state.tr.setSelection(new TextSelection($from, $to)));
      }
      savedSelRef.current = null;

      if (promptState.type === 'link') {
        callCommand(toggleLinkCommand.key, { href: url })(ctx);
      } else {
        let selText = '';
        try {
          const from = s ? s.from : view.state.selection.from;
          const to = s ? s.to : view.state.selection.to;
          if (from !== to) selText = view.state.doc.textBetween(from, to);
        } catch { selText = ''; }
        callCommand(insertImageCommand.key, { src: url, alt: selText })(ctx);
      }

      view.focus();
    });

    const md = colorGetMarkdown(editor) || '';
    lastMdRef.current = md;
    onChange?.(md);
    setPromptState(null);
  };

  /**
   * Single-cell alignment: change Node attrs via Transaction only, let NodeView handle rendering
   */
  function execTableCmd(ed: any, t: Tool) {
    ed.action((ctx: any) => {
      const view = ctx.get(editorViewCtx);
      if (!view || !isInTable(view.state)) return;
      const { state } = view;
      const sel = state.selection;
      const $head = sel.$head;

      let tablePos = -1;
      let tableNode: any = null;
      for (let d = $head.depth; d >= 0; d--) {
        if ($head.node(d).type.name === 'table') {
          tablePos = $head.start(d);
          tableNode = $head.node(d);
          break;
        }
      }

      // ── Add ──
      if (t.label === '+↥') {
        const isHeaderRow = $head.node($head.depth - 2)?.type?.name === 'table_header_row';
        if (!isHeaderRow) callCommand('AddRowBefore')(ctx);
      } else if (t.label === '+↧') { callCommand('AddRowAfter')(ctx); }
      else if (t.label === '+⇤') { callCommand('AddColBefore')(ctx); }
      else if (t.label === '+⇥') { callCommand('AddColAfter')(ctx); }
      // ── Delete row ──
      else if (t.label === '⌫R') {
        const dom = view.domAtPos($head.pos);
        const trEl = (dom.node as HTMLElement).closest?.('tr') as HTMLElement | null;
        if (!trEl || tablePos < 0 || tableNode.childCount <= 1) return;
        if (tableNode.childCount <= 2) {
          callCommand(selectTableCommand.key)(ctx);
          callCommand(deleteSelectedCellsCommand.key)(ctx);
          return;
        }
        const rowIdx = Array.from(trEl.parentElement!.children).indexOf(trEl);
        callCommand(selectRowCommand.key, { pos: tablePos, index: rowIdx })(ctx);
        callCommand(deleteSelectedCellsCommand.key)(ctx);
      }
      // ── Delete column ──
      else if (t.label === '⌫C') {
        const dom = view.domAtPos($head.pos);
        const cell = (dom.node as HTMLElement).closest?.('th,td') as HTMLElement | null;
        if (!cell || tablePos < 0 || tableNode.child(0).childCount <= 1) return;
        const colIdx = Array.from(cell.parentElement!.children).indexOf(cell);
        callCommand(selectColCommand.key, { pos: tablePos, index: colIdx })(ctx);
        callCommand(deleteSelectedCellsCommand.key)(ctx);
      }
      // ── Align: clean Node attrs update strategy ──
      else if (t.label === '⟵' || t.label === '⟺' || t.label === '⟶') {
        const align = t.label === '⟵' ? 'left' : t.label === '⟺' ? 'center' : 'right';

        let cellDepth = -1;
        for (let d = $head.depth; d >= 0; d--) {
          const typeName = $head.node(d).type.name;
          if (typeName === 'table_cell' || typeName === 'table_header') {
            cellDepth = d;
            break;
          }
        }

        if (cellDepth >= 0) {
          const cellPos = $head.before(cellDepth);
          const cellNode = $head.node(cellDepth);
          let tr = state.tr;

          // Must update header + target in same tx (table_cell setNodeMarkup requires table_header present)
          const colIdx = $head.index(cellDepth - 1);
          let hdrPos = tablePos + 1;
          const hdrRow = tableNode.child(0);
          for (let c = 0; c < colIdx; c++) hdrPos += hdrRow.child(c).nodeSize;
          tr.setNodeMarkup(hdrPos, null, { ...hdrRow.child(colIdx).attrs, alignment: align, align });
          tr.setNodeMarkup(cellPos, null, { ...cellNode.attrs, alignment: align, align });
          view.dispatch(tr);
        }
      }
      // ── Delete table ──
      else if (t.label === '⛶') {
        callCommand(selectTableCommand.key)(ctx);
        callCommand(deleteSelectedCellsCommand.key)(ctx);
      }

      view.focus();
    });
    syncMd(ed);
  }

  function syncMd(ed: any) {
    const md = colorGetMarkdown(ed) || '';
    lastMdRef.current = md;
    onChange?.(md);
  }

  const handleTool = (t: Tool) => {
    if (!editor || loading) return;
    try {
      if (t.label === '📷' || t.label === '🔗') {
        editor.action((ctx: any) => {
          const v = ctx.get(editorViewCtx);
          if (v) savedSelRef.current = { from: v.state.selection.from, to: v.state.selection.to };
        });
        if (t.label === '📷') {
          setPromptState({ type: 'image', label: '📷 Image URL:' });
        } else {
          setPromptState({ type: 'link', label: '🔗 Link URL:' });
        }
        return;
      } else if (t.label === 'A') {
        setColorPicker({ type: 'text', label: 'Text Color' });
        return;
      } else if (t.label === '█') {
        setColorPicker({ type: 'bg', label: 'Highlight' });
        return;
      } else if (t.label === '+↥' || t.label === '+↧' || t.label === '+⇤' || t.label === '+⇥' || t.label === '⌫R' || t.label === '⌫C' || t.label === '⛶' || t.label === '⟵' || t.label === '⟺' || t.label === '⟶') {
        execTableCmd(editor, t);
        return;
      } else if (t.cmd) {
        toggleMark(editor, t.cmd, t.cmdArg);
      } else if (t.blockCmd) {
        execBlockCmd(editor, t.blockCmd, t.blockCmdArg);
      } else {
        insertBlock(editor, t.insert || '', t.insertAfter || '');
      }
      const md = colorGetMarkdown(editor) || '';
      lastMdRef.current = md;
      onChange?.(md);
    } catch (e: any) { console.error('[handleTool]', t.label, e?.message || e); }
  };

  const pickLocalFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => submitPrompt(reader.result as string);
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const tools = getTools(lang || 'en');
  const tableTools = getTableTools(lang || 'en');

  return (
    <>
      {!readOnly && (
        <>
          <div className="md-tbar" key={`main-${lang || 'en'}`}>
            {tools.map((t, i) => (
              <span key={t.label} style={{ display: 'contents' }}>
                {(i === 4 || i === 7 || i === 11 || i === 13 || i === 15) && <span className="md-sep" />}
                <button onMouseDown={e => { e.preventDefault(); handleTool(t); }} title={t.title}
                  style={t.label === 'A' ? { color: '#ef4444', fontWeight: 700 } : t.label === '█' ? { color: '#f59e0b', fontWeight: 700 } : undefined}
                >{t.label}</button>
              </span>
            ))}
          </div>
          <div style={{ padding: '2px 8px', fontSize: 9, color: 'var(--muted)', borderBottom: '1px solid var(--edge)', textAlign: 'center' }}>
            <span>{lang === 'zh' ? 'Ctrl+Enter 退出代码块' : lang === 'ja' ? 'Ctrl+Enter でコードブロックを抜ける' : 'Ctrl+Enter to exit code block'}</span>
          </div>
          {tableActive && (
            <div className="md-tbar" style={{ borderTop: '1px solid var(--edge)', padding: '2px 8px' }} key={`table-${lang || 'en'}`}>
              <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 6, fontWeight: 600 }}>TABLE</span>
              {tableTools.map((t, i) => (
                <span key={t.label} style={{ display: 'contents' }}>
                  {(i === 4 || i === 7) && <span className="md-sep" />}
                  <button onMouseDown={e => { e.preventDefault(); handleTool(t); }} title={t.title}>{t.label}</button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {promptState && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 16, border: '1px solid var(--edge)', minWidth: 360, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{promptState.label}</div>
            <input ref={promptInputRef} className="form-input" style={{ fontSize: 12, marginBottom: 10 }} placeholder="https://" onKeyDown={e => { if (e.key === 'Enter') submitPrompt((e.target as HTMLInputElement).value); if (e.key === 'Escape') setPromptState(null); }} autoFocus />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {promptState.type === 'image' && <button className="btn btn-sm" style={{ background: 'var(--surface2)' }} onClick={pickLocalFile}>📁 Local file</button>}
              <button className="btn btn-sm" style={{ background: 'var(--surface2)' }} onClick={() => setPromptState(null)}>Cancel</button>
              <button className="btn btn-brand btn-sm" onClick={() => { if (promptInputRef.current) submitPrompt(promptInputRef.current.value); }}>OK</button>
            </div>
          </div>
        </div>
      )}
      {colorPicker && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }} onClick={() => setColorPicker(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 14, border: '1px solid var(--edge)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--ink)' }}>{colorPicker.label}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(colorPicker.type === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS).map(c => (
                <button key={c.hex} title={c.label} onClick={() => applyColor(c.hex, colorPicker.type)}
                  style={{ width: 22, height: 22, borderRadius: 4, background: c.hex, border: c.hex === '#ffffff' ? '1px solid var(--edge)' : '1px solid transparent', cursor: 'pointer', flexShrink: 0 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}>
              <button className="btn btn-sm" style={{ background: 'var(--surface2)', fontSize: 11 }} onClick={() => { setColorPicker(null); }}>Cancel</button>
              <button className="btn btn-sm" style={{ background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)' }}
                onClick={() => {
                  if (!editor) return;
                  editor.action((ctx: any) => {
                    const view = ctx.get(editorViewCtx);
                    if (!view) return;
                    const { state } = view;
                    const { from, to } = state.selection;
                    if (from !== to) {
                      const markType = colorPicker.type === 'text'
                        ? state.schema.marks.textColor
                        : state.schema.marks.highlight;
                      view.dispatch(state.tr.removeMark(from, to, markType));
                    }
                    view.focus();
                  });
                  setColorPicker(null);
                  const md = colorGetMarkdown(editor) || '';
                  lastMdRef.current = md;
                  onChange?.(md);
                }}>Reset</button>
            </div>
          </div>
        </div>
      )}
      <Milkdown />
    </>
  );
}

export function MarkdownEditor({ value, onChange, readOnly, height }: Props) {
  return (
    <>
      <style>{`
        .md-tbar { display: flex; gap: 1px; padding: 3px 8px; border-bottom: 1px solid var(--edge); background: var(--surface); flex-shrink: 0; position: relative; z-index: 1; flex-wrap: wrap; overflow: visible; }
        .md-tbar button { background: none; border: none; cursor: pointer; padding: 3px 8px; border-radius: 4px; font-size: 11px; color: var(--muted); transition: all .1s; white-space: nowrap; }
        .md-tbar button:hover { background: var(--surface2); color: var(--ink); }
        .md-tbar .md-sep { width: 1px; background: var(--edge); margin: 2px 4px; align-self: stretch; }
        .milkdown-editor { padding: 14px 16px; font-size: 13px; line-height: 1.8; }
        .milkdown-editor h1 { font-size: 20px; font-weight: 700; margin: 16px 0 8px; }
        .milkdown-editor h2 { font-size: 15px; font-weight: 700; margin: 20px 0 10px; padding: 8px 12px; background: linear-gradient(135deg, var(--surface2), transparent); border-left: 4px solid var(--brand); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
        .milkdown-editor h3 { font-size: 15px; font-weight: 600; margin: 12px 0 4px; }
        .milkdown-editor p { margin: 0 0 8px; }
        .milkdown-editor ul,.milkdown-editor ol { padding-left: 20px; margin: 0 0 4px; }
        .milkdown-editor ul { list-style-type: disc; }
        .milkdown-editor ol { list-style-type: decimal; }
        .milkdown-editor li { padding: 1px 0; }
        .milkdown-editor code { background: var(--surface2); padding: 1px 5px; border-radius: 3px; font-size: 12px; font-family: monospace; }
        .milkdown-editor pre { background: #0d1117; color: #c9d1d9; padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.6; font-family: 'Consolas','Monaco','Courier New',monospace; }
        .milkdown-editor pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
        .milkdown-editor blockquote { margin: 12px 0; padding: 14px 18px; background: linear-gradient(135deg, var(--brand-soft), rgba(99,102,241,0.02)); border-radius: var(--radius-md); box-shadow: var(--shadow-xs); color: var(--ink); }
        .milkdown-editor blockquote p { margin: 0; }
        .milkdown-editor table { border-collapse: collapse; width: 100% !important; min-width: 300px !important; margin: 10px 0; border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--shadow-xs); table-layout: fixed; }
        .milkdown-editor .tableWrapper { overflow-x: auto; border-radius: var(--radius-md); }
        .milkdown-editor th { background: linear-gradient(135deg, var(--brand), var(--brand-hover)); color: #fff; padding: 8px 12px; font-size: 12px; font-weight: 600; border: 1px solid var(--brand-hover); }
        .milkdown-editor td { padding: 7px 12px; border: 1px solid var(--edge); font-size: 13px; }
        .milkdown-editor hr { height: 2px; border: none; margin: 16px 0; background: linear-gradient(90deg, var(--brand), transparent); }
        
        .resize-cursor { cursor: col-resize !important; }
        .column-resize-handle { position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; z-index: 20; background: transparent; cursor: col-resize; }
        .column-resize-handle:hover { background: var(--brand); opacity: 0.4; }
        .milkdown-editor a { color: var(--brand); text-decoration: underline; }
        [data-milkdown-root] { flex: 1; min-height: 0; overflow-y: auto; display: block !important; }
        .ProseMirror { outline: none !important; min-height: 200px; }
        .ProseMirror img { max-width: 100%; max-height: 400px; min-width: 40px; min-height: 20px; display: inline-block; vertical-align: middle; }
        .ProseMirror img.ProseMirror-selectednode { outline: 2px solid var(--brand); }
        .ProseMirror-focused { outline: none !important; }
        .milkdown-editor tr:hover td { background: var(--surface2); }
      `}</style>
      <div style={{ border: '1px solid var(--edge)', borderRadius: 8, height: height || '400px', minHeight: '250px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <MilkdownProvider>
          <MilkdownInner value={value} onChange={onChange} readOnly={readOnly} />
        </MilkdownProvider>
      </div>
    </>
  );
}