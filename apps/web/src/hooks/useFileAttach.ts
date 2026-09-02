import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';

// ═══ File attach state + parser — handles .xlsx .docx .pdf and all text formats ═══
// Cap how much text a single attachment feeds the agent. 10k chars silently cut long
// markdown mid-document (e.g. a 14-chapter plan became 11) — raised to 100k so whole
// docs survive. The API/LLM can absorb that; message size is not a bottleneck here.
const MAX_ATTACH_CHARS = 100000;
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
            for (const row of data.slice(0, 100)) rows.push(row.map((c) => String(c ?? '')).join('\t'));
          }
          loaded.push({ name: f.name, size: f.size, content: rows.join('\n') });
        } else if (ext === 'docx') {
          const mammoth = await import('mammoth');
          const buf = await f.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: buf });
          loaded.push({ name: f.name, size: f.size, content: result.value.substring(0, MAX_ATTACH_CHARS) });
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
          loaded.push({ name: f.name, size: f.size, content: pages.join('\n\n').substring(0, MAX_ATTACH_CHARS) });
        } else if (ext === 'pptx') {
          // PPTX is an OOXML zip — extract text runs (<a:t>) from each slide XML
          const JSZip: any = await import('jszip');
          const zip = await JSZip.loadAsync(await f.arrayBuffer());
          const slideNumber = (name: string): number => {
            const m = name.match(/(\d+)\.xml$/);
            return m ? parseInt(m[1], 10) : 0;
          };
          const slideNames = Object.keys(zip.files)
            .filter((n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
            .sort((a: string, b: string) => slideNumber(a) - slideNumber(b));
          const slides: string[] = [];
          for (let i = 0; i < Math.min(slideNames.length, 20); i++) {
            const xml = (await zip.files[slideNames[i]].async('string')) as string;
            const doc = new DOMParser().parseFromString(xml, 'text/xml');
            const texts = Array.from(doc.getElementsByTagName('a:t'))
              .map((n) => n.textContent ?? '')
              .join(' ');
            slides.push(`--- Slide ${i + 1} ---\n${texts}`);
          }
          loaded.push({ name: f.name, size: f.size, content: slides.join('\n\n').substring(0, MAX_ATTACH_CHARS) });
        } else {
          const text = await f.text();
          loaded.push({ name: f.name, size: f.size, content: text.substring(0, MAX_ATTACH_CHARS) });
        }
      } catch {
        loaded.push({ name: f.name, size: f.size, content: `[${t('misc.cannotParse', lang)}: ${f.name}]` });
      }
    }
    setAttachedFiles((prev) => [...prev, ...loaded]);
  };

  return { attachedFiles, setAttachedFiles, dragOver, setDragOver, handleFiles };
}
