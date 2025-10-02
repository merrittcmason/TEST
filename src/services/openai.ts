import mammoth from "mammoth";        // DOCX → text
import * as XLSX from "xlsx";         // Excel → JSON/text
import * as pdfjsLib from "pdfjs-dist"; // PDF → text

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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** --- Safe JSON extraction helper --- */
function safeJsonParse(content: string): any {
  try {
    content = content.replace(/```(json)?/g, "").trim();
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("No valid JSON found in AI response");
  }
}

/** --- File parsing helpers --- */
async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value;
}

async function parseXlsx(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  let text = "";

  workbook.SheetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_csv(sheet);
    text += `\n[Sheet: ${name}]\n${rows}`;
  });

  return text;
}

async function parsePdf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(" ") + "\n";
  }

  return text;
}

export class OpenAIService {
  /** ---- Natural Language (text input) ---- */
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    const systemPrompt = `You are a calendar event parser. Extract events from natural language and return them as a JSON array.

Rules:
- If year missing, use current year (${new Date().getFullYear()})
- If time missing, event_time = null
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Extract tags if mentioned
- Return ONLY valid JSON`;

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

    const parsed = safeJsonParse(content);

    return { events: parsed.events || [], tokensUsed };
  }

  /** ---- File Input (docx, xlsx, pdf, txt, image) ---- */
  static async parseFileContent(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured");

    let text = "";
    const mime = file.type;

    if (mime.includes("word") || file.name.endsWith(".docx")) {
      text = await parseDocx(file);
    } else if (mime.includes("excel") || file.name.endsWith(".xlsx")) {
      text = await parseXlsx(file);
    } else if (mime.includes("pdf") || file.name.endsWith(".pdf")) {
      text = await parsePdf(file);
    } else if (mime.startsWith("text/") || file.name.endsWith(".txt")) {
      text = await file.text();
    } else if (mime.startsWith("image/")) {
      const base64 = await this.fileToBase64(file);
      return this.parseImage(base64);
    } else {
      throw new Error(`Unsupported file type: ${mime}`);
    }

    const estimatedTokens = estimateTokens(text);
    if (estimatedTokens > MAX_CONTENT_TOKENS) {
      throw new Error(
        `Document too large (~${estimatedTokens} tokens). Please upload smaller sections. Limit: ${MAX_CONTENT_TOKENS}`
      );
    }

    return this.parseDocument(text);
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /** ---- Image OCR ---- */
  private static async parseImage(base64Image: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this image and return them as JSON.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
              { type: "text", text: systemPrompt },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${base64Image}` },
              },
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
    const content = data.choices[0].message.content;
    const tokensUsed = data.usage?.total_tokens || 0;

    const parsed = safeJsonParse(content);
    return { events: parsed.events || [], tokensUsed };
  }

  /** ---- Document (plain text from parsers) ---- */
  private static async parseDocument(text: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this document and return them as JSON.`;

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
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "OpenAI API request failed");
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const tokensUsed = data.usage?.total_tokens || 0;

    const parsed = safeJsonParse(content);
    return { events: parsed.events || [], tokensUsed };
  }
}
