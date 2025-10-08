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

const VISION_SYSTEM_PROMPT = `You are an event extractor reading schedule pages as images or information that needs to be scheduled (use your built-in OCR).

Goal: OUTPUT ONLY events that have a resolvable calendar date.

Core rules:

1) Detect the primary information region and ignore unrelated information and UI  such as app toolbars, buttons, status bars, page headers/footers, etc...
2) Resolve dates. If a monthly grid is visible, accurately map the boxs and the number inside that lists the date. Not every grid is going is going to be the same shape and size; map columns to weekday headers. (Sunday..Saturday) and numbered cells to dates. If a list/agenda, use the nearest visible date heading for following items until a new heading appears. If no explicit year, use the current year. 
3) Multiple items in one day must remain on that exact date. Do not move an item to the prior or next day to “balance” duplicates. When a day has N items, emit N separate events with identical event_date.
4) Multi-day bars/arrows or phrases indicating spans (e.g., “Vacation” with an arrow across cells, or “Oct 7–11”) must be expanded to one event per covered date, same name each day. If an arrow is present, an event should be scheduled for every box or column that the arrown touches or crosses.
5) Prefer the cell that contains the numeric day label for anchoring. If an item visually overlaps two cells, choose the cell whose date text is closest; if still ambiguous, choose the later date.
6) Preserve decimals and section identifiers in names (e.g., “Practice Problems 2.5”).
7) Times: “noon”→“12:00”, “midnight”→“00:00”. For ranges, use the start time. If wording implies due/submit/turn-in with no time, use “23:59”; otherwise null.
8) Keep names short, title-case, no dates/times in the name, ≤ 50 chars.
Schema only:

How to read dates:
- Accept: 9/05, 10/2, 10-02, Oct 2, October 2, 10/2/25, 2025-10-02.
- Normalize all dates to YYYY-MM-DD. If the year is missing, use ${new Date().getFullYear()}.
- For calendar grids or tables, read month/year from headers and carry them forward until a new header appears.
- For each row/cell, if a day number or date is shown separately from the event text, associate that date with the nearby items in the same row/cell/box.
- If the date is not visible near the item, look up to the nearest date header/column heading in the same column or section.

Noise to ignore in NAMES (do NOT ignore dates): room/location strings, URLs, instructor names/emails, campus/building names, map links.

Combining vs splitting:
- If one line lists multiple sections for the SAME assignment (e.g., "Practice problems — sections 5.1 & 5.2"), create ONE event name that preserves "5.1 & 5.2".
- Split only when a line clearly has different tasks (e.g., "HW 3 due; Quiz 2").

Schema ONLY:
{
  "events": [
    {
      "event_name": "Title-Case Short Name",
      "event_date": "YYYY-MM-DD",
      "event_time": "HH:MM" | null,
      "event_tag": "interview|exam|midterm|quiz|homework|assignment|project|lab|lecture|class|meeting|office_hours|presentation|deadline|workshop|holiday|break|no_class|school_closed|other" | null
    }
  ]
}

Name rules:
- Title-Case, ≤ 40 chars, concise, no dates/times/pronouns/descriptions.
- Preserve meaningful section/chapter identifiers like "5.1 & 5.2" in the name.
Time rules:
- "noon"→"12:00", "midnight"→"00:00", ranges use start time.
- Due/submit/turn-in with no time → "23:59"; otherwise if no time, event_time = null.

CRITICAL: Every event MUST include a valid event_date. If you cannot determine a date with high confidence, leave the date empty.

Return ONLY valid JSON (no commentary, no markdown, no trailing commas).`;

const REPAIR_PROMPT = `You will receive possibly malformed JSON for:
{ "events": [ { "event_name": "...", "event_date": "YYYY-MM-DD", "event_time": "HH:MM"|null, "event_tag": "..."|null } ] }
Fix ONLY syntax/shape. Do NOT add commentary. Return valid JSON exactly in that shape.`;

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
