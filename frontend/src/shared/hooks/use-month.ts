'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  calendarPartsInTimeZone,
  currentMonthInTimeZone,
  DEFAULT_TIMEZONE,
} from '@/shared/lib/tenant-time'

function getMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const date = new Date(year, m - 1, 1)
  return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

function getMonthOptions(timeZone: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const now = calendarPartsInTimeZone(new Date(), timeZone)
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.year, now.month - 1 - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    options.push({ value, label: getMonthLabel(value) })
  }
  return options
}

export function useMonth(timeZone: string = DEFAULT_TIMEZONE) {
  const [month, setMonth] = useState(() => currentMonthInTimeZone(timeZone))
  const tzRef = useRef(timeZone)

  useEffect(() => {
    if (tzRef.current === timeZone) return
    const prevCurrent = currentMonthInTimeZone(tzRef.current)
    const nextCurrent = currentMonthInTimeZone(timeZone)
    tzRef.current = timeZone
    setMonth((prev) => (prev === prevCurrent ? nextCurrent : prev))
  }, [timeZone])

  const options = getMonthOptions(timeZone)
  const label = getMonthLabel(month)

  const prev = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [month])

  const next = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }, [month])

  return { month, setMonth, label, options, prev, next }
}
