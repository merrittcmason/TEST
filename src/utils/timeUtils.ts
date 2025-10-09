import { DateTime } from 'luxon'

export function toUTC(date: string, time: string | null, tz: string): { utcDate: string, utcTime: string | null } {
  if (!time) return { utcDate: date, utcTime: null }
  const local = DateTime.fromISO(`${date}T${time}`, { zone: tz })
  const utc = local.toUTC()
  return { utcDate: utc.toISODate()!, utcTime: utc.toFormat('HH:mm:ss') }
}

export function fromUTC(date: string, time: string | null, tz: string): { localDate: string, localTime: string | null } {
  if (!time) return { localDate: date, localTime: null }
  const utc = DateTime.fromISO(`${date}T${time}`, { zone: 'UTC' })
  const local = utc.setZone(tz)
  return { localDate: local.toISODate()!, localTime: local.toFormat('HH:mm') }
}

export function formatTimeForDisplay(time: string | null, tz: string, use24h: boolean): string {
  if (!time) return ''
  const utc = DateTime.fromISO(`1970-01-01T${time}`, { zone: 'UTC' })
  const local = utc.setZone(tz)
  return local.toFormat(use24h ? 'HH:mm' : 'h:mm a')
}

export function getDeviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
