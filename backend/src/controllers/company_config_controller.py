from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from src.services.company_config_service import (
    get_company_config_dict,
    get_company_config_public_dict,
    get_effective_call_reports_password,
    update_company_config,
)

router = APIRouter(prefix="/api/company-config", tags=["company-config"])


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


class TimezoneOptionOut(BaseModel):
    id: str
    label: str


class CompanyConfigPublicOut(BaseModel):
    company_name: str
    company_tagline: str = ""
    logo_url: str = ""


class CompanyConfigOut(BaseModel):
    company_name: str
    company_tagline: str = ""
    logo_url: str = ""
    timezone: str
    reserva_cash_usd: float = 0
    timezone_options: list[TimezoneOptionOut]
    call_reports_gate: bool = False
    call_reports_password_set: bool = False
    module_reels: bool = True
    module_historias: bool = True
    module_youtube: bool = True
    module_bio: bool = True
    module_keywords: bool = True
    module_marketing_dashboard: bool = True


class CompanyConfigPatch(BaseModel):
    company_name: str | None = None
    company_tagline: str | None = None
    logo_url: str | None = None
    timezone: str | None = None
    reserva_cash_usd: float | None = None
    call_reports_password: str | None = None
    clear_call_reports_password: bool = False
    module_reels: bool | None = None
    module_historias: bool | None = None
    module_youtube: bool | None = None
    module_bio: bool | None = None
    module_keywords: bool | None = None
    module_marketing_dashboard: bool | None = None


class UnlockCallsBody(BaseModel):
    password: str = ""


@router.get("/public", response_model=CompanyConfigPublicOut)
def get_company_config_public() -> CompanyConfigPublicOut:
    return CompanyConfigPublicOut(**get_company_config_public_dict())


@router.get("", response_model=CompanyConfigOut)
def get_company_config(
    _user_id: Annotated[str, Depends(require_user_id)],
) -> CompanyConfigOut:
    data = get_company_config_dict(include_private=True)
    return CompanyConfigOut(**data)


@router.patch("", response_model=CompanyConfigOut)
def patch_company_config(
    body: CompanyConfigPatch,
    _user_id: Annotated[str, Depends(require_user_id)],
) -> CompanyConfigOut:
    patch = body.model_dump(exclude_unset=True)
    try:
        data = update_company_config(patch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CompanyConfigOut(**data)


@router.post("/unlock-calls")
def unlock_calls(
    body: UnlockCallsBody,
    _user_id: Annotated[str, Depends(require_user_id)],
) -> dict:
    expected = get_effective_call_reports_password()
    if not expected:
        return {"ok": True, "gate": "disabled"}
    if (body.password or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Contraseña incorrecta.")
    return {"ok": True}
