"""Valores mostrados en UI cuando ManyChat envía solo placeholders y `nombre` queda vacío."""

from datetime import datetime

# El sync de calendario puede nacer o quedarse en estos estados. Cualquier otro
# (Cerrado, No show, Seguimiento, …) es trabajo del equipo y no se pisa.
SYNC_OPEN_STATUSES = frozenset(("", "Agendado", "Pendiente"))


def lead_status_is_open_for_sync(status: str | None) -> bool:
    return (status or "").strip() in SYNC_OPEN_STATUSES


def set_status_agendado_if_open(row: object) -> None:
    current = getattr(row, "status", None)
    if lead_status_is_open_for_sync(current if isinstance(current, str) else None):
        setattr(row, "status", "Agendado")


def fill_str_if_empty(current: str | None, incoming: str | None) -> str:
    cur = (current or "").strip()
    if cur:
        return current or ""
    return (incoming or "").strip()


def compute_dias_para_agendar(
    primer_contacto: datetime | None,
    agendo: datetime | None,
) -> int | None:
    """Días calendario desde 1er contacto hasta que completó el formulario Calendly (`agendo`)."""
    if primer_contacto is None or agendo is None:
        return None
    p = primer_contacto.replace(tzinfo=None) if primer_contacto.tzinfo else primer_contacto
    a = agendo.replace(tzinfo=None) if agendo.tzinfo else agendo
    return max(0, (a.date() - p.date()).days)


def lead_display_nombre(nombre: str | None, ig: str | None) -> str:
    n = (nombre or "").strip()
    if n:
        return n
    return (ig or "").strip()
