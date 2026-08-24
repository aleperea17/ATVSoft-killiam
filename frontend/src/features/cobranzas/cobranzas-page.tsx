'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuthUser } from '@/shared/hooks/use-auth-user'
import { useToast } from '@/shared/components/toast'
import { formatCash, formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { apiFetch, formatApiDetail } from '@/lib/api'
import { RegisterPaymentModal } from './register-payment-modal'
import { DefineContractModal } from './define-contract-modal'
import type { CobranzasLeadRow, CobranzasView } from './types'

function contactLine(row: CobranzasLeadRow): string {
  const ig = row.ig ? `@${row.ig.replace(/^@/, '')}` : ''
  const tel = row.telefono || ''
  return [ig, tel].filter(Boolean).join(' · ') || '—'
}

function contratoLabel(row: CobranzasLeadRow): string {
  if (row.contrato == null) return '—'
  return formatCash(row.contrato)
}

const ESTADO_LABEL: Record<NonNullable<CobranzasLeadRow['vencimiento_estado']>, string> = {
  sin_fecha: 'Sin fecha',
  vencido: 'Vencido',
  proximo: 'Próximo',
  al_dia: 'Al día',
}

function estadoClass(estado: CobranzasLeadRow['vencimiento_estado']): string {
  if (estado === 'vencido') return 'text-[var(--red)]'
  if (estado === 'proximo') return 'text-[var(--amber)]'
  if (estado === 'al_dia') return 'text-[var(--text2)]'
  return 'text-[var(--text3)]'
}

export function CobranzasPage() {
  const { ready, userId } = useAuthUser()
  const { toast } = useToast()
  const [data, setData] = useState<CobranzasView | null>(null)
  const [loading, setLoading] = useState(true)
  const [payRow, setPayRow] = useState<CobranzasLeadRow | null>(null)
  const [contractRow, setContractRow] = useState<CobranzasLeadRow | null>(null)
  const [savingDueId, setSavingDueId] = useState<string | null>(null)

  const fetchView = useCallback(async () => {
    if (!ready) return
    if (!userId) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch('/cobranzas')
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo cargar cobranzas'))
        setData(null)
        return
      }
      setData(raw as CobranzasView)
    } finally {
      setLoading(false)
    }
  }, [ready, userId, toast])

  useEffect(() => {
    void fetchView()
  }, [fetchView])

  const markPending = async (row: CobranzasLeadRow) => {
    const res = await apiFetch(`/cobranzas/leads/${row.id}/contrato`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contrato_pendiente: true }),
    })
    if (!res.ok) {
      const raw = await res.json().catch(() => ({}))
      toast(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo marcar'))
      return
    }
    toast('Marcado sin precio de contrato')
    await fetchView()
  }

  const saveVencimiento = async (row: CobranzasLeadRow, value: string) => {
    setSavingDueId(row.id)
    try {
      const res = await apiFetch(`/cobranzas/leads/${row.id}/vencimiento`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proximo_vencimiento: value || null }),
      })
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}))
        toast(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo guardar el vencimiento'))
        return
      }
      toast(value ? 'Vencimiento actualizado' : 'Vencimiento quitado')
      await fetchView()
    } finally {
      setSavingDueId(null)
    }
  }

  if (!ready || loading) {
    return <div className="py-12 text-center text-[var(--text3)]">Cargando…</div>
  }
  if (!userId) {
    return <div className="py-12 text-center text-[var(--text3)]">Iniciá sesión para ver cobranzas.</div>
  }
  if (!data) {
    return <div className="py-12 text-center text-[var(--text3)]">No se pudo cargar la vista de cobranzas.</div>
  }

  const s = data.summary

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">
          Pagos <span className="text-[var(--text2)]">pendientes</span>
        </h2>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Total adeudado</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--amber)]">
            {formatCash(s.total_adeudado)}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Cobrado</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--green)]">
            {formatCash(s.total_cobrado)}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Deudores</div>
          <div className="font-mono-num mt-1 text-xl font-semibold">{s.deudores}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Vencidos</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--red)]">{s.vencidos}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Vencen esta semana</div>
          <div className="font-mono-num mt-1 text-xl font-semibold text-[var(--amber)]">{s.vencen_semana}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text3)]">Sin contrato</div>
          <div className="font-mono-num mt-1 text-xl font-semibold">{s.sin_contrato}</div>
        </div>
      </div>

      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-[var(--text3)]">
        Con saldo pendiente
      </h3>
      <div className="mb-8 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
        <table className="w-full min-w-[1120px] text-left">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text3)]">
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Contacto</th>
              <th className="px-3 py-2 font-medium">Programa</th>
              <th className="px-3 py-2 font-medium">Contrato</th>
              <th className="px-3 py-2 font-medium">Pagado</th>
              <th className="px-3 py-2 font-medium">Debe</th>
              <th className="px-3 py-2 font-medium">Vence</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Último cobro</th>
              <th className="px-3 py-2 font-medium">Closer</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data.con_saldo.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-[13px] text-[var(--text3)]">
                  Nadie con saldo pendiente.
                </td>
              </tr>
            ) : (
              data.con_saldo.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 text-[13px] font-medium">{row.nombre}</td>
                  <td className="px-3 py-2 text-[12px] text-[var(--text2)]">{contactLine(row)}</td>
                  <td className="px-3 py-2 text-[12px]">{row.programa || '—'}</td>
                  <td className="px-3 py-2 text-[12px] font-mono-num">{contratoLabel(row)}</td>
                  <td className="px-3 py-2 text-[12px] font-mono-num text-[var(--green)]">
                    {formatCash(row.pagado)}
                  </td>
                  <td className="px-3 py-2 text-[13px] font-mono-num font-semibold text-[var(--amber)]">
                    {row.debe != null ? formatCash(row.debe) : '—'}
                    {row.saldo_a_favor > 0 ? (
                      <div className="text-[10px] font-normal text-[var(--text3)]">
                        a favor {formatCash(row.saldo_a_favor)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={row.proximo_vencimiento ? row.proximo_vencimiento.slice(0, 10) : ''}
                        disabled={savingDueId === row.id}
                        onChange={(e) => void saveVencimiento(row, e.target.value)}
                        className="w-[9.5rem] cursor-pointer rounded-md border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 text-[12px] text-[var(--text)] outline-none focus:border-[var(--text3)] disabled:opacity-50"
                        aria-label={`Vencimiento de ${row.nombre}`}
                      />
                      {row.proximo_vencimiento ? (
                        <button
                          type="button"
                          disabled={savingDueId === row.id}
                          onClick={() => void saveVencimiento(row, '')}
                          className="text-[11px] text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-50"
                          aria-label={`Quitar vencimiento de ${row.nombre}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-[12px] font-medium ${estadoClass(row.vencimiento_estado)}`}>
                    {ESTADO_LABEL[row.vencimiento_estado ?? 'sin_fecha']}
                  </td>
                  <td className="px-3 py-2 text-[12px] font-mono-num">
                    {row.ultimo_cobro ? formatIsoDateDdMmYyyy(row.ultimo_cobro) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[12px]">{row.closer || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setContractRow(row)}
                        className="text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
                      >
                        Definir contrato
                      </button>
                      <button
                        type="button"
                        onClick={() => void markPending(row)}
                        className="text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
                      >
                        Sin contrato
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayRow(row)}
                        className="rounded-lg border border-[var(--border2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] hover:text-[var(--text)]"
                      >
                        Registrar cobro
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-widest text-[var(--text3)]">
        Sin precio de contrato
      </h3>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg2)]">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text3)]">
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Contacto</th>
              <th className="px-3 py-2 font-medium">Pagado</th>
              <th className="px-3 py-2 font-medium">Closer</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data.sin_contrato.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[13px] text-[var(--text3)]">
                  Nadie sin precio de contrato.
                </td>
              </tr>
            ) : (
              data.sin_contrato.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 text-[13px] font-medium">{row.nombre}</td>
                  <td className="px-3 py-2 text-[12px] text-[var(--text2)]">{contactLine(row)}</td>
                  <td className="px-3 py-2 text-[12px] font-mono-num">{formatCash(row.pagado)}</td>
                  <td className="px-3 py-2 text-[12px]">{row.closer || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setContractRow(row)}
                      className="rounded-lg border border-[var(--border2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)] hover:text-[var(--text)]"
                    >
                      Definir contrato
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <RegisterPaymentModal
        open={Boolean(payRow)}
        onClose={() => setPayRow(null)}
        leadId={payRow ? Number(payRow.id) : null}
        leadName={payRow?.nombre ?? ''}
        defaultMemberId={payRow?.closer_member_id ?? null}
        currentContract={payRow?.contrato ?? null}
        catalogSuggestion={payRow?.catalogo_sugerido ?? null}
        currentDue={payRow?.proximo_vencimiento ?? null}
        onSaved={() => void fetchView()}
      />

      <DefineContractModal
        open={Boolean(contractRow)}
        onClose={() => setContractRow(null)}
        leadId={contractRow ? Number(contractRow.id) : null}
        leadName={contractRow?.nombre ?? ''}
        pagado={contractRow?.pagado ?? 0}
        currentPrice={contractRow?.contrato ?? null}
        catalogSuggestion={contractRow?.catalogo_sugerido ?? null}
        onSaved={() => void fetchView()}
      />
    </div>
  )
}
