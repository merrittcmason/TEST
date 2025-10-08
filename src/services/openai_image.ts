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
async function enhanceImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const c = document.createElement("canvas")
      const ctx = c.getContext("2d")!
      const w = img.naturalWidth
      const h = img.naturalHeight
      c.width = w
      c.height = h
      ctx.drawImage(img, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      const contrast = 1.35
      const brightness = 10
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.max(0, Math.min(255, factor * (d[i] - 128) + 128 + brightness))
        d[i + 1] = Math.max(0, Math.min(255, factor * (d[i + 1] - 128) + 128 + brightness))
        d[i + 2] = Math.max(0, Math.min(255, factor * (d[i + 2] - 128) + 128 + brightness))
      }
      ctx.putImageData(imageData, 0, 0)
      resolve(c.toDataURL("image/jpeg", 0.92))
    }
    img.src = dataUrl
  })
}
async function tesseractOCR(dataUrl: string): Promise<string> {
  try {
    const { createWorker } = await import("tesseract.js")
    const worker = await createWorker()
    await worker.loadLanguage("eng")
    await worker.initialize("eng")
    const { data } = await worker.recognize(dataUrl)
    await worker.terminate()
    return (data.text || "").trim()
  } catch {
    return ""
  }
}

const SYSTEM_PROMPT = `Return json only. You are a professional event scheduler and have recieved a malformed image or screenshot of information. Input is one or more images that contain information to put on a calendar. Images may be calendar grids, agenda/list views, tables, flyers, or screenshots that include extra UI.
Rules:
1) Focus only on the scheduling region; ignore extra noise, toolbars, headers, footers, and overlays.
2) Resolve dates precisely. For monthly grids, read the month/year near the grid; map weekday headers (Sunday..Saturday) to columns; map numbered cells to dates. For list/agenda views, apply the nearest date heading to following rows until a new heading appears. If no year, use the current year.
3) When multiple items appear on one day, emit separate events with the same event_date. Never shift an item to a different day.
4) Multi-day bars/arrows or phrases indicating spans (e.g., “Vacation” with an arrow across cells, or “Oct 7–11”) must be expanded to one event per covered date, same name each day. If an arrow is present, an event should be scheduled for every box or column that the arrown touches or crosses.
5) Anchor items to the cell containing the numeric day. If an item overlaps cells, pick the cell whose day number is closest; if still ambiguous, choose the later date.
6) Preserve decimals/identifiers in names (e.g., "Practice Problems 2.5").
7) Times: "noon" → "12:00", "midnight" → "00:00"; ranges use start time. If text implies due/submit/turn-in and no time, use "23:59"; otherwise null.
8) event_name must be concise, title-case, without dates/times, ≤ 50 characters.
Schema:
{"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Project|Lab|Lecture|Class|Meeting|Office_Hours|Presentation|Deadline|Workshop|Holiday|Break|No_Class|School_Closed|Other"|null}]}
Return json only.`

async function callOpenAI_JSON_Vision(images: string[], ocrText: string): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts: any[] = [
    { type: "text", text: "Return json only. Extract dated events. Keep multiple items on the same date. Expand multi-day spans to one event per date. Use this OCR text to assist parsing:" },
    { type: "text", text: ocrText.slice(0, 12000) || "(no extra OCR text)" }
  ]
  for (const url of images) userParts.push({ type: "image_url", image_url: { url } })
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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
    const originalUrl = await fileToDataURL(file)
    const enhancedUrl = await enhanceImageDataUrl(originalUrl)
    const ocr1 = await tesseractOCR(enhancedUrl)
    const ocr2 = await tesseractOCR(originalUrl)
    const combinedOCR = `${ocr1}\n\n${ocr2}`.trim()
    const { parsed, tokensUsed } = await callOpenAI_JSON_Vision([enhancedUrl, originalUrl], combinedOCR)
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
    events = events.filter(e => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed }
  }
}
