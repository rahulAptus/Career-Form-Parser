/**
 * File readers — turn a PDF, DOCX or TXT into the flat TextItem list the
 * parser consumes.
 *
 * TextItem = { text, x, y, width, height, fontSize, bold, page }
 *
 * PDF carries real geometry, so x/y/fontSize are read from the page. DOCX and
 * TXT have no layout, so those fields are synthesised from document order and
 * heading level — enough for line and section grouping, which is all the
 * parser needs them for.
 *
 * Both libraries load from CDN and are lazily imported, so a candidate who
 * never uploads a resume never downloads them.
 */

const PDFJS_VERSION = '4.10.38';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED = ['.pdf', '.docx', '.txt'];

let pdfjsPromise = null;
let mammothPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfjsPromise;
}

function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      if (window.mammoth) return resolve(window.mammoth);
      const script = document.createElement('script');
      script.src = MAMMOTH_URL;
      script.onload = () => resolve(window.mammoth);
      script.onerror = () => reject(new Error('Could not load the DOCX reader.'));
      document.head.appendChild(script);
    });
  }
  return mammothPromise;
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

const BOLD_FONT = /bold|black|heavy|semib|demi/i;

export async function readPdf(file) {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;

  const items = [];
  let textLength = 0;

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();

    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const t = item.transform;
      // transform is [scaleX, skewX, skewY, scaleY, translateX, translateY];
      // the vertical scale magnitude is the rendered font size.
      const fontSize = Math.hypot(t[2], t[3]) || item.height || 11;
      const family = content.styles?.[item.fontName]?.fontFamily || item.fontName || '';

      textLength += item.str.trim().length;
      items.push({
        text: item.str,
        x: t[4],
        y: t[5],
        width: item.width,
        height: item.height,
        fontSize,
        bold: BOLD_FONT.test(family),
        page: pageNo
      });
    }
    page.cleanup();
  }

  // A PDF that is one big scan yields almost no text layer. Say so plainly
  // rather than handing the parser 12 characters and letting it guess.
  if (textLength < 100) {
    throw new ScannedPdfError(
      'This PDF has almost no selectable text, so it is probably a scan or an image. ' +
      'Please upload a text-based PDF or a DOCX, or fill the form in manually.'
    );
  }
  return items;
}

export class ScannedPdfError extends Error {
  constructor(message) { super(message); this.name = 'ScannedPdfError'; this.recoverable = true; }
}

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

export async function readDocx(file) {
  const mammoth = await loadMammoth();
  const buffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer });

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = [];
  let y = 100000; // descending, so the parser's top-to-bottom sort still works

  const blocks = doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td');
  for (const block of blocks) {
    const text = block.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const heading = /^H[1-6]$/.test(block.tagName);
    const level = heading ? +block.tagName[1] : 0;
    const fontSize = heading ? 20 - level * 1.5 : 11;
    // Bold when the block is a heading, or when its text is wholly wrapped in
    // <strong> — a bold word inside a sentence should not mark the line bold.
    const strong = block.querySelector('strong, b');
    const bold = heading || (!!strong && strong.textContent.trim().length >= text.length * 0.8);

    items.push({
      text, x: 0, y, width: text.length * fontSize * 0.5,
      height: fontSize, fontSize, bold, page: 1
    });
    y -= fontSize * 1.6;
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * TXT
 * ------------------------------------------------------------------ */

export async function readTxt(file) {
  const text = await file.text();
  let y = 100000;
  return text.split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(line => {
      const item = {
        text: line, x: 0, y, width: line.length * 5.5, height: 11,
        fontSize: 11,
        // Plain text has no styling, so an all-caps short line is the only
        // heading signal available.
        bold: line === line.toUpperCase() && line.length < 40 && /[A-Z]/.test(line),
        page: 1
      };
      y -= 18;
      return item;
    });
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

export function validateFile(file) {
  if (!file) return 'Choose a file to upload.';
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!ACCEPTED.includes(ext)) return `Unsupported file type. Upload ${ACCEPTED.join(', ')}.`;
  if (file.size > MAX_FILE_BYTES) return `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`;
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** @returns {Promise<TextItem[]>} */
export async function readFile(file) {
  const error = validateFile(file);
  if (error) throw new Error(error);

  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (ext === '.pdf') return readPdf(file);
  if (ext === '.docx') return readDocx(file);
  return readTxt(file);
}
