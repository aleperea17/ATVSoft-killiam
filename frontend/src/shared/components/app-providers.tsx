'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useMonth } from '@/shared/hooks/use-month'
import { DEFAULT_TIMEZONE, isAllowedTimezone } from '@/shared/lib/tenant-time'

type MonthContextType = ReturnType<typeof useMonth>

const MonthContext = createContext<MonthContextType | null>(null)

export function useMonthContext() {
  const ctx = useContext(MonthContext)
  if (!ctx) throw new Error('useMonthContext must be inside AppProviders')
  return ctx
}

export type CompanyModules = {
  moduleReels: boolean
  moduleHistorias: boolean
  moduleYoutube: boolean
  moduleBio: boolean
  moduleKeywords: boolean
  moduleMarketingDashboard: boolean
}

export type CompanyConfigState = {
  companyName: string
  companyTagline: string
  logoUrl: string
  timezone: string
  reservaCashUsd: number
  callReportsGate: boolean
  callReportsPasswordSet: boolean
  modules: CompanyModules
  loaded: boolean
}

const DEFAULT_MODULES: CompanyModules = {
  moduleReels: true,
  moduleHistorias: true,
  moduleYoutube: true,
  moduleBio: true,
  moduleKeywords: true,
  moduleMarketingDashboard: true,
}

const DEFAULT_COMPANY: CompanyConfigState = {
  companyName: 'ATV',
  companyTagline: '',
  logoUrl: '',
  timezone: DEFAULT_TIMEZONE,
  reservaCashUsd: 0,
  callReportsGate: false,
  callReportsPasswordSet: false,
  modules: DEFAULT_MODULES,
  loaded: false,
}

const CompanyConfigContext = createContext<CompanyConfigState>(DEFAULT_COMPANY)

export function useCompanyConfig() {
  return useContext(CompanyConfigContext)
}

function parseCompanyConfig(j: Record<string, unknown>): CompanyConfigState {
  const tz = String(j.timezone || '').trim()
  return {
    companyName: String(j.company_name || DEFAULT_COMPANY.companyName),
    companyTagline: String(j.company_tagline || ''),
    logoUrl: String(j.logo_url || ''),
    timezone: isAllowedTimezone(tz) ? tz : DEFAULT_TIMEZONE,
    reservaCashUsd: Number(j.reserva_cash_usd) || 0,
    callReportsGate: Boolean(j.call_reports_gate),
    callReportsPasswordSet: Boolean(j.call_reports_password_set),
    modules: {
      moduleReels: j.module_reels !== false,
      moduleHistorias: j.module_historias !== false,
      moduleYoutube: j.module_youtube !== false,
      moduleBio: j.module_bio !== false,
      moduleKeywords: j.module_keywords !== false,
      moduleMarketingDashboard: j.module_marketing_dashboard !== false,
    },
    loaded: true,
  }
}

function useCompanyConfigState(): CompanyConfigState {
  const { ready, userId } = useAuthUser()
  const [state, setState] = useState<CompanyConfigState>(DEFAULT_COMPANY)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => {
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    const onUpd = () => refetch()
    window.addEventListener('company-config-updated', onUpd)
    return () => window.removeEventListener('company-config-updated', onUpd)
  }, [refetch])

  useEffect(() => {
    if (!ready || !userId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/company-config')
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok || cancelled) return
        setState(parseCompanyConfig(j))
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loaded: true }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, userId, tick])

  return state
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const company = useCompanyConfigState()
  const monthState = useMonth(company.timezone)

  return (
    <CompanyConfigContext.Provider value={company}>
      <MonthContext.Provider value={monthState}>{children}</MonthContext.Provider>
    </CompanyConfigContext.Provider>
  )
}
