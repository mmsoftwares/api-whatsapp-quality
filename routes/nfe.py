"""Consulta CT-e por chave (Firebird Dialect 1)."""

import logging
from datetime import date, datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Path, Header

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
    to_biz: str = Header(..., alias="x-whatsapp-number"),
):
    """Retorna STATUSCTE, DATAEMI e TOTALPESO de um CT-e pela chave."""
    chave = (chave or "").strip()
    if len(chave) != 44 or not chave.isdigit():
        raise HTTPException(status_code=400, detail="Chave inválida")

    sql = """
        SELECT FIRST 1
               TABCTRC.STATUSCTE,
               TABCTRC.DATAEMI,
               TABCTRC.TOTALPESO,
               tabctrc.nomovtra
          FROM TABCTRC_NF
          left outer join tabctrc on tabctrc.nofre = tabctrc_nf.nofre
                                 and tabctrc.item = tabctrc_nf.item
         WHERE TABCTRC_nf.chavenfe = : ?
           and tabctrc.nomot = :?
    """

    con = None
    try:
        cfg = get_client_db(to_biz)
        con = _connect(cfg)
        cur = con.cursor()
        logging.debug("🔍 Consultando CHAVECTE=%s", chave)
        cur.execute(sql, (chave,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="CT-e não encontrada")

        cols = [d[0].strip().upper() for d in cur.description]
        m: Dict[str, Any] = {cols[i]: row[i] for i in range(len(cols))}

        dataemi = m.get("DATAEMI")
        if isinstance(dataemi, datetime):
            dataemi = dataemi.date()
        cte = {
            "statuscte": m.get("STATUSCTE"),
            "dataemi": _fmt_date_br(dataemi),
            "totalpeso": m.get("TOTALPESO"),
        }
        return {"status": "ok", "cte": cte}
    except HTTPException:
        raise
    except Exception as e:
        logging.exception("Erro ao consultar CT-e")
        raise HTTPException(status_code=500, detail=f"Erro ao consultar CT-e: {e}")
    finally:
        if con:
            try:
                con.close()
            except Exception:
                pass
