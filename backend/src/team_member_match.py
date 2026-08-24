"""Match de TeamMember: el id agrupa, el nombre de origen se conserva."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

from src.db_query_utils import rows_for_user
from src.models import TeamMember

_UNSET = object()
_FALLBACK_NAMES = frozenset({"sin asignar", "sin asignar."})


def norm_person_key(s: str | None) -> str:
    """Clave estable: minúsculas, sin tildes, espacios colapsados."""
    raw = unicodedata.normalize("NFD", (s or "").strip())
    stripped = "".join(ch for ch in raw if unicodedata.category(ch) != "Mn")
    return " ".join(stripped.casefold().split())


def looks_like_person_name(s: str | None) -> bool:
    """Evita IDs, emails sueltos y placeholders como nombre de setter/closer."""
    t = (s or "").strip()
    if len(t) < 2 or len(t) > 80:
        return False
    if norm_person_key(t) in _FALLBACK_NAMES:
        return False
    if "@" in t:
        return False
    if re.fullmatch(r"[0-9a-fA-F-]{16,}", t):
        return False
    if t.isdigit():
        return False
    return True


def members_for_user(uid: int) -> list[TeamMember]:
    return rows_for_user(TeamMember, uid)


def member_nombre_map(
    uid: int | None = None,
    members: list[TeamMember] | None = None,
) -> dict[int, str]:
    pool = members if members is not None else members_for_user(int(uid or 0))
    return {int(m.id): (m.nombre or "").strip() for m in pool}


def resolve_member_id(
    name: str | None,
    members: Iterable[TeamMember],
    *,
    preferred_rol: str | None = None,
) -> int | None:
    """Match único por nombre completo. Sin rol preferido no cae en otra persona."""
    key = norm_person_key(name)
    if not key:
        return None
    matches = [m for m in members if norm_person_key(m.nombre) == key]
    if not matches:
        return None
    if preferred_rol:
        role = preferred_rol.strip().lower()
        role_m = [m for m in matches if (m.rol or "").strip().lower() == role]
        if len(role_m) == 1:
            return int(role_m[0].id)
        return None
    if len(matches) == 1:
        return int(matches[0].id)
    return None


def display_role_name(
    stored: str | None,
    member_id: int | None,
    names: dict[int, str],
) -> str | None:
    """El texto guardado (GHL/Calendly/carga) manda; el nombre del equipo es fallback."""
    s = (stored or "").strip()
    if s:
        return s
    if member_id:
        n = (names.get(int(member_id)) or "").strip()
        if n:
            return n
    return None


def assign_lead_person(
    row: Any,
    members: list[TeamMember],
    *,
    role: str,
    name: Any = _UNSET,
    member_id: Any = _UNSET,
) -> None:
    """ID para agrupar. El nombre de origen no se reescribe por el del equipo."""
    if role not in ("setter", "closer"):
        raise ValueError("role debe ser setter o closer.")
    name_attr = role
    id_attr = f"{role}_member_id"
    by_id = {int(m.id): m for m in members}

    resolved_id: int | None = None
    have_id = member_id is not _UNSET
    have_name = name is not _UNSET
    incoming_name = "" if not have_name or name is None else str(name).strip()

    if have_id:
        if member_id is None or member_id == "":
            resolved_id = None
        else:
            try:
                mid = int(member_id)
            except (TypeError, ValueError) as e:
                raise ValueError("member_id inválido.") from e
            if mid <= 0:
                resolved_id = None
            elif mid not in by_id:
                raise ValueError("El miembro no pertenece a este usuario.")
            else:
                resolved_id = mid
    if resolved_id is None and have_name and incoming_name:
        resolved_id = resolve_member_id(incoming_name, members, preferred_rol=role)

    if not have_id and not have_name:
        return

    setattr(row, id_attr, resolved_id)
    if have_name:
        setattr(row, name_attr, incoming_name)
    elif resolved_id:
        setattr(row, name_attr, by_id[resolved_id].nombre)
    else:
        setattr(row, name_attr, "")


def apply_external_role_name(
    row: Any,
    members: list[TeamMember],
    *,
    role: str,
    name: str | None,
) -> None:
    """Sync: guarda el texto tal cual. member_id solo si hay match único; si no, null."""
    if role not in ("setter", "closer"):
        raise ValueError("role debe ser setter o closer.")
    raw = (name or "").strip()
    if not raw or not looks_like_person_name(raw):
        return
    id_attr = f"{role}_member_id"
    name_attr = role
    if getattr(row, id_attr, None):
        return
    current = (getattr(row, name_attr, None) or "").strip()
    if current:
        mid = resolve_member_id(current, members, preferred_rol=role)
        if mid:
            setattr(row, id_attr, mid)
        return
    setattr(row, name_attr, raw)
    setattr(row, id_attr, resolve_member_id(raw, members, preferred_rol=role))


def unmatched_people_for_user(uid: int) -> list[dict[str, Any]]:
    """Nombres en leads sin member_id (actividad que no entra en métricas de equipo)."""
    from src.models import Lead

    members = members_for_user(uid)
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for lead in rows_for_user(Lead, uid):
        for role in ("setter", "closer"):
            if getattr(lead, f"{role}_member_id", None):
                continue
            raw = (getattr(lead, role, None) or "").strip()
            if not raw or not looks_like_person_name(raw):
                continue
            if resolve_member_id(raw, members, preferred_rol=role):
                continue
            key = (norm_person_key(raw), role)
            acc = seen.get(key)
            if acc is None:
                seen[key] = {"nombre": raw, "rol": role, "leads": 1}
            else:
                acc["leads"] += 1
    out = list(seen.values())
    out.sort(key=lambda r: (-int(r["leads"]), str(r["nombre"]).casefold(), str(r["rol"])))
    return out


def backfill_lead_member_ids_in_session(uid: int | None = None) -> int:
    """Completa IDs sin tocar el nombre guardado. Devuelve cuántos leads se vincularon."""
    from src.models import Lead

    by_user: dict[int, list[TeamMember]] = {}
    for m in TeamMember.select():
        if uid is not None and int(m.user_id) != int(uid):
            continue
        by_user.setdefault(int(m.user_id), []).append(m)
    filled = 0
    leads = Lead.select() if uid is None else rows_for_user(Lead, int(uid))
    for lead in leads:
        members = by_user.get(int(lead.user_id), [])
        if not members:
            continue
        changed = False
        if not getattr(lead, "setter_member_id", None) and (lead.setter or "").strip():
            mid = resolve_member_id(lead.setter, members, preferred_rol="setter")
            if mid:
                lead.setter_member_id = mid
                changed = True
        if not getattr(lead, "closer_member_id", None) and (lead.closer or "").strip():
            mid = resolve_member_id(lead.closer, members, preferred_rol="closer")
            if mid:
                lead.closer_member_id = mid
                changed = True
        if changed:
            filled += 1
    return filled


def backfill_lead_member_ids(uid: int | None = None) -> int:
    from pony.orm import db_session

    with db_session:
        filled = backfill_lead_member_ids_in_session(uid)
        if filled:
            print(f"[db] member_id completado en {filled} lead(s)")
        return filled
