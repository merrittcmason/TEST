const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY
const MODEL = "gpt-4o"
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

const SYSTEM_PROMPT = `Extract calendar event information from provided images,  identify all relevant event details, and generate structured calendar events in the specified JSON format below.

Your Objective:
- Carefully analyze each image to extract event details: title, date(s), time(s), location, recurrence, label, tag, and any available description.
- construct a complete JSON output using the provided schema.
- If information is missing or ambiguous in the image, infer reasonable defaults, leave fields as "null" if necessary, and clearly specify your inferences in the reasoning.

# Steps

1. **Image Analysis:** Examine the image to identify possible events and extract all relevant data: event title, dates, times, location, recurrence rules, labels, tags, and descriptions.
2. **Inference:** If required fields are missing, infer reasonable values or set to "null". Explain any inferences made.
3. **Event Assembly:** After completing all analyses, assemble the extracted information into the final structured JSON.

# Output Format

Respond with a JSON object in the following structure. The "events" array should contain one or more events extracted from the image(s):

{
  "events": [
    {
      "title": [string, e.g. "Midterm Exam"],
      "location": [string or null],
      "all_day": [boolean],
      "start_date": [YYYY-MM-DD],
      "start_time": [HH:MM, 24h, or null if all_day],
      "end_date": [YYYY-MM-DD],
      "end_time": [HH:MM, 24h, or null if all_day],
      "is_recurring": [boolean],
      "recurrence_rule": [string or null, e.g. "FREQ=WEEKLY;BYDAY=MO" or null],
      "label": [string or null, e.g. class code such as "BIO-201"],
      "tag": [string or null, e.g. "Exam" or "Lecture"],
      "description": [string or null]
    }
  ]
}

# Examples

**Example Image:**  
(A timetable image showing "BIO-201 Midterm Exam, March 14, 2025, 9–11am, Room 1, Tag: Exam")

**Step-by-step Reasoning:**  
- Title: "Midterm Exam" (extracted from event header)
- Location: "Room 1" (from location label)
- All_day: false (time is specified as 9–11am)
- Start_date: "2025-03-14" (from date field)
- Start_time: "09:00" (from start time)
- End_date: "2025-03-14" (same day)
- End_time: "11:00" (from end time)
- Is_recurring: false (no recurrence info in image)
- Recurrence_rule: null (not recurring)
- Label: "BIO-201" (class code in header)
- Tag: "Exam" (explicitly marked)
- Description: null (no additional description provided)

**Final JSON Output:**  
{
  "events": [
    {
      "title": "Midterm Exam",
      "location": "Room 1",
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
}
(Real images may contain multiple events. Please repeat reasoning for each distinct event detected.)

# Notes

- Always provide  the final JSON output.
- If multiple events are found in an image, reason and construct output for each in turn in the array.
- Infer reasonable defaults or use null where data is missing—explain these choices in the reasoning.
- Do not wrap the JSON output in code blocks.
- Remain consistent and faithful to the provided output schema.

# Reminder

Your task: extract calendar events from images, reason step-by-step for each event, then return the results as an "events" JSON array using the specified format, with all reasoning provided first. Continue asking for clarification or further input if image details are ambiguous or insufficient.`

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
