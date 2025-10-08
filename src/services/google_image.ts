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

type Pt = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }
type Word = { text: string; box: Box }
type Line = { text: string; box: Box; words: Word[] }

const VISION_KEY = import.meta.env.VITE_GOOGLE_VISION_API_KEY

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"]
const WDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]
const STOP_TITLES = new Set([
  "print layout","notes","november","october","december","monday tuesday","wednesday thursday friday saturday",
  "this document contains ink , shapes and images that are not accessible","calendar","schedule","today","month",
  "sun","mon","tue","tues","wed","thu","thur","thurs","fri","sat"
])

function toTitleCase(s: string): string {
  return (s || "").trim().replace(/\s+/g," ").split(" ").map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():"").join(" ")
}

function capTag(t: string | null | undefined): string | null {
  if (!t) return null
  const s = t.trim()
  if (!s) return null
  return s[0].toUpperCase()+s.slice(1).toLowerCase()
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve,reject)=>{
    const r=new FileReader()
    r.onload=()=>resolve(r.result as string)
    r.onerror=reject
    r.readAsDataURL(file)
  })
}

function parseVertexes(v: any[]): Box {
  const xs = v.map(p=>p.x||0), ys = v.map(p=>p.y||0)
  const minx = Math.min(...xs), maxx = Math.max(...xs)
  const miny = Math.min(...ys), maxy = Math.max(...ys)
  return { x:minx, y:miny, w:maxx-minx, h:maxy-miny }
}

function center(b: Box): Pt {
  return { x: b.x + b.w/2, y: b.y + b.h/2 }
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x,b.x), y1 = Math.max(a.y,b.y)
  const x2 = Math.min(a.x+a.w,b.x+b.w), y2 = Math.min(a.y+a.h,b.y+b.h)
  const w = Math.max(0,x2-x1), h = Math.max(0,y2-y1)
  const inter = w*h
  const u = a.w*a.h + b.w*b.h - inter
  return u<=0?0:inter/u
}

function norm(s: string): string {
  return s.replace(/\s+/g," ").trim()
}

function cleanName(s: string): string {
  let t = norm(s)
  t = t.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi,"").replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/gi,"").replace(/\b\d{1,2}:\d{2}\b/gi,"").replace(/\b\d{3,4}\s*(?:am|pm)\b/gi,"").replace(/\b\d{1,2}\s*(?:am|pm)\b/gi,"")
  t = t.replace(/[|#]+/g," ").replace(/\s{2,}/g," ").trim()
  if (!/[a-z]/i.test(t)) return ""
  if (STOP_TITLES.has(t.toLowerCase())) return ""
  if (t.length>60) t = t.slice(0,57).trimEnd()+"..."
  return toTitleCase(t)
}

function pickTag(s: string): string | null {
  const x = s.toLowerCase()
  if (/\bquiz\b/.test(x)) return "Quiz"
  if (/\bexam|final|test\b/.test(x)) return "Exam"
  if (/\blab\b/.test(x)) return "Lab"
  if (/\bmeeting\b/.test(x)) return "Meeting"
  if (/\bclass|lecture\b/.test(x)) return "Class"
  if (/\bassignment|homework|hw|project|deadline|submit|due\b/.test(x)) return "Assignment"
  if (/\bonboarding\b/.test(x)) return "Other"
  return null
}

function parseTime(s: string): string | null {
  const str = s.toLowerCase().replace(/\s+/g," ").trim()
  if (/noon\b/.test(str)) return "12:00"
  if (/midnight\b/.test(str)) return "00:00"
  const m1 = str.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i)
  if (m1) {
    let h = parseInt(m1[1],10), mm = parseInt(m1[2],10)
    const ap = m1[3].toLowerCase()
    if (ap==="pm" && h!==12) h+=12
    if (ap==="am" && h===12) h=0
    return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`
  }
  const m2 = str.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  if (m2) {
    let h = parseInt(m2[1],10)
    const ap = m2[2].toLowerCase()
    if (ap==="pm" && h!==12) h+=12
    if (ap==="am" && h===12) h=0
    return `${String(h).padStart(2,"0")}:00`
  }
  const m3 = str.match(/\b(\d{3,4})\s*-\s*(\d{3,4})\b/)
  if (m3) {
    const n = m3[1]
    const h = n.length===3?parseInt(n[0],10):parseInt(n.slice(0,2),10)
    const mm = parseInt(n.slice(-2),10)
    if (h>=0&&h<24&&mm>=0&&mm<60) return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`
  }
  const m4 = str.match(/\b(\d{1,2}):(\d{2})\b/)
  if (m4) return `${String(parseInt(m4[1],10)).padStart(2,"0")}:${String(parseInt(m4[2],10)).padStart(2,"0")}`
  const m5 = str.match(/\b(\d{1,2})a\b/i)
  if (m5) return `${String(parseInt(m5[1],10)).padStart(2,"0")}:00`
  const m6 = str.match(/\b(\d{1,2})p\b/i)
  if (m6) {
    let h = parseInt(m6[1],10)
    if (h!==12) h+=12
    return `${String(h).padStart(2,"0")}:00`
  }
  return null
}

function detectMonthYear(lines: Line[]): { month: number | null; year: number } {
  const now = new Date()
  let month: number | null = null
  let year = now.getFullYear()
  for (const ln of lines) {
    const t = ln.text.toLowerCase()
    const ym = t.match(/\b(19|20)\d{2}\b/)
    if (ym) year = parseInt(ym[0],10)
    for (let i=0;i<MONTHS.length;i++) {
      const m = MONTHS[i]
      if (new RegExp(`\\b${m}\\b`,"i").test(t)) { month = i+1; break }
    }
  }
  return { month, year }
}

function isDayNumberToken(t: string): boolean {
  if (!/^\d{1,2}$/.test(t)) return false
  const n = parseInt(t,10)
  return n>=1 && n<=31
}

function buildLines(words: Word[]): Line[] {
  if (!words.length) return []
  const sorted = [...words].sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x)
  const lines: Line[] = []
  const yThresh = Math.max(6, Math.round(median(sorted.map(w=>w.box.h))*0.8))
  let cur: Word[] = []
  let lastY = sorted[0].box.y
  for (const w of sorted) {
    if (Math.abs(w.box.y - lastY) <= yThresh) {
      cur.push(w)
    } else {
      lines.push(makeLine(cur))
      cur = [w]
      lastY = w.box.y
    }
  }
  if (cur.length) lines.push(makeLine(cur))
  return lines.map(l=>{
    const txt = norm(l.text.replace(/\s{2,}/g," "))
    return { ...l, text: txt }
  })
}

function makeLine(ws: Word[]): Line {
  const sorted = ws.slice().sort((a,b)=>a.box.x-b.box.x)
  const text = sorted.map(w=>w.text).join(" ")
  const x1 = Math.min(...sorted.map(w=>w.box.x)), y1 = Math.min(...sorted.map(w=>w.box.y))
  const x2 = Math.max(...sorted.map(w=>w.box.x+w.box.w)), y2 = Math.max(...sorted.map(w=>w.box.y+w.box.h))
  return { text, words: sorted, box: { x:x1, y:y1, w:x2-x1, h:y2-y1 } }
}

function median(arr: number[]): number {
  if (!arr.length) return 0
  const a = [...arr].sort((x,y)=>x-y)
  const m = Math.floor(a.length/2)
  return a.length%2?a[m]:(a[m-1]+a[m])/2
}

function distance(a: Pt, b: Pt): number {
  const dx = a.x-b.x, dy=a.y-b.y
  return Math.sqrt(dx*dx+dy*dy)
}

function parseExplicitDate(s: string, fallbackYear: number): string | null {
  const m1 = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)
  if (m1) {
    let mm = parseInt(m1[1],10), dd = parseInt(m1[2],10)
    let yy = m1[3]?parseInt(m1[3],10):fallbackYear
    if (yy<100) yy+=2000
    if (mm>=1&&mm<=12&&dd>=1&&dd<=31) return `${String(yy).padStart(4,"0")}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`
  }
  const m2 = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i)
  if (m2) {
    const mm = ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"].indexOf(m2[1].toLowerCase())
    const dd = parseInt(m2[2],10)
    const mReal = mm===8?9:mm>=0?mm+1:null
    if (mReal && dd>=1&&dd<=31) return `${String(fallbackYear).padStart(4,"0")}-${String(mReal).padStart(2,"0")}-${String(dd).padStart(2,"0")}`
  }
  return null
}

async function visionOCR(dataUrl: string) {
  const payload = {
    requests: [{
      image: { content: dataUrl.split(",")[1] },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
    }]
  }
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error("Google Vision request failed")
  const data = await res.json()
  return data
}

function extractWords(visionJson: any): Word[] {
  const words: Word[] = []
  const pages = visionJson?.responses?.[0]?.fullTextAnnotation?.pages || []
  for (const p of pages) {
    for (const b of p.blocks||[]) {
      for (const par of b.paragraphs||[]) {
        for (const w of par.words||[]) {
          const text = (w.symbols||[]).map((s:any)=>s.text||"").join("")
          if (!text) continue
          const box = parseVertexes((w.boundingBox?.vertices)||[])
          words.push({ text, box })
        }
      }
    }
  }
  const anns = visionJson?.responses?.[0]?.textAnnotations
  if (!words.length && Array.isArray(anns) && anns.length>1) {
    for (let i=1;i<anns.length;i++) {
      const a = anns[i]
      const t = a.description||""
      if (!t.trim()) continue
      const box = parseVertexes((a.boundingPoly?.vertices)||[])
      t.split(/\s+/).forEach(tok=>{
        if (!tok) return
        words.push({ text: tok, box })
      })
    }
  }
  return words
}

function anchorCalendarEvents(lines: Line[], year: number, hintedMonth: number | null): ParsedEvent[] {
  const dayTokens: { n:number; box: Box }[] = []
  for (const ln of lines) {
    for (const w of ln.words) {
      if (isDayNumberToken(w.text)) dayTokens.push({ n: parseInt(w.text,10), box: w.box })
    }
  }
  if (!dayTokens.length) return []
  const ys = dayTokens.map(d=>d.box.y)
  const rowGap = Math.max(8, Math.round(median(dayTokens.map(d=>d.box.h))*1.5))
  const rows: { y:number; items: { n:number; box:Box }[] }[] = []
  dayTokens.sort((a,b)=>a.box.y-b.box.y)
  for (const dt of dayTokens) {
    const placed = rows.find(r=>Math.abs(r.y - dt.box.y) <= rowGap)
    if (placed) placed.items.push(dt)
    else rows.push({ y: dt.box.y, items:[dt] })
  }
  rows.forEach(r=>r.items.sort((a,b)=>a.box.x-b.box.x))
  const dateCells: { box: Box; date: string }[] = []
  for (const r of rows) {
    for (const d of r.items) {
      let month = hintedMonth
      if (!month) {
        const candidates = [hintedMonth||0]
        month = candidates[0] || new Date().getMonth()+1
      }
      const dd = d.n
      const date = `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(dd).padStart(2,"0")}`
      dateCells.push({ box: d.box, date })
    }
  }
  const events: ParsedEvent[] = []
  for (const ln of lines) {
    const explicit = parseExplicitDate(ln.text, year)
    const rawName = cleanName(ln.text)
    if (!rawName) continue
    let event_date: string | null = explicit
    if (!event_date) {
      const c = center(ln.box)
      let best: { date:string; dist:number } | null = null
      for (const cell of dateCells) {
        const d = distance(c, center(cell.box))
        if (!best || d<best.dist) best = { date: cell.date, dist: d }
      }
      event_date = best?.date || null
    }
    if (!event_date) continue
    const t = parseTime(ln.text)
    const tag = pickTag(rawName)
    events.push({ event_name: rawName, event_date, event_time: t, event_tag: capTag(tag) })
  }
  return events
}

function filterNoise(lines: Line[]): Line[] {
  return lines.filter(ln=>{
    const t = ln.text.trim()
    const tl = t.toLowerCase()
    if (!t) return false
    if (STOP_TITLES.has(tl)) return false
    if (/^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat))*$/i.test(tl)) return false
    if (/^\d{1,2}\s*:\s*\d{1,2}\s*\d$/.test(t)) return false
    if (/^[\d\s/:#\-]+$/.test(tl)) return false
    if (t.length<2 && !/[a-z]/i.test(t)) return false
    return true
  })
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>()
  const out: ParsedEvent[] = []
  for (const e of events) {
    const key = `${(e.event_name||"").toLowerCase()}|${e.event_date}|${e.event_time||""}|${e.event_tag||""}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(e)
    }
  }
  return out
}

function postNormalize(events: ParsedEvent[]): ParsedEvent[] {
  return events.map(e=>{
    let n = e.event_name
    n = n.replace(/\s{2,}/g," ").trim()
    n = toTitleCase(n)
    if (n.length>60) n = n.slice(0,57).trimEnd()+"..."
    return { ...e, event_name: n, event_tag: capTag(e.event_tag) }
  })
}

export class GoogleImageService {
  static async parse(file: File): Promise<ParseResult> {
    if (!VISION_KEY) throw new Error("Google Vision API key not configured")
    const dataUrl = await fileToDataURL(file)
    const visionJson = await visionOCR(dataUrl)
    const words = extractWords(visionJson)
    if (!words.length) return { events: [], tokensUsed: 0 }
    const lines = buildLines(words)
    const useful = filterNoise(lines)
    const { month, year } = detectMonthYear(lines)
    const anchored = anchorCalendarEvents(useful, year, month)
    const explicitOnly: ParsedEvent[] = []
    for (const ln of useful) {
      const d = parseExplicitDate(ln.text, year)
      if (d) {
        const nm = cleanName(ln.text)
        if (!nm) continue
        explicitOnly.push({
          event_name: nm,
          event_date: d,
          event_time: parseTime(ln.text),
          event_tag: pickTag(nm)
        })
      }
    }
    let events = anchored.concat(explicitOnly)
    events = events.filter(e=>e.event_date && e.event_name && !STOP_TITLES.has((e.event_name||"").toLowerCase()))
    events = postNormalize(dedupeEvents(events))
    events.sort((a,b)=>a.event_date.localeCompare(b.event_date) || ((a.event_time||"23:59").localeCompare(b.event_time||"23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed: 0 }
  }
}
