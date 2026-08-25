"""Un reintento de `db_session` ante UnrepeatableReadError (colisión, no el bug de tz)."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from pony.orm.core import UnrepeatableReadError

T = TypeVar("T")


def once_on_unrepeatable_read(operation: Callable[[], T], *, log_label: str) -> T:
    """Corre `operation` y, si Pony aborta por lectura no repetible, reintenta una vez.

    El segundo fallo se propaga (p. ej. 500 al webhook de Calendly). No es el
    fix de datetime aware/naive: es red de seguridad para dos escritores.
    """
    try:
        return operation()
    except UnrepeatableReadError:
        print(f"[{log_label}] UnrepeatableReadError; reintento único", flush=True)
        return operation()
