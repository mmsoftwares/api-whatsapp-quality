import axios from "axios";

const {
  PY_SERVICE_URL = "http://127.0.0.1:8000",
  EXTERNAL_HTTP_TIMEOUT_MS = 20000
} = process.env;

/** Consulta CT-e no FastAPI: GET /cte/{chave}?cpf=... */
export async function getCte(chave, cpf) {
  const url = `${PY_SERVICE_URL}/cte/${encodeURIComponent(chave)}?cpf=${encodeURIComponent(
    cpf
  )}`;
  const { data } = await axios.get(url, { timeout: Number(EXTERNAL_HTTP_TIMEOUT_MS) });
  return data; // {status:"ok", cte:{...}}
}

export default { getCte };
