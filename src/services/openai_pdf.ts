import * as pdfjsLib from "pdfjs-dist"
import { GlobalWorkerOptions } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url"

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
const TEXT_MODEL = "gpt-4o"
const MAX_TOKENS_TEXT = 700
const MAX_PDF_PAGES = 12
const MAX_LINES_PER_TEXT_BATCH = 45
const MAX_CHARS_PER_TEXT_BATCH = 2000
const MAX_CONTENT_TOKENS = 8000
const BATCH_EVENT_CAP = 500

GlobalWorkerOptions.workerSrc = pdfWorker

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4)
}
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
function toStructuredPlainText(raw: string): string {
  const cleaned = (raw || "").replace(/\r/g, "\n").replace(/\t/g, " ").replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n").trim()
  const lines = cleaned.split("\n").map((l) => l.replace(/[•●▪■]/g, "-").replace(/\s{2,}/g, " ").trim()).filter(Boolean)
  return lines.join("\n")
}
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

const TEXT_SYSTEM_PROMPT = `You are an event extractor for schedules and syllabi. The assistant must return JSON only.
Input is normalized text lines (some are flattened table rows joined with "|").
Extract ONLY dated events. Output one event per atomic item; do not emit combined names like "A & B" or "X, Y, Z" when those items appear separately.
Preserve decimals in identifiers such as "2.5" or "4.10".
Times: ranges use the start; "noon" -> "12:00"; "midnight" -> "00:00"; due/submit without an explicit time -> "23:59".
Return ONLY valid JSON with exactly this schema:
{"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Class|Lecture|Lab|Meeting|Appointment|Holiday|Break|No_Class|School_Closed|Other"|null}]}`

async function callOpenAI_JSON_TextBatch(batchText: string, batchIndex: number, totalBatches: number): Promise<{ parsed: any; tokensUsed: number }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: TEXT_SYSTEM_PROMPT },
        { role: "user", content: `Batch ${batchIndex + 1}/${totalBatches}. Return JSON only.\n---BEGIN---\n${batchText}\n---END---` }
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
  const parsed = JSON.parse(content)
  return { parsed, tokensUsed }
}

export class OpenAIPdfService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const raw = await extractTextFromPdf(file)
    const structured = toStructuredPlainText(raw || "")
    if (!structured) return { events: [], tokensUsed: 0 }
    const estimatedTokens = estimateTokens(structured)
    if (estimatedTokens > MAX_CONTENT_TOKENS) throw new Error(`Document too large (~${estimatedTokens} tokens). Upload a smaller section.`)
    const lines = structured.split("\n")
    const batches = chunkLines(lines, MAX_LINES_PER_TEXT_BATCH, MAX_CHARS_PER_TEXT_BATCH)
    let tokens = 0
    let allEvents: ParsedEvent[] = []
    for (let i = 0; i < batches.length; i++) {
      const { parsed, tokensUsed } = await callOpenAI_JSON_TextBatch(batches[i], i, batches.length)
      tokens += tokensUsed
      const evs = (parsed.events || []) as ParsedEvent[]
      allEvents.push(...evs.slice(0, BATCH_EVENT_CAP))
    }
    allEvents = postNormalizeEvents(allEvents)
    allEvents = dedupeEvents(allEvents)
    allEvents.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events: allEvents, tokensUsed: tokens }
  }
}
