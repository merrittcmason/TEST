// src/services/openai.ts

export interface ParsedEvent {
  event_name: string;
  event_date: string;
  event_time: string | null;
  event_tag: string | null;
}

export interface ParseResult {
  events: ParsedEvent[];
  tokensUsed: number;
}

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

// Soft budget & chunking targets
const MAX_CONTENT_TOKENS = 2000;        // keep for UI messaging
const CHUNK_TARGET_TOKENS = 1500;       // safe per-call size
const CHARS_PER_TOKEN = 4;              // sane English approx

// ---------- token helpers ----------
function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / CHARS_PER_TOKEN);
}

function splitTextApproxByTokens(text: string, maxTokens: number): string[] {
  const maxChars = Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN));
  if (!text || text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    let cut = end;
    const slice = text.slice(start, end);
    const lastNewline = slice.lastIndexOf('\n');
    const lastSpace = slice.lastIndexOf(' ');
    if (lastNewline > maxChars * 0.6) cut = start + lastNewline;
    else if (lastSpace > maxChars * 0.6) cut = start + lastSpace;

    chunks.push(text.slice(start, cut));
    start = cut;
    while (start < text.length && /\s/.test(text[start])) start++;
  }
  return chunks.filter(c => c.trim().length > 0);
}

// ---------- LLM plumbing ----------
async function callOpenAI(messages: any[], max_tokens = 800) {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.1,
      max_tokens,
    }),
  });

  if (!response.ok) {
    let msg = 'OpenAI API request failed';
    try {
      const err = await response.json();
      msg = err.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const tokensUsed = data.usage?.total_tokens ?? 0;
  return { content, tokensUsed };
}

function parseJsonContent(raw: string): { events: ParsedEvent[] } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Failed to parse AI response as JSON');
    parsed = JSON.parse(m[0]);
  }
  const events: ParsedEvent[] = Array.isArray(parsed?.events) ? parsed.events : [];
  return { events };
}

const systemPromptBase = `You are a calendar event parser. Extract events and return strict JSON.

Current date for reference: ${new Date().toISOString().split('T')[0]}

Rules:
- If year is missing, use current year (${new Date().getFullYear()})
- If time is missing, set event_time to null (all-day)
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Extract short tags if mentioned (e.g., "work", "school"). If none, use null.
- If no events found, return an empty array.

Return ONLY valid JSON exactly like:
{
  "events": [
    { "event_name": "Meeting", "event_date": "2025-10-03", "event_time": "08:30", "event_tag": "work" }
  ]
}
`;

// ---------- deterministic extractors ----------
const HEADER_SKIP = new Set([
  '14-Week',
  'Due Date',
  'Day',
  'Assignment',
  'Remember, these are the dates for which the assignments must be finished.'
]);

const DAY_TOKEN = /^(M|T|W|Th|F|Sa|Su)$/i;
const DATE_TOKEN = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/; // MM/DD or MM/DD/YYYY
const LEADING_MM_DD = /^(\d{1,2})\/(\d{2})\b/;                // "9/05 ..." style

function yearOrDefault(y?: string | number): number {
  const nowY = new Date().getFullYear();
  if (!y) return nowY;
  const n = typeof y === 'string' ? parseInt(y, 10) : y;
  if (String(n).length === 2) return 2000 + (n as number);
  return n as number;
}

function toIsoDate(mm: number, dd: number, yyyy?: number): string {
  const y = yyyy ?? new Date().getFullYear();
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// DOCX/TXT/CSV line-based extractor (“9/05 F Assignment …”)
function extractEventsFromScheduleText(text: string): ParsedEvent[] {
  const lines = (text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const events: ParsedEvent[] = [];
  for (const line of lines) {
    if (HEADER_SKIP.has(line)) continue;

    // Case 1: line starts with "MM/DD ..." (no year)
    const lead = line.match(LEADING_MM_DD);
    if (lead) {
      const mm = parseInt(lead[1], 10);
      const dd = parseInt(lead[2], 10);
      const tokens = line.split(/\s+/);
      tokens.shift(); // remove date
      if (tokens.length && DAY_TOKEN.test(tokens[0])) tokens.shift(); // optional day abbrev
      const name = tokens.join(' ').trim();
      if (name) {
        events.push({
          event_name: name,
          event_date: toIsoDate(mm, dd),
          event_time: null,
          event_tag: null,
        });
      }
      continue;
    }

    // Case 2: somewhere in line has "MM/DD[/YYYY]" token (CSV-ish rows)
    const anyDate = line.split(/,\s*|\s+/).find(tok => DATE_TOKEN.test(tok));
    if (anyDate) {
      const m = anyDate.match(DATE_TOKEN)!;
      const mm = parseInt(m[1], 10);
      const dd = parseInt(m[2], 10);
      const yyyy = m[3] ? yearOrDefault(m[3]) : undefined;
      const name = line.replace(anyDate, '').replace(/^\W+|\W+$/g, '').trim();
      if (name) {
        events.push({
          event_name: name,
          event_date: toIsoDate(mm, dd, yyyy),
          event_time: null,
          event_tag: null,
        });
      }
    }
  }
  return events;
}

// XLS/XLSX extractor: detect a date column and a name/assignment column
async function extractEventsFromExcelFile(file: File): Promise<ParsedEvent[]> {
  const { default: XLSX } = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });

  // pick first non-empty sheet
  const sheetName = wb.SheetNames.find(n => {
    const s = wb.Sheets[n];
    const rows = XLSX.utils.sheet_to_json<any[]>(s, { header: 1, raw: true });
    return rows && rows.length > 0;
  }) || wb.SheetNames[0];

  const sheet = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const events: ParsedEvent[] = [];
  const nowY = new Date().getFullYear();

  const isProbablyDate = (v: any): { mm: number; dd: number; yyyy?: number } | null => {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return { mm: v.getMonth() + 1, dd: v.getDate(), yyyy: v.getFullYear() };
    }
    const s = String(v ?? '').trim();
    const m = s.match(DATE_TOKEN);
    if (m) {
      return { mm: parseInt(m[1], 10), dd: parseInt(m[2], 10), yyyy: m[3] ? yearOrDefault(m[3]) : undefined };
    }
    return null;
  };

  // Guess columns: find first row that contains a date in any of first 3 cells
  for (const row of rows) {
    if (!row || row.length === 0) continue;

    let dateIdx = -1;
    let dateVal: { mm: number; dd: number; yyyy?: number } | null = null;

    for (let i = 0; i < Math.min(3, row.length); i++) {
      const parsed = isProbablyDate(row[i]);
      if (parsed) {
        dateIdx = i;
        dateVal = parsed;
        break;
      }
    }
    if (dateIdx === -1 || !dateVal) continue;

    // Find a name cell: first non-empty, non-date cell after date cell
    let name: string | null = null;
    for (let j = dateIdx + 1; j < row.length; j++) {
      const cell = row[j];
      if (cell == null) continue;
      const s = String(cell).trim();
      if (!s) continue;
      if (isProbablyDate(s)) continue;
      name = s;
      break;
    }
    if (!name) continue;

    events.push({
      event_name: name,
      event_date: toIsoDate(dateVal.mm, dateVal.dd, dateVal.yyyy ?? nowY),
      event_time: null,
      event_tag: null,
    });
  }

  return events;
}

// CSV extractor (simple): date in first/any column + title next
function extractEventsFromCsv(text: string): ParsedEvent[] {
  const lines = (text || '').split(/\r?\n/).filter(l => l.trim().length > 0);
  const events: ParsedEvent[] = [];
  for (const line of lines) {
    const cells = line.split(',').map(c => c.trim());
    if (cells.length < 2) continue;
    let dateIdx = -1;
    let d: { mm: number; dd: number; yyyy?: number } | null = null;
    for (let i = 0; i < Math.min(3, cells.length); i++) {
      const m = cells[i].match(DATE_TOKEN);
      if (m) {
        dateIdx = i;
        d = { mm: parseInt(m[1], 10), dd: parseInt(m[2], 10), yyyy: m[3] ? yearOrDefault(m[3]) : undefined };
        break;
      }
    }
    if (dateIdx === -1 || !d) continue;
    const name = cells.find((c, idx) => idx !== dateIdx && c && !DATE_TOKEN.test(c)) || '';
    if (!name) continue;

    events.push({
      event_name: name,
      event_date: toIsoDate(d.mm, d.dd, d.yyyy),
      event_time: null,
      event_tag: null,
    });
  }
  return events;
}

// ---------- public API ----------
export class OpenAIService {
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

    const chunks = splitTextApproxByTokens(text, CHUNK_TARGET_TOKENS);
    let totalTokens = 0;
    const allEvents: ParsedEvent[] = [];

    for (const chunk of chunks) {
      const { content, tokensUsed } = await callOpenAI(
        [
          { role: 'system', content: systemPromptBase },
          { role: 'user', content: chunk },
        ],
        600
      );
      totalTokens += tokensUsed;
      const { events } = parseJsonContent(content);
      allEvents.push(...events);
    }

    return { events: allEvents, tokensUsed: totalTokens };
  }

  static async parseFileContent(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

    const mime = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();

    // ----- Images: vision path -----
    if (mime.startsWith('image/')) {
      const base64 = await this.fileToBase64(file);
      return this.parseImage(base64);
    }

    // ----- Excel: XLS/XLSX -----
    if (
      mime.includes('spreadsheet') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls')
    ) {
      const events = await extractEventsFromExcelFile(file);
      if (events.length >= 2) return { events, tokensUsed: 0 };
      // fall back: stringify and use LLM if the sheet was weird
      const text = events.map(e => `${e.event_date} ${e.event_name}`).join('\n');
      return this.parseDocumentChunked(text);
    }

    // ----- Word: DOC/DOCX -> mammoth raw text -----
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword' ||
      name.endsWith('.docx') ||
      name.endsWith('.doc')
    ) {
      const { default: mammoth } = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer });
      const plainText = (value || '').trim();
      if (!plainText) throw new Error('No readable text found in the document.');

      const deterministic = extractEventsFromScheduleText(plainText);
      if (deterministic.length >= 2) {
        return { events: deterministic, tokensUsed: 0 };
      }
      return this.parseDocumentChunked(plainText);
    }

    // ----- CSV -----
    if (mime.includes('csv') || name.endsWith('.csv')) {
      const csvText = await file.text();
      const deterministic = extractEventsFromCsv(csvText);
      if (deterministic.length >= 2) return { events: deterministic, tokensUsed: 0 };
      return this.parseDocumentChunked(csvText);
    }

    // ----- Text -----
    if (mime === 'text/plain' || name.endsWith('.txt')) {
      const text = await file.text();
      const deterministic = extractEventsFromScheduleText(text);
      if (deterministic.length >= 2) return { events: deterministic, tokensUsed: 0 };
      return this.parseDocumentChunked(text);
    }

    // ----- PDF (best-effort) -----
    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      try {
        const plainText = await this.extractPdfText(file);
        const deterministic = extractEventsFromScheduleText(plainText);
        if (deterministic.length >= 2) return { events: deterministic, tokensUsed: 0 };
        return this.parseDocumentChunked(plainText);
      } catch (e: any) {
        throw new Error(
          'PDF parsing not available in this environment. Export your PDF to DOCX or TXT and try again.'
        );
      }
    }

    // ----- Fallback: try text() (may be garbage for binaries) -----
    const fallback = await file.text();
    if (!fallback.trim()) {
      throw new Error('Unsupported file type. Please upload DOCX, XLSX, CSV, TXT, PDF, or an image.');
    }
    const deterministic = extractEventsFromScheduleText(fallback);
    if (deterministic.length >= 2) return { events: deterministic, tokensUsed: 0 };
    return this.parseDocumentChunked(fallback);
  }

  // ---------- private helpers ----------
  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private static async parseImage(base64Image: string): Promise<ParseResult> {
    const systemPrompt = `${systemPromptBase}
Additionally:
- Only parse what is clearly visible in the image.`;

    const { content, tokensUsed } = await callOpenAI(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          ],
        },
      ],
      1000
    );

    const { events } = parseJsonContent(content);
    return { events, tokensUsed };
  }

  private static async parseDocumentChunked(text: string): Promise<ParseResult> {
    const chunks = splitTextApproxByTokens(text, CHUNK_TARGET_TOKENS);

    let totalTokens = 0;
    const allEvents: ParsedEvent[] = [];

    for (const chunk of chunks) {
      const { content, tokensUsed } = await callOpenAI(
        [
          { role: 'system', content: systemPromptBase },
          { role: 'user', content: chunk },
        ],
        900
      );
      totalTokens += tokensUsed;
      const { events } = parseJsonContent(content);
      allEvents.push(...events);
    }

    return { events: allEvents, tokensUsed: totalTokens };
  }

  private static async extractPdfText(file: File): Promise<string> {
    // Best-effort PDF text extraction with pdfjs-dist.
    // Note: In Vite/React, you may need to configure the worker:
    // import { GlobalWorkerOptions } from 'pdfjs-dist/build/pdf';
    // GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
    const pdfjs = await import('pdfjs-dist/build/pdf');
    // @ts-ignore - some bundlers need this noop if worker is already inlined
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      try {
        // Try a reasonable default; adjust path to your bundler setup if needed.
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
      } catch {}
    }

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = (pdfjs as any).getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let text = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const strings = content.items?.map((it: any) => it.str) ?? [];
      text += strings.join(' ') + '\n';
    }

    return text.trim();
  }
}

// yes, 2+2=5
