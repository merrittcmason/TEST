// src/services/openaiFiles.ts
import mammoth from "mammoth";          // DOCX → HTML/text
import * as XLSX from "xlsx";           // XLS/XLSX/CSV → text
import * as pdfjsLib from "pdfjs-dist"; // PDF → render pages to images (no OCR lib)

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

/** -------------------- Debug plumbing -------------------- */
type AIDebugInfo = {
  model: string;
  systemPromptFirst400: string;
  userContentFirst1200?: string; // text mode
  userContentLength?: number;    // text mode
  imageCount?: number;           // vision mode
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

let lastAIDebug: AIDebugInfo | null = null;
// expose in console
// @ts-ignore
if (typeof window !== "undefined" && !(window as any).__AI_DEBUG__) {
  // @ts-ignore
  (window as any).__AI_DEBUG__ = () => lastAIDebug;
}

/** -------------------- Config -------------------- */
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const MAX_CONTENT_TOKENS = 2000;
const MAX_PDF_PAGES = 10; // limit pages we feed to vision
const VISION_MODEL = "gpt-4o";      // built-in OCR via vision
const TEXT_MODEL = "gpt-4o-mini";   // cheaper for plain text

/** -------------------- Small utils -------------------- */
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
  let line = 1, col = 1;
  for (let i = 0; i < pos && i < s.length; i++) {
    if (s[i] === "\n") { line++; col = 1; }
    else col++;
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

/** -------------------- Prompts -------------------- */
/** Text (DOCX/XLSX/TXT) — cleaned lines in, strict JSON out */
const TEXT_SYSTEM_PROMPT = `You are an event extractor for schedules and syllabi.
Input is normalized text lines (some come from flattened table rows using " | ").
Ignore noisy tokens like single-letter weekdays (M, T, W, Th, F), section/room codes, locations, instructor names, emails, and URLs.
Extract *only* dated events/assignments with concise names.

Rules:
- Output schema ONLY:
  {
    "events": [
      {
        "event_name": "Title-Case Short Name",
        "event_date": "YYYY-MM-DD",
        "event_time": "HH:MM" | null,
        "event_tag": "interview|exam|midterm|quiz|homework|assignment|class|lecture|lab|meeting|appointment|holiday|break|no_class|school_closed|other" | null
      }
    ]
  }
- Title-Case, professional, ≤ 50 chars; no dates/times/pronouns in names. Examples: "Integro Interview", "Homework 3", "Physics Midterm", "No Class (Holiday)".
- Use current year if missing (${new Date().getFullYear()}).
- Accept dates like YYYY-MM-DD, MM/DD, M/D, "Oct 5", "October 5".
- Times: "12 pm", "12:00pm", "12–1 pm", "noon"→"12:00", "midnight"→"00:00", ranges use start time.
- If text implies due/submit/turn-in and no time, use "23:59".
- If no time in the line, event_time = null.
- If a line mentions multiple items for a date, create multiple events for that date.
- Be exhaustive; do not skip minor items.

Return ONLY valid JSON. No commentary, no markdown, no trailing commas.`;

/** Vision (images/PDF → rendered images) */
const VISION_SYSTEM_PROMPT = `You are an event extractor reading schedule pages as images (use your built-in OCR).
Ignore noise: single-letter weekdays (M,T,W,Th,F), section/room codes, locations, instructor names, emails, URLs.
Extract ONLY dated events/assignments with clear names.

Follow the same schema and rules as the text prompt:
- Title-Case names, ≤ 50 chars, no dates/times/pronouns in names.
- Current year if missing (${new Date().getFullYear()}).
- Time parsing: "noon"→"12:00", "midnight"→"00:00", ranges use start.
- Due with no time → "23:59"; none → null.
- Multiple items per date → multiple events.
Return ONLY valid JSON.`;

/** Repair malformed JSON (rare with response_format, but keep as fallback) */
const REPAIR_PROMPT = `You will receive possibly malformed JSON for:
{ "events": [ { "event_name": "...", "event_date": "YYYY-MM-DD", "event_time": "HH:MM"|null, "event_tag": "..."|null } ] }
Fix ONLY syntax/shape. Do NOT add commentary. Return valid JSON exactly in that shape.`;

/** -------------------- File → data helpers -------------------- */
async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Render up to N PDF pages to JPEG data URLs (for GPT-4o vision OCR) */
async function renderPdfToImages(file: File, maxPages = MAX_PDF_PAGES, scale = 1.4): Promise<string[]> {
  // Worker (browser)
  // @ts-ignore
  if (pdfjsLib?.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      // @ts-ignore
      pdfjsLib.GlobalWorkerOptions.workerSrc =
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

/** -------------------- Extractors for non-image files -------------------- */
async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await (mammoth as any).convertToHtml({ arrayBuffer });
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const parts: string[] = [];

  // Tables → rows to single lines
  doc.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("th,td"))
        .map((c) => c.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean) as string[];
      const line = cells.join(" | ").trim();
      if (line) parts.push(line);
    });
  });

  // Lists and paragraphs
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

/** -------------------- Denoiser + normalizer -------------------- */
function denoiseLine(line: string): string {
  let s = line;

  // Remove isolated weekday tokens (M, T, Tu/Tue, W, Th/Thu, F/Fr, Sat, Sun)
  s = s.replace(
    /(^|\s)(M|T|Tu|Tue|Tues|W|Th|Thu|Thur|Thurs|F|Fr|Fri|Sat|Sun|Su)(?=\s|$)/gi,
    " "
  );

  // Drop common location/section fields (simple, conservative)
  s = s
    .replace(/\b(Sec(t(ion)?)?\.?\s*[A-Za-z0-9\-]+)\b/gi, " ")
    .replace(/\b(Room|Rm\.?|Bldg|Building|Hall|Campus|Location)\s*[:#]?\s*[A-Za-z0-9\-\.\(\)]+/gi, " ")
    .replace(/\b(Zoom|Online|In[-\s]?Person)\b/gi, " ")
    .replace(/\b(CRN|Course\s*ID)\s*[:#]?\s*[A-Za-z0-9\-]+\b/gi, " ");

  // Normalize bullets/spacing
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

/** -------------------- OpenAI calls -------------------- */
async function callOpenAI_JSON_Text(userContent: string) {
  lastAIDebug = {
    model: TEXT_MODEL,
    systemPromptFirst400: TEXT_SYSTEM_PROMPT.slice(0, 400),
    userContentFirst1200: userContent.slice(0, 1200),
    userContentLength: userContent.length,
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
            `Normalized lines below. Ignore weekday letters, rooms, sections, URLs, instructor names, etc.\n` +
            `Extract ONLY dates + event/assignment names. Multiple items per date allowed.\n` +
            `---BEGIN---\n${userContent}\n---END---`,
        },
      ],
      temperature: 0.0,
      max_tokens: 1200,
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

  lastAIDebug.rawResponseFirst2000 = content.slice(0, 2000);
  lastAIDebug.rawResponseLength = content.length;

  try {
    return { parsed: JSON.parse(content), tokensUsed };
  } catch (e: any) {
    const repaired = await repairMalformedJSON(content);
    if (repaired) return repaired;

    const msg = String(e?.message || "JSON parse error");
    const m = msg.match(/position (\d+)/i);
    const pos = m ? parseInt(m[1], 10) : undefined;

    let line: number | undefined;
    let col: number | undefined;
    let excerpt: string | undefined;

    if (typeof pos === "number") {
      const lc = positionToLineCol(content, pos);
      line = lc.line;
      col = lc.col;
      excerpt = excerptAround(content, pos);
    }

    lastAIDebug.parseError = { message: msg, pos, line, col, excerpt };
    const where = (line && col) ? ` at line ${line}, col ${col}` : "";
    const ex = excerpt ? `\n\nExcerpt around error:\n${excerpt}` : "";
    throw new Error(`AI returned malformed JSON${where}: ${msg}${ex}`);
  }
}

async function callOpenAI_JSON_Vision(imageDataUrls: string[]) {
  lastAIDebug = {
    model: VISION_MODEL,
    systemPromptFirst400: VISION_SYSTEM_PROMPT.slice(0, 400),
    imageCount: imageDataUrls.length,
  };

  const userContent: Array<any> = [
    { type: "text", text: "Read the schedule images. Ignore weekday letters, rooms, sections, URLs, instructor names, and other noise. Extract ONLY dated events/assignments with concise names. Return JSON." },
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
      max_tokens: 1400,
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

  lastAIDebug.rawResponseFirst2000 = content.slice(0, 2000);
  lastAIDebug.rawResponseLength = content.length;

  try {
    return { parsed: JSON.parse(content), tokensUsed };
  } catch (e: any) {
    const repaired = await repairMalformedJSON(content);
    if (repaired) return repaired;

    const msg = String(e?.message || "JSON parse error");
    const m = msg.match(/position (\d+)/i);
    const pos = m ? parseInt(m[1], 10) : undefined;

    let line: number | undefined;
    let col: number | undefined;
    let excerpt: string | undefined;

    if (typeof pos === "number") {
      const lc = positionToLineCol(content, pos);
      line = lc.line;
      col = lc.col;
      excerpt = excerptAround(content, pos);
    }

    lastAIDebug.parseError = { message: msg, pos, line, col, excerpt };
    const where = (line && col) ? ` at line ${line}, col ${col}` : "";
    const ex = excerpt ? `\n\nExcerpt around error:\n${excerpt}` : "";
    throw new Error(`AI returned malformed JSON${where}: ${msg}${ex}`);
  }
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

/** -------------------- Public API -------------------- */
export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();

    // IMAGES & PDFs → GPT-4o vision (built-in OCR), no Tesseract
    if (type.startsWith("image/")) {
      const url = await fileToDataURL(file);     // send image directly
      const { parsed, tokensUsed } = await callOpenAI_JSON_Vision([url]);
      let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[];
      events = postNormalizeEvents(events);
      events = dedupeEvents(events);
      return { events, tokensUsed };
    }

    if (type.includes("pdf") || name.endsWith(".pdf")) {
      const urls = await renderPdfToImages(file, MAX_PDF_PAGES, 1.5);
      if (!urls.length) throw new Error("Could not render any PDF pages.");
      const { parsed, tokensUsed } = await callOpenAI_JSON_Vision(urls);
      let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[];
      events = postNormalizeEvents(events);
      events = dedupeEvents(events);
      return { events, tokensUsed };
    }

    // DOCX/XLSX/CSV/TXT → parse text deterministically, then TEXT_MODEL
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

    const { parsed, tokensUsed } = await callOpenAI_JSON_Text(structured);
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[];

    events = postNormalizeEvents(events);
    events = dedupeEvents(events);

    return { events, tokensUsed };
  }
}
