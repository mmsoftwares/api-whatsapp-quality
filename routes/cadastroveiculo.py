"""Endpoint para salvar dados de pré-cadastro de veículos com logs detalhados."""

import json
import traceback
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Dict, Any, Optional

from functions.save_precad_veiculo import save_precadastro_veiculo
from functions.db_client import get_client_db

router = APIRouter()


class CadastroVeiculoRequest(BaseModel):
    """Modelo de entrada contendo os dados do documento do veículo."""
    dados: Dict[str, Any]
    link: Optional[str] = None


@router.post("/cadastroveiculo")
async def cadastro_veiculo(
    req: CadastroVeiculoRequest, to_biz: str = Header(..., alias="x-whatsapp-number")
) -> Dict[str, str]:
    """Salva os dados recebidos na tabela TABPRECAD_VEICULO com logs de depuração."""
    try:
        # Log do payload recebido
        print("📥 [DEBUG] Dados recebidos do cliente:")
        print(json.dumps(req.dados, ensure_ascii=False, indent=2))
        print("📎 [DEBUG] Link recebido:", req.link)

        # Chamada da função de persistência
        cfg = get_client_db(to_biz)
        save_precadastro_veiculo(req.dados, req.link, cfg)

        print("✅ [DEBUG] Registro inserido com sucesso no Firebird.")

        return {"status": "salvo"}

    except Exception as e:
        print("❌ [ERRO] Falha ao salvar no Firebird:")
        print("Mensagem:", str(e))
        print("Traceback:")
        traceback.print_exc()

        raise HTTPException(status_code=500, detail=f"Erro ao salvar: {e}")
