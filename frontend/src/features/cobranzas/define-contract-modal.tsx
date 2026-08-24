'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/shared/components/modal'
import { useToast } from '@/shared/components/toast'
import { formatCash } from '@/shared/lib/format-utils'
import { apiFetch, formatApiDetail } from '@/lib/api'

function parseEuro(raw: string): number {
  return Number(String(raw).replace(',', '.'))
}

type Props = {
  open: boolean
  onClose: () => void
  leadId: number | null
  leadName: string
  pagado: number
  currentPrice: number | null
  catalogSuggestion: number | null
  onSaved: () => void
}

export function DefineContractModal({
  open,
  onClose,
  leadId,
  leadName,
  pagado,
  currentPrice,
  catalogSuggestion,
  onSaved,
}: Props) {
  const { toast } = useToast()
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [ackOverpay, setAckOverpay] = useState(false)

  useEffect(() => {
    if (!open) return
    const initial = currentPrice ?? catalogSuggestion ?? (pagado > 0 ? pagado : null)
    setPrice(initial != null ? String(initial) : '')
    setAckOverpay(false)
  }, [open, leadId, currentPrice, catalogSuggestion, pagado])

  const parsed = parseEuro(price)
  const credit = useMemo(() => {
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.round((pagado - parsed) * 100) / 100
  }, [pagado, parsed])
  const isOverpay = credit > 0.004

  const save = async () => {
    if (leadId == null) return
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast('Indicá el precio del contrato en dólares.')
      return
    }
    if (isOverpay && !ackOverpay) {
      toast('Confirmá el saldo a favor para guardar.')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch(`/cobranzas/leads/${leadId}/contrato`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ precio_contrato: parsed, contrato_pendiente: false }),
      })
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}))
        toast(formatApiDetail((raw as { detail?: unknown }).detail, 'No se pudo guardar el contrato'))
        return
      }
      toast(isOverpay ? 'Contrato guardado · saldo a favor registrado' : 'Contrato definido')
      onClose()
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Definir contrato" maxWidth="420px" compact>
      <p className="mb-2 text-[13px] font-medium text-[var(--text)]">{leadName}</p>
      <p className="mb-4 text-[12px] text-[var(--text2)]">
        Pagado: <span className="font-mono-num">{formatCash(pagado)}</span>
        {catalogSuggestion != null && currentPrice == null ? (
          <span className="block mt-1 text-[11px] text-[var(--text3)]">
            Sugerido del catálogo: {formatCash(catalogSuggestion)} (editable)
          </span>
        ) : null}
      </p>
      <label className="mb-1.5 block text-[11px] font-medium text-[var(--text2)]">
        Precio del contrato ($)
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={price}
        onChange={(e) => {
          setPrice(e.target.value)
          setAckOverpay(false)
        }}
        className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
      />
      {isOverpay ? (
        <div className="mt-3 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2">
          <p className="text-[12px] text-[var(--text)]">
            El contrato es menor a lo cobrado — quedaría un saldo a favor de {formatCash(credit)}.
            La deuda queda en $0 (no se registra negativa).
          </p>
          <label className="mt-2 flex items-start gap-2 text-[12px] text-[var(--text2)]">
            <input
              type="checkbox"
              checked={ackOverpay}
              onChange={(e) => setAckOverpay(e.target.checked)}
              className="mt-0.5"
            />
            Guardar igual y registrar el saldo a favor
          </label>
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border2)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--text2)]"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={saving || (isOverpay && !ackOverpay)}
          onClick={() => void save()}
          className="rounded-xl bg-[var(--auth-cta-bg)] px-4 py-2 text-[11px] font-semibold uppercase text-[var(--auth-cta-text)] disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
