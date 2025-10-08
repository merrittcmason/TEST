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
const MAX_TOKENS_VISION = 800

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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}
async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
function drawToCanvas(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = sw
  c.height = sh
  const ctx = c.getContext("2d")!
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return c
}
function applySharpen(c: HTMLCanvasElement): HTMLCanvasElement {
  const w = c.width, h = c.height
  const ctx = c.getContext("2d")!
  const src = ctx.getImageData(0, 0, w, h)
  const dst = ctx.createImageData(w, h)
  const s = src.data, d = dst.data
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0
        let i = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px = ((y + ky) * w + (x + kx)) * 4 + ch
            sum += s[px] * k[i++]
          }
        }
        d[(y * w + x) * 4 + ch] = Math.max(0, Math.min(255, sum))
      }
      d[(y * w + x) * 4 + 3] = s[(y * w + x) * 4 + 3]
    }
  }
  ctx.putImageData(dst, 0, 0)
  return c
}
function applyContrastSaturation(c: HTMLCanvasElement, contrastPct: number, saturationPct: number, brightnessPct: number, grayscale: boolean): HTMLCanvasElement {
  const w = c.width, h = c.height
  const ctx = c.getContext("2d")!
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const cf = (259 * (contrastPct + 255)) / (255 * (259 - contrastPct))
  const bf = brightnessPct
  const sf = 1 + saturationPct / 100
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2]
    r = cf * (r - 128) + 128 + bf
    g = cf * (g - 128) + 128 + bf
    b = cf * (b - 128) + 128 + bf
    if (grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      r = gray; g = gray; b = gray
    } else {
      const avg = (r + g + b) / 3
      r = avg + (r - avg) * sf
      g = avg + (g - avg) * sf
      b = avg + (b - avg) * sf
    }
    d[i] = Math.max(0, Math.min(255, r))
    d[i + 1] = Math.max(0, Math.min(255, g))
    d[i + 2] = Math.max(0, Math.min(255, b))
  }
  ctx.putImageData(img, 0, 0)
  return c
}
async function enhanceVariant(url: string, marginRatio: number, contrastPct: number, saturationPct: number, brightnessPct: number, doSharpen: boolean, doGrayscale: boolean): Promise<string> {
  const img = await loadImage(url)
  const w = img.width
  const h = img.height
  const mx = Math.floor(w * marginRatio)
  const my = Math.floor(h * marginRatio)
  const sx = Math.max(0, mx)
  const sy = Math.max(0, my)
  const sw = Math.max(1, w - 2 * mx)
  const sh = Math.max(1, h - 2 * my)
  let c = drawToCanvas(img, sx, sy, sw, sh)
  c = applyContrastSaturation(c, contrastPct, saturationPct, brightnessPct, doGrayscale)
  if (doSharpen) c = applySharpen(c)
  return c.toDataURL("image/jpeg", 0.92)
}
async function buildImageSet(file: File): Promise<string[]> {
  const original = await fileToDataURL(file)
  const v1 = await enhanceVariant(original, 0.15, 70, 35, 10, true, false)
  const v2 = await enhanceVariant(original, 0.08, 55, 20, 5, true, false)
  const v3 = await enhanceVariant(original, 0.15, 85, 0, 0, false, true)
  const v4 = original
  return [v1, v2, v3, v4]
}

const VISION_SYSTEM_PROMPT = `Return json only. You are parsing screenshots that may contain a monthly calendar grid or a list-style calendar.
If a grid is visible:
- Ignore all non-grid UI. Focus on the calendar table.
- Read month and year near the grid. If year absent, infer from labels; otherwise use current year.
- Map columns to weekday headers (Sunday..Saturday). Map numbered day cells to dates.
- Within each cell, extract every distinct item as its own event. Never shift an item to the previous or next day.
- If multiple items appear in the same cell, keep all of them on that exact date.
- For multi-day bars/arrows spanning adjacent cells (e.g., "Modules at home"), create one event per covered date with the same name.
- Cross-check alignment: dates increase left→right, top→bottom. Resolve off-by-one only if a numeric day conflicts with column weekday; otherwise keep the cell assignment.
If a list-style view is visible instead of a grid:
- Use explicit date headings and associate each subsequent item with the most recent date heading until a new heading appears.
- If a time appears without a date, attach it to the nearest prior date heading.
Normalization:
- event_date "YYYY-MM-DD"
- event_time "HH:MM" or null. Ranges use the start time. "noon"→"12:00", "midnight"→"00:00". Due/submit without time→"23:59".
- Preserve decimals in identifiers.
Schema:
{"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Project|Lab|Lecture|Class|Meeting|Office_Hours|Presentation|Deadline|Workshop|Holiday|Break|No_Class|School_Closed|Other"|null}]}`

async function callOpenAI_JSON_Vision(images: string[]): Promise<{ parsed: any; tokensUsed: number }> {
  const userParts: any[] = [{ type: "text", text: "Return json only. Keep multiple items in the same cell on the same date. Expand multi-day arrows to one event per day they cover." }]
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
    const variants = await buildImageSet(file)
    const { parsed, tokensUsed } = await callOpenAI_JSON_Vision(variants)
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
    events = events.filter((e) => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed }
  }
}
