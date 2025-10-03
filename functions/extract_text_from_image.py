# functions/extract_text_from_image.py
"""OCR robusto para imagens (CNH, RG etc.) usando Tesseract (Windows/Linux/Mac).

- Resolve automaticamente o caminho do tesseract.exe (prioriza x86 no Python 32-bit).
- Usa por+eng se disponíveis.
- Pré-processa a imagem (EXIF, resize ~1800px, grayscale, denoise, autocontraste).
- Logs claros do caminho usado e idiomas encontrados.
"""

import io
import os
import logging
import shutil
import subprocess
from typing import Optional, List

from PIL import Image, ImageOps, ImageFilter
import pytesseract


def _resolve_tesseract_cmd() -> Optional[str]:
    # 1) VAR explícita
    env_cmd = os.getenv("TESSERACT_CMD")
    if env_cmd and os.path.isfile(env_cmd):
        return env_cmd

    # 2) Windows comuns (prioriza x86 para Python 32-bit)
    candidates = [
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        os.path.join(os.getenv("LOCALAPPDATA", ""), r"Programs\Tesseract-OCR\tesseract.exe"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c

    # 3) PATH
    which = shutil.which("tesseract")
    if which:
        return which

    return None


def _list_langs(cmd: str) -> List[str]:
    try:
        out = subprocess.check_output([cmd, "--list-langs"], stderr=subprocess.STDOUT, text=True, timeout=6)
        return [line.strip().lower() for line in out.splitlines() if line.strip() and not line.startswith("list of")]
    except Exception:
        return []


def _best_lang(cmd: str) -> Optional[str]:
    langs = _list_langs(cmd)
    has_por = "por" in langs
    has_eng = "eng" in langs
    if has_por and has_eng:
        return "por+eng"
    if has_por:
        return "por"
    if has_eng:
        return "eng"
    return None


def extract_text_from_image(file_bytes: bytes) -> str:
    tcmd = _resolve_tesseract_cmd()
    if not tcmd:
        raise RuntimeError(
            "Tesseract OCR não encontrado. Instale (winget install -e --id UB-Mannheim.TesseractOCR) "
            "ou defina TESSERACT_CMD com o caminho do executável."
        )
    pytesseract.pytesseract.tesseract_cmd = tcmd
    logging.info("🧭 Tesseract: %s", tcmd)

    tdata = os.getenv("TESSDATA_PREFIX")
    if tdata and os.path.isdir(tdata):
        logging.info("📁 TESSDATA_PREFIX: %s", tdata)

    # Carrega & corrige rotação
    image = Image.open(io.BytesIO(file_bytes))
    image = ImageOps.exif_transpose(image)

    # Pré-processamento
    img = image.convert("L")
    if img.width < 1800:
        ratio = 1800 / float(img.width)
        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
    img = img.filter(ImageFilter.MedianFilter(size=3))
    img = ImageOps.autocontrast(img)

    # Idiomas
    lang = _best_lang(tcmd)
    if lang:
        logging.info("🗣️ Idioma(s) OCR: %s", lang)
        config = "--oem 1 --psm 6"  # bloco de texto
        text = pytesseract.image_to_string(img, lang=lang, config=config)
    else:
        logging.warning("🗣️ Nenhum 'por/eng' instalado; seguindo sem lang.")
        text = pytesseract.image_to_string(img, config="--oem 1 --psm 6")

    return text.strip()
