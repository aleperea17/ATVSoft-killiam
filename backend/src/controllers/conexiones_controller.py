from typing import Annotated

from decouple import config
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from src.schemas import ApiConnectionResponse, ApiConnectionUpsertRequest
from src.services.conexiones_services import ConexionesServices

router = APIRouter(prefix="/conexiones", tags=["conexiones"])
service = ConexionesServices()


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> int:
    """Mismo criterio que leads/reels: header X-User-Id de la sesión frontend."""
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    try:
        return int(x_user_id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="X-User-Id inválido") from exc


class ManychatWebhookInfoResponse(BaseModel):
    webhook_url: str
    webhook_token: str


class CalendlyWebhookInfoResponse(BaseModel):
    webhook_url: str


def _public_site_url() -> str:
    for key in ("PUBLIC_SITE_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL"):
        raw = (config(key, default="") or "").strip()
        if raw:
            return raw.rstrip("/")
    cors = (config("CORS_ORIGINS", default="http://localhost:3000") or "").split(",")[0].strip()
    return cors.rstrip("/") if cors else "http://localhost:3000"


@router.get("/manychat-webhook-info", response_model=ManychatWebhookInfoResponse)
def manychat_webhook_info(
    _user_id: Annotated[int, Depends(require_user_id)],
) -> ManychatWebhookInfoResponse:
    """URL y token que ManyChat debe usar (token = MANYCHAT_WEBHOOK_TOKEN de la instancia)."""
    try:
        token = (config("MANYCHAT_WEBHOOK_TOKEN") or "").strip()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="MANYCHAT_WEBHOOK_TOKEN no configurado en el servidor.",
        ) from exc
    if not token:
        raise HTTPException(
            status_code=500,
            detail="MANYCHAT_WEBHOOK_TOKEN no configurado en el servidor.",
        )
    base = _public_site_url()
    return ManychatWebhookInfoResponse(
        webhook_url=f"{base}/webhooks/manychat",
        webhook_token=token,
    )


@router.get("/calendly-webhook-info", response_model=CalendlyWebhookInfoResponse)
def calendly_webhook_info(
    _user_id: Annotated[int, Depends(require_user_id)],
) -> CalendlyWebhookInfoResponse:
    """URL pública del webhook Calendly (SITE_URL / dominio del backend)."""
    base = _public_site_url()
    return CalendlyWebhookInfoResponse(webhook_url=f"{base}/webhooks/calendly")


@router.get("", response_model=list[ApiConnectionResponse])
def list_conexiones(user_id: Annotated[int, Depends(require_user_id)]) -> list[ApiConnectionResponse]:
    try:
        return service.list_by_user(user_id)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Error inesperado al listar las conexiones.",
        )


@router.put("/{platform}", response_model=ApiConnectionResponse)
def upsert_conexion(
    platform: str,
    body: ApiConnectionUpsertRequest,
    user_id: Annotated[int, Depends(require_user_id)],
) -> ApiConnectionResponse:
    try:
        return service.upsert(user_id, platform, body)
    except HTTPException as e:
        raise e
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Error inesperado al guardar la conexión.",
        )
