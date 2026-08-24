from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from src.schemas import (
    CobranzasLeadOption,
    CobranzasLeadRow,
    CobranzasViewResponse,
    ContratoPatchRequest,
    LeadPaymentCreateRequest,
    LeadPaymentOut,
    LeadPaymentPatchRequest,
    VencimientoPatchRequest,
)
from src.services.payment_service import (
    create_payment,
    delete_payment,
    get_cobranzas_view,
    list_payments_for_lead,
    list_payments_for_month,
    patch_contrato,
    patch_payment,
    patch_vencimiento,
    search_lead_options,
)

router = APIRouter(prefix="/api/cobranzas", tags=["cobranzas"], redirect_slashes=False)


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _parse_uid(user_id: str) -> int:
    try:
        return int(user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.") from e


@router.get("", response_model=CobranzasViewResponse)
def cobranzas_view(user_id: Annotated[str, Depends(require_user_id)]) -> CobranzasViewResponse:
    """Leads con saldo o sin precio de contrato. No filtra por agenda."""
    return get_cobranzas_view(_parse_uid(user_id))


@router.get("/lead-options", response_model=list[CobranzasLeadOption])
def cobranzas_lead_options(
    user_id: Annotated[str, Depends(require_user_id)],
    q: str = Query(default=""),
) -> list[CobranzasLeadOption]:
    return search_lead_options(_parse_uid(user_id), q)


@router.get("/pagos", response_model=list[LeadPaymentOut])
def list_pagos(
    user_id: Annotated[str, Depends(require_user_id)],
    lead_id: int = Query(..., ge=1),
) -> list[LeadPaymentOut]:
    return list_payments_for_lead(_parse_uid(user_id), lead_id)


@router.get("/pagos-mes", response_model=list[LeadPaymentOut])
def list_pagos_mes(
    user_id: Annotated[str, Depends(require_user_id)],
    month: str = Query(..., description="YYYY-MM"),
) -> list[LeadPaymentOut]:
    return list_payments_for_month(_parse_uid(user_id), month)


@router.post("/pagos", response_model=LeadPaymentOut)
def create_pago(
    body: LeadPaymentCreateRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadPaymentOut:
    return create_payment(_parse_uid(user_id), body)


@router.patch("/pagos/{payment_id}", response_model=LeadPaymentOut)
def patch_pago(
    payment_id: int,
    body: LeadPaymentPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> LeadPaymentOut:
    return patch_payment(_parse_uid(user_id), payment_id, body)


@router.delete("/pagos/{payment_id}")
def delete_pago(
    payment_id: int,
    user_id: Annotated[str, Depends(require_user_id)],
) -> dict[str, str]:
    return delete_payment(_parse_uid(user_id), payment_id)


@router.patch("/leads/{lead_id}/contrato", response_model=CobranzasLeadRow)
def patch_lead_contrato(
    lead_id: int,
    body: ContratoPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CobranzasLeadRow:
    return patch_contrato(_parse_uid(user_id), lead_id, body)


@router.patch("/leads/{lead_id}/vencimiento", response_model=CobranzasLeadRow)
def patch_lead_vencimiento(
    lead_id: int,
    body: VencimientoPatchRequest,
    user_id: Annotated[str, Depends(require_user_id)],
) -> CobranzasLeadRow:
    return patch_vencimiento(_parse_uid(user_id), lead_id, body)
