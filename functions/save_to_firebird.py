# functions/save_to_firebird.py
"""Função para salvar dados no banco Firebird (com ou sem arquivo)."""

import re
import logging
from datetime import datetime, date
from typing import Optional, Dict, Any

import fdb
from .db_client import _load_fbclient_hardcoded, connect_client_db

try:
    _ = _load_fbclient_hardcoded()
except Exception:
    pass

# ---- Mapeamento ----
TABELA = "DOCUMENTOS"
COL_CHAVE = "CHAVE_ACESSO"
COL_DATA_EMISSAO = "DATA_EMISSAO"
COL_MOTORISTA_ID = "MOTORISTA_ID"
COL_CNPJ_EMITENTE = "CNPJ_EMITENTE"
COL_CAMINHO_ARQUIVO = "CAMINHO_ARQUIVO"
COL_STATUS = "STATUS_PROCESSAMENTO"

# Placeholders para campos NOT NULL que podem não vir do app
CNPJ_PLACEHOLDER = "00000000000000"
CAMINHO_PLACEHOLDER = "SEM_ARQUIVO"   # ajuste ao tamanho do VARCHAR na tabela


# ---------------- Utils ----------------
def _parse_date(value: str) -> Optional[date]:
    """Converte uma string flexível de data para objeto date."""
    if not value:
        return None
    txt = str(value).strip()
    if not txt or txt.lower() in {"aaaa-mm-dd", "0000-00-00"}:
        return None
    for fmt in (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%Y%m%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(txt, fmt).date()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(txt[:19]).date()
    except Exception:
        logging.warning("Data fora do padrão aceita (%s) -> ignorada", value)
        return None


def _normalize_key(k: str) -> str:
    """Remove caracteres não numéricos de uma chave."""
    return re.sub(r"\D", "", k or "")


def _normalize_cnpj(v: Any) -> Optional[str]:
    """Retorna o CNPJ apenas com dígitos ou None."""
    if v is None:
        return None
    c = re.sub(r"\D", "", str(v))
    return c if len(c) == 14 else None


def _inferir_data_emissao_por_chave(chave_44: str) -> Optional[date]:
    """Deduz a data de emissão a partir da chave de 44 dígitos."""
    num = _normalize_key(chave_44)
    if len(num) != 44:
        return None
    try:
        aamm = num[2:6]  # YYMM
        yy = int(aamm[:2])
        mm = int(aamm[2:])
        ano = 2000 + yy
        if 1 <= mm <= 12:
            return date(ano, mm, 1)
    except Exception:
        return None
    return None


def _garantir_data_emissao(dados: Dict[str, Any], chave_44: str) -> date:
    """Garante presença de DATA_EMISSAO no payload."""
    for k in (COL_DATA_EMISSAO, "data_emissao", "DataEmissao"):
        if k in dados and dados[k]:
            d = _parse_date(str(dados[k]))
            if d:
                return d
    return _inferir_data_emissao_por_chave(chave_44) or date.today()


# --------------- Principal ---------------
def save_to_firebird(
    dados: dict,
    file_path: Optional[str] = None,
    motorista_id: int = 1,
    db_cfg: Optional[Dict[str, Any]] = None,
) -> None:
    """Insere ou atualiza um documento no banco Firebird informado."""

    # 1) Chave (44 dígitos)
    chave_raw = dados.get("chave_acesso") or dados.get(COL_CHAVE) or ""
    chave = _normalize_key(chave_raw)
    if len(chave) != 44 or not chave.isdigit():
        logging.error("Chave inválida: %r", chave_raw)
        raise ValueError("chave_acesso deve conter exatamente 44 dígitos")

    # 2) DATA_EMISSAO
    data_emissao: date = _garantir_data_emissao(dados, chave)

    # 3) CNPJ opcional
    cnpj_emitente_norm = _normalize_cnpj(dados.get(COL_CNPJ_EMITENTE) or dados.get("cnpj_emitente"))

    # 4) Caminho opcional (pode vir None)
    caminho_in = file_path or dados.get(COL_CAMINHO_ARQUIVO) or dados.get("caminho_arquivo")
    caminho_norm = str(caminho_in).strip() if caminho_in else None

    # 5) Status
    status = (dados.get(COL_STATUS) or dados.get("status") or
              ("confirmado" if caminho_norm else "salvo_chave"))

    # 6) Valores finais NÃO-NULOS para INSERT (defensivo)
    cnpj_final = cnpj_emitente_norm or CNPJ_PLACEHOLDER
    caminho_final = caminho_norm if caminho_norm not in (None, "", ".") else CAMINHO_PLACEHOLDER

    payload_log = {
        COL_CHAVE: chave,
        COL_DATA_EMISSAO: data_emissao.isoformat(),
        COL_MOTORISTA_ID: motorista_id,
        COL_CNPJ_EMITENTE: cnpj_final,
        COL_CAMINHO_ARQUIVO: caminho_final,
        COL_STATUS: status,
    }
    logging.info("📝 Payload normalizado para Firebird: %s", payload_log)

    con = None
    try:
        if not db_cfg:
            raise ValueError("Configuração do banco do cliente ausente.")
        logging.info(
            "Conectando tenant %s:%s:%s",
            db_cfg.get("host"),
            db_cfg.get("port"),
            db_cfg.get("database"),
        )
        con = connect_client_db(db_cfg)
        cur = con.cursor()

        # 7) INSERT (sempre com valores não-nulos)
        try:
            sql_ins = f"""
                INSERT INTO {TABELA} (
                    {COL_MOTORISTA_ID},
                    {COL_CHAVE},
                    {COL_DATA_EMISSAO},
                    {COL_CNPJ_EMITENTE},
                    {COL_CAMINHO_ARQUIVO},
                    {COL_STATUS}
                )
                VALUES (?, ?, ?, ?, ?, ?)
            """
            params_ins = (
                motorista_id,
                chave,
                data_emissao,    # DATE real
                cnpj_final,      # nunca None
                caminho_final,   # nunca None
                status,
            )
            logging.debug("SQL INSERT: %s | params=%s", sql_ins, params_ins)
            cur.execute(sql_ins, params_ins)
            con.commit()
            logging.info("✅ INSERT realizado")
            return

        except fdb.fbcore.DatabaseError as e:
            # -803 = unique violation -> UPDATE
            msg = str(e.args[0]) if getattr(e, "args", None) else str(e)
            if "-803" in msg or "UNIQUE" in msg.upper():
                logging.warning("Chave existente. Executando UPDATE (upsert).")

                sql_upd = f"""
                    UPDATE {TABELA}
                       SET {COL_MOTORISTA_ID}   = ?,
                           {COL_DATA_EMISSAO}   = ?,
                           {COL_CNPJ_EMITENTE}  = COALESCE(?, {COL_CNPJ_EMITENTE}),
                           {COL_CAMINHO_ARQUIVO}= COALESCE(?, {COL_CAMINHO_ARQUIVO}),
                           {COL_STATUS}         = ?
                     WHERE {COL_CHAVE}         = ?
                """
                params_upd = (
                    motorista_id,
                    data_emissao,
                    cnpj_emitente_norm,  # None -> mantém
                    caminho_norm,        # None -> mantém
                    status,
                    chave,
                )
                logging.debug("SQL UPDATE: %s | params=%s", sql_upd, params_upd)
                cur.execute(sql_upd, params_upd)
                con.commit()
                # Log de UPDATE realizado
                logging.info("✅ UPDATE realizado (upsert)")
                return
            # Log de erro ao inserir documento
            logging.exception("Erro de banco ao inserir documento")
            raise

    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass
