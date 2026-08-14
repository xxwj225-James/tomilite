import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';

// ═══ File attach state + parser — handles .xlsx .docx .pdf and all text formats ═══
export function useFileAttach() {
  const lang = useLang();
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; size: number; content: string }>>([]);
  const [dragOver, setDragOver] = useState(false);

  // Shared file parser — handles .xlsx .docx .pdf and all text formats
  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const loaded: Array<{ name: string; size: number; content: string }> = [];
    for (const f of arr) {
      const ext = f.name.split('.').pop()?.toLowerCase();
      try {
        if (ext === 'xlsx') {
          const XLSX: any = await import('xlsx');
          const buf = await f.arrayBuffer();
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
          const rows: string[] = [];
          for (const sn of wb.SheetNames) {
            const ws = wb.Sheets[sn];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
            rows.push(`--- Sheet: ${sn} ---`);
            for (const row of data.slice(0, 100)) rows.push(row.map(c => String(c ?? '')).join('\t'));
          }
          loaded.push({ name: f.name, size: f.size, content: rows.join('\n') });
        } else if (ext === 'docx') {
          const mammoth = await import('mammoth');
          const buf = await f.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: buf });
          loaded.push({ name: f.name, size: f.size, content: result.value.substring(0, 10000) });
        } else if (ext === 'pdf') {
          const pdfjsLib = await import('pdfjs-dist');
          pdfjsLib.GlobalWorkerOptions.workerSrc = '';
          const buf = await f.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          const pages: string[] = [];
          for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
            const page = await pdf.getPage(i);
            const text = await page.getTextContent();
            pages.push(text.items.map((t: any) => t.str).join(' '));
          }
          loaded.push({ name: f.name, size: f.size, content: pages.join('\n\n').substring(0, 10000) });
        } else {
          const text = await f.text();
          loaded.push({ name: f.name, size: f.size, content: text.substring(0, 10000) });
        }
      } catch { loaded.push({ name: f.name, size: f.size, content: `[${t('misc.cannotParse', lang)}: ${f.name}]` }); }
    }
    setAttachedFiles(prev => [...prev, ...loaded]);
  };

  return { attachedFiles, setAttachedFiles, dragOver, setDragOver, handleFiles };
}
