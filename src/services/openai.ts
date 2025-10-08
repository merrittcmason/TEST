// src/services/openai.ts
import { OpenAIExcelService, ParsedEvent as ExcelEvent, ParseResult as ExcelResult } from "./openai_excel"
import { OpenAIPdfService } from "./openai_pdf"
import { OpenAIImageService } from "./openai_image"

// Preflight scanners (no AI)
import * as XLSX from "xlsx"
import * as pdfjsLib from "pdfjs-dist"
import { GlobalWorkerOptions } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
import mammoth from "mammoth"

import * as chrono from "chrono-node"
import { DateTime } from "luxon"

GlobalWorkerOptions.workerSrc = pdfWorker

export type ParsedEvent = ExcelEvent
export type ParseResult = ExcelResult

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY

/* =========================
   Preflight Size Limits (HIGH for testing)
   Adjust down later to enforce "one-class" uploads.
   ========================= */
const PREVIEW_LIMITS = {
  anyMaxBytes: 50 * 1024 * 1024,       // 50 MB
  pdfMaxPages: 200,                    // PDF pages
  wordMaxChars: 2_000_000,             // characters after raw-text extraction
  textMaxChars: 2_000_000,             // csv/txt
  excelMaxSheets: 30,
  excelMaxTotalRows: 50_000,           // sum of all sheets (header-inclusive)
  excelMaxTotalCells: 2_000_000        // rough guard (rows * cols summed)
}

/* =========================
   Shared normalization
   ========================= */
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

/* =========================
   NL parsing (chrono-first)
   ========================= */
const TEXTBOX_SYSTEM_PROMPT = `You are a calendar event parser. Extract events from natural language and return them as a JSON array.
Current date: ${DateTime.now().toISODate()}
Current weekday: ${DateTime.now().toFormat("cccc")}
Resolve relative dates: today, tomorrow, tonight, this <weekday>, next <weekday>, in N days/hours, and "<weekday> at <time>" within next 7 days.
Format:
{"events":[{"event_name":"Title Case","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Class|Lecture|Lab|Meeting|Appointment|Holiday|Break|No_Class|School_Closed|Other"|null}]}`

function fmtTime(dt: Date): string {
  const d = DateTime.fromJSDate(dt)
  return `${d.toFormat("HH")}:${d.toFormat("mm")}`
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
  static async parseNaturalLanguage(text: string): Promise<{ events: ParsedEvent[]; tokensUsed: number }> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const deterministic = resolveRelativeNL(text)
    if (deterministic.length) {
      let events = postNormalizeEvents(deterministic)
      events = dedupeEvents(events)
      events.sort(
        (a, b) =>
          a.event_date.localeCompare(b.event_date) ||
          ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) ||
          a.event_name.localeCompare(b.event_name)
      )
      return { events, tokensUsed: 0 }
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
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
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || "OpenAI API request failed")
    }
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content ?? ""
    const tokensUsed = data?.usage?.total_tokens ?? 0
    const parsed = JSON.parse(content)
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events.sort(
      (a, b) =>
        a.event_date.localeCompare(b.event_date) ||
        ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) ||
        a.event_name.localeCompare(b.event_name)
    )
    return { events, tokensUsed }
  }
}

/* =========================
   Preflight scanners (no AI; block oversize before parsing)
   ========================= */
async function preflightCheck(file: File): Promise<void> {
  // Skip images entirely per your requirement.
  if (file.type.startsWith("image/")) return

  // 1) Byte-size guard
  if (file.size > PREVIEW_LIMITS.anyMaxBytes) {
    throw new Error(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max allowed is ${(PREVIEW_LIMITS.anyMaxBytes / (1024 * 1024)).toFixed(0)} MB.`
    )
  }

  const name = (file.name || "").toLowerCase()
  const type = (file.type || "").toLowerCase()

  // 2) Excel/CSV: check sheets, rows, cells (rough)
  if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data, { type: "array" })
    const sheetCount = wb.SheetNames.length
    if (sheetCount > PREVIEW_LIMITS.excelMaxSheets) {
      throw new Error(`This spreadsheet has ${sheetCount} sheets. Max allowed is ${PREVIEW_LIMITS.excelMaxSheets}.`)
    }
    let totalRows = 0
    let totalCells = 0
    for (const s of wb.SheetNames) {
      const ws = wb.Sheets[s]
      // Header:1 returns 2D arrays and is fast-ish
      const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true })
      totalRows += rows.length
      for (const r of rows) totalCells += (Array.isArray(r) ? r.length : 0)
      if (totalRows > PREVIEW_LIMITS.excelMaxTotalRows || totalCells > PREVIEW_LIMITS.excelMaxTotalCells) break
    }
    if (totalRows > PREVIEW_LIMITS.excelMaxTotalRows) {
      throw new Error(
        `This spreadsheet has ${totalRows.toLocaleString()} rows total. Max allowed is ${PREVIEW_LIMITS.excelMaxTotalRows.toLocaleString()}.`
      )
    }
    if (totalCells > PREVIEW_LIMITS.excelMaxTotalCells) {
      throw new Error(
        `This spreadsheet is very dense (${totalCells.toLocaleString()} cells). Max allowed is ${PREVIEW_LIMITS.excelMaxTotalCells.toLocaleString()}.`
      )
    }
    return
  }

  // 3) PDF: check page count
  if (type.includes("pdf") || name.endsWith(".pdf")) {
    const data = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise
    if (pdf.numPages > PREVIEW_LIMITS.pdfMaxPages) {
      throw new Error(`This PDF has ${pdf.numPages} pages. Max allowed is ${PREVIEW_LIMITS.pdfMaxPages}.`)
    }
    return
  }

  // 4) Word: count extracted raw text characters
  if (type.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) {
    const { value: raw } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    const chars = (raw || "").length
    if (chars > PREVIEW_LIMITS.wordMaxChars) {
      throw new Error(
        `This Word document is very long (${chars.toLocaleString()} characters). Max allowed is ${PREVIEW_LIMITS.wordMaxChars.toLocaleString()}.`
      )
    }
    return
  }

  // 5) Plain text / CSV handled here as generic text check (backup)
  if (type.startsWith("text/") || name.endsWith(".txt")) {
    const txt = await file.text()
    const chars = (txt || "").length
    if (chars > PREVIEW_LIMITS.textMaxChars) {
      throw new Error(
        `This text file is very long (${chars.toLocaleString()} characters). Max allowed is ${PREVIEW_LIMITS.textMaxChars.toLocaleString()}.`
      )
    }
  }
}

/* =========================
   File router
   ========================= */
export class OpenAIFilesService {
  static async parseFile(file: File): Promise<{ events: ParsedEvent[]; tokensUsed: number }> {
    // preflight size/security checks (skip images)
    await preflightCheck(file)

    const name = (file.name || "").toLowerCase()
    const type = (file.type || "").toLowerCase()

    if (type.startsWith("image/")) {
      return await OpenAIImageService.parse(file)
    }
    if (type.includes("pdf") || name.endsWith(".pdf")) {
      return await OpenAIPdfService.parse(file)
    }
    if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
      return await OpenAIExcelService.parse(file)
    }
    if (name.endsWith(".csv")) {
      // Route through Excel path (it already handles CSV via read)
      return await OpenAIExcelService.parse(file)
    }
    if (type.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) {
      const mod = await import("./openai_docs") // your Word handler
      const r = await mod.OpenAIWordService.parse(file)
      return r
    }
    throw new Error(`Unsupported file type: ${type || name}`)
  }
}
