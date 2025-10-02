// src/services/openaiFiles.ts
import mammoth from "mammoth";            // DOCX → HTML/text
import * as XLSX from "xlsx";             // XLS/XLSX/CSV → text
import * as pdfjsLib from "pdfjs-dist";   // PDF → page rendering
import Tesseract from "tesseract.js";     // OCR for images & rendered PDF pages

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
const MAX_CONTENT_TOKENS = 2000;
const MAX_PDF_PAGES = 20;         // guardrail for very large PDFs
const OCR_DPI_SCALE = 1.5;        // PDF render scale for decent OCR quality

/* -------------------- utils -------------------- */
function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

function safeJsonParse(content: string): any {
  let s = (content || "").replace(/```(json)?/g, "").trim();
  const fix = (x: string) => x.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  try {
    return JSON.parse(fix(s));
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No valid JSON found in AI response");
    return JSON.parse(fix(m[0]));
  }
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

    // Normalize time field: "" -> null
    const event_time =
      typeof e.event_time === "string" && e.event_time.trim() === ""
        ? null
        : e.event_time;

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

/* -------------------- prompts -------------------- */
const EXTRACT_ALL_PROMPT = `You are an expert schedule harvester. Input is OCR text from a syllabus or business/class schedule (tables may be flattened as lines, sometimes using " | " between cells).

Your job: MAXIMUM RECALL. Extract EVERY dated item: homework, assignments, quizzes, exams, labs, classes, meetings, interviews, office hours, holidays, breaks, "no class"/school closed—everything. If a single date has multiple items, create multiple events.

Output rules:
- Schema ONLY:
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
- Accept dates like "YYYY-MM-DD", "MM/DD", "M/D", "Oct 5", "October 5".
- Times: parse "12 pm", "12:00pm", "12–1 pm", "noon", "midnight", "11:59 pm". Convert to 24-hour "HH:MM".
  - "noon" → "12:00"
  - "midnight" → "00:00"
  - ranges use START time (e.g., "12–1 pm" → "12:00")
  - if text says due/submit/turn-in but NO time → "23:59"
- If no time at all → event_time = null (all-day).
- If a line contains multiple items (e.g., "HW 3 due; Quiz 2") → create multiple events with the SAME date.
- Prefer a specific tag if obvious; else null.
- Be comprehensive—DO NOT skip minor items.
Return ONLY valid JSON—no commentary, no markdown, no trailing commas.`;

/* -------------------- OCR paths -------------------- */
async function ocrFromImageFile(file: File): Promise<string> {
  const res = await Tesseract.recognize(file, "eng");
  return (res?.data?.text || "").trim();
}

async function ocrFromPdf(file: File): Promise<string> {
  // Set worker (browser) if missing
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

  let text = "";
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);

  // Reusable canvas for rendering
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: OCR_DPI_SCALE });

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({ canvasContext: ctx as any, viewport }).promise;

    // Tesseract supports HTMLCanvasElement directly
    const result = await Tesseract.recognize(canvas, "eng");
    if (result?.data?.text) {
      text += result.data.text + "\n";
    }
  }

  return text.trim();
}

/* -------------------- non-OCR extractors (browser-friendly) -------------------- */
async function extractTextFromDocx(file: File): Promise<string> {
  // Convert to HTML, then flatten tables into "cell | cell | cell" lines + body text
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await (mammoth as any).convertToHtml({ arrayBuffer });
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const parts: string[] = [];

  // Tables → rows
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

/* -------------------- normalizer -------------------- */
function toStructuredPlainText(raw: string): string {
  const cleaned = (raw || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[•●▪■]/g, "-")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  const lines = cleaned
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);

  return lines.join("\n");
}

/* -------------------- OpenAI (JSON mode) -------------------- */
async function callOpenAI_JSONMode(
  userContent: string
): Promise<{ parsed: any; tokensUsed: number }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EXTRACT_ALL_PROMPT },
        {
          role: "user",
          content:
            `The following are normalized OCR/text lines. Treat each row/line as potentially containing one or more events.\n` +
            `Create multiple events for the same date if needed.\n` +
            `---BEGIN---\n${userContent}\n---END---`,
        },
      ],
      temperature: 0.0, // deterministic
      max_tokens: 1200,
      response_format: { type: "json_object" }, // strict JSON
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "OpenAI API request failed");
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const tokensUsed = data?.usage?.total_tokens ?? 0;

  const parsed = safeJsonParse(content);
  return { parsed, tokensUsed };
}

/* -------------------- Public API -------------------- */
export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();

    let raw = "";

    if (type.startsWith("image/")) {
      // Pure OCR for images
      raw = await ocrFromImageFile(file);
    } else if (type.includes("pdf") || name.endsWith(".pdf")) {
      // Render PDF → OCR page images
      raw = await ocrFromPdf(file);
    } else if (type.includes("word") || name.endsWith(".docx")) {
      // Browser can’t “image” Word; parse text deterministically
      raw = await extractTextFromDocx(file);
    } else if (
      type.includes("excel") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv")
    ) {
      // Same for spreadsheets
      raw = await extractTextFromXlsx(file);
    } else if (type.startsWith("text/") || name.endsWith(".txt")) {
      raw = await file.text();
    } else {
      throw new Error(`Unsupported file type: ${type || name}`);
    }

    if (!raw?.trim()) {
      throw new Error("No text could be extracted from the file.");
    }

    const structured = toStructuredPlainText(raw);
    const estimatedTokens = estimateTokens(structured);
    if (estimatedTokens > MAX_CONTENT_TOKENS) {
      throw new Error(
        `Document contains too much information (~${estimatedTokens} tokens). Please upload a smaller section. Maximum allowed: ${MAX_CONTENT_TOKENS} tokens.`
      );
    }

    const { parsed, tokensUsed } = await callOpenAI_JSONMode(structured);
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[];

    events = postNormalizeEvents(events);
    events = dedupeEvents(events);

    return { events, tokensUsed };
  }
}
