'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'
import { useCompanyConfig } from '@/shared/components/app-providers'
import { todayIsoInTimeZone } from '@/shared/lib/tenant-time'

type TeamMemberOption = { id: number; nombre: string }

type DailyReport = {
  date: string
  memberId: number | ''
  conversaciones: number
  agendas: number
  calendly_links: number
  calls_scheduled: number
  shows: number
  cierres: number
  calificados: number
  descalificados: number
  ingreso: number
  notes: string
  nombreLead: string
  estadoFinalLlamada: string
  perfilLead: string
  objecionMiedo: string
  doloresLlamada: string
  razonCompraFinal: string
  insightsMarketingLlamada: string
  sentimiento_trafico: string
  avatar_tipo_agendas: string
  insights_marketing: string
  conversaciones_stories: number
  conversaciones_reels: number
  agendas_stories: number
  agendas_reels: number
  agendas_ads: number
  links_enviados_stories: number
  links_enviados_reels: number
  shows_organico: number
  shows_ads: number
  cierres_organico: number
  cierres_ads: number
  reservas: number
  seguimiento: number
  facturacion: number
}

const CLOSER_ESTADOS_FINAL = [
  'Re-agendado',
  'Cerrado',
  'No cerrado',
  'Señado',
  'Descalificado',
] as const

const CLOSER_PERFILES_LEAD = [
  'Experto en infoproductos',
  'Dueño de agencias',
  'Setter / closer / editor / etc.',
  'Infoproductor (persona que ya tiene un producto digital validado)',
  'Creador de contenido (persona que no tiene un infoproducto y solo crea contenido)',
  'Otro',
] as const

type Props = {
  role: 'setter' | 'closer'
}

type CloserKind = 'ventas' | 'marketing'

type NumKey =
  | 'conversaciones'
  | 'agendas'
  | 'calendly_links'
  | 'calls_scheduled'
  | 'shows'
  | 'cierres'
  | 'calificados'
  | 'descalificados'
  | 'ingreso'
  | 'conversaciones_stories'
  | 'conversaciones_reels'
  | 'agendas_stories'
  | 'agendas_reels'
  | 'agendas_ads'
  | 'links_enviados_stories'
  | 'links_enviados_reels'
  | 'shows_organico'
  | 'shows_ads'
  | 'cierres_organico'
  | 'cierres_ads'
  | 'reservas'
  | 'seguimiento'
  | 'facturacion'

function errMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x))).join(', ')
  }
  return 'Error en la solicitud'
}

export function DailyReportSection({ role }: Props) {
  const { ready, userId } = useAuthUser()
  const { timezone, reservaCashUsd } = useCompanyConfig()
  const { toast } = useToast()
  const [members, setMembers] = useState<TeamMemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [setterSavedStamp, setSetterSavedStamp] = useState<string | null>(null)
  const [closerVentasSavedStamp, setCloserVentasSavedStamp] = useState<string | null>(null)
  /** Varios reportes marketing por día: contamos guardados exitosos para la pareja closer|fecha. */
  const [marketingSavedByStamp, setMarketingSavedByStamp] = useState<{ stamp: string; count: number }>({
    stamp: '',
    count: 0,
  })
  const marketingCountFetchGen = useRef(0)
  const [closerKind, setCloserKind] = useState<CloserKind>('ventas')

  const today = todayIsoInTimeZone(timezone)

  const [form, setForm] = useState<DailyReport>({
    date: today,
    memberId: '',
    conversaciones: 0,
    agendas: 0,
    calendly_links: 0,
    calls_scheduled: 0,
    shows: 0,
    cierres: 0,
    calificados: 0,
    descalificados: 0,
    ingreso: 0,
    notes: '',
    nombreLead: '',
    estadoFinalLlamada: '',
    perfilLead: '',
    objecionMiedo: '',
    doloresLlamada: '',
    razonCompraFinal: '',
    insightsMarketingLlamada: '',
    sentimiento_trafico: '',
    avatar_tipo_agendas: '',
    insights_marketing: '',
    conversaciones_stories: 0,
    conversaciones_reels: 0,
    agendas_stories: 0,
    agendas_reels: 0,
    agendas_ads: 0,
    links_enviados_stories: 0,
    links_enviados_reels: 0,
    shows_organico: 0,
    shows_ads: 0,
    cierres_organico: 0,
    cierres_ads: 0,
    reservas: 0,
    seguimiento: 0,
    facturacion: 0,
  })

  const fetchMembers = useCallback(async () => {
    if (!ready || !userId) {
      setMembers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/team/members')
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        setMembers([])
        return
      }
      const data = (await res.json()) as { setters: { id: number; nombre: string }[]; closers: { id: number; nombre: string }[] }
      const list = role === 'setter' ? data.setters ?? [] : data.closers ?? []
      setMembers(list.map((m) => ({ id: m.id, nombre: m.nombre })))
    } catch {
      toast('No se pudo cargar el equipo.')
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, role])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  const stamp = (mid: number | '', d: string) => `${mid}|${d}`

  useEffect(() => {
    if (role !== 'closer' || !ready || !userId || form.memberId === '') return
    marketingCountFetchGen.current += 1
    const gen = marketingCountFetchGen.current
    let cancelled = false
    const mid = form.memberId
    const d = form.date
    void (async () => {
      const res = await apiFetch(
        `/team/closer-marketing-report-count?fecha=${encodeURIComponent(d)}&member_id=${mid}`,
      )
      if (cancelled || !res.ok) return
      const data = (await res.json().catch(() => null)) as { count?: unknown } | null
      if (cancelled || !data || typeof data.count !== 'number') return
      if (marketingCountFetchGen.current !== gen) return
      setMarketingSavedByStamp({ stamp: stamp(mid, d), count: data.count })
    })()
    return () => {
      cancelled = true
    }
  }, [role, ready, userId, form.memberId, form.date])

  const setterSavedThisDate =
    role === 'setter' && setterSavedStamp === stamp(form.memberId, form.date) && form.memberId !== ''
  const setterSavedForDate = setterSavedThisDate && form.date === today

  const closerVentasSavedForSelection =
    form.memberId !== '' && closerVentasSavedStamp === stamp(form.memberId, form.date)

  const marketingCountForSelection =
    form.memberId !== '' && marketingSavedByStamp.stamp === stamp(form.memberId, form.date)
      ? marketingSavedByStamp.count
      : 0

  const resetCloserKindFields = () => {
    setForm((f) => ({
      ...f,
      calls_scheduled: 0,
      shows: 0,
      cierres: 0,
      calificados: 0,
      descalificados: 0,
      ingreso: 0,
      reservas: 0,
      seguimiento: 0,
      facturacion: 0,
      shows_organico: 0,
      shows_ads: 0,
      cierres_organico: 0,
      cierres_ads: 0,
      notes: '',
      nombreLead: '',
      estadoFinalLlamada: '',
      perfilLead: '',
      objecionMiedo: '',
      doloresLlamada: '',
      razonCompraFinal: '',
      insightsMarketingLlamada: '',
    }))
  }

  const handleCloserOpen = (kind: CloserKind) => {
    if (role !== 'closer') return
    if (showForm && closerKind === kind) {
      setShowForm(false)
      return
    }
    if (showForm && closerKind !== kind) {
      resetCloserKindFields()
    }
    setCloserKind(kind)
    setShowForm(true)
  }

  const numInputClass =
    'w-full min-w-0 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 !text-left text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const fieldLabelClass = 'text-[11px] font-medium leading-snug text-[var(--text2)]'

  const numField = (
    key: NumKey,
    label: React.ReactNode,
    isCurrency = false,
    labelClass = fieldLabelClass,
    hint?: React.ReactNode,
    labelMinHeight = '',
  ) => (
    <div className="flex min-w-0 flex-col">
      <label
        className={`mb-1.5 flex items-end leading-snug ${labelMinHeight} ${labelClass}`}
      >
        {label}
      </label>
      <input
        type="number"
        value={form[key]}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            [key]: isCurrency ? parseFloat(e.target.value) || 0 : parseInt(e.target.value, 10) || 0,
          }))
        }
        placeholder="0"
        className={numInputClass}
      />
      {hint}
    </div>
  )

  const setterConversacionesRow = (
    fields: { key: NumKey; label: string }[],
  ) => (
    <div className="grid grid-cols-3 gap-3">
      {fields.map(({ key, label }) => (
        <Fragment key={key}>
          {numField(key, label, false, fieldLabelClass, undefined, 'min-h-[2.75rem]')}
        </Fragment>
      ))}
    </div>
  )

  const setterConversacionesTotal =
    form.conversaciones_stories + form.conversaciones_reels
  const setterAgendasTotal =
    form.agendas_stories + form.agendas_reels + form.agendas_ads
  const closerShowsTotal = form.shows_organico + form.shows_ads
  const closerCierresTotal = form.cierres_organico + form.cierres_ads

  const closerVentasBreakdownBlock = (
    title: string,
    subs: { key: NumKey; label: string }[],
  ) => (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg3)]/40 p-3">
      <div className="mb-3 text-[12px] font-semibold text-[var(--text)]">{title}</div>
      <div className="grid grid-cols-2 gap-3">
        {subs.map(({ key, label }) => (
          <Fragment key={key}>{numField(key, label)}</Fragment>
        ))}
      </div>
    </div>
  )

  const textareaField = (
    key: 'sentimiento_trafico' | 'avatar_tipo_agendas' | 'insights_marketing',
    label: string,
    placeholder: string,
    rows: number,
  ) => (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium leading-snug text-[var(--text)]">{label}</label>
      <textarea
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
      />
    </div>
  )

  const handleSave = async () => {
    if (!userId) {
      toast('Iniciá sesión')
      return
    }
    if (form.memberId === '') {
      toast('Seleccioná un miembro')
      return
    }
    setSaving(true)
    try {
      if (role === 'setter') {
        const conversaciones = form.conversaciones_stories + form.conversaciones_reels
        const agendas = form.agendas_stories + form.agendas_reels + form.agendas_ads
        const links_enviados = form.links_enviados_stories + form.links_enviados_reels
        const res = await apiFetch('/team/setter-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member_id: form.memberId,
            fecha: form.date,
            conversaciones,
            agendas,
            links_enviados,
            conversaciones_stories: form.conversaciones_stories,
            conversaciones_reels: form.conversaciones_reels,
            agendas_stories: form.agendas_stories,
            agendas_reels: form.agendas_reels,
            agendas_ads: form.agendas_ads,
            links_enviados_stories: form.links_enviados_stories,
            links_enviados_reels: form.links_enviados_reels,
            notas: null,
            sentimiento_trafico: form.sentimiento_trafico.trim() || null,
            avatar_tipo_agendas: form.avatar_tipo_agendas.trim() || null,
            insights_marketing: form.insights_marketing.trim() || null,
          }),
        })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
      } else {
        if (closerKind === 'marketing') {
          if (!form.nombreLead.trim()) {
            toast('Indicá el nombre del lead.')
            setSaving(false)
            return
          }
          if (!form.estadoFinalLlamada || !form.perfilLead) {
            toast('Seleccioná el estado final de la llamada y el perfil del lead.')
            setSaving(false)
            return
          }
        }
        const res = await apiFetch('/team/closer-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            closerKind === 'marketing'
              ? {
                  member_id: form.memberId,
                  fecha: form.date,
                  reporte_tipo: 'marketing',
                  llamadas_agendadas: 0,
                  shows: 0,
                  cierres: 0,
                  calificados: 0,
                  descalificados: 0,
                  ingreso: 0,
                  notas: null,
                  nombre_lead: form.nombreLead.trim(),
                  estado_final_llamada: form.estadoFinalLlamada,
                  perfil_lead: form.perfilLead,
                  objecion_miedo: form.objecionMiedo.trim() || null,
                  dolores_llamada: form.doloresLlamada.trim() || null,
                  razon_compra_final: form.razonCompraFinal.trim() || null,
                  insights_marketing_llamada: form.insightsMarketingLlamada.trim() || null,
                }
              : {
                  member_id: form.memberId,
                  fecha: form.date,
                  reporte_tipo: 'ventas',
                  llamadas_agendadas: form.calls_scheduled,
                  shows: form.shows_organico + form.shows_ads,
                  cierres: form.cierres_organico + form.cierres_ads,
                  calificados: form.calificados,
                  descalificados: form.descalificados,
                  ingreso: form.ingreso,
                  shows_organico: form.shows_organico,
                  shows_ads: form.shows_ads,
                  cierres_organico: form.cierres_organico,
                  cierres_ads: form.cierres_ads,
                  reservas: form.reservas,
                  seguimiento: form.seguimiento,
                  facturacion: form.facturacion,
                  notas: form.notes.trim() || null,
                },
          ),
        })
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
      }
      const s = stamp(form.memberId, form.date)
      if (role === 'setter') {
        toast('Reporte guardado')
        setSetterSavedStamp(s)
        setShowForm(false)
      } else if (closerKind === 'marketing') {
        toast('Llamada guardada — podés cargar otra')
        setMarketingSavedByStamp((prev) =>
          prev.stamp === s ? { stamp: s, count: prev.count + 1 } : { stamp: s, count: 1 },
        )
        setForm((f) => ({
          ...f,
          nombreLead: '',
          estadoFinalLlamada: '',
          perfilLead: '',
          objecionMiedo: '',
          doloresLlamada: '',
          razonCompraFinal: '',
          insightsMarketingLlamada: '',
        }))
      } else {
        toast('Reporte guardado')
        setCloserVentasSavedStamp(s)
        setShowForm(false)
      }
      void fetchMembers()
      window.dispatchEvent(new Event('atv-team-reports-changed'))
    } catch {
      toast('No se pudo guardar el reporte.')
    } finally {
      setSaving(false)
    }
  }

  if (!ready || loading) {
    return (
      <div className="flex min-h-[100px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg3)] px-4 py-8 text-[13px] text-[var(--text3)]">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" aria-hidden />
        <span className="mt-3">Cargando equipo…</span>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg3)] px-4 py-8 text-center text-[13px] text-[var(--text3)]">
        Iniciá sesión para cargar reportes.
      </div>
    )
  }

  const closerBtnLabel = (kind: CloserKind) => {
    const short = kind === 'ventas' ? 'ventas' : 'marketing'
    const hoy = form.date === today
    if (showForm && closerKind === kind) return 'Cerrar'
    if (kind === 'ventas' && closerVentasSavedForSelection) {
      return hoy ? `Editar reporte de hoy ${short}` : `Editar reporte ${short}`
    }
    if (kind === 'marketing' && marketingCountForSelection > 0) {
      return '+ Otra llamada (marketing)'
    }
    return kind === 'marketing' ? '+ Reporte marketing por llamada' : `+ Cargar reporte diario ${short}`
  }

  return (
    <div className="space-y-4">
      {role === 'setter' ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="w-full rounded-xl bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--auth-cta-text)] shadow-[0_4px_18px_-6px_rgba(0,0,0,0.15)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(0,0,0,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {showForm
              ? 'Cerrar'
              : setterSavedThisDate
                ? setterSavedForDate
                  ? 'Editar reporte de hoy'
                  : 'Editar reporte'
                : '+ Cargar reporte diario'}
          </button>
          {setterSavedForDate && (
            <span className="block text-[11px] font-medium text-[var(--green)]">✓ Reporte de hoy cargado</span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleCloserOpen('ventas')}
              className="w-full rounded-xl bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--auth-cta-text)] shadow-[0_4px_18px_-6px_rgba(0,0,0,0.15)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(0,0,0,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {closerBtnLabel('ventas')}
            </button>
            {closerVentasSavedForSelection && form.date === today && form.memberId !== '' && (
              <span className="block text-[11px] font-medium text-[var(--green)]">✓ Ventas hoy</span>
            )}
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => handleCloserOpen('marketing')}
              className="w-full rounded-xl bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--auth-cta-text)] shadow-[0_4px_18px_-6px_rgba(0,0,0,0.15)] transition-all hover:brightness-110 hover:shadow-[0_6px_22px_-6px_rgba(0,0,0,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {closerBtnLabel('marketing')}
            </button>
            {marketingCountForSelection > 0 && form.date === today && form.memberId !== '' && (
              <span className="block text-[11px] font-medium text-[var(--green)]">
                ✓ {marketingCountForSelection} llamada{marketingCountForSelection === 1 ? '' : 's'} marketing hoy
              </span>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="glass-card glass-card--performant p-5">
          <div className="mb-4 text-[13px] font-semibold">
            {role === 'setter'
              ? 'Reporte Diario — Setter'
              : closerKind === 'ventas'
                ? 'Reporte Diario — Closer (Ventas)'
                : 'Reporte por llamada — Closer (Marketing)'}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                {role === 'setter' ? 'Setter (selección)' : 'Closer (selección)'}
              </label>
              <select
                value={form.memberId === '' ? '' : String(form.memberId)}
                onChange={(e) => {
                  const v = e.target.value
                  setForm((f) => ({ ...f, memberId: v ? parseInt(v, 10) : '' }))
                }}
                className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              >
                <option value="">Seleccionar…</option>
                {members.length === 0 ? (
                  <option value="" disabled>
                    Sin miembros ({role})
                  </option>
                ) : (
                  members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {role === 'setter' ? (
            <>
              <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg3)]/40 p-4">
                <h3 className="mb-4 text-[12px] font-semibold text-[var(--text)]">Conversaciones</h3>
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                      Historias
                    </div>
                    {setterConversacionesRow([
                      { key: 'conversaciones_stories', label: 'Conversaciones reales' },
                      { key: 'links_enviados_stories', label: 'Calendlys enviados' },
                      { key: 'agendas_stories', label: 'Llamadas agendadas' },
                    ])}
                  </div>
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                      Reels
                    </div>
                    {setterConversacionesRow([
                      { key: 'conversaciones_reels', label: 'Convers reales' },
                      { key: 'links_enviados_reels', label: 'Calendlys enviados' },
                      { key: 'agendas_reels', label: 'Llamadas agendadas' },
                    ])}
                  </div>
                  <div className="border-t border-[var(--border)] pt-4">
                    {numField('agendas_ads', 'Llamadas agendadas (Ads)')}
                  </div>
                </div>
              </div>
              <div className="mb-4 space-y-4">
                {textareaField(
                  'sentimiento_trafico',
                  '¿Cómo sentiste el día de hoy el tráfico?',
                  'Ej.: más lento de lo habitual, picos al mediodía…',
                  2,
                )}
                {textareaField(
                  'avatar_tipo_agendas',
                  'Avatar / Tipo de agendas generadas',
                  'Ej.: Hoy realicé 3 agendas (2 de ellas fueron experto en info y un dueño de agencia)',
                  3,
                )}
                {textareaField(
                  'insights_marketing',
                  'Insights clave que podrías aportar desde el setting hacia marketing',
                  'Qué viste en conversaciones que sirva para creativos, copy o segmentación…',
                  4,
                )}
              </div>
            </>
          ) : closerKind === 'ventas' ? (
            <>
              <div className="mb-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {numField('calls_scheduled', 'Llamadas agendadas')}
                  {numField('calificados', 'Calificados')}
                  {numField('descalificados', 'Descalificados')}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {closerVentasBreakdownBlock('Shows (presentadas)', [
                    { key: 'shows_organico', label: 'Orgánico' },
                    { key: 'shows_ads', label: 'Ads' },
                  ])}
                  {closerVentasBreakdownBlock('Cierres', [
                    { key: 'cierres_organico', label: 'Orgánico' },
                    { key: 'cierres_ads', label: 'Ads' },
                  ])}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {numField('ingreso', 'Ingreso / Cash Collected ($)', true)}
                  {numField('facturacion', 'Facturación ($)', true)}
                  {numField(
                    'reservas',
                    reservaCashUsd > 0
                      ? `Reservas (${formatCash(reservaCashUsd)} c/u)`
                      : 'Reservas',
                    false,
                    fieldLabelClass,
                    reservaCashUsd > 0 ? (
                      <div className="mt-1.5 text-[11px] text-[var(--text3)]">
                        Cash reservas: {formatCash(form.reservas * reservaCashUsd)}
                      </div>
                    ) : undefined,
                  )}
                </div>
                {numField('seguimiento', 'Leads en seguimiento (de las llamadas de hoy)')}
              </div>
              <div className="mb-4">
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  Notas (observaciones del día)
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Observaciones del día..."
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
            </>
          ) : (
            <div className="mb-4 space-y-4">
              <p className="text-[11px] leading-snug text-[var(--text3)]">
                Un guardado = una llamada. Podés cargar todas las del mismo día con la misma fecha y closer.
              </p>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  Nombre del lead
                </label>
                <input
                  type="text"
                  value={form.nombreLead}
                  onChange={(e) => setForm((f) => ({ ...f, nombreLead: e.target.value }))}
                  placeholder="Nombre o cómo lo identificás en el CRM…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                    Estado final de la llamada
                  </label>
                  <select
                    value={form.estadoFinalLlamada}
                    onChange={(e) => setForm((f) => ({ ...f, estadoFinalLlamada: e.target.value }))}
                    className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    <option value="">Seleccionar…</option>
                    {CLOSER_ESTADOS_FINAL.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                    ¿Qué perfil tenía el lead?
                  </label>
                  <select
                    value={form.perfilLead}
                    onChange={(e) => setForm((f) => ({ ...f, perfilLead: e.target.value }))}
                    className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    <option value="">Seleccionar…</option>
                    {CLOSER_PERFILES_LEAD.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  ¿Cuál fue su mayor objeción o miedo, cómo lo expresó?
                </label>
                <textarea
                  value={form.objecionMiedo}
                  onChange={(e) => setForm((f) => ({ ...f, objecionMiedo: e.target.value }))}
                  rows={3}
                  placeholder="Ej.: Me lo tengo que pensar, estoy comparando opciones…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  ¿Cuáles fueron sus principales dolores dentro de la llamada?
                </label>
                <textarea
                  value={form.doloresLlamada}
                  onChange={(e) => setForm((f) => ({ ...f, doloresLlamada: e.target.value }))}
                  rows={3}
                  placeholder="Ej.: No sé cómo escalar sin ADS y potenciar mi orgánico…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  ¿Cuál fue su razón de compra final?
                </label>
                <textarea
                  value={form.razonCompraFinal}
                  onChange={(e) => setForm((f) => ({ ...f, razonCompraFinal: e.target.value }))}
                  rows={2}
                  placeholder="Ej.: Los sistemas y el equipo…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium leading-snug text-[var(--text2)]">
                  Insights clave que podés aportar a marketing desde la llamada
                </label>
                <textarea
                  value={form.insightsMarketingLlamada}
                  onChange={(e) => setForm((f) => ({ ...f, insightsMarketingLlamada: e.target.value }))}
                  rows={4}
                  placeholder="Ej.: Más contenido sobre sistemas y procesos; más casos de éxito en el día a día…"
                  className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                />
              </div>
            </div>
          )}

          {role === 'setter' && setterConversacionesTotal > 0 && (
            <div className="mb-4 flex gap-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
              <div className="text-[11px]">
                <span className="text-[var(--text3)]">Tasa agend.:</span>{' '}
                <span className="font-semibold text-[var(--accent)]">
                  {((setterAgendasTotal / setterConversacionesTotal) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
          {role === 'closer' && closerKind === 'ventas' && closerShowsTotal > 0 && (
            <div className="mb-4 flex gap-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
              <div className="text-[11px]">
                <span className="text-[var(--text3)]">Close Rate:</span>{' '}
                <span className="font-semibold text-[var(--accent)]">
                  {((closerCierresTotal / closerShowsTotal) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="text-[11px]">
                <span className="text-[var(--text3)]">Ticket prom:</span>{' '}
                <span className="font-semibold text-[var(--green)]">
                  {closerCierresTotal > 0 ? formatCash(form.ingreso / closerCierresTotal) : formatCash(0)}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-xl bg-[var(--auth-cta-bg)] px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--auth-cta-text)] shadow-[0_4px_18px_-6px_rgba(0,0,0,0.15)] transition-all hover:brightness-110 disabled:opacity-50 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {saving ? 'Guardando...' : 'Guardar reporte'}
          </button>
        </div>
      )}
    </div>
  )
}
