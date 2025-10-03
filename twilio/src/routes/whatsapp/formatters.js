export function menuText() {
  return [
    "📋 Escolha uma opção digitando o número:",
    "1 Detalhes da entrega",
    "2 Enviar ocorrência",
    "3 Enviar comprovante CTE",
    "4 Realizar um novo cadastro de motorista",
    "5 Realizar um novo de veículo",
    "⚠ Para retornar ao menu digite 'Menu'"
    
  ].join("\n");
}

export function formatEntrega(entrega) {
  if (!entrega) return "❌ Entrega não encontrada.";
  const g = (k) => entrega[k] ?? entrega[k?.toUpperCase()];
  return [
    "📦 *Detalhes da entrega*",
    `• Número: ${g("numero") ?? "-"}`,
    `• Status: ${g("status") ?? "-"}`,
    `• Prevista: ${g("data_prevista") ?? "-"}`,
    `• Entrega: ${g("data_entrega") ?? "-"}`,
    `• Cliente: ${g("cliente_nome") ?? "-"}`,
    `• CNPJ: ${g("cliente_cnpj") ?? "-"}`,
    `• Motorista: ${g("motorista_nome") ?? "-"}`,
    `• Placa: ${g("placa") ?? "-"}`,
    `• Valor total: ${g("valor_total") ?? "-"}`
  ].join("\n");
}

export function pickOrganizedText(dados) {
  try {
    if (!dados) return null;
    if (typeof dados === "string") return dados.replace(/\\n/g, "\n");

    if (typeof dados === "object") {
      if (dados.kind === "text" && typeof dados.text === "string") return dados.text.replace(/\\n/g, "\n");
      if (dados.dados && dados.dados.kind === "text" && typeof dados.dados.text === "string")
        return dados.dados.text.replace(/\\n/g, "\n");
      if (typeof dados.text === "string") return dados.text.replace(/\\n/g, "\n");
      if (Array.isArray(dados)) {
        const firstText = dados.find((v) => typeof v === "string" || (v && typeof v.text === "string"));
        if (typeof firstText === "string") return firstText.replace(/\\n/g, "\n");
        if (firstText && typeof firstText.text === "string") return firstText.text.replace(/\\n/g, "\n");
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function safeStringify(obj) {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
    return s.length > 1200 ? s.slice(0, 1200) + "..." : s;
  } catch {
    return "[sem resumo]";
  }
}

const FIELD_LABELS = {
  NOME: "Nome",
  NASCIMENTO: "Data de nascimento",
  "DATA DE NASCIMENTO": "Data de nascimento",
  LOCAL: "Local de nascimento",
  "LOCAL DE NASCIMENTO": "Local de nascimento",
  NACIONALIDADE: "Nacionalidade",
  PAI: "Pai",
  MAE: "Mãe",
  MÃE: "Mãe",
  REGISTRO: "Registro",
  RG: "Registro",
  CPF: "CPF",
  CATEGORIA: "Categoria Habilitação",
  "CATEGORIA HABILITAÇÃO": "Categoria Habilitação",
  CNH: "Número de registro CNH",
  "NÚMERO DE REGISTRO CNH": "Número de registro CNH",
  "1HAB": "Data da 1ª habilitação",
  "PRIMEIRA HABILITACAO": "Data da 1ª habilitação",
  "PRIMEIRA HABILITAÇÃO": "Data da 1ª habilitação",
  EMISSAO: "Data de emissão",
  "DATA DE EMISSÃO": "Data de emissão",
  VALIDADE: "Validade",
  CATEGORIAS: "🚗 Categorias adicionais na tabela inferior",
  UF: "UF",
  "LOCAL DE EMISSÃO": "Local de emissão",
  "LOCAL DE EMISSAO": "Local de emissão",
  CIDADE: "Local de emissão",
  CODIGO: "Código",
  CÓDIGO: "Código"
};

const VEHICLE_FIELD_LABELS = {
  PLACA: "Placa",
  RENAVAM: "Renavam",
  "ANO EXERCICIO": "Ano exercício",
  "ANO EXERCÍCIO": "Ano exercício",
  "ANO MODELO": "Ano modelo",
  "ANO FABRICACAO": "Ano fabricação",
  "ANO FABRICAÇÃO": "Ano fabricação",
  CATEGORIA: "Categoria",
  CAPACIDADE: "Capacidade",
  POTENCIA: "Potência",
  POTÊNCIA: "Potência",
  "PESO BRUTO": "Peso bruto",
  MOTOR: "Motor",
  CMT: "CMT",
  EIXOS: "Eixos",
  LOTACAO: "Lotação",
  LOTAÇÃO: "Lotação",
  CARROCERIA: "Carroceria",
  NOME: "Nome",
  "CPF/CNPJ": "CPF/CNPJ",
  LOCAL: "Local",
  DATA: "Data",
  "CODIGO CLA": "Código CLA",
  "CÓDIGO CLA": "Código CLA",
  CAT: "Cat",
  "MARCA/MODELO": "Marca/modelo",
  "ESPÉCIE/TIPO": "Espécie/tipo",
  "ESPECIE/TIPO": "Espécie/tipo",
  "PLACA ANTERIOR": "Placa anterior",
  CHASSI: "Chassi",
  COR: "Cor",
  COMBUSTIVEL: "Combustível",
  COMBUSTÍVEL: "Combustível",
  OBS: "Obs"
};

export function correctionHelp() {
  const campos = [
    "nome",
    "data de nascimento",
    "local de nascimento",
    "pai",
    "mãe",
    "registro (RG)",
    "cpf",
    "categoria habilitação",
    "número de registro cnh",
    "data da 1ª habilitação",
    "data de emissão",
    "validade",
    "categorias",
    "uf",
    "local de emissão",
    "código"
  ].join(", ");
  return [
    "✏️ *Corrigir campos do cartão*",
    "Envie:  *CORRIGIR* campo=valor ; campo2=valor2",
    "Exemplos:",
    "• CORRIGIR nome=JOÃO DA SILVA ; cpf=12345678901 ; nascimento=31/12/1990",
    "• CORRIGIR registro=3274081",
    "• CORRIGIR categorias=ACC, A1, A, B1, B",
    "",
    "Campos aceitos:",
    campos
  ].join("\n");
}

export function vehicleCorrectionHelp() {
  const campos = [
    "placa",
    "renavam",
    "ano exercício",
    "ano modelo",
    "ano fabricação",
    "categoria",
    "capacidade",
    "potência",
    "peso bruto",
    "motor",
    "cmt",
    "eixos",
    "lotação",
    "carroceria",
    "nome",
    "cpf/cnpj",
    "local",
    "data",
    "código cla",
    "cat",
    "marca/modelo",
    "espécie/tipo",
    "placa anterior",
    "chassi",
    "cor",
    "combustível",
    "obs",
  ].join(", ");
  return [
    "✏️ *Corrigir campos do cartão*",
    "Envie:  *CORRIGIR* campo=valor ; campo2=valor2",
    "Exemplos:",
    "• CORRIGIR placa=ABC1D23 ; renavam=123456789",
    "• CORRIGIR cor=AZUL",
    "",
    "Campos aceitos:",
    campos,
  ].join("\n");
}

export function formatIdPreviewCard(text) {
  return (
    "🧾 *Prévia dos dados extraídos:*\n" +
    (text || "(vazio)") +
    "\n\nSe precisar, envie mais fotos. Quando terminar, digite *CONFIRMAR*.\n" +
    "Para editar campos incorretos, use: *CORRIGIR* campo=valor ; campo2=valor2\n" +
    "Ex.: *CORRIGIR* nome=MARIA ; cpf=12345678901 ; nascimento=10/01/1985\n" +
    "Digite *CAMPOS* para ver a lista."
  );
}

export function formatVehiclePreviewCard(text) {
  return (
    "🧾 *Prévia dos dados extraídos:*\n" +
    (text || "(vazio)") +
    "\n\nSe precisar, envie mais fotos. Quando terminar, digite *CONFIRMAR*.\n" +
    "Para editar campos incorretos, use: *CORRIGIR* campo=valor ; campo2=valor2\n" +
    "Ex.: *CORRIGIR* placa=ABC1D23 ; renavam=123456789\n" +
    "Digite *CAMPOS* para ver a lista."
  );
}

export function parseCorrections(raw) {
  const out = {};
  const cleaned = raw.replace(/^CORRIGIR\s*/i, "").trim();
  if (!cleaned) return out;
  const parts = cleaned
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^([^=:]+)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    let key = m[1].trim().toUpperCase();
    const value = m[2].trim();
    if (FIELD_LABELS[key]) {
      out[FIELD_LABELS[key]] = value;
      continue;
    }
    key = key
      .replace(/\s+/g, " ")
      .replace(/Ã‰/g, "É")
      .replace(/Ãœ/g, "Ü")
      .replace(/Ãƒ/g, "Ã");
    for (const k of Object.keys(FIELD_LABELS)) {
      if (k.startsWith(key)) {
        out[FIELD_LABELS[k]] = value;
        break;
      }
    }
  }
  return out;
}

export function parseVehicleCorrections(raw) {
  const out = {};
  const cleaned = raw.replace(/^CORRIGIR\s*/i, "").trim();
  if (!cleaned) return out;
  const parts = cleaned
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^([^=:]+)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    let key = m[1].trim().toUpperCase();
    const value = m[2].trim();
    if (VEHICLE_FIELD_LABELS[key]) {
      out[VEHICLE_FIELD_LABELS[key]] = value;
      continue;
    }
    key = key.replace(/\s+/g, " ");
    for (const k of Object.keys(VEHICLE_FIELD_LABELS)) {
      if (k.startsWith(key)) {
        out[VEHICLE_FIELD_LABELS[k]] = value;
        break;
      }
    }
  }
  return out;
}

export function replaceCardLine(cardText, label, value) {
  if (!cardText) return cardText;
  const rx = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*.*$`, "mi");
  if (rx.test(cardText)) return cardText.replace(rx, `${label}: ${value}`);

  const lines = cardText.split("\n");
  const out = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (!inserted && lines[i].trim() === "🆔 Documento" && (
      label === "Registro" || label === "CPF" || label === "Categoria Habilitação" ||
      label === "Número de registro CNH" || label === "Data da 1ª habilitação"
    )) {
      out.push(`${label}: ${value}`); inserted = true;
    }
    if (!inserted && lines[i].trim() === "📇 Identificação" && (
      label === "Nome" || label === "Data de nascimento" || label === "Local de nascimento" ||
      label === "Nacionalidade" || label === "Pai" || label === "Mãe"
    )) {
      out.push(`${label}: ${value}`); inserted = true;
    }
    if (!inserted && lines[i].trim() === "📅 Validade e emissão" && (
      label === "Data de emissão" || label === "Validade"
    )) {
      out.push(`${label}: ${value}`); inserted = true;
    }
    if (!inserted && lines[i].trim().startsWith("🚗")) {
      if (label === "🚗 Categorias adicionais na tabela inferior") {
        out.push(`${label}: ${value}`.replace(`${label}: `, "")); inserted = true;
      }
    }
    if (!inserted && lines[i].trim().startsWith("🏛")) {
      if (label === "UF" || label === "Local de emissão" || label === "Código") {
        out.push(`${label}: ${value}`); inserted = true;
      }
    }
  }
  if (!inserted) out.push(`${label}: ${value}`);
  return out.join("\n");
}

function normalizeCpfDigits(v) {
  const d = (v || "").replace(/\D/g, "");
  if (d.length !== 11) return v;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function applyCorrections(cardText, patches) {
  let t = cardText || "";
  for (const [label, valueRaw] of Object.entries(patches)) {
    let value = valueRaw;
    if (label === "CPF") value = normalizeCpfDigits(value);
    if (label === "Número de registro CNH") {
      const d = String(value).replace(/\D/g, "");
      if (d.length === 11 || d.length === 10) value = d;
    }
    if (
      label === "Data de nascimento" ||
      label === "Data da 1ª habilitação" ||
      label === "Data de emissão" ||
      label === "Validade"
    ) {
      const m = String(value).match(/(\d{1,2})[^\d](\d{1,2})[^\d](\d{2,4})/);
      if (m) {
        const dd = m[1].padStart(2, "0");
        const mm = m[2].padStart(2, "0");
        const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3].padStart(4, "0");
        value = `${dd}/${mm}/${yyyy}`;
      }
    }
    t = replaceCardLine(t, label, value);
  }
  return t;
}

const CARD_DB_MAP = {
  "NOME": "NOME",
  "DATA DE NASCIMENTO": "DATANASC",
  "LOCAL DE NASCIMENTO": "CIDADENASC",
  "NACIONALIDADE": "NACIONALIDADE",
  "PAI": "FIL_PAI",
  "MÃE": "FIL_MAE",
  "REGISTRO": "RG",
  "CPF": "CPF",
  "CATEGORIA HABILITAÇÃO": "CNH_CAT",
  "NÚMERO DE REGISTRO CNH": "CNH_REGISTRO",
  "DATA DA 1ª HABILITAÇÃO": "CNH_DATA1CNH",
  "DATA DE EMISSÃO": "CNH_DATAEMISSAO",
  "VALIDADE": "CNH_DATAVCTO",
  "UF": "UFEXPEDICAO",
  "LOCAL DE EMISSÃO": "CIDADEEXPEDICAO",
  "CÓDIGO": "ORGAOEMISSOR",
};

export function cardTextToPrecad(cardText) {
  const out = {};
  const lines = String(cardText || "").split(/\n+/);
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim().toUpperCase();
    const val = m[2].trim();
    const key = CARD_DB_MAP[label];
    if (key) out[key] = val;
  }
  return out;
}

const VEHICLE_DB_MAP = {
  PLACA: "PLACA",
  RENAVAM: "RENAVAN",
  "ANO EXERCICIO": "ANOEXERCICIO",
  "ANO MODELO": "ANOMODELO",
  "ANO FABRICACAO": "ANOFABRICACAO",
  CATEGORIA: "CATEGORIA",
  CAPACIDADE: "CAPACIDADE",
  POTENCIA: "POTENCIA",
  "PESO BRUTO": "PESOBRUTO",
  MOTOR: "MOTOR",
  CMT: "CMT",
  EIXOS: "EIXOS",
  LOTACAO: "LOTACAO",
  CARROCERIA: "CARROCERIA",
  NOME: "NOME",
  "CPF/CNPJ": "CPFCNPJ",
  LOCAL: "LOCAL",
  DATA: "DATA",
  "CODIGO CLA": "CODIGOCLA",
  CAT: "CAT",
  "MARCA/MODELO": "MARCA_MODELO",
  "ESPÉCIE/TIPO": "ESPECIE_TIPO",
  "PLACA ANTERIOR": "PLACAANTERIOR",
  CHASSI: "CHASSI",
  COR: "COR",
  COMBUSTIVEL: "COMBUSTIVEL",
  OBS: "OBS",
};

export function cardTextToVehicle(cardText) {
  const out = {};
  const lines = String(cardText || "").split(/\n+/);
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim().toUpperCase();
    const val = m[2].trim();
    const key = VEHICLE_DB_MAP[label];
    if (key) out[key] = val;
  }
  return out;
}
