export const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires'
export const TZ_SPAIN = 'Europe/Madrid'
export const DEFAULT_TIMEZONE = TZ_ARGENTINA

export function isAllowedTimezone(tz: string): boolean {
  return tz === TZ_ARGENTINA || tz === TZ_SPAIN
}

export function calendarPartsInTimeZone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
  const parts = dtf.formatToParts(date)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { year: n('year'), month: n('month'), day: n('day') }
}

export function todayIsoInTimeZone(timeZone: string): string {
  const p = calendarPartsInTimeZone(new Date(), timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function currentMonthInTimeZone(timeZone: string): string {
  const p = calendarPartsInTimeZone(new Date(), timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

/** Suma días a un `YYYY-MM-DD` (aritmética de calendario, sin zona). */
export function addCalendarDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return dt.toISOString().slice(0, 10)
}

export function formatDateInTimeZone(
  value: string | number | Date,
  timeZone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...opts,
  })
}
