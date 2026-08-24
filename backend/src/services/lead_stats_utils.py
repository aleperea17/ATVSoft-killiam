"""Agregaciones de leads en batch (evita N consultas por reel/historia/video)."""

from __future__ import annotations

from dataclasses import dataclass

from pony.orm import db_session

from src.db import db
from src.models import Lead


@dataclass(frozen=True)
class AgendaStats:
    agendas: int
    cash: float


_EMPTY = AgendaStats(0, 0.0)


def _lead_table() -> str:
    return Lead._table_ or "lead"


def load_user_agenda_stats(user_id: int) -> dict[str, AgendaStats]:
    """Cuenta agendas y suma pagos por punto_agenda (trim) para un usuario."""
    tbl = _lead_table()
    sql = f"""trim(both from coalesce(l.punto_agenda, '')) AS tid,
COUNT(*) AS agendas,
coalesce(sum(coalesce(l.pago, 0)), 0) AS cash
FROM {tbl} l
WHERE l.user_id = $user_id
AND trim(both from coalesce(l.punto_agenda, '')) <> ''
GROUP BY tid"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id})
    out: dict[str, AgendaStats] = {}
    for row in rows:
        tid = str(getattr(row, "tid", "") or "").strip()
        if not tid:
            continue
        out[tid] = AgendaStats(
            agendas=int(getattr(row, "agendas", 0) or 0),
            cash=float(getattr(row, "cash", 0) or 0),
        )
    return out


def agenda_stats_for(out: dict[str, AgendaStats], agenda_id: str) -> AgendaStats:
    return out.get(str(agenda_id).strip(), _EMPTY)


def load_user_keyword_lead_counts(user_id: int) -> dict[str, int]:
    """Cuenta leads por token de keyword (case-insensitive, coma-separado en BD)."""
    tbl = _lead_table()
    sql = f"""lower(trim(both from t.part)) AS kw,
COUNT(*) AS leads
FROM {tbl} l,
unnest(string_to_array(coalesce(l.keyword, ''), ',')) AS t(part)
WHERE l.user_id = $user_id
AND trim(both from t.part) <> ''
GROUP BY kw"""
    with db_session:
        rows = db.select(sql, globals(), {"user_id": user_id})
    out: dict[str, int] = {}
    for row in rows:
        kw = str(getattr(row, "kw", "") or "").strip()
        if kw:
            out[kw] = int(getattr(row, "leads", 0) or 0)
    return out


def keyword_lead_count(out: dict[str, int], keyword: str | None) -> int:
    kw = (keyword or "").strip().lower()
    if not kw:
        return 0
    return int(out.get(kw, 0))
