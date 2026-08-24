'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getFathomApiStatus } from '../services/call-reports-service'
import type { FathomApiStatus } from '../types'
import { fathomStatusLabel } from '../lib/claude-status'

function statusStyles(status: FathomApiStatus['status']): string {
  switch (status) {
    case 'ok':
      return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
    case 'invalid_key':
      return 'border-[var(--red)]/30 bg-[var(--red)]/5 text-[var(--red)]'
    case 'not_configured':
      return 'border-amber-500/30 bg-amber-500/5 text-amber-200'
    default:
      return 'border-[var(--border2)] bg-[var(--bg3)] text-[var(--text2)]'
  }
}

export function FathomApiStatusBanner() {
  const [status, setStatus] = useState<FathomApiStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getFathomApiStatus()
      setStatus(next)
    } catch {
      setStatus({
        status: 'unavailable',
        message: 'No se pudo verificar el estado de la API key de Fathom.',
        api_key_masked: null,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  if (loading && !status) {
    return (
      <div className="mb-4 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-[12px] text-[var(--text3)]">
        Verificando API key de Fathom…
      </div>
    )
  }

  if (!status) return null

  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 text-[12px] ${statusStyles(status.status)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
              Fathom
            </span>
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[10px] font-medium">
              {fathomStatusLabel(status.status)}
            </span>
          </div>
          {status.api_key_masked ? (
            <p className="font-mono text-[11px] opacity-90">{status.api_key_masked}</p>
          ) : null}
          <p className="leading-relaxed">{status.message}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="rounded-md border border-current/20 px-2.5 py-1 text-[11px] hover:bg-black/10"
          >
            Revisar
          </button>
          {status.status !== 'ok' ? (
            <Link
              href="/conexiones"
              prefetch={false}
              className="rounded-md border border-current/20 px-2.5 py-1 text-[11px] hover:bg-black/10"
            >
              Conexiones API
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}
