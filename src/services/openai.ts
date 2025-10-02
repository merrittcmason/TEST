import mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import Tesseract from "tesseract.js";

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

// ---------------- Helpers ----------------
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkText(text: string, maxTokens: number = MAX_CONTENT_TOKENS): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current: string[] = [];
  let tokenCount = 0;

  for (const word of words) {
    const est = Math.ceil(word.length / 4);
    if (tokenCount + est > maxTokens) {
      chunks.push(current.join(" "));
      current = [word];
      tokenCount = est;
    } else {
      current.push(word);
      tokenCount += est;
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>();
  const unique: ParsedEvent[] = [];

  for (const ev of events) {
    const key = `${ev.event_name.toLowerCase()}|${ev.event_date}|${ev.event_time ?? ""}|${ev.event_tag ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(ev);
    }
  }
  return unique;
}

// ---------------- File Extraction ----------------
async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value;
  }

  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    return workbook.SheetNames.map((name) =>
      XLSX.utils.sheet_to_csv(workbook.Sheets[name])
    ).join("\n");
  }

  if (ext === "pdf") {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => it.str).join(" ") + "\n";
    }
    return text;
  }

  if (file.type.startsWith("image/")) {
    const { data: { text } } = await Tesseract.recognize(file, "eng");
    return text;
  }

  // fallback: plain text
  return await file.text();
}

// ---------------- OpenAI Service ----------------
export class OpenAIService {
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const systemPrompt = `You are a calendar event parser. Extract events from natural language and return them as a JSON array.

Current date: ${new Date().toISOString().split("T")[0]}

Rules:
- If year missing, assume ${new Date().getFullYear()}
- If time missing, set event_time = null
- Date format: YYYY-MM-DD
- Time format: HH:MM (24h)
- Tags short/simple if mentioned
- If no events, return empty array`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "OpenAI API request failed");
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const tokensUsed = data.usage?.total_tokens || 0;

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { events: [] };
      }

      return { events: parsed.events || [], tokensUsed };
    } catch (error: any) {
      throw new Error(error.message || "Failed to parse natural language");
    }
  }

  static async parseFileContent(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const text = await extractTextFromFile(file);
    if (!text.trim()) throw new Error("No text extracted from file");

    const chunks = chunkText(text);
    let allEvents: ParsedEvent[] = [];
    let totalTokens = 0;

    for (const chunk of chunks) {
      const result = await this.parseDocument(chunk);
      allEvents = [...allEvents, ...result.events];
      totalTokens += result.tokensUsed;
    }

    const deduped = dedupeEvents(allEvents);

    return { events: deduped, tokensUsed: totalTokens };
  }

  private static async parseDocument(text: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this document and return them as JSON.

Current date: ${new Date().toISOString().split("T")[0]}

Rules:
- Extract all events/schedules
- If year missing, assume ${new Date().getFullYear()}
- If time missing, set event_time = null
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Tags: short category if mentioned, else null
- If no events, return empty array`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
          temperature: 0.1,
          max_tokens: 700,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "OpenAI API request failed");
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const tokensUsed = data.usage?.total_tokens || 0;

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { events: [] };
      }

      return { events: parsed.events || [], tokensUsed };
    } catch (error: any) {
      throw new Error(error.message || "Failed to parse document");
    }
  }
}
