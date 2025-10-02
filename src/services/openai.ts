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
    // Strip markdown fences
    content = content.replace(/```(json)?/g, "").trim();

    // Try direct parse
    return JSON.parse(content);
  } catch {
    // Fallback: extract first { ... } block
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        throw new Error("Failed to parse AI response as JSON");
      }
    }
    throw new Error("No valid JSON found in AI response");
  }
}

export class OpenAIService {
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI API key not configured");
    }

    const systemPrompt = `You are a calendar event parser. Extract events from natural language and return them as a JSON array.

Current date: ${new Date().toISOString().split("T")[0]}
Rules:
- If year is missing, use current year (${new Date().getFullYear()})
- If time is missing, set event_time to null
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Extract tags/categories if mentioned
- If no events found, return empty array
Return ONLY valid JSON:
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

    return {
      events: parsed.events || [],
      tokensUsed,
    };
  }

  static async parseFileContent(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI API key not configured");
    }

    const isImage = file.type.startsWith("image/");

    if (isImage) {
      const base64 = await this.fileToBase64(file);
      return this.parseImage(base64);
    } else {
      const text = await file.text();
      const estimatedTokens = estimateTokens(text);

      if (estimatedTokens > MAX_CONTENT_TOKENS) {
        throw new Error(
          `Document contains too much information (~${estimatedTokens} tokens). Please upload a smaller section. Limit: ${MAX_CONTENT_TOKENS} tokens.`
        );
      }

      return this.parseDocument(text);
    }
  }

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

  private static async parseImage(base64Image: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this image and return them as JSON.

Current date: ${new Date().toISOString().split("T")[0]}
Rules:
- Extract all visible events
- If year missing, use current year (${new Date().getFullYear()})
- If time missing, set event_time = null
- Dates: YYYY-MM-DD
- Times: HH:MM
- If no events, return empty array
Return ONLY valid JSON.`;

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

    return {
      events: parsed.events || [],
      tokensUsed,
    };
  }

  private static async parseDocument(text: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this document and return them as JSON.

Current date: ${new Date().toISOString().split("T")[0]}
Rules:
- Extract all events from the doc
- If year missing, use current year (${new Date().getFullYear()})
- If time missing, set event_time = null
- Dates: YYYY-MM-DD
- Times: HH:MM
- If no events, return empty array
Return ONLY valid JSON.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
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

    return {
      events: parsed.events || [],
      tokensUsed,
    };
  }
}
