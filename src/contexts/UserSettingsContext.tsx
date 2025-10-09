import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Ctx = {
  timezone: string
  preferDevice: boolean
  setTimezone: (tz: string) => void
  setPreferDevice: (v: boolean) => void
  tzOptions: string[]
}

const KEY_TZ = 'cp.timezone'
const KEY_PREF = 'cp.preferDevice'
const DF = 'UTC'

const MAJOR_TZ = [
  'UTC','Etc/GMT+12','Pacific/Midway','Pacific/Honolulu','America/Anchorage',
  'America/Los_Angeles','America/Phoenix','America/Denver','America/Chicago','America/New_York',
  'America/Toronto','America/Mexico_City','America/Bogota','America/Lima','America/Santiago',
  'America/Caracas','America/Sao_Paulo','America/Argentina/Buenos_Aires',
  'Atlantic/Azores','Atlantic/Cape_Verde',
  'Europe/Lisbon','Europe/London','Europe/Dublin','Europe/Madrid','Europe/Paris','Europe/Brussels','Europe/Amsterdam','Europe/Berlin','Europe/Rome','Europe/Zurich','Europe/Vienna','Europe/Prague','Europe/Stockholm','Europe/Copenhagen','Europe/Oslo','Europe/Warsaw','Europe/Budapest','Europe/Athens','Europe/Bucharest','Europe/Helsinki','Europe/Kiev','Europe/Istanbul','Europe/Moscow',
  'Africa/Casablanca','Africa/Algiers','Africa/Lagos','Africa/Nairobi','Africa/Johannesburg','Africa/Cairo',
  'Asia/Jerusalem','Asia/Beirut','Asia/Dubai','Asia/Tehran','Asia/Baghdad','Asia/Riyadh','Asia/Karachi','Asia/Kolkata','Asia/Dhaka','Asia/Bangkok','Asia/Jakarta','Asia/Hong_Kong','Asia/Shanghai','Asia/Singapore','Asia/Taipei','Asia/Manila','Asia/Tokyo','Asia/Seoul',
  'Australia/Perth','Australia/Adelaide','Australia/Brisbane','Australia/Sydney','Pacific/Guam','Pacific/Auckland'
]

function getDeviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DF } catch { return DF }
}

function getSupportedTimezones(): string[] {
  const local = getDeviceTz()
  const anyIntl: any = Intl as any
  const fromIntl = typeof anyIntl.supportedValuesOf === 'function' ? (anyIntl.supportedValuesOf('timeZone') as string[]) : []
  const base = new Set<string>([...MAJOR_TZ, local, ...fromIntl].filter(Boolean))
  return Array.from(base).sort((a, b) => a.localeCompare(b))
}

const UserSettingsContext = createContext<Ctx>({
  timezone: DF,
  preferDevice: true,
  setTimezone: () => {},
  setPreferDevice: () => {},
  tzOptions: [DF]
})

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [tzOptions, setTzOptions] = useState<string[]>([DF])
  const [customTz, setCustomTz] = useState<string>(() => localStorage.getItem(KEY_TZ) || DF)
  const [preferDevice, setPreferDeviceState] = useState<boolean>(() => {
    const v = localStorage.getItem(KEY_PREF)
    return v == null ? true : v === 'true'
  })
  const [deviceTz, setDeviceTz] = useState<string>(getDeviceTz())

  useEffect(() => { setTzOptions(getSupportedTimezones()) }, [])
  useEffect(() => {
    const onFocus = () => setDeviceTz(getDeviceTz())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => { localStorage.setItem(KEY_TZ, customTz || DF) }, [customTz])
  useEffect(() => { localStorage.setItem(KEY_PREF, String(preferDevice)) }, [preferDevice])

  const timezone = preferDevice ? deviceTz : (customTz || DF)
  const setTimezone = (tz: string) => setCustomTz(tz || DF)
  const setPreferDevice = (v: boolean) => setPreferDeviceState(!!v)

  const value = useMemo<Ctx>(() => ({ timezone, preferDevice, setTimezone, setPreferDevice, tzOptions }), [timezone, preferDevice, tzOptions])

  return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>
}

export const useUserSettings = () => useContext(UserSettingsContext)
export { UserSettingsContext }
