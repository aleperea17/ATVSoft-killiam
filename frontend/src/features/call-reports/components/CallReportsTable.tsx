'use client'

import { useMemo, useState } from 'react'
import type { CallReport } from '../types'
import { CallReportDetail, formatReportDate } from './CallReportDetail'

type Props = {
  items: CallReport[]
  loading: boolean
  selectedIds: Set<string>
  onToggleRow: (id: string) => void
  onToggleAll: () => void
  onError?: (msg: string) => void
  onRefresh?: () => void
}

const COLS = 'grid-cols-[36px_1.2fr_0.85fr_1.6fr_36px]'

export function CallReportsTable({
  items,
  loading,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onError,
  onRefresh,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [items],
  )

  const allSelected = sorted.length > 0 && sorted.every((r) => selectedIds.has(r.id))

  if (loading && sorted.length === 0) {
    return <div className="py-12 text-center text-[13px] text-[var(--text3)]">Cargando reportes…</div>
  }

  if (sorted.length === 0) {
    return (
      <div className="glass-card py-12 text-center text-[13px] text-[var(--text3)]">
        No hay reportes todavía. Pegá un link de Fathom en la columna &quot;Link de llamada&quot; de un lead.
      </div>
    )
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="w-full text-[13px]">
        <div
          className={`grid ${COLS} items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]`}
        >
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              aria-label="Seleccionar todos"
            />
          </div>
          <div className="text-left">Lead</div>
          <div className="text-center">Fecha</div>
          <div className="text-left">Link Fathom</div>
          <div />
        </div>

        {sorted.map((row) => {
          const open = expandedId === row.id
          return (
            <div key={row.id} className="border-b border-[var(--border)]/60">
              <div
                className={`grid ${COLS} w-full items-center gap-2 px-4 py-3 hover:bg-[var(--bg3)]/40`}
              >
                <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => onToggleRow(row.id)}
                    aria-label={`Seleccionar reporte ${row.id}`}
                  />
                </div>
                <button
                  type="button"
                  className="min-w-0 truncate text-left font-medium text-[var(--text)]"
                  onClick={() => setExpandedId(open ? null : row.id)}
                >
                  {row.lead_nombre || 'Sin nombre'}
                </button>
                <button
                  type="button"
                  className="text-center font-mono-num text-[var(--text2)]"
                  onClick={() => setExpandedId(open ? null : row.id)}
                >
                  {formatReportDate(row.created_at)}
                </button>
                <a
                  href={row.fathom_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-left text-[var(--accent)] hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.fathom_url}
                </a>
                <button
                  type="button"
                  className="text-center text-[var(--text3)]"
                  onClick={() => setExpandedId(open ? null : row.id)}
                  aria-label={open ? 'Cerrar' : 'Expandir'}
                >
                  {open ? '▾' : '▸'}
                </button>
              </div>
              {open && (
                <div className="px-4 pb-4">
                  <CallReportDetail report={row} onError={onError} onReanalyze={onRefresh} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
