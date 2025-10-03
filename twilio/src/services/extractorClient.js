// services/extractorClient.js
import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import logger from "../utils/logger.js";
import { mapVehicleData } from "../utils/vehicleDataMapper.js"; // NOVO IMPORT


const EXTRACTOR_BASE_URL='http://127.0.0.1:8000';
const NODE_BASE_URL = `http://127.0.0.1:${process.env.PORT || 8081}`;
const EXTRACTOR_API_KEY=''
const EXTERNAL_HTTP_TIMEOUT_MS=800000;
if (!EXTRACTOR_BASE_URL) {
  throw new Error("EXTRACTOR_BASE_URL não definida");
}

// Confirmação NFe (mantém como estava)
export async function sendNFeKeyToExtractor({ chave_acesso, confirma, dados, temp_path }) {
  const url = `${EXTRACTOR_BASE_URL}/confirmar`;
  const headers = { "x-api-key": EXTRACTOR_API_KEY };
  const payload = { chave_acesso, confirma, dados, temp_path };

  const resp = await axios.post(url, payload, {
    headers,
    timeout: Number(EXTERNAL_HTTP_TIMEOUT_MS || 20000)
  });

  logger.info({ url }, "🔗 Confirmação enviada ao extrator");
  return resp.data;
}

/**
 * Envia ARQUIVO (PDF/Imagem) para o extrator Python e
 * **sempre** normaliza a saída para { status, dados:{kind:'text', text}, temp_path }.
 */
export async function sendFileToExtractor(
  filePath,
  contentType,
  filename,
  tipo = "pessoa"
) {
  const url = `${EXTRACTOR_BASE_URL}/upload?tipo=${encodeURIComponent(tipo)}`;

  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), { filename, contentType });

  const headers = {
    "x-api-key": EXTRACTOR_API_KEY,
    ...form.getHeaders()
  };

  const resp = await axios.post(url, form, {
    headers,
    maxBodyLength: Infinity,
    timeout: Number(EXTERNAL_HTTP_TIMEOUT_MS || 30000)
  });

  const raw = resp?.data;
  logger.info(
    { url, filename, preview: JSON.stringify(raw)?.slice(0, 400) },
    "🔗 Resposta do extrator (preview)"
  );

  // Normalização forte
  let text = "";
  if (raw?.dados?.kind === "text" && typeof raw?.dados?.text === "string") {
    text = raw.dados.text;
  } else if (typeof raw?.dados === "string") {
    text = raw.dados;
  } else if (typeof raw?.text === "string") {
    text = raw.text;
  } else if (raw && typeof raw === "object") {
    const candidate =
      raw?.dados?.text ||
      raw?.result?.text ||
      raw?.message ||
      raw?.output ||
      raw?.content;
    if (typeof candidate === "string") text = candidate;
  }

  if (typeof text !== "string") text = String(text ?? "");

  return {
    status: raw?.status || "processado",
    dados: { kind: "text", text },
    temp_path: raw?.temp_path || null,
    chave: raw?.chave || raw?.dados?.chave || null
  };
}

export async function sendIdDataToExtractor(dados, link, toBiz) {
  const url = `${NODE_BASE_URL}/precadastro`;
  const headers = { "x-api-key": EXTRACTOR_API_KEY };
  if (toBiz) headers["x-whatsapp-number"] = toBiz;
  const resp = await axios.post(url, { dados, link }, {
    headers,
    timeout: Number(EXTERNAL_HTTP_TIMEOUT_MS || 20000)
  });
  logger.info({ url }, "🔗 Pré-cadastro enviado ao extrator");
  return resp.data;
}

export async function sendVehicleDataToExtractor(dados, link, toBiz) {
  const url = `${NODE_BASE_URL}/cadastroveiculo`;
  const headers = { "x-api-key": EXTRACTOR_API_KEY };
  if (toBiz) headers["x-whatsapp-number"] = toBiz;

  // 🚀 Normaliza e mapeia os dados antes de enviar
  const normalized = mapVehicleData(dados);

  const resp = await axios.post(url, { dados: normalized, link }, {
    headers,
    timeout: Number(EXTERNAL_HTTP_TIMEOUT_MS || 20000)
  });
  logger.info({ url, dados: normalized }, "🔗 Cadastro de veículo enviado ao extrator");
  return resp.data;
}

export default {
  sendFileToExtractor,
  sendNFeKeyToExtractor,
  sendIdDataToExtractor,
  sendVehicleDataToExtractor
};

