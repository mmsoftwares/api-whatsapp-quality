"""Endpoint para registrar ocorrências enviadas pelo WhatsApp."""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from functions.save_ocorrencia import save_ocorrencia_texto
from functions.db_client import get_client_db

router = APIRouter()


class OcorrenciaRequest(BaseModel):
    """Modelo de entrada para ocorrência."""
    nomovtra: int = Field(..., description="Número do pedido/entrega (NOMOVTRA)")
    texto: str = Field(..., description="Descrição da ocorrência")
    usuario: str = Field(..., description="Identificação do usuário (CPF, CNPJ ou BOT)")


@router.post("/ocorrencia")
async def registrar_ocorrencia(
    req: OcorrenciaRequest,
    to_biz: str = Header(..., alias="x-whatsapp-number"),
) -> dict:
    """Grava a ocorrência na tabela TABMOVTRA_OCO do cliente."""
    try:
        cfg = get_client_db(to_biz)
        save_ocorrencia_texto(
            req.nomovtra, req.texto, req.usuario, cfg
        )
        return {"status": "ok"}
    except Exception as exc:  # pragma: no cover - falha inesperada
        raise HTTPException(status_code=500, detail=str(exc))
