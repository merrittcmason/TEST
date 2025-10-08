// src/services/google_image.ts
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

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_CLOUD_API_KEY
const MAX_REQ_FEATURES = 1

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
function b64FromDataUrl(dataUrl: string): string {
  const idx = dataUrl.indexOf(",")
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}
type GWord = { text: string; bbox: { x: number; y: number; w: number; h: number } }
type GBlock = { text: string; bbox: { x: number; y: number; w: number; h: number }; words: GWord[]; conf: number }
function bboxFromVertices(verts: Array<{ x?: number; y?: number }>): { x: number; y: number; w: number; h: number } {
  const xs = verts.map(v => v.x || 0)
  const ys = verts.map(v => v.y || 0)
  const minx = Math.min(...xs)
  const miny = Math.min(...ys)
  const maxx = Math.max(...xs)
  const maxy = Math.max(...ys)
  return { x: minx, y: miny, w: Math.max(0, maxx - minx), h: Math.max(0, maxy - miny) }
}
async function callGoogleVisionOCR(dataUrl: string) {
  if (!GOOGLE_API_KEY) throw new Error("Google API key not configured")
  const body = {
    requests: [
      {
        image: { content: b64FromDataUrl(dataUrl) },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: {}
      }
    ]
  }
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "Vision API failed")
  }
  const json = await res.json()
  return json
}
function extractBlocksFromVision(json: any): { blocks: GBlock[]; fullText: string } {
  const resp = json?.responses?.[0]
  const fullText = resp?.fullTextAnnotation?.text || ""
  const pages = resp?.fullTextAnnotation?.pages || []
  const blocks: GBlock[] = []
  for (const page of pages) {
    const pBlocks = page.blocks || []
    for (const block of pBlocks) {
      let blockText = ""
      const words: GWord[] = []
      const paragraphs = block.paragraphs || []
      for (const para of paragraphs) {
        const pWords = para.words || []
        for (const w of pWords) {
          const syms = w.symbols || []
          const t = syms.map((s: any) => s.text || "").join("")
          const bb = bboxFromVertices(w.boundingBox?.vertices || [])
          if (t) {
            words.push({ text: t, bbox: bb })
            blockText += (blockText ? " " : "") + t
          }
        }
      }
      const bbB = bboxFromVertices(block.boundingBox?.vertices || [])
      const conf = typeof block.confidence === "number" ? block.confidence : 0.9
      if (blockText) blocks.push({ text: blockText, bbox: bbB, words, conf })
    }
  }
  return { blocks, fullText }
}
function normMonthName(s: string): number | null {
  const m = s.toLowerCase()
  const arr = ["january","february","march","april","may","june","july","august","september","october","november","december"]
  const idx = arr.findIndex(v => v === m)
  if (idx >= 0) return idx + 1
  const short = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
  const idx2 = short.findIndex(v => v === m.slice(0,3))
  return idx2 >= 0 ? idx2 + 1 : null
}
function detectMonthYearFromText(fullText: string): { month: number | null; year: number } {
  const now = new Date()
  let month: number | null = null
  let year = now.getFullYear()
  const m1 = fullText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i)
  if (m1) {
    const mm = normMonthName(m1[0])
    if (mm) month = mm
  }
  const y1 = fullText.match(/\b(20\d{2}|19\d{2})\b/)
  if (y1) year = parseInt(y1[0], 10)
  return { month, year }
}
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
function makeISO(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== d) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}
function parseExplicitDates(text: string, monthFallback: number | null, year: number): string[] {
  const out: string[] = []
  const m1 = text.match(/\b(20\d{2}|19\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/g)
  if (m1) {
    for (const s of m1) {
      const [y, m, d] = s.split("-").map(n => parseInt(n, 10))
      const iso = makeISO(y, m, d)
      if (iso) out.push(iso)
    }
  }
  const m2 = text.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])([\/\-](\d{2,4}))?\b/g)
  if (m2) {
    for (const s of m2) {
      const parts = s.split(/[\/\-]/)
      const m = parseInt(parts[0], 10)
      const d = parseInt(parts[1], 10)
      let y = year
      if (parts[2]) {
        const yy = parseInt(parts[2], 10)
        y = yy < 100 ? 2000 + yy : yy
      }
      const iso = makeISO(y, m, d)
      if (iso) out.push(iso)
    }
  }
  const m3 = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+([0-3]?\d)(?:,\s*(\d{4}))?\b/gi)
  if (m3) {
    for (const s of m3) {
      const mm = normMonthName(s.split(/\s+/)[0])
      const d = parseInt((s.match(/\b([0-3]?\d)\b/) || [])[1] || "0", 10)
      const yMatch = s.match(/\b(20\d{2}|19\d{2})\b/)
      const y = yMatch ? parseInt(yMatch[0], 10) : year
      if (mm && d) {
        const iso = makeISO(y, mm, d)
        if (iso) out.push(iso)
      }
    }
  }
  const span1 = text.match(/\b([0-3]?\d)\s*[–\-]\s*([0-3]?\d)\b/)
  if (span1 && monthFallback) {
    const d1 = parseInt(span1[1], 10)
    const d2 = parseInt(span1[2], 10)
    if (d1 >= 1 && d2 >= d1 && d2 <= 31) {
      for (let d = d1; d <= d2; d++) {
        const iso = makeISO(year, monthFallback, d)
        if (iso) out.push(iso)
      }
    }
  }
  const span2 = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+([0-3]?\d)\s*[–\-]\s*([0-3]?\d)\b/i)
  if (span2) {
    const mm = normMonthName(span2[1])
    const d1 = parseInt(span2[2], 10)
    const d2 = parseInt(span2[3], 10)
    if (mm && d1 >= 1 && d2 >= d1 && d2 <= 31) {
      for (let d = d1; d <= d2; d++) {
        const iso = makeISO(year, mm, d)
        if (iso) out.push(iso)
      }
    }
  }
  const uniq = Array.from(new Set(out))
  return uniq
}
function parseTime(text: string): string | null {
  const t1 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (t1) return `${t1[1].padStart(2,"0")}:${t1[2]}`
  const t2 = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i)
  if (t2) {
    let h = parseInt(t2[1], 10)
    const m = t2[2] ? parseInt(t2[2], 10) : 0
    const ap = t2[3].toLowerCase()
    if (ap === "pm" && h !== 12) h += 12
    if (ap === "am" && h === 12) h = 0
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`
  }
  const lc = text.toLowerCase()
  if (/\bnoon\b/.test(lc)) return "12:00"
  if (/\bmidnight\b/.test(lc)) return "00:00"
  return null
}
function inferTag(text: string): string | null {
  const lc = text.toLowerCase()
  if (/\b(interview)\b/.test(lc)) return "Interview"
  if (/\b(final|exam|midterm|test)\b/.test(lc)) return "Exam"
  if (/\bquiz\b/.test(lc)) return "Quiz"
  if (/\b(homework|assignment|practice\s*problems|problems|submission|submit|paper|project)\b/.test(lc)) return "Assignment"
  if (/\bclass|lecture\b/.test(lc)) return "Class"
  if (/\blab\b/.test(lc)) return "Lab"
  if (/\bmeeting\b/.test(lc)) return "Meeting"
  if (/\bappointment|doctor|dentist\b/.test(lc)) return "Appointment"
  if (/\bholiday|break\b/.test(lc)) return "Holiday"
  if (/\bno\s*class\b/.test(lc)) return "No_Class"
  if (/\bschool\s*closed|college\s*closed\b/.test(lc)) return "School_Closed"
  return null
}
function cleanEventName(text: string): string {
  let s = text.replace(/\b(20\d{2}|19\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/g, "")
  s = s.replace(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])([\/\-](\d{2,4}))?\b/g, "")
  s = s.replace(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+[0-3]?\d(,\s*(20\d{2}|19\d{2}))?\b/gi, "")
  s = s.replace(/\b([0-3]?\d)\s*[–\-]\s*([0-3]?\d)\b/g, "")
  s = s.replace(/\s{2,}/g, " ").trim()
  s = s.replace(/^\W+|\W+$/g, "").trim()
  return s
}
function center(pt: { x: number; y: number; w: number; h: number }) {
  return { cx: pt.x + pt.w / 2, cy: pt.y + pt.h / 2 }
}
function dist(a: { cx: number; cy: number }, b: { cx: number; cy: number }) {
  const dx = a.cx - b.cx
  const dy = a.cy - b.cy
  return Math.sqrt(dx*dx + dy*dy)
}
function isLikelyDayWord(w: GWord) {
  return /^[1-9]|[12]\d|3[01]$/.test(w.text) || /^([0-3]?\d)$/.test(w.text)
}
function associateDatesByProximity(blocks: GBlock[], monthFallback: number | null, year: number): Map<number, string[]> {
  const days: { idx: number; d: number; c: { cx: number; cy: number } }[] = []
  blocks.forEach((b, idx) => {
    for (const w of b.words) {
      if (/^\d{1,2}$/.test(w.text)) {
        const dnum = parseInt(w.text, 10)
        if (dnum >= 1 && dnum <= 31) days.push({ idx, d: dnum, c: center(w.bbox) })
      }
    }
  })
  const perBlockDates = new Map<number, string[]>()
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const explicit = parseExplicitDates(b.text, monthFallback, year)
    if (explicit.length) {
      perBlockDates.set(i, explicit)
      continue
    }
    if (!monthFallback) continue
    const bc = center(b.bbox)
    let best = null as { d: number; c: { cx: number; cy: number } } | null
    let bestDist = Infinity
    for (const dw of days) {
      const dd = dist(bc, dw.c)
      if (dd < bestDist) {
        bestDist = dd
        best = dw
      }
    }
    if (best && bestDist < Math.max(b.bbox.w, b.bbox.h) * 1.5) {
      const iso = makeISO(year, monthFallback, best.d)
      if (iso) perBlockDates.set(i, [iso])
    }
  }
  return perBlockDates
}
export class GoogleImageService {
  static async parse(file: File): Promise<ParseResult> {
    if (!GOOGLE_API_KEY) throw new Error("Google API key not configured")
    const originalUrl = await fileToDataURL(file)
    const enhancedUrl = await enhanceImageDataUrl(originalUrl)
    const [json1, json2] = await Promise.all([callGoogleVisionOCR(enhancedUrl), callGoogleVisionOCR(originalUrl)])
    const a1 = extractBlocksFromVision(json1)
    const a2 = extractBlocksFromVision(json2)
    const blocks = [...a1.blocks, ...a2.blocks]
    const fullText = `${a1.fullText}\n${a2.fullText}`
    const my = detectMonthYearFromText(fullText)
    const mapDates = associateDatesByProximity(blocks, my.month, my.year)
    const events: ParsedEvent[] = []
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (!b.text || b.text.trim().length < 2) continue
      const dates = mapDates.get(i) || []
      if (!dates.length) continue
      const name = cleanEventName(b.text)
      if (!name || /^\d+$/.test(name)) continue
      const time = parseTime(b.text)
      const tag = inferTag(b.text)
      for (const d of dates) {
        events.push({ event_name: name, event_date: d, event_time: time, event_tag: tag })
      }
    }
    let out = postNormalizeEvents(events)
    out = out.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    out = dedupeEvents(out)
    out.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events: out, tokensUsed: 0 }
  }
}
