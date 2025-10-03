# functions/parse_with_gpt.py
import os
import io
import re
import json
import base64
import logging
from typing import Optional, List, Dict

from fastapi import HTTPException
from PIL import Image, ImageOps, ImageFilter
from openai import OpenAI
from config import OPENAI_API_KEY

MODEL_PRIMARY = os.getenv("OPENAI_PRIMARY_MODEL", "gpt-4o-mini")
MODEL_FALLBACK = os.getenv("OPENAI_FALLBACK_MODEL", "gpt-4o")

client = OpenAI(api_key=OPENAI_API_KEY)

# -------- Prompts --------
PROMPT_CNH_RULES = """
Você é um extrator especializado em CNH brasileira (modelo antigo em papel/plástico).
Extraia os CAMPOS solicitados de forma factual, sem inferências. Se um campo não existir ou estiver ilegível, use "-".
Datas sempre em DD/MM/AAAA. CPF como XXX.XXX.XXX-YY.

ATENÇÃO:
- “Número de registro CNH” = o **nº registro** do quadro superior direito, em VERMELHO, com 11 dígitos.
  - Se esse número NÃO existir, use o número vertical/rodapé em PRETO, com 10 dígitos.
- “Registro” = RG do espelho (geralmente 6–8 dígitos). Não confundir com o nº de registro da CNH.
- “Data de nascimento” deve vir do campo “DATA DE NASC.” da CNH.

IMPORTANTE: RESPONDA EM JSON válido conforme o schema chamado "cnh_card".
""".strip()

PROMPT_VERIFY = """
Observe a imagem da CNH e responda em CINCO linhas, exatamente neste formato:

DOB: <DD/MM/AAAA ou ->
RG: <apenas dígitos 6-10 ou ->
CNH_REG_11: <11 dígitos do “nº registro” em vermelho (NÃO é CPF) ou ->
CNH_REG_10: <10 dígitos do número vertical/rodapé preto ou ->
CPF: <11 dígitos do CPF ou ->

Regras:
- CNH_REG_11 NUNCA deve ser o CPF. Se só encontrar o CPF (11 dígitos), retorne '-' em CNH_REG_11.
- Não explique. Não adicione nada além dessas cinco linhas.
""".strip()

# Prompt para extração de dados de veículos
PROMPT_VEICULO_RULES = """
Você é um extrator especializado em documentos de veículos brasileiros (CRLV/CRV).
Retorne um cartão em texto com os campos abaixo, um por linha no formato
"CAMPO: valor". Se algum campo estiver ausente ou ilegível, use "-".

Campos:
PLACA
RENAVAM
ANO EXERCICIO
ANO MODELO
ANO FABRICACAO
CATEGORIA
CAPACIDADE
POTENCIA
PESO BRUTO
MOTOR
CMT
EIXOS
LOTACAO
CARROCERIA
NOME
CPF/CNPJ
LOCAL
DATA
CODIGO CLA
CAT
MARCA/MODELO
ESPÉCIE/TIPO
PLACA ANTERIOR
CHASSI
COR
COMBUSTIVEL
OBS
""".strip()

# Prompt para extrair a chave de acesso (CT-e)
PROMPT_CTE_CHAVE = (
    "Você é um especialista em documentos fiscais brasileiros (CT-e). "
    "Extraia apenas a *chave de acesso* de 44 dígitos do documento fornecido. "
    "Responda somente com os 44 dígitos; se não encontrar, responda 'NAO_ENCONTRADO'."
).strip()

# -------- JSON Schema (strict) --------
CARD_JSON_SCHEMA = {
    "name": "cnh_card",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "identificacao": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "nome": {"type": "string"},
                    "data_nascimento": {"type": "string"},
                    "local_nascimento": {"type": "string"},
                    "nacionalidade": {"type": "string"},
                    "pai": {"type": "string"},
                    "mae": {"type": "string"}
                },
                # strict exige todos os keys em required
                "required": ["nome", "data_nascimento", "local_nascimento", "nacionalidade", "pai", "mae"]
            },
            "documento": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "registro_rg": {"type": "string"},
                    "cpf": {"type": "string"},
                    "categoria": {"type": "string"},
                    "numero_registro_cnh": {"type": "string"},
                    "primeira_habilitacao": {"type": "string"}
                },
                "required": ["registro_rg", "cpf", "categoria", "numero_registro_cnh", "primeira_habilitacao"]
            },
            "emissao": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "data_emissao": {"type": "string"},
                    "validade": {"type": "string"}
                },
                "required": ["data_emissao", "validade"]
            },
            "categorias_adicionais": {
                "type": "array",
                "items": {"type": "string"}
            },
            "orgao_emissor": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "uf": {"type": "string"},
                    "local_emissao": {"type": "string"},
                    "codigo": {"type": "string"}
                },
                "required": ["uf", "local_emissao", "codigo"]
            }
        },
        # strict:true normalmente requer todos os properties no topo também
                "required": ["identificacao", "documento", "emissao", "categorias_adicionais", "orgao_emissor"]
    }
}

# -------- Image utils --------
def preprocess_image(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("L")
        img.thumbnail((1600, 1600))
        img = ImageOps.autocontrast(img, cutoff=1)
        img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=150, threshold=3))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92, optimize=True)
        return buf.getvalue()

# -------- GPT helpers --------
def _call_gpt_text(messages: List[dict], model: str) -> str:
    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.0,
    )
    content = (resp.choices[0].message.content or "").strip()
    logging.debug("[GPT/%s] out(300): %s", model, content[:300].replace("\n", " "))
    return content

def _call_gpt_structured(messages: List[dict], model: str, schema: dict) -> dict:
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.0,
            response_format={"type": "json_schema", "json_schema": schema},
        )
    except Exception as e:
        logging.warning("json_schema não suportado (%s). Tentando json_object.", e)
        # Para json_object, o prompt PRECISA conter a palavra "json" (já contém)
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.0,
            response_format={"type": "json_object"},
        )
    content = (resp.choices[0].message.content or "").strip()
    return json.loads(content)

def _sanitize_card(card: str) -> str:
    if not card:
        return card
    m = re.match(r"^\s*```[a-zA-Z0-9]*\s*([\s\S]*?)\s*```\s*$", card)
    if m:
        card = m.group(1)
    card = card.replace("\r\n", "\n").replace("\\n", "\n")
    card = re.sub(r"\n{3,}", "\n\n", card)
    return card.strip()

def _is_empty_card(card_text: str) -> bool:
    if not card_text:
        return True
    text = card_text.strip()
    bullets = re.findall(r"^.+?:\s*(.+)$", text, flags=re.MULTILINE)
    non_dash = [v for v in bullets if v.strip() and v.strip() != "-"]
    has_doc_num = bool(re.search(r"\b\d{11}\b", text)) or bool(re.search(r"\b\d{10}\b", text)) \
                  or bool(re.search(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", text))
    has_date = bool(re.search(r"\b\d{2}/\d{2}/\d{4}\b", text))
    return not (len(non_dash) >= 3 and (has_doc_num or has_date))

# -------- Message builders --------
def _build_messages_for_image(
    base_prompt: str, data_url: str, expect_json: bool = True
) -> List[dict]:
    """Monta mensagens para envio de imagem ao GPT."""
    system = (
        "Extraia exatamente os campos solicitados e RESPONDA EM JSON."
        if expect_json
        else "Extraia exatamente os campos solicitados e responda apenas com o cartão em texto."
    )
    return [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": base_prompt},
                {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
            ],
        },
    ]


def _build_messages_for_text(
    base_prompt: str, texto: str, expect_json: bool = True
) -> List[dict]:
    """Monta mensagens para envio de texto ao GPT."""
    system = (
        "Extraia exatamente os campos solicitados e RESPONDA EM JSON."
        if expect_json
        else "Extraia exatamente os campos solicitados e responda apenas com o cartão em texto."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": base_prompt + "\n\n" + (texto or "")},
    ]

# -------- Card builder --------
def _card_from_structured(d: dict) -> str:
    idt = d.get("identificacao", {}) or {}
    doc = d.get("documento", {}) or {}
    emi = d.get("emissao", {}) or {}
    org = d.get("orgao_emissor", {}) or {}
    cats = d.get("categorias_adicionais") or []

    nome = idt.get("nome", "-")
    dn = idt.get("data_nascimento", "-")
    ln = idt.get("local_nascimento", "-")
    nac = idt.get("nacionalidade", "BRASILEIRO") or "BRASILEIRO"
    pai = idt.get("pai", "-")
    mae = idt.get("mae", "-")

    rg = doc.get("registro_rg", "-")
    cpf = doc.get("cpf", "-")
    cat = doc.get("categoria", "-")
    cnhreg = doc.get("numero_registro_cnh", "-")
    pha = doc.get("primeira_habilitacao", "-")

    de = emi.get("data_emissao", "-")
    val = emi.get("validade", "-")

    uf = org.get("uf", "-")
    le = org.get("local_emissao", "-")
    cod = org.get("codigo", "-")

    cats_str = ", ".join([c for c in cats if isinstance(c, str) and c.strip()]) or "-"

    return (
        "📇 Identificação\n"
        f"Nome: {nome}\n"
        f"Data de nascimento: {dn}\n"
        f"Local de nascimento: {ln}\n"
        f"Nacionalidade: {nac}\n"
        "Filiação:\n"
        f"Pai: {pai}\n"
        f"Mãe: {mae}\n\n"
        "🆔 Documento\n"
        f"Registro: {rg}\n"
        f"CPF: {cpf}\n"
        f"Categoria Habilitação: {cat}\n"
        f"Número de registro CNH: {cnhreg}\n"
        f"Data da 1ª habilitação: {pha}\n\n"
        "📅 Validade e emissão\n"
        f"Data de emissão: {de}\n"
        f"Validade: {val}\n\n"
        "🚗 Categorias adicionais na tabela inferior\n"
        f"{cats_str}\n\n"
        "🏛 Órgão emissor\n"
        f"UF: {uf}\n"
        f"Local de emissão: {le}\n"
        f"Código: {cod}"
    )

# -------- Public API --------
def parse_with_gpt(
    texto: Optional[str] = None,
    image_bytes: Optional[bytes] = None,
    image_mime: Optional[str] = None,
    system_prompt: Optional[str] = None,
    use_structured: bool = True,
    expect_json: bool = True,
) -> dict:
    """
    Retorna {"kind":"text","text":"<cartão>"}.
    1) Tenta saída estruturada (JSON Schema) e converte para cartão.
    2) Fallback para json_object.
    3) Fallback para texto; se texto for JSON e `expect_json` for True,
       converte para cartão.
    4) Fallback de modelo (PRIMARY -> FALLBACK) quando necessário.

    Parâmetros:
    - expect_json: define se a resposta deve vir em JSON.
    """
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY não configurada.")
    if not texto and not image_bytes:
        raise HTTPException(status_code=400, detail="Nada para processar (texto ou imagem ausentes).")

    base_prompt = (system_prompt or PROMPT_CNH_RULES).strip()

    if image_bytes:
        if not image_mime or not image_mime.startswith("image/"):
            raise HTTPException(status_code=400, detail="image_mime inválido para imagem.")
        processed = preprocess_image(image_bytes)
        b64 = base64.b64encode(processed).decode("ascii")
        data_url = f"data:image/jpeg;base64,{b64}"
        messages = _build_messages_for_image(base_prompt, data_url, expect_json)
    else:
        messages = _build_messages_for_text(base_prompt, texto or "", expect_json)

    # 1) Structured (json_schema/json_object)
    if expect_json and use_structured:
        try:
            data = _call_gpt_structured(messages, MODEL_PRIMARY, CARD_JSON_SCHEMA)
            card = _sanitize_card(_card_from_structured(data))
            if card:
                return {"kind": "text", "text": card}
        except Exception as e1:
            logging.warning("Structured output falhou: %s", e1)

    # 2) Texto (pode vir JSON mesmo assim)
    try:
        card = _call_gpt_text(messages, MODEL_PRIMARY)
    except Exception:
        # tenta fallback de modelo
        card = _call_gpt_text(messages, MODEL_FALLBACK)

    card_str = card.strip()
    if expect_json and card_str.startswith("{"):
        try:
            data = json.loads(card_str)
            card_str = _card_from_structured(data)
        except Exception:
            pass

    card_str = _sanitize_card(card_str) or "Não consegui ler as informações do documento."
    return {"kind": "text", "text": card_str}

# -------- 2º passe focado --------
def verify_cnh_fields_from_image(image_bytes: bytes, image_mime: str) -> Dict[str, str]:
    """
    Retorna: {DOB, RG, CNH_REG_11, CNH_REG_10, CPF}
    """
    try:
        processed = preprocess_image(image_bytes)
        b64 = base64.b64encode(processed).decode("ascii")
        data_url = f"data:image/jpeg;base64,{b64}"
        messages = [
            {"role": "system", "content": "Responda estritamente no formato solicitado (json não é necessário)."},
            {"role": "user", "content": [
                {"type": "text", "text": PROMPT_VERIFY},
                {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
            ]},
        ]
        out = _call_gpt_text(messages, MODEL_PRIMARY)
        res = {"DOB": "-", "RG": "-", "CNH_REG_11": "-", "CNH_REG_10": "-", "CPF": "-"}
        for line in out.splitlines():
            line = line.strip()
            m = re.match(r"^(DOB|RG|CNH_REG_11|CNH_REG_10|CPF):\s*(.*)$", line, flags=re.I)
            if not m:
                continue
            key = m.group(1).upper()
            val = (m.group(2) or "").strip()
            if key == "DOB":
                if re.fullmatch(r"\d{2}/\d{2}/\d{4}", val): res["DOB"] = val
            elif key == "RG":
                digits = re.sub(r"\D", "", val)
                if 6 <= len(digits) <= 10: res["RG"] = digits
            elif key == "CNH_REG_11":
                digits = re.sub(r"\D", "", val)
                if len(digits) == 11: res["CNH_REG_11"] = digits
            elif key == "CNH_REG_10":
                digits = re.sub(r"\D", "", val)
                if len(digits) == 10: res["CNH_REG_10"] = digits
            elif key == "CPF":
                digits = re.sub(r"\D", "", val)
                if len(digits) == 11: res["CPF"] = digits
        return res
    except Exception as e:
        logging.warning("verify_cnh_fields_from_image falhou: %s", e)
        return {"DOB": "-", "RG": "-", "CNH_REG_11": "-", "CNH_REG_10": "-", "CPF": "-"}


def extract_cte_key(
    texto: Optional[str] = None,
    image_bytes: Optional[bytes] = None,
    image_mime: Optional[str] = None,
) -> str:
    """Extrai a chave de 44 dígitos de um CT-e em imagem ou texto."""
    if not texto and not image_bytes:
        raise HTTPException(status_code=400, detail="Nada para processar (texto ou imagem ausentes).")

    base_prompt = PROMPT_CTE_CHAVE

    if image_bytes:
        if not image_mime or not image_mime.startswith("image/"):
            raise HTTPException(status_code=400, detail="image_mime inválido para imagem.")
        processed = preprocess_image(image_bytes)
        b64 = base64.b64encode(processed).decode("ascii")
        data_url = f"data:image/jpeg;base64,{b64}"
        messages = _build_messages_for_image(base_prompt, data_url, expect_json=False)
    else:
        messages = _build_messages_for_text(base_prompt, texto or "", expect_json=False)

    try:
        out = _call_gpt_text(messages, MODEL_PRIMARY)
    except Exception:
        out = _call_gpt_text(messages, MODEL_FALLBACK)

    digits = re.sub(r"\D", "", out)
    return digits if len(digits) == 44 else ""
