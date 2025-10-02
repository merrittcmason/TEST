import mammoth from "mammoth";          // DOCX → text
import * as XLSX from "xlsx";           // XLS/XLSX/CSV → text
import * as pdfjsLib from "pdfjs-dist"; // PDF → text
import Tesseract from "tesseract.js";   // Local OCR for images

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

/* ---------- utils ---------- */
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

/* ---------- prompts ---------- */
const BASE_RULES = `
Naming & Formatting (critical):
- "event_name" must be short, professional, and Title Case. Capitalize proper nouns.
- Prefer patterns like "Integro Interview", "Physics Midterm", "Dentist Appointment", "Project Kickoff".
- Do NOT include date/time or pronouns in event_name. ≤ 50 chars. Remove filler.
- If no obvious tag, use null. Common tags: interview, exam, quiz, meeting, class, appointment, lab.

Parsing:
- If year missing, use current year (${new Date().getFullYear()}).
- Dates may appear as YYYY-MM-DD, MM/DD[/YY], M/D, Month D, Mon D, or "Oct 5", "October 5".
- Times may appear as "12 pm", "12:00pm", "12-1 pm", "noon", "8:30 am". Convert to 24-hour "HH:MM".
- If time missing, event_time = null (all-day).
- If no events found, return empty array.
`;

const DOCUMENT_SYSTEM_PROMPT = `You are a calendar event parser. Extract events from the provided text lines and return ONLY valid JSON.

Current date: ${new Date().toISOString().split("T")[0]}
${BASE_RULES}

Return JSON exactly like:
{
  "events": [
    {
      "event_name": "Integro Interview",
      "event_date": "2025-10-05",
      "event_time": "12:00",
      "event_tag": "interview"
    }
  ]
}`;

const FALLBACK_SYSTEM_PROMPT = `You are a calendar event parser. The user content is noisy structured text (rows/bullets). Scan aggressively for date/time expressions and synthesize concise events.

Current date: ${new Date().toISOString().split("T")[0]}
${BASE_RULES}

Heuristics:
- Lines containing due/due date, exam, quiz, midterm, class, lecture, lab, meeting, interview, appointment are likely events.
- Combine adjacent context if needed (e.g., course code on one line, date on the next).
- If a range is detected like "12–1 pm", pick the start time "12:00" (still HH:MM).
- Ignore grading rubrics, policies, long prose without dates.

Return JSON exactly like the previous format.`;

/* ---------- deterministic extractors ---------- */
async function extractFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return (value || "").trim();
}

async function extractFromXlsx(file: File): Promise<string> {
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

async function extractFromPdf(file: File): Promise<string> {
  // Worker fallback for Vite/browser
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
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items || []).map((it: any) => it.str).join(" ");
    text += pageText + "\n";
  }
  return text.trim();
}

async function extractFromImageOCR(file: File): Promise<string> {
  const res = await Tesseract.recognize(file, "eng");
  return (res?.data?.text || "").trim();
}

/* ---------- normalizer ---------- */
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
    .map(l => l.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);

  return lines.join("\n");
}

/* ---------- OpenAI helpers (JSON mode) ---------- */
async function callOpenAI_JSONMode(
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number
) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `The following are normalized plain text lines from a schedule.\n` +
            `Treat each bullet/row/line as a potential event.\n` +
            `---BEGIN---\n${userContent}\n---END---`,
        },
      ],
      temperature: 0.0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" }, // force strict JSON
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || "OpenAI API request failed");
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const tokensUsed = data?.usage?.total_tokens ?? 0;

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = safeJsonParse(content);
  }
  return { parsed, tokensUsed };
}

async function callOpenAI_Vision_JSON(
  model: string,
  systemPrompt: string,
  base64Jpeg: string,
  maxTokens: number
) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: systemPrompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Jpeg}` } },
          ],
        },
      ],
      temperature: 0.0,
      max_tokens: maxTokens,
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

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = safeJsonParse(content);
  }
  return { parsed, tokensUsed };
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- Public API ---------- */
export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();

    // IMAGES: OCR → model; if empty, force Vision
    if (type.startsWith("image/")) {
      let totalTokens = 0;
      let events: ParsedEvent[] = [];

      // 1) Local OCR → structured → JSON mode
      try {
        const ocr = await extractFromImageOCR(file);
        if (ocr && ocr.length >= 10) {
          const structured = toStructuredPlainText(ocr);
          if (estimateTokens(structured) <= MAX_CONTENT_TOKENS) {
            const { parsed, tokensUsed } = await callOpenAI_JSONMode(
              "gpt-4o", DOCUMENT_SYSTEM_PROMPT, structured, 900
            );
            events = (parsed.events || []) as ParsedEvent[];
            totalTokens += tokensUsed;
          }
        }
      } catch {
        // ignore OCR failures, fall through to vision
      }

      // 2) If nothing useful, Vision pass (always allowed)
      if (events.length === 0) {
        const b64 = await fileToBase64(file);
        const { parsed, tokensUsed } = await callOpenAI_Vision_JSON(
          "gpt-4o", DOCUMENT_SYSTEM_PROMPT, b64, 1000
        );
        events = (parsed.events || []) as ParsedEvent[];
        totalTokens += tokensUsed;
      }

      return { events: dedupeEvents(events), tokensUsed: totalTokens };
    }

    // DOCS: deterministic parse → structured → JSON mode (retry with fallback if empty)
    let raw = "";
    if (type.includes("word") || name.endsWith(".docx")) {
      raw = await extractFromDocx(file);
    } else if (
      type.includes("excel") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv")
    ) {
      raw = await extractFromXlsx(file);
    } else if (type.includes("pdf") || name.endsWith(".pdf")) {
      raw = await extractFromPdf(file);
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

    // First pass: main prompt
    const { parsed: parsed1, tokensUsed: t1 } = await callOpenAI_JSONMode(
      "gpt-4o", DOCUMENT_SYSTEM_PROMPT, structured, 1000
    );
    let events: ParsedEvent[] = (parsed1.events || []) as ParsedEvent[];
    let totalTokens = t1;

    // Fallback: aggressive date scanner if empty
    if (events.length === 0) {
      const { parsed: parsed2, tokensUsed: t2 } = await callOpenAI_JSONMode(
        "gpt-4o", FALLBACK_SYSTEM_PROMPT, structured, 1000
      );
      events = (parsed2.events || []) as ParsedEvent[];
      totalTokens += t2;
    }

    return { events: dedupeEvents(events), tokensUsed: totalTokens };
  }
}
