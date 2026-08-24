"""Zona horaria y config de tenant (CompanyConfig singleton id=1)."""

from __future__ import annotations

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pony.orm import db_session

from src.models import CompanyConfig

TZ_ARGENTINA = "America/Argentina/Buenos_Aires"
TZ_SPAIN = "Europe/Madrid"
ALLOWED_TIMEZONES = (TZ_ARGENTINA, TZ_SPAIN)
DEFAULT_TIMEZONE = TZ_ARGENTINA
DEFAULT_COMPANY_NAME = "ATV"

MODULE_KEYS = (
    "module_reels",
    "module_historias",
    "module_youtube",
    "module_bio",
    "module_keywords",
    "module_marketing_dashboard",
)

_tz_cache: ZoneInfo | None = None


def normalize_timezone(name: str | None) -> str:
    raw = (name or "").strip()
    if raw in ALLOWED_TIMEZONES:
        return raw
    return DEFAULT_TIMEZONE


def invalidate_tz_cache() -> None:
    global _tz_cache
    _tz_cache = None


@db_session
def ensure_company_config() -> None:
    row = CompanyConfig.get(id=1)
    if row is None:
        CompanyConfig(
            id=1,
            company_name=DEFAULT_COMPANY_NAME,
            timezone=DEFAULT_TIMEZONE,
            reserva_cash_usd=0,
            call_reports_password="",
            module_reels=True,
            module_historias=True,
            module_youtube=True,
            module_bio=True,
            module_keywords=True,
            module_marketing_dashboard=True,
        )
        invalidate_tz_cache()
        return
    tz = str(getattr(row, "timezone", "") or "").strip()
    if tz not in ALLOWED_TIMEZONES:
        row.timezone = DEFAULT_TIMEZONE
        invalidate_tz_cache()


def _module_flags(row: CompanyConfig | None) -> dict[str, bool]:
    return {key: True if row is None else bool(getattr(row, key, True)) for key in MODULE_KEYS}


@db_session
def get_effective_call_reports_password() -> str:
    """Password del gate: CompanyConfig manda; env es fallback. Ambos vacíos = gate off."""
    ensure_company_config()
    row = CompanyConfig.get(id=1)
    cfg = (getattr(row, "call_reports_password", None) or "").strip() if row else ""
    if cfg:
        return cfg
    return (os.environ.get("CALL_REPORTS_VIEW_PASSWORD") or "").strip()


@db_session
def get_company_config_dict(*, include_private: bool = False) -> dict:
    ensure_company_config()
    row = CompanyConfig.get(id=1)
    tz = normalize_timezone(getattr(row, "timezone", None) if row else None)
    reserva = float(getattr(row, "reserva_cash_usd", 0) or 0) if row else 0.0
    cfg_pw = (getattr(row, "call_reports_password", None) or "").strip() if row else ""
    data = {
        "company_name": ((row.company_name if row else None) or DEFAULT_COMPANY_NAME),
        "company_tagline": ((row.company_tagline if row else None) or ""),
        "logo_url": ((row.logo_url if row else None) or ""),
        "timezone": tz,
        "reserva_cash_usd": reserva,
        "timezone_options": [
            {"id": TZ_ARGENTINA, "label": "Argentina"},
            {"id": TZ_SPAIN, "label": "España"},
        ],
        **_module_flags(row),
    }
    if include_private:
        env_pw = (os.environ.get("CALL_REPORTS_VIEW_PASSWORD") or "").strip()
        data["call_reports_gate"] = bool(cfg_pw or env_pw)
        data["call_reports_password_set"] = bool(cfg_pw)
    return data


def get_company_config_public_dict() -> dict:
    data = get_company_config_dict()
    return {
        "company_name": data["company_name"],
        "company_tagline": data["company_tagline"],
        "logo_url": data["logo_url"],
    }


@db_session
def update_company_config(patch: dict) -> dict:
    ensure_company_config()
    row = CompanyConfig.get(id=1)
    if row is None:
        raise ValueError("No hay configuración de empresa")

    tz_changed = False
    if "company_name" in patch and patch["company_name"] is not None:
        name = str(patch["company_name"]).strip()
        if not name:
            raise ValueError("El nombre de la empresa no puede estar vacío")
        row.company_name = name
    if "company_tagline" in patch and patch["company_tagline"] is not None:
        row.company_tagline = str(patch["company_tagline"]).strip()
    if "logo_url" in patch and patch["logo_url"] is not None:
        logo = str(patch["logo_url"]).strip()
        if logo and not (
            logo.startswith("http://") or logo.startswith("https://") or logo.startswith("/")
        ):
            raise ValueError("La URL del logo debe ser http(s) o una ruta que empiece con /")
        row.logo_url = logo
    if "timezone" in patch and patch["timezone"] is not None:
        raw = str(patch["timezone"]).strip()
        if raw not in ALLOWED_TIMEZONES:
            raise ValueError("Zona horaria no válida. Usá Argentina o España.")
        if raw != str(row.timezone or ""):
            tz_changed = True
        row.timezone = raw
    if "reserva_cash_usd" in patch and patch["reserva_cash_usd"] is not None:
        try:
            reserva = float(patch["reserva_cash_usd"])
        except (TypeError, ValueError) as exc:
            raise ValueError("Reserva cash inválida") from exc
        if reserva < 0:
            raise ValueError("La reserva cash no puede ser negativa")
        row.reserva_cash_usd = reserva
    if patch.get("clear_call_reports_password"):
        row.call_reports_password = ""
    elif "call_reports_password" in patch and patch["call_reports_password"] is not None:
        new_pw = str(patch["call_reports_password"]).strip()
        if new_pw:
            row.call_reports_password = new_pw
    for key in MODULE_KEYS:
        if key in patch and patch[key] is not None:
            setattr(row, key, bool(patch[key]))

    row.updated_at = datetime.utcnow()
    if tz_changed:
        invalidate_tz_cache()
    return get_company_config_dict(include_private=True)


def get_timezone_name() -> str:
    try:
        return str(get_company_config_dict()["timezone"])
    except Exception:
        return DEFAULT_TIMEZONE


def get_tenant_tz() -> ZoneInfo:
    global _tz_cache
    if _tz_cache is not None:
        return _tz_cache
    name = get_timezone_name()
    try:
        _tz_cache = ZoneInfo(name)
    except ZoneInfoNotFoundError:
        _tz_cache = ZoneInfo(DEFAULT_TIMEZONE)
    return _tz_cache


def today_local() -> date:
    return datetime.now(get_tenant_tz()).date()


def now_local() -> datetime:
    return datetime.now(get_tenant_tz())


def get_reserva_cash_usd() -> float:
    try:
        return float(get_company_config_dict().get("reserva_cash_usd") or 0)
    except Exception:
        return 0.0
