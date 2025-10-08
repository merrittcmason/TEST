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

const API_KEY = (import.meta as any)?.env?.VITE_GOOGLE_VISION_API_KEY || (import.meta as any)?.env?.VITE_GOOGLE_API_KEY || (typeof process !== "undefined" ? (process as any)?.env?.VITE_GOOGLE_VISION_API_KEY || (process as any)?.env?.VITE_GOOGLE_API_KEY : "")

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
async function visionOCR(dataUrl: string): Promise<string> {
  const body = {
    requests: [
      {
        image: { content: stripDataUrl(dataUrl) },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }, { type: "TEXT_DETECTION" }]
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
  const json = await res.json()
  const text = json?.responses?.[0]?.fullTextAnnotation?.text || json?.responses?.[0]?.textAnnotations?.[0]?.description || ""
  return String(text || "").trim()
}
function parseOcrToEvents(ocr: string): ParsedEvent[] {
  const lines = (ocr || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const events: ParsedEvent[] = []
  const year = new Date().getFullYear()
  const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december","jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"]
  let contextMonth: number | null = null
  let contextYear: number = year
  for (const raw of lines) {
    const s = raw.replace(/\s+/g, " ")
    const mMonth = s.toLowerCase().match(new RegExp(`\\b(${monthNames.join("|")})\\b\\s*(\\d{4})?`))
    if (mMonth) {
      const token = mMonth[1].toLowerCase()
      const idxFull = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(token)
      const idxShort = ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"].indexOf(token)
      const mm = idxFull >= 0 ? idxFull + 1 : (idxShort >= 0 ? (idxShort >= 0 && idxShort <= 10 ? [1,2,3,4,5,6,7,8,9,9,10,11,12][idxShort] : null) : null)
      if (mm) contextMonth = mm
      if (mMonth[2]) {
        const y = parseInt(mMonth[2], 10)
        if (y >= 1900 && y <= 2100) contextYear = y
      }
      continue
    }
    const mSlash = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)
    if (mSlash) {
      const mm = parseInt(mSlash[1], 10)
      const dd = parseInt(mSlash[2], 10)
      let yy = mSlash[3] ? parseInt(mSlash[3], 10) : contextYear
      if (yy < 100) yy += 2000
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const date = `${String(yy).padStart(4,"0")}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`
        const name = s.replace(mSlash[0], "").replace(/^\W+|\W+$/g, "").trim() || "Event"
        const timeMatch = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || s.match(/\b(\d{1,2}):(\d{2})\b/)
        let time: string | null = null
        if (timeMatch) {
          if (timeMatch[3]) {
            let hh = parseInt(timeMatch[1],10)
            const mm2 = timeMatch[2] ? parseInt(timeMatch[2],10) : 0
            const ap = timeMatch[3].toLowerCase()
            if (ap === "pm" && hh !== 12) hh += 12
            if (ap === "am" && hh === 12) hh = 0
            time = `${String(hh).padStart(2,"0")}:${String(mm2).padStart(2,"0")}`
          } else {
            time = `${String(parseInt(timeMatch[1],10)).padStart(2,"0")}:${String(parseInt(timeMatch[2],10)).padStart(2,"0")}`
          }
        }
        events.push({ event_name: name, event_date: date, event_time: time, event_tag: null })
        continue
      }
    }
    const mDayOnly = s.match(/^\s*(\d{1,2})(?:st|nd|rd|th)?\b/)
    if (mDayOnly && contextMonth) {
      const dd = parseInt(mDayOnly[1],10)
      if (dd>=1 && dd<=31) {
        const date = `${String(contextYear).padStart(4,"0")}-${String(contextMonth).padStart(2,"0")}-${String(dd).padStart(2,"0")}`
        const rest = s.replace(mDayOnly[0], "").replace(/^\W+|\W+$/g, "").trim() || "Event"
        const timeMatch = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || s.match(/\b(\d{1,2}):(\d{2})\b/)
        let time: string | null = null
        if (timeMatch) {
          if (timeMatch[3]) {
            let hh = parseInt(timeMatch[1],10)
            const mm2 = timeMatch[2] ? parseInt(timeMatch[2],10) : 0
            const ap = timeMatch[3].toLowerCase()
            if (ap === "pm" && hh !== 12) hh += 12
            if (ap === "am" && hh === 12) hh = 0
            time = `${String(hh).padStart(2,"0")}:${String(mm2).padStart(2,"0")}`
          } else {
            time = `${String(parseInt(timeMatch[1],10)).padStart(2,"0")}:${String(parseInt(timeMatch[2],10)).padStart(2,"0")}`
          }
        }
        events.push({ event_name: rest, event_date: date, event_time: time, event_tag: null })
        continue
      }
    }
    const mSpan = s.match(/\b([A-Za-z]+)\s+(\d{1,2})\s*[–\-to]+\s*(\d{1,2})\b/i)
    if (mSpan) {
      const monToken = mSpan[1].toLowerCase()
      const idxFull = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(monToken)
      const idxShort = ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"].indexOf(monToken)
      const mm = idxFull >= 0 ? idxFull + 1 : (idxShort >= 0 ? (idxShort >= 0 && idxShort <= 10 ? [1,2,3,4,5,6,7,8,9,9,10,11,12][idxShort] : null) : null)
      if (mm) {
        const d1 = parseInt(mSpan[2],10)
        const d2 = parseInt(mSpan[3],10)
        const low = Math.min(d1,d2)
        const high = Math.max(d1,d2)
        const name = s.replace(mSpan[0], "").replace(/^\W+|\W+$/g, "").trim() || "Event"
        for (let d = low; d <= high; d++) {
          const date = `${String(contextYear).padStart(4,"0")}-${String(mm).padStart(2,"0")}-${String(d).padStart(2,"0")}`
          events.push({ event_name: name, event_date: date, event_time: null, event_tag: null })
        }
        continue
      }
    }
  }
  return events
}

export class GoogleImageService {
  static async parse(file: File): Promise<ParseResult> {
    const dataUrl = await fileToDataURL(file)
    let text = ""
    let usedVision = false
    if (API_KEY && typeof window !== "undefined") {
      try {
        text = await visionOCR(dataUrl)
        usedVision = true
      } catch {
        text = await tesseractOCR(dataUrl)
      }
    } else {
      text = await tesseractOCR(dataUrl)
    }
    const events = dedupeEvents(postNormalizeEvents(parseOcrToEvents(text))).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed: usedVision ? 0 : 0 }
  }
}
