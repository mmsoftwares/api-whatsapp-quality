"""Endpoint para salvar dados de pré-cadastro de motoristas com erros descritivos para o usuário."""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import logging
import re

from functions.save_precad_pessoa import save_precadastro_pessoa
from functions.db_client import get_client_db

logger = logging.getLogger(__name__)
router = APIRouter()


class PreCadastroRequest(BaseModel):
    """Modelo de entrada contendo os dados extraídos da CNH."""
    dados: Dict[str, Any] = Field(..., description="Campos extraídos da CNH do motorista")
    link: Optional[str] = Field(None, description="URL do arquivo da CNH")


# Campos obrigatórios para salvar na TABPRECAD_PESSOA
CAMPOS_OBRIGATORIOS = ["CPF", "DATANASC", "RG",  "NOME"]


def normalizar_dados(dados: Dict[str, Any]) -> Dict[str, Any]:
    """Limpa e normaliza campos antes de salvar no banco."""
    dados_norm = {k.upper(): (str(v).strip() if v is not None else None) for k, v in dados.items()}

    # Remove valores vazios ou "-"
    for k, v in list(dados_norm.items()):
        if v in ("", "-"):
            dados_norm[k] = None

    # Normaliza CPF -> somente dígitos
    if "CPF" in dados_norm and dados_norm["CPF"]:
        dados_norm["CPF"] = re.sub(r"\D", "", dados_norm["CPF"])

    # Converte DOB -> DATANASC
    if "DOB" in dados_norm and dados_norm["DOB"]:
        dob = dados_norm.pop("DOB")
        if "/" in dob and len(dob.split("/")) == 3:
            dia, mes, ano = dob.split("/")
            dados_norm["DATANASC"] = f"{ano}-{mes.zfill(2)}-{dia.zfill(2)}"
        else:
            dados_norm["DATANASC"] = dob

    return dados_norm


@router.post("/precadastro")
async def precadastro(
    req: PreCadastroRequest, to_biz: str = Header(..., alias="x-whatsapp-number")
) -> Dict[str, str]:
    """Salva os dados recebidos na tabela TABPRECAD_PESSOA."""
    try:
        dados_norm = normalizar_dados(req.dados)

        # Valida campos obrigatórios
        faltando = [c for c in CAMPOS_OBRIGATORIOS if not dados_norm.get(c)]
        if faltando:
            detalhe = f"Campos obrigatórios ausentes: {', '.join(faltando)}"
            logger.warning(detalhe)
            raise HTTPException(status_code=400, detail=detalhe)

        logger.info(f"Salvando pré-cadastro: {dados_norm}")
        cfg = get_client_db(to_biz)
        save_precadastro_pessoa(dados_norm, req.link, cfg)

        return {"status": "salvo"}

    except ValueError as e:
        # Erro de validação do save_precadastro_pessoa (ex.: CPF duplicado, data inválida, etc.)
        detalhe = str(e)
        logger.warning(f"Erro de validação: {detalhe}")
        raise HTTPException(status_code=400, detail=detalhe)

    except HTTPException:
        raise  # mantém erros HTTP definidos acima

    except Exception as e:
        detalhe = f"Erro inesperado: {e}"
        logger.exception(detalhe)
        raise HTTPException(status_code=500, detail=detalhe)

