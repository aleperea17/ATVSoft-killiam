#!/usr/bin/env python3
"""Datos de prueba locales.

Uso (desde backend/):
  python seed.py           # inserta demo (idempotente)
  python seed.py --force   # borra demo previo y recrea
  python seed.py --clear   # elimina solo datos marcados [seed_demo]
"""

from __future__ import annotations

import argparse
import calendar
from datetime import date, datetime, timedelta, timezone

from pony.orm import db_session, flush

from src.db import init_db
from src.models import (
    AuthUser,
    AvatarType,
    CloserReport,
    Lead,
    LeadPayment,
    MasterList,
    OfferedProgram,
    ReelContent,
    SeguimientoReport,
    SetterReport,
    StorySequence,
    StorySlide,
    TeamMember,
    YoutubeContent,
)
from src.services.company_config_service import get_tenant_tz
from src.services.payment_service import recalc_lead_money
from src.setup_env import bootstrap_environment

SEED_TAG = "[seed_demo]"
SEED_IG_PREFIX = "seed_demo_"
SEED_REEL_IG_PREFIX = "seed_demo_reel_"
SEED_YT_PREFIX = "seed_demo_yt_"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _month_anchor() -> tuple[int, int, date, datetime]:
    """Mes operativo actual (zona del tenant) + primer día y datetime base."""
    now_ar = datetime.now(get_tenant_tz())
    y, m = now_ar.year, now_ar.month
    anchor = now_ar.date()
    base_dt = datetime(y, m, anchor.day, 12, 0, 0)
    return y, m, anchor, base_dt


def _day_in_month(y: int, m: int, day: int) -> date:
    max_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(max(day, 1), max_day))


def _resolve_user_id(user_id: int | None) -> int:
    with db_session:
        if user_id is not None:
            return int(user_id)
        users = list(AuthUser.select())
        if not users:
            raise RuntimeError("No hay usuarios. Creá uno con POST /api/auth/register.")
        return int(users[0].id)


def _is_seed_lead(row: Lead) -> bool:
    ig = str(row.ig or "")
    mc = str(row.manychat_contact_id or "")
    notes = str(row.notas or "")
    return ig.startswith(SEED_IG_PREFIX) or mc.startswith(SEED_IG_PREFIX) or SEED_TAG in notes


def _is_seed_team_member(row: TeamMember) -> bool:
    return SEED_TAG in str(row.nombre or "")


def clear_seed(*, user_id: int | None = None) -> dict[str, int]:
    """Elimina todos los registros marcados con [seed_demo] para el usuario."""
    uid = _resolve_user_id(user_id)
    counts: dict[str, int] = {}

    with db_session:
        seed_members = [m for m in list(TeamMember.select()) if int(m.user_id) == uid and _is_seed_team_member(m)]
        seed_member_ids = {int(m.id) for m in seed_members}

        for model, pred, key in (
            (Lead, lambda r: int(r.user_id) == uid and _is_seed_lead(r), "leads"),
            (SetterReport, lambda r: int(r.user_id) == uid and (int(r.member_id) in seed_member_ids or SEED_TAG in str(r.notas or "")), "setter_reports"),
            (CloserReport, lambda r: int(r.user_id) == uid and (int(r.member_id) in seed_member_ids or SEED_TAG in str(r.notas or "")), "closer_reports"),
            (SeguimientoReport, lambda r: int(r.user_id) == uid and int(r.member_id) in seed_member_ids, "seguimiento_reports"),
            (ReelContent, lambda r: int(r.user_id) == uid and str(r.instagram_id or "").startswith(SEED_REEL_IG_PREFIX), "reels"),
            (YoutubeContent, lambda r: int(r.user_id) == uid and str(r.external_id or "").startswith(SEED_YT_PREFIX), "youtube"),
            (OfferedProgram, lambda r: int(r.user_id) == uid and SEED_TAG in str(r.name or ""), "programs"),
            (AvatarType, lambda r: int(r.user_id) == uid and SEED_TAG in str(r.nombre or ""), "avatars"),
        ):
            rows = [r for r in list(model.select()) if pred(r)]
            for row in rows:
                row.delete()
            counts[key] = len(rows)

        story_rows = [
            s for s in list(StorySequence.select())
            if int(s.user_id) == uid and SEED_TAG in str(s.title or "")
        ]
        for seq in story_rows:
            for slide in list(seq.slides):
                slide.delete()
            seq.delete()
        counts["stories"] = len(story_rows)

        for member in seed_members:
            member.delete()
        counts["team_members"] = len(seed_members)

        for ml in [m for m in list(MasterList.select()) if int(m.user_id) == uid]:
            items = ml.items if isinstance(ml.items, list) else []
            filtered = [x for x in items if not str(x).endswith(SEED_TAG)]
            if len(filtered) != len(items):
                ml.items = filtered
                ml.updated_at = _utc_now()
                counts["master_list_items"] = counts.get("master_list_items", 0) + (len(items) - len(filtered))

    print(f"Seed clear: {counts}")
    return counts


def _upsert_master_items(uid: int, category: str, values: list[str]) -> None:
    rows = [m for m in list(MasterList.select()) if int(m.user_id) == uid and m.category == category]
    existing: list[str] = []
    for row in rows:
        if isinstance(row.items, list):
            existing.extend(str(x) for x in row.items)
    merged: list[str] = []
    seen: set[str] = set()
    for v in existing + values:
        key = v.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(v.strip())
    if rows:
        rows[0].items = merged
        rows[0].updated_at = _utc_now()
        for extra in rows[1:]:
            extra.delete()
    else:
        MasterList(user_id=uid, category=category, items=merged, updated_at=_utc_now())


def seed_all(*, user_id: int | None = None, force: bool = False) -> None:
    if force:
        clear_seed(user_id=user_id)

    uid = _resolve_user_id(user_id)
    y, m, anchor, base = _month_anchor()

    with db_session:
        existing_leads = [r for r in list(Lead.select()) if int(r.user_id) == uid and _is_seed_lead(r)]
        if existing_leads and not force:
            print(f"Seed: ya hay {len(existing_leads)} leads demo. Usá --force para recrear.")
            return

        # ── Equipo ──
        setter = TeamMember(user_id=uid, nombre=f"Maria Setter {SEED_TAG}", rol="setter", activo=True)
        closer = TeamMember(user_id=uid, nombre=f"Carlos Closer {SEED_TAG}", rol="closer", activo=True)
        flush()
        setter_id = int(setter.id)
        closer_id = int(closer.id)

        AvatarType(user_id=uid, nombre=f"Emprendedor {SEED_TAG}", color="#3B82F6", activo=True, sort_order=0)
        AvatarType(user_id=uid, nombre=f"Fitness {SEED_TAG}", color="#22C55E", activo=True, sort_order=1)

        _upsert_master_items(uid, "dolores", [f"Falta de tiempo {SEED_TAG}", f"Miedo a invertir {SEED_TAG}", f"No ve resultados {SEED_TAG}"])
        _upsert_master_items(uid, "angulos", [f"Antes/después {SEED_TAG}", f"Prueba social {SEED_TAG}", f"Urgencia {SEED_TAG}"])

        # ── Reels (mes actual) ──
        reel_specs = [
            {
                "instagram_id": f"{SEED_REEL_IG_PREFIX}01",
                "title": "Reel transformación 30 días",
                "keyword": "info",
                "dolor": f"Falta de tiempo {SEED_TAG}",
                "angulos": f"Antes/después {SEED_TAG}",
                "cta": True,
                "chats_manuales": 4,
                "plays": 12500,
                "reach": 9800,
                "likes": 420,
                "comentarios": 38,
                "day_offset": 1,
            },
            {
                "instagram_id": f"{SEED_REEL_IG_PREFIX}02",
                "title": "Reel objeciones comunes",
                "keyword": "coach",
                "dolor": f"Miedo a invertir {SEED_TAG}",
                "angulos": f"Prueba social {SEED_TAG}",
                "cta": True,
                "chats_manuales": 3,
                "plays": 8700,
                "reach": 7100,
                "likes": 290,
                "comentarios": 21,
                "day_offset": 2,
            },
            {
                "instagram_id": f"{SEED_REEL_IG_PREFIX}03",
                "title": "Reel tips rápidos",
                "keyword": "tips",
                "dolor": f"No ve resultados {SEED_TAG}",
                "angulos": f"Urgencia {SEED_TAG}",
                "cta": False,
                "chats_manuales": 2,
                "plays": 5400,
                "reach": 4300,
                "likes": 180,
                "comentarios": 9,
                "day_offset": 3,
            },
        ]
        reel_rows: list[ReelContent] = []
        for spec in reel_specs:
            pub_day = _day_in_month(y, m, anchor.day - spec["day_offset"])
            pub = datetime(pub_day.year, pub_day.month, pub_day.day, 12, 0, 0)
            row = ReelContent(
                user_id=uid,
                instagram_id=spec["instagram_id"],
                title=spec["title"],
                thumbnail_url="https://picsum.photos/seed/reel/400/600",
                permalink=f"https://instagram.com/reel/{spec['instagram_id']}",
                fecha_publicacion=pub,
                plays=spec["plays"],
                reach=spec["reach"],
                likes=spec["likes"],
                comentarios=spec["comentarios"],
                shares=12,
                guardados=45,
                keyword=spec["keyword"],
                cash=0,
                chats_manuales=spec["chats_manuales"],
                dolor=spec["dolor"],
                angulos=spec["angulos"],
                cta=spec["cta"],
            )
            reel_rows.append(row)
        flush()

        # ── Historias (mes actual) ──
        story_specs = [
            {
                "title": f"Secuencia lanzamiento {SEED_TAG}",
                "dolor": f"Falta de tiempo {SEED_TAG}",
                "angulo": f"Urgencia {SEED_TAG}",
                "cta": True,
                "cash": 400.0,
                "chats": 6,
                "story_day": 2,
                "slides": [
                    (1, 1200, 980, 14, 8),
                    (2, 950, 810, 11, 6),
                    (3, 700, 620, 9, 4),
                ],
            },
            {
                "title": f"Secuencia testimonios {SEED_TAG}",
                "dolor": f"Miedo a invertir {SEED_TAG}",
                "angulo": f"Prueba social {SEED_TAG}",
                "cta": True,
                "cash": 250.0,
                "chats": 4,
                "story_day": 5,
                "slides": [
                    (1, 880, 760, 10, 5),
                    (2, 640, 540, 7, 3),
                ],
            },
            {
                "title": f"Secuencia FAQ {SEED_TAG}",
                "dolor": f"No ve resultados {SEED_TAG}",
                "angulo": f"Antes/después {SEED_TAG}",
                "cta": False,
                "cash": 0.0,
                "chats": 2,
                "story_day": 8,
                "slides": [
                    (1, 520, 450, 5, 2),
                ],
            },
        ]
        story_rows: list[StorySequence] = []
        for spec in story_specs:
            seq_date = _day_in_month(y, m, spec["story_day"])
            seq = StorySequence(
                user_id=uid,
                sequence_date=seq_date,
                title=spec["title"],
                dolor=spec["dolor"],
                angulo=spec["angulo"],
                cta=spec["cta"],
                cash=spec["cash"],
                chats=spec["chats"],
            )
            for order, views, reach, replies, shares in spec["slides"]:
                StorySlide(
                    sequence=seq,
                    order_index=order,
                    instagram_media_id=f"seed_demo_story_{spec['title'][:12]}_{order}",
                    image_url="https://picsum.photos/seed/story/400/700",
                    views=views,
                    reach=reach,
                    replies=replies,
                    shares=shares,
                    navigation=20,
                    profile_visits=15,
                    synced_at=_utc_now(),
                )
            story_rows.append(seq)
        flush()

        # ── YouTube ──
        yt_rows: list[YoutubeContent] = []
        for i, (title, chats, pub_day) in enumerate(
            [
                (f"Video embudo completo {SEED_TAG}", 5, 4),
                (f"Video casos de éxito {SEED_TAG}", 3, 9),
            ],
            start=1,
        ):
            pub_d = _day_in_month(y, m, pub_day)
            pub = datetime(pub_d.year, pub_d.month, pub_d.day, 12, 0, 0)
            row = YoutubeContent(
                user_id=uid,
                external_id=f"{SEED_YT_PREFIX}{i:02d}",
                title=title,
                description="Contenido de prueba para dashboard.",
                thumbnail_url="https://picsum.photos/seed/yt/640/360",
                published_at=pub,
                url=f"https://youtube.com/watch?v={SEED_YT_PREFIX}{i:02d}",
                duration_seconds=720 + i * 60,
                views=3000 + i * 500,
                likes=120 + i * 20,
                comments_count=15 + i,
                classification={"tema": "ventas", "cta": True},
                cash=float(200 * i),
                chats=chats,
                notes=SEED_TAG,
            )
            yt_rows.append(row)
        flush()

        # ── Leads (mes actual, varios orígenes). Catálogo de programas vacío a propósito. ──
        prog_a = f"Programa A {SEED_TAG}"
        prog_b = f"Programa B {SEED_TAG}"
        prog_c = f"Programa C {SEED_TAG}"
        pending_payments: list[tuple[Lead, float]] = []

        def _lead(
            *,
            ig: str,
            nombre: str,
            keyword: str,
            origen: str,
            via: str,
            punto_agenda: str,
            status: str,
            day_offset: int,
            agendo_day: int | None = None,
            call_day: int | None = None,
            pago: float = 0.0,
            ingresos: float = 0.0,
            programa: str = "",
            setter: str = "",
            closer: str = "",
            content_url: str = "",
        ) -> Lead:
            bot_day = _day_in_month(y, m, day_offset)
            bot_at = datetime(bot_day.year, bot_day.month, bot_day.day, 10, 0, 0)

            def _at(day: int, hour: int) -> datetime:
                d = _day_in_month(y, m, day)
                return datetime(d.year, d.month, d.day, hour, 0, 0)

            agendo_dt = _at(agendo_day, 14) if agendo_day is not None else None
            call_dt = _at(call_day, 16) if call_day is not None else None
            row = Lead(
                user_id=uid,
                nombre=nombre,
                ig=ig,
                keyword=keyword,
                origen=origen,
                via=via,
                punto_agenda=punto_agenda,
                status=status,
                estado=status,
                respondio_auto=True,
                fecha_bot=bot_at,
                created_at=bot_at,
                primer_contacto=bot_at - timedelta(hours=1),
                agendo=agendo_dt,
                agendo_en="Chat" if agendo_dt else "",
                call=call_dt,
                ingresos_lead=ingresos or pago,
                programa_ofrecido=programa,
                setter=setter or f"Maria Setter {SEED_TAG}",
                setter_member_id=setter_id,
                closer=closer or (f"Carlos Closer {SEED_TAG}" if status == "Cerrado" else ""),
                closer_member_id=closer_id if status == "Cerrado" else None,
                content_url=content_url,
                manychat_contact_id=f"{SEED_IG_PREFIX}{ig}",
                notas=SEED_TAG,
                dolores_setting=f"Falta de tiempo {SEED_TAG}",
            )
            if pago > 0:
                pending_payments.append((row, pago))
            return row

        reel1, reel2, reel3 = reel_rows
        story1, story2 = story_rows[0], story_rows[1]
        yt1 = yt_rows[0]

        _lead(
            ig=f"{SEED_IG_PREFIX}ana_reel",
            nombre="Ana Reel (seed)",
            keyword="info",
            origen="Reels",
            via=str(reel1.id),
            punto_agenda=str(reel1.id),
            status="Cerrado",
            day_offset=1,
            agendo_day=2,
            call_day=4,
            pago=800.0,
            ingresos=800.0,
            programa=prog_a,
            content_url=f"https://instagram.com/reel/{reel1.instagram_id}",
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}lucas_reel",
            nombre="Lucas Reel (seed)",
            keyword="coach",
            origen="Reels",
            via=str(reel2.id),
            punto_agenda=str(reel2.id),
            status="Agendado",
            day_offset=3,
            agendo_day=4,
            call_day=6,
            content_url=f"https://instagram.com/reel/{reel2.instagram_id}",
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}maria_reel",
            nombre="María Reel (seed)",
            keyword="tips",
            origen="Reels",
            via=str(reel3.id),
            punto_agenda=str(reel3.id),
            status="En conversación",
            day_offset=5,
            content_url=f"https://instagram.com/reel/{reel3.instagram_id}",
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}sofia_story",
            nombre="Sofía Historia (seed)",
            keyword="info",
            origen="Historias",
            via=f"story:{story1.id}",
            punto_agenda=f"story:{story1.id}",
            status="Cerrado",
            day_offset=2,
            agendo_day=3,
            call_day=5,
            pago=1200.0,
            ingresos=1200.0,
            programa=prog_b,
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}juan_story",
            nombre="Juan Historia (seed)",
            keyword="coach",
            origen="Historias",
            via=f"story:{story2.id}",
            punto_agenda=f"story:{story2.id}",
            status="Agendado",
            day_offset=4,
            agendo_day=6,
            content_url="https://instagram.com/stories/seed",
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}vale_bio",
            nombre="Valentina BIO (seed)",
            keyword="info",
            origen="Perfil",
            via="bio",
            punto_agenda="bio",
            status="En conversación",
            day_offset=6,
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}pedro_yt",
            nombre="Pedro YouTube (seed)",
            keyword="youtube",
            origen="YouTube",
            via=f"youtube:{yt1.id}",
            punto_agenda=f"youtube:{yt1.id}",
            status="Cerrado",
            day_offset=3,
            agendo_day=5,
            call_day=7,
            pago=2000.0,
            ingresos=2000.0,
            programa=prog_c,
            content_url=yt1.url or "",
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}no_show",
            nombre="Cliente No Show (seed)",
            keyword="info",
            origen="Reels",
            via=str(reel1.id),
            punto_agenda=str(reel1.id),
            status="No show",
            day_offset=4,
            agendo_day=5,
            call_day=6,
            content_url=f"https://instagram.com/reel/{reel1.instagram_id}",
        )
        _lead(
            ig=f"{SEED_IG_PREFIX}nuevo",
            nombre="Lead Nuevo (seed)",
            keyword="info",
            origen="Perfil",
            via="bio",
            punto_agenda="bio",
            status="Nuevo",
            day_offset=7,
        )

        flush()
        for lead_row, monto in pending_payments:
            cobro = (
                lead_row.call.date()
                if lead_row.call
                else lead_row.agendo.date()
                if lead_row.agendo
                else date.today()
            )
            LeadPayment(
                user_id=uid,
                lead_id=int(lead_row.id),
                monto=monto,
                fecha_cobro=cobro,
                member_id=closer_id,
                concepto="Seña",
                metodo="Transferencia",
                nota=SEED_TAG,
            )
            lead_row.precio_contrato = monto
            lead_row.contrato_pendiente = False
            flush()
            recalc_lead_money(lead_row)

        # ── Reportes setter (distribuidos en el mes) ──
        setter_days = [
            (1, 8, 2, 5),
            (5, 12, 4, 8),
            (10, 10, 3, 7),
            (15, 14, 5, 9),
            (20, 9, 2, 6),
            (25, 11, 3, 7),
        ]
        for day, conv, ag, links in setter_days:
            try:
                f = date(y, m, day)
            except ValueError:
                continue
            SetterReport(
                user_id=uid,
                member_id=setter_id,
                fecha=f,
                conversaciones=conv,
                agendas=ag,
                links_enviados=links,
                notas=f"Reporte setter demo {SEED_TAG}",
                sentimiento_trafico="Positivo",
                avatar_tipo_agendas=f"Emprendedor {SEED_TAG}",
                insights_marketing="Tráfico estable en reels e historias.",
            )

        # ── Reportes closer (ventas) ──
        closer_days = [
            (3, 2, 1, 0, 800.0),
            (8, 3, 2, 1, 1200.0),
            (12, 2, 2, 1, 0.0),
            (18, 4, 3, 2, 2000.0),
            (22, 3, 2, 1, 800.0),
            (27, 2, 1, 0, 0.0),
        ]
        for day, llamadas, shows, cierres, ingreso in closer_days:
            try:
                f = date(y, m, day)
            except ValueError:
                continue
            CloserReport(
                user_id=uid,
                member_id=closer_id,
                fecha=f,
                reporte_tipo="ventas",
                llamadas_agendadas=llamadas,
                shows=shows,
                cierres=cierres,
                calificados=shows,
                descalificados=max(0, llamadas - shows),
                ingreso=ingreso,
                notas=f"Reporte closer demo {SEED_TAG}",
                nombre_lead=f"Lead demo día {day}",
                estado_final_llamada="Cerrado" if cierres else "Seguimiento",
                perfil_lead=f"Emprendedor {SEED_TAG}",
                objecion_miedo=f"Miedo a invertir {SEED_TAG}",
                razon_compra_final="Confianza en el método",
            )

        # ── Seguimiento / cobranzas ──
        for day, monto, nombre in (
            (14, 350.0, "Ana Reel (seed)"),
            (21, 500.0, "Sofía Historia (seed)"),
        ):
            try:
                f = date(y, m, day)
            except ValueError:
                continue
            SeguimientoReport(
                user_id=uid,
                member_id=closer_id,
                fecha=f,
                nombre_lead=nombre,
                monto=monto,
            )

    print(
        f"Seed OK — user_id={uid}, mes={y}-{m:02d}: "
        f"3 reels, 3 historias, 2 videos YT, 9 leads, equipo, reportes. "
        f"Para revertir: python seed.py --clear"
    )


def seed_bio_leads(*, user_id: int | None = None, force: bool = False) -> int:
    """Compat: delega en seed_all (incluye leads BIO)."""
    seed_all(user_id=user_id, force=force)
    with db_session:
        uid = _resolve_user_id(user_id)
        return len([r for r in list(Lead.select()) if int(r.user_id) == uid and _is_seed_lead(r)])


def main() -> None:
    parser = argparse.ArgumentParser(description="Datos de prueba ATV Soft")
    parser.add_argument("--force", action="store_true", help="Borra demo previo y recrea")
    parser.add_argument("--clear", action="store_true", help="Elimina solo datos [seed_demo]")
    parser.add_argument("--user-id", type=int, default=None, help="ID de usuario (default: primero en BD)")
    args = parser.parse_args()

    bootstrap_environment()
    init_db()
    if args.clear:
        clear_seed(user_id=args.user_id)
        return
    seed_all(user_id=args.user_id, force=args.force)


if __name__ == "__main__":
    main()
