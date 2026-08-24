'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, formatApiDetail } from '@/lib/api'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import {
  bulkDeleteCallReports,
  bulkDownloadCallReports,
  getCallReports,
} from '../services/call-reports-service'
import type { CallReport } from '../types'
import { CallReportsTable } from './CallReportsTable'

const POLL_MS = 5000
const UNLOCK_KEY = 'atv-reporte-calls-unlocked'

function hasPending(items: CallReport[]): boolean {
  return items.some((r) => r.estado === 'pendiente' || r.estado === 'procesando')
}

function CallReportsPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      const res = await apiFetch('/company-config/unlock-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: unknown }
      if (!res.ok) {
        setError(
          typeof data.error === 'string'
            ? data.error
            : formatApiDetail(data.detail, 'Contraseña incorrecta.'),
        )
        return
      }
      try {
        sessionStorage.setItem(UNLOCK_KEY, '1')
      } catch {
        /* ignore */
      }
      onUnlock()
    } catch {
      setError('No se pudo verificar la contraseña.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h2 className="text-lg font-bold tracking-tight">Reporte calls</h2>
      <p className="mt-1 text-[12px] text-[var(--text3)]">
        Esta vista está protegida. Ingresá la contraseña para continuar.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="reporte-calls-password"
            className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]"
          >
            Contraseña
          </label>
          <input
            id="reporte-calls-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError('')
            }}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text3)]"
            placeholder="••••••••"
            autoFocus
            disabled={pending}
          />
        </div>
        {error ? <p className="text-[12px] text-[var(--red)]">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg2)] px-4 py-2.5 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--bg3)] disabled:opacity-50"
        >
          {pending ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

export function CallReportsPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [unlocked, setUnlocked] = useState(false)
  const [unlockChecked, setUnlockChecked] = useState(false)
  const [items, setItems] = useState<CallReport[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const check = async () => {
      try {
        if (sessionStorage.getItem(UNLOCK_KEY) === '1') {
          if (!cancelled) {
            setUnlocked(true)
            setUnlockChecked(true)
          }
          return
        }
      } catch {
        /* ignore */
      }
      try {
        if (userId) {
          const res = await apiFetch('/company-config')
          const data = (await res.json().catch(() => ({}))) as { call_reports_gate?: boolean }
          if (!cancelled && res.ok && data.call_reports_gate === false) {
            setUnlocked(true)
          }
        } else {
          const res = await fetch('/api/call-reports/unlock')
          const data = (await res.json().catch(() => ({}))) as { gateEnabled?: boolean }
          if (!cancelled && data.gateEnabled === false) {
            setUnlocked(true)
          }
        }
      } catch {
        /* si no se puede consultar, el gate queda activo */
      }
      if (!cancelled) setUnlockChecked(true)
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [ready, userId])

  const fetchReports = useCallback(async (silent = false) => {
    if (!ready || !userId || !unlocked) {
      setItems([])
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const rows = await getCallReports()
      setItems(rows)
      setSelectedIds((prev) => {
        const next = new Set<string>()
        const ids = new Set(rows.map((r) => r.id))
        for (const id of prev) {
          if (ids.has(id)) next.add(id)
        }
        return next
      })
    } catch (e) {
      if (!silent) {
        toast(e instanceof Error ? e.message : 'Error al cargar reportes.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [ready, userId, unlocked, toast])

  useEffect(() => {
    if (!unlocked) return
    void fetchReports()
  }, [fetchReports, unlocked])

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!ready || !userId || !unlocked) return undefined
    if (!hasPending(items)) return undefined

    pollRef.current = setInterval(() => {
      void fetchReports(true)
    }, POLL_MS)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [items, ready, userId, unlocked, fetchReports])

  const selectedList = useMemo(() => Array.from(selectedIds), [selectedIds])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (items.length > 0 && items.every((r) => prev.has(r.id))) {
        return new Set()
      }
      return new Set(items.map((r) => r.id))
    })
  }, [items])

  const runBulkDownload = useCallback(async () => {
    if (selectedList.length === 0) return
    setBusy(true)
    try {
      await bulkDownloadCallReports(selectedList)
      toast(`Descarga PDF lista (${selectedList.length}).`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al descargar.')
    } finally {
      setBusy(false)
    }
  }, [selectedList, toast])

  const runBulkDelete = useCallback(async () => {
    if (selectedList.length === 0) return
    const ok = window.confirm(
      selectedList.length === 1
        ? '¿Eliminar el reporte seleccionado?'
        : `¿Eliminar ${selectedList.length} reportes?`,
    )
    if (!ok) return
    setBusy(true)
    try {
      const deleted = await bulkDeleteCallReports(selectedList)
      toast(`Eliminados: ${deleted}.`)
      setSelectedIds(new Set())
      await fetchReports(true)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al eliminar.')
    } finally {
      setBusy(false)
    }
  }, [selectedList, toast, fetchReports])

  if (!unlockChecked) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando…</div>
  }

  if (!unlocked) {
    return <CallReportsPasswordGate onUnlock={() => setUnlocked(true)} />
  }

  if (!ready) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Cargando sesión…</div>
  }

  if (!userId) {
    return <div className="py-12 text-[13px] text-[var(--text3)]">Iniciá sesión para ver los reportes.</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Reporte calls</h2>
          <p className="mt-1 text-[12px] text-[var(--text3)]">
            Análisis automático al pegar el link de Fathom en Leads.
          </p>
        </div>
        {selectedList.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[var(--text3)]">{selectedList.length} seleccionados</span>
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)] disabled:opacity-50"
              onClick={() => void runBulkDownload()}
            >
              Descargar PDF
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-1.5 text-[12px] text-[var(--red)] hover:bg-[var(--red)]/20 disabled:opacity-50"
              onClick={() => void runBulkDelete()}
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
      <CallReportsTable
        items={items}
        loading={loading}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        onError={(msg) => toast(msg)}
        onRefresh={() => void fetchReports(true)}
      />
    </div>
  )
}
