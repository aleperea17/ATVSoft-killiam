"""Filtro de event types de Calendly (allowlist editable en ApiConnection.credentials)."""

from __future__ import annotations

import json
from typing import Any, Callable

CALENDLY_EVENT_TYPE_ALLOWLIST_KEY = "event_type_allowlist"
_CALENDLY_PRESERVE_KEYS = (
    CALENDLY_EVENT_TYPE_ALLOWLIST_KEY,
    "last_check_at",
    "last_check_has_pending",
)


def normalize_event_type_uri(uri: str) -> str:
    return (uri or "").strip().rstrip("/")


def normalize_event_type_allowlist(value: Any) -> list[str]:
    """Acepta list[str], JSON string, o un URI suelto. Dedup preservando orden."""
    raw: list[Any]
    if value is None:
        raw = []
    elif isinstance(value, list):
        raw = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raw = []
        elif text.startswith("["):
            try:
                parsed = json.loads(text)
            except Exception:
                parsed = [text]
            raw = parsed if isinstance(parsed, list) else [text]
        else:
            raw = [part.strip() for part in text.split(",") if part.strip()]
    else:
        raw = []

    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        uri = normalize_event_type_uri(str(item or ""))
        if not uri or uri in seen:
            continue
        seen.add(uri)
        out.append(uri)
    return out


def event_type_in_allowlist(event_type: str, allowlist: list[str]) -> bool:
    needle = normalize_event_type_uri(event_type)
    if not needle:
        return False
    allowed = {normalize_event_type_uri(u) for u in allowlist}
    return needle in allowed


def sanitize_calendly_credentials(creds: dict[str, Any]) -> dict[str, Any]:
    """Persiste PAT, signing key y allowlist. No convierte la lista a string."""
    out: dict[str, Any] = {}
    if "api_key" in creds:
        out["api_key"] = "" if creds.get("api_key") is None else str(creds.get("api_key"))
    if "signing_key" in creds:
        out["signing_key"] = "" if creds.get("signing_key") is None else str(creds.get("signing_key"))
    if CALENDLY_EVENT_TYPE_ALLOWLIST_KEY in creds:
        out[CALENDLY_EVENT_TYPE_ALLOWLIST_KEY] = normalize_event_type_allowlist(
            creds.get(CALENDLY_EVENT_TYPE_ALLOWLIST_KEY)
        )
    return out


def merge_calendly_credentials(previous: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Un guardado de Conexiones (solo api_key/signing_key) no debe borrar la allowlist."""
    sanitized = sanitize_calendly_credentials(incoming)
    prev_allow = normalize_event_type_allowlist(previous.get(CALENDLY_EVENT_TYPE_ALLOWLIST_KEY))
    new_allow = normalize_event_type_allowlist(sanitized.get(CALENDLY_EVENT_TYPE_ALLOWLIST_KEY))
    if not new_allow and prev_allow:
        sanitized[CALENDLY_EVENT_TYPE_ALLOWLIST_KEY] = prev_allow
    for key in _CALENDLY_PRESERVE_KEYS:
        if key == CALENDLY_EVENT_TYPE_ALLOWLIST_KEY:
            continue
        if key not in sanitized and key in previous:
            sanitized[key] = previous[key]
    return sanitized


def event_type_from_nested_scheduled_event(src: dict[str, Any] | None) -> str:
    if not isinstance(src, dict):
        return ""
    scheduled = src.get("scheduled_event")
    if not isinstance(scheduled, dict):
        return ""
    raw = scheduled.get("event_type")
    if isinstance(raw, str):
        return normalize_event_type_uri(raw)
    if isinstance(raw, dict):
        return normalize_event_type_uri(str(raw.get("uri") or ""))
    return ""


def scheduled_event_uri_from_payload(inner: dict[str, Any], flat: dict[str, Any]) -> str:
    for src in (inner, flat):
        if not isinstance(src, dict):
            continue
        scheduled = src.get("scheduled_event")
        if isinstance(scheduled, dict):
            uri = str(scheduled.get("uri") or "").strip()
            if uri.startswith("http"):
                return uri
        event = src.get("event")
        if isinstance(event, str) and "/scheduled_events/" in event:
            return event.strip()
    return ""


def resolve_invitee_event_type(
    inner: dict[str, Any],
    flat: dict[str, Any],
    *,
    api_key: str,
    fetch_scheduled_event_type: Callable[[str, str], str | None],
) -> tuple[str | None, str]:
    """Devuelve (event_type | None, motivo). None = no se pudo resolver (fail closed)."""
    for src in (flat, inner):
        found = event_type_from_nested_scheduled_event(src)
        if found:
            return found, "payload.scheduled_event.event_type"
    event_uri = scheduled_event_uri_from_payload(inner, flat)
    if not event_uri:
        return None, "sin URI de scheduled_event (payload.event / scheduled_event.uri)"
    if not (api_key or "").strip():
        return None, "falta api_key para GET del scheduled_event"
    fetched = fetch_scheduled_event_type(event_uri, api_key.strip())
    if fetched is None:
        return None, f"GET {event_uri} falló"
    if not fetched:
        return None, f"GET {event_uri} sin resource.event_type"
    return fetched, f"GET {event_uri}"
