// src/utils/fiscalKey.js
// Utilitários para chave de acesso (44 dígitos) de documentos fiscais BR
// Suporta: NF-e (55), CT-e (57), MDF-e (58), NFC-e (65), CT-e OS (67)

const MODEL_MAP = {
  "55": "NFE",
  "57": "CTE",
  "58": "MDFE",
  "65": "NFCE",
  "67": "CTEOS",
};

/** Remove tudo que não for dígito. */
export function digitsOnly(s = "") {
  return String(s || "").replace(/\D+/g, "");
}

/** Extrai a primeira sequência de 44 dígitos de um texto (retorna null se não achar). */
export function extractAccessKey(text = "") {
  const only = digitsOnly(text);
  const m = only.match(/\d{44}/);
  return m ? m[0] : null;
}

/** Verifica se uma string é 44 dígitos. */
export function isAccessKey(s = "") {
  return /^\d{44}$/.test(s);
}

/** Calcula DV (módulo-11) para os 43 primeiros dígitos. */
export function calcDV(key43) {
  const s = digitsOnly(key43);
  if (s.length !== 43) return null;
  // pesos 2..9 ciclando da direita p/ esquerda
  let peso = 2;
  let soma = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    soma += Number(s[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  // regra oficial: resultado 0 ou 1 => DV = 0; senão DV = 11 - resto
  return dv >= 10 ? 0 : dv;
}

/** Valida a chave: comprimento + DV correto. */
export function validateAccessKey(key) {
  const k = digitsOnly(key);
  if (k.length !== 44) return false;
  const dv = calcDV(k.slice(0, 43));
  return dv !== null && dv === Number(k[43]);
}

/** Pega o código do modelo (posições 21–22, 1-based). */
export function getModelCode(key) {
  const k = digitsOnly(key);
  if (k.length !== 44) return null;
  // em JS, índices 0-based: posições 20 e 21
  return k.slice(20, 22);
}

/** Retorna o tipo legível: NFE, CTE, MDFE, NFCE, CTEOS ou 'DESCONHECIDO'. */
export function detectDocType(key) {
  const model = getModelCode(key);
  return MODEL_MAP[model] || "DESCONHECIDO";
}

/** Quebra a chave em campos (útil para logs/roteamento). */
export function parseAccessKey(key) {
  const k = digitsOnly(key);
  if (k.length !== 44) return null;
  return {
    raw: k,
    cUF: k.slice(0, 2),               // 1–2
    AAMM: k.slice(2, 6),              // 3–6
    AA: k.slice(2, 4),
    MM: k.slice(4, 6),
    CNPJ: k.slice(6, 20),             // 7–20
    mod: k.slice(20, 22),             // 21–22 (modelo)
    serie: k.slice(22, 25),           // 23–25
    numero: k.slice(25, 34),          // 26–34 (nNF/nCT)
    tpEmis: k.slice(34, 35),          // 35
    cControle: k.slice(35, 43),       // 36–43 (cNF/cCT)
    dv: k.slice(43, 44),              // 44
    tipo: detectDocType(k),
    dvValido: validateAccessKey(k),
  };
}
