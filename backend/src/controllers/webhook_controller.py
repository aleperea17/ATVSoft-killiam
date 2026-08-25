import hashlib
import hmac
import json
import re
import time
from datetime import datetime
from decouple import config
from fastapi import APIRouter, HTTPException, Request
import httpx
from pony.orm import ObjectNotFound, db_session

from src.datetime_utils import naive_utc
from src.db import db
from src.db_query_utils import rows_for_user
from src.db_session_retry import once_on_unrepeatable_read
from src.lead_display_utils import (
    compute_dias_para_agendar,
    fill_str_if_empty,
    lead_status_is_open_for_sync,
    set_status_agendado_if_open,
)
from src.models import ApiConnection, Lead, ReelContent
from src.services.calendly_event_filter import (
    CALENDLY_EVENT_TYPE_ALLOWLIST_KEY,
    event_type_in_allowlist,
    normalize_event_type_allowlist,
    resolve_invitee_event_type,
)
from src.team_member_match import apply_external_role_name, members_for_user

router = APIRouter(prefix="/webhooks", tags=["webhooks"], redirect_slashes=False)

MANYCHAT_WEBHOOK_SECRET = config("MANYCHAT_WEBHOOK_TOKEN")


def _norm_kw(s: str) -> str:
    return (s or "").strip().casefold()


def _norm_ig(s: str) -> str:
    return (s or "").strip().lstrip("@").casefold()


def _sanitize_webhook_display_name(raw: str) -> str:
    """Quita etiquetas ManyChat sin sustituir ({{first_name}}, etc.) que a veces llegan como texto."""
    s = (raw or "").strip()
    if not s:
        return ""
    cleaned = re.sub(r"\{\{[^}]*\}\}", "", s)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _keyword_tokens_csv(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    return [p.strip() for p in str(raw).split(",") if p.strip()]


def _merge_keyword_csv(existing: str | None, new_token: str) -> str:
    """Una sola fila por contacto: varias keywords en el mismo campo, coma-separadas (igual que en reels/leads)."""
    t = (new_token or "").strip()
    parts = _keyword_tokens_csv(existing)
    seen = {p.casefold() for p in parts}
    if t and t.casefold() not in seen:
        parts.append(t)
    return ", ".join(parts)


def _find_lead_same_contact(user_id: int, ig_display: str) -> Lead | None:
    """Mismo dueño + mismo IG → un solo lead; se agregan keywords."""
    ig_key = _norm_ig(ig_display)
    if not ig_key:
        return None
    tbl = Lead._table_ or "lead"
    sql = f"""l.id FROM {tbl} l
WHERE l.user_id = $user_id
AND lower(trim(both from coalesce(l.ig, ''))) = $ig_key
ORDER BY l.created_at DESC
LIMIT 1"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id, "ig_key": ig_key})
        if not rows:
            return None
        try:
            return Lead.get(id=int(rows[0]), user_id=user_id)
        except ObjectNotFound:
            return None


def _payload_respondio_auto_flag(payload: dict) -> bool:
    event = str(payload.get("event") or "").strip().lower()
    if event == "respondio_auto":
        return True
    raw = payload.get("respondio_auto")
    if raw is True:
        return True
    if isinstance(raw, (int, float)) and raw == 1:
        return True
    if isinstance(raw, str) and raw.strip().lower() in ("true", "1", "yes", "si", "sí"):
        return True
    return False


def _resolve_user_id_for_respondio_auto(payload: dict) -> int | None:
    keyword = str(payload.get("keyword") or "").strip()
    if keyword:
        try:
            return _resolve_user_id_by_keyword(keyword)
        except HTTPException:
            pass
    with db_session:
        manychat_conns = list(ApiConnection.select(lambda c: c.platform == "manychat"))
        manychat_conns.sort(key=lambda c: int(c.id))
        if manychat_conns:
            return int(manychat_conns[0].user_id)
    return None


def _mark_respondio_auto(payload: dict) -> bool:
    """Marca respondio_auto=True en el lead del contacto. Devuelve si encontró lead."""
    ig_key = _norm_ig(str(payload.get("contact_ig_username") or "").strip())
    mc_id = _sanitize_webhook_display_name(str(payload.get("manychat_contact_id") or ""))
    user_id = _resolve_user_id_for_respondio_auto(payload)

    with db_session:
        lead: Lead | None = None
        tbl = Lead._table_ or "lead"

        if user_id is not None and ig_key:
            sql = f"""l.id FROM {tbl} l
WHERE l.user_id = $user_id
AND lower(trim(both from coalesce(l.ig, ''))) = $ig_key
ORDER BY l.created_at DESC
LIMIT 1"""
            rows = db.select(sql, globals(), {"user_id": user_id, "ig_key": ig_key})
            if rows:
                try:
                    lead = Lead.get(id=int(rows[0]), user_id=user_id)
                except ObjectNotFound:
                    lead = None

        if lead is None and user_id is not None and mc_id:
            for row in rows_for_user(Lead, user_id):
                if str(row.manychat_contact_id or "").strip() == mc_id:
                    lead = row
                    break

        if lead is None and ig_key:
            sql = f"""l.id FROM {tbl} l
WHERE lower(trim(both from coalesce(l.ig, ''))) = $ig_key
ORDER BY l.created_at DESC
LIMIT 1"""
            rows = db.select(sql, globals(), {"ig_key": ig_key})
            if rows:
                try:
                    lead = Lead.get(id=int(rows[0]))
                except ObjectNotFound:
                    lead = None

        if lead is None:
            return False
        lead.respondio_auto = True
        return True


def _resolve_user_id_by_keyword(keyword: str) -> int | None:
    """Dueño del keyword: reel con ese keyword; si no hay reel, primer ApiConnection manychat."""
    kw = _norm_kw(keyword)
    if not kw:
        return None

    tbl = ReelContent._table_ or "reelcontent"
    sql = f"""r.user_id FROM {tbl} r
WHERE lower(trim(both from coalesce(r.keyword, ''))) = $kw"""
    with db_session:
        reel_uids: list[int] = []
        for row in db.select(sql, globals(), {"kw": kw}):
            reel_uids.append(int(row))
        if reel_uids:
            reel_uid = reel_uids[0]
            if any(uid != reel_uid for uid in reel_uids):
                raise HTTPException(
                    status_code=409,
                    detail="Hay más de un usuario con el mismo keyword en reels. Corregí keywords duplicados.",
                )
            return reel_uid

        manychat_conns = list(ApiConnection.select(lambda c: c.platform == "manychat"))
        manychat_conns.sort(key=lambda c: int(c.id))
        if manychat_conns:
            return int(manychat_conns[0].user_id)

    return None


@router.post("/manychat")
async def manychat_webhook(request: Request) -> dict[str, str]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    payload = body if isinstance(body, dict) else {}
    query_token = str(request.query_params.get("token") or "").strip()
    header_token = str(request.headers.get("X-Webhook-Token") or "").strip()

    resolved_token = query_token or header_token or str(payload.get("webhook_token") or "").strip()
    if resolved_token:
        payload["webhook_token"] = resolved_token

    webhook_token = str(payload.get("webhook_token") or "").strip()

    if str(webhook_token) != str(MANYCHAT_WEBHOOK_SECRET).strip():
        raise HTTPException(status_code=401, detail="Invalid webhook token")

    respondio_requested = _payload_respondio_auto_flag(payload)
    if respondio_requested:
        _mark_respondio_auto(payload)

    keyword = str(payload.get("keyword") or "").strip()
    if not keyword:
        if respondio_requested:
            return {"status": "ok"}
        raise HTTPException(status_code=400, detail="Missing keyword")

    user_id = _resolve_user_id_by_keyword(keyword)
    if user_id is None:
        raise HTTPException(
            status_code=404,
            detail="No se encontró un usuario para esta keyword (revisa reels o conexión ManyChat).",
        )

    contact_name = _sanitize_webhook_display_name(str(payload.get("contact_name") or ""))
    contact_lastname = _sanitize_webhook_display_name(str(payload.get("contact_lastname") or ""))
    nombre = " ".join(x for x in (contact_name, contact_lastname) if x).strip()
    # Mismo criterio: si en ManyChat el body tiene "{{ig_username}}" entre comillas, llega literal.
    ig = _sanitize_webhook_display_name(str(payload.get("contact_ig_username") or "")).lstrip("@")
    if not nombre and ig:
        nombre = ig
    content_url = str(payload.get("content_url") or "").strip()
    manychat_contact_id = _sanitize_webhook_display_name(str(payload.get("manychat_contact_id") or ""))

    now = datetime.utcnow()
    with db_session:
        existing = _find_lead_same_contact(user_id, ig)
        if existing is not None:
            existing.keyword = _merge_keyword_csv(existing.keyword, keyword)
            if not (existing.nombre or "").strip() and nombre:
                existing.nombre = nombre
            if ig:
                existing.ig = ig
            if content_url:
                existing.content_url = content_url
            if manychat_contact_id and not (existing.manychat_contact_id or "").strip():
                existing.manychat_contact_id = manychat_contact_id
            existing.fecha_bot = now
            if respondio_requested:
                existing.respondio_auto = True
        else:
            Lead(
                user_id=user_id,
                nombre=nombre,
                ig=ig,
                keyword=keyword,
                content_url=content_url,
                manychat_contact_id=manychat_contact_id,
                fecha_bot=now,
                respondio_auto=False,
            )

    return {"status": "ok"}


@router.get("/manychat")
def manychat_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "manychat-webhook"}


def _norm_name_for_match(raw: str) -> str:
    s = re.sub(r"\s+", " ", (raw or "").strip()).casefold()
    return s


def _flatten_calendly_invitee_payload(body: dict) -> dict:
    """Unifica formas habituales del body (payload plano vs anidado tipo API v2)."""
    payload = body.get("payload")
    if not isinstance(payload, dict):
        payload = body
    inner = payload
    invitee = inner.get("invitee")
    if isinstance(invitee, dict):
        merged = {**inner, **invitee}
    else:
        merged = dict(inner)
    scheduled = merged.get("scheduled_event")
    if isinstance(scheduled, dict) and "start_time" not in merged:
        merged["start_time"] = scheduled.get("start_time")
    ev = merged.get("event")
    if isinstance(ev, dict) and not merged.get("start_time"):
        merged["start_time"] = ev.get("start_time")
    return merged


def _calendly_webhook_received_at(flat: dict, inner: dict) -> datetime:
    """Instante en que Calendly registró al invitee (completó el form / webhook invitee.created)."""
    raw = (
        flat.get("created_at")
        or inner.get("created_at")
        or flat.get("updated_at")
        or inner.get("updated_at")
    )
    if raw:
        dt = naive_utc(_parse_calendly_start_time(str(raw)))
        if dt is not None:
            return dt
    return datetime.utcnow()


def _parse_calendly_start_time(raw: str | None) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _calendly_inner_payload(body: dict) -> dict:
    p = body.get("payload")
    return p if isinstance(p, dict) else {}


def _merge_calendly_email_notas(existing: str | None, email: str) -> str:
    line = f"Calendly email: {email}"
    base = (existing or "").strip()
    if not base:
        return line
    if line in base:
        return base
    return f"{base}\n{line}"


def _calendly_questions(flat: dict, inner: dict | None = None) -> list[dict]:
    sources = [flat]
    if isinstance(inner, dict):
        sources.append(inner)
    for src in sources:
        qa = src.get("questions_and_answers")
        if isinstance(qa, list):
            return [item for item in qa if isinstance(item, dict)]
    return []


def _find_calendly_answer(questions: list[dict], *keywords: str) -> str:
    """Busca respuesta por substring en el texto de la pregunta (casefold)."""
    kws = [k.casefold() for k in keywords if k]
    for item in questions:
        q = str(item.get("question") or "").casefold()
        if not q:
            continue
        if any(kw in q for kw in kws):
            return str(item.get("answer") or "").strip()
    return ""


def _extract_calendly_form_fields(flat: dict, inner: dict | None = None) -> dict[str, str]:
    """Mapea Q&A genéricos del formulario de Calendly → campos Lead."""
    qa = _calendly_questions(flat, inner)
    phone = (
        _find_calendly_answer(qa, "número de teléfono", "numero de telefono", "teléfono", "telefono", "phone")
        or str(flat.get("text_reminder_number") or (inner or {}).get("text_reminder_number") or "").strip()
    )
    return {
        "phone": phone,
        "situacion_actual": _find_calendly_answer(qa, "situación actual", "situacion actual"),
        "objetivo": _find_calendly_answer(
            qa,
            "objetivo",
            "disponibilidad",
            "mínimo una hora",
            "minimo una hora",
            "hora al día",
            "hora al dia",
        ),
        "reto_actual": _find_calendly_answer(qa, "mayor reto", "reto actualmente"),
        "ingresos_rango": _find_calendly_answer(
            qa,
            "con cuánto dinero",
            "con cuanto dinero",
            "cuánto dinero cuentas",
            "cuanto dinero cuentas",
            "ingresos",
            "facturación",
            "facturacion",
        ),
        "compromiso": _find_calendly_answer(qa, "comprometidas", "realmente comprometidas", "compromiso"),
    }


def _apply_calendly_form_fields(row: Lead, fields: dict[str, str]) -> None:
    """Completa huecos del CRM; no pisa valores que el equipo ya cargó."""
    phone = (fields.get("phone") or "").strip()
    if phone:
        row.telefono = fill_str_if_empty(row.telefono, phone)
    situacion = (fields.get("situacion_actual") or "").strip()
    if situacion:
        row.situacion_actual = fill_str_if_empty(row.situacion_actual, situacion)
    objetivo = (fields.get("objetivo") or "").strip()
    if objetivo:
        row.objetivo = fill_str_if_empty(row.objetivo, objetivo)
    reto = (fields.get("reto_actual") or "").strip()
    if reto:
        row.reto_actual = fill_str_if_empty(row.reto_actual, reto)
    ingresos = (fields.get("ingresos_rango") or "").strip()
    if ingresos:
        row.ingresos_rango = fill_str_if_empty(row.ingresos_rango, ingresos)
    compromiso = (fields.get("compromiso") or "").strip()
    if compromiso:
        # Sin columna dedicada aún: se anexa a notas si no está.
        marker = f"Compromiso Calendly: {compromiso}"
        base = (row.notas or "").strip()
        if marker not in base:
            row.notas = f"{base}\n{marker}".strip() if base else marker


def _find_lead_for_calendly(user_id: int, display_name: str) -> Lead | None:
    """Misma cuenta: coincidencia por nombre normalizado."""
    nkey = _norm_name_for_match(display_name)
    if not nkey:
        return None
    rows = rows_for_user(Lead, user_id)
    name_matches = [r for r in rows if _norm_name_for_match(r.nombre or "") == nkey]
    if not name_matches:
        return None
    name_matches.sort(key=lambda r: r.created_at.timestamp() if r.created_at else 0.0, reverse=True)
    return name_matches[0]


def _fetch_scheduled_event_type(event_uri: str, api_key: str) -> str | None:
    """GET Calendly scheduled event. None = fallo; '' = 200 sin event_type."""
    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                event_uri,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            )
    except Exception as exc:
        print(f"[calendly webhook] GET {event_uri} falló: {exc}", flush=True)
        return None
    if response.status_code != 200:
        print(
            f"[calendly webhook] GET {event_uri} HTTP {response.status_code}",
            flush=True,
        )
        return None
    try:
        data = response.json()
    except Exception:
        print(f"[calendly webhook] GET {event_uri} respuesta no JSON", flush=True)
        return None
    resource = data.get("resource") if isinstance(data, dict) else {}
    if not isinstance(resource, dict):
        return ""
    raw = resource.get("event_type")
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, dict):
        return str(raw.get("uri") or "").strip()
    return ""


@router.post("/calendly")
async def calendly_webhook(request: Request) -> dict[str, str]:
    body_bytes = await request.body()
    try:
        body = json.loads(body_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request body") from exc

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    with db_session:
        calendly_conns = list(ApiConnection.select(lambda c: c.platform == "calendly"))
        calendly_conns.sort(key=lambda c: int(c.id))
        if not calendly_conns:
            raise HTTPException(
                status_code=404,
                detail="No hay conexión ApiConnection con platform=calendly.",
            )

        conn = calendly_conns[0]
        user_id = int(conn.user_id)

        try:
            creds = json.loads(conn.credentials) if isinstance(conn.credentials, str) else (conn.credentials or {})
        except Exception:
            creds = {}
        signing_key = str(creds.get("signing_key") or "").strip()
        api_key = str(creds.get("api_key") or "").strip()
        event_type_allowlist = normalize_event_type_allowlist(creds.get(CALENDLY_EVENT_TYPE_ALLOWLIST_KEY))

    if signing_key:
        sig_header = request.headers.get("calendly-webhook-signature", "")
        parts = dict(p.split("=", 1) for p in sig_header.split(",") if "=" in p)
        t = parts.get("t", "")
        v1 = parts.get("v1", "")
        if not t or not v1:
            raise HTTPException(status_code=401, detail="Missing Calendly signature")
        if abs(time.time() - int(t)) > 300:
            raise HTTPException(status_code=401, detail="Webhook timestamp too old")
        payload_to_sign = f"{t}.{body_bytes.decode()}"
        expected = hmac.new(signing_key.encode(), payload_to_sign.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, v1):
            raise HTTPException(status_code=401, detail="Invalid Calendly signature")

    print(f"[calendly webhook] payload: {body}")

    event = str(body.get("event") or "").strip()
    if event != "invitee.created":
        return {"status": "ok"}

    inner_payload = _calendly_inner_payload(body)
    flat = _flatten_calendly_invitee_payload(body)

    if not event_type_allowlist:
        print(
            "[calendly webhook] descartado: event_type_allowlist vacía (fail closed)",
            flush=True,
        )
        return {"status": "ok"}

    resolved_event_type, resolve_via = resolve_invitee_event_type(
        inner_payload,
        flat,
        api_key=api_key,
        fetch_scheduled_event_type=_fetch_scheduled_event_type,
    )
    if not resolved_event_type:
        print(
            f"[calendly webhook] descartado: no se pudo resolver event_type ({resolve_via})",
            flush=True,
        )
        return {"status": "ok"}
    if not event_type_in_allowlist(resolved_event_type, event_type_allowlist):
        print(
            f"[calendly webhook] event_type={resolved_event_type} descartado, no está en allowlist",
            flush=True,
        )
        return {"status": "ok"}
    print(
        f"[calendly webhook] event_type={resolved_event_type} aceptado ({resolve_via})",
        flush=True,
    )

    display_name = _sanitize_webhook_display_name(
        str(inner_payload.get("name") or flat.get("name") or ""),
    )
    email = str(inner_payload.get("email") or flat.get("email") or "").strip()

    start_raw = flat.get("start_time")
    if not start_raw and isinstance(flat.get("scheduled_event"), dict):
        start_raw = flat["scheduled_event"].get("start_time")
    if isinstance(start_raw, dict):
        start_raw = start_raw.get("start_time")
    start_dt = naive_utc(_parse_calendly_start_time(str(start_raw) if start_raw else None))

    if not display_name and email:
        display_name = email.split("@")[0]

    start_raw_label = str(start_raw) if start_raw is not None else ""
    form_completed_at = _calendly_webhook_received_at(flat, inner_payload)
    form_fields = _extract_calendly_form_fields(flat, inner_payload)
    scheduled_event = flat.get("scheduled_event") if isinstance(flat.get("scheduled_event"), dict) else {}
    closer_name = ""
    memberships = scheduled_event.get("event_memberships") if isinstance(scheduled_event, dict) else None
    if isinstance(memberships, list):
        for member in memberships:
            if not isinstance(member, dict):
                continue
            closer_name = str(member.get("user_name") or "").strip()
            if closer_name:
                break

    once_on_unrepeatable_read(
        lambda: _persist_calendly_webhook_lead(
            user_id=user_id,
            display_name=display_name,
            email=email,
            start_dt=start_dt,
            start_raw_label=start_raw_label,
            form_completed_at=form_completed_at,
            form_fields=form_fields,
            closer_name=closer_name,
        ),
        log_label="calendly webhook",
    )

    return {"status": "ok"}


def _persist_calendly_webhook_lead(
    *,
    user_id: int,
    display_name: str,
    email: str,
    start_dt: datetime | None,
    start_raw_label: str,
    form_completed_at: datetime,
    form_fields: dict[str, str],
    closer_name: str,
) -> None:
    """Alta/update de Lead. Un db_session; el caller reintenta UnrepeatableReadError una vez."""
    with db_session:
        row = _find_lead_for_calendly(user_id, display_name)
        if row is not None:
            if display_name:
                row.nombre = fill_str_if_empty(row.nombre, display_name)
            if email:
                row.email = fill_str_if_empty(row.email, email)
                row.notas = _merge_calendly_email_notas(row.notas, email)
            if lead_status_is_open_for_sync(row.status):
                if form_completed_at is not None and row.agendo is None:
                    row.agendo = form_completed_at
                if start_dt is not None:
                    row.call = start_dt
                if not (row.agendo_en or "").strip():
                    row.agendo_en = "Chat"
                set_status_agendado_if_open(row)
                _apply_calendly_form_fields(row, form_fields)
                row.dias_para_agendar = compute_dias_para_agendar(row.primer_contacto, row.agendo)
            apply_external_role_name(row, members_for_user(user_id), role="closer", name=closer_name)
            return
        notas_parts = []
        if email:
            notas_parts.append(f"Calendly email: {email}")
        if start_raw_label:
            notas_parts.append(f"Cita: {start_raw_label}")
        row = Lead(
            user_id=user_id,
            nombre=display_name or (email.split("@")[0] if email else "Invitado Calendly"),
            email=email or "",
            agendo=form_completed_at,
            call=start_dt,
            agendo_en="Chat",
            status="Agendado",
            notas="\n".join(notas_parts),
        )
        _apply_calendly_form_fields(row, form_fields)
        apply_external_role_name(row, members_for_user(user_id), role="closer", name=closer_name)


@router.get("/calendly")
def calendly_webhook_verify() -> dict[str, str]:
    return {"status": "ok", "service": "calendly-webhook"}
