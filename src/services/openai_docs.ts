// src/services/openai_docs.ts
import mammoth from "mammoth"

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
const MAX_LINES_PER_TEXT_BATCH = 45
const MAX_CHARS_PER_TEXT_BATCH = 2000
const MAX_CONTENT_TOKENS = 8000
const BATCH_EVENT_CAP = 500

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

function denoiseLine(line: string): string {
  let s = line
  s = s.replace(/(^|\s)(M|T|Tu|Tue|Tues|W|Th|Thu|Thur|Thurs|F|Fr|Fri|Sat|Sun|Su)(?=\s|$)/gi, " ")
  s = s.replace(/\b(Sec(t(ion)?)?\.?\s*[A-Za-z0-9\-]+)\b/gi, " ")
  s = s.replace(/\b(Room|Rm\.?|Bldg|Building|Hall|Campus|Location)\s*[:#]?\s*[A-Za-z0-9\-\.\(\)]+/gi, " ")
  s = s.replace(/\b(Zoom|Online|In[-\s]?Person)\b/gi, " ")
  s = s.replace(/\b(CRN|Course\s*ID)\s*[:#]?\s*[A-Za-z0-9\-]+\b/gi, " ")
  s = s.replace(/[•●▪■]/g, "-").replace(/\s{2,}/g, " ").trim()
  return s
}

function toStructuredPlainText(raw: string): string {
  const cleaned = (raw || "").replace(/\r/g, "\n").replace(/\t/g, " ").replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n").trim()
  const lines = cleaned.split("\n").map((l) => denoiseLine(l)).filter(Boolean)
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

async function extractTextFromDocx(file: File): Promise<string> {
  const ab = await file.arrayBuffer()
  let text = ""
  try {
    const r = await (mammoth as any).extractRawText({ arrayBuffer: ab })
    text = r?.value || ""
  } catch {}
  if (text && text.trim()) return text
  const { value: html } = await (mammoth as any).convertToHtml({ arrayBuffer: ab })
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const parts: string[] = []
  doc.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("th,td")).map((c) => c.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean) as string[]
      const line = cells.join(" | ").trim()
      if (line) parts.push(line)
    })
  })
  doc.querySelectorAll("li, p").forEach((el) => {
    const t = el.textContent?.replace(/\s+/g, " ").trim()
    if (t) parts.push(t)
  })
  const lines = [...new Set(parts)].map((s) => s.trim()).filter(Boolean)
  return lines.join("\n")
}

const TEXT_SYSTEM_PROMPT = `You are an event extractor for schedules and syllabi.
Input is normalized text lines (some are flattened table rows joined with " | ").
Ignore noisy tokens like single-letter weekdays (M, T, W, Th, F), section/room codes, locations, instructor names, emails, and URLs.
Extract ONLY dated events/assignments with concise names.
Rules:
- Output schema ONLY: { "events": [ { "event_name": "Title-Case Short Name", "event_date": "YYYY-MM-DD", "event_time": "HH:MM" | null, "event_tag": "interview|exam|midterm|quiz|homework|assignment|class|lecture|lab|meeting|appointment|holiday|break|no_class|school_closed|other" | null } ] }
- Title-Case, professional, ≤ 40 chars; no dates/times/pronouns/descriptions in names. Do NOT echo source lines; do NOT include section numbers, room/location, URLs, instructor names, or extra notes in event_name.
- Use current year if missing (${new Date().getFullYear()}).
- Accept dates like YYYY-MM-DD, MM/DD, M/D, "Oct 5", "October 5".
- Times: "12 pm", "12:00pm", "12–1 pm", "noon"→"12:00", "midnight"→"00:00", ranges use start.
- If text implies due/submit/turn-in and no time, use "23:59".
- If no time in the line, event_time = null.
- If a line mentions multiple items for a date, create multiple events for that date.
- Be exhaustive; do not skip minor items.
Return ONLY valid JSON. No commentary, no markdown, no trailing commas.`

async function callOpenAI_JSON_TextBatch(batchText: string, batchIndex: number, totalBatches: number): Promise<{ parsed: any; tokensUsed: number }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: TEXT_SYSTEM_PROMPT },
        { role: "user", content: `Return JSON only.\nBatch ${batchIndex + 1}/${totalBatches}.\n---BEGIN---\n${batchText}\n---END---` }
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

export class OpenAIDocsService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const name = (file.name || "").toLowerCase()
    const type = (file.type || "").toLowerCase()
    if (!(type.includes("word") || name.endsWith(".docx") || name.endsWith(".doc"))) throw new Error("Unsupported Word file")
    const raw = await extractTextFromDocx(file)
    if (!raw?.trim()) return { events: [], tokensUsed: 0 }
    const structured = toStructuredPlainText(raw)
    const estimatedTokens = estimateTokens(structured)
    if (estimatedTokens > MAX_CONTENT_TOKENS) throw new Error(`Document contains too much information (~${estimatedTokens} tokens). Please upload a smaller section.`)
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
