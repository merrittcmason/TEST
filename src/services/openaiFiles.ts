import mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfjsWorker;


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

type AIDebugInfo = {
  mode: "text" | "vision";
  model: string;
  batchIndex: number;
  totalBatches: number;
  systemPromptFirst400: string;
  userContentFirst1200?: string;
  userContentLength?: number;
  imageCount?: number;
  rawResponseFirst2000?: string;
  rawResponseLength?: number;
  parseError?: {
    message: string;
    pos?: number;
    line?: number;
    col?: number;
    excerpt?: string;
  };
};

let lastAIBatches: AIDebugInfo[] = [];
if (typeof window !== "undefined" && !(window as any).__AI_DEBUG__) {
  (window as any).__AI_DEBUG__ = () => lastAIBatches;
}

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const MAX_CONTENT_TOKENS = 2000;
const MAX_LINES_PER_TEXT_BATCH = 35;
const MAX_CHARS_PER_TEXT_BATCH = 1200;
const MAX_PDF_PAGES = 10;
const PDF_PAGES_PER_VISION_BATCH = 1;
const VISION_RENDER_SCALE = 1.4;
const VISION_MODEL = "gpt-4o";
const TEXT_MODEL = "gpt-4o";
const MAX_TOKENS_TEXT = 550;
const MAX_TOKENS_VISION = 650;
const BATCH_EVENT_CAP = 60;

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

function toTitleCase(s: string): string {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function postNormalizeEvents(events: ParsedEvent[]): ParsedEvent[] {
  return (events || []).map((e) => {
    let name = (e.event_name || "").trim();
    name = toTitleCase(name).replace(/\s{2,}/g, " ");
    if (name.length > 60) name = name.slice(0, 57).trimEnd() + "...";
    const event_time =
      typeof e.event_time === "string" && e.event_time.trim() === "" ? null : e.event_time;
    return {
      event_name: name,
      event_date: e.event_date,
      event_time,
      event_tag: e.event_tag ?? null,
    };
  });
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>();
  const out: ParsedEvent[] = [];
  for (const e of events) {
    const key = `${(e.event_name || "").trim().toLowerCase()}|${e.event_date}|${e.event_time ?? ""}|${e.event_tag ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

function positionToLineCol(s: string, pos: number) {
  let line = 1,
    col = 1;
  for (let i = 0; i < pos && i < s.length; i++) {
    if (s[i] === "\n") {
      line++;
      col = 1;
    } else col++;
  }
  return { line, col };
}
function excerptAround(s: string, pos: number, radius = 120) {
  const start = Math.max(0, pos - radius);
  const end = Math.min(s.length, pos + radius);
  const snippet = s.slice(start, end);
  const caret = " ".repeat(Math.max(0, pos - start)) + "^";
  return `${snippet}\n${caret}`;
}

const TEXT_SYSTEM_PROMPT = `You are an event extractor for schedules and syllabi.
Input is normalized text lines (some are flattened table rows joined with " | ").
Ignore noisy tokens like single-letter weekdays (M, T, W, Th, F), section/room codes, locations, instructor names, emails, and URLs.
Extract ONLY dated events/assignments with concise names.
Rules:
- Output schema ONLY: { "events": [ { "event_name": "Title-Case Short Name", "event_date": "YYYY-MM-DD", "event_time": "HH:MM" | null, "event_tag": "interview|exam|midterm|quiz|homework|assignment|class|lecture|lab|meeting|appointment|holiday|break|no_class|school_closed|other" | null } ] }
- Title-Case, professional, ≤ 40 chars; no dates/times/pronouns/descriptions in names. Do NOT echo source lines; do NOT include section numbers, room/location, URLs, instructor names, or extra notes in event_name.
- Use current year if missing (${new Date().getFullYear()}).
- Accept dates like YYYY-MM-DD, MM/DD, M/D, "Oct 5", "October 5".
- Times: "12 pm", "12:00pm", "12–1 pm", "noon"→"12:00", "midnight"→"00:00", ranges use start.
- If text implies due/submit/turn-in and no time, use "23:59".
- If no time in the line, event_time = null.
- If a line mentions multiple items for a date, create multiple events for that date.
- Be exhaustive; do not skip minor items.
Return ONLY valid JSON. No commentary, no markdown, no trailing commas.`;

const VISION_SYSTEM_PROMPT = `You are an event extractor reading schedule pages as images (use your built-in OCR).

Goal: OUTPUT ONLY events that have a resolvable calendar date.

How to read dates:
- Accept: 9/05, 10/2, 10-02, Oct 2, October 2, 10/2/25, 2025-10-02.
- Normalize all dates to YYYY-MM-DD. If the year is missing, use ${new Date().getFullYear()}.
- For calendar grids or tables, read month/year from headers and carry them forward until a new header appears.
- For each row/cell, if a day number or date is shown separately from the event text, associate that date with the nearby items in the same row/cell/box.
- If the date is not visible near the item, look up to the nearest date header/column heading in the same column or section.

Noise to ignore in NAMES (do NOT ignore dates): room/location strings, URLs, instructor names/emails, campus/building names, map links.

Combining vs splitting:
- If one line lists multiple sections for the SAME assignment (e.g., "Practice problems — sections 5.1 & 5.2"), create ONE event name that preserves "5.1 & 5.2".
- Split only when a line clearly has different tasks (e.g., "HW 3 due; Quiz 2").

Schema ONLY:
{
  "events": [
    {
      "event_name": "Title-Case Short Name",
      "event_date": "YYYY-MM-DD",
      "event_time": "HH:MM" | null,
      "event_tag": "interview|exam|midterm|quiz|homework|assignment|project|lab|lecture|class|meeting|office_hours|presentation|deadline|workshop|holiday|break|no_class|school_closed|other" | null
    }
  ]
}

Name rules:
- Title-Case, ≤ 40 chars, concise, no dates/times/pronouns/descriptions.
- Preserve meaningful section/chapter identifiers like "5.1 & 5.2" in the name.
Time rules:
- "noon"→"12:00", "midnight"→"00:00", ranges use start time.
- Due/submit/turn-in with no time → "23:59"; otherwise if no time, event_time = null.

CRITICAL: Every event MUST include a valid event_date. If you cannot determine a date with high confidence, SKIP that item.

Return ONLY valid JSON (no commentary, no markdown, no trailing commas).`;

const REPAIR_PROMPT = `You will receive possibly malformed JSON for:
{ "events": [ { "event_name": "...", "event_date": "YYYY-MM-DD", "event_time": "HH:MM"|null, "event_tag": "..."|null } ] }
Fix ONLY syntax/shape. Do NOT add commentary. Return valid JSON exactly in that shape.`;

async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function renderPdfToImages(file: File, maxPages = MAX_PDF_PAGES, scale = VISION_RENDER_SCALE): Promise<string[]> {
  if (pdfjsLib?.GlobalWorkerOptions && !(pdfjsLib as any).GlobalWorkerOptions.workerSrc) {
    try {
      (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    } catch {}
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await (pdfjsLib as any).getDocument({ data }).promise;
  const urls: string[] = [];
  const pages = Math.min(pdf.numPages, maxPages);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    urls.push(canvas.toDataURL("image/jpeg", 0.92));
  }
  return urls;
}

async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await (mammoth as any).convertToHtml({ arrayBuffer });
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const parts: string[] = [];
  doc.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("th,td"))
        .map((c) => c.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean) as string[];
      const line = cells.join(" | ").trim();
      if (line) parts.push(line);
    });
  });
  doc.querySelectorAll("li, p").forEach((el) => {
    const t = el.textContent?.replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
  });
  const lines = [...new Set(parts)].map((s) => s.trim()).filter(Boolean);
  return lines.join("\n");
}

async function extractTextFromXlsx(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv && csv.trim()) {
      parts.push(`[Sheet: ${name}]`);
      parts.push(csv.trim());
    }
  }
  return parts.join("\n").trim();
}

function denoiseLine(line: string): string {
  let s = line;
  s = s.replace(/(^|\s)(M|T|Tu|Tue|Tues|W|Th|Thu|Thur|Thurs|F|Fr|Fri|Sat|Sun|Su)(?=\s|$)/gi, " ");
  s = s
    .replace(/\b(Sec(t(ion)?)?\.?\s*[A-Za-z0-9\-]+)\b/gi, " ")
    .replace(/\b(Room|Rm\.?|Bldg|Building|Hall|Campus|Location)\s*[:#]?\s*[A-Za-z0-9\-\.\(\)]+/gi, " ")
    .replace(/\b(Zoom|Online|In[-\s]?Person)\b/gi, " ")
    .replace(/\b(CRN|Course\s*ID)\s*[:#]?\s*[A-Za-z0-9\-]+\b/gi, " ");
  s = s.replace(/[•●▪■]/g, "-").replace(/\s{2,}/g, " ").trim();
  return s;
}

function toStructuredPlainText(raw: string): string {
  const cleaned = (raw || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const lines = cleaned
    .split("\n")
    .map((l) => denoiseLine(l))
    .filter(Boolean);
  return lines.join("\n");
}

function chunkLines(lines: string[], maxLines: number, maxChars: number): string[] {
  const batches: string[] = [];
  let buf: string[] = [];
  let charCount = 0;
  for (const line of lines) {
    const addLen = line.length + 1;
    if (buf.length >= maxLines || charCount + addLen > maxChars) {
      batches.push(buf.join("\n"));
      buf = [];
      charCount = 0;
    }
    buf.push(line);
    charCount += addLen;
  }
  if (buf.length) batches.push(buf.join("\n"));
  return batches;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function repairMalformedJSON(bad: string): Promise<{ parsed: any; tokensUsed: number } | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: REPAIR_PROMPT },
        { role: "user", content: bad },
      ],
      temperature: 0.0,
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const tokensUsed = data?.usage?.total_tokens ?? 0;
  try {
    const parsed = JSON.parse(content);
    return { parsed, tokensUsed };
  } catch {
    return null;
  }
}

async function callOpenAI_JSON_TextBatch(
  batchText: string,
  batchIndex: number,
  totalBatches: number
): Promise<{ parsed: any; tokensUsed: number }> {
  const dbg: AIDebugInfo = {
    mode: "text",
    model: TEXT_MODEL,
    batchIndex,
    totalBatches,
    systemPromptFirst400: TEXT_SYSTEM_PROMPT.slice(0, 400),
    userContentFirst1200: batchText.slice(0, 1200),
    userContentLength: batchText.length,
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: TEXT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Batch ${batchIndex + 1}/${totalBatches}. Normalize & ignore noise (weekday letters, rooms, sections, URLs, instructor names).\n` +
            `Extract ONLY dates + event/assignment names. Multiple items per date allowed.\n` +
            `---BEGIN---\n${batchText}\n---END---`,
        },
      ],
      temperature: 0.0,
      max_tokens: MAX_TOKENS_TEXT,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "OpenAI API request failed");
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const tokensUsed = data?.usage?.total_tokens ?? 0;
  dbg.rawResponseFirst2000 = content.slice(0, 2000);
  dbg.rawResponseLength = content.length;
  try {
    const parsed = JSON.parse(content);
    lastAIBatches.push(dbg);
    return { parsed, tokensUsed };
  } catch (e: any) {
    const repaired = await repairMalformedJSON(content);
    if (repaired) {
      lastAIBatches.push(dbg);
      return { parsed: repaired.parsed, tokensUsed: tokensUsed + repaired.tokensUsed };
    }
    const msg = String(e?.message || "JSON parse error");
    const m = msg.match(/position (\d+)/i);
    const pos = m ? parseInt(m[1], 10) : undefined;
    if (typeof pos === "number") {
      const lc = positionToLineCol(content, pos);
      dbg.parseError = {
        message: msg,
        pos,
        line: lc.line,
        col: lc.col,
        excerpt: excerptAround(content, pos),
      };
    } else {
      dbg.parseError = { message: msg };
    }
    lastAIBatches.push(dbg);
    throw new Error(`Batch ${batchIndex + 1}/${totalBatches} JSON error: ${msg}`);
  }
}

async function callOpenAI_JSON_VisionBatch(
  imageDataUrls: string[],
  batchIndex: number,
  totalBatches: number
): Promise<{ parsed: any; tokensUsed: number }> {
  const dbg: AIDebugInfo = {
    mode: "vision",
    model: VISION_MODEL,
    batchIndex,
    totalBatches,
    systemPromptFirst400: VISION_SYSTEM_PROMPT.slice(0, 400),
    imageCount: imageDataUrls.length,
  };
  const userContent: Array<any> = [
    {
      type: "text",
      text:
        "Extract events WITH DATES from these schedule images. Every event MUST have event_date in YYYY-MM-DD. " +
        "Use headers/column/cell context to resolve dates; if still unknown, omit the item. " +
        "Normalize US-style dates and carry forward month/year from headings. Preserve section identifiers like 5.1 & 5.2 in the event_name.",
    },
  ];
  for (const url of imageDataUrls) userContent.push({ type: "image_url", image_url: { url } });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.0,
      max_tokens: MAX_TOKENS_VISION,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "OpenAI API request failed");
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const tokensUsed = data?.usage?.total_tokens ?? 0;
  dbg.rawResponseFirst2000 = content.slice(0, 2000);
  dbg.rawResponseLength = content.length;
  try {
    const parsed = JSON.parse(content);
    let events = (parsed.events || []) as ParsedEvent[];
    events = events.filter(
      (e) => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date)
    );
    lastAIBatches.push(dbg);
    return { parsed: { events }, tokensUsed };
  } catch (e: any) {
    const repaired = await repairMalformedJSON(content);
    if (repaired) {
      let events = (repaired.parsed.events || []) as ParsedEvent[];
      events = events.filter(
        (ev) => typeof ev.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ev.event_date)
      );
      lastAIBatches.push(dbg);
      return { parsed: { events }, tokensUsed: tokensUsed + (repaired.tokensUsed || 0) };
    }
    const msg = String(e?.message || "JSON parse error");
    const m = msg.match(/position (\d+)/i);
    const pos = m ? parseInt(m[1], 10) : undefined;
    if (typeof pos === "number") {
      const lc = positionToLineCol(content, pos);
      dbg.parseError = {
        message: msg,
        pos,
        line: lc.line,
        col: lc.col,
        excerpt: excerptAround(content, pos),
      };
    } else {
      dbg.parseError = { message: msg };
    }
    lastAIBatches.push(dbg);
    throw new Error(`Vision batch ${batchIndex + 1}/${totalBatches} JSON error: ${msg}`);
  }
}

export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");
    lastAIBatches = [];
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();

    if (type.startsWith("image/")) {
      const url = await fileToDataURL(file);
      const { parsed, tokensUsed } = await callOpenAI_JSON_VisionBatch([url], 0, 1);
      let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[];
      events = postNormalizeEvents(events);
      events = dedupeEvents(events);
      return { events, tokensUsed };
    }

    if (type.includes("pdf") || name.endsWith(".pdf")) {
      const urls = await renderPdfToImages(file, MAX_PDF_PAGES, VISION_RENDER_SCALE);
      if (!urls.length) throw new Error("Could not render any PDF pages.");
      const pageBatches = chunkArray(urls, PDF_PAGES_PER_VISION_BATCH);
      let tokens = 0;
      let allEvents: ParsedEvent[] = [];
      for (let i = 0; i < pageBatches.length; i++) {
        const { parsed, tokensUsed } = await callOpenAI_JSON_VisionBatch(pageBatches[i], i, pageBatches.length);
        tokens += tokensUsed;
        const evs = (parsed.events || []) as ParsedEvent[];
        const evsCapped = evs.slice(0, BATCH_EVENT_CAP);
        allEvents.push(...evsCapped);
      }
      allEvents = postNormalizeEvents(allEvents);
      allEvents = dedupeEvents(allEvents);
      return { events: allEvents, tokensUsed: tokens };
    }

    let raw = "";
    if (type.includes("word") || name.endsWith(".docx")) {
      raw = await extractTextFromDocx(file);
    } else if (
      type.includes("excel") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv")
    ) {
      raw = await extractTextFromXlsx(file);
    } else if (type.startsWith("text/") || name.endsWith(".txt")) {
      raw = await file.text();
    } else {
      throw new Error(`Unsupported file type: ${type || name}`);
    }

    if (!raw?.trim()) throw new Error("No text could be extracted from the file.");

    const structured = toStructuredPlainText(raw);
    const estimatedTokens = estimateTokens(structured);
    if (estimatedTokens > MAX_CONTENT_TOKENS) {
      throw new Error(
        `Document contains too much information (~${estimatedTokens} tokens). Please upload a smaller section. Maximum allowed: ${MAX_CONTENT_TOKENS} tokens.`
      );
    }

    const lines = structured.split("\n");
    const batches = chunkLines(lines, MAX_LINES_PER_TEXT_BATCH, MAX_CHARS_PER_TEXT_BATCH);

    let tokens = 0;
    let allEvents: ParsedEvent[] = [];
    for (let i = 0; i < batches.length; i++) {
      const { parsed, tokensUsed } = await callOpenAI_JSON_TextBatch(batches[i], i, batches.length);
      tokens += tokensUsed;
      const evs = (parsed.events || []) as ParsedEvent[];
      const evsCapped = evs.slice(0, BATCH_EVENT_CAP);
      allEvents.push(...evsCapped);
    }

    allEvents = postNormalizeEvents(allEvents);
    allEvents = dedupeEvents(allEvents);
    return { events: allEvents, tokensUsed: tokens };
  }
}
