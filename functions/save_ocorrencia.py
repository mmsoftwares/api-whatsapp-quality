"""Funções para gravar ocorrências simples no banco do cliente."""

from datetime import datetime
from typing import Optional

import fdb
from functions.db_client import _load_fbclient_hardcoded

try:
    _ = _load_fbclient_hardcoded()
except Exception:
    pass

from .db_client import connect_client_db


"""Funções para gravar ocorrências simples no banco do cliente."""

from datetime import datetime
from typing import Optional
import fdb

from .db_client import connect_client_db


def save_ocorrencia_texto(
    nomovtra: int,
    texto: str,
    usuario: str,
    db_cfg: Optional[dict] = None,
) -> None:
    """
    Insere o texto informado na tabela TABMOVTRA_OCO.
    Gera o próximo NOITEM automaticamente.
    """
    con = None
    try:
        if not db_cfg:
            raise ValueError("Configuração do banco do cliente ausente.")

        print(
            f"Conectando ao tenant: {db_cfg['host']}:{db_cfg.get('port')}:{db_cfg['database']}"
        )
        con = connect_client_db(db_cfg)
        cur = con.cursor()

        # Descobre o próximo NOITEM
        cur.execute("SELECT COALESCE(MAX(NOITEM), 0) + 1 FROM TABMOVTRA_OCO WHERE NOMOVTRA = ?", (nomovtra,))
        noitem = cur.fetchone()[0]

        # Prepara data/hora
        agora = datetime.now()
        data = agora.date()
        hora = agora.strftime("%H:%M")
        cur.execute("SELECT 1 FROM TABMOVTRA WHERE NOMOVTRA = ?", (nomovtra,))
        print('Eis o nomovtra:')
        print(nomovtra)
        if not cur.fetchone():
            raise ValueError(f"⚠️ Entrega NOMOVTRA={nomovtra} não encontrada no banco.")


        # Insere
        cur.execute(
            """
            INSERT INTO TABMOVTRA_OCO (NOMOVTRA, NOITEM, DATA, HORA, OBS, USUARIO)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (nomovtra, noitem, data, hora, texto, usuario),
        )
        con.commit()

        print(f"✅ Ocorrência gravada: NOMOVTRA={nomovtra}, NOITEM={noitem}, OBS={texto}")

    finally:
        if con:
            try:
                con.close()
            except Exception:
                pass
