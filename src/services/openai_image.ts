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

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const VISION_MODEL = "gpt-4o"
const MAX_TOKENS_VISION = 900

function toTitleCase(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").split(" ").map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ")
}
function capTag(t: string | null | undefined): string | null {
  if (!t || typeof t !== "string") return null
  const s = t.trim()
  if (!s) return null
  return s[0].toUpperCase() + s.slice(1).toLowerCase()
}
function postNormalizeEvents(events: ParsedEvent[]): ParsedEvent[] {
  return (events || []).map(e => {
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
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

const VISION_SYSTEM_PROMPT = `Return JSON only. You are an OCR scheduler. The user will send images that contain information to be put on a calendar. Images may be calendar grids, agenda/list views, tables, flyers, or screenshots that include extra UI.
Core rules:
1) Detect the primary schedule region and ignore unrelated chrome such as app toolbars, buttons, status bars, page headers/footers.
2) Resolve dates. If a monthly grid is visible, read the month and year near the grid; map columns to weekday headers (Sunday..Saturday) and numbered cells to dates. If a list/agenda, use the nearest visible date heading for following items until a new heading appears. If no explicit year, use the current year.
3) Multiple items in one day must remain on that exact date. Do not move an item to the prior or next day to “balance” duplicates. When a day has N items, emit N separate events with identical event_date.
4) Multi-day bars/arrows or phrases indicating spans (e.g., “Modules at home” with an arrow across cells, or “Oct 7–11”) must be expanded to one event per covered date, same name each day.
5) Prefer the cell that contains the numeric day label for anchoring. If an item visually overlaps two cells, choose the cell whose date text is closest; if still ambiguous, choose the later date.
6) Preserve decimals and section identifiers in names (e.g., “Practice Problems 2.5”).
7) Times: “noon”→“12:00”, “midnight”→“00:00”. For ranges, use the start time. If wording implies due/submit/turn-in with no time, use “23:59”; otherwise null.
8) Keep names short, title-case, no dates/times in the name, ≤ 50 chars.
Schema only:
{"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Project|Lab|Lecture|Class|Meeting|Office_Hours|Presentation|Deadline|Workshop|Holiday|Break|No_Class|School_Closed|Other"|null}]}
Return JSON only.`

async function callOpenAI_JSON_Vision(images: string[]): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts: any[] = [{ type: "text", text: "Return JSON only. Extract dated events from these images. Keep all items that share the same day on that exact date. Expand multi-day spans to one event per covered date." }]
  for (const url of images) userParts.push({ type: "image_url", image_url: { url } })
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        { role: "user", content: userParts }
      ],
      temperature: 0.0,
      max_tokens: MAX_TOKENS_VISION,
      response_format: { type: "json_object" }
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI API request failed")
  }
  const data = await res.json()
  const contentStr = data?.choices?.[0]?.message?.content ?? ""
  const tokensUsed = data?.usage?.total_tokens ?? 0
  const parsed = JSON.parse(contentStr)
  return { parsed, tokensUsed }
}

export class OpenAIImageService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const url = await fileToDataURL(file)
    const { parsed, tokensUsed } = await callOpenAI_JSON_Vision([url])
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
    events = events.filter(e => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed }
  }
}
