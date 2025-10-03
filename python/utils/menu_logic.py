#!/usr/bin/env python3
"""Ferramentas para calcular chaves e textos de menus."""

import os
import sys
import json
import argparse

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
from functions.save_to_firebird import _normalize_key  # noqa: E402


def compute_menu_keys_and_text(data: dict) -> dict:
    """Calcula campos derivados das opções do menu."""
    options = []
    for idx, opt in enumerate(data.get("options", []), start=1):
        opcao = _normalize_key(opt.get("opcao") or "")
        texto = opt.get("texto") or ""
        options.append(
            {
                "opcao": opcao,
                "texto": texto,
                "chave_pai": "root",
                "proxima_chave": None,
                "ordem": idx * 10,
            }
        )
    return {"options": options}


def main() -> None:
    """Interface de linha de comando."""
    parser = argparse.ArgumentParser(description="Processa lógica de menu")
    parser.parse_args()
    raw = sys.stdin.read()
    data = json.loads(raw or "{}")
    result = compute_menu_keys_and_text(data)
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
