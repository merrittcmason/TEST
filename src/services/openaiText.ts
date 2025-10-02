// src/services/openaiText.ts

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

// NOTE: Same endpoint/flow as your original, just stronger naming rules.
const TEXTBOX_SYSTEM_PROMPT = `You are a calendar event parser. Extract events from natural language and return them as a JSON array.

Current date for reference: ${new Date().toISOString().split('T')[0]}

Naming & Formatting Rules (critical):
- Produce a clean, professional, SHORT Title-Case name for "event_name".
- Capitalize proper nouns and significant words (Title Case).
- For interviews: prefer "Company Interview" if a single company is mentioned. Example: "Integro Interview".
- Otherwise, prefer concise patterns like "Physics Midterm", "CS 101 Lab", "Dentist Appointment", "Project Kickoff".
- Do NOT include date/time or pronouns ("I", "my") in event_name.
- Keep event_name ≤ 50 chars; drop filler like "I have", "there is".
- If no clear tag, use null.

Other Rules:
- If year is missing, use current year (${new Date().getFullYear()}).
- If time is missing, set event_time to null (all-day).
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Extract a short tag if obvious (e.g., "interview", "exam", "meeting", "class", "appointment"), else null.
- If no events found, return empty array.

Return ONLY valid JSON in this exact shape:
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

export class OpenAITextService {
  /** ORIGINAL flow: no JSON mode, keep your existing parsing fallback. */
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o', // use 'gpt-4o-mini' if you want cheaper
        messages: [
          { role: 'system', content: TEXTBOX_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error?.message || 'OpenAI API request failed');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const tokensUsed = data.usage?.total_tokens || 0;

    // Your original lenient parsing
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
  }
}
