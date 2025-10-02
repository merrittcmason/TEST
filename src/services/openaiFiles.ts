// src/services/openaiFiles.ts
import mammoth from "mammoth";         // DOCX → text
import * as XLSX from "xlsx";          // XLS/XLSX/CSV → text
import * as pdfjsLib from "pdfjs-dist"; // PDF → text
import Tesseract from "tesseract.js";  // Local OCR for images

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
  // Hardened fallback in case JSON mode ever misbehaves
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

/* ---------- naming rules shared with textbox ---------- */
const DOCUMENT_SYSTEM_PROMPT = `You are a calendar event parser. Extract all events from the provided document and return ONLY valid JSON.

Current date for reference: ${new Date().toISOString().split('T')[0]}

Naming & Formatting Rules (critical):
- Produce a clean, professional, SHORT Title-Case name for "event_name".
- Capitalize proper nouns and significant words.
- For interviews: prefer "Company Interview" when a single company exists (e.g., "Integro Interview").
- Otherwise examples: "Physics Midterm", "CS 101 Lab", "Project Kickoff".
- Do NOT include date/time or pronouns in event_name.
- Keep event_name ≤ 50 chars; remove filler phrases.

Other Rules:
- If year is missing, use current year (${new Date().getFullYear()}).
- If time is missing, set event_time to null (all-day).
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Extract a short tag if obvious ("interview", "exam", "meeting", "class", "appointment"), else null.
- If no events found, return empty array.

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

/* ---------- deterministic extractors ---------- */
async function extractFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return (value || "").trim();
}

async function extractFromXlsx(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });

  // Convert each sheet to CSV-like lines with a header
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
  // ensure worker if needed (CDN fallback)
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

/* ---------- structured plain text normalizer ---------- */
function toStructuredPlainText(raw: string): string {
  // Collapse weird spacing, normalize bullets, keep one item per line
  const cleaned = raw
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[•●▪■]/g, "-")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // Optionally drop super-long lines that likely aren't events
  const lines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.join("\n");
}

/* ---------- OpenAI JSON-mode call ---------- */
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
            `The following is normalized plain text lines from a schedule.\n` +
            `Treat each bullet/row/line as a potential event.\n` +
            `---BEGIN---\n${userContent}\n---END---`,
        },
      ],
      temperature: 0.0,                 // deterministic
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

/* ---------- Public: route by file type ---------- */
export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();

    // 1) Deterministic extraction
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
    } else if (type.startsWith("image/")) {
      // Local OCR; if too thin, fallback to vision
      raw = await extractFromImageOCR(file);
      if (!raw || raw.length < 30) {
        return this.parseImageWithVision(file);
      }
    } else {
      throw new Error(`Unsupported file type: ${type || name}`);
    }

    if (!raw?.trim()) throw new Error("No text could be extracted from the file.");

    // 2) Normalize to structured plain text
    const structured = toStructuredPlainText(raw);

    // 3) Guardrail on size
    const estimatedTokens = estimateTokens(structured);
    if (estimatedTokens > MAX_CONTENT_TOKENS) {
      throw new Error(
        `Document contains too much information (~${estimatedTokens} tokens). Please upload a smaller section. Maximum allowed: ${MAX_CONTENT_TOKENS} tokens.`
      );
    }

    // 4) Model → JSON (same naming rules as textbox)
    const { parsed, tokensUsed } = await callOpenAI_JSONMode(
      "gpt-4o",                // or 'gpt-4o-mini' to save
      DOCUMENT_SYSTEM_PROMPT,
      structured,
      1000
    );

    return { events: parsed.events || [], tokensUsed };
  }

  private static async parseImageWithVision(file: File): Promise<ParseResult> {
    const base64 = await this.fileToBase64(file);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: DOCUMENT_SYSTEM_PROMPT },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.0,
        max_tokens: 1000,
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

    return { events: parsed.events || [], tokensUsed };
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
