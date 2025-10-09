export type EventLike = {
  all_day: boolean | null
  start_date: string | null
  start_time: string | null
  end_date: string | null
  end_time: string | null
}

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

function utcDateFromParts(dateStr: string, timeStr: string | null): Date {
  const t = timeStr ?? '00:00'
  return new Date(`${dateStr}T${t}:00.000Z`)
}

function fmt(d: Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(d)
}

export function asDisplayRange(e: EventLike, tz: string) {
  if (!e.start_date) return { startDate: '', startTime: '', endDate: '', endTime: '' }
  const s = utcDateFromParts(e.start_date, e.start_time)
  const eDate = e.end_date ?? e.start_date
  const end = utcDateFromParts(eDate, e.end_time)

  const startDate = fmt(s, tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const endDate = fmt(end, tz, { year: 'numeric', month: '2-digit', day: '2-digit' })

  if (e.all_day || (e.start_time == null && e.end_time == null)) {
    return { startDate, startTime: '', endDate, endTime: '' }
  }

  const startTime = fmt(s, tz, { hour: '2-digit', minute: '2-digit', hour12: true })
  const endTime = fmt(end, tz, { hour: '2-digit', minute: '2-digit', hour12: true })

  return { startDate, startTime, endDate, endTime }
}

export function toIsoLocalDateInTz(dateStr: string, timeStr: string | null, tz: string) {
  const d = utcDateFromParts(dateStr, timeStr)
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(d)
  const m = pad(Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit' }).format(d)))
  const da = pad(Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, day: '2-digit' }).format(d)))
  return `${y}-${m}-${da}`
}
