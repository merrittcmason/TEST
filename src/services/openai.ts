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

// soft budget + chunking target
const MAX_CONTENT_TOKENS = 2000;       // keep for guardrails/messages
const CHUNK_TARGET_TOKENS = 1500;      // send ~1.5k tokens per call
const CHARS_PER_TOKEN = 4;             // sane approx for English

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function splitTextApproxByTokens(text: string, maxTokens: number): string[] {
  const maxChars = Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN));
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    // try to cut at a newline/space for nicer boundaries
    let cut = end;
    const slice = text.slice(start, end);
    const lastNewline = slice.lastIndexOf('\n');
    const lastSpace = slice.lastIndexOf(' ');
    if (lastNewline > maxChars * 0.6) cut = start + lastNewline;
    else if (lastSpace > maxChars * 0.6) cut = start + lastSpace;

    chunks.push(text.slice(start, cut));
    start = cut;
    // skip whitespace at the boundary
    while (start < text.length && /\s/.test(text[start])) start++;
  }

  return chunks.filter(c => c.trim().length > 0);
}

async function callOpenAI(messages: any[], max_tokens = 800) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.1,
      max_tokens,
    }),
  });

  if (!response.ok) {
    let msg = 'OpenAI API request failed';
    try {
      const err = await response.json();
      msg = err.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const tokensUsed = data.usage?.total_tokens ?? 0;
  return { content, tokensUsed };
}

function parseJsonContent(raw: string): { events: ParsedEvent[] } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Failed to parse AI response as JSON');
    parsed = JSON.parse(m[0]);
  }
  const events: ParsedEvent[] = Array.isArray(parsed?.events) ? parsed.events : [];
  return { events };
}

const systemPromptBase = `You are a calendar event parser. Extract events and return strict JSON.

Current date for reference: ${new Date().toISOString().split('T')[0]}

Rules:
- If year is missing, use current year (${new Date().getFullYear()})
- If time is missing, set event_time to null (all-day)
- Dates: YYYY-MM-DD
- Times: HH:MM (24-hour)
- Extract short tags if mentioned (e.g., "work", "school"). If none, use null.
- If no events found, return an empty array.

Return ONLY valid JSON exactly like:
{
  "events": [
    { "event_name": "Meeting", "event_date": "2025-10-03", "event_time": "08:30", "event_tag": "work" }
  ]
}
`;

// ---------- PUBLIC API ----------
export class OpenAIService {
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

    const chunks = splitTextApproxByTokens(text, CHUNK_TARGET_TOKENS);
    let totalTokens = 0;
    const allEvents: ParsedEvent[] = [];

    for (const chunk of chunks) {
      const { content, tokensUsed } = await callOpenAI(
        [
          { role: 'system', content: systemPromptBase },
          { role: 'user', content: chunk },
        ],
        600
      );
      totalTokens += tokensUsed;
      const { events } = parseJsonContent(content);
      allEvents.push(...events);
    }

    return { events: allEvents, tokensUsed: totalTokens };
  }

  static async parseFileContent(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

    const mime = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();

    const isImage = mime.startsWith('image/');
    if (isImage) {
      const base64 = await this.fileToBase64(file);
      return this.parseImage(base64);
    }

    // ----- DOC/DOCX: use mammoth to extract only visible text -----
    const isDocx =
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx');
    const isDoc = mime === 'application/msword' || name.endsWith('.doc');

    let plainText = '';

    if (isDocx || isDoc) {
      const { default: mammoth } = await import('mammoth'); // dynamic import
      const arrayBuffer = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer });
      plainText = (value || '').trim();
      if (!plainText) throw new Error('No readable text found in the document.');
    } else if (mime === 'text/plain' || name.endsWith('.txt')) {
      plainText = await file.text();
    } else if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      // Keep simple: advise to export as DOCX or TXT for now (PDF parsing is another pipeline).
      throw new Error('PDF parsing not yet supported. Export the PDF to DOCX or TXT and try again.');
    } else {
      // Fallback: try text() (will be garbage for binary formats)
      plainText = await file.text();
    }

    // Soft guardrail: tell user if the doc is huge, but continue with chunking anyway.
    const est = estimateTokens(plainText);
    if (est > MAX_CONTENT_TOKENS) {
      // Don’t throw; just inform via error text if you prefer. Here we proceed thanks to chunking.
      console.warn(
        `Large document (~${est} tokens). Proceeding with chunking to stay under limits.`
      );
    }

    return this.parseDocumentChunked(plainText);
  }

  // ---------- PRIVATE HELPERS ----------
  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private static async parseImage(base64Image: string): Promise<ParseResult> {
    const systemPrompt = `${systemPromptBase}
Additionally:
- Only parse what is clearly visible in the image.`;

    const { content, tokensUsed } = await callOpenAI(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          ],
        },
      ],
      1000
    );

    const { events } = parseJsonContent(content);
    return { events, tokensUsed };
  }

  private static async parseDocumentChunked(text: string): Promise<ParseResult> {
    const chunks = splitTextApproxByTokens(text, CHUNK_TARGET_TOKENS);

    let totalTokens = 0;
    const allEvents: ParsedEvent[] = [];

    for (const chunk of chunks) {
      const { content, tokensUsed } = await callOpenAI(
        [
          { role: 'system', content: systemPromptBase },
          { role: 'user', content: chunk },
        ],
        900
      );
      totalTokens += tokensUsed;
      const { events } = parseJsonContent(content);
      allEvents.push(...events);
    }

    return { events: allEvents, tokensUsed: totalTokens };
  }
}
