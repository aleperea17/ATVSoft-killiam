"""Consultas Pony compatibles con Python 3.13.

En Py 3.13 las lambdas `entity.select(lambda r: r.user_id == uid)` no filtran bien
(decompilación rota). Filtramos con SQL `WHERE user_id = $uid` vía `select_by_sql`.
"""

from __future__ import annotations

import re
from datetime import date
from typing import TypeVar

from pony.orm import ObjectNotFound

T = TypeVar("T")

_SAFE_TABLE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _entity_table_name(entity: type) -> str:
    explicit = getattr(entity, "_table_", None)
    if explicit:
        name = str(explicit)
    else:
        name = str(getattr(entity, "__name__", "")).lower()
    if not _SAFE_TABLE.fullmatch(name):
        raise ValueError(f"Nombre de tabla inválido para {entity!r}: {name!r}")
    return name


def _rows_via_pk_lookup(entity: type[T], uid: int) -> list[T]:
    """Fallback cuando SELECT * falla por columnas huérfanas en la BD."""
    from src.db import db

    tbl = _entity_table_name(entity)
    sql = f"e.id FROM {tbl} e WHERE e.user_id = $uid"
    id_rows = db.select(sql, globals(), {"uid": uid})
    out: list[T] = []
    for raw_id in id_rows:
        try:
            out.append(entity[int(raw_id)])  # type: ignore[index]
        except (ObjectNotFound, TypeError, ValueError):
            continue
    return out


def rows_for_user(entity: type[T], user_id: int) -> list[T]:
    """Filas de `entity` del usuario, con `WHERE user_id` en Postgres (usa índice)."""
    uid = int(user_id)
    tbl = _entity_table_name(entity)
    sql = f"SELECT * FROM {tbl} WHERE user_id = $uid"
    try:
        return list(entity.select_by_sql(sql, {"uid": uid}))  # type: ignore[attr-defined]
    except (NameError, TypeError, ValueError):
        # Drift de esquema (columnas en BD no mapeadas) → ids + carga por PK.
        return _rows_via_pk_lookup(entity, uid)


def filter_date_range(rows: list[T], *, desde: date, hasta: date, attr: str = "fecha") -> list[T]:
    return [r for r in rows if desde <= getattr(r, attr) <= hasta]
