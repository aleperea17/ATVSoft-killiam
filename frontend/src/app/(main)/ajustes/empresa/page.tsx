'use client'

import { FormEvent, useEffect, useState } from 'react'
import { apiFetch, formatApiDetail } from '@/lib/api'
import { useCompanyConfig } from '@/shared/components/app-providers'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'

const LABEL =
  'mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]'
const INPUT =
  'w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text3)] focus:border-[var(--accent)]'
const CARD =
  'rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-6 shadow-[0_0_0_1px_rgba(200,70,80,0.12),0_0_28px_-8px_rgba(180,50,60,0.35)]'

type TimezoneOption = { id: string; label: string }

type FormState = {
  company_name: string
  company_tagline: string
  logo_url: string
  timezone: string
  reserva_cash_usd: string
  call_reports_password: string
  clear_call_reports_password: boolean
  module_reels: boolean
  module_historias: boolean
  module_youtube: boolean
  module_bio: boolean
  module_keywords: boolean
  module_marketing_dashboard: boolean
}

const MODULE_FIELDS: { key: keyof FormState; label: string; hint: string }[] = [
  { key: 'module_marketing_dashboard', label: 'Dashboard marketing', hint: 'Vista /dashboard' },
  { key: 'module_reels', label: 'Reels', hint: 'Reels y métricas' },
  { key: 'module_historias', label: 'Historias', hint: 'Stories' },
  { key: 'module_youtube', label: 'YouTube', hint: 'Canal y analítica' },
  { key: 'module_bio', label: 'BIO', hint: 'Link in bio' },
  { key: 'module_keywords', label: 'Lead por reel', hint: 'Keywords y métricas' },
]

export default function EmpresaSettingsPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const cfg = useCompanyConfig()
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [passwordSet, setPasswordSet] = useState(false)
  const [tzOptions, setTzOptions] = useState<TimezoneOption[]>([
    { id: 'America/Argentina/Buenos_Aires', label: 'Argentina' },
    { id: 'Europe/Madrid', label: 'España' },
  ])
  const [form, setForm] = useState<FormState>({
    company_name: cfg.companyName,
    company_tagline: cfg.companyTagline,
    logo_url: cfg.logoUrl,
    timezone: cfg.timezone,
    reserva_cash_usd: String(cfg.reservaCashUsd || 0),
    call_reports_password: '',
    clear_call_reports_password: false,
    module_reels: cfg.modules.moduleReels,
    module_historias: cfg.modules.moduleHistorias,
    module_youtube: cfg.modules.moduleYoutube,
    module_bio: cfg.modules.moduleBio,
    module_keywords: cfg.modules.moduleKeywords,
    module_marketing_dashboard: cfg.modules.moduleMarketingDashboard,
  })

  useEffect(() => {
    if (!ready || !userId) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await apiFetch('/company-config')
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok || cancelled) {
          if (!res.ok && !cancelled) setError(formatApiDetail(j.detail, 'No se pudo cargar la empresa'))
          return
        }
        if (Array.isArray(j.timezone_options) && j.timezone_options.length) {
          setTzOptions(j.timezone_options as TimezoneOption[])
        }
        setPasswordSet(Boolean(j.call_reports_password_set))
        setForm({
          company_name: String(j.company_name || ''),
          company_tagline: String(j.company_tagline || ''),
          logo_url: String(j.logo_url || ''),
          timezone: String(j.timezone || cfg.timezone),
          reserva_cash_usd: String(j.reserva_cash_usd ?? 0),
          call_reports_password: '',
          clear_call_reports_password: false,
          module_reels: j.module_reels !== false,
          module_historias: j.module_historias !== false,
          module_youtube: j.module_youtube !== false,
          module_bio: j.module_bio !== false,
          module_keywords: j.module_keywords !== false,
          module_marketing_dashboard: j.module_marketing_dashboard !== false,
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, userId])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const reserva = Number(String(form.reserva_cash_usd).replace(',', '.'))
    if (!Number.isFinite(reserva) || reserva < 0) {
      setError('La reserva cash tiene que ser un número mayor o igual a 0.')
      return
    }
    setPending(true)
    try {
      const body: Record<string, unknown> = {
        company_name: form.company_name.trim(),
        company_tagline: form.company_tagline.trim(),
        logo_url: form.logo_url.trim(),
        timezone: form.timezone,
        reserva_cash_usd: reserva,
        module_reels: form.module_reels,
        module_historias: form.module_historias,
        module_youtube: form.module_youtube,
        module_bio: form.module_bio,
        module_keywords: form.module_keywords,
        module_marketing_dashboard: form.module_marketing_dashboard,
      }
      if (form.clear_call_reports_password) {
        body.clear_call_reports_password = true
      } else if (form.call_reports_password.trim()) {
        body.call_reports_password = form.call_reports_password.trim()
      }
      const res = await apiFetch('/company-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(formatApiDetail(j.detail, 'No se pudo guardar'))
        return
      }
      setPasswordSet(Boolean(j.call_reports_password_set))
      setForm((prev) => ({ ...prev, call_reports_password: '', clear_call_reports_password: false }))
      window.dispatchEvent(new Event('company-config-updated'))
      toast('Configuración de empresa guardada.')
    } finally {
      setPending(false)
    }
  }

  if (!ready || loading) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando…</div>
  }
  if (!userId) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Iniciá sesión para editar la empresa.</div>
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-bold tracking-tight">Empresa</h2>
      <p className="mt-1 text-[12px] text-[var(--text3)]">
        Nombre, logo, zona horaria, módulos y contraseña del reporte de calls.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <div className={CARD}>
          <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
            Marca
          </h3>
          <div className="space-y-4">
            <label className="block">
              <span className={LABEL}>Nombre</span>
              <input
                className={INPUT}
                value={form.company_name}
                onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
                required
              />
            </label>
            <label className="block">
              <span className={LABEL}>Tagline</span>
              <input
                className={INPUT}
                value={form.company_tagline}
                onChange={(e) => setForm((p) => ({ ...p, company_tagline: e.target.value }))}
                placeholder="Opcional"
              />
            </label>
            <label className="block">
              <span className={LABEL}>Logo (URL)</span>
              <input
                className={INPUT}
                value={form.logo_url}
                onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))}
                placeholder="https://… o /media/…"
              />
            </label>
          </div>
        </div>

        <div className={CARD}>
          <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
            Operación
          </h3>
          <div className="space-y-4">
            <label className="block">
              <span className={LABEL}>Zona horaria</span>
              <select
                className={INPUT}
                value={form.timezone}
                onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
              >
                {tzOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>Reserva cash (€)</span>
              <input
                className={INPUT}
                type="number"
                min={0}
                step="0.01"
                value={form.reserva_cash_usd}
                onChange={(e) => setForm((p) => ({ ...p, reserva_cash_usd: e.target.value }))}
              />
              <span className="mt-1 block text-[11px] text-[var(--text3)]">
                0 = no imputar cash por reserva en reportes closer.
              </span>
            </label>
            <label className="block">
              <span className={LABEL}>Contraseña reporte calls</span>
              <input
                className={INPUT}
                type="password"
                autoComplete="new-password"
                value={form.call_reports_password}
                disabled={form.clear_call_reports_password}
                onChange={(e) => setForm((p) => ({ ...p, call_reports_password: e.target.value }))}
                placeholder={passwordSet ? 'Dejá vacío para no cambiarla' : 'Vacío = sin gate (o usa env)'}
              />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--text2)]">
              <input
                type="checkbox"
                checked={form.clear_call_reports_password}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    clear_call_reports_password: e.target.checked,
                    call_reports_password: e.target.checked ? '' : p.call_reports_password,
                  }))
                }
              />
              Quitar contraseña guardada
              {passwordSet ? (
                <span className="text-[11px] text-[var(--text3)]">(hay una configurada)</span>
              ) : null}
            </label>
          </div>
        </div>

        <div className={CARD}>
          <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--text)]">
            Módulos
          </h3>
          <p className="mb-4 text-[12px] text-[var(--text3)]">
            Lo que apagues se oculta del menú. Ventas, equipo y cobranzas siguen disponibles.
          </p>
          <div className="space-y-2">
            {MODULE_FIELDS.map((item) => (
              <label key={item.key} className="flex items-start gap-2 text-[13px] text-[var(--text2)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(form[item.key])}
                  onChange={(e) => setForm((p) => ({ ...p, [item.key]: e.target.checked }))}
                />
                <span>
                  {item.label}
                  <span className="ml-1 text-[11px] text-[var(--text3)]">{item.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-[13px] text-[var(--red)]">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--auth-cta-bg)] px-4 py-2.5 text-[13px] font-semibold text-[var(--auth-cta-text)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </div>
  )
}
