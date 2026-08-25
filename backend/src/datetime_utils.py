"""Datetimes naive UTC para columnas Pony/`timestamp without time zone`."""

from __future__ import annotations

from datetime import datetime, timezone


def naive_utc(dt: datetime | None) -> datetime | None:
    """Convierte a UTC y quita tzinfo. None se conserva.

    Postgres guarda `Lead.call` / `Lead.agendo` como timestamp naive. Si Pony
    flushea un datetime aware, al releerlo lo ve distinto y aborta con
    UnrepeatableReadError. `astimezone` (no `replace`) preserva el instante
    si el origen no es UTC.
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt
