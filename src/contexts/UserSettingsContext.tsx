import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Ctx = {
  timezone: string
  setTimezone: (tz: string) => void
  tzOptions: string[]
}

const KEY = 'cp.timezone'
const DF = 'UTC'

function getSupportedTimezones(): string[] {
  const anyIntl: any = Intl as any
  if (anyIntl.supportedValuesOf) {
    const list = anyIntl.supportedValuesOf('timeZone') as string[]
    if (Array.isArray(list) && list.length) return list
  }
  return ['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Europe/Berlin','Asia/Tokyo','Asia/Shanghai','Asia/Kolkata','Australia/Sydney']
}

const UserSettingsContext = createContext<Ctx>({ timezone: DF, setTimezone: () => {}, tzOptions: [DF] })

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezoneState] = useState<string>(() => localStorage.getItem(KEY) || DF)
  const [tzOptions, setTzOptions] = useState<string[]>([])

  useEffect(() => {
    setTzOptions(getSupportedTimezones())
  }, [])

  useEffect(() => {
    localStorage.setItem(KEY, timezone || DF)
  }, [timezone])

  const setTimezone = (tz: string) => {
    setTimezoneState(tz || DF)
  }

  const value = useMemo<Ctx>(() => ({ timezone, setTimezone, tzOptions }), [timezone, tzOptions])

  return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>
}

export const useUserSettings = () => useContext(UserSettingsContext)
export { UserSettingsContext }
