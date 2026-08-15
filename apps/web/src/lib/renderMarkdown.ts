/* Minimal Markdown → HTML renderer. No dependencies, no ESM issues. */
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

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', xml);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('ps1', powershell);
hljs.registerLanguage('toml', ini);
hljs.registerLanguage('ini', ini);

export function renderMarkdown(md: string): string {
  if (!md) return '';

  let h = md
    // Unescape Markdown backslash escapes
    .replace(/\\([*_~`#+\-.!|{}\[\]()\\])/g, '$1')
    // Only escape & that is NOT already part of a valid HTML entity
    // (preserves &#x20;, &nbsp;, &amp;, &lt;, &#160;, etc. from Milkdown serialization)
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // ── Phase 0: Extract code blocks to protect newlines inside ──
  const codeBlocks: string[] = [];
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    let highlighted = code;
    try { highlighted = lang ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value; } catch { /* fallback to raw code */ }
    codeBlocks.push(`<pre><code class="hljs language-${lang || 'auto'}">${highlighted}</code></pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // ── Phase 1: Inline formatting (runs on full string before line split) ──
  h = h
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');

  // ── Phase 2: Block elements — line-by-line with list grouping ──
  const lines = h.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block placeholder — pass through
    if (line.startsWith('\x00CB')) { out.push(line); i++; continue; }

    // ═══ Headings ═══
    let m = line.match(/^(#{1,6}) (.+)$/);
    if (m) { out.push(`<h${m[1].length}>${m[2]}</h${m[1].length}>`); i++; continue; }

    // ═══ Horizontal rule ═══
    if (/^[-*_]{3,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // ═══ Blockquote ═══
    m = line.match(/^&gt; (.+)$/);
    if (m) { out.push(`<blockquote>${m[1]}</blockquote>`); i++; continue; }

    // ═══ Task list (consecutive items → <ul class="task-list">) ═══
    m = line.match(/^- \[(x| )\] (.+)$/i);
    if (m) {
      const items: string[] = [];
      while (i < lines.length) {
        const tm = lines[i].match(/^- \[(x| )\] (.+)$/i);
        if (!tm) break;
        const checked = tm[1].toLowerCase() === 'x' ? ' checked' : '';
        items.push(`<li><input type="checkbox"${checked} disabled> ${tm[2]}</li>`);
        i++;
      }
      out.push('<ul class="task-list">' + items.join('') + '</ul>');
      continue;
    }

    // ═══ Ordered list (consecutive items → <ol>) ═══
    m = line.match(/^\d+\. (.+)$/);
    if (m) {
      const items: string[] = [];
      while (i < lines.length) {
        const om = lines[i].match(/^\d+\. (.+)$/);
        if (!om) break;
        items.push('<li>' + om[1] + '</li>');
        i++;
      }
      out.push('<ol>' + items.join('') + '</ol>');
      continue;
    }

    // ═══ Unordered list (consecutive items → <ul>) ═══
    m = line.match(/^[\-\*] (.+)$/);
    if (m) {
      const items: string[] = [];
      while (i < lines.length) {
        const um = lines[i].match(/^[\-\*] (.+)$/);
        if (!um) break;
        items.push('<li>' + um[1] + '</li>');
        i++;
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }

    // ═══ Table rows (pipe-delimited) — detect BEFORE paragraphs ═══
    // Milkdown serializes GFM tables with leading/trailing pipes:
    // | Header 1 | Header 2 |
    // | :--- | :---: | ---: |
    // | Data 1 | Data 2 |
    const isTableRow = line.includes('|') && /^\|.+\|$/.test(line.trim());
    if (isTableRow) {
      const tableRows: string[] = [];
      let sepIdx = -1;
      while (i < lines.length && lines[i].includes('|') && /^\|.+\|$/.test(lines[i].trim())) {
        const rowText = lines[i].trim();
        // Detect GFM separator row (e.g. |:---|:---:| or | :---|:---:|:--- |)
        // Strip all pipes, then check only alignment chars remain
        const withoutPipes = rowText.replace(/\|/g, '').trim();
        if (withoutPipes.length > 0 && /^[\s\-:]+$/.test(withoutPipes)) {
          sepIdx = tableRows.length; // separator comes after header
        }
        tableRows.push(rowText);
        i++;
      }
      if (tableRows.length >= 2) {
        // Extract alignments from separator row
        const aligns: string[] = [];
        if (sepIdx >= 0) {
          const sepCells = tableRows[sepIdx].split('|').filter(c => c.trim() !== '');
          for (const c of sepCells) {
            const t = c.trim();
            if (t.startsWith(':') && t.endsWith(':')) aligns.push('center');
            else if (t.endsWith(':')) aligns.push('right');
            else aligns.push('left');
          }
        }
        let t = '<table>';
        tableRows.forEach((row, ri) => {
          if (ri === sepIdx) return; // skip separator row
          t += '<tr>';
          const cells = row.split('|').filter(c => c.trim() !== '');
          cells.forEach((cell, ci) => {
            const align = aligns[ci] ? ` style="text-align:${aligns[ci]}"` : '';
            if (ri === 0 || (sepIdx < 0 && ri === 0)) {
              t += '<th' + align + '>' + cell.trim() + '</th>';
            } else {
              t += '<td' + align + '>' + cell.trim() + '</td>';
            }
          });
          t += '</tr>';
        });
        out.push(t + '</table>');
        continue;
      }
      // Not enough rows for a table, fall through to paragraph
      i -= tableRows.length;
    }

    // ═══ Empty line — paragraph separator ═══
    if (line.trim() === '') { i++; continue; }

    // ═══ Regular text — collect into paragraph ═══
    const para: string[] = [];
    while (i < lines.length &&
           lines[i].trim() !== '' &&
           !/^(#{1,6} |[-*_]{3,}\s*$|&gt; |- \[[ x]\] |[\-\*] |\d+\. )/.test(lines[i]) &&
           !lines[i].startsWith('\x00CB')) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) out.push('<p>' + para.join('<br>') + '</p>');
    else i++;
  }

  h = out.join('');

  // ── Phase 3: Restore code blocks ──
  h = h.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx)]);

  return h;
}
