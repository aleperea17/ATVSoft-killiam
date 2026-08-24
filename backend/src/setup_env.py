"""Lectura de `backend/.env` y helpers de conexión a Postgres."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = _BACKEND_DIR / ".env"


def bootstrap_environment() -> None:
    """Carga `backend/.env` en `os.environ` antes de importar módulos que usan decouple.

    Si falta el archivo o `MANYCHAT_WEBHOOK_TOKEN`, crea/actualiza `.env` (obligatorio para arrancar).
    """
    parsed = _parse_env_file()
    changed = False
    if not (parsed.get("MANYCHAT_WEBHOOK_TOKEN") or os.environ.get("MANYCHAT_WEBHOOK_TOKEN") or "").strip():
        parsed["MANYCHAT_WEBHOOK_TOKEN"] = secrets.token_hex(32)
        changed = True
    if not ENV_PATH.is_file():
        parsed.setdefault("JWT_SECRET", secrets.token_urlsafe(32))
        parsed.setdefault("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
        parsed.setdefault("REGISTER_ADMIN_KEY", secrets.token_urlsafe(24))
        changed = True
    if changed:
        _write_env_map(parsed)
    for key, value in _parse_env_file().items():
        os.environ.setdefault(key, value)


def _write_env_map(values: dict[str, str]) -> None:
    """Persiste variables en backend/.env (sin borrar comentarios de plantilla si el archivo no existía)."""
    if ENV_PATH.is_file():
        merged = _parse_env_file()
        merged.update(values)
        values = merged
    lines = ["# backend/.env — no commitear"]
    for key in sorted(values.keys()):
        lines.append(f"{key}={values[key]}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _parse_env_file() -> dict[str, str]:
    if not ENV_PATH.is_file():
        return {}
    out: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def get_database_url() -> str:
    env = _parse_env_file()
    url = (env.get("DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    return url


def load_db_bind_kwargs() -> dict | None:
    """Argumentos para `db.bind()` si hay configuración.

    Soporta dos modos permanentes:
      a) `DATABASE_URL` (p. ej. Neon en desarrollo/pruebas)
      b) variables sueltas `DB_PROVIDER` + `DB_HOST` (+ user/pass/name) para Postgres local/Docker
    """
    url = get_database_url()
    if url:
        return {"provider": "postgres", "dsn": url}

    env = _parse_env_file()
    provider = (env.get("DB_PROVIDER") or os.environ.get("DB_PROVIDER") or "").strip()
    host = (env.get("DB_HOST") or os.environ.get("DB_HOST") or "").strip()
    if not provider or not host:
        return None

    return {
        "provider": provider,
        "user": env.get("DB_USER") or os.environ.get("DB_USER") or "",
        "password": env.get("DB_PASS") or os.environ.get("DB_PASS") or "",
        "host": host,
        "database": env.get("DB_NAME") or os.environ.get("DB_NAME") or "",
    }


def is_db_configured() -> bool:
    """True si hay DB usable: misma lógica que `load_db_bind_kwargs()` (URL o DB_*)."""
    return load_db_bind_kwargs() is not None
