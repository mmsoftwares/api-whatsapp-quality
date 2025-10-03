"""Função para extrair texto de arquivos PDF."""

import logging
from pdfminer.high_level import extract_text


def extract_text_from_pdf(file_path: str) -> str:
    """Extrai texto de um PDF usando pdfminer.six."""
    texto = extract_text(file_path)
    logging.debug("Texto extra\u00eddo do PDF %s", file_path)
    return texto
