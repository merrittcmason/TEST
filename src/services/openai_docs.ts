import * as mammoth from "mammoth"

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
    let name = (e.event_name || "").trim().replace(/\s{2,}/g, " ")
    name = toTitleCase(name)
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
  const lines = cleaned.split("\n").map(l =>
    l.replace(/[•●▪■]/g, "-").replace(/\s{2,}/g, " ").trim()
  ).filter(Boolean)
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
    const r1 = await mammoth.extractRawText({ arrayBuffer: ab } as any)
    text = r1?.value || ""
  } catch {}
  if (!text) {
    const r2 = await mammoth.convertToHtml({ arrayBuffer: ab } as any)
    const html = r2?.value || ""
    text = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  }
  return text
}

const TEXT_SYSTEM_PROMPT = `You are an event extractor for schedules and syllabi. Return only JSON.
Input is normalized text lines (some are flattened table rows joined with "|").
Ignore noise such as single-letter weekdays, section/room codes, locations, instructor names, emails, URLs.
Extract only dated events or assignments with concise names.
Do not emit combined names like "A & B" or "A, B, C" when items A, B, C appear separately; output one event per item.
Preserve decimals and section identifiers exactly (e.g., "2.5", "1.1, 1.2").
Rules:
- Output schema only: {"events":[{"event_name":"Title-Case Short Name","event_date":"YYYY-MM-DD","event_time":"HH:MM"|null,"event_tag":"Interview|Exam|Midterm|Quiz|Homework|Assignment|Class|Lecture|Lab|Meeting|Appointment|Holiday|Break|No_Class|School_Closed|Other"|null}]}
- Names must be ≤ 40 chars, no dates/times/pronouns/descriptions.
- Use current year if missing.
- Accept dates like YYYY-MM-DD, MM/DD, M/D, "Oct 5", "October 5".
- Times: "12 pm", "12:00pm", "12–1 pm" → start time; "noon"→"12:00"; "midnight"→"00:00".
- If due/submit/turn-in and no time, use "23:59".
- If no time in the line, "event_time" = null.
- Be exhaustive but never create merged duplicate lines.
Return only valid JSON. The answer must be JSON.`

const REPAIR_PROMPT = `You will receive possibly malformed JSON for:
{"events":[{"event_name":"...", "event_date":"YYYY-MM-DD", "event_time":"HH:MM"|null, "event_tag":"..."|null}]}
Fix only syntax/shape. Return valid JSON exactly in that shape. No commentary. The answer must be JSON.`

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
      temperature: 0,
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
  try {
    const parsed = JSON.parse(content)
    return { parsed, tokensUsed }
  } catch {
    const repaired = await repairMalformedJSON(content)
    if (!repaired) throw new Error("Failed to parse AI response as JSON")
    return repaired
  }
}

async function repairMalformedJSON(bad: string): Promise<{ parsed: any; tokensUsed: number } | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: REPAIR_PROMPT },
        { role: "user", content: bad + "\nReturn JSON only." }
      ],
      temperature: 0,
      max_tokens: 800,
      response_format: { type: "json_object" }
    })
  })
  if (!res.ok) return null
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ""
  try {
    const parsed = JSON.parse(content)
    const tokensUsed = data?.usage?.total_tokens ?? 0
    return { parsed, tokensUsed }
  } catch {
    return null
  }
}

export class OpenAIWordService {
  static async parse(file: File): Promise<ParseResult> {
    if (!OPENAI_API_KEY) throw new Error("OpenAI API key not configured")
    const raw = await extractTextFromDocx(file)
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
    allEvents.sort((a, b) =>
      a.event_date.localeCompare(b.event_date) ||
      ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) ||
      a.event_name.localeCompare(b.event_name)
    )
    return { events: allEvents, tokensUsed: tokens }
  }
}
