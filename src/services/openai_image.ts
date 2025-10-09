const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const MODEL = "gpt-4o"
const MAX_TOKENS = 1200

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

function toSmartTitleCase(s: string): string {
  const words = (s || "").trim().replace(/\s+/g, " ").split(" ")
  return words
    .map(w => {
      if (!w) return w
      const bare = w.replace(/[^\w-]/g, "")
      const isAcronym = /^[A-Z0-9\-]{2,}$/.test(bare)
      if (isAcronym) return w.toUpperCase()
      return w[0].toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(" ")
}

function postNormalizeEvents(events: ParsedEvent[]): ParsedEvent[] {
  return (events || []).map(e => {
    let title = (e.title || "").trim()
    title = toSmartTitleCase(title).replace(/\s{2,}/g, " ")
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

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function preprocessImageToDataUrl(img: HTMLImageElement): string {
  const maxDim = 2200
  const scale = Math.min(maxDim / Math.max(img.naturalWidth, img.naturalHeight), 1)
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const c = document.createElement("canvas")
  const ctx = c.getContext("2d")!
  c.width = w
  c.height = h
  ctx.drawImage(img, 0, 0, w, h)
  const id = ctx.getImageData(0, 0, w, h)
  const d = id.data
  const contrast = 1.45
  const brightness = 14
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    let v = factor * (gray - 128) + 128 + brightness
    v = Math.max(0, Math.min(255, v))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(id, 0, 0)
  return c.toDataURL("image/png", 0.95)
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
12. If the connected parts include different activity types (e.g. "Lab", "Quiz", "Exam", "Test", "Discussion Board", "Assignment", "Practice Problems"), treat each as a separate event with the same date/time.
13. If all connected parts are of the same type (e.g. "Practice Problems – Sections 1.1, 1.2, 1.3"), keep them together as a single event and preserve the section list in the title.
14. Connectors such as "&", "and", "plus", or semicolons signal that different event groups may appear together — check for differences in type words before deciding whether to split.
15. Do not truncate the extraction early. Process all rows and pages until the end of the document.
16. Each event should represent one distinct activity, even if multiple occur on the same date.
17. Preserve capitalization for acronyms or fully uppercase terms (e.g., “EVA”, “HW”, “EXAM”, “LAB”, “QUIZ”) when they appear in the source text.
18. Only apply title casing to standard words, not to words that are already all uppercase.
19. Do not alter intentional capitalization in abbreviations, organization names, or course labels.
20. Exclude terms like "Submit, Turn in, Complete" in event titles. Keep names concise.
21. For duplicate events from information that spans multiple days, create one event that starts on the first day and ends on the last.
21. Return only valid JSON in the format below.
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
          { role: "system", content: "Fix this to be valid JSON matching { events: [...] }. Output only JSON." },
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

const IMAGE_EVENTS_SCHEMA = {
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

async function callOpenAIWithImage(images: string[]): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts = images.map(url => ({ type: "input_image", image_url: url }))

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userParts }
      ],
      text: { format: { type: "json_schema", name: "calendar_events", schema: IMAGE_EVENTS_SCHEMA, strict: true } },
      max_output_tokens: MAX_TOKENS
    })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI vision parse failed")
  }

  const data = await res.json()
  const text = data?.output?.[0]?.content?.[0]?.text ?? "{}"
  const tokensUsed = data?.usage?.total_tokens ?? 0
  const parsed = await robustJsonParse(text)
  return { parsed, tokensUsed }
}

export class OpenAIImageService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")

    const originalUrl = await fileToDataURL(file)
    const img = await loadImage(originalUrl)
    const processedUrl = preprocessImageToDataUrl(img)
    const { parsed, tokensUsed } = await callOpenAIWithImage([processedUrl, originalUrl])

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
