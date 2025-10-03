"""Rota para confirmar o processamento do documento (com arquivo ou só chave)."""

import os
import logging
import stat
from pathlib import Path
from datetime import datetime, date
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from config import UPLOAD_DIR as CFG_UPLOAD_DIR, GOOGLE_DRIVE_FOLDER
from functions.save_to_firebird import save_to_firebird
from functions.upload_to_drive import upload_to_drive
from functions.db_client import get_client_db

router = APIRouter()

# Normaliza UPLOAD_DIR e garante existência
UPLOAD_DIR = Path(CFG_UPLOAD_DIR) if not isinstance(CFG_UPLOAD_DIR, Path) else CFG_UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class ConfirmarRequest(BaseModel):
    chave_acesso: str
    confirma: bool
    dados: Dict[str, Any] = {}
    temp_path: Optional[str] = None


def garantir_permissao(p: Path) -> None:
    try:
        if p.exists():
            os.chmod(p, stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)
    except Exception as e:
        logging.warning("Não foi possível ajustar permissões em %s: %s", p, e)


def resolver_caminho(tp: Optional[str]) -> Optional[Path]:
    """
    Retorna:
      - None se tp for None, '', ' ', '.' (sem arquivo)
      - Path absoluto caso contrário (relativo é resolvido dentro de UPLOAD_DIR)
    """
    if tp is None:
        return None
    tp = str(tp).strip()
    if tp == "" or tp == ".":
        return None
    p = Path(tp)
    if not p.is_absolute():
        p = (UPLOAD_DIR / p).resolve()
    return p


def parse_date_flex(value: str) -> Optional[date]:
    """
    Aceita 'YYYY-MM-DD', 'DD/MM/YYYY', ISO 'YYYY-MM-DDTHH:MM:SSZ' etc.
    Retorna date ou None.
    """
    if not value:
        return None

    value = value.strip()
    fmts = [
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
    ]
    for fmt in fmts:
        try:
            dt = datetime.strptime(value, fmt)
            return dt.date()
        except Exception:
            continue

    # Último recurso: tentar só os 10 primeiros chars como YYYY-MM-DD
    try:
        return datetime.fromisoformat(value[:10]).date()
    except Exception:
        return None


def inferir_data_emissao(chave: str, dados: Dict[str, Any]) -> date:
    """
    1) Usa dados['data_emissao'] ou ['DATA_EMISSAO'] se vierem válidos.
    2) Se não, tenta deduzir do AAMM da chave NFe (44 dígitos).
       Estrutura da chave: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + série(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
       AAMM são os dígitos 3..6 (1-based) => índices 2..6 (0-based, slice [2:6])
    3) Se tudo falhar, usa hoje.
    """
    # 1) Do corpo
    for k in ("data_emissao", "DATA_EMISSAO"):
        if k in dados and dados[k]:
            d = parse_date_flex(str(dados[k]))
            if d:
                return d

    # 2) Da chave (AAMM)
    chave_num = "".join(filter(str.isdigit, str(chave)))
    if len(chave_num) == 44:
        aamm = chave_num[2:6]  # YYMM
        try:
            yy = int(aamm[:2])
            mm = int(aamm[2:])
            # NF-e adota ano com século: 00-99 => 2000-2099 (ajuste se necessário)
            ano = 2000 + yy
            if 1 <= mm <= 12:
                return date(ano, mm, 1)  # primeiro dia do mês da emissão
        except Exception:
            pass

    # 3) Hoje
    return date.today()


def preparar_payload(chave: str, dados: Dict[str, Any]) -> Dict[str, Any]:
    """
    Garante que o payload para o save_to_firebird terá DATA_EMISSAO não nula.
    Normaliza para a chave 'DATA_EMISSAO' no formato 'YYYY-MM-DD'.
    """
    payload = dict(dados or {})
    dtemi = inferir_data_emissao(chave, payload)
    payload["DATA_EMISSAO"] = dtemi.strftime("%Y-%m-%d")
    # Opcional: normalizar nomes usuais vindos do front
    if "chave_acesso" not in payload and chave:
        payload["chave_acesso"] = chave
    if "CHAVE_ACESSO" not in payload and chave:
        payload["CHAVE_ACESSO"] = chave
    return payload


@router.post("/confirmar")
async def confirmar(req: ConfirmarRequest, to_biz: str = Header(..., alias="x-whatsapp-number")):
    """Confirma o documento e salva dados no banco do cliente."""
    logging.info("📥 Confirmação recebida para a chave %s", req.chave_acesso)

    p = resolver_caminho(req.temp_path)

    # Cancelamento: remove arquivo se existir (se for pasta, ignora)
    if not req.confirma:
        if p and p.exists() and p.is_file():
            garantir_permissao(p)
            try:
                p.unlink(missing_ok=True)
                logging.info("🗑️ Arquivo removido: %s", p)
            except Exception as e:
                logging.error("Erro ao remover arquivo %s: %s", p, e)
        return {"status": "pendente", "mensagem": "Envie nova foto ou digite manualmente."}

    # Prepara payload com DATA_EMISSAO garantida
    payload = preparar_payload(req.chave_acesso, req.dados)

    cfg = get_client_db(to_biz)

    # Confirmação SEM arquivo (só chave)
    if p is None:
        try:
            save_to_firebird(payload, None, 1, cfg)  # grava apenas pela chave (e campos derivados)
            logging.info("✅ Dados salvos no Firebird (apenas chave) | DATA_EMISSAO=%s", payload.get("DATA_EMISSAO"))
        except Exception as e:
            logging.error("Erro ao salvar apenas pela chave: %s", e)
            # Expor detalhe ajuda a diagnosticar rapidamente em homologação
            raise HTTPException(status_code=500, detail=f"Erro ao salvar (apenas chave): {e}")
        # nada de upload ao Drive
        return {"status": "salvo_chave", "mensagem": "Chave confirmada e salva sem arquivo."}

    # Confirmação COM arquivo
    if not p.exists():
        raise HTTPException(status_code=404, detail="Arquivo temporário não encontrado")
    if p.is_dir():
        logging.error("temp_path aponta para um diretório, não um arquivo: %s", p)
        raise HTTPException(status_code=400, detail="Caminho recebido é uma pasta, não um arquivo")

    garantir_permissao(UPLOAD_DIR)
    garantir_permissao(p)

    try:
        save_to_firebird(payload, str(p), 1, cfg)
        logging.info("✅ Dados salvos no Firebird (arquivo=%s) | DATA_EMISSAO=%s", p.name, payload.get("DATA_EMISSAO"))
    except Exception as e:
        logging.error("Erro ao salvar no Firebird: %s", e)
        raise HTTPException(status_code=500, detail=f"Erro ao salvar no banco: {e}")

    try:
        file_id = upload_to_drive(str(p), GOOGLE_DRIVE_FOLDER)
        logging.info("☁️ Upload concluído no Drive. File ID: %s", file_id)
    except Exception as e:
        logging.error("Erro no upload para o Drive: %s", e)
        raise HTTPException(status_code=500, detail=f"Erro ao enviar para o Google Drive: {e}")

    return {"status": "salvo", "mensagem": "Documento confirmado e salvo no banco e Google Drive."}
