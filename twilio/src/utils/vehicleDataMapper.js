// utils/vehicleDataMapper.js

// Tamanhos máximos conforme Firebird (somente VARCHARs)
const MAXLEN = {
  PLACA: 10,
  RENAVAN: 30,
  CATEGORIA: 100,
  CAPACIDADE: 50,
  POTENCIA: 50,
  PESOBRUTO: 50,
  MOTOR: 50,
  CMT: 50,
  LOTACAO: 50,
  CARROCERIA: 50,
  NOME: 150,
  CPFCNPJ: 20,
  LOCALIDADE: 50,          // <— atualizado
  CODIGOCLA: 50,
  CAT: 50,
  MARCA_MODELO: 50,
  ESPECIE_TIPO: 50,
  PLACAANTERIOR: 10,
  CHASSI: 50,
  COR: 50,
  COMBUSTIVEL: 50,
  OBS: 500,
  LINK: 500,
};

const INT_FIELDS = ["ANOEXERCICIO", "ANOMODELO", "ANOFABRICACAO", "EIXOS"];
const DATE_FIELDS = ["DATA_LANC", "DATAALT"]; // <— atualizado

// Aliases comuns do OCR → nomes da tabela
const FIELD_MAP = {
  // básicos
  placa: "PLACA",
  placa_atual: "PLACA",
  placa_anterior: "PLACAANTERIOR",
  placa_antiga: "PLACAANTERIOR",

  renavam: "RENAVAN",
  renavam_numero: "RENAVAN",

  ano_exercicio: "ANOEXERCICIO",
  ano_modelo: "ANOMODELO",
  ano_fabricacao: "ANOFABRICACAO",

  categoria: "CATEGORIA",
  capacidade: "CAPACIDADE",
  potencia: "POTENCIA",
  peso_bruto: "PESOBRUTO",
  pesobruto: "PESOBRUTO",
  motor: "MOTOR",
  cmt: "CMT",
  eixos: "EIXOS",
  lotacao: "LOTACAO",
  carroceria: "CARROCERIA",

  nome: "NOME",
  proprietario: "NOME",

  cpf: "CPFCNPJ",
  cnpj: "CPFCNPJ",
  cpf_cnpj: "CPFCNPJ",

  local: "LOCALIDADE",          // <— atualizado
  municipio: "LOCALIDADE",      // <— atualizado

  data: "DATA_LANC",            // <— atualizado
  data_emissao: "DATA_LANC",    // <— atualizado

  codigocla: "CODIGOCLA",
  codigo_cla: "CODIGOCLA",
  cat: "CAT",

  marca: "MARCA_MODELO",
  modelo: "MARCA_MODELO",
  marca_modelo: "MARCA_MODELO",

  especie: "ESPECIE_TIPO",
  especie_tipo: "ESPECIE_TIPO",

  chassi: "CHASSI",
  cor: "COR",
  combustivel: "COMBUSTIVEL",

  obs: "OBS",
  observacoes: "OBS",
};

function truncate(val, max) {
  if (val == null) return "";
  const s = String(val).trim();
  return s.length > max ? s.substring(0, max) : s;
}

function normalizeDate(val) {
  if (!val) return "";
  const m = String(val).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return "";
  let [, d, mm, y] = m;
  if (y.length === 2) y = "20" + y;
  return `${d.padStart(2, "0")}/${mm.padStart(2, "0")}/${y}`;
}

export function mapVehicleData(input) {
  const out = {};
  for (const [key, val] of Object.entries(input || {})) {
    const k = (key || "").toLowerCase();
    const col = FIELD_MAP[k] || key.toUpperCase();

    if (MAXLEN[col] !== undefined) {
      out[col] = truncate(val, MAXLEN[col]);
    } else if (INT_FIELDS.includes(col)) {
      const n = parseInt(val, 10);
      if (!isNaN(n)) out[col] = n;
    } else if (DATE_FIELDS.includes(col)) {
      const d = normalizeDate(val);
      if (d) out[col] = d;
    }
    // Campos desconhecidos são ignorados
  }
  return out;
}
