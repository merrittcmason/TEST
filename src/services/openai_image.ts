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
const TEXT_MODEL = "gpt-4o"
const MAX_TOKENS_VISION = 900
const MAX_TOKENS_TEXT = 700

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
      const contrast = 1.4
      const brightness = 12
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

const SYSTEM_PROMPT_VISION = `Return json only. You are an OCR scheduler. Input is one or more images that contain calendar content or schedule-like information, including monthly grids, agenda lists, tables, flyers, and screenshots that may include extra UI.
Focus rules:
- Focus on the scheduling region; ignore app chrome, toolbars, status bars, and unrelated UI.
Date rules:
- For monthly grids, read month/year near the grid; map weekday headers (Sunday..Saturday) to columns; map numbered cells to dates. For list/agenda views, apply the nearest date heading to following rows until a new heading appears. If no year, use the current year.
- When multiple items appear on one day, emit separate events with the same event_date. Never move an item to a different day.
- Expand multi-day bars/arrows or spans like "Oct 7–11" into one event per covered date with the same name.
- Anchor items to the cell containing the numeric day. If an item overlaps cells, pick the cell whose day number is closest; if still ambiguous, choose the later date.
Naming/time rules:
- Preserve decimals/identifiers (e.g., "Practice Problems 2.5").
- Times: "noon"→"12:00", "midnight"→"00:00"; for ranges, use the start time. If wording implies due/submit/turn-in with no time, use "23:59"; otherwise null.
- event_name must be concise, title-case, without dates/times, ≤ 50 characters.
Schema:
{"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Project|Lab|Lecture|Class|Meeting|Office_Hours|Presentation|Deadline|Workshop|Holiday|Break|No_Class|School_Closed|Other"|null}]}`
const SYSTEM_PROMPT_TEXT = `Return json only. You are an OCR scheduler reading plain text that was extracted from a schedule image. The text may include monthly grids, day headings, agenda items, and times.
Follow the same rules as the vision prompt for dates, multi-item days, and spans. Use explicit dates in the text when available. If no year is shown, use the current year.
Schema:
{"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Project|Lab|Lecture|Class|Meeting|Office_Hours|Presentation|Deadline|Workshop|Holiday|Break|No_Class|School_Closed|Other"|null}]}`

async function callOpenAI_JSON_FromOCRText(ocrText: string): Promise<{ parsed: any; tokensUsed: number }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_TEXT },
        { role: "user", content: "Return json only. Convert this OCR text into events using the schema." },
        { role: "user", content: ocrText.slice(0, 12000) || "(no text)" }
      ],
      temperature: 0.0,
      max_tokens: MAX_TOKENS_TEXT,
      response_format: { type: "json_object" }
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI text OCR parse failed")
  }
  const data = await res.json()
  const contentStr = data?.choices?.[0]?.message?.content ?? ""
  const tokensUsed = data?.usage?.total_tokens ?? 0
  const parsed = JSON.parse(contentStr)
  return { parsed, tokensUsed }
}

async function callOpenAI_JSON_Vision(images: string[], ocrText: string): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts: any[] = [
    { type: "text", text: "Return json only. Extract dated events. Keep multiple items on the same date. Expand spans to one event per date. Use this OCR text to assist parsing:" },
    { type: "text", text: ocrText.slice(0, 12000) || "(no extra OCR text)" }
  ]
  for (const url of images) userParts.push({ type: "image_url", image_url: { url } })
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_VISION },
        { role: "user", content: userParts }
      ],
      temperature: 0.0,
      max_tokens: MAX_TOKENS_VISION,
      response_format: { type: "json_object" }
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI vision OCR parse failed")
  }
  const data = await res.json()
  const contentStr = data?.choices?.[0]?.message?.content ?? ""
  const tokensUsed = data?.usage?.total_tokens ?? 0
  const parsed = JSON.parse(contentStr)
  return { parsed, tokensUsed }
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
}
function dayDiff(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime()
  const db = new Date(b + "T00:00:00Z").getTime()
  const diff = Math.round((da - db) / 86400000)
  return diff
}
function mergeEventLists(a: ParsedEvent[], b: ParsedEvent[]): ParsedEvent[] {
  const out: ParsedEvent[] = []
  const index: Record<string, ParsedEvent> = {}
  for (const e of a) {
    const key = `${normName(e.event_name)}|${e.event_time || ""}`
    index[key] = e
  }
  for (const e of b) {
    const key = `${normName(e.event_name)}|${e.event_time || ""}`
    if (index[key]) {
      const base = index[key]
      if (base.event_date !== e.event_date) {
        if (Math.abs(dayDiff(base.event_date, e.event_date)) === 1) {
          index[key] = { event_name: base.event_name, event_date: e.event_date, event_time: base.event_time || e.event_time, event_tag: base.event_tag || e.event_tag }
        } else {
          out.push(e)
        }
      }
    } else {
      index[key] = e
    }
  }
  for (const k of Object.keys(index)) out.push(index[k])
  const seen = new Set<string>()
  const deduped: ParsedEvent[] = []
  for (const e of out) {
    const key = `${normName(e.event_name)}|${e.event_date}|${e.event_time || ""}|${e.event_tag || ""}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(e)
    }
  }
  return deduped
}

export class OpenAIImageService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const originalUrl = await fileToDataURL(file)
    const enhancedUrl = await enhanceImageDataUrl(originalUrl)
    const ocr1 = await tesseractOCR(enhancedUrl)
    const ocr2 = await tesseractOCR(originalUrl)
    const combinedOCR = `${ocr1}\n\n${ocr2}`.trim()
    const textPass = await callOpenAI_JSON_FromOCRText(combinedOCR || "(no text)")
    const visionPass = await callOpenAI_JSON_Vision([enhancedUrl, originalUrl], combinedOCR)
    let listText: ParsedEvent[] = (textPass.parsed.events || []) as ParsedEvent[]
    let listVision: ParsedEvent[] = (visionPass.parsed.events || []) as ParsedEvent[]
    listText = listText.filter(e => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    listVision = listVision.filter(e => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    let merged = mergeEventLists(listText, listVision)
    merged = postNormalizeEvents(merged)
    merged = dedupeEvents(merged)
    merged.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    const tokensUsed = (textPass.tokensUsed || 0) + (visionPass.tokensUsed || 0)
    return { events: merged, tokensUsed }
  }
}
