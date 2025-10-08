const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const MODEL = "gpt-4o-mini"
const PAGE_START = 1
const PAGE_END = 12

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
  return (s || "").trim().replace(/\s+/g, " ").split(" ").map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ")
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

const SYSTEM_PROMPT = `Given a user-uploaded document or image (such as a calendar, class schedule, assignment list, or event summary), extract individual events and produce a structured list with complete event details. These sources may be malformed, messy, or inconsistent, so carefully normalize, repair, and interpret the content to maximize accurate event extraction.

Your main objectives:
- Parse and reconstruct as many accurate, individual calendar events as possible, even from malformed or visually challenging data, by using robust inference and context clues.
- For each event, fill in the following fields: title, location, all_day, start_date, start_time, end_date, end_time, is_recurring, recurrence_rule, label, tag, and description. If the information is missing or ambiguous, set the field to \`null\` or an empty string where appropriate.
- If the input is a student schedule of assignments that lacks explicit times, assume assignments are due at 23:59 (11:59 PM).
- Split compound entries (e.g., a single row for "Practice problems-sections 1.6, 1.7 & Lab-Algebra review") into multiple separate events—one for each distinct activity or section.
- Carefully generate event titles based on input (e.g., “Interview with Google”, “Practice Problems Section 1.6”) and infer logical tags (e.g., “Lab”, “Quiz”, “Exam”) and labels (e.g., course or company names) as specified below.

# Event Field Definitions
(title, location, all_day, start_date, start_time, end_date, end_time, is_recurring, recurrence_rule, label, tag, description)

# Output Format
Return ONLY a JSON array of event objects matching these fields.`

const EVENT_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
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
        required: ["title","location","all_day","start_date","start_time","end_date","end_time","is_recurring","recurrence_rule","label","tag","description"]
      }
    }
  },
  required: ["events"]
}

async function uploadFile(file: File): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
  const form = new FormData()
  form.append("purpose", "user_data")
  form.append("file", file)
  const r = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.error?.message || "Failed to upload file")
  }
  const j = await r.json()
  return j.id as string
}

async function callResponsesWithFileId(file_id: string, page_start: number, page_end: number) {
  const body = {
    model: MODEL,
    temperature: 0,
    reasoning: { effort: "medium" },
    input: [
      { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      {
        role: "user",
        content: [
          { type: "input_text", text: `Extract events explicitly found between pages ${page_start} and ${page_end}.` },
          { type: "input_file", file_id }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "calendar_events",
        schema: EVENT_OBJECT_SCHEMA,
        strict: true
      }
    },
    max_output_tokens: 1800
  }
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI Responses request failed")
  }
  const j = await r.json()
  const text = j?.output?.[0]?.content?.[0]?.text ?? '{"events":[]}'
  const tokensUsed = j?.usage?.total_tokens ?? 0
  let parsedObj: { events: ParsedEvent[] } = { events: [] }
  try {
    parsedObj = JSON.parse(text)
  } catch {
    parsedObj = { events: [] }
  }
  return { parsed: parsedObj.events || [], tokensUsed }
}

export class OpenAIPdfService {
  static async parse(file: File): Promise<ParseResult> {
    const file_id = await uploadFile(file)
    const { parsed, tokensUsed } = await callResponsesWithFileId(file_id, PAGE_START, PAGE_END)
    let allEvents = Array.isArray(parsed) ? parsed : []
    allEvents = postNormalizeEvents(allEvents)
    allEvents = dedupeEvents(allEvents)
    allEvents.sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        ((a.start_time || "23:59").localeCompare(b.start_time || "23:59")) ||
        a.title.localeCompare(b.title)
    )
    return { events: allEvents, tokensUsed }
  }
}
