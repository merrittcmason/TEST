// src/services/openaiStandard.ts

import mammoth from "mammoth"
import * as XLSX from "xlsx"
import * as pdfjsLib from "pdfjs-dist"
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
import * as chrono from "chrono-node"
import { DateTime } from "luxon"

GlobalWorkerOptions.workerSrc = pdfWorker

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
const MAX_CONTENT_TOKENS = 8000
const MAX_LINES_PER_TEXT_BATCH = 45
const MAX_CHARS_PER_TEXT_BATCH = 2000
const MAX_PDF_PAGES = 12
const PDF_PAGES_PER_VISION_BATCH = 1
const VISION_RENDER_SCALE = 1.5
const VISION_MODEL = "gpt-4o"
const TEXT_MODEL = "gpt-4o"
const MAX_TOKENS_TEXT = 700
const MAX_TOKENS_VISION = 800
const BATCH_EVENT_CAP = 500

type AIDebugInfo = {
  mode: "text" | "vision"
  model: string
  batchIndex: number
  totalBatches: number
  systemPromptFirst400: string
  userContentFirst1200?: string
  userContentLength?: number
  imageCount?: number
  rawResponseFirst2000?: string
  rawResponseLength?: number
  parseError?: {
    message: string
    pos?: number
    line?: number
    col?: number
    excerpt?: string
  }
}

let lastAIBatches: AIDebugInfo[] = []
if (typeof window !== "undefined" && !(window as any).__AI_DEBUG__) {
  ;(window as any).__AI_DEBUG__ = () => lastAIBatches
}

/* ─────────────────────────────
   Small utils
   ───────────────────────────── */

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4)
}

function toTitleCase(s: string): string {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ")
}

function capTag(t: string | null | undefined): string | null {
  if (!t || typeof t !== "string") return null
  const s = t.trim()
  if (!s) return null
  return s[0].toUpperCase() + s.slice(1).toLowerCase()
}

function canonicalizeName(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function normHeader(h: string): string {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function pickKey(headers: string[], aliases: string[]): string | null {
  const normed = headers.map(normHeader)
  const set = new Set(normed)
  for (const a of aliases) if (set.has(a)) return a
  for (let i = 0; i < headers.length; i++) {
    const n = normed[i]
    if (aliases.some((a) => n.includes(a))) return n
  }
  return null
}

/* ─────────────────────────────
   Date / time normalization
   ───────────────────────────── */

function normDate(input: any): string | null {
  if (input == null || input === "") return null
  if (typeof input === "number") {
    const d = XLSX.SSF.parse_date_code(input as any)
    if (!d) return null
    const dt = DateTime.fromObject({ year: d.y, month: d.m, day: d.d })
    return dt.isValid ? dt.toFormat("yyyy-LL-dd") : null
  }
  const s = String(input).trim()
  if (!s) return null
  const iso = DateTime.fromISO(s)
  if (iso.isValid) return iso.toFormat("yyyy-LL-dd")
  const us1 = DateTime.fromFormat(s, "M/d/yyyy")
  if (us1.isValid) return us1.toFormat("yyyy-LL-dd")
  const us2 = DateTime.fromFormat(s, "M/d/yy")
  if (us2.isValid) return us2.toFormat("yyyy-LL-dd")
  const md = DateTime.fromFormat(s, "M/d")
  if (md.isValid) return md.set({ year: DateTime.now().year }).toFormat("yyyy-LL-dd")
  const parsed = chrono.parseDate(s, new Date(), { forwardDate: true })
  if (parsed) return DateTime.fromJSDate(parsed).toFormat("yyyy-LL-dd")
  return null
}

function serialToTime(d: XLSX.SSF$Date): string | null {
  const hh = d.H || d.h || 0
  const mm = d.M || d.m || 0
  const ss = d.S || d.s || 0
  if (hh === 0 && mm === 0 && ss === 0) return null
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

function normTime(input: any): string | null {
  if (input == null) return null
  if (typeof input === "number") {
    const d = XLSX.SSF.parse_date_code(input as any)
    if (d) {
      const t = serialToTime(d)
      if (t) return t
    }
  }
  let raw = String(input).trim()
  if (!raw || raw === "--:-- --") return null
  raw = raw.replace(/[–—−-]+/g, "-")
  const range = raw.match(/^([^-\u2013\u2014]+)\s*-\s*.+$/i)
  if (range) raw = range[1].trim()
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    const [h, m] = raw.split(":")
    return `${String(Number(h)).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`
  }
  const ampm1 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
  if (ampm1) {
    let hh = parseInt(ampm1[1], 10)
    const mm = ampm1[2] ? parseInt(ampm1[2], 10) : 0
    const ap = ampm1[3].toLowerCase()
    if (ap === "pm" && hh !== 12) hh += 12
    if (ap === "am" && hh === 12) hh = 0
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
  }
  const ampm2 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i)
  if (ampm2) {
    let hh = parseInt(ampm2[1], 10)
    const mm = parseInt(ampm2[2], 10)
    const ap = ampm2[3].toLowerCase()
    if (ap === "pm" && hh !== 12) hh += 12
    if (ap === "am" && hh === 12) hh = 0
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
  }
  const lower = raw.toLowerCase()
  if (lower === "noon") return "12:00"
  if (lower === "midnight") return "00:00"
  const iso = DateTime.fromISO(raw)
  if (iso.isValid) return iso.toFormat("HH:mm")
  return null
}

function extractTimeFromDateCell(input: any): string | null {
  if (typeof input === "number") {
    const d = XLSX.SSF.parse_date_code(input as any)
    if (d) return serialToTime(d)
  }
  const s = String(input ?? "").trim()
  if (!s) return null
  const dt = DateTime.fromISO(s)
  if (dt.isValid && (dt.hour || dt.minute || dt.second)) return dt.toFormat("HH:mm")
  const m = s.match(/(\d{1,2}(:\d{2})?\s*(am|pm))/i) || s.match(/(\d{1,2}:\d{2})/)
  if (m) return normTime(m[1])
  return null
}

/* ─────────────────────────────
   Post-normalization + smarter dedupe
   ───────────────────────────── */

function postNormalizeEvents(events: ParsedEvent[]): ParsedEvent[] {
  return (events || []).map((e) => {
    let name = (e.event_name || "").trim()
    name = toTitleCase(
      name
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .replace(/[–—]/g, "-")
        .replace(/\s*-\s*/g, " - ")
        .trim()
    ).replace(/\s{2,}/g, " ")
    if (name.length > 60) name = name.slice(0, 57).trimEnd() + "..."
    const event_time = typeof e.event_time === "string" && e.event_time.trim() === "" ? null : e.event_time
    const event_tag = capTag(e.event_tag ?? null)
    return { event_name: name, event_date: e.event_date, event_time, event_tag }
  })
}

/** Remove exact dupes (same name+date+time+tag) */
function dedupeEventsStrict(events: ParsedEvent[]): ParsedEvent[] {
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

/** Heuristic: drop “roll-up” composite names when atomic siblings exist on the same date. */
function dropCompositeRollups(events: ParsedEvent[]): ParsedEvent[] {
  const byDate = new Map<string, ParsedEvent[]>()
  for (const e of events) {
    const arr = byDate.get(e.event_date) || []
    arr.push(e)
    byDate.set(e.event_date, arr)
  }

  // patterns like:
  //  - "Practice Problems 1.1, 1.2, 1.3, 1.5"
  //  - "Practice Problems- 3.6 & 3.7"
  //  - "Lab-Chapter 3 & Discussion Board Module 2"
  const numberListRe = /^\s*(.+?)\s*[-: ]\s*((?:\d+(?:\.\d+)?)(?:\s*(?:,|&|and)\s*\d+(?:\.\d+)?)+)\s*$/i
  const andJoinRe = /\s*(?:,|&|and)\s*/i

  const keep: ParsedEvent[] = []

  for (const [date, list] of byDate.entries()) {
    const nameSet = new Set(list.map((e) => canonicalizeName(e.event_name)))

    const isComposite = (name: string): boolean => {
      const low = name.toLowerCase()
      return /,|&|\band\b/.test(low)
    }

    const decomposeNumberRollup = (name: string):
      | { base: string; parts: string[] }
      | null => {
      const m = name.match(numberListRe)
      if (!m) return null
      const base = m[1].trim()
      const partNums = m[2].split(andJoinRe).map((s) => s.trim())
      return { base, parts: partNums }
    }

    for (const e of list) {
      const cname = canonicalizeName(e.event_name)

      // Case A: numeric roll-up like "Practice Problems - 1.1, 1.2"
      const roll = decomposeNumberRollup(e.event_name)
      if (roll) {
        const candidates = roll.parts.map((p) =>
          canonicalizeName(`${roll.base} ${p}`)
        )
        const allExist = candidates.every((c) => nameSet.has(c))
        if (allExist) continue // drop composite
      }

      // Case B: multi-task roll-up like "Quiz & Discussion Board"
      if (isComposite(e.event_name)) {
        // If we can spot at least TWO atomic siblings whose names appear as substrings
        // after normalizing separators, drop this composite.
        const normalized = e.event_name
          .replace(/\s*[,;]&?\s*/g, " & ")
          .replace(/\s+and\s+/gi, " & ")
          .split("&")
          .map((s) => canonicalizeName(s))
          .map((s) => s.trim())
          .filter(Boolean)

        // Build a quick “contains” check using startswith/suffix and exact
        const atomicHits = normalized.filter((piece) =>
          Array.from(nameSet).some((nm) => nm === piece || nm.includes(piece) || piece.includes(nm))
        )
        if (atomicHits.length >= 2) continue // drop composite
      }

      keep.push(e)
    }
  }

  return dedupeEventsStrict(keep)
}

/** Prefer 23:59 when one copy is null-time and another is "23:59". */
function preferDueTime(events: ParsedEvent[]): ParsedEvent[] {
  const byKey = new Map<string, ParsedEvent>()
  for (const e of events) {
    const key = `${canonicalizeName(e.event_name)}|${e.event_date}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, e)
      continue
    }
    const best =
      existing.event_time === "23:59" ? existing :
      e.event_time === "23:59" ? e :
      existing.event_time ? existing :
      e.event_time ? e : existing
    byKey.set(key, best)
  }
  return Array.from(byKey.values())
}

function finalDedupe(events: ParsedEvent[]): ParsedEvent[] {
  let out = postNormalizeEvents(events)
  out = dedupeEventsStrict(out)
  out = dropCompositeRollups(out) // kill “X & Y” / comma roll-ups when atomics exist
  out = preferDueTime(out)       // unify null vs 23:59 preference
  out = dedupeEventsStrict(out)
  return out
}

/* ─────────────────────────────
   Debug helpers
   ───────────────────────────── */

function positionToLineCol(s: string, pos: number) {
  let line = 1
  let col = 1
  for (let i = 0; i < pos && i < s.length; i++) {
    if (s[i] === "\n") {
      line++
      col = 1
    } else col++
  }
  return { line, col }
}
function excerptAround(s: string, pos: number, radius = 120) {
  const start = Math.max(0, pos - radius)
  const end = Math.min(s.length, pos + radius)
  const snippet = s.slice(start, end)
  const caret = " ".repeat(Math.max(0, pos - start)) + "^"
  return `${snippet}\n${caret}`
}

/* ─────────────────────────────
   System prompts
   ───────────────────────────── */

const TEXT_SYSTEM_PROMPT = `You are an event extractor for schedules and syllabi.
Input is normalized text lines (some are flattened table rows joined with "|").
Ignore noisy tokens like single-letter weekdays (M, T, W, Th, F), section/room codes, locations, instructor names, emails, and URLs.
Extract ONLY dated events/assignments with concise names.
Rules:
- Output schema ONLY: { "events": [ { "event_name": "Title-Case Short Name", "event_date": "YYYY-MM-DD", "event_time": "HH:MM" | null, "event_tag": "Interview|Exam|Midterm|Quiz|Homework|Assignment|Class|Lecture|Lab|Meeting|Appointment|Holiday|Break|No_Class|School_Closed|Other" | null } ] }
- Title-Case, professional, ≤ 40 chars; no dates/times/pronouns/descriptions in names. Do not include section numbers, room/location, URLs, instructor names, or extra notes in event_name.
- Use current year if missing (${new Date().getFullYear()}).
- Accept dates like YYYY-MM-DD, MM/DD, M/D, "Oct 5", "October 5".
- Times: "12 pm", "12:00pm", "12–1 pm", "noon"→"12:00", "midnight"→"00:00", ranges use start.
- If text implies due/submit/turn-in and no time, use "23:59".
- If no time in the line, event_time = null.
- If a row lists multiple items for the same date (separated by columns or "|"), output one event per item. Do not output combined names.
- Preserve section/chapter decimals exactly, e.g., "2.5" must not be shortened to ".5".
- Never output a combined roll-up like "Item A & Item B" when the individual items are present; only output the individuals.
Return ONLY valid JSON. No commentary, no markdown, no trailing commas.`

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
- When multiple items appear in the same dated row/cell, output separate events; do not combine into "A & B".
- If one line lists multiple sections for the SAME assignment (e.g., "Practice problems — sections 5.1 & 5.2"), create ONE event name that preserves "5.1 & 5.2".
Schema ONLY:
{
  "events": [
    {
      "event_name": "Title-Case Short Name",
      "event_date": "YYYY-MM-DD",
      "event_time": "HH:MM" | null,
      "event_tag": "Interview|Exam|Midterm|Quiz|Homework|Assignment|Project|Lab|Lecture|Class|Meeting|Office_Hours|Presentation|Deadline|Workshop|Holiday|Break|No_Class|School_Closed|Other" | null
    }
  ]
}
Name rules:
- Title-Case, ≤ 40 chars, concise, no dates/times/pronouns/descriptions.
- Preserve meaningful section/chapter identifiers like "5.1 & 5.2" in the name; preserve decimals exactly.
Time rules:
- "noon"→"12:00", "midnight"→"00:00", ranges use start time.
- Due/submit/turn-in with no time → "23:59"; otherwise if no time, event_time = null.
CRITICAL: Every event MUST include a valid event_date. If you cannot determine a date with high confidence, SKIP that item.
Return ONLY valid JSON (no commentary, no markdown, no trailing commas).`

const REPAIR_PROMPT = `You will receive possibly malformed JSON for:
{ "events": [ { "event_name": "...", "event_date": "YYYY-MM-DD", "event_time": "HH:MM"|null, "event_tag": "..."|null } ] }
Fix ONLY syntax/shape. Do NOT add commentary. Return valid JSON exactly in that shape.`

/* ─────────────────────────────
   File helpers and extraction
   ───────────────────────────── */

async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

async function renderPdfToImages(file: File, maxPages = MAX_PDF_PAGES, scale = VISION_RENDER_SCALE): Promise<string[]> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({ data }).promise
  const urls: string[] = []
  const pages = Math.min(pdf.numPages, maxPages)
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: ctx as any, viewport }).promise
    urls.push(canvas.toDataURL("image/jpeg", 0.92))
  }
  return urls
}

async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const { value: html } = await (mammoth as any).convertToHtml({ arrayBuffer })
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const parts: string[] = []
  doc.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("th,td"))
        .map((c) => c.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean) as string[]
      const line = cells.join(" | ").trim()
      if (line) parts.push(line)
    })
  })
  doc.querySelectorAll("h1,h2,h3,h4,h5,h6,li,p,span,div,strong,em").forEach((el) => {
    const t = el.textContent?.replace(/\s+/g, " ").trim()
    if (t) parts.push(t)
  })
  const lines = [...new Set(parts)].map((s) => s.trim()).filter(Boolean)
  return lines.join("\n")
}

function toStructuredPlainText(raw: string): string {
  const cleaned = (raw || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
  const lines = cleaned.split("\n").map((l) => denoiseLine(l)).filter(Boolean)
  return lines.join("\n")
}

function denoiseLine(line: string): string {
  let s = line
  s = s.replace(/(^|\s)(M|T|Tu|Tue|Tues|W|Th|Thu|Thur|Thurs|F|Fr|Fri|Sat|Sun|Su|Tu)(?=\s|$)/gi, " ")
  s = s.replace(/\b(Sec(t(ion)?)?\.?\s*[A-Za-z0-9\-]+)\b/gi, " ")
  s = s.replace(/\b(Room|Rm\.?|Bldg|Building|Hall|Campus|Location)\s*[:#]?\s*[A-Za-z0-9\-\.\(\)]+/gi, " ")
  s = s.replace(/\b(Zoom|Online|In[-\s]?Person)\b/gi, " ")
  s = s.replace(/\b(CRN|Course\s*ID)\s*[:#]?\s*[A-Za-z0-9\-]+\b/gi, " ")
  s = s.replace(/[•●▪■]/g, "-").replace(/\s{2,}/g, " ").trim()
  return s
}

const SLASH_CLASS = "[/∕／]"
const DATE_REGEX = new RegExp(
  String.raw`\b\d{1,2}\s*${SLASH_CLASS}\s*\d{1,2}(?:\s*${SLASH_CLASS}\s*\d{2,4})?\b`
)

function lineHasExplicitMonthOrDate(line: string): boolean {
  const s = line.toLowerCase()
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(s)) return true
  if (DATE_REGEX.test(s)) return true
  if (/\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b\s*\d{1,2}\b/.test(s)) return true
  return false
}

function lineStartsWithDayToken(line: string): number | null {
  const m = line.match(
    /^\s*(?:[-–—*•●▪■]\s*)?(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|m|t|w|th|f|su|tu)\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?(?!\d)/i
  )
  if (!m) return null
  const d = parseInt(m[1], 10)
  if (d < 1 || d > 31) return null
  return d
}

function detectMonthHeader(line: string): { month: number; year: number | null } | null {
  const s = line.trim()
  const lc = s.toLowerCase()
  const hasDayNum = /\b([1-9]|[12]\d|3[01])\b/.test(lc)
  if (hasDayNum || DATE_REGEX.test(lc)) return null
  const m = lc.match(/\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i)
  if (!m) return null
  const y = lc.match(/\b(19|20)\d{2}\b/)
  const monthIdx = m[1].length <= 3 ? ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[1].toLowerCase()) + 1
    : ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(m[1].toLowerCase()) + 1
  if (!monthIdx) return null
  return { month: monthIdx, year: y ? parseInt(y[0], 10) : null }
}

function detectYearOnly(line: string): number | null {
  const m = line.trim().match(/^(19|20)\d{2}$/)
  if (!m) return null
  const y = parseInt(m[0], 10)
  return y >= 1900 && y <= 2100 ? y : null
}

function applyMonthContext(raw: string): string {
  const lines = raw.split("\n")
  let curMonth: number | null = null
  let curYear: number = DateTime.now().year
  const out: string[] = []
  for (const line of lines) {
    const yOnly = detectYearOnly(line)
    if (yOnly) {
      curYear = yOnly
      out.push(line)
      continue
    }
    const hdr = detectMonthHeader(line)
    if (hdr) {
      curMonth = hdr.month
      if (hdr.year) curYear = hdr.year
      out.push(line)
      continue
    }
    if (lineHasExplicitMonthOrDate(line)) {
      out.push(line)
      continue
    }
    const day = lineStartsWithDayToken(line)
    if (day && curMonth) {
      const dt = DateTime.fromObject({ year: curYear, month: curMonth, day })
      const prefix = dt.isValid ? `${dt.toFormat("yyyy-LL-dd")} | ` : ""
      out.push(prefix + line)
    } else {
      out.push(line)
    }
  }
  return out.join("\n")
}

async function extractTextFromDocxWithContext(file: File): Promise<string> {
  const raw = await extractTextFromDocx(file)
  return applyMonthContext(raw)
}

/* ─────────────────────────────
   Fast .docx row parser (preserve decimals; split item lists)
   ───────────────────────────── */

function classifyTag(nameRaw: string): string | null {
  const low = nameRaw.toLowerCase()
  if (/\bmid[- ]?module\b|\bmodule\b|\bquiz\b/.test(low)) return "Quiz"
  if (/\bexam\b|\btest\b|\bfinal\b/.test(low)) return "Exam"
  if (/\blab\b/.test(low)) return "Lab"
  if (/\bdiscussion\b|\blecture\b|\bclass\b/.test(low)) return "Class"
  if (/\bassignment\b|\bpaper\b|\bsubmission\b|\bsubmit\b|\bpractice\b|\bproblems\b|\bweb[- ]?based activity\b|\bcourse connections\b/.test(low)) return "Assignment"
  if (/\bmeeting\b/.test(low)) return "Meeting"
  if (/\bappointment\b/.test(low)) return "Appointment"
  return null
}

function cleanCellName(s: string): string {
  // Preserve decimals; only drop obvious bullets prefix.
  return (s || "")
    .normalize("NFKC")
    .replace(/^[\s\u2022\u25AA\u25CF\u25A0\*\-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parseDocxTableLinesFast(structured: string): ParsedEvent[] {
  const out: ParsedEvent[] = []
  const lines = structured.split("\n")
  const rowRe = new RegExp(String.raw`^\s*\(?\s*(\d{1,2})\s*${SLASH_CLASS}\s*(\d{1,2})(?:\s*${SLASH_CLASS}\s*(\d{2,4}))?\s*\)?\s*\|\s*(.+)$`, "i")
  const splitter = /\s*(?:,|&|\band\b)\s*/i

  for (const line of lines) {
    const m = line.match(rowRe)
    if (!m) continue
    const mm = parseInt(m[1], 10)
    const dd = parseInt(m[2], 10)
    let yy = m[3] ? parseInt(m[3], 10) : DateTime.now().year
    if (yy < 100) yy += 2000
    const dt = DateTime.fromObject({ year: yy, month: mm, day: dd })
    if (!dt.isValid) continue
    const date = dt.toFormat("yyyy-LL-dd")

    // Split table into cells and then split multi-items inside a cell
    const rest = m[4]
    const cells = rest.split("|").map((c) => cleanCellName(c)).filter(Boolean)

    for (const cell of cells) {
      // If pattern looks like "Practice problems - 1.1, 1.2, 1.3"
      const numList = cell.match(/^\s*(.+?)\s*(?:[-:]\s*|\s+sections?\s+)(\d+(?:\.\d+)?(?:\s*(?:,|&|\band\b)\s*\d+(?:\.\d+)?)+)\s*$/i)
      if (numList) {
        const base = cleanCellName(numList[1])
        const parts = numList[2].split(splitter).map((s) => s.trim()).filter(Boolean)
        for (const p of parts) {
          const nameRaw = `${base} ${p}`
          const low = nameRaw.toLowerCase()
          const time = /due|submit|submission/.test(low) ? "23:59" : null
          const tag = classifyTag(nameRaw)
          out.push({ event_name: nameRaw, event_date: date, event_time: time, event_tag: tag })
        }
        continue
      }

      // Otherwise, also split obvious “A & B” combos into two atomics
      if (/[,&]|\band\b/i.test(cell)) {
        const parts = cell.split(splitter).map((s) => cleanCellName(s)).filter(Boolean)
        if (parts.length >= 2) {
          for (const part of parts) {
            const low = part.toLowerCase()
            const time = /due|submit|submission/.test(low) ? "23:59" : null
            const tag = classifyTag(part)
            out.push({ event_name: part, event_date: date, event_time: time, event_tag: tag })
          }
          continue
        }
      }

      const nameRaw = cell
      if (!nameRaw) continue
      const low = nameRaw.toLowerCase()
      const time = /due|submit|submission/.test(low) ? "23:59" : null
      const tag = classifyTag(nameRaw)
      out.push({ event_name: nameRaw, event_date: date, event_time: time, event_tag: tag })
    }
  }
  return out
}

/* ─────────────────────────────
   XLSX (keep your working path)
   ───────────────────────────── */

async function extractTextFromXlsxLegacy(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const wb = XLSX.read(data, { type: "array" })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    if (csv && csv.trim()) {
      parts.push(`[Sheet: ${name}]`)
      parts.push(csv.trim())
    }
  }
  return parts.join("\n").trim()
}

function tryParseEventsFromSheet(sheet: XLSX.WorkSheet): ParsedEvent[] {
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" })
  if (!rows.length) return []
  const headerKeys = Object.keys(rows[0] || {})
  const normMap: Record<string, string> = {}
  for (const k of headerKeys) normMap[normHeader(k)] = k
  const hAssignmentN = pickKey(headerKeys, ["assignment", "eventname", "event", "name", "title", "task", "activity"])
  const hDateN = pickKey(headerKeys, ["duedate", "date"])
  const hTimeN = pickKey(headerKeys, ["time", "timeoptional"])
  const hTagN = pickKey(headerKeys, ["tag", "tags", "tagsoptional", "category", "type", "label", "class"])
  const hAssignment = hAssignmentN ? normMap[hAssignmentN] : null
  const hDate = hDateN ? normMap[hDateN] : null
  const hTime = hTimeN ? normMap[hTimeN] : null
  const hTag = hTagN ? normMap[hTagN] : null
  if (!hAssignment || !hDate) return []

  const out: ParsedEvent[] = []
  for (const row of rows) {
    const aRaw = row[hAssignment]
    const dRaw = row[hDate]
    const tRaw = hTime ? row[hTime] : ""
    const tagRaw = hTag ? row[hTag] : ""

    const a = String(aRaw ?? "").trim()
    if (!a) continue
    const date = normDate(dRaw)
    if (!date) continue

    let time = normTime(tRaw)
    if (!time) {
      const tFromDate = extractTimeFromDateCell(dRaw)
      if (tFromDate) time = tFromDate
    }

    const tag = capTag(tagRaw)

    out.push({ event_name: a, event_date: date, event_time: time, event_tag: tag })
  }
  return out
}

async function extractEventsFromXlsx(file: File): Promise<ParsedEvent[]> {
  const data = await file.arrayBuffer()
  const wb = XLSX.read(data, { type: "array" })
  let out: ParsedEvent[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const parsed = tryParseEventsFromSheet(sheet)
    if (parsed.length) out = out.concat(parsed)
  }
  if (out.length) return out
  const legacy = await extractTextFromXlsxLegacy(file)
  if (!legacy) return []
  const structured = toStructuredPlainText(legacy)
  const est = estimateTokens(structured)
  if (est > MAX_CONTENT_TOKENS) return []
  const lines = structured.split("\n")
  const batches = chunkLines(lines, MAX_LINES_PER_TEXT_BATCH, MAX_CHARS_PER_TEXT_BATCH)
  let all: ParsedEvent[] = []
  for (let i = 0; i < batches.length; i++) {
    const { parsed } = await callOpenAI_JSON_TextBatch(batches[i], i, batches.length)
    const evs = (parsed.events || []) as ParsedEvent[]
    all = all.concat(evs.slice(0, BATCH_EVENT_CAP))
  }
  return all
}

/* ─────────────────────────────
   PDF text (try text first, then images)
   ───────────────────────────── */

async function extractTextFromPdf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES)
  const allLines: string[] = []
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const tc: any = await page.getTextContent()
    const items = tc.items as any[]
    const text = items.map((it) => (it.str || "").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
    if (text) allLines.push(text)
  }
  return allLines.join("\n")
}

/* ─────────────────────────────
   Chunking + OpenAI calls
   ───────────────────────────── */

function chunkLines(lines: string[], maxLines: number, maxChars: number): string[] {
  const batches: string[] = []
  let buf: string[] = []
  let charCount = 0
  for (const line of lines) {
    const addLen = line.length + 1
    if (buf.length >= maxLines || charCount + addLen > maxChars) {
      batches.push(buf.join("\n"))
      buf = []
      charCount = 0
    }
    buf.push(line)
    charCount += addLen
  }
  if (buf.length) batches.push(buf.join("\n"))
  return batches
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function repairMalformedJSON(bad: string): Promise<{ parsed: any; tokensUsed: number } | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: REPAIR_PROMPT },
        { role: "user", content: bad }
      ],
      temperature: 0.0,
      max_tokens: 800,
      response_format: { type: "json_object" }
    })
  })
  if (!res.ok) return null
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ""
  const tokensUsed = data?.usage?.total_tokens ?? 0
  try {
    const parsed = JSON.parse(content)
    return { parsed, tokensUsed }
  } catch {
    return null
  }
}

async function callOpenAI_JSON_TextBatch(batchText: string, batchIndex: number, totalBatches: number): Promise<{ parsed: any; tokensUsed: number }> {
  const dbg: AIDebugInfo = {
    mode: "text",
    model: TEXT_MODEL,
    batchIndex,
    totalBatches,
    systemPromptFirst400: TEXT_SYSTEM_PROMPT.slice(0, 400),
    userContentFirst1200: batchText.slice(0, 1200),
    userContentLength: batchText.length
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: TEXT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Batch ${batchIndex + 1}/${totalBatches}. Normalize & ignore noise (weekday letters, rooms, sections, URLs, instructor names).\n` +
            `Extract ONLY dates + event/assignment names. Multiple items per date allowed.\n` +
            `---BEGIN---\n${batchText}\n---END---`
        }
      ],
      temperature: 0.0,
      max_tokens: MAX_TOKENS_TEXT,
      response_format: { type: "json_object" }
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || "OpenAI API request failed")
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ""
  const tokensUsed = data?.usage?.total_tokens ?? 0
  dbg.rawResponseFirst2000 = content.slice(0, 2000)
  dbg.rawResponseLength = content.length
  try {
    const parsed = JSON.parse(content)
    lastAIBatches.push(dbg)
    return { parsed, tokensUsed }
  } catch (e: any) {
    const repaired = await repairMalformedJSON(content)
    if (repaired) {
      lastAIBatches.push(dbg)
      return { parsed: repaired.parsed, tokensUsed: tokensUsed + repaired.tokensUsed }
    }
    const msg = String(e?.message || "JSON parse error")
    const m = msg.match(/position (\d+)/i)
    const pos = m ? parseInt(m[1], 10) : undefined
    if (typeof pos === "number") {
      const lc = positionToLineCol(content, pos)
      dbg.parseError = { message: msg, pos, line: lc.line, col: lc.col, excerpt: excerptAround(content, pos) }
    } else {
      dbg.parseError = { message: msg }
    }
    lastAIBatches.push(dbg)
    throw new Error(`Batch ${batchIndex + 1}/${totalBatches} JSON error: ${msg}`)
  }
}

async function callOpenAI_JSON_VisionBatch(imageDataUrls: string[], batchIndex: number, totalBatches: number): Promise<{ parsed: any; tokensUsed: number }> {
  const dbg: AIDebugInfo = {
    mode: "vision",
    model: VISION_MODEL,
    batchIndex,
    totalBatches,
    systemPromptFirst400: VISION_SYSTEM_PROMPT.slice(0, 400),
    imageCount: imageDataUrls.length
  }
  const userContent: Array<any> = [
    {
      type: "text",
      text:
        "Extract events WITH DATES from these schedule images. Every event MUST have event_date in YYYY-MM-DD. Use headers/column/cell context to resolve dates. Output separate events for multiple items in the same row/cell. Never output combined 'A & B' names when the individual items exist."
    }
  ]
  for (const url of imageDataUrls) userContent.push({ type: "image_url", image_url: { url } })
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        { role: "user", content: userContent }
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
  const content = data?.choices?.[0]?.message?.content ?? ""
  const tokensUsed = data?.usage?.total_tokens ?? 0
  dbg.rawResponseFirst2000 = content.slice(0, 2000)
  dbg.rawResponseLength = content.length
  try {
    const parsed = JSON.parse(content)
    let events = (parsed.events || []) as ParsedEvent[]
    events = events.filter((e) => typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    lastAIBatches.push(dbg)
    return { parsed: { events }, tokensUsed }
  } catch (e: any) {
    const repaired = await repairMalformedJSON(content)
    if (repaired) {
      let events = (repaired.parsed.events || []) as ParsedEvent[]
      events = events.filter((ev) => typeof ev.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ev.event_date))
      lastAIBatches.push(dbg)
      return { parsed: { events }, tokensUsed: tokensUsed + (repaired.tokensUsed || 0) }
    }
    const msg = String(e?.message || "JSON parse error")
    const m = msg.match(/position (\d+)/i)
    const pos = m ? parseInt(m[1], 10) : undefined
    if (typeof pos === "number") {
      const lc = positionToLineCol(content, pos)
      dbg.parseError = { message: msg, pos, line: lc.line, col: lc.col, excerpt: excerptAround(content, pos) }
    } else {
      dbg.parseError = { message: msg }
    }
    lastAIBatches.push(dbg)
    throw new Error(`Vision batch ${batchIndex + 1}/${totalBatches} JSON error: ${msg}`)
  }
}

/* ─────────────────────────────
   Public services
   ───────────────────────────── */

export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    lastAIBatches = []
    const name = (file.name || "").toLowerCase()
    const type = (file.type || "").toLowerCase()

    if (type.startsWith("image/")) {
      const url = await fileToDataURL(file)
      const { parsed, tokensUsed } = await callOpenAI_JSON_VisionBatch([url], 0, 1)
      let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
      events = finalDedupe(events)
      events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
      return { events, tokensUsed }
    }

    if (type.includes("pdf") || name.endsWith(".pdf")) {
      const raw = await extractTextFromPdf(file)
      const structured = toStructuredPlainText(raw || "")
      if (structured && structured.trim().length > 0) {
        const estimatedTokens = estimateTokens(structured)
        if (estimatedTokens > MAX_CONTENT_TOKENS) {
          throw new Error(`Document contains too much information (~${estimatedTokens} tokens). Please upload a smaller section. Maximum allowed: ${MAX_CONTENT_TOKENS} tokens.`)
        }
        const lines = structured.split("\n")
        const batches = chunkLines(lines, MAX_LINES_PER_TEXT_BATCH, MAX_CHARS_PER_TEXT_BATCH)
        let tokens = 0
        let allEvents: ParsedEvent[] = []
        for (let i = 0; i < batches.length; i++) {
          const { parsed, tokensUsed } = await callOpenAI_JSON_TextBatch(batches[i], i, batches.length)
          tokens += tokensUsed
          const evs = (parsed.events || []) as ParsedEvent[]
          const evsCapped = evs.slice(0, BATCH_EVENT_CAP)
          allEvents.push(...evsCapped)
        }
        allEvents = finalDedupe(allEvents)
        if (allEvents.length > 0) {
          allEvents.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
          return { events: allEvents, tokensUsed: tokens }
        }
      }
      const urls = await renderPdfToImages(file, MAX_PDF_PAGES, VISION_RENDER_SCALE)
      if (!urls.length) throw new Error("Could not render any PDF pages.")
      const pageBatches = chunkArray(urls, PDF_PAGES_PER_VISION_BATCH)
      let tokens = 0
      let allEvents: ParsedEvent[] = []
      for (let i = 0; i < pageBatches.length; i++) {
        const { parsed, tokensUsed } = await callOpenAI_JSON_VisionBatch(pageBatches[i], i, pageBatches.length)
        tokens += tokensUsed
        const evs = (parsed.events || []) as ParsedEvent[]
        const evsCapped = evs.slice(0, BATCH_EVENT_CAP)
        allEvents.push(...evsCapped)
      }
      allEvents = finalDedupe(allEvents)
      allEvents.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
      return { events: allEvents, tokensUsed: tokens }
    }

    if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
      let events = await extractEventsFromXlsx(file)
      events = finalDedupe(events)
      events = events.filter((e) => !!e.event_date)
      events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
      return { events, tokensUsed: 0 }
    }

    let raw = ""
    if (type.includes("word") || name.endsWith(".docx")) {
      raw = await extractTextFromDocxWithContext(file)
    } else if (name.endsWith(".csv") || type.includes("csv") || type.startsWith("text/") || name.endsWith(".txt")) {
      raw = await file.text()
    } else {
      throw new Error(`Unsupported file type: ${type || name}`)
    }

    if (!raw?.trim()) throw new Error("No text could be extracted from the file.")

    const structured = toStructuredPlainText(raw)

    const fastDocxEvents =
      (type.includes("word") || name.endsWith(".docx"))
        ? parseDocxTableLinesFast(structured)
        : []

    const estimatedTokens = estimateTokens(structured)
    if (estimatedTokens > MAX_CONTENT_TOKENS) {
      const events = finalDedupe(fastDocxEvents)
      events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
      return { events, tokensUsed: 0 }
    }

    const lines = structured.split("\n")
    const batches = chunkLines(lines, MAX_LINES_PER_TEXT_BATCH, MAX_CHARS_PER_TEXT_BATCH)
    let tokens = 0
    let allEvents: ParsedEvent[] = []
    for (let i = 0; i < batches.length; i++) {
      const { parsed, tokensUsed } = await callOpenAI_JSON_TextBatch(batches[i], i, batches.length)
      tokens += tokensUsed
      const evs = (parsed.events || []) as ParsedEvent[]
      const evsCapped = evs.slice(0, BATCH_EVENT_CAP)
      allEvents.push(...evsCapped)
    }
    allEvents.push(...fastDocxEvents)

    allEvents = finalDedupe(allEvents)
    allEvents.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events: allEvents, tokensUsed: tokens }
  }
}

/* ─────────────────────────────
   Natural language parser (with relative dates)
   ───────────────────────────── */

const TEXTBOX_SYSTEM_PROMPT = `You are a calendar event parser. Extract events from natural language and return them as a JSON array.
Current date: ${DateTime.now().toISODate()}
Current weekday: ${DateTime.now().toFormat("cccc")}
Resolve relative dates precisely:
- "today" → current date
- "tomorrow" → current date + 1 day
- "tonight" → current date (use time if specified, else null)
- "this <weekday>" → the next occurrence of that weekday in the current week; if today is the same weekday and time is in the future, use today, else the upcoming one
- "next <weekday>" → the occurrence in the next week
- "in N days/hours" → add N to the current date/time
- "<weekday> at <time>" without "this/next" → choose the upcoming occurrence in the next 7 days
Formatting:
- event_date must be YYYY-MM-DD
- event_time is HH:MM 24-hour or null; if range, use the start time
- event_name must be Title Case, concise, ≤ 50 chars, no dates/times/pronouns
- event_tag must start with a capital letter if present (e.g., Interview, Exam, Meeting, Class, Appointment). If unclear, use null.
Return ONLY:
{
  "events": [
    {
      "event_name": "Example",
      "event_date": "YYYY-MM-DD",
      "event_time": "HH:MM" | null,
      "event_tag": "Interview|Exam|Midterm|Quiz|Homework|Assignment|Class|Lecture|Lab|Meeting|Appointment|Holiday|Break|No_Class|School_Closed|Other" | null
    }
  ]
}`

function fmtTime(dt: Date): string {
  const d = DateTime.fromJSDate(dt)
  const hh = d.toFormat("HH")
  const mm = d.toFormat("mm")
  return `${hh}:${mm}`
}

function resolveRelativeNL(text: string): ParsedEvent[] {
  const results = chrono.parse(text, new Date(), { forwardDate: true })
  if (!results.length) return []
  const events: ParsedEvent[] = []
  for (const r of results) {
    const d = r.start.date()
    const date = DateTime.fromJSDate(d).toFormat("yyyy-LL-dd")
    const hasHour = r.start.isCertain("hour")
    const time = hasHour ? fmtTime(d) : null
    let tag: string | null = null
    const lc = text.toLowerCase()
    if (/\binterview\b/.test(lc)) tag = "Interview"
    else if (/\bexam\b|\bmidterm\b|\bfinal\b/.test(lc)) tag = "Exam"
    else if (/\bquiz\b/.test(lc)) tag = "Quiz"
    else if (/\bclass\b|\blecture\b|\blab\b/.test(lc)) tag = "Class"
    else if (/\bmeeting\b/.test(lc)) tag = "Meeting"
    else if (/\bappointment\b|\bdentist\b|\bdoctor\b/.test(lc)) tag = "Appointment"
    let name = "Event"
    if (/\btest\b|\bexam\b|\bmidterm\b|\bfinal\b/.test(lc)) name = "Test"
    else if (/\bquiz\b/.test(lc)) name = "Quiz"
    else if (/\binterview\b/.test(lc)) name = "Interview"
    else if (/\bmeeting\b/.test(lc)) name = "Meeting"
    else if (/\bclass\b/.test(lc)) name = "Class"
    else if (/\bappointment\b/.test(lc)) name = "Appointment"
    name = toTitleCase(name)
    events.push({ event_name: name, event_date: date, event_time: time, event_tag: tag })
  }
  return events
}

export class OpenAITextService {
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const deterministic = resolveRelativeNL(text)
    if (deterministic.length) {
      let events = finalDedupe(deterministic)
      events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
      return { events, tokensUsed: 0 }
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: TEXTBOX_SYSTEM_PROMPT },
          { role: "user", content: text }
        ],
        temperature: 0.0,
        max_tokens: 500,
        response_format: { type: "json_object" }
      })
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error?.error?.message || "OpenAI API request failed")
    }
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ""
    const tokensUsed = data.usage?.total_tokens || 0
    let parsed: any
    parsed = JSON.parse(content)
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
    events = finalDedupe(events)
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed }
  }
}
