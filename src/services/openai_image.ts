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
const TEXT_MODEL = "gpt-4o-mini"
const MAX_TOKENS_VISION = 900
const MAX_TOKENS_TEXT = 500

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
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    let v = factor * (gray - 128) + 128 + brightness
    v = Math.max(0, Math.min(255, v))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(id, 0, 0)
  return c.toDataURL("image/png", 0.95)
}
type BBox = { x: number; y: number; w: number; h: number; conf: number }
type OCRWord = { text: string; x: number; y: number; w: number; h: number; conf: number }
type OCRRegion = { box: BBox; text: string; words: OCRWord[] }
function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}
function mergeOverlapping(boxes: BBox[], thr = 0.2): BBox[] {
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf)
  const kept: BBox[] = []
  for (const b of sorted) {
    let overlapped = false
    for (const k of kept) {
      if (iou(b, k) > thr) {
        overlapped = true
        break
      }
    }
    if (!overlapped) kept.push(b)
  }
  return kept
}
function assignWordsToRegions(regions: BBox[], words: OCRWord[]): OCRRegion[] {
  const out: OCRRegion[] = regions.map(r => ({ box: r, text: "", words: [] }))
  for (const w of words) {
    const cx = w.x + w.w / 2
    const cy = w.y + w.h / 2
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]
      const inside = cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
      if (!inside) continue
      const rx = r.x + r.w / 2
      const ry = r.y + r.h / 2
      const d = Math.hypot(cx - rx, cy - ry)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    if (best >= 0) out[best].words.push(w)
  }
  for (const r of out) {
    r.words.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
    r.text = r.words.map(w => w.text).join(" ").replace(/\s{2,}/g, " ").trim()
  }
  return out.filter(r => r.text.length > 0)
}
async function tesseractDetect(dataUrl: string): Promise<BBox[]> {
  try {
    const { createWorker, PSM } = await import("tesseract.js")
    const worker = await createWorker()
    await worker.loadLanguage("eng")
    await worker.initialize("eng")
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    const det: any = await worker.detect(dataUrl)
    await worker.terminate()
    const boxes: BBox[] = []
    const add = (arr: any[]) => {
      for (const b of arr || []) {
        boxes.push({ x: b.bbox.x0, y: b.bbox.y0, w: b.bbox.x1 - b.bbox.x0, h: b.bbox.y1 - b.bbox.y0, conf: typeof b.confidence === "number" ? b.confidence : 70 })
      }
    }
    add(det.data.blocks || [])
    add(det.data.paragraphs || [])
    add(det.data.lines || [])
    const filtered = boxes.filter(b => b.w >= 12 && b.h >= 10)
    return mergeOverlapping(filtered, 0.35)
  } catch {
    return []
  }
}
async function tesseractRecognize(dataUrl: string): Promise<OCRWord[]> {
  try {
    const { createWorker, PSM } = await import("tesseract.js")
    const worker = await createWorker()
    await worker.loadLanguage("eng")
    await worker.initialize("eng")
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    const { data }: any = await worker.recognize(dataUrl)
    await worker.terminate()
    const words: OCRWord[] = []
    for (const w of data.words || []) {
      const t = (w.text || "").trim()
      if (!t) continue
      const x = w.bbox?.x0 ?? 0
      const y = w.bbox?.y0 ?? 0
      const wdt = (w.bbox?.x1 ?? x) - x
      const hgt = (w.bbox?.y1 ?? y) - y
      const conf = typeof w.confidence === "number" ? w.confidence : 70
      if (wdt >= 6 && hgt >= 8 && conf >= 55) words.push({ text: t, x, y, w: wdt, h: hgt, conf })
    }
    return words
  } catch {
    return []
  }
}
function buildCompactOcrPayload(regions: OCRRegion[]): any[] {
  const limitRegions = 150
  const limitChars = 120
  const sliced = regions.slice(0, limitRegions).map(r => {
    const t = r.text.length > limitChars ? r.text.slice(0, limitChars) : r.text
    return { b: [Math.round(r.box.x), Math.round(r.box.y), Math.round(r.box.w), Math.round(r.box.h)], t }
  })
  let totalChars = 0
  const out: any[] = []
  for (const r of sliced) {
    const len = r.t.length + 24
    if (totalChars + len > 8000) break
    out.push(r)
    totalChars += len
  }
  return out
}
const VISION_PROMPT = `Return json only. You will receive images plus a compact OCR payload of text regions and boxes. Produce only:
{"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Project|Lab|Lecture|Class|Meeting|Office_Hours|Presentation|Deadline|Workshop|Holiday|Break|No_Class|School_Closed|Other"|null}]}
Rules:
1) Focus on calendar or schedule content; ignore app chrome and unrelated UI.
2) For monthly grids, use headers and numbered cells to resolve dates. For agenda/list layouts, apply the nearest visible date heading to subsequent rows until a new heading appears. If no year, use the current year.
3) When a day has multiple items, emit separate events with the same event_date. Do not shift items to adjacent days.
4) Expand multi-day bars/arrows or spans (e.g., “Oct 7–11”, arrows across cells) to one event per covered date with the same name.
5) Anchor to the cell containing the numeric day. If an item overlaps two dates, prefer the closer day; if ambiguous, prefer the later day.
6) Preserve decimals/identifiers (e.g., “Practice Problems 2.5”).
7) Times: “noon”→“12:00”, “midnight”→“00:00”. For ranges, use the start time. If due/submit is implied and no time is present, use “23:59”; else null.
Respond with valid json only.`
const TEXT_SYSTEM_PROMPT = `You are an event extractor for schedules and syllabi.
Input is normalized text lines (some are flattened table rows joined with " | ").
Ignore noisy tokens like single-letter weekdays (M, T, W, Th, F), section/room codes, locations, instructor names, emails, and URLs.
Extract ONLY dated events/assignments with concise names.
Rules:
- Output schema ONLY: { "events": [ { "event_name": "Title-Case Short Name", "event_date": "YYYY-MM-DD", "event_time": "HH:MM" | null, "event_tag": "interview|exam|midterm|quiz|homework|assignment|class|lecture|lab|meeting|appointment|holiday|break|no_class|school_closed|other" | null } ] }
- Title-Case, professional, ≤ 40 chars; no dates/times/pronouns/descriptions in names. Do NOT echo source lines; do NOT include section numbers, room/location, URLs, instructor names, or extra notes in event_name.
- Use current year if missing (${new Date().getFullYear()}).
- Accept dates like YYYY-MM-DD, MM/DD, M/D, "Oct 5", "October 5".
- Times: "12 pm", "12:00pm", "12–1 pm", "noon"→"12:00", "midnight"→"00:00", ranges use start.
- If text implies due/submit/turn-in and no time, use "23:59".
- If no time in the line, event_time = null.
- If a line mentions multiple items for a date, create multiple events for that date.
- Be exhaustive; do not skip minor items.
Return ONLY valid JSON. No commentary, no markdown, no trailing commas.`;

const VISION_SYSTEM_PROMPT = `You are an event extractor reading schedule pages as images (use your built-in OCR).

Goal: OUTPUT ONLY events that have a resolvable calendar date.

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

CRITICAL: Every event MUST include a valid event_date. If you cannot determine a date with high confidence, SKIP that item.

Return ONLY valid JSON (no commentary, no markdown, no trailing commas).`;

const REPAIR_PROMPT = `You will receive possibly malformed JSON for:
{ "events": [ { "event_name": "...", "event_date": "YYYY-MM-DD", "event_time": "HH:MM"|null, "event_tag": "..."|null } ] }
Fix ONLY syntax/shape. Do NOT add commentary. Return valid JSON exactly in that shape.`;
async function callOpenAIWithImageAndOCR(images: string[], ocrPayload: any): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts: any[] = [
    { type: "text", text: "Return json only. Use the OCR boxes to resolve exact dates, keep multiple items on the same date, and expand spans to one event per covered date. OCR payload follows as json." },
    { type: "text", text: JSON.stringify({ regions: ocrPayload }) }
  ]
  for (const url of images) userParts.push({ type: "image_url", image_url: { url } })
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: VISION_PROMPT },
        { role: "user", content: userParts }
      ],
      temperature: 0.0,
      max_tokens: MAX_TOKENS_VISION,
      response_format: { type: "json_object" }
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI vision parse failed")
  }
  const data = await res.json()
  const contentStr = data?.choices?.[0]?.message?.content ?? ""
  const tokensUsed = data?.usage?.total_tokens ?? 0
  const parsed = await robustJsonParse(contentStr)
  return { parsed, tokensUsed }
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
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: REPAIR_PROMPT },
          { role: "user", content: s.slice(0, 12000) }
        ],
        temperature: 0,
        max_tokens: MAX_TOKENS_TEXT,
        response_format: { type: "json_object" }
      })
    })
    if (res.ok) {
      const data = await res.json()
      const fixed = data?.choices?.[0]?.message?.content ?? ""
      return JSON.parse(fixed)
    }
    throw new Error("Failed to repair json")
  }
}
export class OpenAIImageService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const originalUrl = await fileToDataURL(file)
    const img = await loadImage(originalUrl)
    const preUrl = preprocessImageToDataUrl(img)
    const boxes = await tesseractDetect(preUrl)
    const words = await tesseractRecognize(preUrl)
    const regions = assignWordsToRegions(boxes, words)
    const payload = buildCompactOcrPayload(regions)
    const { parsed, tokensUsed } = await callOpenAIWithImageAndOCR([preUrl, originalUrl], payload)
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
    events = events.filter(e => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed }
  }
}
