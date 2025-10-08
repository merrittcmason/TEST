import { OpenAIExcelService, ParsedEvent as ExcelEvent, ParseResult as ExcelResult } from "./openai_excel"
import { OpenAIPdfService, ParsedEvent as PdfEvent, ParseResult as PdfResult } from "./openai_pdf"
import { OpenAIImageService, ParsedEvent as ImgEvent, ParseResult as ImgResult } from "./openai_image"
import * as chrono from "chrono-node"
import { DateTime } from "luxon"

export type ParsedEvent = ExcelEvent
export type ParseResult = ExcelResult

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY

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
      events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
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
    events.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events, tokensUsed }
  }
}

export class OpenAIFilesService {
  static async parseFile(file: File): Promise<{ events: ParsedEvent[]; tokensUsed: number }> {
    const name = (file.name || "").toLowerCase()
    const type = (file.type || "").toLowerCase()
    if (type.startsWith("image/")) {
      const r = await OpenAIImageService.parse(file)
      return r
    }
    if (type.includes("pdf") || name.endsWith(".pdf")) {
      const r = await OpenAIPdfService.parse(file)
      return r
    }
    if (type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const r = await OpenAIExcelService.parse(file)
      return r
    }
    if (name.endsWith(".csv")) {
      const fake = new File([file], file.name, { type: "application/vnd.ms-excel" })
      const r = await OpenAIExcelService.parse(fake)
      return r
    }
    if (type.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) {
      const mod = await import("./openai_word")
      const r = await mod.OpenAIWordService.parse(file)
      return r
    }
    throw new Error(`Unsupported file type: ${type || name}`)
  }
}
