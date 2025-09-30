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

export class OpenAIService {
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

      let parsed;
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

  static async parseFileContent(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const isImage = file.type.startsWith('image/');

    if (isImage) {
      const base64 = await this.fileToBase64(file);
      return this.parseImage(base64);
    } else {
      const text = await file.text();
      const estimatedTokens = estimateTokens(text);

      if (estimatedTokens > MAX_CONTENT_TOKENS) {
        throw new Error(
          `Document contains too much information (approximately ${estimatedTokens} tokens). Please upload a single schedule or smaller section. Maximum allowed: ${MAX_CONTENT_TOKENS} tokens.`
        );
      }

      return this.parseDocument(text);
    }
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private static async parseImage(base64Image: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this image and return them as JSON.

Current date for reference: ${new Date().toISOString().split('T')[0]}

Rules:
- Extract all visible events/schedules
- If year is missing, use current year (${new Date().getFullYear()})
- If time is missing, set event_time to null
- Parse dates in format: YYYY-MM-DD
- Parse times in format: HH:MM (24-hour)
- Extract tags/categories if visible
- If no events found, return empty array
- DO NOT extract events if the image contains more than one schedule document or page

Return ONLY valid JSON in this format:
{
  "events": [
    {
      "event_name": "Meeting",
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
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: systemPrompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API request failed');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const tokensUsed = data.usage?.total_tokens || 0;

      const estimatedContentTokens = estimateTokens(content);
      if (estimatedContentTokens > MAX_CONTENT_TOKENS) {
        throw new Error(
          `Image contains too much information. Please take a photo of a single schedule only. Detected approximately ${estimatedContentTokens} tokens worth of content.`
        );
      }

      let parsed;
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
      throw new Error(error.message || 'Failed to parse image');
    }
  }

  private static async parseDocument(text: string): Promise<ParseResult> {
    const systemPrompt = `You are a calendar event parser. Extract events from this document and return them as JSON.

Current date for reference: ${new Date().toISOString().split('T')[0]}

Rules:
- Extract all events/schedules from the document
- If year is missing, use current year (${new Date().getFullYear()})
- If time is missing, set event_time to null
- Parse dates in format: YYYY-MM-DD
- Parse times in format: HH:MM (24-hour)
- Extract tags/categories if mentioned
- If no events found, return empty array

Return ONLY valid JSON in this format:
{
  "events": [
    {
      "event_name": "Meeting",
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
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API request failed');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const tokensUsed = data.usage?.total_tokens || 0;

      let parsed;
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
      throw new Error(error.message || 'Failed to parse document');
    }
  }
}
