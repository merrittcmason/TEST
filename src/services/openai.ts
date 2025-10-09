import { OpenAIExcelService } from "./openai_excel"
import { OpenAIPdfService } from "./openai_pdf"
import { OpenAIImageService } from "./openai_image"
import * as XLSX from "xlsx"
import * as pdfjsLib from "pdfjs-dist"
import { GlobalWorkerOptions } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"
import * as mammoth from "mammoth"

GlobalWorkerOptions.workerSrc = pdfWorker

export interface ParsedEvent {
  title: string
  location: string | null
  all_day: boolean
  start_date: string
  start_time: string | null
  end_date: string | null
  end_time: string | null
  is_recurring: boolean | null
  recurrence_rule: string | null
  label: string | null
  tag: string | null
  description: string | null
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

function postNormalizeEvents(events: ParsedEvent[]): ParsedEvent[] {
  return (events || []).map(e => {
    let title = (e.title || "").trim()
    title = toTitleCase(title).replace(/\s{2,}/g, " ")
    if (title.length > 80) title = title.slice(0, 77).trimEnd() + "..."
    return { ...e, title }
  })
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>()
  const out: ParsedEvent[] = []
  for (const e of events) {
    const key = `${(e.title || "").trim().toLowerCase()}|${e.start_date}|${e.start_time ?? ""}|${e.tag ?? ""}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(e)
    }
  }
  return out
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
    const text = await (mammoth as any).extractRawText({ arrayBuffer: ab } as any).then((r: any) => r?.value || "")
    if (text.length > PREVIEW_LIMITS.wordMaxChars) throw new Error("Document too long")
  } else if (type.includes("pdf") || name.endsWith(".pdf")) {
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data }).promise
    if (pdf.numPages > PREVIEW_LIMITS.pdfMaxPages) throw new Error("PDF too long")
  } else if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv")) {
    const text = await file.text()
    if (text.length > PREVIEW_LIMITS.textMaxChars) throw new Error("Text file too long")
  }
}

async function convertDocToPdfBrowser(file: File): Promise<File> {
  try {
    const html2pdfMod: any = await import("html2pdf.js")
    const arrayBuffer = await file.arrayBuffer()
    const r = await (mammoth as any).convertToHtml({ arrayBuffer } as any)
    const container = document.createElement("div")
    container.style.position = "fixed"
    container.style.left = "-10000px"
    container.style.top = "-10000px"
    container.style.width = "800px"
    container.innerHTML = r.value || ""
    document.body.appendChild(container)
    const instance = html2pdfMod.default ? html2pdfMod.default() : (html2pdfMod() as any)
    const blob: Blob = await instance.from(container).set({ margin: 10, filename: file.name.replace(/\.(docx?|DOCX?)$/, ".pdf") }).outputPdf("blob")
    document.body.removeChild(container)
    return new File([blob], file.name.replace(/\.(docx?|DOCX?)$/, ".pdf"), { type: "application/pdf" })
  } catch {
    return file
  }
}

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfWeek(d: Date) {
  const x = new Date(d)
  const day = x.getDay()
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  x.setHours(0, 0, 0, 0)
  return x
}

function nextDow(from: Date, targetDow: number, includeToday = false) {
  const d = new Date(from)
  const cur = d.getDay()
  let add = (targetDow + 7 - cur) % 7
  if (!includeToday && add === 0) add = 7
  d.setDate(d.getDate() + add)
  return d
}

function replaceToken(input: string, token: string, dateStr: string) {
  const re = new RegExp(`\\b${token}\\b`, "gi")
  return input.replace(re, dateStr)
}

function normalizeRelativePhrases(raw: string, base: Date, tz: string) {
  const localIso = (() => {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(base)
    const m = s.match(/(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2})/)
    if (!m) return base.toISOString()
    const y = Number(m[3])
    const mon = Number(m[1]) - 1
    const d = Number(m[2])
    const hh = Number(m[4])
    const mm = Number(m[5])
    const dt = new Date(y, mon, d, hh, mm, 0)
    return dt.toISOString()
  })()
  const localNow = new Date(localIso)
  const today = fmtDate(localNow)
  const tomorrowDate = new Date(localNow); tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = fmtDate(tomorrowDate)
  const yesterdayDate = new Date(localNow); yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = fmtDate(yesterdayDate)
  const sow = startOfWeek(localNow)
  let text = raw
  text = replaceToken(text, "today", today)
  text = replaceToken(text, "tonight", today)
  text = replaceToken(text, "this evening", today)
  text = replaceToken(text, "this morning", today)
  text = replaceToken(text, "this afternoon", today)
  text = replaceToken(text, "tomorrow", tomorrow)
  text = replaceToken(text, "yesterday", yesterday)
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  for (let i = 0; i < 7; i++) {
    const next = fmtDate(nextDow(localNow, i, false))
    const thisX = fmtDate(nextDow(sow, i, true))
    text = replaceToken(text, `next ${weekdays[i]}`, next)
    text = replaceToken(text, `this ${weekdays[i]}`, thisX)
  }
  return text
}

export class OpenAIFilesService {
  static async parseFile(file: File): Promise<ParseResult> {
    await preflightFileSize(file)
    const name = (file.name || "").toLowerCase()
    const type = (file.type || "").toLowerCase()
    if (type.startsWith("image/")) return await OpenAIImageService.parse(file)
    if (type.includes("pdf") || name.endsWith(".pdf")) return await OpenAIPdfService.parse(file)
    if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) return await OpenAIExcelService.parse(file)
    if (type.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) {
      const pdf = await convertDocToPdfBrowser(file)
      return await OpenAIPdfService.parse(pdf)
    }
    if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv")) {
      const excelSvc = await import("./openai_excel")
      return await (excelSvc.OpenAIExcelService || (excelSvc as any).default).parse(file)
    }
    throw new Error(`Unsupported file type: ${type || name}`)
  }
}

const SYSTEM_PROMPT = `You are an AI calendar event extractor for PDFs and free text.
Resolve all relative dates against the provided now_iso and timezone.
Rules
1. Always interpret relative phrases ("today", "tonight", "tomorrow", "this Friday", "next Monday") using now_iso and timezone provided in the user content. Convert to absolute YYYY-MM-DD.
2. Return one JSON object with the key "events", containing an array of event objects.
3. Each event must include: title, location, all_day, start_date, start_time, end_date, end_time, is_recurring, recurrence_rule, label, tag, description.
4. Dates must be YYYY-MM-DD. If the year is missing in source, infer from resolved date context; never leave year blank.
5. If a time range appears (e.g., 0800–2000), capture both start_time and end_time.
6. If a date range appears (e.g., Nov 17–18), capture both start_date and end_date.
7. If an event has no explicit time, set all_day=true and both times=null.
8. If recurring is implied, set is_recurring=true and recurrence_rule like "DAILY", "WEEKLY", etc.; else is_recurring=false and recurrence_rule=null.
9. For assignment-like items with no time, set start_time="11:00" and end_time="11:59". Do not invent time ranges.
10. Avoid duplicates. Normalize titles in title case, preserving existing ALL-CAPS acronyms.
11. Split distinct activities joined by "&", "and", commas, or semicolons if they are different types (Exam/Lab/Quiz/Assignment/etc.).
12. If multiple items are the same type with sections (e.g., "Practice Problems – 1.1, 1.2"), keep as one event.
13. Do not truncate extraction; process all content.
14. Keep titles concise; exclude verbs like "Submit", "Turn in", "Complete".
15. Return only valid JSON in the exact schema below.
Output format
{
  "events": [
    {
      "title": "Midterm Exam",
      "location": null,
      "all_day": false,
      "start_date": "2025-03-14",
      "start_time": "09:00",
      "end_date": "2025-03-14",
      "end_time": "11:00",
      "is_recurring": false,
      "recurrence_rule": null,
      "label": "BIO-201",
      "tag": "Exam",
      "description": null
    }
  ]
}`

const EVENT_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          location: { type: ["string", "null"] },
          all_day: { type: "boolean" },
          start_date: { type: "string" },
          start_time: { type: ["string", "null"] },
          end_date: { type: ["string", "null"] },
          end_time: { type: ["string", "null"] },
          is_recurring: { type: ["boolean", "null"] },
          recurrence_rule: { type: ["string", "null"] },
          label: { type: ["string", "null"] },
          tag: { type: ["string", "null"] },
          description: { type: ["string", "null"] }
        },
        required: ["title","location","all_day","start_date","start_time","end_date","end_time","is_recurring","recurrence_rule","label","tag","description"]
      }
    }
  },
  required: ["events"]
}

export class OpenAITextService {
  static async parseNaturalLanguage(input_source: string, year_context?: number, notes?: string): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const timezone = "America/New_York"
    const now = new Date()
    const nowIso = new Date(now.toLocaleString("en-US", { timeZone: timezone })).toISOString()
    const normalizedInput = normalizeRelativePhrases(input_source || "", now, timezone)
    const body = {
      model: "gpt-4o-mini",
      temperature: 0,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                input_source: normalizedInput,
                year_context: year_context ?? new Date(nowIso).getFullYear(),
                now_iso: nowIso,
                timezone,
                notes: notes ?? ""
              })
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "calendar_events",
          schema: EVENT_OBJECT_SCHEMA,
          strict: true
        }
      },
      max_output_tokens: 2000
    }
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || "OpenAI API request failed")
    }
    const data = await res.json()
    const content = data?.output?.[0]?.content?.[0]?.text ?? '{"events":[]}'
    const tokensUsed = data?.usage?.total_tokens || 0
    let parsedObj: { events: ParsedEvent[] } = { events: [] }
    try {
      parsedObj = JSON.parse(content)
    } catch {
      parsedObj = { events: [] }
    }
    let events: ParsedEvent[] = Array.isArray(parsedObj.events) ? parsedObj.events : []
    events = postNormalizeEvents(events)
    events = dedupeEvents(events)
    events = events.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.start_date || ""))
    events.sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        ((a.start_time || "23:59").localeCompare(b.start_time || "23:59")) ||
        a.title.localeCompare(b.title)
    )
    return { events, tokensUsed }
  }
}
