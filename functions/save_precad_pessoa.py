"""Funções para salvar dados de pré-cadastro no Firebird com mensagens descritivas."""

from datetime import datetime, date
from typing import Dict, Any, Optional
import re
import fdb
from functions.db_client import _load_fbclient_hardcoded

try:
    _ = _load_fbclient_hardcoded()
except Exception:
    pass

from .db_client import connect_client_db


# Limites dos campos (VARCHAR) no banco
MAXLEN = {
    "NOME": 150,
    "CIDADENASC": 50,
    "UFEMISSOR": 10,
    "ORGAOEMISSOR": 20,
    "RG": 20,
    "CPF": 20,
    "CNH_REGISTRO": 20,
    "CNH_CAT": 10,
    "NACIONALIDADE": 20,
    "FIL_PAI": 50,
    "FIL_MAE": 50,
    "CNH_PROTOCOLO": 20,
    "UFEXPEDICAO": 10,
    "CNH_SEGURO": 50,
    "LINK": 500,
    "TELEFONE": 32,
}


def _cpf_existe(cur: fdb.Cursor, cpf: str) -> bool:
    """Verifica se o CPF já está presente em TABCLI ou TABPRECAD_PESSOA."""
    raw = (cpf or "").strip()
    digits = re.sub(r"\D", "", raw)
    masked = (
        f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
        if len(digits) == 11
        else raw
    )
    cur.execute(
        """
        SELECT FIRST 1 1
        FROM TABCLI
        WHERE CGCCLI = ? OR CGCCLI = ? OR CGCCLI = ?
        """,
        (raw, digits, masked),
    )
    if cur.fetchone():
        return True


def _parse_date_pt(value: Optional[str]) -> Optional[date]:
    """Converte datas no formato DD/MM/AAAA para date."""
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _str_fit(col: str, v: Any) -> str:
    """Trunca string para caber no tamanho do campo."""
    s = ("" if v is None else str(v)).strip()
    n = MAXLEN.get(col)
    return s[:n] if n else s


def _split_org_uf_protocolo(dados: Dict[str, Any]) -> Dict[str, Any]:
    """Se ORGAOEMISSOR vier como 'NNNNNNNNNN / SC#########', separa em campos."""
    org = str(dados.get("ORGAOEMISSOR") or "").strip()
    if "/" not in org:
        return dados

    left, right = [p.strip() for p in org.split("/", 1)]

    # CNH_REGISTRO
    reg_num = re.sub(r"\D", "", left)
    if len(reg_num) >= 5 and not dados.get("CNH_REGISTRO"):
        dados["CNH_REGISTRO"] = reg_num

    # CNH_PROTOCOLO + UFEXPEDICAO
    m_proto = re.search(r"\b([A-Z]{2})(\d+)\b", right, flags=re.I)
    if m_proto:
        uf = m_proto.group(1).upper()
        dados.setdefault("UFEXPEDICAO", uf)
        dados.setdefault("CNH_PROTOCOLO", m_proto.group(0).upper())
        dados["ORGAOEMISSOR"] = f"DETRAN/{uf}"

    return dados

def _digits_only(v: Any) -> str:
    """Mantém apenas os dígitos do valor recebido."""
    return re.sub(r"\D", "", str(v or ""))
def save_precadastro_pessoa(
    dados: Dict[str, Any],
    link: Optional[str] = None,
    db_cfg: Optional[Dict[str, Any]] = None,
) -> None:
    """Insere um registro na TABPRECAD_PESSOA com suporte a banco dinâmico."""
    # Ajusta dados antes de inserir
    dados = _split_org_uf_protocolo(dict(dados or {}))
    if link:
        dados["LINK"] = link

    # === Validação de campos obrigatórios ===
    obrigatorios = ["CPF", "NOME", "DATANASC"]
    faltando = [c for c in obrigatorios if not dados.get(c)]
    if faltando:
        raise ValueError(f"⚠️ Preencha todos os campos obrigatórios: {', '.join(faltando)}")

    # === Validação de formato de data ===
    datas_para_validar = ["DATANASC", "CNH_DATAEMISSAO", "CNH_DATA1CNH", "CNH_DATAVCTO"]
    for campo in datas_para_validar:
        if campo in dados and dados[campo]:
            if not _parse_date_pt(str(dados[campo])):
                raise ValueError(f"⚠️ Data inválida no campo '{campo}': {dados[campo]}")

    # === Validação de formato de CPF ===
    cpf_digits = re.sub(r"\D", "", str(dados.get("CPF")))
    if len(cpf_digits) != 11:
        raise ValueError(f"⚠️ CPF inválido: {dados.get('CPF')}")

    if not db_cfg:
        raise ValueError("Configuração do banco do cliente ausente.")
    print(
        f"Conectando ao tenant: {db_cfg['host']}:{db_cfg.get('port')}:{db_cfg['database']}"
    )
    con = connect_client_db(db_cfg)
    try:
        cur = con.cursor()
        # Checa duplicidade
        if _cpf_existe(cur, str(dados.get("CPF"))):
            raise ValueError(f"⚠️ O CPF {dados.get('CPF')} já está cadastrado.")

    
        # DATAREG sempre
        colunas = ["DATAREG"]
        valores = [datetime.now().date()]

        campos = {
            "NOME": lambda v: _str_fit("NOME", v),
            "CNH_DATAEMISSAO": _parse_date_pt,
            "CNH_DATA1CNH": _parse_date_pt,
            "CNH_DATAVCTO": _parse_date_pt,
            "DATANASC": _parse_date_pt,
            "CIDADENASC": lambda v: _str_fit("CIDADENASC", v),
            "UFEMISSOR": lambda v: _str_fit("UFEMISSOR", v),
            "ORGAOEMISSOR": lambda v: _str_fit("ORGAOEMISSOR", v),
            "RG": lambda v: _str_fit("RG", v),
            "CPF": lambda v: _str_fit("CPF", v),
            "CNH_REGISTRO": lambda v: _str_fit("CNH_REGISTRO", v),
            "CNH_CAT": lambda v: _str_fit("CNH_CAT", v),
            "NACIONALIDADE": lambda v: _str_fit("NACIONALIDADE", v),
            "FIL_PAI": lambda v: _str_fit("FIL_PAI", v),
            "FIL_MAE": lambda v: _str_fit("FIL_MAE", v),
            "CNH_PROTOCOLO": lambda v: _str_fit("CNH_PROTOCOLO", v),
            "UFEXPEDICAO": lambda v: _str_fit("UFEXPEDICAO", v),
            "CNH_SEGURO": lambda v: _str_fit("CNH_SEGURO", v),
            "LINK": lambda v: _str_fit("LINK", v),
            "TELEFONE": lambda v: _str_fit('TELEFONE', _digits_only(v)),
        }

        for col, parser in campos.items():
            if col in dados and dados[col] not in (None, ""):
                val = parser(dados[col])
                colunas.append(col)
                valores.append(val)

        placeholders = ", ".join(["?"] * len(colunas))
        sql = f"INSERT INTO TABPRECAD_PESSOA ({', '.join(colunas)}) VALUES ({placeholders})"
        cur.execute(sql, valores)
        con.commit()

    finally:
        con.close()
