'use client'

import type { CallReport } from '../types'
import { formatCallReportError } from '../lib/claude-status'
import { reanalyzeCallReport } from '../services/call-reports-service'
import { formatIsoDateDdMmYyyy } from '@/shared/lib/format-utils'
import { downloadCallReport } from '../services/call-reports-service'

type Props = {
  report: CallReport
  onBusy?: (busy: boolean) => void
  onError?: (msg: string) => void
  onReanalyze?: () => void
}

function FieldBlock({ label, value }: { label: string; value: string | null | undefined }) {
  const text = (value || '').trim()
  if (!text) return null

  const lines = text.split(/\n/).map((l) => l.trimEnd())
  const verdict = lines[0]?.trim() || ''
  const rest = lines.slice(1)

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg2)]/60 px-3 py-2.5 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">{label}</div>
      {verdict ? (
        <div className="text-[14px] font-medium leading-snug text-[var(--text)]">{verdict}</div>
      ) : null}
      {rest.length > 0 ? (
        <div className="space-y-1.5">
          {rest.map((line, i) => {
            if (!line.trim()) return <div key={i} className="h-1" />
            const bullet = /^[-•*]\s+/.test(line.trim())
            const sublabel = /^(superficie|real|evidencia|patrones|mejoras|lead|closer)\s*:/i.test(
              line.trim(),
            )
            if (bullet) {
              return (
                <div key={i} className="flex gap-2 text-[13px] leading-relaxed text-[var(--text2)]">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{line.trim().replace(/^[-•*]\s+/, '')}</span>
                </div>
              )
            }
            if (sublabel) {
              return (
                <div
                  key={i}
                  className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)]"
                >
                  {line.trim()}
                </div>
              )
            }
            return (
              <p key={i} className="text-[13px] leading-relaxed text-[var(--text2)]">
                {line}
              </p>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="border-b border-[var(--border)] pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text)]">
      {children}
    </div>
  )
}

function HeaderItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text3)]">{label}</div>
      <div className="mt-0.5 break-words text-[13px] text-[var(--text)]">{value || '—'}</div>
    </div>
  )
}

function hasNewFormat(report: CallReport): boolean {
  return Boolean(
    (report.nivel_dolor || '').trim() ||
      (report.capacidad_decision || '').trim() ||
      (report.capacidad_economica || '').trim() ||
      (report.fit_real || '').trim() ||
      (report.objecion_diagnostico || '').trim() ||
      (report.cambio_energia || '').trim() ||
      (report.objecion_no_manejada || '').trim() ||
      (report.razon_real_no_cerrar || '').trim() ||
      (report.compromisos_prometidos || '').trim() ||
      (report.patrones_y_mejoras || '').trim(),
  )
}

export function CallReportDetail({ report, onBusy, onError, onReanalyze }: Props) {
  if (report.estado === 'error') {
    return (
      <div className="space-y-3 rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 p-4">
        <p className="text-[13px] text-[var(--red)]">
          {formatCallReportError(report.error_msg)}
        </p>
        <button
          type="button"
          className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)]"
          onClick={() => {
            onBusy?.(true)
            void reanalyzeCallReport(report.id)
              .then(() => onReanalyze?.())
              .catch((e) =>
                onError?.(e instanceof Error ? e.message : 'No se pudo reintentar el análisis.'),
              )
              .finally(() => onBusy?.(false))
          }}
        >
          Reintentar análisis
        </button>
      </div>
    )
  }

  if (report.estado === 'pendiente' || report.estado === 'procesando') {
    return (
      <div className="py-3 text-[13px] text-[var(--text3)]">
        {report.estado === 'procesando'
          ? 'Analizando la llamada con Claude…'
          : 'En cola para análisis…'}
      </div>
    )
  }

  const legacyResumen =
    (report.resumen || '').trim() || (report.closer_report || '').trim() || null
  const useNew = hasNewFormat(report)

  async function handleDownload() {
    onBusy?.(true)
    try {
      await downloadCallReport(report.id)
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Error al descargar.')
    } finally {
      onBusy?.(false)
    }
  }

  return (
    <div className="space-y-4 border-t border-[var(--border)] pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-[var(--border)] bg-[var(--bg2)] px-3 py-1.5 text-[12px] text-[var(--text2)] hover:bg-[var(--bg3)]"
          onClick={() => void handleDownload()}
        >
          Descargar PDF
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HeaderItem label="Fecha" value={formatReportDate(report.created_at)} />
        <HeaderItem label="Lead" value={report.lead_nombre || 'Sin nombre'} />
        <HeaderItem label="Link de la grabación" value={report.fathom_url || '—'} />
        <HeaderItem label="Participantes" value={(report.participantes || '').trim() || '—'} />
        <HeaderItem
          label="Motivo de la reunión"
          value={(report.motivo_reunion || '').trim() || '—'}
        />
      </div>

      {useNew ? (
        <>
          <div className="space-y-3">
            <SectionTitle>Calificación del lead</SectionTitle>
            <FieldBlock label="Nivel de dolor" value={report.nivel_dolor} />
            <FieldBlock label="Capacidad de decisión" value={report.capacidad_decision} />
            <FieldBlock label="Capacidad económica" value={report.capacidad_economica} />
            <FieldBlock label="Fit real" value={report.fit_real} />
            <FieldBlock label="Objeción real vs superficie" value={report.objecion_diagnostico} />
          </div>
          <div className="space-y-3">
            <SectionTitle>Coaching de la llamada</SectionTitle>
            <FieldBlock label="¿En qué momento cambió la energía del lead?" value={report.cambio_energia} />
            <FieldBlock label="¿Qué objeción no se manejó bien?" value={report.objecion_no_manejada} />
            <FieldBlock label="Razón real de no cerrar (diagnosticada)" value={report.razon_real_no_cerrar} />
          </div>
          <div className="space-y-3">
            <SectionTitle>Trazabilidad y mejora</SectionTitle>
            <FieldBlock label="Compromisos prometidos" value={report.compromisos_prometidos} />
            <FieldBlock label="Patrones y puntos de mejora" value={report.patrones_y_mejoras} />
          </div>
        </>
      ) : (
        <>
          <FieldBlock label="Resumen de la reunión" value={legacyResumen} />
          <FieldBlock label="¿Hubo objeciones en la llamada?" value={report.hubo_objeciones} />
          <FieldBlock label="¿Qué tipo de perfil tiene el lead?" value={report.tipo_perfil} />
          <FieldBlock label="Ingresos estimados del lead" value={report.ingresos_estimados} />
          <FieldBlock
            label="¿Qué situación puntual está viviendo y qué le gustaría vivir en los próximos 3 meses?"
            value={report.situacion_y_deseo}
          />
        </>
      )}
    </div>
  )
}

export function formatReportDate(iso: string | null | undefined): string {
  return formatIsoDateDdMmYyyy(iso || '') || '—'
}
