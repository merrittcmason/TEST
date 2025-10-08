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

const SYSTEM_PROMPT = `You are an AI calendar event extractor. The input is a screenshot or photo of a schedule, syllabus, or calendar. Your task is to output structured events in valid JSON only.

### Rules
1. Return a JSON object with one key: "events", containing an array of event objects.
2. Each event object must have the fields:
   title, location, all_day, start_date, start_time, end_date, end_time, is_recurring, recurrence_rule, label, tag, description.
3. Dates must be formatted YYYY-MM-DD. If the year is missing, assume ${new Date().getFullYear()}.
4. If a time range appears (e.g., 0800–2000), fill both start_time and end_time.
5. If a date range appears (e.g., Nov 17–18), fill both start_date and end_date.
6. If an event has no time but is an all-day event, set all_day=true and both time fields=null.
7. If an event lacks an end date/time, set end_date=null and end_time=null.
8. If no recurrence is visible, set is_recurring=false and recurrence_rule=null.
9. If it looks recurring (daily, weekly, etc.), fill is_recurring=true and use recurrence_rule like "DAILY", "WEEKLY", etc.
10. If it looks like an assignment, quiz, exam, or class, try to infer a proper tag and label.
11. If you can’t find something, use null instead of guessing.
12. Return ONLY valid JSON in the format below.

### Output format
{
  "events": [
    {
      "title": "Practice Problems 2.5",
      "location": null,
      "all_day": false,
      "start_date": "2025-11-17",
      "start_time": "08:00",
      "end_date": "2025-11-17",
      "end_time": "20:00",
      "is_recurring": false,
      "recurrence_rule": null,
      "label": "Math 101",
      "tag": "Homework",
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
          {
            role: "system",
            content: "Fix this to be valid JSON matching { events: [...] }. Output only JSON."
          },
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

async function callOpenAIWithImage(images: string[]): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts = images.map(url => ({ type: "input_image", image_url: url }))

  const schema = {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
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
          required: ["title", "start_date"]
        }
      }
    },
    required: ["events"]
  }

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
      text: { format: { type: "json_schema", name: "calendar_events", schema } },
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
