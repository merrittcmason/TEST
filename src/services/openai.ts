import { OpenAIExcelService } from "./openai_excel"
import { OpenAIPdfService } from "./openai_pdf"
import { GoogleImageService } from "./google_image"
import * as XLSX from "xlsx"
import * as pdfjsLib from "pdfjs-dist"
import { GlobalWorkerOptions } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
import * as mammoth from "mammoth"
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

const PREVIEW_LIMITS = {
  anyMaxBytes: 50 * 1024 * 1024,
  pdfMaxPages: 200,
  wordMaxChars: 2000000,
  textMaxChars: 2000000,
  excelMaxSheets: 30,
  excelMaxTotalRows: 50000,
  excelMaxTotalCells: 2000000
}

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

async function preflightFileSize(file: File) {
  const name = (file.name || "").toLowerCase()
  const type = (file.type || "").toLowerCase()
  const size = file.size
  if (size > PREVIEW_LIMITS.anyMaxBytes) throw new Error("File too large")
  if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data, { type: "array" })
    if (wb.SheetNames.length > PREVIEW_LIMITS.excelMaxSheets) throw new Error("Too many sheets")
    let rows = 0
    let cells = 0
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName]
      const range = XLSX.utils.decode_range(sheet["!ref"] || "A1")
      const rcount = range.e.r - range.s.r + 1
      const ccount = range.e.c - range.s.c + 1
      rows += rcount
      cells += rcount * ccount
    }
    if (rows > PREVIEW_LIMITS.excelMaxTotalRows || cells > PREVIEW_LIMITS.excelMaxTotalCells) throw new Error("Spreadsheet too large")
  } else if (type.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) {
    const ab = await file.arrayBuffer()
    let plain = ""
    try {
      const r1 = await mammoth.extractRawText({ arrayBuffer: ab } as any)
      plain = r1?.value || ""
    } catch {}
    if (!plain) {
      const r2 = await mammoth.convertToHtml({ arrayBuffer: ab } as any)
      const html = r2?.value || ""
      plain = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    }
    if (plain.length > PREVIEW_LIMITS.wordMaxChars) throw new Error("Document too long")
  } else if (type.includes("pdf") || name.endsWith(".pdf")) {
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data }).promise
    if (pdf.numPages > PREVIEW_LIMITS.pdfMaxPages) throw new Error("PDF too long")
  } else if (name.endsWith(".csv") || type.includes("csv") || type.startsWith("text/") || name.endsWith(".txt")) {
    const text = await file.text()
    if (text.length > PREVIEW_LIMITS.textMaxChars) throw new Error("Text file too long")
  }
}

async function loadWordService() {
  const mod: any = await import("./openai_docs")
  const svc = mod.OpenAIWordService || mod.default || mod.OpenAIDocsService || mod.OpenAI_Docs_Service
  if (!svc || typeof svc.parse !== "function") {
    const keys = Object.keys(mod || {})
    throw new Error(`openai_docs missing OpenAIWordService.parse; exports: ${keys.join(",")}`)
  }
  return svc as { parse: (file: File) => Promise<ParseResult> }
}

async function loadExcelService() {
  const mod: any = await import("./openai_excel")
  const svc = mod.OpenAIExcelService || mod.default
  if (!svc || typeof svc.parse !== "function") {
    const keys = Object.keys(mod || {})
    throw new Error(`openai_excel missing OpenAIExcelService.parse; exports: ${keys.join(",")}`)
  }
  return svc as { parse: (file: File) => Promise<ParseResult> }
}

export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    await preflightFileSize(file)
    const name = (file.name || "").toLowerCase()
    const type = (file.type || "").toLowerCase()
    if (type.startsWith("image/")) return await GoogleImageService.parse(file)
    if (type.includes("pdf") || name.endsWith(".pdf")) return await OpenAIPdfService.parse(file)
    if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) return await OpenAIExcelService.parse(file)
    if (type.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return await (await loadWordService()).parse(file)
    if (name.endsWith(".csv") || type.includes("csv") || type.startsWith("text/") || name.endsWith(".txt")) return await (await loadExcelService()).parse(file)
    throw new Error(`Unsupported file type: ${type || name}`)
  }
}

export class OpenAITextService {
  static async parseNaturalLanguage(text: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const deterministic = resolveRelativeNL(text)
    if (deterministic.length) {
      const events = dedupeEvents(postNormalizeEvents(deterministic))
      events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
      return { events, tokensUsed: 0 }
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a calendar event parser. Return only valid JSON with an 'events' array." },
          { role: "user", content: text + "\nReturn JSON." }
        ],
        temperature: 0,
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
    const parsed = JSON.parse(content)
    let events: ParsedEvent[] = (parsed.events || []) as ParsedEvent[]
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed }
  }
}
