const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const MODEL = "gpt-4o"
const PAGE_START = 1
const PAGE_END = 12

export interface ParsedEvent {
  event_name: string
  event_date: string
  event_time: string | null
  event_tag: string | null
}
export interface ParseResult {
  events: ParsedEvent[]
  tokensUsed: number
}

function toTitleCase(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ")
}
function capTag(t: string | null | undefined): string | null {
  if (!t || typeof t !== "string") return null
  const s = t.trim()
  if (!s) return null
  return s[0].toUpperCase() + s.slice(1).toLowerCase()
}
function postNormalizeEvents(events: ParsedEvent[]): ParsedEvent[] {
  return (events || []).map((e) => {
    let name = (e.event_name || "").trim()
    name = toTitleCase(name).replace(/\s{2,}/g, " ")
    if (name.length > 60) name = name.slice(0, 57).trimEnd() + "..."
    const event_time = typeof e.event_time === "string" && e.event_time.trim() === "" ? null : e.event_time
    const event_tag = capTag(e.event_tag ?? null)
    return { event_name: name, event_date: e.event_date, event_time, event_tag }
  })
}
function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>()
  const out: ParsedEvent[] = []
  for (const e of events) {
    const key = `${(e.event_name || "").trim().toLowerCase()}|${e.event_date}|${e.event_time ?? ""}|${e.event_tag ?? ""}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(e)
    }
  }
  return out
}

const SYSTEM_TEXT = `You are an event extractor for schedules and syllabi. Return JSON only. Extract ONLY events that explicitly include a date. Preserve decimals in identifiers such as "2.5" or "4.10". Times: ranges use the start; "noon" -> "12:00"; "midnight" -> "00:00"; due/submit without an explicit time -> "23:59". Do not infer missing fields. Dates must be YYYY-MM-DD. Times must be HH:MM 24h or null.`

const SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_name: { type: "string" },
          event_date: { type: "string" },
          event_time: { type: ["string", "null"] },
          event_tag: {
            type: ["string", "null"],
            enum: [
              "Interview","Exam","Midterm","Quiz","Homework","Assignment","Class","Lecture","Lab","Meeting","Appointment","Holiday","Break","No_Class","School_Closed","Other",null
            ]
          }
        },
        required: ["event_name","event_date","event_time","event_tag"]
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
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: SYSTEM_TEXT + " Return only valid JSON matching the schema." },
          { type: "input_file", file_id, page_range: { start: page_start, end: page_end } }
        ]
      }
    ],
    text: { format: { type: "json_schema", schema: SCHEMA, strict: true } }
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
  const text = j?.output?.[0]?.content?.[0]?.text ?? "{\"events\":[]}"
  const parsed = JSON.parse(text) as { events: ParsedEvent[] }
  const tokensUsed = j?.usage?.total_tokens ?? 0
  return { parsed, tokensUsed }
}

export class OpenAIPdfService {
  static async parse(file: File): Promise<ParseResult> {
    const file_id = await uploadFile(file)
    const { parsed, tokensUsed } = await callResponsesWithFileId(file_id, PAGE_START, PAGE_END)
    let allEvents = Array.isArray(parsed?.events) ? parsed.events : []
    allEvents = postNormalizeEvents(allEvents)
    allEvents = dedupeEvents(allEvents)
    allEvents.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events: allEvents, tokensUsed }
  }
}
