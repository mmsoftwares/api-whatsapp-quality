import axios from "axios";

const {
  PY_SERVICE_URL = "http://127.0.0.1:8000",
  EXTERNAL_HTTP_TIMEOUT_MS = 20000
} = process.env;

/**
 * Consulta o serviço FastAPI de entregas informando o número do bot.
 * @param {string} numero Número da entrega.
 * @param {string} cpf CPF/CNPJ do motorista.
 * @param {string} whatsappNumber Número do WhatsApp do bot.
 */
export async function getEntrega(numero, cpf, whatsappNumber) {
  const url = `${PY_SERVICE_URL}/entregas/${encodeURIComponent(numero)}?cpf=${encodeURIComponent(
    cpf
  )}`;

  const headers = {};
  if (whatsappNumber) headers["x-whatsapp-number"] = whatsappNumber;

  const { data } = await axios.get(url, {
    timeout: Number(EXTERNAL_HTTP_TIMEOUT_MS),
    headers,
  });
  return data; // {status:"ok", entrega:{...}}
}
