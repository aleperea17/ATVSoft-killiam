'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { Modal } from '@/shared/components/modal'
import { formatCash, formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { apiFetch } from '@/lib/api'
import { useCompanyConfig } from '@/shared/components/app-providers'
import { addCalendarDaysIso, currentMonthInTimeZone, todayIsoInTimeZone } from '@/shared/lib/tenant-time'

const REPORTES_PAGE_SIZE = 20

type ReporteFiltro = 'todos' | 'setter' | 'closer_marketing' | 'closer_ventas' | 'seguimiento'

type ReportRow =
  | {
      kind: 'setter'
      id: number
      fecha: string
      member_nombre: string
      conversaciones: number
      agendas: number
      links_enviados: number
      conversaciones_stories: number
      conversaciones_reels: number
      agendas_stories: number
      agendas_reels: number
      agendas_ads: number
      links_enviados_stories: number
      links_enviados_reels: number
      notas: string
      sentimiento_trafico: string
      avatar_tipo_agendas: string
      insights_marketing: string
    }
  | {
      kind: 'seguimiento'
      id: number
      fecha: string
      member_id: number
      member_nombre: string
      nombre_lead: string
      monto: number
    }
  | {
      kind: 'closer'
      id: number
      fecha: string
      member_nombre: string
      reporte_tipo: string
      llamadas_agendadas: number
      shows: number
      cierres: number
      shows_organico: number
      shows_ads: number
      cierres_organico: number
      cierres_ads: number
      reservas: number
      seguimiento: number
      facturacion: number
      calificados: number
      descalificados: number
      ingreso: number
      notas: string
      nombre_lead: string
      estado_final_llamada: string
      perfil_lead: string
      objecion_miedo: string
      dolores_llamada: string
      razon_compra_final: string
      insights_marketing_llamada: string
    }

function errMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const d = (data as { detail: unknown }).detail
    if (typeof d === 'string') return d
    if (Array.isArray(d))
      return d
        .map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x)))
        .join(', ')
  }
  return 'Error en la solicitud'
}

function ymToDesdeHasta(ym: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null
  const desde = `${y}-${String(mo).padStart(2, '0')}-01`
  const end = new Date(y, mo, 0)
  const d = end.getDate()
  const hasta = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { desde, hasta }
}

const PDF_MES_OPCIONES: { v: string; nombre: string }[] = [
  { v: '01', nombre: 'Enero' },
  { v: '02', nombre: 'Febrero' },
  { v: '03', nombre: 'Marzo' },
  { v: '04', nombre: 'Abril' },
  { v: '05', nombre: 'Mayo' },
  { v: '06', nombre: 'Junio' },
  { v: '07', nombre: 'Julio' },
  { v: '08', nombre: 'Agosto' },
  { v: '09', nombre: 'Septiembre' },
  { v: '10', nombre: 'Octubre' },
  { v: '11', nombre: 'Noviembre' },
  { v: '12', nombre: 'Diciembre' },
]

function pdfAniosOpciones(): number[] {
  const y = new Date().getFullYear()
  const out: number[] = []
  for (let a = y - 6; a <= y + 2; a += 1) out.push(a)
  return out
}

/** Una línea: REPORTE SETTER | CLOSER VENTAS | CLOSER MARKETING - dd-mm-aaaa - NOMBRE */
function reportListTitle(r: ReportRow): string {
  const fd = formatIsoDateDdMmYyyy(r.fecha)
  if (r.kind === 'setter') {
    return `REPORTE SETTER - ${fd} - ${r.member_nombre}`
  }
  if (r.kind === 'seguimiento') {
    return `REPORTE SEGUIMIENTO - ${fd} - ${r.member_nombre}`
  }
  const tipo = r.reporte_tipo === 'marketing' ? 'MARKETING' : 'VENTAS'
  return `REPORTE CLOSER ${tipo} - ${fd} - ${r.member_nombre}`
}

function SetterMetricRow({
  title,
  conversaciones,
  calendlys,
  agendas,
}: {
  title: string
  conversaciones: number
  calendlys: number
  agendas: number
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-3 text-[12px]">
        <div>
          <dt className="font-bold text-[var(--text)]">Conv. reales</dt>
          <dd className="font-mono-num text-[var(--text)]">{conversaciones}</dd>
        </div>
        <div>
          <dt className="font-bold text-[var(--text)]">Calendlys enviados</dt>
          <dd className="font-mono-num text-[var(--text)]">{calendlys}</dd>
        </div>
        <div>
          <dt className="font-bold text-[var(--text)]">Llamadas agendadas</dt>
          <dd className="font-mono-num text-[var(--text)]">{agendas}</dd>
        </div>
      </div>
    </div>
  )
}

function SetterConversacionesDetail({
  r,
}: {
  r: Extract<ReportRow, { kind: 'setter' }>
}) {
  const conversacionesStories = Number(r.conversaciones_stories) || 0
  const conversacionesReels = Number(r.conversaciones_reels) || 0
  const linksStories = Number(r.links_enviados_stories) || 0
  const linksReels = Number(r.links_enviados_reels) || 0
  const agendasStories = Number(r.agendas_stories) || 0
  const agendasReels = Number(r.agendas_reels) || 0
  const agendasAds = Number(r.agendas_ads) || 0

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-[12px] font-semibold text-[var(--text)]">Conversaciones</div>
        <div className="space-y-4">
          <SetterMetricRow
            title="Historias"
            conversaciones={conversacionesStories}
            calendlys={linksStories}
            agendas={agendasStories}
          />
          <SetterMetricRow
            title="Reels"
            conversaciones={conversacionesReels}
            calendlys={linksReels}
            agendas={agendasReels}
          />
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
              Ads
            </div>
            <div className="text-[12px]">
              <dt className="font-bold text-[var(--text)]">Llamadas agendadas</dt>
              <dd className="font-mono-num text-[var(--text)]">{agendasAds}</dd>
            </div>
          </div>
        </div>
      </div>
      <div className="text-[11px] text-[var(--text3)]">
        Totales del día:{' '}
        <span className="font-mono-num text-[var(--text2)]">
          {Number(r.conversaciones) || 0} conv. · {Number(r.agendas) || 0} agendas ·{' '}
          {Number(r.links_enviados) || 0} calendlys
        </span>
      </div>
    </div>
  )
}

function ReportDetail({ r }: { r: ReportRow }) {
  const { reservaCashUsd } = useCompanyConfig()
  if (r.kind === 'setter') {
    return (
      <dl className="grid gap-4 text-[12px] text-[var(--text)]">
        <div className="sm:col-span-2">
          <SetterConversacionesDetail r={r} />
        </div>
        {r.notas ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Notas</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.notas}</dd>
          </div>
        ) : null}
        {r.sentimiento_trafico ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Tráfico</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.sentimiento_trafico}</dd>
          </div>
        ) : null}
        {r.avatar_tipo_agendas ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Avatar / agendas</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.avatar_tipo_agendas}</dd>
          </div>
        ) : null}
        {r.insights_marketing ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Insights marketing</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.insights_marketing}</dd>
          </div>
        ) : null}
      </dl>
    )
  }
  if (r.kind === 'seguimiento') {
    return (
      <dl className="grid gap-2 text-[12px] text-[var(--text)] sm:grid-cols-2">
        <div>
          <dt className="font-bold text-[var(--text)]">Nombre del lead</dt>
          <dd className="text-[var(--text)]">{r.nombre_lead || '—'}</dd>
        </div>
        <div>
          <dt className="font-bold text-[var(--text)]">Monto</dt>
          <dd className="font-mono-num text-[var(--text)]">{formatCash(r.monto)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-bold text-[var(--text)]">Quién completó el reporte</dt>
          <dd className="text-[var(--text)]">{r.member_nombre}</dd>
        </div>
      </dl>
    )
  }
  if (r.kind === 'closer' && r.reporte_tipo === 'marketing') {
    return (
      <dl className="grid gap-2 text-[12px] text-[var(--text)] sm:grid-cols-2">
        <div>
          <dt className="font-bold text-[var(--text)]">Nombre lead</dt>
          <dd className="text-[var(--text)]">{r.nombre_lead || '—'}</dd>
        </div>
        <div>
          <dt className="font-bold text-[var(--text)]">Estado final</dt>
          <dd className="text-[var(--text)]">{r.estado_final_llamada || '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-bold text-[var(--text)]">Perfil</dt>
          <dd className="text-[var(--text)]">{r.perfil_lead || '—'}</dd>
        </div>
        {r.objecion_miedo ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Objeción / miedo</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.objecion_miedo}</dd>
          </div>
        ) : null}
        {r.dolores_llamada ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Dolores</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.dolores_llamada}</dd>
          </div>
        ) : null}
        {r.razon_compra_final ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Razón de compra</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.razon_compra_final}</dd>
          </div>
        ) : null}
        {r.insights_marketing_llamada ? (
          <div className="sm:col-span-2">
            <dt className="font-bold text-[var(--text)]">Insights marketing</dt>
            <dd className="whitespace-pre-wrap text-[var(--text)]">{r.insights_marketing_llamada}</dd>
          </div>
        ) : null}
      </dl>
    )
  }
  return (
    <dl className="grid gap-3 text-[12px] text-[var(--text)] sm:grid-cols-3">
      <div>
        <dt className="font-bold text-[var(--text)]">Agendadas</dt>
        <dd className="font-mono-num text-[var(--text)]">{r.llamadas_agendadas}</dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Calif. / Desc.</dt>
        <dd className="font-mono-num text-[var(--text)]">
          {r.calificados} / {r.descalificados}
        </dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Leads en seguimiento (de las llamadas de hoy)</dt>
        <dd className="font-mono-num text-[var(--text)]">{r.seguimiento}</dd>
      </div>
      <div className="sm:col-span-3">
        <dt className="mb-1 font-bold text-[var(--text)]">Shows</dt>
        <dd className="font-mono-num text-[var(--text)]">
          {Number(r.shows) || 0}
          <span className="ml-2 text-[11px] font-normal text-[var(--text3)]">
            Orgánico {Number(r.shows_organico) || 0} · Ads {Number(r.shows_ads) || 0}
          </span>
        </dd>
      </div>
      <div className="sm:col-span-3">
        <dt className="mb-1 font-bold text-[var(--text)]">Cierres</dt>
        <dd className="font-mono-num text-[var(--text)]">
          {Number(r.cierres) || 0}
          <span className="ml-2 text-[11px] font-normal text-[var(--text3)]">
            Orgánico {Number(r.cierres_organico) || 0} · Ads {Number(r.cierres_ads) || 0}
          </span>
        </dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Ingreso</dt>
        <dd className="font-mono-num text-[var(--text)]">{formatCash(Number(r.ingreso) || 0)}</dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Facturación</dt>
        <dd className="font-mono-num text-[var(--text)]">{formatCash(Number(r.facturacion) || 0)}</dd>
      </div>
      <div>
        <dt className="font-bold text-[var(--text)]">Reservas</dt>
        <dd className="font-mono-num text-[var(--text)]">
          {Number(r.reservas) || 0}
          {reservaCashUsd > 0 ? (
            <span className="ml-1 text-[11px] font-normal text-[var(--text3)]">
              ({formatCash((Number(r.reservas) || 0) * reservaCashUsd)})
            </span>
          ) : null}
        </dd>
      </div>
      {r.notas ? (
        <div className="sm:col-span-3">
          <dt className="font-bold text-[var(--text)]">Notas</dt>
          <dd className="whitespace-pre-wrap text-[var(--text)]">{r.notas}</dd>
        </div>
      ) : null}
    </dl>
  )
}

export default function TeamHistorialReportesPage() {
  const { ready, userId } = useAuthUser()
  const { timezone } = useCompanyConfig()
  const { toast } = useToast()
  const today = todayIsoInTimeZone(timezone)
  const [desde, setDesde] = useState(() => addCalendarDaysIso(today, -30))
  const [hasta, setHasta] = useState(today)
  const [roleFilter, setRoleFilter] = useState<ReporteFiltro>('todos')
  const [diaFiltro, setDiaFiltro] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState<ReportRow[]>([])
  const [downloading, setDownloading] = useState(false)
  const [pdfModalOpen, setPdfModalOpen] = useState(false)
  const [pdfMode, setPdfMode] = useState<'mes' | 'rango'>('mes')
  const [pdfMonth, setPdfMonth] = useState(() => currentMonthInTimeZone(timezone))
  const [pdfDesdeModal, setPdfDesdeModal] = useState('')
  const [pdfHastaModal, setPdfHastaModal] = useState('')
  const [pdfFiltro, setPdfFiltro] = useState<ReporteFiltro>('todos')
  const [deleteTarget, setDeleteTarget] = useState<ReportRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const fetchReports = useCallback(async () => {
    if (!ready || !userId) {
      setReports([])
      return
    }
    setLoading(true)
    try {
      const q = `desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`
      const res = await apiFetch(`/team/reports?${q}`)
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        setReports([])
        return
      }
      const data = (await res.json()) as { reports?: ReportRow[] }
      setReports(data.reports ?? [])
    } catch {
      toast('No se pudo cargar el historial.')
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [ready, userId, desde, hasta, toast])

  useEffect(() => {
    void fetchReports()
  }, [fetchReports])

  useEffect(() => {
    const refresh = () => {
      void fetchReports()
    }
    window.addEventListener('atv-team-reports-changed', refresh)
    return () => window.removeEventListener('atv-team-reports-changed', refresh)
  }, [fetchReports])

  const filteredReports = useMemo(() => {
    let rows = reports
    if (roleFilter === 'setter') rows = rows.filter((x) => x.kind === 'setter')
    else if (roleFilter === 'closer_marketing') {
      rows = rows.filter((x) => x.kind === 'closer' && x.reporte_tipo === 'marketing')
    } else if (roleFilter === 'closer_ventas') {
      rows = rows.filter((x) => x.kind === 'closer' && x.reporte_tipo !== 'marketing')
    } else if (roleFilter === 'seguimiento') {
      rows = rows.filter((x) => x.kind === 'seguimiento')
    }
    if (diaFiltro.trim()) {
      rows = rows.filter((x) => x.fecha === diaFiltro.trim())
    }
    return [...rows].sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1
      return b.id - a.id
    })
  }, [reports, roleFilter, diaFiltro])

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / REPORTES_PAGE_SIZE))

  const paginatedReports = useMemo(() => {
    const start = (page - 1) * REPORTES_PAGE_SIZE
    return filteredReports.slice(start, start + REPORTES_PAGE_SIZE)
  }, [filteredReports, page])

  useEffect(() => {
    setPage(1)
  }, [roleFilter, diaFiltro, desde, hasta])

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])

  const openPdfModal = useCallback(() => {
    setPdfMode('mes')
    const ym = hasta.length >= 7 ? hasta.slice(0, 7) : currentMonthInTimeZone(timezone)
    setPdfMonth(ym)
    setPdfDesdeModal(desde)
    setPdfHastaModal(hasta)
    setPdfFiltro(roleFilter)
    setPdfModalOpen(true)
  }, [desde, hasta, roleFilter, timezone])

  const runPdfDownload = useCallback(
    async (desdeStr: string, hastaStr: string) => {
      if (!userId) {
        toast('Iniciá sesión')
        return
      }
      if (!desdeStr || !hastaStr) {
        toast('Completá las fechas.')
        return
      }
      if (desdeStr > hastaStr) {
        toast('La fecha inicial no puede ser posterior a la final.')
        return
      }
      setDownloading(true)
      try {
        const q = `desde=${encodeURIComponent(desdeStr)}&hasta=${encodeURIComponent(hastaStr)}&filtro=${encodeURIComponent(pdfFiltro)}`
        const res = await apiFetch(`/team/reports/pdf?${q}`)
        if (!res.ok) {
          toast(errMessage(await res.json().catch(() => ({}))))
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `reportes_equipo_${formatIsoDateDdMmYyyy(desdeStr)}_${formatIsoDateDdMmYyyy(hastaStr)}.pdf`
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toast('PDF descargado')
        setPdfModalOpen(false)
      } catch {
        toast('No se pudo generar el PDF.')
      } finally {
        setDownloading(false)
      }
    },
    [userId, toast, pdfFiltro],
  )

  const confirmPdfDownload = () => {
    if (pdfMode === 'mes') {
      const r = ymToDesdeHasta(pdfMonth)
      if (!r) {
        toast('Elegí un mes válido.')
        return
      }
      void runPdfDownload(r.desde, r.hasta)
      return
    }
    void runPdfDownload(pdfDesdeModal, pdfHastaModal)
  }

  const handleDeleteReport = useCallback(async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const res = await apiFetch(`/team/reports/${deleteTarget.kind}/${deleteTarget.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast(errMessage(await res.json().catch(() => ({}))))
        return
      }
      toast('Reporte eliminado')
      setDeleteTarget(null)
      window.dispatchEvent(new Event('atv-team-reports-changed'))
      await fetchReports()
    } catch {
      toast('No se pudo eliminar el reporte.')
    } finally {
      setDeleteBusy(false)
    }
  }, [deleteTarget, fetchReports, toast])

  if (!ready) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando…</div>
  }

  if (!userId) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Iniciá sesión para ver el historial.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-lg font-bold tracking-tight">Historial de reportes</h2>
        <button
          type="button"
          disabled={downloading || loading}
          onClick={openPdfModal}
          className="shrink-0 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        >
          Descargar PDF
        </button>
      </div>

      <Modal
        open={pdfModalOpen}
        onClose={() => {
          if (!downloading) setPdfModalOpen(false)
        }}
        title="Descargar PDF"
        maxWidth="480px"
        compact
      >
        <div className="space-y-4 text-[13px] text-[var(--text)]">
          <p className="text-[12px] leading-snug text-[var(--text2)]">
            Elegí si querés un mes completo o un rango entre dos fechas.
          </p>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Reportes en el PDF</label>
            <select
              value={pdfFiltro}
              onChange={(e) => setPdfFiltro(e.target.value as ReporteFiltro)}
              disabled={downloading}
              className="w-full max-w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)] disabled:opacity-50"
            >
              <option value="todos">Todos</option>
              <option value="setter">Setter</option>
              <option value="closer_marketing">Closer marketing</option>
              <option value="closer_ventas">Closer ventas</option>
              <option value="seguimiento">Seguimiento</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="pdf-mode"
                checked={pdfMode === 'mes'}
                onChange={() => setPdfMode('mes')}
                className="accent-[var(--accent)]"
              />
              <span className="font-semibold">Por mes</span>
            </label>
            {pdfMode === 'mes' ? (
              <div className="ml-6 max-w-[min(100%,280px)] rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2.5">
                <div className="flex gap-2">
                  <select
                    aria-label="Mes"
                    value={pdfMonth.length >= 7 ? pdfMonth.slice(5, 7) : '01'}
                    onChange={(e) => {
                      const mm = e.target.value
                      const yy = pdfMonth.length >= 4 ? pdfMonth.slice(0, 4) : String(new Date().getFullYear())
                      setPdfMonth(`${yy}-${mm}`)
                    }}
                    className="min-w-0 flex-1 rounded-md border border-[var(--border2)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    {PDF_MES_OPCIONES.map(({ v, nombre }) => (
                      <option key={v} value={v}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Año"
                    value={pdfMonth.length >= 4 ? pdfMonth.slice(0, 4) : String(new Date().getFullYear())}
                    onChange={(e) => {
                      const yy = e.target.value
                      const mm = pdfMonth.length >= 7 ? pdfMonth.slice(5, 7) : '01'
                      setPdfMonth(`${yy}-${mm}`)
                    }}
                    className="w-[4.75rem] shrink-0 rounded-md border border-[var(--border2)] bg-[var(--bg)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  >
                    {pdfAniosOpciones().map((a) => (
                      <option key={a} value={String(a)}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 pt-1">
              <input
                type="radio"
                name="pdf-mode"
                checked={pdfMode === 'rango'}
                onChange={() => setPdfMode('rango')}
                className="accent-[var(--accent)]"
              />
              <span className="font-semibold">Entre fechas</span>
            </label>
            {pdfMode === 'rango' ? (
              <div className="ml-6 flex flex-wrap items-end gap-3">
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Desde</span>
                  <input
                    type="date"
                    value={pdfDesdeModal}
                    onChange={(e) => setPdfDesdeModal(e.target.value)}
                    className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Hasta</span>
                  <input
                    type="date"
                    value={pdfHastaModal}
                    onChange={(e) => setPdfHastaModal(e.target.value)}
                    className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={downloading}
              onClick={() => setPdfModalOpen(false)}
              className="rounded-lg border border-[var(--border2)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void confirmPdfDownload()}
              className="rounded-lg bg-[var(--auth-cta-bg)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)] transition-all hover:brightness-110 disabled:opacity-50"
            >
              {downloading ? 'Generando…' : 'Descargar'}
            </button>
          </div>
        </div>
      </Modal>

      {deleteTarget ? (
        <Modal
          open
          onClose={() => !deleteBusy && setDeleteTarget(null)}
          title="Eliminar reporte"
          maxWidth="420px"
          compact
        >
          <p className="text-[13px] leading-relaxed text-[var(--text2)]">
            ¿Eliminar{' '}
            <span className="font-medium text-[var(--text)]">{reportListTitle(deleteTarget)}</span>? No se puede
            deshacer.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)] transition-colors hover:border-[var(--text3)] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => void handleDeleteReport()}
              className="btn-primary rounded-lg px-4 py-2 text-[11px] font-semibold uppercase transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {deleteBusy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      ) : null}

      <div className="glass-card glass-card--performant flex flex-wrap items-end gap-4 p-4 sm:p-5">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Reportes de</label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as ReporteFiltro)}
            className="min-w-[200px] cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          >
            <option value="todos">Todos</option>
            <option value="setter">Setter</option>
            <option value="closer_marketing">Closer marketing</option>
            <option value="closer_ventas">Closer ventas</option>
            <option value="seguimiento">Seguimiento</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Día (opcional)</label>
          <input
            type="date"
            value={diaFiltro}
            onChange={(e) => setDiaFiltro(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text)]">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <button
          type="button"
          onClick={() => void fetchReports()}
          disabled={loading}
          className="rounded-lg bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)] transition-all hover:brightness-110 disabled:opacity-50"
        >
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
        {diaFiltro ? (
          <button
            type="button"
            onClick={() => setDiaFiltro('')}
            className="rounded-lg border border-[var(--border2)] px-3 py-2.5 text-[11px] font-semibold text-[var(--text)] hover:border-[var(--text3)]"
          >
            Quitar día
          </button>
        ) : null}
      </div>

      {loading && reports.length === 0 ? (
        <div className="text-[13px] text-[var(--text2)]">Cargando reportes…</div>
      ) : reports.length === 0 ? (
        <p className="text-[13px] text-[var(--text2)]">No hay reportes en este rango.</p>
      ) : filteredReports.length === 0 ? (
        <p className="text-[13px] text-[var(--text2)]">No hay reportes con estos filtros.</p>
      ) : (
        <>
          <div className="glass-card glass-card--performant divide-y divide-[var(--border2)] overflow-hidden rounded-lg border border-[var(--border)]">
            {paginatedReports.map((r) => (
              <details key={`${r.kind}-${r.id}`} className="group bg-[var(--bg2)]/30 open:bg-[var(--bg3)]/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--nav-hover)] marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1 select-none text-[11px] font-extrabold uppercase leading-snug tracking-wide text-[var(--text)]">
                    {reportListTitle(r)}
                  </span>
                  <button
                    type="button"
                    title="Eliminar reporte"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDeleteTarget(r)
                    }}
                    className="shrink-0 rounded px-2 py-1 text-[14px] text-[var(--text3)] transition-colors hover:bg-[var(--bg4)] hover:text-[var(--text)]"
                  >
                    ✕
                  </button>
                </summary>
                <div className="border-t border-[var(--border2)] px-4 pb-3 pt-2">
                  <ReportDetail r={r} />
                </div>
              </details>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-transparent pt-3">
            <p className="text-[12px] text-[var(--text3)]">
              Mostrando{' '}
              <span className="font-medium text-[var(--text2)]">
                {(page - 1) * REPORTES_PAGE_SIZE + 1}–{Math.min(page * REPORTES_PAGE_SIZE, filteredReports.length)}
              </span>{' '}
              de <span className="font-medium text-[var(--text2)]">{filteredReports.length}</span>
            </p>
            {totalPages > 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] transition-all hover:border-[var(--text3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="min-w-[8rem] text-center text-[12px] text-[var(--text3)]">
                  Página <span className="font-semibold text-[var(--text)]">{page}</span> de{' '}
                  <span className="font-semibold text-[var(--text)]">{totalPages}</span>
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-[var(--border2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] transition-all hover:border-[var(--text3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
