'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useMonthContext, useCompanyConfig } from '@/shared/components/app-providers'
import { useToast } from '@/shared/components/toast'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { formatCash } from '@/shared/lib/format-utils'
import { Line } from '@/shared/components/charts-lazy'
import { apiFetch, formatApiDetail } from '@/lib/api'
import { resolveMediaUrl } from '@/shared/lib/backend-public-url'
import { todayIsoInTimeZone } from '@/shared/lib/tenant-time'

type StorySlide = {
  id: number
  order_index: number
  image_url: string | null
  dolor: string | null
  angulo: string | null
  cta_text: string | null
  instagram_media_id: string | null
  views: number | null
  reach: number | null
  shares: number | null
  like_count: number | null
  replies: number | null
  navigation: number | null
  profile_visits: number | null
  synced_at: string | null
  published_at?: string | null
}

type StorySequence = {
  id: number
  sequence_date: string
  title: string | null
  dolor: string | null
  angulo: string | null
  cta: boolean
  cash_generado: number
  cash_manual?: number
  cash_leads?: number
  agendas?: number
  chats: number
  slides: StorySlide[]
  created_at: string
}

type StoriesMetrics = {
  chats_del_mes: number
  secuencias_con_cta: number
  secuencias_sin_cta: number
  stories_sincronizadas: number
}

type Secuencia = {
  id: number
  fecha: string
  slides: StorySlide[]
  totalReach: number
  /** Promedio de views (Graph API) entre los slides de la secuencia. */
  avgViews: number
  totalReplies: number
  dolor?: string
  angulo?: string
  cta: boolean
  chats: number
  cash_generado: number
  cash_manual: number
  /** Suma de pagos de leads con esta historia como punto de agenda. */
  cash_leads: number
  /** Leads con punto de agenda = historia (viene del backend). */
  agendas: number
  notes: string
  secuenciaDesc: string
  hasSync: boolean
}

type SyncStatus = {
  last_sync: string | null
  next_sync: string | null
  token_saved_at?: string | null
  token_expires_at?: string | null
}

const UNDO_DURATION = 6000
const getImageUrl = (url: string | null | undefined) => resolveMediaUrl(url)
const toNumber = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Fecha de secuencia en pantalla: DD-MM-AAAA (API envía ISO YYYY-MM-DD o con hora). */
function formatSequenceDateDisplay(iso: string): string {
  const dayPart = String(iso || '').trim().slice(0, 10)
  const m = dayPart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(iso || '').trim() || '—'
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Alcance único por slide (Graph API `reach`); métrica principal de historias — no views ni navigation. */
const slideReachCount = (s: Pick<StorySlide, 'reach'>) => toNumber(s.reach)
/** Reproducciones/impresiones por slide (Graph API `views`). */
const slideViewsCount = (s: Pick<StorySlide, 'views'>) => toNumber(s.views)

/** KPIs de Instagram (insights) vs embudo (manual / leads). No mezclar un fallo de Graph con Cash/Chats. */
function SequenceIgVsFunnelKpis({
  totalReach,
  avgViews,
  cash,
  chats,
  agendas,
}: {
  totalReach: number
  avgViews: number
  cash: number
  chats: number
  agendas: number
}) {
  const cpc = chats > 0 ? cash / chats : 0
  return (
    <>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Instagram</span>
      <span className="font-mono-num text-[12px] text-[var(--text2)]">ALCANCE: {totalReach.toLocaleString('es-AR')}</span>
      <span className="font-mono-num text-[12px] text-[var(--text2)]">VIS. PROM.: {avgViews.toLocaleString('es-AR')}</span>
      <span className="hidden h-3 w-px bg-[var(--border2)] sm:inline-block" aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Embudo</span>
      <span className="font-mono-num text-[12px] text-[var(--text2)]">CASH: {formatCash(cash)}</span>
      <span className="font-mono-num text-[12px] text-[var(--text2)]">CHATS: {chats}</span>
      <span className="font-mono-num text-[12px] text-[var(--text2)]">AGENDAS: {agendas}</span>
      <span className="font-mono-num text-[12px] text-[var(--text2)]">CPC: {formatCash(cpc)}</span>
    </>
  )
}

/** Misma story IG no se muestra dos veces (p. ej. manual + sync o doble sync). */
function dedupeSlidesByInstagramId(slides: StorySlide[]): StorySlide[] {
  const sorted = [...slides].sort((a, b) => a.order_index - b.order_index || a.id - b.id)
  const seen = new Set<string>()
  const out: StorySlide[] = []
  for (const s of sorted) {
    const mid = String(s.instagram_media_id ?? '').trim()
    if (mid) {
      if (seen.has(mid)) continue
      seen.add(mid)
    }
    out.push(s)
  }
  return out
}

export default function HistoriasPage() {
  const { month, options, setMonth } = useMonthContext()
  const { timezone } = useCompanyConfig()
  const { toast } = useToast()
  const { ready, userId } = useAuthUser()
  const [sequences, setSequences] = useState<StorySequence[]>([])
  const [metrics, setMetrics] = useState<StoriesMetrics>({
    chats_del_mes: 0,
    secuencias_con_cta: 0,
    secuencias_sin_cta: 0,
    stories_sincronizadas: 0,
  })
  const [loading, setLoading] = useState(true)
  const [masterLists, setMasterLists] = useState<{ dolores: string[]; angulos: string[] }>({ dolores: [], angulos: [] })
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [countdown, setCountdown] = useState<string>('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [detailSecuencia, setDetailSecuencia] = useState<Secuencia | null>(null)
  const [monthMode, setMonthMode] = useState<'current' | 'comparison'>('current')
  const [form, setForm] = useState<Record<string, string | boolean>>({ chats: '0', cash: '0', hasCta: false })
  const [formSlides, setFormSlides] = useState<string[]>([])
  const [formSlideThumbs, setFormSlideThumbs] = useState<string[]>([])
  const [formSelected, setFormSelected] = useState<Set<number>>(new Set())
  const [analyzing, setAnalyzing] = useState(false)
  const [showManualForm, setShowManualForm] = useState(false)
  const authHeaders = () => {
    const token = typeof window !== 'undefined'
      ? sessionStorage.getItem('access_token') || sessionStorage.getItem('auth_token') || sessionStorage.getItem('evoluciona_token')
      : null
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (userId) headers['X-User-Id'] = userId
    return headers
  }
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const comparisonMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

  // Undo
  const [undoAction, setUndoAction] = useState<{ label: string; execute: () => Promise<void> } | null>(null)
  const [undoProgress, setUndoProgress] = useState(100)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const showUndo = (label: string, fn: () => Promise<void>) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    setUndoAction({ label, execute: fn }); setUndoProgress(100)
    const start = Date.now()
    undoIntervalRef.current = setInterval(() => { const r = Math.max(0, 100 - ((Date.now() - start) / UNDO_DURATION) * 100); setUndoProgress(r); if (r <= 0) { clearInterval(undoIntervalRef.current!); setUndoAction(null) } }, 50)
    undoTimerRef.current = setTimeout(() => { if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); setUndoAction(null) }, UNDO_DURATION)
  }
  const handleUndo = async () => { if (!undoAction) return; if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current); await undoAction.execute(); setUndoAction(null); toast('Revertido'); fetchData() }

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const [seqRes, metricsRes] = await Promise.all([
        apiFetch(`/stories/sequences?month=${encodeURIComponent(month)}`, {
          headers: authHeaders(),
        }),
        apiFetch(`/stories/metrics?month=${encodeURIComponent(month)}`, {
          headers: authHeaders(),
        }),
      ])
      const seqData = await seqRes.json().catch(() => [])
      const metricsData = await metricsRes.json().catch(() => ({}))
      if (seqRes.ok && Array.isArray(seqData)) {
        setSequences(seqData as StorySequence[])
      } else {
        setSequences([])
      }
      if (metricsRes.ok) {
        setMetrics({
          chats_del_mes: Number(metricsData.chats_del_mes || 0),
          secuencias_con_cta: Number(metricsData.secuencias_con_cta || 0),
          secuencias_sin_cta: Number(metricsData.secuencias_sin_cta || 0),
          stories_sincronizadas: Number(metricsData.stories_sincronizadas || 0),
        })
      }
    } finally {
      setLoading(false)
    }
  }, [month, ready, userId])

  const handleDeleteSlide = useCallback(
    async (slideId: number, options?: { closeDetail?: boolean }) => {
      if (!ready || !userId) return
      if (!confirm('¿Eliminar esta historia de la secuencia?')) return
      const res = await apiFetch(`/stories/slides/${slideId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof raw === 'object' && raw && 'detail' in raw
            ? String((raw as { detail: unknown }).detail)
            : res.statusText
        toast(`No se pudo eliminar: ${detail}`)
        return
      }
      toast('Historia eliminada')
      if (options?.closeDetail) setDetailSecuencia(null)
      await fetchData()
    },
    [ready, userId, fetchData, toast],
  )

  const fetchMasterLists = useCallback(async () => {
    if (!ready || !userId) return
    try {
      const res = await apiFetch('/master-lists', { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMasterLists({
          dolores: Array.isArray(data.dolores) ? data.dolores : [],
          angulos: Array.isArray(data.angulos) ? data.angulos : [],
        })
      }
    } catch {
      setMasterLists({ dolores: [], angulos: [] })
    }
  }, [ready, userId])

  const fetchSyncStatus = useCallback(async () => {
    if (!ready) return
    const res = await apiFetch('/stories/sync-status', { headers: authHeaders() })
    const data = await res.json().catch(() => ({ last_sync: null, next_sync: null, token_saved_at: null, token_expires_at: null }))
    if (res.ok) {
      setSyncStatus({
        last_sync: data.last_sync || null,
        next_sync: data.next_sync || null,
        token_saved_at: data.token_saved_at || null,
        token_expires_at: data.token_expires_at || null,
      })
    }
  }, [ready, userId])

  useEffect(() => { fetchData(); fetchSyncStatus(); fetchMasterLists() }, [fetchData, fetchSyncStatus, fetchMasterLists])

  useEffect(() => {
    const refreshLists = () => { fetchMasterLists() }
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchMasterLists()
    }
    window.addEventListener('master-lists-updated', refreshLists)
    window.addEventListener('focus', refreshLists)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('master-lists-updated', refreshLists)
      window.removeEventListener('focus', refreshLists)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchMasterLists])
  useEffect(() => {
    setMonth(monthMode === 'current' ? currentMonth : comparisonMonth)
  }, [monthMode, setMonth, currentMonth, comparisonMonth])

  // Auto-classify unclassified secuencias on page load (once per session)
  const [autoClassified, setAutoClassified] = useState(false)
  useEffect(() => {
    if (!ready || autoClassified || loading) return
    setAutoClassified(true)
    fetch('/api/classify-all-secuencias', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.classified > 0) { toast(`${d.classified} secuencias clasificadas con IA`); fetchData() } })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loading, autoClassified])

  // Group stories by date -> secuencias (includes manual secuencias without Metricool stories)
  const secuencias: Secuencia[] = useMemo(() => {
    return sequences.map((seq) => {
      const slides = dedupeSlidesByInstagramId(seq.slides)
      const dolor = seq.dolor || slides.find((s) => s.dolor)?.dolor || ''
      return {
        id: seq.id,
        fecha: seq.sequence_date,
        slides,
        totalReach: slides.reduce((acc, s) => acc + slideReachCount(s), 0),
        avgViews: slides.length > 0
          ? Math.round(slides.reduce((acc, s) => acc + slideViewsCount(s), 0) / slides.length)
          : 0,
        totalReplies: slides.reduce((acc, s) => acc + toNumber(s.replies), 0),
        dolor,
        angulo: seq.angulo || '',
        cta: Boolean(seq.cta),
        chats: toNumber(seq.chats),
        cash_manual: toNumber(seq.cash_manual ?? seq.cash_generado),
        cash_generado: toNumber(seq.cash_generado),
        cash_leads: toNumber(seq.cash_leads),
        agendas: toNumber(seq.agendas),
        notes: seq.title || '',
        secuenciaDesc: (seq.title || '').trim(),
        hasSync: slides.some((s) => Boolean(s.instagram_media_id)),
      }
    })
  }, [sequences])

  // Sync Instagram
  const handleSync = useCallback(async () => {
    setSyncing(true)
    setSyncMessage('Sincronizando...')
    try {
      const res = await apiFetch('/stories/sync', {
        method: 'POST',
        headers: authHeaders(),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = formatApiDetail(
          (result as { detail?: unknown }).detail,
          res.status === 401
            ? 'Token de Instagram inválido o expirado. Actualizalo en Conexiones.'
            : 'No se pudo sincronizar Instagram',
        )
        setSyncMessage(`Error: ${msg}`)
        toast(msg)
      } else {
        const okText = `Sincronizadas: ${Number(result.synced || 0)} | Sin match: ${Number(result.not_matched || 0)}`
        const warning = typeof (result as { warning?: string }).warning === 'string'
          ? (result as { warning: string }).warning
          : ''
        setSyncMessage(warning ? `${okText} — ${warning}` : okText)
        if (warning) {
          toast(warning)
        } else {
          toast(okText)
        }
        await fetchData()
        await fetchSyncStatus()
      }
    } catch (e) {
      setSyncMessage(`Error: ${(e as Error).message}`)
    }
    setSyncing(false)
  }, [fetchData, fetchSyncStatus, toast])

  useEffect(() => {
    const onSettingsUpdated = () => {
      void fetchSyncStatus()
      void fetchData()
    }
    window.addEventListener('stories-sync-settings-updated', onSettingsUpdated)
    return () => window.removeEventListener('stories-sync-settings-updated', onSettingsUpdated)
  }, [fetchSyncStatus, fetchData])

  useEffect(() => {
    if (!syncStatus?.next_sync) {
      setCountdown('')
      return
    }
    let intervalId: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      const now = new Date()
      const next = new Date(syncStatus.next_sync as string)
      const diff = next.getTime() - now.getTime()
      if (diff <= 0) {
        setCountdown('Sincronizando...')
        if (intervalId) clearInterval(intervalId)
        void handleSync().then(() => fetchSyncStatus())
        return
      }
      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }
    tick()
    intervalId = setInterval(tick, 1000)
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [syncStatus?.next_sync, handleSync, fetchSyncStatus])

  // Auto-classify all unclassified secuencias via server-side Vision API
  const autoClassify = async () => {
    try {
      await fetch('/api/classify-all-secuencias', { method: 'POST' })
    } catch { /* skip */ }
    fetchData()
  }

  // Crop stories from screenshot using AI grid info
  const cropStoriesFromImage = (imgSrc: string, gridInfo: { headerHeightPercent: number; rows: number; cols: number }, positions: number[]): Promise<string[]> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const cols = gridInfo.cols || 3
        const headerOffset = Math.floor(img.height * (gridInfo.headerHeightPercent || 15) / 100)
        const gridHeight = img.height - headerOffset
        const rows = gridInfo.rows || Math.ceil(gridHeight / (img.width / cols * 16 / 9))
        const cellW = Math.floor(img.width / cols)
        const cellH = Math.floor(gridHeight / rows)
        const padX = Math.floor(cellW * 0.02)
        const padY = Math.floor(cellH * 0.02)
        const thumbs: string[] = []
        for (const pos of positions) {
          const idx = pos - 1
          const row = Math.floor(idx / cols)
          const col = idx % cols
          const x = col * cellW + padX
          const y = headerOffset + row * cellH + padY
          const w = cellW - padX * 2
          const h = Math.min(cellH - padY * 2, img.height - y)
          if (y >= img.height || w <= 0 || h <= 0) continue
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
          thumbs.push(canvas.toDataURL('image/jpeg', 0.7))
        }
        resolve(thumbs)
      }
      img.src = imgSrc
    })
  }

  // Analyze screenshot
  const handleScreenshot = async (file: File) => {
    setAnalyzing(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve) => { reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file) })
      const base64 = dataUrl.split(',')[1]
      const res = await fetch('/api/analyze-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64, mediaType: file.type || 'image/jpeg' }) })
      const data = await res.json()
      if (data.success) {
        const seqPositions: number[] = data.sequencePositions || []
        const allDescs: string[] = data.allSlides || data.slides || []
        const total = data.totalStoriesInGrid || allDescs.length
        setForm(prev => ({ ...prev, dolor: data.dolor || '', fecha: prev.fecha || todayIsoInTimeZone(timezone) }))
        if (Array.isArray(data.angulos) && data.angulos[0]) {
          setForm((prev) => ({ ...prev, angulo: String(data.angulos[0]) }))
        }
        setFormSlides(allDescs)
        setFormSelected(new Set(seqPositions))
        const gridInfo = data.gridInfo || { headerHeightPercent: 15, rows: 3, cols: 3 }
        const allPositions = Array.from({ length: total }, (_, i) => i + 1)
        const thumbs = await cropStoriesFromImage(dataUrl, gridInfo, allPositions)
        setFormSlideThumbs(thumbs)
        toast(`IA detecto ${seqPositions.length} de ${total} stories`)
        fetchData()
      } else { toast(`Error IA: ${data.error}`) }
    } catch (e) { toast(`Error: ${(e as Error).message}`) }
    setAnalyzing(false)
  }

  // Save new secuencia (manual)
  const saveNewSecuencia = async () => {
    if (!form.fecha) { toast('Pone la fecha'); return }
    const selectedSlides = formSlides
      .map((desc, idx) => ({ desc, idx }))
      .filter((x) => formSelected.has(x.idx + 1))
      .filter((x) => x.desc.trim().length > 0)
    if (selectedSlides.length === 0) { toast('Selecciona al menos una story'); return }
    const titulo = String(form.secuenciaDesc || '') || `Secuencia ${formatSequenceDateDisplay(String(form.fecha || ''))}`
    const selectedThumbs = formSlideThumbs.filter((_, i) => formSelected.has(i + 1))
    const res = await apiFetch('/stories/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        sequence_date: form.fecha,
        title: titulo || null,
        dolor: String(form.dolor || '') || null,
        angulo: String(form.angulo || '') || null,
        cta: form.hasCta === true,
        chats: Number(form.chats) || 0,
        slides: selectedSlides.map((s, i) => ({
          order_index: i + 1,
          image_url: selectedThumbs[i] || null,
        })),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast(`Error al guardar: ${body.detail || 'No se pudo guardar'}`); return }
    toast('Secuencia agregada')
    setForm({ chats: '0', cash: '0', hasCta: false }); setFormSlides([]); setFormSlideThumbs([]); setFormSelected(new Set()); setShowManualForm(false)
    await fetchData()
  }

  const patchSecuencia = async (
    id: number,
    partial: { dolor?: string; angulos?: string; cta?: boolean; cash_manual?: number; chats?: number },
  ) => {
    const res = await apiFetch(`/stories/sequences/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(partial),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(String((body as { detail?: unknown }).detail || 'No se pudo actualizar'))
    }
    const updated = body as StorySequence
    setSequences((rows) => rows.map((r) => (r.id === id ? { ...r, ...updated } : r)))
    const metricsRes = await apiFetch(`/stories/metrics?month=${encodeURIComponent(month)}`, { headers: authHeaders() })
    const metricsData = await metricsRes.json().catch(() => ({}))
    if (metricsRes.ok) {
      setMetrics({
        chats_del_mes: Number(metricsData.chats_del_mes || 0),
        secuencias_con_cta: Number(metricsData.secuencias_con_cta || 0),
        secuencias_sin_cta: Number(metricsData.secuencias_sin_cta || 0),
        stories_sincronizadas: Number(metricsData.stories_sincronizadas || 0),
      })
    }
    return updated
  }

  // Save secuencia metadata (inline edit)
  const saveSecuencia = async (sec: Secuencia, overrides?: Partial<{
    dolor: string
    angulo: string
    cta: boolean
    cash_manual: number
    chats: number
  }>) => {
    const dolor = String(overrides?.dolor ?? form.dolor ?? sec.dolor ?? '')
    const angulo = String(overrides?.angulo ?? form.angulo ?? sec.angulo ?? '')
    const hasCta = overrides?.cta !== undefined
      ? overrides.cta
      : typeof form.hasCta === 'boolean'
        ? form.hasCta
        : sec.cta
    const cashManual =
      overrides?.cash_manual ?? (Number(form.cash) || sec.cash_manual || 0)
    const chats = overrides?.chats ?? (Number(form.chats) || sec.chats || 0)
    const res = await apiFetch(`/stories/sequences/${sec.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        sequence_date: sec.fecha,
        title: form.secuenciaDesc || sec.notes || null,
        dolor: dolor || null,
        angulo: angulo || null,
        cta: Boolean(hasCta),
        cash_manual: cashManual,
        chats,
        slides: sec.slides.map((s, i) => ({
          order_index: i + 1,
          image_url: s.image_url || null,
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast(`Error al guardar: ${body.detail || 'No se pudo actualizar'}`)
      return
    }
    toast('Secuencia guardada')
    setExpanded(null); setForm({ chats: '0', cash: '0', hasCta: false })
    await fetchData()
  }

  const startEdit = (sec: Secuencia) => {
    setExpanded(sec.id)
    setForm({
      dolor: sec.dolor || '',
      angulo: sec.angulo || '',
      hasCta: sec.cta,
      chats: String(sec.chats),
      cash: String(sec.cash_manual),
      notes: sec.notes,
      secuenciaDesc: sec.secuenciaDesc,
    })
  }

  const totalChats = metrics.chats_del_mes
  const conCTA = metrics.secuencias_con_cta
  const sinCTA = metrics.secuencias_sin_cta
  const tokenExpiresAt = syncStatus?.token_expires_at ? new Date(syncStatus.token_expires_at) : null
  const tokenDaysLeft = tokenExpiresAt
    ? Math.max(0, Math.floor((tokenExpiresAt.getTime() - Date.now()) / 86400000))
    : null
  const tokenStatusColor =
    tokenDaysLeft === null
      ? 'text-[var(--text3)]'
      : tokenDaysLeft < 5
        ? 'text-[var(--amber)]'
        : tokenDaysLeft <= 10
          ? 'text-[var(--amber)]'
          : 'text-[var(--green)]'

  if (!ready || loading) return <div className="py-12 text-center text-[var(--text3)]">Cargando...</div>

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Historias</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setMonthMode('current')}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'current' ? 'bg-[var(--auth-cta-bg)] text-[var(--auth-cta-text)]' : 'border border-[var(--border2)] text-[var(--text2)]'}`}
          >
            MES ACTUAL
          </button>
          <button
            onClick={() => setMonthMode('comparison')}
            className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase ${monthMode === 'comparison' ? 'bg-[var(--auth-cta-bg)] text-[var(--auth-cta-text)]' : 'border border-[var(--border2)] text-[var(--text2)]'}`}
          >
            SELECCIONAR MES Y AÑO
          </button>
        </div>
      </div>

      {/* Stats row — 4 cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Chats del mes</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{totalChats}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Secuencias con CTA</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{conCTA}</div>
        </div>
        <div className="glass-card p-5 border-[var(--accent)]">
          <div className="text-[10px] text-[var(--accent)] uppercase tracking-wider">Secuencias sin CTA</div>
          <div className="font-mono-num mt-1 text-3xl font-bold text-[var(--accent)]">{sinCTA}</div>
        </div>
        <div className="glass-card p-5">
          <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Stories sincronizadas</div>
          <div className="font-mono-num mt-1 text-3xl font-bold">{metrics.stories_sincronizadas}</div>
        </div>
      </div>

      {/* Sync + manual add */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={handleSync} disabled={syncing} className="rounded-lg bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)] hover:opacity-90 disabled:opacity-30">
          {syncing ? 'Sincronizando...' : 'SINCRONIZAR INSTAGRAM'}
        </button>
        {!showManualForm && (
          <button onClick={() => setShowManualForm(true)} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
            + Agregar secuencia manualmente
          </button>
        )}
      </div>
      {syncMessage && <div className={`mb-4 text-[12px] ${syncMessage.startsWith('Error') ? 'text-[var(--text2)]' : 'text-[var(--text3)]'}`}>{syncMessage}</div>}
      {syncStatus && (
        <div className="mb-4 text-sm text-zinc-400">
          <div className="flex items-center gap-4">
            {syncStatus.last_sync && (
              <span>
                Último sync: {new Date(syncStatus.last_sync).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </span>
            )}
            {countdown && (
              <span className="text-zinc-300">
                Próximo en: <span className="font-mono text-white">{countdown}</span>
              </span>
            )}
          </div>
          <div className={`mt-1 flex items-center gap-2 ${tokenStatusColor}`}>
            {tokenDaysLeft !== null && tokenDaysLeft <= 10 && <span aria-hidden="true">⚠️</span>}
            <span>
              Token Instagram:{' '}
              {tokenDaysLeft !== null ? `${tokenDaysLeft} días restantes` : 'fecha de vencimiento desconocida'}
            </span>
          </div>
        </div>
      )}

      {/* Manual secuencia form (overlay section) */}
      {showManualForm && (
        <div className="glass-card p-6 mb-6 border-[var(--accent)]">
          <div className="text-[11px] font-medium uppercase tracking-widest text-[var(--text3)] mb-4">Nueva secuencia de historias</div>
          {/* Screenshot upload */}
          <div className="mb-4 glass-card p-5 relative accent-top">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--accent)] mb-3">Subir screenshot de historias (la IA analiza automaticamente)</div>
            <label className={`block min-h-[80px] rounded-lg border-2 border-dashed ${analyzing ? 'border-[var(--accent)]' : 'border-[var(--border2)]'} bg-[var(--bg3)] flex items-center justify-center cursor-pointer hover:border-[var(--accent)] transition-all`}>
              <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleScreenshot(e.target.files[0]) }} />
              <div className="text-center p-4">
                {analyzing ? <div className="text-[var(--accent)] text-[13px]">Analizando con IA...</div>
                  : formSlides.length > 0 ? <div className="text-[var(--green)] text-[13px]">{formSlides.length} slides detectados — subi otra imagen para reanalizar</div>
                  : <><div className="text-[13px] text-[var(--text3)]">Subi o arrastra el screenshot de tus historias</div><div className="text-[10px] text-[var(--text3)] mt-1">.JPG, .PNG</div></>}
              </div>
            </label>
          </div>
          {/* Slide thumbnails — click to select/deselect */}
          {formSlides.length > 0 && (
            <div className="mb-4">
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
                Click para seleccionar/deseleccionar stories ({formSelected.size} de {formSlides.length})
              </label>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {formSlides.map((_, i) => {
                  const pos = i + 1
                  const isSelected = formSelected.has(pos)
                  return (
                    <button key={i} type="button" onClick={() => setFormSelected(prev => { const next = new Set(prev); if (next.has(pos)) next.delete(pos); else next.add(pos); return next })}
                      className={`flex-shrink-0 w-20 rounded-lg overflow-hidden transition-all cursor-pointer ${isSelected ? 'border-2 border-[var(--accent)] ring-2 ring-[var(--accent)] ring-opacity-30' : 'border border-[var(--border)] opacity-40 hover:opacity-70'}`}>
                      {formSlideThumbs[i] ? <img src={formSlideThumbs[i]} alt={`Slide ${pos}`} className="w-full h-36 object-cover" />
                        : <div className="w-full h-36 bg-[var(--bg4)] flex items-center justify-center text-[var(--text3)] text-lg font-bold">{pos}</div>}
                      <div className={`px-2 py-1.5 text-center ${isSelected ? 'bg-[var(--auth-cta-bg)]' : 'bg-[var(--bg3)]'}`}>
                        <div className={`text-[9px] font-semibold ${isSelected ? 'text-[var(--auth-cta-text)]' : 'text-[var(--text2)]'}`}>{pos}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* Form fields */}
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Dolor</label>
              <select
                value={String(form.dolor || '')}
                onChange={(e) => setForm((p) => ({ ...p, dolor: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer"
              >
                <option value="">Seleccionar...</option>
                {masterLists.dolores.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Angulos</label>
              <select
                value={String(form.angulo || '')}
                onChange={(e) => setForm((p) => ({ ...p, angulo: e.target.value }))}
                className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer"
              >
                <option value="">Seleccionar...</option>
                {masterLists.angulos.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Fecha</label>
              <input type="date" value={String(form.fecha || '')} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">¿Tiene CTA?</label>
              <div className="flex flex-wrap gap-2">
                {([true, false] as const).map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, hasCta: value }))}
                    className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase transition-colors ${
                      form.hasCta === value
                        ? 'bg-[var(--auth-cta-bg)] text-[var(--auth-cta-text)]'
                        : 'border border-[var(--border2)] text-[var(--text2)]'
                    }`}
                  >
                    {value ? 'Sí' : 'No'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Chats</label>
              <input type="number" value={String(form.chats || '0')} onChange={e => setForm(p => ({ ...p, chats: e.target.value }))} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveNewSecuencia} className="rounded-lg bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)] hover:opacity-90">+ Agregar Secuencia</button>
            <button onClick={() => { setShowManualForm(false); setForm({ chats: '0', cash: '0', hasCta: false }); setFormSlides([]); setFormSlideThumbs([]); setFormSelected(new Set()) }} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cancelar</button>
          </div>
        </div>
      )}

      {/* Secuencias list */}
      {secuencias.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--text3)]">No hay historias este mes. Apreta &quot;SINCRONIZAR INSTAGRAM&quot; para importar.</div>
      ) : (
        <div className="space-y-4">
          {secuencias.map(sec => {
            const isExpanded = expanded === sec.id
            const hasSlides = sec.slides.length > 0
            const slideCount = hasSlides ? sec.slides.length : 0

            return (
              <div key={sec.fecha} className={`glass-card p-5 transition-all ${isExpanded ? 'border-[var(--accent)]' : 'cursor-pointer hover:border-[var(--border2)]'}`}
                onClick={() => { if (!isExpanded) startEdit(sec) }}>
                {/* Header with date + metrics */}
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="text-[14px] font-semibold">{formatSequenceDateDisplay(sec.fecha)}</div>
                    <SequenceIgVsFunnelKpis
                      totalReach={sec.totalReach}
                      avgViews={sec.avgViews}
                      cash={sec.cash_generado}
                      chats={sec.chats}
                      agendas={sec.agendas}
                    />
                    {sec.hasSync
                      ? <span className="rounded bg-[rgba(34,197,94,0.15)] px-2 py-1 text-[10px] text-[var(--green)] font-medium">SINCRONIZADO</span>
                      : <span className="rounded bg-[rgba(161,161,170,0.15)] px-2 py-1 text-[10px] text-[var(--text3)] font-medium">Sin sincronizar</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isExpanded && (
                      <button onClick={async (e) => {
                        e.stopPropagation()
                        if (!confirm(`Eliminar secuencia del ${formatSequenceDateDisplay(sec.fecha)}?`)) return
                        await apiFetch(`/stories/sequences/${sec.id}`, {
                          method: 'DELETE',
                          headers: authHeaders(),
                        })
                        toast('Secuencia eliminada')
                        if (expanded === sec.id) setExpanded(null)
                        fetchData()
                      }} className="text-[var(--text3)] hover:text-[var(--text)] text-[13px]" title="Eliminar">✕</button>
                    )}
                    {isExpanded && (
                      <button onClick={(e) => { e.stopPropagation(); setExpanded(null); setForm({ chats: '0', cash: '0', hasCta: false }) }} className="text-[var(--text3)] hover:text-[var(--text)] text-[13px]" title="Cerrar">✕</button>
                    )}
                  </div>
                </div>

                {/* Slide strip — only visible when collapsed */}
                {!isExpanded && hasSlides ? (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                    {sec.slides.map((slide, i) => {
                      const thumb = getImageUrl(slide.image_url)
                      return (
                        <div key={slide.id} className="flex-shrink-0 w-[120px] h-[200px] rounded-lg bg-[var(--bg4)] border border-[var(--border)] overflow-hidden relative cursor-pointer" onClick={(e) => { e.stopPropagation(); setDetailSecuencia(sec) }}>
                          <button
                            type="button"
                            title="Eliminar esta historia"
                            className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-[14px] font-bold text-white hover:bg-[var(--bg4)]"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDeleteSlide(slide.id)
                            }}
                          >
                            ×
                          </button>
                          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover rounded-lg" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)] text-[10px]">{i + 1}</div>}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[8px] text-white py-0.5">{i + 1}/{slideCount}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : !isExpanded ? (
                  <div className="mb-3 text-[11px] text-[var(--text3)] italic">Secuencia manual — sin preview</div>
                ) : null}

                {/* Classification tags (collapsed view) */}
                {!isExpanded && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDetailSecuencia(sec) }} className="rounded bg-[var(--accent-faint)] px-2.5 py-1 text-[10px] text-[var(--text2)] font-medium">{sec.dolor || 'Sin dolor'}</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDetailSecuencia(sec) }} className="rounded bg-[rgba(245,158,11,0.15)] px-2.5 py-1 text-[10px] text-[var(--amber)] font-medium">{sec.angulo || 'Sin ángulo'}</button>
                    <span
                      className={`rounded px-2.5 py-1 text-[10px] font-medium ${
                        sec.cta
                          ? 'bg-[rgba(74,222,128,0.15)] text-[var(--green)]'
                          : 'bg-[var(--bg4)] text-[var(--text3)]'
                      }`}
                    >
                      {sec.cta ? 'Con CTA' : 'Sin CTA'}
                    </span>
                  </div>
                )}

                {/* Expanded: full detail view */}
                {isExpanded && (() => {
                  // Build slide data from Metricool stories OR base64 thumbnails
                  const slideMetrics = sec.slides.map((s, i) => ({
                    slideId: s.id,
                    idx: i + 1,
                    reach: slideReachCount(s),
                    likes: Number(s.replies || 0),
                    shares: toNumber(s.shares),
                    thumb: getImageUrl(s.image_url) || null,
                  }))
                  const maxReach = Math.max(...slideMetrics.map(s => s.reach), 1)
                  const retentionData = slideMetrics.map(s => maxReach > 0 ? (s.reach / maxReach) * 100 : 100)
                  const hasMetrics = slideMetrics.some(s => s.reach > 0)

                  return (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]" onClick={e => e.stopPropagation()}>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash generado</div>
                        <div className="font-mono-num text-2xl font-bold text-[var(--green)]">
                          {formatCash(sec.cash_generado)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
                        <input type="number" value={form.chats || '0'} onChange={e => setForm(p => ({ ...p, chats: e.target.value }))}
                          className="w-full bg-transparent text-center font-mono-num text-2xl font-bold text-[var(--text)] outline-none" />
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash por Chat</div>
                        <div className="font-mono-num text-2xl font-bold">
                          {sec.chats > 0 ? formatCash(sec.cash_generado / sec.chats) : formatCash(0)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Agendas</div>
                        <div className="font-mono-num text-2xl font-bold text-[var(--text)]">{sec.agendas}</div>
                      </div>
                    </div>

                    {/* Stories with thumbnails + dropoff between them */}
                    {slideMetrics.length > 0 && (
                      <div className="mb-5">
                        <div className="flex items-end overflow-x-auto pb-2">
                          {slideMetrics.map((s, i) => {
                            const dropoff = i > 0 && slideMetrics[i - 1].reach > 0
                              ? Math.round(((slideMetrics[i - 1].reach - s.reach) / slideMetrics[i - 1].reach) * 100)
                              : 0
                            return (
                              <div key={s.slideId} className="flex items-end flex-1 min-w-0">
                                {/* Dropoff between stories */}
                                {i > 0 && hasMetrics && (
                                  <div className="flex flex-col items-center justify-center w-6 flex-shrink-0 mb-14">
                                    <div className={`text-[9px] font-mono-num font-bold ${dropoff > 10 ? 'text-[var(--amber)]' : 'text-[var(--text3)]'}`}>
                                      {dropoff > 0 ? `-${dropoff}%` : '0%'}
                                    </div>
                                  </div>
                                )}
                                {!hasMetrics && i > 0 && (
                                  <div className="w-2 flex-shrink-0" />
                                )}
                                {/* Story card — fixed width to avoid giant single-slide cards */}
                                <div className="w-[120px] flex-shrink-0 text-center">
                                  <div className="relative aspect-[9/16] rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg4)] mb-1.5">
                                    <button
                                      type="button"
                                      title="Eliminar esta historia"
                                      className="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded bg-black/55 text-[11px] font-bold text-white hover:bg-[var(--bg4)]"
                                      onClick={() => void handleDeleteSlide(s.slideId)}
                                    >
                                      ×
                                    </button>
                                    {s.thumb ? <img src={s.thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)] text-lg font-bold">{s.idx}</div>}
                                  </div>
                                  {hasMetrics && (
                                    <>
                                      <div className="text-[9px] text-[var(--text3)]">Alcance: <span className="font-mono-num text-[var(--text)]">{s.reach.toLocaleString('es-AR')}</span></div>
                                      <div className="text-[9px] text-[var(--text3)]">Replies: <span className="font-mono-num text-[var(--text)]">{s.likes}</span></div>
                                      <div className="text-[9px] text-[var(--text3)]">Compartidos: <span className="font-mono-num text-[var(--text)]">{s.shares.toLocaleString()}</span></div>
                                    </>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Classification — Dolor, Angulo, CTA */}
                    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Dolor</label>
                        <select
                          value={String(form.dolor || '')}
                          onChange={async (e) => {
                            const v = e.target.value
                            const prev = String(form.dolor || '')
                            setForm((p) => ({ ...p, dolor: v }))
                            try {
                              await patchSecuencia(sec.id, { dolor: v })
                            } catch {
                              setForm((p) => ({ ...p, dolor: prev }))
                              toast('No se guardó el dolor')
                            }
                          }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer"
                        >
                          <option value="">Seleccionar...</option>
                          {masterLists.dolores.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">Angulos</label>
                        <select
                          value={String(form.angulo || '')}
                          onChange={async (e) => {
                            const v = e.target.value
                            const prev = String(form.angulo || '')
                            setForm((p) => ({ ...p, angulo: v }))
                            try {
                              await patchSecuencia(sec.id, { angulos: v })
                            } catch {
                              setForm((p) => ({ ...p, angulo: prev }))
                              toast('No se guardó el ángulo')
                            }
                          }}
                          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none cursor-pointer"
                        >
                          <option value="">Seleccionar...</option>
                          {masterLists.angulos.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">¿Tiene CTA?</label>
                        <div className="flex flex-wrap gap-2">
                          {([true, false] as const).map((value) => (
                            <button
                              key={String(value)}
                              type="button"
                              onClick={async () => {
                                if (form.hasCta === value) return
                                const prev = form.hasCta === true
                                setForm((p) => ({ ...p, hasCta: value }))
                                try {
                                  await patchSecuencia(sec.id, { cta: value })
                                } catch {
                                  setForm((p) => ({ ...p, hasCta: prev }))
                                  toast('No se guardó el CTA')
                                }
                              }}
                              className={`rounded-lg px-4 py-2 text-[11px] font-semibold uppercase transition-colors ${
                                form.hasCta === value
                                  ? 'bg-[var(--auth-cta-bg)] text-[var(--auth-cta-text)]'
                                  : 'border border-[var(--border2)] text-[var(--text2)]'
                              }`}
                            >
                              {value ? 'Sí' : 'No'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Retention chart — only when we have real metrics */}
                    {hasMetrics && slideMetrics.length > 1 && (
                      <div className="mb-5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">Retención de alcance entre slides</div>
                        <div className="h-32">
                          <Line data={{
                            labels: slideMetrics.map(s => `S${s.idx}`),
                            datasets: [{
                              data: retentionData,
                              borderColor: '#71717a',
                              backgroundColor: 'rgba(113, 113, 122, 0.15)',
                              fill: true, tension: 0.3, pointRadius: 3,
                              pointBackgroundColor: '#71717a', borderWidth: 2,
                            }],
                          }} options={{
                            responsive: true, maintainAspectRatio: false,
                            scales: {
                              x: { grid: { display: false }, ticks: { color: '#A1A1AA', font: { size: 9 } } },
                              y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%`, color: '#52525B', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.03)' } },
                            },
                            plugins: { tooltip: { callbacks: { label: (ctx) => `${Number(ctx.raw).toFixed(1)}% retención (vs 1er slide, alcance)` } }, legend: { display: false } },
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Save / Close */}
                    <div className="flex gap-3">
                      <button onClick={() => saveSecuencia(sec)} className="rounded-lg bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)] hover:opacity-90">Guardar</button>
                      <button onClick={() => { setExpanded(null); setForm({ chats: '0', cash: '0', hasCta: false }) }} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cerrar</button>
                    </div>
                  </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}

      {/* Undo toast */}
      {undoAction && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] glass-card overflow-hidden shadow-lg border border-[var(--border2)] min-w-[320px]">
          <div className="flex items-center gap-4 px-5 py-3.5">
            <span className="text-[13px] text-[var(--text2)]">{undoAction.label}</span>
            <button onClick={handleUndo} className="rounded-lg bg-[var(--auth-cta-bg)] px-4 py-1.5 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)]">Deshacer</button>
            <button onClick={() => { setUndoAction(null); if (undoTimerRef.current) clearTimeout(undoTimerRef.current); if (undoIntervalRef.current) clearInterval(undoIntervalRef.current) }} className="text-[var(--text3)] text-sm">x</button>
          </div>
          <div className="h-[3px] bg-[var(--bg4)]"><div className="h-full bg-[var(--accent)] transition-[width] duration-[50ms] ease-linear" style={{ width: `${undoProgress}%` }} /></div>
        </div>
      )}

      {detailSecuencia && (
        <StorySequenceDetail
          sequence={detailSecuencia}
          onClose={() => setDetailSecuencia(null)}
          onDeleteSlide={(slideId) => handleDeleteSlide(slideId, { closeDetail: true })}
          onSave={async (payload) => {
            try {
              await patchSecuencia(detailSecuencia.id, {
                cash_manual: payload.cash_manual,
                chats: payload.chats,
              })
              toast('Secuencia guardada')
              setDetailSecuencia(null)
            } catch (e) {
              toast(`Error al guardar: ${(e as Error).message}`)
            }
          }}
        />
      )}
    </div>
  )
}

function StorySequenceDetail({
  sequence,
  onClose,
  onSave,
  onDeleteSlide,
}: {
  sequence: Secuencia
  onClose: () => void
  onSave: (payload: { cash_manual: number; chats: number }) => Promise<void>
  onDeleteSlide?: (slideId: number) => Promise<void>
}) {
  const [cash, setCash] = useState<number>(sequence.cash_manual || 0)
  const [chats, setChats] = useState<number>(sequence.chats || 0)
  const cashLeads =
    sequence.cash_leads ?? Math.max(0, sequence.cash_generado - sequence.cash_manual)
  const cashTotal = cash + cashLeads
  const cashPorChatTotal =
    sequence.chats > 0 ? sequence.cash_generado / sequence.chats : 0
  const firstReach = slideReachCount(sequence.slides[0] ?? { reach: null })
  const retentionData = sequence.slides
    .map((s, i) => {
      const rc = slideReachCount(s)
      if (firstReach <= 0) return null
      return { slide: i + 1, retention: Math.max(0, Number(((rc / firstReach) * 100).toFixed(1))) }
    })
    .filter(Boolean) as { slide: number; retention: number }[]

  return (
    <div className="fixed inset-0 z-[500] flex items-stretch justify-center bg-black/70 sm:justify-end" onClick={onClose}>
      <div className="h-full w-full bg-[var(--bg2)] p-4 overflow-y-auto sm:max-w-[920px] sm:border-l sm:border-[var(--border)] sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold">Detalle secuencia {formatSequenceDateDisplay(sequence.fecha)}</h3>
          <button className="text-[var(--text3)]" onClick={onClose}>✕</button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--text2)]">
          <SequenceIgVsFunnelKpis
            totalReach={sequence.totalReach}
            avgViews={sequence.avgViews}
            cash={sequence.cash_generado}
            chats={sequence.chats}
            agendas={sequence.agendas}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Cash generado</div>
            <div className="mt-2 text-[9px] uppercase tracking-wider text-[var(--text3)]">Total</div>
            <div className="font-mono-num text-2xl font-bold text-[var(--green)]">
              {formatCash(cashTotal)}
            </div>
            <div className="mt-3 text-[9px] uppercase tracking-wider text-[var(--text3)]">Ajuste manual</div>
            <input
              type="number"
              value={cash}
              onChange={(e) => setCash(Number(e.target.value) || 0)}
              placeholder="Cash adicional a los leads"
              className="mt-1 w-full rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1.5 text-center font-mono-num text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text3)] placeholder:text-[11px]"
              aria-label="Ajuste manual de cash adicional a los leads"
            />
            <p className="mt-1 text-[10px] text-[var(--text3)]">Cash adicional a los leads</p>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Chats</div>
            <input type="number" value={chats} onChange={(e) => setChats(Number(e.target.value) || 0)} className="w-full bg-transparent text-center font-mono-num text-2xl font-bold text-[var(--text)] outline-none" />
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">CPC</div>
            <div className="font-mono-num text-2xl font-bold">{formatCash(cashPorChatTotal)}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg4)] p-4 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[var(--text3)]">Agendas</div>
            <div className="font-mono-num text-2xl font-bold text-[var(--text)]">{sequence.agendas}</div>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex items-end overflow-x-auto pb-2 gap-3">
            {sequence.slides.map((slide, i) => {
              const reachVal = slideReachCount(slide)
              const prevReach = i > 0 ? slideReachCount(sequence.slides[i - 1]!) : 0
              const currentReach = reachVal
              const dropoff = i === 0 || prevReach <= 0 ? '—' : `${(((prevReach - currentReach) / prevReach) * 100).toFixed(1)}%`
              const thumb = getImageUrl(slide.image_url)
              return (
                <div key={slide.id} className="w-[120px] flex-shrink-0">
                  <div className="relative h-[200px] rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg4)]">
                    {onDeleteSlide && (
                      <button
                        type="button"
                        title="Eliminar esta historia"
                        className="absolute top-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-[14px] font-bold text-white hover:bg-[var(--bg4)]"
                        onClick={() => void onDeleteSlide(slide.id)}
                      >
                        ×
                      </button>
                    )}
                    {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover rounded-lg" /> : <div className="w-full h-full flex items-center justify-center text-[var(--text3)]">{i + 1}</div>}
                  </div>
                  <div className="mt-2 text-[10px] text-[var(--text3)]">ALCANCE: <span className="text-[var(--text)]">{reachVal ? reachVal.toLocaleString('es-AR') : '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">REPLIES: <span className="text-[var(--text)]">{toNumber(slide.replies) || '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">COMPARTIDOS: <span className="text-[var(--text)]">{toNumber(slide.shares) || '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">PERFIL: <span className="text-[var(--text)]">{toNumber(slide.profile_visits) || '—'}</span></div>
                  <div className="text-[10px] text-[var(--text3)]">DROPOFF: <span className="text-[var(--text)]">{dropoff}</span></div>
                </div>
              )
            })}
          </div>
        </div>

        {retentionData.length > 0 && (
          <div className="mb-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)] mb-2">Retención de alcance entre slides</div>
            <div className="h-56 w-full rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
              <Line
                data={{
                  labels: retentionData.map((d) => `S${d.slide}`),
                  datasets: [
                    {
                      data: retentionData.map((d) => d.retention),
                      borderColor: '#71717a',
                      backgroundColor: 'rgba(113, 113, 122, 0.15)',
                      fill: true,
                      tension: 0.3,
                      pointRadius: 3,
                      pointBackgroundColor: '#71717a',
                      borderWidth: 2,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: { grid: { display: false }, ticks: { color: '#A1A1AA', font: { size: 9 } } },
                    y: {
                      min: 0,
                      max: 100,
                      ticks: { callback: (v) => `${v}%`, color: '#52525B', font: { size: 9 } },
                      grid: { color: 'rgba(255,255,255,0.03)' },
                    },
                  },
                  plugins: {
                    tooltip: {
                      callbacks: {
                        label: (ctx) => `${Number(ctx.raw).toFixed(1)}% retención (vs 1er slide)`,
                      },
                    },
                    legend: { display: false },
                  },
                }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => onSave({ cash_manual: cash, chats })}
            className="rounded-lg bg-[var(--auth-cta-bg)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)] hover:opacity-90"
          >
            Guardar
          </button>
          <button onClick={onClose} className="rounded-lg border border-[var(--border2)] px-5 py-2.5 text-[11px] font-semibold uppercase text-[var(--text3)]">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

