import { prisma } from '@tomilite/database';
import { DEFAULT_PROJECT_ID } from '../utils/constants.js';
import { generateReportVector } from '../utils/vector.js';
import { semanticRank } from '../utils/search.js';

/** List or search reports by title/content. Uses term-split OR search + FTS fallback. */
export async function listReports(
  args: Record<string, any>,
): Promise<
  Array<{ id: string; title: string; reportType: string; status: string; generatedAt: string | null; snippet: string }>
> {
  const where: any = { archived: false };
  if (args.query) {
    // Split query into terms. For CJK text without spaces, generate character bigrams
    // so "12个验证清单" → ["12","2个","个验","验证","证清","清单"] for fuzzy matching.
    const wsTerms = args.query.split(/[\s,，、]+/).filter((t: string) => t.length > 0);
    const hasCJK = /[一-鿿㐀-䶿]/.test(args.query);
    let terms = wsTerms;
    if (hasCJK && wsTerms.length === 1 && wsTerms[0].length > 2) {
      const q = wsTerms[0];
      const bigrams: string[] = [];
      for (let i = 0; i < q.length - 1; i++) bigrams.push(q.substring(i, i + 2));
      terms = [...new Set([q, ...bigrams])];
    }
    const orTerms = terms.flatMap((t: string) => [{ title: { contains: t } }, { content: { contains: t } }]);
    where.OR = orTerms;
  }
  let reports = await prisma.report.findMany({
    where,
    take: args.limit || 10,
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, reportType: true, status: true, generatedAt: true, content: true },
  });

  // FTS fallback: when Prisma contains returns nothing, try full-text search via global_fts
  if (args.query && reports.length === 0) {
    try {
      // FTS5 unicode61 tokenizer splits CJK into individual chars — pass query as-is
      const ftsRows = (await prisma.$queryRawUnsafe(
        'SELECT ref_id FROM global_fts WHERE type = ? AND global_fts MATCH ? ORDER BY rank LIMIT 10',
        'report',
        args.query,
      )) as any[];
      if (ftsRows?.length > 0) {
        const ids = ftsRows.map((r: any) => r.ref_id);
        reports = await prisma.report.findMany({
          where: { id: { in: ids } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, reportType: true, status: true, generatedAt: true, content: true },
        });
      }
    } catch {
      /* FTS may not be available or query syntax invalid */
    }
  }

  if (args.query && reports.length > 0) {
    const ranked = await semanticRank(
      args.query,
      reports.map((r) => ({ id: r.id, title: r.title, snippet: r.content?.substring(0, 200) })),
    );
    return ranked.map((r) => {
      const orig = reports.find((rep) => rep.id === r.id);
      return {
        id: r.id,
        title: r.title,
        reportType: orig?.reportType || 'daily',
        status: orig?.status || 'draft',
        generatedAt: orig?.generatedAt || null,
        snippet: r.snippet?.substring(0, 200) || '',
      };
    });
  }
  return reports.map((r) => ({
    id: r.id,
    title: r.title,
    reportType: r.reportType,
    status: r.status,
    generatedAt: r.generatedAt,
    snippet: (r.content || '').substring(0, 200),
  }));
}

/** Get full report content by ID */
export async function getReport(
  args: Record<string, any>,
): Promise<
  | { id: string; title: string; content: string; reportType: string; status: string; generatedAt: string | null }
  | { error: string }
> {
  try {
    const report = await prisma.report.findUnique({ where: { id: args.id } });
    if (!report) return { error: 'Report not found: ' + args.id };
    return {
      id: report.id,
      title: report.title,
      content: report.content || '',
      reportType: report.reportType,
      status: report.status,
      generatedAt: report.generatedAt,
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

/** Delete a report by ID */
export async function deleteReport(
  args: Record<string, any>,
): Promise<{ ok: boolean; deleted: boolean; reportId: string; title: string } | { error: string }> {
  try {
    const report = await prisma.report.findUnique({ where: { id: args.id } });
    if (!report) return { error: 'Report not found: ' + args.id };
    await prisma.report.delete({ where: { id: args.id } });
    return { ok: true, deleted: true, reportId: args.id, title: report.title };
  } catch (e: any) {
    return { error: 'Delete failed: ' + e.message };
  }
}

/** Create a report — daily/weekly summaries or topic reports */
export async function createReport(
  args: Record<string, any>,
): Promise<{ id: string; title: string; reportType: string; status: string } | { error: string }> {
  if (!args.title && !args.content) return { error: 'Missing title or content.' };
  const report = await prisma.report.create({
    data: {
      projectId: DEFAULT_PROJECT_ID,
      reportType: args.reportType || 'daily',
      title: args.title,
      content: args.content,
      status: 'draft',
    },
  });
  generateReportVector(report.id);
  return { id: report.id, title: report.title, reportType: report.reportType, status: report.status };
}

/** Update an existing report by ID */
export async function updateReport(
  args: Record<string, any>,
): Promise<{ id: string; title: string; updated: boolean } | { error: string }> {
  const existing = await prisma.report.findUnique({ where: { id: args.id } });
  if (!existing) return { error: 'Report not found: ' + args.id };
  const data: any = {};
  if (args.title) data.title = args.title;
  if (args.content) data.content = args.content;
  const r = await prisma.report.update({ where: { id: args.id }, data });
  return { id: r.id, title: r.title, updated: true };
}

/** Fill the report editor form. Does NOT save to DB. */
export function suggestReportEdit(args: Record<string, any>): any {
  return {
    staged: true,
    title: args.title?.substring(0, 80),
    content: args.content?.substring(0, 2000),
    type: 'report',
    _full: { title: args.title || '', content: args.content || '' },
  };
}

/** Export data to Excel (.xlsx) */
export async function exportToExcel(args: Record<string, any>): Promise<any> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const XLSX: any = await import('xlsx');
    let rows: any[] = [];
    let fname = 'export.xlsx';
    let content = '';
    let sheetTitle = args.filename || 'export';
    if (args.reportId) {
      const looksLikePlaceholder =
        /(UUID|REPORT.*ID|placeholder|from.*list|result)/i.test(args.reportId) ||
        /^[<(]?(the|from|check|use|see|UUID|REPORT)/i.test(args.reportId);
      if (looksLikePlaceholder || (args.reportId.length < 20 && args.reportId.indexOf('-') < 0)) {
        return { error: `"${args.reportId}" is not a valid report ID.` };
      }
      let report = null;
      if (args.reportId.includes('-') && args.reportId.length > 20)
        report = await prisma.report.findUnique({ where: { id: args.reportId } });
      if (!report)
        report = await prisma.report.findFirst({
          where: { title: { contains: args.reportId } },
          orderBy: { createdAt: 'desc' },
        });
      if (!report) return { error: `No report matches "${args.reportId}".` };
      content = report.content || '';
      sheetTitle = (report.title || 'report').replace(/[<>:"/\\|?*]/g, '_');
      fname = sheetTitle + '.xlsx';
    } else if (args.noteId) {
      const looksLikePlaceholder = /(UUID|REPORT|placeholder|from.*list|result)/i.test(args.noteId);
      if (looksLikePlaceholder || (args.noteId.length < 20 && args.noteId.indexOf('-') < 0))
        return { error: 'Invalid note ID.' };
      const note = await prisma.knowledgePage.findUnique({ where: { id: args.noteId } });
      if (!note) return { error: `Note not found: ${args.noteId}.` };
      content = note.content || '';
      sheetTitle = (note.title || 'note').replace(/[<>:"/\\|?*]/g, '_');
      fname = sheetTitle + '.xlsx';
    } else if (args.taskFilter) {
      const issues = await prisma.issue.findMany({
        where: {
          projectId: DEFAULT_PROJECT_ID,
          ...(args.taskFilter === 'todo' ? { status: 'todo' } : args.taskFilter === 'done' ? { status: 'done' } : {}),
        },
        orderBy: { issueNumber: 'asc' },
        take: 200,
      });
      rows = issues.map((i) => ({
        key: 'TL-' + i.issueNumber,
        title: i.title,
        type: i.type,
        status: i.status,
        priority: i.priority,
        description: (i.description || '').substring(0, 200),
      }));
      fname = (args.filename || 'tasks') + '.xlsx';
    } else if (args.content) {
      content = args.content;
      fname = (args.filename || 'notes') + '.xlsx';
    }
    if (content) {
      // Build sheet manually — flat content + real tables
      const sheetRows: any[][] = [];
      const lines = content.split('\n');
      let i = 0;
      const border = {
        top: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        left: { style: 'thin' as const },
        right: { style: 'thin' as const },
      };
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) {
          i++;
          continue;
        }
        // Heading
        if (t.startsWith('# ') || t.startsWith('## ') || t.startsWith('### ')) {
          sheetRows.push([t.replace(/^#+\s*/, '')]);
          i++;
          continue;
        }
        // Horizontal rule — skip
        if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) {
          i++;
          continue;
        }
        // Table
        if (t.startsWith('|') && t.endsWith('|') && i + 1 < lines.length) {
          const nextLine = lines[i + 1]?.trim() || '';
          const withoutPipes = nextLine.replace(/\|/g, '').trim();
          if (withoutPipes.length > 0 && /^[\s\-:]+$/.test(withoutPipes)) {
            const parseRow = (l: string) =>
              l
                .split('|')
                .slice(1, -1)
                .map((c: string) => c.trim());
            sheetRows.push(parseRow(t)); // header
            i += 2;
            while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
              sheetRows.push(parseRow(lines[i].trim()));
              i++;
            }
            continue;
          }
        }
        // Blockquote / paragraph / list → single-cell row
        let text = t
          .replace(/^>\s*/, '')
          .replace(/^[-*]\s*/, '')
          .replace(/^\d+\.\s*/, '');
        text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
        sheetRows.push([text]);
        i++;
      }
      if (sheetRows.length === 0) sheetRows.push([sheetTitle]);
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      // Style: headings bold, all cells borders
      const maxCols = Math.max(...sheetRows.map((r) => r.length), 1);
      ws['!cols'] = Array.from({ length: maxCols }, (_, c) => ({ wch: c === 0 ? 60 : 20 }));
      const range2 = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = range2.s.r; R <= range2.e.r; R++) {
        for (let C = range2.s.c; C <= range2.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[addr]) ws[addr] = { t: 's', v: '' };
          const isHeading =
            R < sheetRows.length &&
            sheetRows[R].length === 1 &&
            /^[📋✅💻🔴🟡🟢🔵🧘💡]/.test(String(sheetRows[R]?.[0] || ''));
          const isTableHeader = R < sheetRows.length && sheetRows[R].length > 1 && C === 0;
          ws[addr].s = {
            border,
            font: { bold: isHeading || isTableHeader, name: 'Calibri', sz: 11 },
            alignment: { wrapText: true, vertical: 'top' },
          };
        }
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filePath = path.join(os.tmpdir(), fname);
      fs.writeFileSync(filePath, buf);
      return { ok: true, filePath, filename: fname, size: buf.length, type: 'xlsx', rowCount: sheetRows.length };
    }
    // Task export (flat table — json_to_sheet is correct)
    if (!Array.isArray(rows) || rows.length === 0)
      return { error: 'No data to export. Provide reportId, noteId, taskFilter, or rows.' };
    const ws = XLSX.utils.json_to_sheet(rows);
    const keys = Object.keys(rows[0] || {});
    const colWidths = keys.map((k) =>
      Math.min(Math.max(k.length, ...rows.map((r) => String(r[k] || '').length)) + 2, 60),
    );
    ws['!cols'] = colWidths.map((w) => ({ wch: w }));
    const border = {
      top: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      left: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; R++)
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = { ...(ws[addr].s || {}), border };
      }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filePath = path.join(os.tmpdir(), fname);
    fs.writeFileSync(filePath, buf);
    return { ok: true, filePath, filename: fname, size: buf.length, type: 'xlsx', rowCount: rows.length };
  } catch (e: any) {
    return { error: 'Export failed: ' + e.message };
  }
}

/** Export content to Word (.docx) */
export async function exportToDoc(args: Record<string, any>): Promise<any> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const { Document, Packer, Paragraph, HeadingLevel }: any = await import('docx');
    let content = '';
    let fname = 'document.docx';
    if (args.reportId) {
      const looksLikePlaceholder =
        /(UUID|REPORT.*ID|placeholder|from.*list|result)/i.test(args.reportId) ||
        /^[<(]?(the|from|check|use|see|UUID|REPORT)/i.test(args.reportId);
      if (looksLikePlaceholder || (args.reportId.length < 20 && args.reportId.indexOf('-') < 0)) {
        return {
          error: `"${args.reportId}" is not a valid report ID — it looks like placeholder text. Look at the PREVIOUS list_reports result for the actual id field (UUID with dashes) and use THAT.`,
        };
      }
      let report =
        args.reportId.includes('-') && args.reportId.length > 20
          ? await prisma.report.findUnique({ where: { id: args.reportId } })
          : null;
      if (!report)
        report = await prisma.report.findFirst({
          where: { title: { contains: args.reportId } },
          orderBy: { createdAt: 'desc' },
        });
      if (!report) return { error: `Report not found for "${args.reportId}".` };
      content = report.content || '';
      fname = (args.filename || (report.title || 'report').replace(/[<>:"/\\|?*]/g, '_')) + '.docx';
    } else if (args.noteId) {
      const looksLikePlaceholder =
        /(UUID|REPORT|placeholder|from.*list|result)/i.test(args.noteId) ||
        /^[<(]?(the|from|check|use|see|NOTE)/i.test(args.noteId);
      if (looksLikePlaceholder || (args.noteId.length < 20 && args.noteId.indexOf('-') < 0)) {
        return {
          error: `"${args.noteId}" looks like placeholder text, not a real note ID. Use search_notes(query="keyword") to find the note, then use its id field (UUID) for noteId.`,
        };
      }
      const note = await prisma.knowledgePage.findUnique({ where: { id: args.noteId } });
      if (!note) return { error: `Note not found: ${args.noteId}. Use search_notes to find the correct UUID.` };
      content = note.content || '';
      fname = (args.filename || note.title || 'note') + '.docx';
    } else if (args.taskFilter) {
      const issues = await prisma.issue.findMany({
        where: {
          projectId: DEFAULT_PROJECT_ID,
          ...(args.taskFilter === 'todo' ? { status: 'todo' } : args.taskFilter === 'done' ? { status: 'done' } : {}),
        },
        orderBy: { issueNumber: 'asc' },
        take: 200,
      });
      content = issues
        .map(
          (i) =>
            `## TL-${i.issueNumber} ${i.title}\nType: ${i.type} | Status: ${i.status} | Priority: ${i.priority}\n${i.description || ''}`,
        )
        .join('\n\n');
      fname = (args.filename || 'tasks') + '.docx';
    } else if (args.content) {
      content = args.content;
    }
    if (!content) return { error: 'No content to export.' };
    const { Table, TableRow, TableCell, WidthType }: any = await import('docx');
    const children: any[] = [];
    const lines = content.split('\n');
    let i = 0;
    // Strip inline markdown (code, links, bold, italic) so no literal "####", "**x**", "[t](u)" leaks into the doc
    const cleanInline = (s: string) =>
      s
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*\s][^*]*?)\*\*/g, '$1')
        .replace(/\*([^*\s][^*]*?)\*/g, '$1');
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) {
        i++;
        continue;
      }

      // Skip horizontal rules
      if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) {
        i++;
        continue;
      }

      // Fenced code block (``` or ~~~) — preserve every line verbatim, drop the fences
      const fenceMatch = t.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        const fence = fenceMatch[1];
        i++;
        const codeLines: string[] = [];
        while (i < lines.length && !lines[i].trim().startsWith(fence)) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // consume closing fence
        if (codeLines.length > 0) {
          codeLines.forEach((cl, idx) => {
            children.push(
              new Paragraph({
                text: cl === '' ? ' ' : cl,
                spacing: { after: idx === codeLines.length - 1 ? 80 : 0 },
                indent: { left: 360 },
              }),
            );
          });
        }
        continue;
      }

      // Headings (1-6 levels; docx has 3 levels so 4-6 map to HEADING_3)
      const headingMatch = t.match(/^(#{1,6})\s(.+)$/);
      if (headingMatch) {
        const n = headingMatch[1].length;
        const lvl = n === 1 ? HeadingLevel.HEADING_1 : n === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        children.push(new Paragraph({ text: cleanInline(headingMatch[2]), heading: lvl, spacing: { after: 100 } }));
        i++;
        continue;
      }

      // Markdown table detection
      if (t.startsWith('|') && t.endsWith('|') && i + 1 < lines.length) {
        const nextLine = lines[i + 1]?.trim() || '';
        const withoutPipes = nextLine.replace(/\|/g, '').trim();
        const isSep = withoutPipes.length > 0 && /^[\s\-:]+$/.test(withoutPipes);
        if (isSep) {
          const parseRow = (l: string) =>
            l
              .split('|')
              .slice(1, -1)
              .map((c: string) => c.trim());
          const headers = parseRow(t);
          i += 2; // skip header + separator
          const tableRows: any[] = [];
          // Header row
          tableRows.push(
            new TableRow({
              children: headers.map(
                (h: string) =>
                  new TableCell({
                    children: [new Paragraph({ text: cleanInline(h), bold: true, spacing: { after: 0 } })],
                    width: { size: Math.max(100, 9000 / Math.max(headers.length, 1)), type: WidthType.DXA },
                  }),
              ),
            }),
          );
          // Data rows
          while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
            const cells = parseRow(lines[i].trim());
            tableRows.push(
              new TableRow({
                children: cells.map(
                  (c: string) =>
                    new TableCell({ children: [new Paragraph({ text: cleanInline(c), spacing: { after: 0 } })] }),
                ),
              }),
            );
            i++;
          }
          children.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: 'single', size: 1 },
                bottom: { style: 'single', size: 1 },
                left: { style: 'single', size: 1 },
                right: { style: 'single', size: 1 },
                insideHorizontal: { style: 'single', size: 1 },
                insideVertical: { style: 'single', size: 1 },
              },
            }),
          );
          // Add spacing after table
          children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
          continue;
        }
      }

      // Blockquote
      if (t.startsWith('>')) {
        const quoteText = cleanInline(t.replace(/^>\s*/, ''));
        children.push(new Paragraph({ text: quoteText, italics: true, spacing: { after: 60 }, indent: { left: 360 } }));
        i++;
        continue;
      }

      // Unordered list
      if (t.startsWith('- ') || t.startsWith('* ')) {
        children.push(
          new Paragraph({ text: cleanInline(t.replace(/^[-*]\s*/, '')), bullet: { level: 0 }, spacing: { after: 40 } }),
        );
        i++;
        continue;
      }

      // Ordered list
      const olMatch = t.match(/^\d+\.\s/);
      if (olMatch) {
        children.push(
          new Paragraph({
            text: cleanInline(t.replace(/^\d+\.\s*/, '')),
            bullet: { level: 0 },
            spacing: { after: 40 },
          }),
        );
        i++;
        continue;
      }

      // Regular paragraph — strip inline markdown
      const text = cleanInline(t);
      children.push(new Paragraph({ text, spacing: { after: 40 } }));
      i++;
    }
    if (children.length === 0) children.push(new Paragraph({ text: content || ' ' }));
    const doc = new Document({ sections: [{ properties: {}, children }] });
    const buf = await Packer.toBuffer(doc);
    const filePath = path.join(os.tmpdir(), fname);
    fs.writeFileSync(filePath, buf);
    return { ok: true, filePath, filename: fname, size: buf.length, type: 'docx' };
  } catch (e: any) {
    return { error: 'Export failed: ' + e.message };
  }
}

/** Export content to HTML */
export async function exportToHtml(args: Record<string, any>): Promise<any> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const { marked } = await import('marked');
    let content = '';
    let fname = 'document.html';
    if (args.reportId) {
      const looksLikePlaceholder = /(UUID|REPORT.*ID|placeholder|from.*list|result)/i.test(args.reportId);
      if (looksLikePlaceholder || (args.reportId.length < 20 && args.reportId.indexOf('-') < 0))
        return { error: 'Invalid report ID.' };
      let report =
        args.reportId.includes('-') && args.reportId.length > 20
          ? await prisma.report.findUnique({ where: { id: args.reportId } })
          : null;
      if (!report)
        report = await prisma.report.findFirst({
          where: { title: { contains: args.reportId } },
          orderBy: { createdAt: 'desc' },
        });
      if (!report) return { error: `No report matches "${args.reportId}".` };
      content = report.content || '';
      fname = (args.filename || (report.title || 'report').replace(/[<>:"/\\|?*]/g, '_')) + '.html';
    } else if (args.noteId) {
      const note = await prisma.knowledgePage.findUnique({ where: { id: args.noteId } });
      if (!note) return { error: `Note not found: ${args.noteId}.` };
      content = note.content || '';
      fname = (args.filename || note.title || 'note') + '.html';
    } else if (args.content) {
      content = args.content;
      fname = (args.filename || 'notes') + '.html';
    }
    if (!content) return { error: 'No content to export.' };
    const html = marked.parse(content);
    const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #1a1a1a; }
  h1 { font-size: 24px; border-bottom: 2px solid #4338CA; padding-bottom: 8px; }
  h2 { font-size: 18px; margin-top: 24px; padding: 8px 12px; background: linear-gradient(135deg, #f3f4f6, transparent); border-left: 4px solid #4338CA; border-radius: 0 6px 6px 0; }
  h3 { font-size: 15px; margin-top: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  th { background: linear-gradient(135deg, #4338CA, #3730A3); color: #fff; padding: 8px 12px; font-size: 13px; font-weight: 600; text-align: left; }
  td { padding: 7px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  blockquote { margin: 12px 0; padding: 14px 18px; background: linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02)); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); font-style: italic; }
  blockquote p { margin: 0; }
  ul li { padding: 4px 0; }
  hr { height: 2px; border: none; margin: 16px 0; background: linear-gradient(90deg, #4338CA, transparent); }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 13px; }
  pre { background: #0d1117; color: #c9d1d9; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
  a { color: #4338CA; }
</style>
</head>
<body>
${html}
</body>
</html>`;
    const filePath = path.join(os.tmpdir(), fname);
    fs.writeFileSync(filePath, doc, 'utf-8');
    return { ok: true, filePath, filename: fname, size: Buffer.byteLength(doc), type: 'html', html: doc };
  } catch (e: any) {
    return { error: 'Export failed: ' + e.message };
  }
}

// ═══ PowerPoint (.pptx) export ═══

/** Strip inline markdown so a slide never shows literal **x**, [t](u) or `code` backticks. */
function stripInlineForSlide(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*\s][^*]*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

interface PptxBlock {
  kind: 'title' | 'slide' | 'table';
  title?: string;
  bullets?: Array<{ text: string; mono?: boolean }>;
  table?: string[][];
}

/**
 * Turn a markdown note/report into deck blocks: an optional title slide,
 * one slide per H2+ heading (bullets underneath), plus dedicated table slides.
 */
function markdownToDeck(content: string): PptxBlock[] {
  const lines = content.split('\n');
  const deck: PptxBlock[] = [];
  let title = '';
  let current: PptxBlock | null = null;

  const closeSlide = () => {
    if (current && current.bullets && current.bullets.length > 0) deck.push(current);
    current = null;
  };
  const ensureSlide = (heading: string) => {
    closeSlide();
    current = { kind: 'slide', title: heading, bullets: [] };
  };
  const addBullet = (heading: string, text: string, mono: boolean) => {
    if (!current) ensureSlide(heading);
    if (current?.bullets) current.bullets.push({ text, mono });
  };

  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    // Horizontal rule — skip
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) {
      i++;
      continue;
    }
    // Heading — first H1 becomes the deck title, everything else opens a slide
    const h = t.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const text = stripInlineForSlide(h[2]);
      if (h[1].length === 1 && !title) {
        title = text;
      } else {
        ensureSlide(text);
      }
      i++;
      continue;
    }
    // Fenced code block — render verbatim in monospace (cap for slide sanity)
    const fence = t.match(/^(`{3,}|~{3,})(.*)$/);
    if (fence) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      if (!current) ensureSlide('Code');
      codeLines.slice(0, 20).forEach((cl) => addBullet('Code', cl || ' ', true));
      if (codeLines.length > 20) addBullet('Code', '…', false);
      continue;
    }
    // Markdown table — dedicated table slide (up to 30 rows)
    if (t.startsWith('|') && t.endsWith('|') && i + 1 < lines.length) {
      const sep = (lines[i + 1] || '').replace(/\|/g, '').trim();
      if (sep && /^[\s\-:]+$/.test(sep)) {
        const parseRow = (l: string) =>
          l
            .split('|')
            .slice(1, -1)
            .map((c: string) => stripInlineForSlide(c));
        const rows = [parseRow(t)];
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          rows.push(parseRow(lines[i].trim()));
          i++;
        }
        closeSlide();
        deck.push({ kind: 'table', title: rows[0].slice(0, 4).join(' · ') || 'Table', table: rows.slice(0, 30) });
        continue;
      }
    }
    // Bullet / ordered list / paragraph / blockquote → one slide bullet
    let text = lines[i]
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '');
    text = stripInlineForSlide(text);
    if (!text) {
      i++;
      continue;
    }
    if (!current) ensureSlide('Overview');
    addBullet('Overview', text, false);
    i++;
  }
  closeSlide();
  if (title) deck.unshift({ kind: 'title', title });
  return deck;
}

/** Export content to PowerPoint (.pptx). Supports reportId, noteId, taskFilter, or content. */
export async function exportToPptx(args: Record<string, any>): Promise<any> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const mod: any = await import('pptxgenjs');
    const PptxGen = mod.default || mod;
    let content = '';
    let fname = 'presentation.pptx';
    if (args.reportId) {
      const looksLikePlaceholder =
        /(UUID|REPORT.*ID|placeholder|from.*list|result)/i.test(args.reportId) ||
        /^[<(]?(the|from|check|use|see|UUID|REPORT)/i.test(args.reportId);
      if (looksLikePlaceholder || (args.reportId.length < 20 && args.reportId.indexOf('-') < 0)) {
        return {
          error: `"${args.reportId}" is not a valid report ID — it looks like placeholder text. Look at the PREVIOUS list_reports result for the actual id field (UUID with dashes) and use THAT.`,
        };
      }
      let report =
        args.reportId.includes('-') && args.reportId.length > 20
          ? await prisma.report.findUnique({ where: { id: args.reportId } })
          : null;
      if (!report)
        report = await prisma.report.findFirst({
          where: { title: { contains: args.reportId } },
          orderBy: { createdAt: 'desc' },
        });
      if (!report) return { error: `Report not found for "${args.reportId}".` };
      content = report.content || '';
      fname = (args.filename || (report.title || 'report').replace(/[<>:"/\\|?*]/g, '_')) + '.pptx';
    } else if (args.noteId) {
      const looksLikePlaceholder =
        /(UUID|REPORT|placeholder|from.*list|result)/i.test(args.noteId) ||
        /^[<(]?(the|from|check|use|see|NOTE)/i.test(args.noteId);
      if (looksLikePlaceholder || (args.noteId.length < 20 && args.noteId.indexOf('-') < 0)) {
        return {
          error: `"${args.noteId}" looks like placeholder text, not a real note ID. Use search_notes(query="keyword") to find the note, then use its id field (UUID) for noteId.`,
        };
      }
      const note = await prisma.knowledgePage.findUnique({ where: { id: args.noteId } });
      if (!note) return { error: `Note not found: ${args.noteId}. Use search_notes to find the correct UUID.` };
      content = note.content || '';
      fname = (args.filename || (note.title || 'note').replace(/[<>:"/\\|?*]/g, '_')) + '.pptx';
    } else if (args.taskFilter) {
      const issues = await prisma.issue.findMany({
        where: {
          projectId: DEFAULT_PROJECT_ID,
          ...(args.taskFilter === 'todo' ? { status: 'todo' } : args.taskFilter === 'done' ? { status: 'done' } : {}),
        },
        orderBy: { issueNumber: 'asc' },
        take: 200,
      });
      content = issues
        .map(
          (i) =>
            `## TL-${i.issueNumber} ${i.title}\n- Type: ${i.type} · Status: ${i.status} · Priority: ${i.priority}\n${i.description || ''}`,
        )
        .join('\n\n');
      fname = (args.filename || 'tasks') + '.pptx';
    } else if (args.content) {
      content = args.content;
      fname = (args.filename || 'notes').replace(/\.pptx$/i, '') + '.pptx';
    }
    if (!content || !content.trim()) return { error: 'No content to export.' };

    const deck = markdownToDeck(content);
    if (deck.length === 0) return { error: 'No slide content found in the source.' };

    const pptx = new PptxGen();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
    pptx.author = 'TomiLite';
    const INK = '1F2937';
    const SUB = '6B7280';
    const BODY = '374151';
    const BRAND = '6366F1';
    const EDGE = 'E5E7EB';
    const PAPER = 'FFFFFF';

    for (const block of deck) {
      if (block.kind === 'title') {
        const s = pptx.addSlide();
        s.background = { color: PAPER };
        s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.14, fill: { color: BRAND } });
        s.addText(block.title || 'Presentation', {
          x: 0.9,
          y: 2.7,
          w: 11.5,
          h: 1.3,
          fontSize: 36,
          bold: true,
          color: INK,
          align: 'center',
          fontFace: 'Calibri',
        });
        const d = new Date();
        const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        s.addText(`${stamp} · TomiLite`, {
          x: 0.9,
          y: 4.1,
          w: 11.5,
          h: 0.5,
          fontSize: 13,
          color: SUB,
          align: 'center',
        });
      } else if (block.kind === 'table' && block.table && block.table.length > 0) {
        const s = pptx.addSlide();
        s.background = { color: PAPER };
        s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.1, fill: { color: BRAND } });
        s.addText((block.title || '').substring(0, 60), {
          x: 0.55,
          y: 0.3,
          w: 12.2,
          h: 0.7,
          fontSize: 20,
          bold: true,
          color: INK,
        });
        const rows = block.table.map((row, ri) =>
          row.map((cell) => ({
            text: cell === '' ? ' ' : cell,
            options: {
              bold: ri === 0,
              color: ri === 0 ? 'FFFFFF' : BODY,
              fill: { color: ri === 0 ? BRAND : ri % 2 === 0 ? 'F9FAFB' : PAPER },
              margin: 3,
            },
          })),
        );
        s.addTable(rows, {
          x: 0.55,
          y: 1.35,
          w: 12.2,
          fontSize: 12,
          color: BODY,
          border: { type: 'solid', pt: 0.5, color: EDGE },
          rowH: 0.42,
          autoPage: true,
        });
      } else {
        const s = pptx.addSlide();
        s.background = { color: PAPER };
        s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.1, fill: { color: BRAND } });
        if (block.title) {
          s.addText(block.title.substring(0, 80), {
            x: 0.6,
            y: 0.3,
            w: 12.1,
            h: 0.85,
            fontSize: 24,
            bold: true,
            color: INK,
            fontFace: 'Calibri',
          });
          s.addShape('rect', { x: 0.66, y: 1.16, w: 1.5, h: 0.06, fill: { color: BRAND } });
        }
        const y0 = block.title ? 1.5 : 0.5;
        const bullets = (block.bullets || []).map((b) => ({
          text: b.text || ' ',
          options: b.mono
            ? { fontFace: 'Consolas', fontSize: 12, color: BODY, breakLine: true }
            : { bullet: { code: '2022' }, fontSize: 15, color: BODY, breakLine: true, paraSpaceAfter: 8 },
        }));
        if (bullets.length > 0) {
          s.addText(bullets, {
            x: 0.7,
            y: y0,
            w: 11.9,
            h: 7.3 - y0,
            valign: 'top',
            shrinkText: true,
            lineSpacingMultiple: 1.12,
          });
        }
      }
    }

    const filePath = path.join(os.tmpdir(), fname);
    await pptx.writeFile({ fileName: filePath });
    const size = fs.statSync(filePath).size;
    return { ok: true, filePath, filename: fname, size, type: 'pptx', slideCount: deck.length };
  } catch (e: any) {
    return { error: 'Export failed: ' + e.message };
  }
}
