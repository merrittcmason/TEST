const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const MODEL = "gpt-4o"
const PAGE_START = 1
const PAGE_END = 12
const MAX_TOKENS = 5000

export interface ParsedEvent {
  title: string
  location: string | null
  all_day: boolean
  start_date: string
  start_time: string | null
  end_date: string | null
  end_time: string | null
  is_recurring: boolean | null
  recurrence_rule: string | null
  label: string | null
  tag: string | null
  description: string | null
}

export interface ParseResult {
  events: ParsedEvent[]
  tokensUsed: number
}

function toTitleCase(s: string): string {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ")
}

function postNormalizeEvents(events: ParsedEvent[]): ParsedEvent[] {
  return (events || []).map(e => {
    let title = (e.title || "").trim()
    title = toTitleCase(title).replace(/\s{2,}/g, " ")
    if (title.length > 80) title = title.slice(0, 77).trimEnd() + "..."
    return { ...e, title }
  })
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>()
  const out: ParsedEvent[] = []
  for (const e of events) {
    const key = `${(e.title || "").trim().toLowerCase()}|${e.start_date}|${e.start_time ?? ""}|${e.tag ?? ""}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(e)
    }
  }
  return out
}

const SYSTEM_PROMPT = `You are an AI calendar event extractor for PDFs such as syllabi, class schedules, and event lists.
Analyze text across multiple pages and output valid JSON.

### Rules
1. Return one JSON object with the key "events", containing an array of event objects.
2. Each event must include:
   title, location, all_day, start_date, start_time, end_date, end_time, is_recurring, recurrence_rule, label, tag, description.
3. Dates must be formatted YYYY-MM-DD. If the year is missing, assume ${new Date().getFullYear()}.
4. If a time range appears (e.g., 0800–2000), capture both start_time and end_time.
5. If a date range appears (e.g., Nov 17–18), capture both start_date and end_date.
6. If an event has no explicit time, set all_day=true and both times=null.
7. If no recurrence is visible, set is_recurring=false and recurrence_rule=null.
8. If recurring is implied, fill is_recurring=true and recurrence_rule like "DAILY", "WEEKLY", etc.
9. If event's that look like assignments or due dates and have no explicit times, set start_time = "11:00" and end_time = "11:59". Do not infer or create time ranges unless explicitly shown.
10. Avoid duplicates. Normalize event names in title case.
11. If multiple tasks appear on the same line or separated by “&”, commas, or semicolons, split them into individual events, each preserving the date.
12. Return only valid JSON in the format below.

### Output format
{
  "events": [
    {
      "title": "Midterm Exam",
      "location": null,
      "all_day": false,
      "start_date": "2025-03-14",
      "start_time": "09:00",
      "end_date": "2025-03-14",
      "end_time": "11:00",
      "is_recurring": false,
      "recurrence_rule": null,
      "label": "BIO-201",
      "tag": "Exam",
      "description": null
    }
  ]
}`

async function uploadFile(file: File): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
  const form = new FormData()
  form.append("purpose", "user_data")
  form.append("file", file)
  const res = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "Failed to upload file")
  }
  const json = await res.json()
  return json.id as string
}

async function robustJsonParse(s: string): Promise<any> {
  try {
    return JSON.parse(s)
  } catch {
    const first = s.indexOf("{")
    const last = s.lastIndexOf("}")
    if (first >= 0 && last > first) {
      const slice = s.slice(first, last + 1)
      try {
        return JSON.parse(slice)
      } catch {}
    }
    const cleaned = s.replace(/,\s*([}\]])/g, "$1")
    try {
      return JSON.parse(cleaned)
    } catch {}
    const repair = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        input: [
          { role: "system", content: "Fix this text to be valid JSON matching { events: [...] }. Return only JSON." },
          { role: "user", content: s.slice(0, 8000) }
        ],
        text: { format: { type: "json_object" } }
      })
    })
    if (repair.ok) {
      const fixed = await repair.json()
      const out = fixed?.output?.[0]?.content?.[0]?.text ?? "{}"
      return JSON.parse(out)
    }
    throw new Error("Failed to parse or repair JSON")
  }
}

async function callResponsesWithFileId(file_id: string, page_start: number, page_end: number) {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        additionalProperties: false,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            location: { type: ["string", "null"] },
            all_day: { type: "boolean" },
            start_date: { type: "string" },
            start_time: { type: ["string", "null"] },
            end_date: { type: ["string", "null"] },
            end_time: { type: ["string", "null"] },
            is_recurring: { type: ["boolean", "null"] },
            recurrence_rule: { type: ["string", "null"] },
            label: { type: ["string", "null"] },
            tag: { type: ["string", "null"] },
            description: { type: ["string", "null"] }
          },
          required: [
            "title",
            "location",
            "all_day",
            "start_date",
            "start_time",
            "end_date",
            "end_time",
            "is_recurring",
            "recurrence_rule",
            "label",
            "tag",
            "description"
          ]
        }
      }
    },
    required: ["events"]
  }

  const body = {
    model: MODEL,
    temperature: 0,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "input_text", text: `Extract events from pages ${page_start}–${page_end}.` },
          { type: "input_file", file_id }
        ]
      }
    ],
    text: { format: { type: "json_schema", name: "calendar_events", schema } },
    max_output_tokens: MAX_TOKENS
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI PDF parse failed")
  }

  const data = await res.json()
  const text = data?.output?.[0]?.content?.[0]?.text ?? "{}"
  const tokensUsed = data?.usage?.total_tokens ?? 0
  const parsed = await robustJsonParse(text)
  return { parsed, tokensUsed }
}

export class OpenAIPdfService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const file_id = await uploadFile(file)
    const { parsed, tokensUsed } = await callResponsesWithFileId(file_id, PAGE_START, PAGE_END)

    const events = postNormalizeEvents(dedupeEvents(parsed?.events || []))
    events.sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        ((a.start_time || "23:59").localeCompare(b.start_time || "23:59")) ||
        a.title.localeCompare(b.title)
    )

    return { events, tokensUsed }
  }
}
