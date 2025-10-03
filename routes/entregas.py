# flake8: noqa
# routes/entregas.py
"""Consulta detalhes da entrega por número (Dialect 1) com formatação PT-BR e checagem de motorista (CPF/CNPJ)."""

import logging
import re
from typing import Any, Dict, List, Optional
from datetime import datetime, date, time

import fdb
import platform
from pathlib import Path
from functions.db_client import _load_fbclient_hardcoded  # reuse loader

# Garante fbclient carregado (hardcoded + logs)
try:
    DLL = _load_fbclient_hardcoded()
except Exception:
    DLL = None
from fastapi import APIRouter, HTTPException, Path, Query, Header

from functions.db_client import get_client_db, connect_client_db

router = APIRouter(prefix="/entregas", tags=["entregas"])

# ---------------- Utils ----------------

def _digits(s: Any) -> str:
    """Remove caracteres não numéricos de uma string."""
    return re.sub(r"\D", "", str(s or "").strip())


def _is_cpf(s: str) -> bool:
    """Indica se a string possui 11 dígitos (CPF)."""
    return len(s) == 11


def _is_cnpj(s: str) -> bool:
    """Indica se a string possui 14 dígitos (CNPJ)."""
    return len(s) == 14


def _mask_doc(s: str) -> str:
    """Aplica máscara de CPF ou CNPJ quando possível."""
    d = _digits(s)
    if _is_cpf(d):
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    if _is_cnpj(d):
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return d

# ---------------- Conexão (Dialect 1) ----------------

def _connect(cfg: Dict[str, Any]):
    """Abre conexão com o banco do cliente usando Dialect 1."""
    return connect_client_db(cfg, sql_dialect=1)

def _cols(cur) -> List[str]:
    """Retorna a lista de nomes de colunas do cursor em maiúsculas."""
    return [d[0].strip().upper() for d in cur.description]


# ---------------- Helpers de formatação ----------------

def _ensure_date(obj: Any) -> Optional[date]:
    """Garante que o objeto seja data, convertendo se necessário."""
    if obj is None:
        return None
    if isinstance(obj, date) and not isinstance(obj, datetime):
        return obj
    if isinstance(obj, datetime):
        return obj.date()
    try:
        return datetime.fromisoformat(str(obj)[:19]).date()
    except Exception:
        return None

def _ensure_time(obj: Any) -> Optional[time]:
    """Converte objeto para horário válido, quando possível."""
    if obj is None:
        return None
    if isinstance(obj, time):
        return obj
    if isinstance(obj, datetime):
        return obj.time()
    s = str(obj).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(s[:8], fmt).time()
        except Exception:
            pass
    return None

def _fmt_date_br(d: Optional[date]) -> Optional[str]:
    """Formata data no padrão brasileiro DD/MM/AAAA."""
    if not d:
        return None
    return f"{d.day:02d}/{d.month:02d}/{d.year:04d}"

def _fmt_datetime_br(dt: Optional[datetime]) -> Optional[str]:
    """Formata data e hora no padrão brasileiro."""
    if not dt:
        return None
    return f"{dt.day:02d}/{dt.month:02d}/{dt.year:04d} {dt.hour:02d}:{dt.minute:02d}"

def _combine_date_time(d: Optional[date], t: Optional[time]) -> Optional[datetime]:
    """Combina data e hora em um datetime quando ambos existirem."""
    if d and t:
        return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)
    if isinstance(d, datetime):
        return d
    return None

def _fmt_money_br(val: Any) -> Optional[str]:
    """Formata número para moeda brasileira."""
    if val is None:
        return None
    try:
        n = float(val)
    except Exception:
        return None
    s = f"{n:,.2f}"  # 1,234,567.89
    s = s.replace(",", "_").replace(".", ",").replace("_", ".")  # 1.234.567,89
    return f"R$ {s}"

# ---------------- Endpoint ----------------

@router.get("/{numero}")
def get_entrega_by_numero(
    numero: str = Path(..., description="Número da entrega (ex.: 12345)"),
    cpf: str = Query(..., description="CPF/CNPJ do motorista"),
    to_biz: str = Header(..., alias="x-whatsapp-number"),
):
    """
    Retorna dados da entrega apenas se o CPF/CNPJ informado pertencer ao motorista.
    Regras:
      - Se doc informado tem 11 dígitos, valida como CPF (match exato com 11 dígitos).
      - Se tem 14 dígitos, valida como CNPJ (match exato com 14 dígitos).
      - Fallback: se documento do motorista for CNPJ mas contiver CPF (últimos 11), aceita se coincidir.
    """
    numero = (numero or "").strip()
    if not numero:
        raise HTTPException(status_code=400, detail="Número da entrega inválido")

    # Resolve DB do cliente pela master
    cfg = get_client_db(to_biz)

    sql = """
        SELECT FIRST 1
               m.NOMOVTRA                                                     AS NUMERO,
               m.DATA                                                         AS M_DATA,
               m.DATA_HORA                                                    AS M_DATA_HORA,
               c.NOMCLI                                                       AS CLIENTE_NOME,
               c.CGCCLI                                                       AS CLIENTE_CNPJ,
               mot.NOMCLI                                                     AS MOTORISTA_NOME,
               mot.CGCCLI                                                     AS MOTORISTA_DOC,
               m.PLACACAR                                                     AS PLACA,
               (SELECT SUM(nf.VLRTOTAL)
                  FROM TABMOVTRA_NF nf
                 WHERE nf.NOMOVTRA = m.NOMOVTRA)                              AS VALOR_TOTAL
          FROM TABMOVTRA m
          LEFT JOIN TABCLI c   ON c.NOCLI  = m.NOCLI
          LEFT JOIN TABCLI mot ON mot.NOCLI = m.NOMOT
         WHERE m.NOMOVTRA = ?
    """

    con = None
    try:
        con = _connect(cfg)
        cur = con.cursor()
        logging.info("🔍 Consultando entrega NOMOVTRA=%s em %s", numero, cfg["database"])

        cur.execute(sql, (numero,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entrega não encontrada")

        cols = _cols(cur)
        m: Dict[str, Any] = {cols[i]: row[i] for i in range(len(cols))}

        # Validação de documento
        provided = _digits(cpf)
        stored = _digits(m.get("MOTORISTA_DOC") or "")

        def _authorized(prov: str, st: str) -> bool:
            if not prov or not st:
                return False
            if _is_cpf(prov) and _is_cpf(st):
                return prov == st
            if _is_cnpj(prov) and _is_cnpj(st):
                return prov == st
            # Fallback: se o banco guarda CNPJ mas o CPF do motorista está embutido (últimos 11)
            if _is_cpf(prov) and _is_cnpj(st) and len(st) == 14:
                return prov == st[-11:]
            return False

        if not _authorized(provided, stored):
            logging.warning(
                "❌ Documento motorista não autorizado. informado=%s, banco=%s, motorista=%s",
                _mask_doc(provided), _mask_doc(stored), (m.get("MOTORISTA_NOME") or "")
            )
            raise HTTPException(status_code=403, detail="Motorista não autorizado para esta entrega")

        # Datas
        d_base = _ensure_date(m.get("M_DATA"))
        t_base = _ensure_time(m.get("M_DATA_HORA"))
        dt_entrega = _combine_date_time(d_base, t_base)

        entrega = {
            "numero": m.get("NUMERO"),
            "status": None,  # ajuste aqui se existir origem do status
            "data_prevista": _fmt_date_br(d_base),
            "data_entrega": _fmt_datetime_br(dt_entrega),
            "cliente_nome": (m.get("CLIENTE_NOME") or None),
            "cliente_cnpj": (m.get("CLIENTE_CNPJ") or None),
            "motorista_nome": (m.get("MOTORISTA_NOME") or None),
            "placa": (m.get("PLACA") or None),
            "valor_total": _fmt_money_br(m.get("VALOR_TOTAL")),
        }

        logging.info("✅ Entrega autorizada e retornada: NOMOVTRA=%s", entrega["numero"])
        return {"status": "ok", "entrega": entrega}

    except HTTPException:
        raise
    except fdb.fbcore.DatabaseError as e:
        msg = str(e.args[0]) if getattr(e, "args", None) else str(e)
        logging.exception("Erro ao consultar entrega")
        umsg = msg.upper()
        if "TABMOVTRA_NF" in umsg:
            raise HTTPException(
                status_code=500,
                detail="Tabela TABMOVTRA_NF não encontrada. Ajuste o SQL ou crie a tabela/visão de notas."
            )
        if "TABMOVTRA" in umsg:
            raise HTTPException(
                status_code=500,
                detail="Tabela TABMOVTRA não encontrada neste banco."
            )
        if "TABCLI" in umsg:
            raise HTTPException(
                status_code=500,
                detail="Tabela TABCLI não encontrada para resolver cliente/motorista."
            )
        raise HTTPException(status_code=500, detail=f"Erro ao consultar entrega: {msg}")
    except Exception as e:
        logging.exception("Erro inesperado ao consultar entrega")
        raise HTTPException(status_code=500, detail=f"Erro ao consultar entrega: {e}")
    finally:
        if con:
            try:
                con.close()
            except Exception:
                pass
