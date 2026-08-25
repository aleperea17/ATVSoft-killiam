'use client'

import { useCallback, useEffect, useState } from 'react'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { formatCash, formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { apiFetch, formatApiDetail } from '@/lib/api'
import { PAYMENT_CONCEPTOS, PAYMENT_METODOS, type LeadPayment, type TeamMemberOption } from './types'
import { useCompanyConfig } from '@/shared/components/app-providers'
import { todayIsoInTimeZone } from '@/shared/lib/tenant-time'

function rolLabel(rol: string): string {
  if (rol === 'setter') return 'Setter'
  if (rol === 'closer') return 'Closer'
  if (rol === 'cash') return 'Cash'
  return rol
}

type Props = {
  open: boolean
  onClose: () => void
  leadId: number | null
  leadName: string
  defaultMemberId: number | null
  closerName?: string | null
  currentContract?: number | null
  catalogSuggestion?: number | null
  currentDue?: string | null
  onSaved: () => void
}

export function RegisterPaymentModal({
  open,
  onClose,
  leadId,
  leadName,
  defaultMemberId,
  closerName,
  currentContract,
  catalogSuggestion,
  currentDue,
  onSaved,
}: Props) {
  const { toast } = useToast()
  const { timezone } = useCompanyConfig()
  const todayIso = () => todayIsoInTimeZone(timezone)
  const [members, setMembers] = useState<TeamMemberOption[]>([])
  const [history, setHistory] = useState<LeadPayment[]>([])
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(todayIso())
  const [memberId, setMemberId] = useState('')
  const [concepto, setConcepto] = useState('Seña')
  const [metodo, setMetodo] = useState('Transferencia')
  const [comprobante, setComprobante] = useState('')
  const [nota, setNota] = useState('')
  const [contrato, setContrato] = useState('')
  const [vencimiento, setVencimiento] = useState('')

  const load = useCallback(async () => {
    if (!open || leadId == null) return
    const [mRes, pRes] = await Promise.all([
      apiFetch('/team/members'),
      apiFetch(`/cobranzas/pagos?lead_id=${leadId}`),
    ])
    if (mRes.ok) {
      const data = (await mRes.json()) as {
        setters?: { id: number; nombre: string; rol?: string }[]
        closers?: { id: number; nombre: string; rol?: string }[]
        cash?: { id: number; nombre: string; rol?: string }[]
      }
      const merged: TeamMemberOption[] = [
        ...(data.setters ?? []).map((m) => ({ id: m.id, nombre: m.nombre, rol: m.rol ?? 'setter' })),
        ...(data.closers ?? []).map((m) => ({ id: m.id, nombre: m.nombre, rol: m.rol ?? 'closer' })),
        ...(data.cash ?? []).map((m) => ({ id: m.id, nombre: m.nombre, rol: m.rol ?? 'cash' })),
      ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
      setMembers(merged)
    }
    if (pRes.ok) {
      const rows = (await pRes.json()) as LeadPayment[]
      setHistory(Array.isArray(rows) ? rows : [])
    }
  }, [open, leadId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!open) return
    setMonto('')
    setFecha(todayIso())
    setConcepto('Seña')
    setMetodo('Transferencia')
    setComprobante('')
    setNota('')
    setContrato(
      currentContract != null
        ? ''
        : catalogSuggestion != null
          ? String(catalogSuggestion)
          : '',
    )
    setVencimiento(currentDue ? currentDue.slice(0, 10) : '')
  }, [open, leadId, currentContract, catalogSuggestion, currentDue])

  useEffect(() => {
    if (!open) return
    if (defaultMemberId != null) {
      setMemberId(String(defaultMemberId))
      return
    }
    const needle = (closerName || '').trim().toLocaleLowerCase('es')
    if (needle) {
      const hit = members.find((m) => m.nombre.trim().toLocaleLowerCase('es') === needle)
      setMemberId(hit ? String(hit.id) : '')
      return
    }
    setMemberId('')
  }, [open, leadId, defaultMemberId, closerName, members])

  const handleSave = async () => {
    if (leadId == null) return
    const amount = Number(String(monto).replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Indicá un monto mayor a 0.')
      return
    }
    if (!memberId) {
      toast('Seleccioná quién cobró.')
      return
    }
    if (!fecha) {
      toast('Indicá la fecha de cobro.')
      return
    }
    const needsContract = currentContract == null
    let contratoNum: number | null = null
    if (needsContract) {
      contratoNum = Number(String(contrato).replace(',', '.'))
      if (!Number.isFinite(contratoNum) || contratoNum <= 0) {
        toast('Indicá el precio del contrato. Podés usar el del catálogo o el negociado.')
        return
      }
    }
    setSaving(true)
    try {
      const res = await apiFetch('/cobranzas/pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          monto: amount,
          fecha_cobro: fecha,
          member_id: Number(memberId),
          concepto,
          metodo,
          comprobante_url: comprobante.trim() || null,
          nota: nota.trim() || null,
          ...(contratoNum != null ? { precio_contrato: contratoNum } : {}),
          ...(vencimiento ? { proximo_vencimiento: vencimiento } : {}),
        }),
      })
      const raw = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo guardar el cobro'))
        return
      }
      toast('Cobro registrado')
      setMonto('')
      setNota('')
      setComprobante('')
      onSaved()
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      const res = await apiFetch(`/cobranzas/pagos/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}))
        toast(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo eliminar'))
        return
      }
      toast('Cobro eliminado')
      onSaved()
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar cobro" maxWidth="520px">
      <p className="mb-4 text-[13px] text-[var(--text2)]">{leadName}</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Monto (€)</label>
          <input
            type="text"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
            placeholder="0"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Fecha de cobro</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">
            Próximo vencimiento <span className="font-normal text-[var(--text3)]">(opcional)</span>
          </label>
          <input
            type="date"
            value={vencimiento}
            onChange={(e) => setVencimiento(e.target.value)}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
        {currentContract == null ? (
          <div className="col-span-2">
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">
              Precio del contrato (€)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={contrato}
              onChange={(e) => setContrato(e.target.value)}
              className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
              placeholder={catalogSuggestion != null ? String(catalogSuggestion) : '0'}
            />
            {catalogSuggestion != null ? (
              <p className="mt-1 text-[11px] text-[var(--text3)]">
                Sugerido del catálogo: {formatCash(catalogSuggestion)} (editable)
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="col-span-2">
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Cobrado por</label>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          >
            <option value="">Seleccionar…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre} ({rolLabel(m.rol)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Concepto</label>
          <select
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          >
            {PAYMENT_CONCEPTOS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Método</label>
          <select
            value={metodo}
            onChange={(e) => setMetodo(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          >
            {PAYMENT_METODOS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Comprobante (URL, opcional)</label>
          <input
            type="url"
            value={comprobante}
            onChange={(e) => setComprobante(e.target.value)}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
            placeholder="https://…"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">Nota (opcional)</label>
          <input
            type="text"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text3)]"
          />
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border2)] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text2)]"
        >
          Cerrar
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="rounded-xl bg-[var(--auth-cta-bg)] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--auth-cta-text)] disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar cobro'}
        </button>
      </div>

      {history.length > 0 && (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text3)]">
            Cobros anteriores
          </div>
          <div className="space-y-2">
            {history.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[var(--text)]">
                    {formatCash(p.monto)} · {p.concepto}
                  </div>
                  <div className="text-[11px] text-[var(--text3)]">
                    {formatIsoDateDdMmYyyy(p.fecha_cobro)} · {p.member_nombre || '—'} · {p.metodo}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={deletingId === p.id}
                  onClick={() => void handleDelete(p.id)}
                  className="shrink-0 text-[11px] text-[var(--text3)] hover:text-[var(--text)]"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
