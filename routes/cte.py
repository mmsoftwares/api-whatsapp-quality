# flake8: noqa
"""Consulta CT-e por chave (Firebird Dialect 1)."""

import logging
import re
from datetime import date, datetime
from typing import Any, Dict, Optional

import fdb
from functions.db_client import _load_fbclient_hardcoded  # ensure fbclient

try:
    _ = _load_fbclient_hardcoded()
except Exception:
    pass
from fastapi import APIRouter, HTTPException, Path, Query, Header

from functions.db_client import get_client_db, connect_client_db

router = APIRouter(prefix="/cte", tags=["cte"])


def _connect(cfg: Dict[str, Any]):
    """Cria conexão com o banco Firebird usando Dialect 1."""
    return connect_client_db(cfg, sql_dialect=1)


def _fmt_date_br(d: Optional[date]) -> Optional[str]:
    """Formata data para DD/MM/AAAA."""
    if not d:
        return None
    return f"{d.day:02d}/{d.month:02d}/{d.year:04d}"


@router.get("/{chave}")
def get_cte_by_chave(
    chave: str = Path(..., description="Chave do CT-e com 44 dígitos"),
    cpf: str = Query(..., description="CPF/CNPJ do motorista"),
    to_biz: str = Header(..., alias="x-whatsapp-number"),
):
    """Retorna informações do CT-e se o CPF pertencer ao motorista vinculado."""
    chave = (chave or "").strip()
    if len(chave) != 44 or not chave.isdigit():
        raise HTTPException(status_code=400, detail="Chave inválida: deve conter 44 dígitos numéricos.")

    # Use apenas placeholders posicionais "?" no fdb
    sql = """
        SELECT FIRST 1
               t.STATUSCTE,
               t.DATAEMI,
               t.TOTALPESO,
               t.NOMOVTRA,
               t.MOTIVO,
               mot.CGCCLI AS MOTORISTA_CPF
          FROM TABCTRC t
          JOIN TABCLI mot ON mot.NOCLI = t.NOMOT
         WHERE t.CHAVECTE = ?
    """

    con = None
    cur = None
    try:
        cfg = get_client_db(to_biz)
        con = _connect(cfg)
        cur = con.cursor()

        logging.debug("🔍 SQL (cte): %s", " ".join(line.strip() for line in sql.strip().splitlines()))
        logging.debug("🔍 Params: CHAVECTE=%s", chave)

        cur.execute(sql, (chave,))
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="CT-e não encontrada")

        # Nome das colunas do cursor podem vir com espaços em branco à direita
        cols = [d[0].strip().upper() for d in cur.description]
        m: Dict[str, Any] = {cols[i]: row[i] for i in range(len(cols))}

        cpf_digits = re.sub(r"\D", "", cpf or "")
        cpf_motorista = re.sub(r"\D", "", str(m.get("MOTORISTA_CPF") or ""))
        if not cpf_motorista or cpf_digits != cpf_motorista:
            raise HTTPException(status_code=403, detail="Motorista não autorizado para este CT-e")

        dataemi = m.get("DATAEMI")
        if isinstance(dataemi, datetime):
            dataemi = dataemi.date()

        cte = {
            "statuscte": m.get("STATUSCTE"),
            "dataemi": _fmt_date_br(dataemi) if isinstance(dataemi, (date, type(None))) else None,
            "totalpeso": m.get("TOTALPESO"),
            "nomovtra": m.get("NOMOVTRA"),
            "motivo": m.get("MOTIVO"),
        }

        return {"status": "ok", "cte": cte}

    except HTTPException:
        raise
    except fdb.fbcore.DatabaseError as e:
        logging.exception("Erro ao consultar CT-e (DatabaseError)")
        # Expor mensagem resumida, mantendo detalhes no log
        raise HTTPException(status_code=500, detail=f"Falha no banco: {e.args[0] if e.args else str(e)}")
    except Exception as e:
        logging.exception("Erro ao consultar CT-e")
        raise HTTPException(status_code=500, detail=f"Erro ao consultar CT-e: {e}")
    finally:
        try:
            if cur:
                cur.close()
        except Exception:
            pass
        try:
            if con:
                con.close()
        except Exception:
            pass
