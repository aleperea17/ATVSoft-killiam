export const PAYMENT_CONCEPTOS = ['Seña', 'Saldo', 'Cuota', 'Otro'] as const
export const PAYMENT_METODOS = ['Transferencia', 'Link de pago', 'Efectivo', 'Otro'] as const

export type CobranzasLeadRow = {
  id: string
  nombre: string
  ig: string | null
  telefono: string | null
  programa: string | null
  contrato: number | null
  contrato_fuente: 'catalogo' | 'override' | null
  catalogo_sugerido: number | null
  pagado: number
  debe: number | null
  saldo_a_favor: number
  ultimo_cobro: string | null
  closer: string | null
  closer_member_id: number | null
  contrato_pendiente: boolean
  proximo_vencimiento: string | null
  vencimiento_estado: 'sin_fecha' | 'vencido' | 'proximo' | 'al_dia' | null
}

export type CobranzasView = {
  summary: {
    total_adeudado: number
    total_cobrado: number
    deudores: number
    sin_contrato: number
    vencidos: number
    vencen_semana: number
    leads: number
  }
  con_saldo: CobranzasLeadRow[]
  sin_contrato: CobranzasLeadRow[]
}

export type LeadPayment = {
  id: number
  lead_id: number
  monto: number
  fecha_cobro: string
  member_id: number
  member_nombre: string
  concepto: string
  metodo: string
  comprobante_url: string | null
  nota: string | null
  created_at: string
}

export type TeamMemberOption = { id: number; nombre: string; rol: string }

export type LeadOption = { id: number; nombre: string; ig: string | null; telefono: string | null }
