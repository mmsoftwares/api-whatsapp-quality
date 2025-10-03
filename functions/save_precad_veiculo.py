"""Funções para salvar dados de pré-cadastro de veículos no Firebird."""

from datetime import datetime, date
from typing import Dict, Any, Optional
import fdb
from functions.db_client import _load_fbclient_hardcoded

try:
    _ = _load_fbclient_hardcoded()
except Exception:
    pass

from .db_client import connect_client_db

# Limites de tamanho dos campos VARCHAR (somente VARCHAR)
MAXLEN = {
    "PLACA": 10,
    "RENAVAN": 30,
    "CATEGORIA": 100,
    "CAPACIDADE": 50,
    "POTENCIA": 50,
    "PESOBRUTO": 50,
    "MOTOR": 50,
    "CMT": 50,
    "LOTACAO": 50,
    "CARROCERIA": 50,
    "NOME": 150,
    "CPFCNPJ": 20,
    "LOCALIDADE": 50,      # <— atualizado
    "CODIGOCLA": 50,
    "CAT": 50,
    "MARCA_MODELO": 50,
    "ESPECIE_TIPO": 50,
    "PLACAANTERIOR": 10,
    "CHASSI": 50,
    "COR": 50,
    "COMBUSTIVEL": 50,
    "OBS": 500,
    "LINK": 500,
}

# Colunas inteiras e datas (nomes exatos na tabela)
INT_FIELDS = {"ANOEXERCICIO", "ANOMODELO", "ANOFABRICACAO", "EIXOS"}
DATE_FIELDS = {"DATA_LANC", "DATAALT"}   # <— atualizado

# Aliases de entrada -> nome real na tabela (para compatibilidade)
ALIASES = {
    "LOCAL": "LOCALIDADE",
    "DATA": "DATA_LANC",
}

# Conjunto total de colunas válidas (para filtrar desconhecidas)
VALID_COLUMNS = set(MAXLEN.keys()) | INT_FIELDS | DATE_FIELDS | {"DATAREG"}


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


def _to_int(v: Any) -> Optional[int]:
    """Converte valor para inteiro se possível."""
    try:
        return int(str(v).strip())
    except (ValueError, TypeError):
        return None


def save_precadastro_veiculo(
    dados: Dict[str, Any],
    link: Optional[str] = None,
    db_cfg: Optional[Dict[str, Any]] = None,
) -> None:
    """Insere um registro na TABPRECAD_VEICULO com suporte a banco dinâmico."""
    dados = dict(dados or {})
    if link:
        dados["LINK"] = link

    # Normaliza chaves de entrada (aliases)
    norm_dados: Dict[str, Any] = {}
    for k, v in dados.items():
        k_up = (k or "").upper()
        k_up = ALIASES.get(k_up, k_up)  # aplica alias se existir
        if k_up in VALID_COLUMNS:
            norm_dados[k_up] = v  # mantém apenas colunas válidas

    if not db_cfg:
        raise ValueError("Configuração do banco do cliente ausente.")
    print(
        f"Conectando ao tenant: {db_cfg['host']}:{db_cfg.get('port')}:{db_cfg['database']}"
    )
    con = connect_client_db(db_cfg)
    try:
        cur = con.cursor()

        colunas = ["DATAREG"]
        valores = [datetime.now().date()]

        for col, val in norm_dados.items():
            if val in (None, ""):
                continue

            if col in DATE_FIELDS:
                parsed = _parse_date_pt(val)
                if parsed:
                    colunas.append(col)
                    valores.append(parsed)
            elif col in INT_FIELDS:
                iv = _to_int(val)
                if iv is not None:
                    colunas.append(col)
                    valores.append(iv)
            elif col in MAXLEN:
                colunas.append(col)
                valores.append(_str_fit(col, val))
            # demais chaves são ignoradas

        placeholders = ", ".join(["?"] * len(colunas))
        # Como a tabela foi criada SEM aspas, os nomes são upper e podem ser usados sem quotes
        sql = f"INSERT INTO TABPRECAD_VEICULO ({', '.join(colunas)}) VALUES ({placeholders})"

        # Logs de depuração
        print("🛠 [DEBUG] SQL a executar:")
        print(sql)
        print("📦 [DEBUG] Valores:", valores)

        cur.execute(sql, valores)
        con.commit()
    finally:
        con.close()
