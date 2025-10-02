import mammoth from "mammoth";        // DOCX → text
import * as XLSX from "xlsx";         // Excel → text (CSV)
import * as pdfjsLib from "pdfjs-dist"; // PDF → text
import Tesseract from "tesseract.js"; // Local OCR for images

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

/** ---------- utils ---------- */
function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

/** Hardened JSON parser (used only in file-upload paths).
 *  - Strips code fences
 *  - Fixes trailing commas in objects/arrays
 *  - Extracts first {...} block as fallback
 */
function safeJsonParse(content: string): any {
  let s = (content || "").replace(/```(json)?/g, "").trim();
  const fix = (x: string) =>
    x.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  try {
    return JSON.parse(fix(s));
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No valid JSON found in AI response");
    return JSON.parse(fix(m[0]));
  }
}

/** ---------- file extractors (deterministic) ---------- */
async function extractFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return (value || "").trim();
}

async function extractFromXlsx(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  let out = "";
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv && csv.trim()) {
      out += `\n[Sheet: ${name}]\n${csv}\n`;
    }
  }
  return out.trim();
}

async function extractFromPdf(file: File): Promise<string> {
  // NOTE: In Vite you may need to set pdfjs worker. This tries CDN fallback.
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
  const result = await Tesseract.recognize(file, "eng");
  return (result?.data?.text || "").trim();
}

/** ---------- OPENAI SERVICE ---------- */
export class OpenAIService {
  /** =========================
   *  TEXT INPUT (REVERTED TO ORIGINAL)
   *  ========================= */
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = `You are a calendar event parser. Extract events from natural language and return them as a JSON array.

Current date for reference: ${new Date().toISOString().split('T')[0]}

Rules:
- If year is missing, use current year (${new Date().getFullYear()})
- If time is missing, set event_time to null (will be all-day event)
- Parse dates in format: YYYY-MM-DD
- Parse times in format: HH:MM (24-hour)
- Extract tags/categories if mentioned (e.g., "work meeting" → tag: "work")
- If no events found, return empty array

Return ONLY valid JSON in this format:
{
  "events": [
    {
      "event_name": "Meeting with team",
      "event_date": "2025-10-03",
      "event_time": "08:30",
      "event_tag": "work"
    }
  ]
}`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API request failed');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const tokensUsed = data.usage?.total_tokens || 0;

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse AI response as JSON');
        }
      }

      return {
        events: parsed.events || [],
        tokensUsed,
      };
    } catch (error: any) {
      throw new Error(error.message || 'Failed to parse natural language');
    }
  }

  /** =========================
   *  FILE UPLOADS (IMPROVED)
   *  ========================= */
  static async parseFileContent(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI API key not configured");
    }

    // Determine type -> extract plain text deterministically
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    let text = "";

    try {
      if (type.includes("word") || name.endsWith(".docx")) {
        text = await extractFromDocx(file);
      } else if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
        text = await extractFromXlsx(file);
      } else if (type.includes("pdf") || name.endsWith(".pdf")) {
        text = await extractFromPdf(file);
      } else if (type.startsWith("text/") || name.endsWith(".txt")) {
        text = await file.text();
      } else if (type.startsWith("image/")) {
        // Local OCR first to avoid token burn; if empty, fallback to vision
        text = await extractFromImageOCR(file);
        if (!text || text.length < 30) {
          const base64 = await this.fileToBase64(file);
          return this.parseImageVision(base64);
        }
      } else {
        throw new Error(`Unsupported file type: ${type || name}`);
      }
    } catch (e: any) {
      throw new Error(`Failed to read file: ${e?.message || e}`);
    }

    if (!text || !text.trim()) {
      throw new Error("No text could be extracted from the file.");
    }

    // Enforce your guardrail
    const estimatedTokens = estimateTokens(text);
    if (estimatedTokens > MAX_CONTENT_TOKENS) {
      throw new Error(
        `Document contains too much information (~${estimatedTokens} tokens). Please upload a smaller section. Maximum allowed: ${MAX_CONTENT_TOKENS} tokens.`
      );
    }

    // Single pass to the model with hardened JSON parsing
    return this.parseDocumentStrict(text);
  }

  /** ---------- helper I/O ---------- */
  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /** Vision fallback only if OCR produced nothing usable */
  private static async parseImageVision(base64Image: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this image and return ONLY valid JSON as described.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `${systemPrompt}
Rules:
- If year missing, use current year (${new Date().getFullYear()})
- If time missing, event_time = null
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- If no events, return empty array

Return JSON like:
{ "events": [ { "event_name": "...", "event_date": "YYYY-MM-DD", "event_time": null, "event_tag": null } ] }` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "OpenAI API request failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const tokensUsed = data.usage?.total_tokens || 0;

    const parsed = safeJsonParse(content);
    return { events: parsed.events || [], tokensUsed };
  }

  /** File text → JSON (strict, hardened parsing) */
  private static async parseDocumentStrict(text: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this document and return ONLY valid JSON.

Rules:
- If year missing, use current year (${new Date().getFullYear()})
- If time missing, set event_time = null (all-day)
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Tags short if mentioned else null
- If no events, return empty array

Output strictly:
{ "events": [ { "event_name": "...", "event_date": "YYYY-MM-DD", "event_time": null, "event_tag": null } ] }`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "OpenAI API request failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const tokensUsed = data.usage?.total_tokens || 0;

    const parsed = safeJsonParse(content);
    return { events: parsed.events || [], tokensUsed };
  }
}
