import { useEffect, useState } from 'react'

const KEY = 'cp.timezone'
const DEFAULT_TZ = 'UTC'

function getSupportedTimezones(): string[] {
  const anyIntl: any = Intl as any
  if (anyIntl.supportedValuesOf) {
    const list = anyIntl.supportedValuesOf('timeZone') as string[]
    if (Array.isArray(list) && list.length) return list
  }
  return ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Europe/Berlin','Asia/Tokyo','Asia/Shanghai','Asia/Kolkata','Australia/Sydney']
}

export function useTimezone() {
  const [timezone, setTimezone] = useState<string>(() => localStorage.getItem(KEY) || DEFAULT_TZ)
  const [options, setOptions] = useState<string[]>([])

  useEffect(() => {
    setOptions(getSupportedTimezones())
  }, [])

  useEffect(() => {
    localStorage.setItem(KEY, timezone || DEFAULT_TZ)
  }, [timezone])

  return { timezone, setTimezone, options }
}
