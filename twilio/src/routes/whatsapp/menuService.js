// twilio/src/routes/whatsapp/menuService.js
import logger from "../../utils/logger.js";
import { menuText } from "./formatters.js";
import { getClientByNumber, getTenantPool, loadMenu } from "../../services/db.js";

/** Fallback estático caso DB falhe/vazio */
function buildMenuFallback() {
  return [
    "📋 Escolha uma opção digitando o número:",
    "1 Detalhes da entrega",
    "2 Registrar ocorrência",
    "3 Enviar CT-e",
    "4 Enviar doc. motorista",
    "5 Enviar doc. veículo",
  ].join("\n");
}

/** Usa menuText() se disponível; senão, fallback */
export function getMenuTextSafeStatic() {
  try {
    const txt = (menuText?.() ?? "").toString().trim();
    if (txt) return txt;
    logger.warn("[getMenuTextSafeStatic] menuText() vazio — usando fallback");
    return buildMenuFallback();
  } catch (e) {
    logger.error("[getMenuTextSafeStatic] erro ao gerar menuText():", e?.message || e);
    return buildMenuFallback();
  }
}

/**
 * Monta o menu a partir do banco (cliente é resolvido pelo número Twilio que RECEBEU a mensagem)
 * @param {object} payload - req.body da Twilio (precisa de .To)
 * @returns {Promise<string>} texto do menu
 */
export async function getMenuTextFromDB(payload) {
  const toBiz = payload?.To || payload?.to; // "whatsapp:+1..."
  try {
    if (!toBiz) {
      logger.warn("[getMenuTextFromDB] 'To' ausente no payload — usando menu estático");
      return getMenuTextSafeStatic();
    }

    const client = await getClientByNumber(toBiz);
    if (!client) {
      logger.warn({ toBiz }, "[getMenuTextFromDB] Cliente não encontrado pelo número Twilio — usando menu estático");
      return getMenuTextSafeStatic();
    }

    const pool = getTenantPool(client);
    const clienteId = client.id;

    const menu = await loadMenu(clienteId, pool); // { id, titulo, options: [{CHAVE,TEXTO,PROXIMA_CHAVE}] }
    if (!menu) {
      logger.warn({ clienteId }, "[getMenuTextFromDB] Nenhum MENUS ativo — usando menu estático");
      return getMenuTextSafeStatic();
    }

    const linhas = [];

    function decodeStr(str) {
      try {
        return Buffer.from(String(str || ""), "binary").toString("utf8");
      } catch {
        return String(str || "");
      }
    }

    if (menu?.titulo) linhas.push(decodeStr(menu.titulo).trim());
    if (Array.isArray(menu.options)) {
      for (const o of menu.options) {
        const k = o?.CHAVE ?? o?.chave ?? o?.opcao;
        let t = o?.TEXTO ?? o?.texto;
        t = decodeStr(t);
        if (/MENU_OPCAO/i.test(t)) {
          const partes = t.split(/MENU_OPCAO\s*/i).filter(Boolean);
          for (const parte of partes) linhas.push(parte.trim());
        } else if (k && t) {
          linhas.push(`${k} ${t}`.trim());
        }
      }
    }
    const texto = linhas.join("\n").trim();
    return texto || getMenuTextSafeStatic();
  } catch (e) {
    logger.error({ err: e?.message || e }, "[getMenuTextFromDB] Falha ao montar menu do banco — usando menu estático");
    return getMenuTextSafeStatic();
  }
}
