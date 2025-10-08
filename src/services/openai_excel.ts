import * as XLSX from "xlsx"
import { DateTime } from "luxon"

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

function capTag(t: string | null | undefined): string | null {
  if (!t || typeof t !== "string") return null
  const s = t.trim()
  if (!s) return null
  return s[0].toUpperCase() + s.slice(1).toLowerCase()
}
function toTitleCase(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ")
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
export class OpenAIExcelService {
  static async parse(file: File): Promise<ParseResult> {
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data, { type: "array" })
    let out: ParsedEvent[] = []
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name]
      const parsed = tryParseEventsFromSheet(sheet)
      if (parsed.length) out = out.concat(parsed)
    }
    out = postNormalizeEvents(out)
    out = dedupeEvents(out)
    out = out.filter((e) => !!e.event_date)
    out.sort((a, b) => a.event_date.localeCompare(b.event_date) || ((a.event_time || "23:59").localeCompare(b.event_time || "23:59")) || a.event_name.localeCompare(b.event_name))
    return { events: out, tokensUsed: 0 }
  }
}
