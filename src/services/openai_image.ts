const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const MODEL = "gpt-4o"
const MAX_TOKENS = 1000

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
    throw new Error("Failed to parse JSON output")
  }
}

async function callOpenAIWithImage(images: string[]): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts: any[] = images.map(url => ({ type: "input_image", image_url: url }))
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: userParts }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "calendar_events",
          schema: EVENT_OBJECT_SCHEMA,
          strict: true
        }
      },
      max_output_tokens: MAX_TOKENS
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI vision parse failed")
  }
  const data = await res.json()
  const text = data?.output?.[0]?.content?.[0]?.text ?? '{"events":[]}'
  const tokensUsed = data?.usage?.total_tokens ?? 0
  let parsedObj: { events: ParsedEvent[] } = { events: [] }
  try {
    parsedObj = JSON.parse(text)
  } catch {
    parsedObj = await robustJsonParse(text)
  }
  return { parsed: parsedObj.events || [], tokensUsed }
}

export class OpenAIImageService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const originalUrl = await fileToDataURL(file)
    const img = await loadImage(originalUrl)
    const processedUrl = preprocessImageToDataUrl(img)
    const { parsed, tokensUsed } = await callOpenAIWithImage([processedUrl, originalUrl])
    let events: ParsedEvent[] = Array.isArray(parsed) ? parsed : []
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events.sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        ((a.start_time || "23:59").localeCompare(b.start_time || "23:59")) ||
        a.title.localeCompare(b.title)
    )
    return { events, tokensUsed }
  }
}
