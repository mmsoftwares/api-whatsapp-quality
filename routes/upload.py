# routes/upload.py
"""
Endpoint de upload que usa GPT direto em imagem (sem OCR local) e texto para PDFs.

Retorna:
{
  "status": "processado",
  "dados": { "kind": "text", "text": "<cartão/preview organizado>" },
  "temp_path": "<arquivo salvo>"
}
"""
import os
import uuid
import logging
import re
from pathlib import Path
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

from config import UPLOAD_DIR
from functions.extract_text_from_pdf import extract_text_from_pdf
from functions.parse_with_gpt import (
    parse_with_gpt,
    verify_cnh_fields_from_image,
    PROMPT_VEICULO_RULES,
    extract_cte_key,
)

router = APIRouter()

UPLOAD_DIR = Path(UPLOAD_DIR) if not isinstance(UPLOAD_DIR, Path) else UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}

# ===================== PROMPTS =====================

# Preview textual (WhatsApp) para CT-e
PROMPT_CTE_RULES = (
    "Você é um especialista em documentos fiscais brasileiros (CT-e). "
    "Analise a imagem/PDF e produza APENAS UM TEXTO organizado para pré-visualização no WhatsApp, "
    "em português do Brasil, com as linhas abaixo. Preencha '-' quando não encontrar. Não invente dados.\n\n"
    "📄 CT-e (resumo)\n"
    "Chave: {chave}\n"
    "Número: {numero}\n"
    "Série: {serie}\n"
    "Emissão: {data_emissao}\n"
    "Emitente: {emitente_nome} | CNPJ: {emitente_cnpj}\n"
    "Tomador: {tomador_nome} | CNPJ: {tomador_cnpj}\n"
    "Remetente: {remetente_nome} | CNPJ: {remetente_cnpj}\n"
    "Destinatário: {destinatario_nome} | CNPJ: {destinatario_cnpj}\n"
    "Origem: {municipio_origem}/{uf_origem}\n"
    "Destino: {municipio_destino}/{uf_destino}\n"
    "Modal: {modal}\n"
    "CFOP: {cfop}\n"
    "Valor total: {valor_total}\n"
    "Peso bruto (kg): {peso_bruto}\n"
    "Volumes: {qtd_volumes}\n"
    "Observações: {obs}\n\n"
    "Regras:\n"
    "- Se houver várias seções, use o que for do CT-e principal (não do MDF-e).\n"
    "- Mantenha exatamente os rótulos acima e substitua apenas os valores entre chaves.\n"
)

# ===================== Helpers de cartão (pessoa) =====================

def _format_cpf(digits: str) -> str:
    d = re.sub(r"\D", "", digits or "")
    if len(d) != 11:
        return "-"
    return f"{d[0:3]}.{d[3:6]}.{d[6:9]}-{d[9:11]}"

def _extract_card_line(card_text: str, label: str) -> str:
    m = re.search(rf"(?mi)^{re.escape(label)}:\s*(.+)$", card_text or "")
    return m.group(1).strip() if m else ""

def _replace_card_line(card_text: str, label: str, value: str) -> str:
    if re.search(rf"(?mi)^{re.escape(label)}:\s*", card_text or ""):
        return re.sub(rf"(?mi)^{re.escape(label)}:\s*.*$", f"{label}: {value}", card_text)
    # Insere abaixo do título do bloco se não existir
    parts = (card_text or "").split("\n")
    out = []
    inserted = False
    for line in parts:
        out.append(line)
        if not inserted and line.strip() == "🆔 Documento":
            out.append(f"{label}: {value}")
            inserted = True
    return "\n".join(out) if inserted else (card_text or "") + f"\n{label}: {value}"

def _fix_cpf(card_text: str) -> str:
    raw = _extract_card_line(card_text, "CPF")
    if not raw:
        return card_text
    return _replace_card_line(card_text, "CPF", _format_cpf(raw))

def _prefer_rg_from_verification(card_text: str, ver: dict) -> str:
    rg = re.sub(r"\D", "", ver.get("RG", "") or "")
    if 7 <= len(rg) <= 8:
        return _replace_card_line(card_text, "Registro", rg)
    return card_text

def _prefer_dob_from_verification(card_text: str, ver: dict) -> str:
    dob = ver.get("DOB") or "-"
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", dob):
        return _replace_card_line(card_text, "Data de nascimento", dob)
    return card_text

def _prefer_cnh_from_verification(card_text: str, ver: dict) -> str:
    """
    CNH: 11 dígitos (vermelho) ≠ CPF; senão 10 dígitos vertical; senão '-'.
    """
    cpf_line = _extract_card_line(card_text, "CPF")
    cpf_digits_card = re.sub(r"\D", "", cpf_line)
    cpf_digits_ver = re.sub(r"\D", "", ver.get("CPF", "") or "")
    cpf_digits = cpf_digits_ver if len(cpf_digits_ver) == 11 else cpf_digits_card

    cand11 = re.sub(r"\D", "", ver.get("CNH_REG_11", "") or "")
    cand10 = re.sub(r"\D", "", ver.get("CNH_REG_10", "") or "")

    chosen = None
    if len(cand11) == 11 and cand11 != cpf_digits:
        chosen = cand11
    elif len(cand10) == 10:
        chosen = cand10
    else:
        chosen = "-"

    return _replace_card_line(card_text, "Número de registro CNH", chosen)

# --- Categorias adicionais (pessoa)
_WHITELIST_ORDEM = ["ACC","A1","A","B1","B","C1","C","D1","D","E","BE","C1E","CE","D1E","DE"]

def _normalize_categorias(card_text: str) -> str:
    tokens = set(re.findall(r"\b(ACC|A1|A|B1|B|C1|C|D1|D|E|BE|C1E|CE|D1E|DE)\b", card_text or "", flags=re.I))
    if not tokens:
        return card_text
    cats = [c for c in _WHITELIST_ORDEM if c.upper() in {t.upper() for t in tokens}]
    if not cats:
        return card_text
    validade = _extract_card_line(card_text, "Validade")
    sufixo = f" (todas com validade até {validade})" if validade else ""
    nova = ", ".join(cats) + sufixo
    return _replace_card_line(card_text, "🚗 Categorias adicionais na tabela inferior", nova)

def _normalize_codigo(card_text: str) -> str:
    texto = card_text or ""
    num11 = re.search(r"\b(\d{11})\b", texto)
    sc = re.search(r"\b(SC\d{8,10})\b", texto, flags=re.I)
    if not num11 and not sc:
        return card_text
    partes = []
    if num11:
        partes.append(num11.group(1))
    if sc:
        partes.append(sc.group(1).upper())
    if not partes:
        return card_text
    return _replace_card_line(card_text, "Código", " / ".join(partes))

def _postprocess_card(card_text: str) -> str:
    t = (card_text or "").strip()
    t = _fix_cpf(t)
    t = _normalize_categorias(t)
    t = _normalize_codigo(t)
    t = re.sub(r"\n{3,}", "\n\n", t)  # múltiplas linhas vazias
    return t

# ===================== Helpers CT-e =====================

def _find_cte_key_44(texto: str) -> str:
    """
    Encontra a chave do CT-e em 'texto', permitindo separadores (ponto, barra, hífen, espaço)
    e retorna somente os 44 dígitos.
    """
    if not texto:
        return ""
    # Permite 44 dígitos com separadores entre eles
    m = re.search(r"(?:\d[.\-\/\s]?){44}", texto)
    if not m:
        return ""
    digits = re.sub(r"\D", "", m.group(0))
    return digits if len(digits) == 44 else ""

def _normalize_cte_chave_in_preview(preview_text: str, fonte_textual: str = "") -> str:
    """
    Substitui a linha 'Chave:' no preview por uma versão somente-números com 44 dígitos, se encontrada.
    Tenta primeiro na fonte_textual (OCR do PDF), depois no próprio preview.
    """
    key = _find_cte_key_44(fonte_textual) or _find_cte_key_44(preview_text)
    if not key:
        # Sem chave encontrada, mantém preview
        return preview_text
    return _replace_card_line(preview_text, "Chave", key)

# ===================== Endpoint =====================

@router.post("/upload")
async def upload(file: UploadFile = File(...), tipo: str = "pessoa"):
    """
    Recebe um arquivo e extrai dados conforme 'tipo' = pessoa | veiculo | cte.
    Retorna { status, dados:{kind:'text', text}, temp_path }.
    """
    tipo_norm = (tipo or "pessoa").strip().lower()
    logging.info("Recebendo arquivo %s (%s) tipo=%s", file.filename, file.content_type, tipo_norm)

    ext = Path(file.filename).suffix or ""
    temp_path = UPLOAD_DIR / f"{uuid.uuid4()}{ext}"

    try:
        contents = await file.read()
        with open(temp_path, "wb") as f:
            f.write(contents)

        ctype = (getattr(file, "content_type", "") or "").lower()
        logging.debug("Content-Type detectado: %s", ctype)

        dados = None
        raw_pdf_text = ""  # usado para cte (PDF)
        chave = None

        # ------- Imagens -------
        if ctype in ALLOWED_IMAGE_TYPES or ctype.startswith("image/"):
            if tipo_norm == "veiculo":
                dados = parse_with_gpt(
                    image_bytes=contents,
                    image_mime=ctype or "image/jpeg",
                    system_prompt=PROMPT_VEICULO_RULES,
                    use_structured=False,
                    expect_json=False,
                )
                logging.info("🧠 GPT processou IMAGEM (veículo)")
            elif tipo_norm == "cte":
                dados = parse_with_gpt(
                    image_bytes=contents,
                    image_mime=ctype or "image/jpeg",
                    system_prompt=PROMPT_CTE_RULES,
                    use_structured=False,
                    expect_json=False,
                )
                logging.info("🧠 GPT processou IMAGEM (CT-e)")
                text = dados.get("text") or ""
                chave = extract_cte_key(
                    image_bytes=contents, image_mime=ctype or "image/jpeg"
                )
                if not chave:
                    chave = _find_cte_key_44(text)
                if chave:
                    text = _replace_card_line(text, "Chave", chave)
                dados["text"] = text
                dados["chave"] = chave
                logging.info("🔧 CT-e: chave extraída (imagem)")
            else:  # pessoa
                dados = parse_with_gpt(
                    image_bytes=contents, image_mime=ctype or "image/jpeg"
                )
                logging.info("🧠 GPT processou IMAGEM (cartão pessoa)")

                # 2º passe → verificação focada (somente pessoa)
                ver = verify_cnh_fields_from_image(contents, ctype or "image/jpeg")
                logging.info("🔍 Verificação focada aplicada %s", {"ver": ver})

                # Mapeia DOB → DATANASC para salvar depois
                if ver.get("DOB") and re.fullmatch(r"\d{2}/\d{2}/\d{4}", ver["DOB"]):
                    dados["DATANASC"] = ver["DOB"]
                else:
                    dados["DATANASC"] = None  # forçar ausência se não veio válido

                text = dados.get("text") or ""
                text = _prefer_dob_from_verification(text, ver)
                text = _prefer_rg_from_verification(text, ver)
                text = _prefer_cnh_from_verification(text, ver)
                text = _postprocess_card(text)
                dados["text"] = text


        # ------- PDFs -------
        elif ctype == "application/pdf":
            raw_pdf_text = extract_text_from_pdf(str(temp_path))
            if tipo_norm == "veiculo":
                dados = parse_with_gpt(
                    texto=raw_pdf_text,
                    system_prompt=PROMPT_VEICULO_RULES,
                    use_structured=False,
                    expect_json=False,
                )
                logging.info("🧠 GPT processou PDF (veículo)")
            elif tipo_norm == "cte":
                dados = parse_with_gpt(
                    texto=raw_pdf_text,
                    system_prompt=PROMPT_CTE_RULES,
                    use_structured=False,
                    expect_json=False,
                )
                logging.info("🧠 GPT processou PDF (CT-e)")
                text = dados.get("text") or ""
                chave = extract_cte_key(texto=raw_pdf_text)
                if not chave:
                    chave = _find_cte_key_44(raw_pdf_text)
                if chave:
                    text = _replace_card_line(text, "Chave", chave)
                dados["text"] = text
                dados["chave"] = chave
                logging.info("🔧 CT-e: chave extraída (PDF)")
            else:
                dados = parse_with_gpt(texto=raw_pdf_text)
                logging.info("🧠 GPT processou PDF (cartão pessoa)")
                dados["text"] = _postprocess_card(dados.get("text") or "")

        # ------- Outros tipos -------
        else:
            try:
                os.remove(temp_path)
            except Exception:
                pass
            logging.warning("Tipo de arquivo não suportado: %s", ctype)
            raise HTTPException(status_code=415, detail=f"Tipo de arquivo não suportado: {ctype or 'desconhecido'}")

        # Normaliza saída
        if not isinstance(dados, dict) or dados.get("kind") != "text":
            dados = {"kind": "text", "text": str(dados)}

        return JSONResponse({"status": "processado", "dados": dados, "temp_path": str(temp_path), "chave": chave})

    except HTTPException:
        raise
    except Exception as e:
        logging.exception("Erro inesperado no upload")
        raise HTTPException(status_code=500, detail="Erro interno ao processar o arquivo") from e
