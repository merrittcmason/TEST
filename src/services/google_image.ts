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

const API_KEY =
  (import.meta as any)?.env?.VITE_GOOGLE_VISION_API_KEY ||
  (import.meta as any)?.env?.VITE_GOOGLE_API_KEY ||
  (typeof process !== "undefined"
    ? (process as any)?.env?.VITE_GOOGLE_VISION_API_KEY || (process as any)?.env?.VITE_GOOGLE_API_KEY
    : "")

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
function stripDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(",")
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl
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

type VWord = { text: string; x: number; y: number; minX: number; minY: number; maxX: number; maxY: number }
type VLine = { text: string; words: VWord[]; minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number }

async function visionAnnotate(dataUrl: string) {
  const body = {
    requests: [
      {
        image: { content: stripDataUrl(dataUrl) },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
      }
    ]
  }
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err?.error?.message || "Vision request failed"
    throw new Error(msg)
  }
  return await res.json()
}

function toWordsFromTextAnnotations(ta: any[]): VWord[] {
  const out: VWord[] = []
  for (let i = 1; i < ta.length; i++) {
    const w = ta[i]
    const text: string = w.description || ""
    const v = w.boundingPoly?.vertices || []
    if (!text || v.length < 2) continue
    const xs = v.map((p: any) => p?.x || 0)
    const ys = v.map((p: any) => p?.y || 0)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    out.push({ text, x: (minX + maxX) / 2, y: (minY + maxY) / 2, minX, minY, maxX, maxY })
  }
  return out
}

function clusterLines(words: VWord[]): VLine[] {
  const sorted = [...words].sort((a,b) => a.y - b.y)
  const lines: VLine[] = []
  const rowTolerance = Math.max(8, Math.round((sorted.length ? (sorted[sorted.length-1].y - sorted[0].y) / 120 : 12)))
  for (const w of sorted) {
    let line = lines.find(l => Math.abs(l.cy - w.y) <= rowTolerance && !(w.maxX < l.minX - 6 || w.minX > l.maxX + 6))
    if (!line) {
      line = { text: "", words: [], minX: w.minX, minY: w.minY, maxX: w.maxX, maxY: w.maxY, cx: w.x, cy: w.y }
      lines.push(line)
    }
    line.words.push(w)
    line.minX = Math.min(line.minX, w.minX)
    line.minY = Math.min(line.minY, w.minY)
    line.maxX = Math.max(line.maxX, w.maxX)
    line.maxY = Math.max(line.maxY, w.maxY)
    line.cx = (line.minX + line.maxX) / 2
    line.cy = (line.minY + line.maxY) / 2
  }
  for (const l of lines) {
    l.words.sort((a,b) => a.x - b.x)
    l.text = l.words.map(w => w.text).join(" ").replace(/\s+/g, " ").trim()
  }
  return lines.filter(l => l.text && l.text.length > 0)
}

function monthIndex(token: string): number | null {
  const mFull = ["january","february","march","april","may","june","july","august","september","october","november","december"]
  const mShort = ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"]
  const t = token.toLowerCase()
  const i1 = mFull.indexOf(t)
  if (i1 >= 0) return i1 + 1
  const i2 = mShort.indexOf(t)
  if (i2 >= 0) return [1,2,3,4,5,6,7,8,9,9,10,11,12][i2]
  return null
}

function detectContext(lines: VLine[]) {
  let contextMonth: number | null = null
  let contextYear: number = new Date().getFullYear()
  for (const l of lines) {
    const tokens = l.text.split(/\s+/)
    for (let i = 0; i < tokens.length; i++) {
      const m = monthIndex(tokens[i])
      if (m) {
        contextMonth = m
        const next = tokens[i+1]
        if (next && /^\d{4}$/.test(next)) {
          const y = parseInt(next,10)
          if (y >= 1900 && y <= 2100) contextYear = y
        }
      }
      const yOnly = tokens[i]
      if (/^\d{4}$/.test(yOnly)) {
        const y = parseInt(yOnly,10)
        if (y >= 1900 && y <= 2100) contextYear = y
      }
    }
  }
  return { contextMonth, contextYear }
}

function extractDayCells(words: VWord[], contextMonth: number | null) {
  const days = words.filter(w => /^\d{1,2}$/.test(w.text)).map(w => ({ d: parseInt(w.text,10), ...w }))
  return days.filter(w => w.d >= 1 && w.d <= 31)
}

function isWeekdayHeader(s: string): boolean {
  const t = s.toLowerCase().replace(/[^a-z]/g,"")
  return ["sunday","monday","tuesday","wednesday","thursday","friday","saturday","sun","mon","tue","tues","wed","thu","thur","thurs","fri","sat"].includes(t)
}

function includesTime(s: string): boolean {
  if (/\b(\d{1,2})\s*(a|p)m\b/i.test(s)) return true
  if (/\b(\d{1,2})(?::(\d{2}))\s*(a|p)m\b/i.test(s)) return true
  if (/\b(\d{1,2}):(\d{2})\b/.test(s)) return true
  if (/\b\d{3,4}\s*-\s*\d{3,4}\b/.test(s)) return true
  return false
}

function parseTime(s: string): string | null {
  const m1 = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (m1) {
    let hh = parseInt(m1[1],10)
    const mm = m1[2] ? parseInt(m1[2],10) : 0
    const ap = m1[3].toLowerCase()
    if (ap === "pm" && hh !== 12) hh += 12
    if (ap === "am" && hh === 12) hh = 0
    return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`
  }
  const m2 = s.match(/\b(\d{1,2}):(\d{2})\b/)
  if (m2) {
    return `${String(parseInt(m2[1],10)).padStart(2,"0")}:${String(parseInt(m2[2],10)).padStart(2,"0")}`
  }
  const m3 = s.match(/\b(\d{3,4})\s*-\s*(\d{3,4})\b/)
  if (m3) {
    const toHM = (n: string) => {
      const v = n.padStart(4,"0")
      const hh = parseInt(v.slice(0,2),10)
      const mm = parseInt(v.slice(2),10)
      return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`
    }
    return toHM(m3[1])
  }
  if (/\bnoon\b/i.test(s)) return "12:00"
  if (/\bmidnight\b/i.test(s)) return "00:00"
  return null
}

function isTrashLine(s: string): boolean {
  const t = s.toLowerCase()
  if (!t) return true
  if (t.length <= 2) return true
  if (/^page\s+\d+$/i.test(t)) return true
  if (/^\d+%$/.test(t)) return true
  if (/^print layout$/i.test(t)) return true
  if (isWeekdayHeader(t)) return true
  if (/^\d{1,2}$/.test(t)) return true
  if (/^\d{4}$/.test(t)) return true
  if (/^\w+\s+\w+\s+\w+\s+\w+$/.test(t) && ["wednesday thursday friday saturday","monday tuesday wednesday thursday","sunday monday tuesday wednesday"].includes(t)) return true
  return false
}

function assignEvents(lines: VLine[], dayCells: VWord[], contextMonth: number | null, contextYear: number): ParsedEvent[] {
  const events: ParsedEvent[] = []
  if (!dayCells.length || !contextMonth) return events
  const dY = dayCells.map(d => d.y)
  const rowGap = dY.length > 1 ? (Math.max(...dY) - Math.min(...dY)) / Math.max(3, Math.sqrt(dY.length)) : 24
  for (const l of lines) {
    if (isTrashLine(l.text)) continue
    if (/^\w+$/.test(l.text) && monthIndex(l.text)) continue
    const candidates = dayCells
      .filter(d => d.y <= l.cy + rowGap)
      .map(d => {
        const dx = Math.abs(((d.minX + d.maxX)/2) - l.cx)
        const dy = Math.max(0, l.cy - d.y)
        const score = dy * 2 + dx * 0.25
        return { d, score }
      })
      .sort((a,b) => a.score - b.score)
    if (!candidates.length) continue
    const day = candidates[0].d.d
    const date = `${String(contextYear).padStart(4,"0")}-${String(contextMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`
    const time = parseTime(l.text)
    const name = l.text.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/ig,"").replace(/\b(\d{1,2}):(\d{2})\b/g,"").replace(/\b\d{3,4}\s*-\s*\d{3,4}\b/g,"").replace(/^\W+|\W+$/g,"").trim() || "Event"
    events.push({ event_name: name, event_date: date, event_time: time, event_tag: null })
  }
  return events
}

function fallbackParsePlain(plain: string): ParsedEvent[] {
  const year = new Date().getFullYear()
  const lines = (plain || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  let month: number | null = null
  let cYear = year
  const out: ParsedEvent[] = []
  for (const s of lines) {
    const toks = s.split(/\s+/)
    for (let i=0;i<toks.length;i++) {
      const m = monthIndex(toks[i])
      if (m) {
        month = m
        const n = toks[i+1]
        if (n && /^\d{4}$/.test(n)) cYear = parseInt(n,10)
      }
    }
    const mSlash = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)
    if (mSlash) {
      const mm = parseInt(mSlash[1],10), dd = parseInt(mSlash[2],10)
      let yy = mSlash[3] ? parseInt(mSlash[3],10) : cYear
      if (yy < 100) yy += 2000
      if (mm>=1 && mm<=12 && dd>=1 && dd<=31) {
        const date = `${String(yy).padStart(4,"0")}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`
        const time = parseTime(s)
        const name = s.replace(mSlash[0],"").replace(/^\W+|\W+$/g,"").trim() || "Event"
        out.push({ event_name: name, event_date: date, event_time: time, event_tag: null })
      }
      continue
    }
    const mDay = s.match(/^\s*(\d{1,2})(?:st|nd|rd|th)?\b/)
    if (mDay && month) {
      const dd = parseInt(mDay[1],10)
      if (dd>=1 && dd<=31) {
        const date = `${String(cYear).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(dd).padStart(2,"0")}`
        const time = parseTime(s)
        const name = s.replace(mDay[0],"").replace(/^\W+|\W+$/g,"").trim() || "Event"
        out.push({ event_name: name, event_date: date, event_time: time, event_tag: null })
      }
      continue
    }
  }
  return out
}

export class GoogleImageService {
  static async parse(file: File): Promise<ParseResult> {
    const dataUrl = await fileToDataURL(file)
    let usedVision = false
    let events: ParsedEvent[] = []
    if (API_KEY && typeof window !== "undefined") {
      try {
        const json = await visionAnnotate(dataUrl)
        const ta = json?.responses?.[0]?.textAnnotations || []
        const words = toWordsFromTextAnnotations(ta)
        const lines = clusterLines(words)
        const ctx = detectContext(lines)
        const dayCells = extractDayCells(words, ctx.contextMonth)
        const anchored = assignEvents(lines, dayCells, ctx.contextMonth, ctx.contextYear)
        events = anchored
        usedVision = true
        if (!events.length) {
          const plain = json?.responses?.[0]?.fullTextAnnotation?.text || ta?.[0]?.description || ""
          events = fallbackParsePlain(plain || "")
        }
      } catch {
        const plain = await tesseractOCR(dataUrl)
        events = fallbackParsePlain(plain || "")
      }
    } else {
      const plain = await tesseractOCR(dataUrl)
      events = fallbackParsePlain(plain || "")
    }
    events = dedupeEvents(postNormalizeEvents(events)).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed: 0 }
  }
}
