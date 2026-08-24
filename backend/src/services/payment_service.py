"""Cobranzas v1: cobros individuales y recálculo de pago/debe.

Montos en USD. `offered_program.price_usd` es USD.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
import unicodedata

from fastapi import HTTPException
from pony.orm import ObjectNotFound, db_session

from src.db_query_utils import rows_for_user
from src.lead_display_utils import lead_display_nombre
from src.models import Lead, LeadPayment, TeamMember
from src.schemas import (
    PAYMENT_CONCEPTOS,
    PAYMENT_METODOS,
    CobranzasLeadOption,
    CobranzasLeadRow,
    CobranzasSummary,
    CobranzasViewResponse,
    ContratoPatchRequest,
    LeadPaymentCreateRequest,
    LeadPaymentOut,
    LeadPaymentPatchRequest,
    VencimientoPatchRequest,
)
from src.services.company_config_service import today_local
from src.services.programs_services import (
    build_program_norm_price_map,
    program_price_usd_for_prog_raw,
)
from src.team_member_match import display_role_name, resolve_member_id

FALLBACK_MEMBER_NAME = "Sin asignar"

# En "Sin contrato": Cerrado / Seña (o ya cobrado) sin precio_contrato.
# Pendiente / Agendado / No show / Descalificado no ensucian la vista.
_SIN_CONTRATO_STATUS_KEYS = frozenset({"cerrado", "sena"})


def _status_lookup_key(raw: str | None) -> str:
    t = unicodedata.normalize("NFD", (raw or "").strip().casefold())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def lead_needs_contract_definition(lead: Lead, pagado: float = 0) -> bool:
    """True si el lead debe listarse en Cobranzas → Sin contrato."""
    if bool(getattr(lead, "contrato_pendiente", False)):
        return True
    override = getattr(lead, "precio_contrato", None)
    if override is not None and float(override) > 0:
        return False
    if float(pagado or 0) > 0:
        return True
    status_key = _status_lookup_key(getattr(lead, "status", None) or getattr(lead, "estado", None))
    return status_key in _SIN_CONTRATO_STATUS_KEYS


def vencimiento_estado(due: date | None, today: date | None = None) -> str:
    if due is None:
        return "sin_fecha"
    day = today or today_local()
    if due < day:
        return "vencido"
    if due <= day + timedelta(days=7):
        return "proximo"
    return "al_dia"


def _payments_for_lead(uid: int, lead_id: int) -> list[LeadPayment]:
    tbl = LeadPayment._table_ or "lead_payment"
    sql = f"SELECT * FROM {tbl} WHERE user_id = $uid AND lead_id = $lead_id"
    try:
        return list(LeadPayment.select_by_sql(sql, {"uid": uid, "lead_id": lead_id}))
    except (NameError, TypeError, ValueError):
        return [p for p in rows_for_user(LeadPayment, uid) if int(p.lead_id) == lead_id]


def sum_payments_for_lead(uid: int, lead_id: int) -> float:
    rows = _payments_for_lead(uid, lead_id)
    return float(sum(float(p.monto or 0) for p in rows))


def catalog_suggestion(lead: Lead, norm_prices: dict[str, float]) -> float | None:
    """Precio de catálogo (USD). Solo sugerencia al crear/definir contrato; no manda sobre la deuda."""
    catalog = program_price_usd_for_prog_raw(norm_prices, lead.programa_ofrecido)
    if catalog is not None and catalog > 0:
        return float(catalog)
    return None


def resolve_effective_contract(
    lead: Lead,
    norm_prices: dict[str, float] | None = None,
) -> tuple[float | None, str | None]:
    """Precio que manda la deuda: solo `precio_contrato` cargado."""
    override = getattr(lead, "precio_contrato", None)
    if override is not None and float(override) > 0:
        return float(override), "override"
    return None, None


def recalc_lead_money(
    lead: Lead,
    norm_prices: dict[str, float] | None = None,
) -> None:
    """Actualiza pago/debe/saldo_a_favor. Debe llamarse dentro de `db_session`.

    `pago` = suma de cobros.
    Si `contrato_pendiente`: `debe` = NULL.
    Si hay `precio_contrato`: `debe` = max(0, precio − pago), `saldo_a_favor` = max(0, pago − precio).
    El catálogo no interviene en el recálculo.
    """
    uid = int(lead.user_id)
    lid = int(lead.id)
    total = round(sum_payments_for_lead(uid, lid), 2)
    lead.pago = total

    if bool(getattr(lead, "contrato_pendiente", False)):
        lead.debe = None
        lead.saldo_a_favor = 0.0
        return

    effective, _src = resolve_effective_contract(lead)
    if effective is None:
        lead.saldo_a_favor = 0.0
        return

    lead.debe = round(max(0.0, float(effective) - total), 2)
    lead.saldo_a_favor = round(max(0.0, total - float(effective)), 2)


def _get_lead_owned(uid: int, lead_id: int) -> Lead:
    try:
        lead = Lead[lead_id]
    except ObjectNotFound as e:
        raise HTTPException(status_code=404, detail="Lead no encontrado.") from e
    if int(lead.user_id) != uid:
        raise HTTPException(status_code=404, detail="Lead no encontrado.")
    return lead


def _get_member_owned(uid: int, member_id: int) -> TeamMember:
    for m in rows_for_user(TeamMember, uid):
        if int(m.id) == member_id:
            return m
    raise HTTPException(status_code=400, detail="Miembro no encontrado.")


def _validate_concepto_metodo(concepto: str, metodo: str) -> tuple[str, str]:
    c = (concepto or "").strip()
    m = (metodo or "").strip()
    if c not in PAYMENT_CONCEPTOS:
        raise HTTPException(status_code=400, detail="Concepto inválido.")
    if m not in PAYMENT_METODOS:
        raise HTTPException(status_code=400, detail="Método inválido.")
    return c, m


def _member_nombre_map(uid: int) -> dict[int, str]:
    return {int(m.id): str(m.nombre or "").strip() for m in rows_for_user(TeamMember, uid)}


def _payment_to_out(row: LeadPayment, names: dict[int, str]) -> LeadPaymentOut:
    mid = int(row.member_id)
    return LeadPaymentOut(
        id=int(row.id),
        lead_id=int(row.lead_id),
        monto=float(row.monto),
        fecha_cobro=row.fecha_cobro.isoformat(),
        member_id=mid,
        member_nombre=names.get(mid, ""),
        concepto=(row.concepto or "").strip(),
        metodo=(row.metodo or "").strip(),
        comprobante_url=(row.comprobante_url or "").strip() or None,
        nota=(row.nota or "").strip() or None,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


def create_payment(uid: int, body: LeadPaymentCreateRequest) -> LeadPaymentOut:
    concepto, metodo = _validate_concepto_metodo(body.concepto, body.metodo)
    with db_session:
        lead = _get_lead_owned(uid, body.lead_id)
        member = _get_member_owned(uid, body.member_id)
        row = LeadPayment(
            user_id=uid,
            lead_id=int(lead.id),
            monto=float(body.monto),
            fecha_cobro=body.fecha_cobro,
            member_id=int(member.id),
            concepto=concepto,
            metodo=metodo,
            comprobante_url=(body.comprobante_url or "").strip(),
            nota=(body.nota or "").strip(),
            created_at=datetime.utcnow(),
        )
        if body.precio_contrato is not None:
            lead.precio_contrato = float(body.precio_contrato)
            lead.contrato_pendiente = False
        if body.proximo_vencimiento is not None:
            lead.proximo_vencimiento = body.proximo_vencimiento
        row.flush()
        recalc_lead_money(lead)
        names = _member_nombre_map(uid)
        return _payment_to_out(row, names)


def patch_payment(uid: int, payment_id: int, body: LeadPaymentPatchRequest) -> LeadPaymentOut:
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")
    with db_session:
        try:
            row = LeadPayment[payment_id]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Cobro no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Cobro no encontrado.")
        if "monto" in data and data["monto"] is not None:
            row.monto = float(data["monto"])
        if "fecha_cobro" in data and data["fecha_cobro"] is not None:
            row.fecha_cobro = data["fecha_cobro"]
        if "member_id" in data and data["member_id"] is not None:
            member = _get_member_owned(uid, int(data["member_id"]))
            row.member_id = int(member.id)
        if "concepto" in data and data["concepto"] is not None:
            c, _ = _validate_concepto_metodo(str(data["concepto"]), row.metodo or "Otro")
            row.concepto = c
        if "metodo" in data and data["metodo"] is not None:
            _, m = _validate_concepto_metodo(row.concepto or "Otro", str(data["metodo"]))
            row.metodo = m
        if "comprobante_url" in data:
            row.comprobante_url = (data["comprobante_url"] or "").strip()
        if "nota" in data:
            row.nota = (data["nota"] or "").strip()
        lead = _get_lead_owned(uid, int(row.lead_id))
        recalc_lead_money(lead)
        names = _member_nombre_map(uid)
        return _payment_to_out(row, names)


def delete_payment(uid: int, payment_id: int) -> dict[str, str]:
    with db_session:
        try:
            row = LeadPayment[payment_id]
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Cobro no encontrado.") from e
        if int(row.user_id) != uid:
            raise HTTPException(status_code=404, detail="Cobro no encontrado.")
        lead_id = int(row.lead_id)
        row.delete()
        lead = _get_lead_owned(uid, lead_id)
        recalc_lead_money(lead)
    return {"status": "ok", "id": str(payment_id)}


def list_payments_for_lead(uid: int, lead_id: int) -> list[LeadPaymentOut]:
    with db_session:
        _get_lead_owned(uid, lead_id)
        names = _member_nombre_map(uid)
        rows = _payments_for_lead(uid, lead_id)
        rows.sort(key=lambda r: (r.fecha_cobro, r.id), reverse=True)
        return [_payment_to_out(r, names) for r in rows]


def list_payments_for_month(uid: int, month: str) -> list[LeadPaymentOut]:
    parts = (month or "").strip().split("-", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="month inválido (usar YYYY-MM).")
    try:
        year, mon = int(parts[0]), int(parts[1])
    except ValueError as e:
        raise HTTPException(status_code=400, detail="month inválido (usar YYYY-MM).") from e
    if mon < 1 or mon > 12:
        raise HTTPException(status_code=400, detail="month inválido (usar YYYY-MM).")
    with db_session:
        names = _member_nombre_map(uid)
        rows = [
            p
            for p in rows_for_user(LeadPayment, uid)
            if p.fecha_cobro is not None and p.fecha_cobro.year == year and p.fecha_cobro.month == mon
        ]
        rows.sort(key=lambda r: (r.fecha_cobro, r.id), reverse=True)
        return [_payment_to_out(r, names) for r in rows]


def patch_contrato(uid: int, lead_id: int, body: ContratoPatchRequest) -> CobranzasLeadRow:
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")
    with db_session:
        lead = _get_lead_owned(uid, lead_id)
        if "contrato_pendiente" in data and data["contrato_pendiente"] is not None:
            lead.contrato_pendiente = bool(data["contrato_pendiente"])
        if "precio_contrato" in data:
            val = data["precio_contrato"]
            if val is None:
                lead.precio_contrato = None
            else:
                lead.precio_contrato = float(val)
                lead.contrato_pendiente = False
        prices = build_program_norm_price_map(uid)
        recalc_lead_money(lead, prices)
        names = _member_nombre_map(uid)
        return _lead_to_view_row(lead, prices, names)


def patch_vencimiento(uid: int, lead_id: int, body: VencimientoPatchRequest) -> CobranzasLeadRow:
    data = body.model_dump(exclude_unset=True)
    if "proximo_vencimiento" not in data:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar.")
    with db_session:
        lead = _get_lead_owned(uid, lead_id)
        lead.proximo_vencimiento = data["proximo_vencimiento"]
        prices = build_program_norm_price_map(uid)
        names = _member_nombre_map(uid)
        return _lead_to_view_row(lead, prices, names)


def _last_payment_date(uid: int, lead_id: int) -> date | None:
    rows = _payments_for_lead(uid, lead_id)
    if not rows:
        return None
    return max(r.fecha_cobro for r in rows if r.fecha_cobro)


def _closer_member_id(lead: Lead, members: list[TeamMember]) -> int | None:
    stored = getattr(lead, "closer_member_id", None)
    if stored:
        return int(stored)
    resolved = resolve_member_id(lead.closer, members, preferred_rol="closer")
    if resolved:
        lead.closer_member_id = resolved
    return resolved


def _lead_to_view_row(
    lead: Lead,
    prices: dict[str, float],
    names: dict[int, str],
    members: list[TeamMember] | None = None,
    today: date | None = None,
) -> CobranzasLeadRow:
    uid = int(lead.user_id)
    lid = int(lead.id)
    pending = bool(getattr(lead, "contrato_pendiente", False))
    effective, source = resolve_effective_contract(lead)
    if pending:
        effective, source = None, None
    closer_mid = int(lead.closer_member_id) if getattr(lead, "closer_member_id", None) else None
    if members is not None:
        closer_mid = _closer_member_id(lead, members)
    last = _last_payment_date(uid, lid)
    debe_val = lead.debe
    sugerido = catalog_suggestion(lead, prices)
    due = getattr(lead, "proximo_vencimiento", None)
    day = today or today_local()
    return CobranzasLeadRow(
        id=str(lid),
        nombre=lead_display_nombre(lead.nombre, lead.ig) or "Sin nombre",
        ig=(lead.ig or "").strip() or None,
        telefono=(lead.telefono or "").strip() or None,
        programa=(lead.programa_ofrecido or "").strip() or None,
        contrato=effective,
        contrato_fuente=source,
        catalogo_sugerido=sugerido,
        pagado=float(lead.pago or 0),
        debe=None if debe_val is None else float(debe_val),
        saldo_a_favor=float(getattr(lead, "saldo_a_favor", 0) or 0),
        ultimo_cobro=last.isoformat() if last else None,
        closer=display_role_name(lead.closer, closer_mid, names),
        closer_member_id=closer_mid,
        contrato_pendiente=pending,
        proximo_vencimiento=due.isoformat() if due else None,
        vencimiento_estado=vencimiento_estado(due, day),
    )


def _con_saldo_sort_key(row: CobranzasLeadRow) -> tuple[int, date, float]:
    if not row.proximo_vencimiento:
        return (1, date.max, -float(row.debe or 0))
    return (0, date.fromisoformat(row.proximo_vencimiento), -float(row.debe or 0))


def get_cobranzas_view(uid: int) -> CobranzasViewResponse:
    with db_session:
        prices = build_program_norm_price_map(uid)
        members = rows_for_user(TeamMember, uid)
        names = {int(m.id): str(m.nombre or "").strip() for m in members}
        leads = rows_for_user(Lead, uid)
        today = today_local()
        con_saldo: list[CobranzasLeadRow] = []
        sin_contrato: list[CobranzasLeadRow] = []
        total_adeudado = 0.0
        total_cobrado = 0.0
        for lead in leads:
            row = _lead_to_view_row(lead, prices, names, members, today)
            total_cobrado += float(row.pagado or 0)
            if lead_needs_contract_definition(lead, row.pagado):
                sin_contrato.append(row)
                continue
            if row.debe is not None and row.debe > 0:
                con_saldo.append(row)
                total_adeudado += row.debe
        con_saldo.sort(key=_con_saldo_sort_key)
        sin_contrato.sort(key=lambda r: r.nombre.casefold())
        vencidos = sum(1 for r in con_saldo if r.vencimiento_estado == "vencido")
        vencen_semana = sum(1 for r in con_saldo if r.vencimiento_estado == "proximo")
        return CobranzasViewResponse(
            summary=CobranzasSummary(
                total_adeudado=round(total_adeudado, 2),
                total_cobrado=round(total_cobrado, 2),
                deudores=len(con_saldo),
                sin_contrato=len(sin_contrato),
                vencidos=vencidos,
                vencen_semana=vencen_semana,
                leads=len(leads),
            ),
            con_saldo=con_saldo,
            sin_contrato=sin_contrato,
        )


def search_lead_options(uid: int, q: str = "") -> list[CobranzasLeadOption]:
    needle = (q or "").strip().casefold()
    with db_session:
        out: list[CobranzasLeadOption] = []
        for lead in rows_for_user(Lead, uid):
            nombre = lead_display_nombre(lead.nombre, lead.ig) or "Sin nombre"
            ig = (lead.ig or "").strip()
            if needle:
                blob = f"{nombre} {ig} {lead.telefono or ''}".casefold()
                if needle not in blob:
                    continue
            out.append(
                CobranzasLeadOption(
                    id=int(lead.id),
                    nombre=nombre,
                    ig=ig or None,
                    telefono=(lead.telefono or "").strip() or None,
                )
            )
        out.sort(key=lambda r: r.nombre.casefold())
        return out[:80]


def delete_payments_for_lead(uid: int, lead_id: int) -> None:
    """Dentro de db_session. Usado al borrar un lead."""
    for row in _payments_for_lead(uid, lead_id):
        row.delete()
