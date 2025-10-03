"""Utilidades para resolver o banco do cliente via WhatsApp."""

import re
from typing import Any, Dict, Optional

import os
import platform
from pathlib import Path
import fdb
from fastapi import HTTPException
import requests

# Configuração explícita do MASTER (sem .env)
MASTER_HOST = "192.168.1.252"  # IP/host do servidor Firebird
MASTER_DB_URL = "/home/bdmm/Siserv/Database/DATABASE.GDB"  # ou alias: "SISERV"
MASTER_USER = "SYSDBA"        # ajuste se necessário
MASTER_PASSWORD = "masterkey" # ajuste para a senha correta
# Charset padrão preferido para bases antigas (FB 2.5)
DEFAULT_CHARSET = "WIN1252"

def _load_fbclient_hardcoded() -> str:
    """Tenta carregar fbclient.dll por ordem de preferência, sem .env.

    Ordem:
    1) Firebird 2.5 (x64): C:\\Program Files\\Firebird\\Firebird_2_5\\bin\\fbclient.dll
    2) Firebird 2.5 (x86): C:\\Program Files (x86)\\Firebird\\Firebird_2_5\\bin\\fbclient.dll
    3) Firebird 5.0 (x64): C:\\Program Files\\Firebird\\Firebird_5_0\\fbclient.dll
    4) Firebird 5.0 (x86): C:\\Program Files (x86)\\Firebird\\Firebird_5_0\\bin\\fbclient.dll

    Retorna o caminho carregado ou lança o último erro se nenhum caminho funcionar.
    """
    candidates = [
        r"C:/Program Files/Firebird/Firebird_2_5/bin/fbclient.dll",
        r"C:/Program Files (x86)/Firebird/Firebird_2_5/bin/fbclient.dll",
        r"C:/Program Files/Firebird/Firebird_5_0/fbclient.dll",
        r"C:/Program Files (x86)/Firebird/Firebird_5_0/bin/fbclient.dll",
    ]
    last_err = None
    arch = platform.architecture()[0]
    print(f"Python arquitetura: {arch}")
    for dll in candidates:
        try:
            if not Path(dll).exists():
                continue
            fdb.load_api(dll)
            print(f"fbclient.dll carregado de: {dll}")
            return dll
        except Exception as e:  # pragma: no cover
            print(f"Falha ao carregar fbclient.dll em '{dll}': {e}")
            last_err = e
    if last_err:
        raise last_err
    raise RuntimeError("Nenhum fbclient.dll encontrado nos caminhos padrão")

# Carrega a fbclient por tentativa, hardcoded
FBCLIENT_DLL = _load_fbclient_hardcoded()



def get_client_db(to_biz: str) -> Dict[str, Any]:
    """Obtém as credenciais do banco do cliente via Node (/internal/master/cliente).

    Remove dependência do Python com o MASTER Firebird.
    """
    n = re.sub(r"^whatsapp:", "", (to_biz or "").strip(), flags=re.I)
    try:
        url = f"http://127.0.0.1:8081/internal/master/cliente?toBiz={requests.utils.quote(n)}"
        print("Consultando credenciais no Node:", url)
        r = requests.get(url, timeout=5)
        if r.status_code == 404:
            raise HTTPException(status_code=404, detail="Cliente não encontrado para o WhatsApp informado")
        if not r.ok:
            raise HTTPException(status_code=500, detail=f"Falha ao consultar Node: HTTP {r.status_code}")
        raw = r.json() or {}
        missing = [k for k in ["DB_HOST","DB_PORT","DB_PATH","DB_USER","DB_PASSWORD"] if not raw.get(k)]
        if missing:
            msg = f"Tenant possui campos ausentes: {', '.join(missing)}"
            print(msg)
            raise HTTPException(status_code=500, detail=msg)
        cfg = {
            "host": raw["DB_HOST"],
            "port": int(raw["DB_PORT"]),
            "database": raw["DB_PATH"],
            "user": raw["DB_USER"],
            "password": raw["DB_PASSWORD"],
            "charset": DEFAULT_CHARSET,
        }
        print("Credenciais obtidas do Node com sucesso")
        print("Conectando tenant", f"{cfg['host']}:{cfg['port']}:{cfg['database']}")
        return cfg
    except HTTPException:
        raise
    except Exception as exc:
        print("Erro ao consultar Node para credenciais:", exc)
        raise HTTPException(status_code=500, detail="Falha ao buscar credenciais via Node")


def connect_client_db(
    cfg: Dict[str, Any],
    sql_dialect: Optional[int] = None,
) -> fdb.Connection:
    """Abre conexão com o banco do cliente com fallback de charset.

    - Tenta primeiro com WIN1252 (DEFAULT_CHARSET), depois UTF8.
    - Mantém opcionalmente o `sql_dialect` informado.
    """
    required = ["host", "port", "database", "user", "password"]
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        raise ValueError(f"Configuração do banco incompleta: {', '.join(missing)}")

    print("Conectando ao banco do cliente:", f"{cfg['host']}:{int(cfg['port'])}:{cfg['database']}")

    def _try_connect(charset: str) -> fdb.Connection:
        conn_kwargs = {
            "host": cfg["host"],
            "port": int(cfg["port"]),
            "database": cfg["database"],
            "user": cfg["user"],
            "password": cfg["password"],
            "charset": charset,
        }
        if sql_dialect is not None:
            conn_kwargs["sql_dialect"] = sql_dialect
        print(f"Tentando conectar com charset={charset}")
        return fdb.connect(**conn_kwargs)

    # Se já veio charset no cfg, usa direto
    if cfg.get("charset"):
        try:
            return _try_connect(cfg["charset"]) 
        except Exception as exc:
            print(f"Falha ao conectar (charset={cfg['charset']}): {exc}")
            raise

    # Tenta com WIN1252 e depois UTF8
    last_exc: Optional[Exception] = None
    for cs in (DEFAULT_CHARSET, "UTF8"):
        try:
            return _try_connect(cs)
        except Exception as exc:
            print(f"Falha ao conectar (charset={cs}): {exc}")
            last_exc = exc
    # Se chegou aqui, falhou
    raise last_exc or RuntimeError("Falha desconhecida de conexão ao Firebird")
