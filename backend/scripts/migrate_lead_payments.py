#!/usr/bin/env python3
"""Migración de acumulados lead.pago → lead_payment + vencimientos de seguimiento.

Por defecto es --dry-run (no escribe). En el VPS, tras aplicar el esquema:

  docker compose exec backend python scripts/migrate_lead_payments.py --dry-run
  # 🛑 PARAR — revisar el reporte
  docker compose exec backend python scripts/migrate_lead_payments.py --apply

Seguimiento: fecha <= hoy → cobro (sin duplicar si ya está en lead.pago);
fecha > hoy → lead.proximo_vencimiento. Un segundo --apply no pisa
precio_contrato ni proximo_vencimiento ya cargados.

user_id por defecto: 1 (primer AuthUser).
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.setup_env import bootstrap_environment

bootstrap_environment()

from pony.orm import db_session, flush

from src.db import init_db
from src.db_query_utils import rows_for_user
from src.lead_display_utils import lead_display_nombre
from src.models import Lead, LeadPayment, TeamMember
from src.services.company_config_service import get_timezone_name, today_local
from src.services.payment_service import (
    FALLBACK_MEMBER_NAME,
    recalc_lead_money,
    sum_payments_for_lead,
)
from src.team_member_match import resolve_member_id
from src.services.programs_services import build_program_norm_price_map

DEFAULT_USER_ID = 1


def _norm_name(s: str) -> str:
    return " ".join((s or "").strip().casefold().split())


def _best_fecha(lead: Lead) -> date:
    for dt in (lead.call, lead.agendo, lead.created_at):
        if dt is None:
            continue
        d = dt.replace(tzinfo=None) if getattr(dt, "tzinfo", None) else dt
        return d.date()
    return date.today()


def _totals(uid: int) -> tuple[int, float, float]:
    leads = rows_for_user(Lead, uid)
    n = len(leads)
    pagado = round(sum(float(r.pago or 0) for r in leads), 2)
    adeudado = round(sum(float(r.debe or 0) for r in leads if r.debe is not None), 2)
    return n, pagado, adeudado


def _project_after(
    uid: int,
    leads: list[Lead],
    planned: list[dict],
    implied_contracts: list[dict],
) -> tuple[int, float, float, int]:
    """Simula totales post-apply sin escribir (dry-run).

    El contrato se toma de `precio_contrato` derivado (pago+debe). El catálogo no manda.
    """
    extra_pago: dict[int, float] = {}
    for p in planned:
        lid = int(p["lead_id"])
        extra_pago[lid] = extra_pago.get(lid, 0.0) + float(p["monto"])
    implied = {int(c["lead_id"]): float(c["precio_contrato"]) for c in implied_contracts}
    pagado = 0.0
    adeudado = 0.0
    deudores = 0
    for lead in leads:
        lid = int(lead.id)
        existing = sum_payments_for_lead(uid, lid)
        total = round(existing + extra_pago.get(lid, 0.0), 2)
        pagado += total
        if bool(getattr(lead, "contrato_pendiente", False)):
            continue
        override = implied.get(lid, getattr(lead, "precio_contrato", None))
        if override is None or float(override) <= 0:
            prev_debe = float(lead.debe or 0) if lead.debe is not None else 0.0
            if prev_debe > 0:
                deudores += 1
                adeudado += prev_debe
            continue
        new_debe = round(max(0.0, float(override) - total), 2)
        if new_debe > 0:
            deudores += 1
            adeudado += new_debe
    return len(leads), round(pagado, 2), round(adeudado, 2), deudores


def _ensure_fallback_member(uid: int, *, apply: bool) -> tuple[int | None, bool]:
    members = rows_for_user(TeamMember, uid)
    for m in members:
        if _norm_name(m.nombre) == _norm_name(FALLBACK_MEMBER_NAME):
            return int(m.id), False
    if not apply:
        return None, True
    m = TeamMember(user_id=uid, nombre=FALLBACK_MEMBER_NAME, rol="cash", activo=True)
    flush()
    return int(m.id), True


def _closer_member_id(lead: Lead, members: list[TeamMember]) -> int | None:
    stored = getattr(lead, "closer_member_id", None)
    if stored:
        return int(stored)
    return resolve_member_id(lead.closer, members, preferred_rol="closer")


def _fecha_iso(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()[:10]
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _classify_seguimiento(
    uid: int,
    matched: list[dict],
    leads_by_id: dict[int, Lead],
    planned_lead_ids: set[int],
    members: list[TeamMember],
    fallback_id: int | None,
    today: date,
) -> tuple[list[dict], list[dict], list[dict]]:
    """fecha <= hoy → cobro (si el lead no lo cubre ya); fecha > hoy → vencimiento."""
    to_cobro: list[dict] = []
    to_vencimiento: list[dict] = []
    skipped: list[dict] = []
    for item in matched:
        lid = int(item["lead_id"])
        lead = leads_by_id.get(lid)
        if lead is None:
            skipped.append({**item, "reason": "lead no encontrado"})
            continue
        f = _fecha_iso(item.get("fecha"))
        if f is None:
            skipped.append({**item, "reason": "sin fecha"})
            continue
        base = {
            **item,
            "fecha_iso": f.isoformat(),
            "lead_nombre": lead_display_nombre(lead.nombre, lead.ig),
        }
        if f > today:
            existing_due = getattr(lead, "proximo_vencimiento", None)
            base["already_due"] = existing_due.isoformat() if existing_due else None
            to_vencimiento.append(base)
            continue
        existing = sum_payments_for_lead(uid, lid)
        pago = float(lead.pago or 0)
        if existing > 0 or lid in planned_lead_ids or pago > 0:
            skipped.append({**base, "reason": "ya cubierto por lead.pago / cobros existentes"})
            continue
        mid = _closer_member_id(lead, members)
        via = "closer"
        if mid is None:
            mid = fallback_id
            via = "Sin asignar"
        to_cobro.append({**base, "member_id": mid, "member_via": via})
    return to_cobro, to_vencimiento, skipped


def _match_seguimiento(uid: int) -> tuple[list[dict], list[dict]]:
    from src.models import SeguimientoReport

    leads = rows_for_user(Lead, uid)
    by_name: dict[str, list[Lead]] = {}
    for lead in leads:
        key = _norm_name(lead_display_nombre(lead.nombre, lead.ig))
        if key:
            by_name.setdefault(key, []).append(lead)
    matched: list[dict] = []
    unmatched: list[dict] = []
    for row in rows_for_user(SeguimientoReport, uid):
        key = _norm_name(row.nombre_lead)
        hits = by_name.get(key) or []
        item = {
            "seguimiento_id": int(row.id),
            "nombre_lead": row.nombre_lead,
            "monto": float(row.monto or 0),
            "fecha": row.fecha.isoformat() if row.fecha else "",
            "already_lead_id": int(row.lead_id) if getattr(row, "lead_id", None) else None,
        }
        if len(hits) == 1:
            item["lead_id"] = int(hits[0].id)
            item["lead_nombre"] = lead_display_nombre(hits[0].nombre, hits[0].ig)
            matched.append(item)
        else:
            item["reason"] = "sin match exacto" if not hits else f"{len(hits)} leads con el mismo nombre"
            unmatched.append(item)
    return matched, unmatched


def run(*, uid: int, apply: bool) -> int:
    init_db()
    print(f"user_id={uid}  mode={'APPLY' if apply else 'DRY-RUN'}")
    print()

    with db_session:
        n, pagado, adeudado = _totals(uid)
        print("Totales actuales (lead):")
        print(f"  leads={n}  pagado={pagado:.2f}  adeudado={adeudado:.2f}")
        print("  esperado post-migración: 76 / 15200.00 / 17300.00")
        print()

        members = list(rows_for_user(TeamMember, uid))
        fallback_id, fallback_created = _ensure_fallback_member(uid, apply=apply)
        if fallback_id is None:
            print(f"Miembro fallback '{FALLBACK_MEMBER_NAME}': se CREARÍA (rol=cash)")
        else:
            extra = " (recién creado)" if fallback_created else ""
            print(f"Miembro fallback '{FALLBACK_MEMBER_NAME}': id={fallback_id}{extra}")

        prices = build_program_norm_price_map(uid)
        planned: list[dict] = []
        implied_contracts: list[dict] = []
        skipped_existing = 0

        leads = list(rows_for_user(Lead, uid))
        for lead in leads:
            pago = float(lead.pago or 0)
            if pago <= 0:
                continue
            existing = sum_payments_for_lead(uid, int(lead.id))
            if existing > 0:
                skipped_existing += 1
                continue
            mid = _closer_member_id(lead, members)
            via = "closer"
            if mid is None:
                mid = fallback_id
                via = "Sin asignar"
            planned.append(
                {
                    "lead_id": int(lead.id),
                    "nombre": lead_display_nombre(lead.nombre, lead.ig),
                    "monto": pago,
                    "fecha_cobro": _best_fecha(lead).isoformat(),
                    "member_id": mid,
                    "member_via": via,
                    "closer": (lead.closer or "").strip() or "—",
                }
            )

        skipped_contracts = 0
        for lead in leads:
            pago = float(lead.pago or 0)
            debe = float(lead.debe or 0) if lead.debe is not None else 0.0
            if pago <= 0 and debe <= 0:
                continue
            existing_pc = getattr(lead, "precio_contrato", None)
            if existing_pc is not None:
                skipped_contracts += 1
                continue
            implied = round(pago + debe, 2)
            implied_contracts.append(
                {
                    "lead_id": int(lead.id),
                    "nombre": lead_display_nombre(lead.nombre, lead.ig),
                    "precio_contrato": implied,
                    "pago": pago,
                    "debe": debe,
                    "programa": (lead.programa_ofrecido or "").strip() or "—",
                }
            )

        print()
        print(f"lead_payment a crear: {len(planned)}  (omitidos por cobros ya existentes: {skipped_existing})")
        print(
            f"{'lead_id':>8}  {'monto':>10}  {'fecha':<12}  {'member_id':>9}  {'via':<12}  nombre"
        )
        for p in planned:
            mid_s = "—" if p["member_id"] is None else str(p["member_id"])
            print(
                f"{p['lead_id']:>8}  {p['monto']:>10.2f}  {p['fecha_cobro']:<12}  {mid_s:>9}  {p['member_via']:<12}  {p['nombre']}"
            )

        print()
        print(
            f"precio_contrato = pago + debe para {len(implied_contracts)} leads con montos "
            f"(omitidos porque ya tenían precio_contrato: {skipped_contracts})"
        )
        for c in implied_contracts:
            print(
                f"  lead {c['lead_id']} {c['nombre']}: {c['pago']:.2f}+{c['debe']:.2f} → precio_contrato={c['precio_contrato']:.2f} (prog={c['programa']})"
            )
        n_montos = sum(
            1
            for lead in leads
            if float(lead.pago or 0) > 0 or (lead.debe is not None and float(lead.debe) > 0)
        )
        print(f"  leads con pago>0 o debe>0: {n_montos}  a escribir: {len(implied_contracts)}  ya tenían contrato: {skipped_contracts}")
        if n_montos != len(implied_contracts) + skipped_contracts:
            print("  AVISO: hay leads con montos que no recibirían precio_contrato.")

        matched, unmatched = _match_seguimiento(uid)
        leads_by_id = {int(lead.id): lead for lead in leads}
        planned_lead_ids = {int(p["lead_id"]) for p in planned}
        today = today_local()
        seg_cobros, seg_venc, seg_skip = _classify_seguimiento(
            uid,
            matched,
            leads_by_id,
            planned_lead_ids,
            members,
            fallback_id,
            today,
        )
        planned_plus = planned + [
            {
                "lead_id": c["lead_id"],
                "monto": c["monto"],
            }
            for c in seg_cobros
        ]
        pn, ppag, pade, pdeu = _project_after(uid, leads, planned_plus, implied_contracts)
        print()
        print("Proyección post-apply (sin escribir):")
        print(f"  leads={pn}  pagado={ppag:.2f}  adeudado={pade:.2f}  deudores={pdeu}")
        print("  esperado: 76 / 15200.00 / 17300.00  (deudores 18)")
        if round(ppag, 2) != round(pagado, 2) or round(pade, 2) != round(adeudado, 2):
            print("  AVISO: la proyección mueve totales respecto de los valores actuales.")
        else:
            print("  OK: la proyección conserva pagado y adeudado actuales.")

        print()
        print(f"Seguimiento histórico (hoy={today.isoformat()}, zona {get_timezone_name()}):")
        print(f"  match exacto: {len(matched)}  sin vincular: {len(unmatched)}")
        print(f"  cobros extra a crear: {len(seg_cobros)}  (esperado 0 si ya están en lead.pago)")
        print(f"  vencimientos a escribir: {len(seg_venc)}  (esperado 1: Carlos Zambrano → 2026-09-08)")
        print(f"  omitidos por duplicado / sin fecha: {len(seg_skip)}")
        for c in seg_cobros:
            print(
                f"    COBRO extra id={c['seguimiento_id']} lead {c['lead_id']} {c['lead_nombre']} "
                f"{c['monto']:.2f} {c['fecha_iso']}"
            )
        for v in seg_venc:
            already = f" (ya tenía {v['already_due']}, no se pisa)" if v.get("already_due") else ""
            print(
                f"    VENCE id={v['seguimiento_id']} lead {v['lead_id']} {v['lead_nombre']} "
                f"{v['monto']:.2f} → {v['fecha_iso']}{already}"
            )
        for s in seg_skip:
            print(
                f"    SKIP id={s['seguimiento_id']} '{s.get('nombre_lead')}' "
                f"{s.get('monto', 0):.2f} {s.get('fecha_iso', s.get('fecha', ''))} — {s.get('reason')}"
            )
        for u in unmatched:
            print(f"    id={u['seguimiento_id']} '{u['nombre_lead']}' {u['monto']:.2f} — {u['reason']}")

        if not apply:
            if any(p["member_id"] is None for p in planned):
                print()
                print("OK: en dry-run member_id vacío se resolverá creando 'Sin asignar' en --apply.")
            print()
            print("Dry-run listo. Totales de lead NO se escribieron.")
            print("Si el listado es correcto, correr con --apply.")
            return 0

        if fallback_id is None:
            fallback_id, _ = _ensure_fallback_member(uid, apply=True)
        if fallback_id is None:
            raise RuntimeError("No se pudo crear el miembro Sin asignar.")

        created = 0
        for p in planned:
            mid = p["member_id"] if p["member_id"] is not None else fallback_id
            LeadPayment(
                user_id=uid,
                lead_id=p["lead_id"],
                monto=p["monto"],
                fecha_cobro=date.fromisoformat(p["fecha_cobro"]),
                member_id=mid,
                concepto="Saldo previo",
                metodo="Otro",
                nota="Migrado del acumulado anterior",
                created_at=datetime.utcnow(),
            )
            created += 1
        for c in seg_cobros:
            mid = c["member_id"] if c.get("member_id") is not None else fallback_id
            LeadPayment(
                user_id=uid,
                lead_id=c["lead_id"],
                monto=c["monto"],
                fecha_cobro=date.fromisoformat(c["fecha_iso"]),
                member_id=mid,
                concepto="Saldo",
                metodo="Otro",
                nota="Migrado de seguimiento",
                created_at=datetime.utcnow(),
            )
            created += 1
        flush()

        for c in implied_contracts:
            lead = Lead[c["lead_id"]]
            if getattr(lead, "precio_contrato", None) is not None:
                continue
            lead.precio_contrato = c["precio_contrato"]
            lead.contrato_pendiente = False

        due_written = 0
        due_by_lead: dict[int, date] = {}
        for v in seg_venc:
            if v.get("already_due"):
                continue
            lid = int(v["lead_id"])
            f = date.fromisoformat(v["fecha_iso"])
            prev = due_by_lead.get(lid)
            if prev is None or f < prev:
                due_by_lead[lid] = f
        for lid, f in due_by_lead.items():
            lead = Lead[lid]
            if getattr(lead, "proximo_vencimiento", None) is not None:
                continue
            lead.proximo_vencimiento = f
            due_written += 1

        for item in matched:
            if item.get("already_lead_id"):
                continue
            row_id = item["seguimiento_id"]
            from src.models import SeguimientoReport

            sr = SeguimientoReport[row_id]
            sr.lead_id = item["lead_id"]

        prices = build_program_norm_price_map(uid)
        for lead in rows_for_user(Lead, uid):
            recalc_lead_money(lead, prices)

        n2, pagado2, adeudado2 = _totals(uid)
        null_members = sum(
            1 for p in rows_for_user(LeadPayment, uid) if p.member_id is None
        )
        mismatch = 0
        for lead in rows_for_user(Lead, uid):
            s = sum_payments_for_lead(uid, int(lead.id))
            if round(float(lead.pago or 0), 2) != round(s, 2):
                mismatch += 1

        sin_contrato = sum(
            1
            for lead in rows_for_user(Lead, uid)
            if (float(lead.pago or 0) > 0 or (lead.debe is not None and float(lead.debe) > 0))
            and getattr(lead, "precio_contrato", None) is None
        )
        contrato_vs_suma = 0
        for lead in rows_for_user(Lead, uid):
            pc = getattr(lead, "precio_contrato", None)
            if pc is None:
                continue
            s = round(float(lead.pago or 0) + float(lead.debe or 0), 2)
            if round(float(pc), 2) != s:
                contrato_vs_suma += 1

        n_pay = len(list(rows_for_user(LeadPayment, uid)))
        n_due = sum(
            1
            for lead in rows_for_user(Lead, uid)
            if getattr(lead, "proximo_vencimiento", None) is not None
        )

        print()
        print(f"Aplicado: {created} lead_payment creados.  vencimientos escritos: {due_written}")
        print(f"Totales después: leads={n2}  pagado={pagado2:.2f}  adeudado={adeudado2:.2f}")
        print(f"lead_payment count: {n_pay} (esperado 21)")
        print(f"leads con proximo_vencimiento: {n_due} (esperado ≥ 1)")
        print(f"lead_payment.member_id NULL: {null_members} (esperado 0)")
        print(f"pago vs suma cobros distintos: {mismatch} (esperado 0)")
        print(f"leads con montos sin precio_contrato: {sin_contrato} (esperado 0)")
        print(f"precio_contrato ≠ pago+debe: {contrato_vs_suma} (esperado 0)")
        if round(pagado2, 2) != round(pagado, 2):
            print("AVISO: total pagado cambió respecto del valor previo.")
        if round(adeudado2, 2) != round(adeudado, 2):
            print("AVISO: total adeudado cambió respecto del valor previo.")
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrar acumulados a lead_payment")
    parser.add_argument("--user-id", type=int, default=DEFAULT_USER_ID)
    parser.add_argument("--apply", action="store_true", help="Escribe en la base. Sin esto es dry-run.")
    parser.add_argument("--dry-run", action="store_true", help="Explícito (es el default).")
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run
    raise SystemExit(run(uid=args.user_id, apply=apply))


if __name__ == "__main__":
    main()
