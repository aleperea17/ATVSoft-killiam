import re
import unicodedata
from datetime import datetime

from fastapi import HTTPException
from pony.orm import db_session, flush

from src.db_query_utils import rows_for_user
from src.models import ApiConnection, AuthUser, AvatarType, Lead, OfferedProgram
from src.schemas import (
    AvatarTypeCreateRequest,
    AvatarTypeOut,
    AvatarTypePatchRequest,
    AvatarTypesListResponse,
)

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

DEFAULT_AVATARS: list[tuple[str, str]] = [
    ("Experto en info", "#3B82F6"),
    ("Dueño de agencia", "#A855F7"),
    ("Dueño de negocio", "#F59E0B"),
    ("Habilidades de alto valor", "#EC4899"),
    ("Creador de contenido", "#22C55E"),
    ("Creador con infoproducto", "#06B6D4"),
    ("Otro", "#6B7280"),
]


def normalize_avatar_lookup_key(name: str) -> str:
    """Coincide con la lógica del front (acentos / mayúsculas / espacios)."""
    t = unicodedata.normalize("NFD", (name or "").strip())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.casefold().split())


def _valid_hex_color(raw: str | None) -> str:
    s = (raw or "").strip()
    if _HEX_COLOR_RE.match(s):
        return s
    return "#6B7280"


class AvatarsServices:
    def _rows_for_user(self, uid: int) -> list[AvatarType]:
        return rows_for_user(AvatarType, uid)

    def _nombre_taken(self, uid: int, nombre: str, exclude_id: int | None = None) -> bool:
        key = normalize_avatar_lookup_key(nombre)
        if not key:
            return False
        for row in self._rows_for_user(uid):
            if exclude_id is not None and int(row.id) == exclude_id:
                continue
            if normalize_avatar_lookup_key(row.nombre or "") == key:
                return True
        return False

    def _next_sort_order(self, uid: int) -> int:
        rows = self._rows_for_user(uid)
        if not rows:
            return 0
        return max(int(r.sort_order or 0) for r in rows) + 1

    def _to_out(self, row: AvatarType) -> AvatarTypeOut:
        return AvatarTypeOut(
            id=int(row.id),
            nombre=str(row.nombre or "").strip(),
            color=_valid_hex_color(row.color),
            activo=bool(row.activo),
            sort_order=int(row.sort_order or 0),
        )

    def _lead_count_using_avatar(self, uid: int, nombre: str) -> int:
        key = normalize_avatar_lookup_key(nombre)
        if not key:
            return 0
        count = 0
        for lead in rows_for_user(Lead, uid):
            av = normalize_avatar_lookup_key(lead.avatar or "")
            if av and av == key:
                count += 1
        return count

    def list_for_user(self, user_id: int) -> AvatarTypesListResponse:
        try:
            with db_session:
                rows = sorted(
                    self._rows_for_user(user_id),
                    key=lambda r: (int(r.sort_order or 0), int(r.id)),
                )
                avatars = [self._to_out(r) for r in rows]
            return AvatarTypesListResponse(avatars=avatars)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al leer avatares.") from None

    def create(self, user_id: int, body: AvatarTypeCreateRequest) -> AvatarTypeOut:
        nombre = (body.nombre or "").strip()
        if not nombre:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
        color = _valid_hex_color(body.color)
        try:
            with db_session:
                if self._nombre_taken(user_id, nombre):
                    raise HTTPException(status_code=400, detail="Ya existe un avatar con ese nombre.")
                row = AvatarType(
                    user_id=user_id,
                    nombre=nombre,
                    color=color,
                    activo=bool(body.activo),
                    sort_order=self._next_sort_order(user_id),
                    created_at=datetime.utcnow(),
                )
                flush()
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al crear avatar.") from None

    def update(
        self,
        user_id: int,
        avatar_id: int,
        body: AvatarTypePatchRequest,
    ) -> AvatarTypeOut:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == avatar_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Avatar no encontrado.")
                row = rows[0]
                if body.nombre is not None:
                    nn = body.nombre.strip()
                    if not nn:
                        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
                    if self._nombre_taken(user_id, nn, exclude_id=avatar_id):
                        raise HTTPException(status_code=400, detail="Ya existe un avatar con ese nombre.")
                    row.nombre = nn
                if body.color is not None:
                    row.color = _valid_hex_color(body.color)
                if body.activo is not None:
                    row.activo = bool(body.activo)
                if body.sort_order is not None:
                    row.sort_order = int(body.sort_order)
                return self._to_out(row)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al actualizar avatar.") from None

    def delete(self, user_id: int, avatar_id: int) -> AvatarTypesListResponse:
        try:
            with db_session:
                rows = [r for r in self._rows_for_user(user_id) if int(r.id) == avatar_id]
                if not rows:
                    raise HTTPException(status_code=404, detail="Avatar no encontrado.")
                row = rows[0]
                in_use = self._lead_count_using_avatar(user_id, row.nombre or "")
                if in_use > 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"No se puede eliminar: hay {in_use} lead(s) con este avatar.",
                    )
                row.delete()
            return self.list_for_user(user_id)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Error al eliminar avatar.") from None


def seed_default_avatars_for_user(user_id: int) -> None:
    """Inserta los 7 avatares genéricos si el usuario aún no tiene catálogo.

    Debe llamarse dentro de `db_session`.
    """
    uid = int(user_id)
    if any(int(a.user_id) == uid for a in AvatarType.select()):
        return
    now = datetime.utcnow()
    for i, (nombre, color) in enumerate(DEFAULT_AVATARS):
        AvatarType(
            user_id=uid,
            nombre=nombre,
            color=color,
            activo=True,
            sort_order=i,
            created_at=now,
        )


def seed_default_avatars_for_existing_users() -> None:
    """Inserta avatares hardcodeados legacy para cada usuario que aún no tiene catálogo."""
    try:
        with db_session:
            user_ids: set[int] = set()
            for u in list(AuthUser.select()):
                user_ids.add(int(u.id))
            for row in list(Lead.select()):
                user_ids.add(int(row.user_id))
            for row in list(ApiConnection.select()):
                user_ids.add(int(row.user_id))
            for row in list(OfferedProgram.select()):
                user_ids.add(int(row.user_id))

            for uid in user_ids:
                seed_default_avatars_for_user(uid)
    except Exception:
        return
