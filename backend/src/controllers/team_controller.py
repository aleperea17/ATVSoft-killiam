import calendar
import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import db_session
from pydantic import BaseModel, Field
from starlette.responses import Response

from src.db_query_utils import filter_date_range, rows_for_user
from src.models import CloserReport, SeguimientoReport, SetterReport, TeamMember
from src.team_member_match import backfill_lead_member_ids_in_session, unmatched_people_for_user
from src.team_reports_pdf import build_team_reports_pdf, fecha_iso_a_dd_mm_yyyy

router = APIRouter(prefix="/api/team", tags=["team"], redirect_slashes=False)

DEFAULT_COMMISSION_PCT = 5.0
VALID_ROLES = frozenset({"setter", "closer", "cash"})
SEGUIMIENTO_MEMBER_ROLES = frozenset({"setter", "closer", "cash"})
CLOSER_REPORTE_TIPOS = frozenset({"ventas", "marketing"})
CLOSER_ESTADOS_FINAL = frozenset(
    {"Re-agendado", "Cerrado", "No cerrado", "Señado", "Descalificado"}
)
CLOSER_PERFILES_LEAD = frozenset(
    {
        "Experto en infoproductos",
        "Dueño de agencias",
        "Setter / closer / editor / etc.",
        "Infoproductor (persona que ya tiene un producto digital validado)",
        "Creador de contenido (persona que no tiene un infoproducto y solo crea contenido)",
        "Otro",
    }
)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _notas_str(val: str | None) -> str:
    return (val or "").strip()


def _parse_uid(user_id: str) -> int:
    try:
        return int(user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.") from e


def _members_for_user(uid: int) -> list[TeamMember]:
    return rows_for_user(TeamMember, uid)


def _get_active_member(uid: int, member_id: int, rol: str) -> TeamMember:
    for m in _members_for_user(uid):
        if m.id == member_id and m.activo and m.rol == rol:
            return m
    raise HTTPException(
        status_code=404,
        detail="Miembro no encontrado, inactivo o el rol no coincide con el reporte.",
    )


def _get_member_for_seguimiento(uid: int, member_id: int) -> TeamMember:
    for m in _members_for_user(uid):
        if m.id == member_id and m.activo and m.rol in SEGUIMIENTO_MEMBER_ROLES:
            return m
    raise HTTPException(
        status_code=404,
        detail="Miembro no encontrado, inactivo o rol no válido para seguimiento (setter, closer o cash).",
    )


def _month_range(ym: str) -> tuple[date, date]:
    if not re.match(r"^\d{4}-\d{2}$", ym.strip()):
        raise HTTPException(status_code=400, detail="month debe ser YYYY-MM.")
    y_s, m_s = ym.strip().split("-")
    y, m = int(y_s), int(m_s)
    if m < 1 or m > 12:
        raise HTTPException(status_code=400, detail="Mes inválido en month.")
    start = date(y, m, 1)
    last = calendar.monthrange(y, m)[1]
    end = date(y, m, last)
    return start, end


def _collect_team_reports(uid: int, desde: date, hasta: date) -> list[dict[str, Any]]:
    if hasta < desde:
        raise HTTPException(status_code=400, detail="La fecha hasta debe ser mayor o igual que desde.")
    if (hasta - desde).days > 400:
        raise HTTPException(status_code=400, detail="El rango máximo es 400 días.")

    def _mn(members: dict[int, TeamMember], mid: int) -> str:
        m = members.get(mid)
        return m.nombre if m else "(sin miembro)"

    with db_session:
        members = {m.id: m for m in _members_for_user(uid)}
        rows: list[dict[str, Any]] = []
        for r in filter_date_range(rows_for_user(SetterReport, uid), desde=desde, hasta=hasta):
            rows.append(
                {
                    "kind": "setter",
                    "id": r.id,
                    "fecha": r.fecha.isoformat(),
                    "member_id": r.member_id,
                    "member_nombre": _mn(members, r.member_id),
                    "conversaciones": r.conversaciones,
                    "agendas": r.agendas,
                    "links_enviados": r.links_enviados,
                    "conversaciones_stories": r.conversaciones_stories,
                    "conversaciones_reels": r.conversaciones_reels,
                    "agendas_stories": r.agendas_stories,
                    "agendas_reels": r.agendas_reels,
                    "agendas_ads": r.agendas_ads,
                    "links_enviados_stories": r.links_enviados_stories,
                    "links_enviados_reels": r.links_enviados_reels,
                    "notas": r.notas or "",
                    "sentimiento_trafico": r.sentimiento_trafico or "",
                    "avatar_tipo_agendas": r.avatar_tipo_agendas or "",
                    "insights_marketing": r.insights_marketing or "",
                }
            )
        for r in filter_date_range(rows_for_user(CloserReport, uid), desde=desde, hasta=hasta):
            rows.append(
                {
                    "kind": "closer",
                    "id": r.id,
                    "fecha": r.fecha.isoformat(),
                    "member_id": r.member_id,
                    "member_nombre": _mn(members, r.member_id),
                    "reporte_tipo": getattr(r, "reporte_tipo", None) or "ventas",
                    "llamadas_agendadas": r.llamadas_agendadas,
                    "shows": r.shows,
                    "cierres": r.cierres,
                    "shows_organico": r.shows_organico,
                    "shows_ads": r.shows_ads,
                    "cierres_organico": r.cierres_organico,
                    "cierres_ads": r.cierres_ads,
                    "calificados": r.calificados,
                    "descalificados": r.descalificados,
                    "ingreso": float(r.ingreso),
                    "reservas": r.reservas,
                    "seguimiento": r.seguimiento,
                    "facturacion": float(r.facturacion),
                    "notas": r.notas or "",
                    "nombre_lead": getattr(r, "nombre_lead", None) or "",
                    "estado_final_llamada": getattr(r, "estado_final_llamada", None) or "",
                    "perfil_lead": getattr(r, "perfil_lead", None) or "",
                    "objecion_miedo": getattr(r, "objecion_miedo", None) or "",
                    "dolores_llamada": getattr(r, "dolores_llamada", None) or "",
                    "razon_compra_final": getattr(r, "razon_compra_final", None) or "",
                    "insights_marketing_llamada": getattr(r, "insights_marketing_llamada", None) or "",
                }
            )
        for r in filter_date_range(rows_for_user(SeguimientoReport, uid), desde=desde, hasta=hasta):
            rows.append(
                {
                    "kind": "seguimiento",
                    "id": r.id,
                    "fecha": r.fecha.isoformat(),
                    "member_id": r.member_id,
                    "member_nombre": _mn(members, r.member_id),
                    "nombre_lead": (r.nombre_lead or "").strip(),
                    "monto": float(r.monto),
                }
            )
    rows.sort(key=lambda x: (x["fecha"], x["id"]), reverse=True)
    return rows


TEAM_REPORT_FILTROS = frozenset({"todos", "setter", "closer_marketing", "closer_ventas", "seguimiento"})


def _parse_team_report_filtro(raw: str | None) -> str:
    v = (raw or "todos").strip().lower()
    if v not in TEAM_REPORT_FILTROS:
        raise HTTPException(
            status_code=400,
            detail="filtro debe ser todos, setter, closer_marketing, closer_ventas o seguimiento.",
        )
    return v


def _filter_team_reports(rows: list[dict[str, Any]], filtro: str) -> list[dict[str, Any]]:
    if filtro == "todos":
        return rows
    if filtro == "setter":
        return [r for r in rows if r.get("kind") == "setter"]
    if filtro == "closer_marketing":
        return [
            r
            for r in rows
            if r.get("kind") == "closer" and str(r.get("reporte_tipo") or "ventas") == "marketing"
        ]
    if filtro == "closer_ventas":
        return [
            r
            for r in rows
            if r.get("kind") == "closer" and str(r.get("reporte_tipo") or "ventas") != "marketing"
        ]
    if filtro == "seguimiento":
        return [r for r in rows if r.get("kind") == "seguimiento"]
    return rows


class CreateTeamMemberBody(BaseModel):
    nombre: str = Field(min_length=1, max_length=500)
    rol: str


class TeamMemberOut(BaseModel):
    id: int
    nombre: str
    rol: str
    activo: bool


class UpdateTeamMemberBody(BaseModel):
    nombre: str | None = None
    activo: bool | None = None


class SetterReportBody(BaseModel):
    member_id: int
    fecha: date
    conversaciones: int = 0
    agendas: int = 0
    links_enviados: int = 0
    conversaciones_stories: int = 0
    conversaciones_reels: int = 0
    agendas_stories: int = 0
    agendas_reels: int = 0
    agendas_ads: int = 0
    links_enviados_stories: int = 0
    links_enviados_reels: int = 0
    notas: str | None = None
    sentimiento_trafico: str | None = None
    avatar_tipo_agendas: str | None = None
    insights_marketing: str | None = None


class CloserReportBody(BaseModel):
    member_id: int
    fecha: date
    reporte_tipo: str = "ventas"
    llamadas_agendadas: int = 0
    shows: int = 0
    cierres: int = 0
    shows_organico: int = 0
    shows_ads: int = 0
    cierres_organico: int = 0
    cierres_ads: int = 0
    reservas: int = 0
    seguimiento: int = 0
    facturacion: float = 0
    calificados: int = 0
    descalificados: int = 0
    ingreso: float = 0
    notas: str | None = None
    nombre_lead: str | None = None
    estado_final_llamada: str | None = None
    perfil_lead: str | None = None
    objecion_miedo: str | None = None
    dolores_llamada: str | None = None
    razon_compra_final: str | None = None
    insights_marketing_llamada: str | None = None


class SeguimientoReportBody(BaseModel):
    member_id: int
    fecha: date
    nombre_lead: str = Field(min_length=1, max_length=500)
    monto: float = Field(gt=0)
    lead_id: int
    concepto: str = "Saldo"
    metodo: str = "Transferencia"
    comprobante_url: str | None = None
    nota: str | None = None


class ReportSavedOut(BaseModel):
    id: int
    updated: bool


class SetterStatsOut(BaseModel):
    member_id: int
    nombre: str
    conversaciones: int
    agendas: int
    links_enviados: int
    # Base imputable ($): agendas × ticket medio equipo (ingreso/cierres en el mes)
    generado: float
    comision: float


class CloserStatsOut(BaseModel):
    member_id: int
    nombre: str
    llamadas_agendadas: int
    shows: int
    cierres: int
    calificados: int
    descalificados: int
    ingreso: float
    comision: float


class TeamDashboardOut(BaseModel):
    month: str
    cash_total: float
    comisiones: float
    commission_pct: float
    total_conversaciones: int = Field(
        ...,
        description="Suma de conversaciones de todos los SetterReport del mes (user_id).",
    )
    setters: list[SetterStatsOut]
    closers: list[CloserStatsOut]


class TeamDashboardDailyRow(BaseModel):
    fecha: str = Field(..., description="YYYY-MM-DD (día calendario del reporte setter).")
    conversaciones: int = Field(..., ge=0, description="Suma de conversaciones ese día (todos los SetterReport del usuario).")


@router.get("/members")
def list_members(
    user_id: str = Depends(require_user_id),
    incluir_inactivos: bool = Query(False, description="Incluye miembros desactivados (útil para edición / historial)."),
) -> dict[str, Any]:
    uid = _parse_uid(user_id)
    with db_session:
        pool = _members_for_user(uid)
        if not incluir_inactivos:
            pool = [m for m in pool if m.activo]
        setters = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in pool
            if m.rol == "setter"
        ]
        closers = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in pool
            if m.rol == "closer"
        ]
        cash_members = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in pool
            if m.rol == "cash"
        ]
        return {
            "setters": [s.model_dump() for s in setters],
            "closers": [c.model_dump() for c in closers],
            "cash": [x.model_dump() for x in cash_members],
        }


@router.get("/unmatched-people")
def unmatched_people(user_id: str = Depends(require_user_id)) -> dict[str, Any]:
    """Nombres de setter/closer en leads que no están cargados en el equipo."""
    uid = _parse_uid(user_id)
    with db_session:
        people = unmatched_people_for_user(uid)
        names = {str(p["nombre"]).strip() for p in people}
        return {"total": len(names), "people": people}


@router.post("/members")
def create_member(body: CreateTeamMemberBody, user_id: str = Depends(require_user_id)) -> TeamMemberOut:
    uid = _parse_uid(user_id)
    rol = body.rol.strip().lower()
    if rol not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail="rol debe ser 'setter', 'closer' o 'cash'.",
        )
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="nombre es obligatorio.")
    with db_session:
        m = TeamMember(user_id=uid, nombre=nombre, rol=rol, activo=True)
        m.flush()
        backfill_lead_member_ids_in_session(uid)
        return TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)


@router.delete("/members/{member_id}")
def delete_member(member_id: int, user_id: str = Depends(require_user_id)) -> dict[str, str]:
    """Elimina el miembro y todos sus reportes (setter, closer y seguimiento) del mismo usuario."""
    uid = _parse_uid(user_id)
    with db_session:
        found: TeamMember | None = None
        for m in _members_for_user(uid):
            if m.id == member_id:
                found = m
                break
        if found is None:
            raise HTTPException(status_code=404, detail="Miembro no encontrado.")
        for r in rows_for_user(SetterReport, uid):
            if r.member_id == member_id:
                r.delete()
        for r in rows_for_user(CloserReport, uid):
            if r.member_id == member_id:
                r.delete()
        for r in rows_for_user(SeguimientoReport, uid):
            if r.member_id == member_id:
                r.delete()
        found.delete()
    return {"status": "ok"}


@router.patch("/members/{member_id}")
def update_member(
    member_id: int,
    body: UpdateTeamMemberBody,
    user_id: str = Depends(require_user_id),
) -> TeamMemberOut:
    uid = _parse_uid(user_id)
    if body.nombre is None and body.activo is None:
        raise HTTPException(status_code=400, detail="Enviá al menos nombre o activo para actualizar.")
    with db_session:
        found: TeamMember | None = None
        for m in _members_for_user(uid):
            if m.id == member_id:
                found = m
                break
        if found is None:
            raise HTTPException(status_code=404, detail="Miembro no encontrado.")
        if body.nombre is not None:
            n = body.nombre.strip()
            if not n:
                raise HTTPException(status_code=400, detail="nombre no puede estar vacío.")
            found.nombre = n
        if body.activo is not None:
            found.activo = body.activo
        backfill_lead_member_ids_in_session(uid)
        return TeamMemberOut(id=found.id, nombre=found.nombre, rol=found.rol, activo=found.activo)


@router.get("/reports")
def list_team_reports(
    desde: date = Query(..., description="Inicio del rango (YYYY-MM-DD)"),
    hasta: date = Query(..., description="Fin del rango (YYYY-MM-DD)"),
    user_id: str = Depends(require_user_id),
) -> dict[str, Any]:
    uid = _parse_uid(user_id)
    rows = _collect_team_reports(uid, desde, hasta)
    return {"reports": rows}


@router.delete("/reports/{kind}/{report_id}")
def delete_team_report(
    kind: str,
    report_id: int,
    user_id: str = Depends(require_user_id),
) -> dict[str, str]:
    """Elimina un reporte del historial (setter, closer o seguimiento)."""
    uid = _parse_uid(user_id)
    kind_norm = kind.strip().lower()
    if kind_norm not in ("setter", "closer", "seguimiento"):
        raise HTTPException(status_code=400, detail="kind debe ser setter, closer o seguimiento.")
    entity = {
        "setter": SetterReport,
        "closer": CloserReport,
        "seguimiento": SeguimientoReport,
    }[kind_norm]
    with db_session:
        row = None
        for r in rows_for_user(entity, uid):
            if int(r.id) == int(report_id):
                row = r
                break
        if row is None:
            raise HTTPException(status_code=404, detail="Reporte no encontrado.")
        row.delete()
    return {"status": "ok"}


@router.get("/reports/pdf")
def team_reports_pdf(
    desde: date = Query(...),
    hasta: date = Query(...),
    filtro: str = Query(
        "todos",
        description="todos | setter | closer_marketing | closer_ventas | seguimiento",
    ),
    user_id: str = Depends(require_user_id),
) -> Response:
    uid = _parse_uid(user_id)
    rows = _collect_team_reports(uid, desde, hasta)
    rows = _filter_team_reports(rows, _parse_team_report_filtro(filtro))
    try:
        body = build_team_reports_pdf(rows)
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail="Falta la librería de PDF. En la carpeta backend ejecutá: pip install fpdf2",
        ) from e
    fn = f"reportes_equipo_{fecha_iso_a_dd_mm_yyyy(desde.isoformat())}_{fecha_iso_a_dd_mm_yyyy(hasta.isoformat())}.pdf"
    return Response(
        content=body,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


@router.post("/setter-reports")
def save_setter_report(body: SetterReportBody, user_id: str = Depends(require_user_id)) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    with db_session:
        _get_active_member(uid, body.member_id, "setter")
        existing = [
            r
            for r in rows_for_user(SetterReport, uid)
            if r.member_id == body.member_id and r.fecha == body.fecha
        ]
        if existing:
            r = existing[0]
            r.conversaciones = body.conversaciones
            r.agendas = body.agendas
            r.links_enviados = body.links_enviados
            r.conversaciones_stories = body.conversaciones_stories
            r.conversaciones_reels = body.conversaciones_reels
            r.agendas_stories = body.agendas_stories
            r.agendas_reels = body.agendas_reels
            r.agendas_ads = body.agendas_ads
            r.links_enviados_stories = body.links_enviados_stories
            r.links_enviados_reels = body.links_enviados_reels
            r.notas = _notas_str(body.notas)
            r.sentimiento_trafico = _notas_str(body.sentimiento_trafico)
            r.avatar_tipo_agendas = _notas_str(body.avatar_tipo_agendas)
            r.insights_marketing = _notas_str(body.insights_marketing)
            return ReportSavedOut(id=r.id, updated=True)
        r = SetterReport(
            user_id=uid,
            member_id=body.member_id,
            fecha=body.fecha,
            conversaciones=body.conversaciones,
            agendas=body.agendas,
            links_enviados=body.links_enviados,
            conversaciones_stories=body.conversaciones_stories,
            conversaciones_reels=body.conversaciones_reels,
            agendas_stories=body.agendas_stories,
            agendas_reels=body.agendas_reels,
            agendas_ads=body.agendas_ads,
            links_enviados_stories=body.links_enviados_stories,
            links_enviados_reels=body.links_enviados_reels,
            notas=_notas_str(body.notas),
            sentimiento_trafico=_notas_str(body.sentimiento_trafico),
            avatar_tipo_agendas=_notas_str(body.avatar_tipo_agendas),
            insights_marketing=_notas_str(body.insights_marketing),
        )
        r.flush()
        return ReportSavedOut(id=r.id, updated=False)


@router.post("/closer-reports")
def save_closer_report(body: CloserReportBody, user_id: str = Depends(require_user_id)) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    tipo = (body.reporte_tipo or "ventas").strip().lower()
    if tipo not in CLOSER_REPORTE_TIPOS:
        raise HTTPException(status_code=400, detail="reporte_tipo debe ser 'ventas' o 'marketing'.")
    la = body.llamadas_agendadas
    sh = body.shows
    ci = body.cierres
    cal = body.calificados
    desc = body.descalificados
    ing = body.ingreso
    shows_org = body.shows_organico
    shows_ads = body.shows_ads
    cierres_org = body.cierres_organico
    cierres_ads = body.cierres_ads
    if tipo == "ventas":
        sh = shows_org + shows_ads
        ci = cierres_org + cierres_ads
    reservas = body.reservas
    seguimiento = body.seguimiento
    facturacion = body.facturacion
    nombre_l = _notas_str(body.nombre_lead)
    estado_f = _notas_str(body.estado_final_llamada)
    perfil = _notas_str(body.perfil_lead)
    objecion = _notas_str(body.objecion_miedo)
    dolores = _notas_str(body.dolores_llamada)
    razon = _notas_str(body.razon_compra_final)
    ins_mkt = _notas_str(body.insights_marketing_llamada)
    if tipo == "marketing":
        if not nombre_l:
            raise HTTPException(status_code=400, detail="Indicá el nombre del lead.")
        if estado_f not in CLOSER_ESTADOS_FINAL:
            raise HTTPException(
                status_code=400,
                detail="Seleccioná el estado final de la llamada.",
            )
        if perfil not in CLOSER_PERFILES_LEAD:
            raise HTTPException(status_code=400, detail="Seleccioná el perfil del lead.")
        la = sh = ci = cal = desc = 0
        ing = 0.0
        shows_org = shows_ads = cierres_org = cierres_ads = reservas = seguimiento = 0
        facturacion = 0.0
    else:
        nombre_l = estado_f = perfil = objecion = dolores = razon = ins_mkt = ""
    with db_session:
        _get_active_member(uid, body.member_id, "closer")
        if tipo == "marketing":
            r = CloserReport(
                user_id=uid,
                member_id=body.member_id,
                fecha=body.fecha,
                reporte_tipo=tipo,
                llamadas_agendadas=la,
                shows=sh,
                cierres=ci,
                calificados=cal,
                descalificados=desc,
                ingreso=ing,
                notas=_notas_str(body.notas),
                nombre_lead=nombre_l,
                estado_final_llamada=estado_f,
                perfil_lead=perfil,
                objecion_miedo=objecion,
                dolores_llamada=dolores,
                razon_compra_final=razon,
                insights_marketing_llamada=ins_mkt,
            )
            r.flush()
            return ReportSavedOut(id=r.id, updated=False)
        existing = [
            r
            for r in rows_for_user(CloserReport, uid)
            if r.member_id == body.member_id and r.fecha == body.fecha and r.reporte_tipo == tipo
        ]
        if existing:
            r = existing[0]
            r.llamadas_agendadas = la
            r.shows = sh
            r.cierres = ci
            r.shows_organico = shows_org
            r.shows_ads = shows_ads
            r.cierres_organico = cierres_org
            r.cierres_ads = cierres_ads
            r.reservas = reservas
            r.seguimiento = seguimiento
            r.facturacion = facturacion
            r.calificados = cal
            r.descalificados = desc
            r.ingreso = ing
            r.notas = _notas_str(body.notas)
            r.nombre_lead = nombre_l
            r.estado_final_llamada = estado_f
            r.perfil_lead = perfil
            r.objecion_miedo = objecion
            r.dolores_llamada = dolores
            r.razon_compra_final = razon
            r.insights_marketing_llamada = ins_mkt
            return ReportSavedOut(id=r.id, updated=True)
        r = CloserReport(
            user_id=uid,
            member_id=body.member_id,
            fecha=body.fecha,
            reporte_tipo=tipo,
            llamadas_agendadas=la,
            shows=sh,
            cierres=ci,
            shows_organico=shows_org,
            shows_ads=shows_ads,
            cierres_organico=cierres_org,
            cierres_ads=cierres_ads,
            reservas=reservas,
            seguimiento=seguimiento,
            facturacion=facturacion,
            calificados=cal,
            descalificados=desc,
            ingreso=ing,
            notas=_notas_str(body.notas),
            nombre_lead=nombre_l,
            estado_final_llamada=estado_f,
            perfil_lead=perfil,
            objecion_miedo=objecion,
            dolores_llamada=dolores,
            razon_compra_final=razon,
            insights_marketing_llamada=ins_mkt,
        )
        r.flush()
        return ReportSavedOut(id=r.id, updated=False)


@router.post("/seguimiento-reports")
def save_seguimiento_report(
    body: SeguimientoReportBody,
    user_id: str = Depends(require_user_id),
) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    nl = body.nombre_lead.strip()
    if not nl:
        raise HTTPException(status_code=400, detail="Indicá el nombre del lead.")
    from src.schemas import LeadPaymentCreateRequest
    from src.services.payment_service import create_payment

    create_payment(
        uid,
        LeadPaymentCreateRequest(
            lead_id=int(body.lead_id),
            monto=float(body.monto),
            fecha_cobro=body.fecha,
            member_id=body.member_id,
            concepto=body.concepto,
            metodo=body.metodo,
            comprobante_url=body.comprobante_url,
            nota=body.nota,
        ),
    )
    with db_session:
        _get_member_for_seguimiento(uid, body.member_id)
        r = SeguimientoReport(
            user_id=uid,
            member_id=body.member_id,
            lead_id=int(body.lead_id),
            fecha=body.fecha,
            nombre_lead=nl,
            monto=float(body.monto),
        )
        r.flush()
        return ReportSavedOut(id=r.id, updated=False)


@router.get("/seguimiento-reports/month")
def seguimiento_reports_month(
    month: str = Query(..., description="YYYY-MM"),
    user_id: str = Depends(require_user_id),
) -> dict[str, Any]:
    """Totales y filas del mes para sumar a cash collected en el dashboard de ventas."""
    uid = _parse_uid(user_id)
    start, end = _month_range(month)
    with db_session:
        entries = [
            {"fecha": r.fecha.isoformat(), "monto": float(r.monto)}
            for r in filter_date_range(rows_for_user(SeguimientoReport, uid), desde=start, hasta=end)
        ]
    total = sum(e["monto"] for e in entries)
    return {"total": total, "entries": entries}


class CloserMarketingCountOut(BaseModel):
    count: int


@router.get("/closer-marketing-report-count")
def closer_marketing_report_count(
    fecha: date = Query(..., description="Día del reporte (YYYY-MM-DD)"),
    member_id: int = Query(..., description="TeamMember closer"),
    user_id: str = Depends(require_user_id),
) -> CloserMarketingCountOut:
    """Cuántos reportes marketing (una fila por llamada) hay para ese closer en esa fecha."""
    uid = _parse_uid(user_id)
    with db_session:
        _get_active_member(uid, member_id, "closer")
        n = sum(
            1
            for r in rows_for_user(CloserReport, uid)
            if r.member_id == member_id and r.fecha == fecha and r.reporte_tipo == "marketing"
        )
    return CloserMarketingCountOut(count=n)


@router.get("/dashboard/daily", response_model=list[TeamDashboardDailyRow])
def team_dashboard_daily(
    month: str = Query(..., description="YYYY-MM"),
    user_id: str = Depends(require_user_id),
) -> list[TeamDashboardDailyRow]:
    """Conversaciones por día (suma de SetterReport del usuario en ese mes)."""
    uid = _parse_uid(user_id)
    start, end = _month_range(month)
    with db_session:
        rows_data = [
            (r.fecha, int(r.conversaciones))
            for r in filter_date_range(rows_for_user(SetterReport, uid), desde=start, hasta=end)
        ]
    by_day: dict[date, int] = defaultdict(int)
    for f, c in rows_data:
        by_day[f] += c

    out: list[TeamDashboardDailyRow] = []
    d = start
    while d <= end:
        out.append(
            TeamDashboardDailyRow(
                fecha=d.isoformat(),
                conversaciones=int(by_day.get(d, 0)),
            )
        )
        d += timedelta(days=1)
    return out


@router.get("/dashboard")
def team_dashboard(
    month: str = Query(..., description="YYYY-MM"),
    user_id: str = Depends(require_user_id),
) -> TeamDashboardOut:
    uid = _parse_uid(user_id)
    start, end = _month_range(month)
    ym = month.strip()

    with db_session:
        setter_rows = filter_date_range(rows_for_user(SetterReport, uid), desde=start, hasta=end)
        total_conversaciones = sum(int(r.conversaciones) for r in setter_rows)
        closer_rows = [
            r
            for r in filter_date_range(rows_for_user(CloserReport, uid), desde=start, hasta=end)
            if r.reporte_tipo == "ventas"
        ]

        members_by_id = {m.id: m for m in _members_for_user(uid)}

        setter_totals: dict[int, dict[str, int]] = {}
        for r in setter_rows:
            acc = setter_totals.setdefault(
                r.member_id,
                {"conversaciones": 0, "agendas": 0, "links_enviados": 0},
            )
            acc["conversaciones"] += r.conversaciones
            acc["agendas"] += r.agendas
            acc["links_enviados"] += r.links_enviados

        closer_totals: dict[int, dict[str, float | int]] = {}
        for r in closer_rows:
            acc = closer_totals.setdefault(
                r.member_id,
                {
                    "llamadas_agendadas": 0,
                    "shows": 0,
                    "cierres": 0,
                    "calificados": 0,
                    "descalificados": 0,
                    "ingreso": 0.0,
                },
            )
            acc["llamadas_agendadas"] = int(acc["llamadas_agendadas"]) + r.llamadas_agendadas
            acc["shows"] = int(acc["shows"]) + r.shows
            acc["cierres"] = int(acc["cierres"]) + r.cierres
            acc["calificados"] = int(acc["calificados"]) + r.calificados
            acc["descalificados"] = int(acc["descalificados"]) + r.descalificados
            acc["ingreso"] = float(acc["ingreso"]) + float(r.ingreso)

        active_setters = [m for m in members_by_id.values() if m.activo and m.rol == "setter"]
        active_closers = [m for m in members_by_id.values() if m.activo and m.rol == "closer"]

        pct = DEFAULT_COMMISSION_PCT / 100.0

        closer_out: list[CloserStatsOut] = []
        comisiones_closer = 0.0
        cash_total = 0.0
        total_cierres_mes = 0
        for m in sorted(active_closers, key=lambda x: x.id):
            t = closer_totals.get(
                m.id,
                {
                    "llamadas_agendadas": 0,
                    "shows": 0,
                    "cierres": 0,
                    "calificados": 0,
                    "descalificados": 0,
                    "ingreso": 0.0,
                },
            )
            ing = float(t["ingreso"])
            ci = int(t["cierres"])
            cash_total += ing
            total_cierres_mes += ci
            com = ing * pct
            comisiones_closer += com
            closer_out.append(
                CloserStatsOut(
                    member_id=m.id,
                    nombre=m.nombre,
                    llamadas_agendadas=int(t["llamadas_agendadas"]),
                    shows=int(t["shows"]),
                    cierres=ci,
                    calificados=int(t["calificados"]),
                    descalificados=int(t["descalificados"]),
                    ingreso=ing,
                    comision=com,
                )
            )

        avg_ticket = (cash_total / total_cierres_mes) if total_cierres_mes > 0 else 0.0

        setter_out: list[SetterStatsOut] = []
        comisiones_setter = 0.0
        for m in sorted(active_setters, key=lambda x: x.id):
            t = setter_totals.get(
                m.id,
                {"conversaciones": 0, "agendas": 0, "links_enviados": 0},
            )
            agendas = int(t["agendas"])
            generado = avg_ticket * agendas
            com_set = generado * pct
            comisiones_setter += com_set
            setter_out.append(
                SetterStatsOut(
                    member_id=m.id,
                    nombre=m.nombre,
                    conversaciones=int(t["conversaciones"]),
                    agendas=agendas,
                    links_enviados=int(t["links_enviados"]),
                    generado=generado,
                    comision=com_set,
                )
            )

        comisiones = comisiones_closer + comisiones_setter

    return TeamDashboardOut(
        month=ym,
        cash_total=cash_total,
        comisiones=comisiones,
        commission_pct=DEFAULT_COMMISSION_PCT,
        total_conversaciones=total_conversaciones,
        setters=setter_out,
        closers=closer_out,
    )
