// src/routes/whatsapp/handler.js
import logger from "../../utils/logger.js";
import { replyText } from "../../services/responder.js";
import { downloadTwilioMedia } from "../../services/media.js";
import {
  sendFileToExtractor,
  sendIdDataToExtractor,
  sendVehicleDataToExtractor,
} from "../../services/extractorClient.js";
import { wasProcessed, markProcessed } from "../../services/idempotencyStore.js";
import { getEntrega } from "../../services/ordersClient.js";
import { getCte } from "../../services/cteClient.js";
import {
  getNomovtraByChave,
  getMotoristaCpf,
  inserirOcorrencia,
} from "../../services/ocoService.js";
import { verificarMotoristaPorTelefone } from "../../services/authService.js";

import {
  setState,
  getState,
  updateState,
  clearState,
  STATES,
} from "./state.js";
import { normalizeCmd, isCmd } from "./commands.js";
import {
  formatEntrega,
  pickOrganizedText,
  safeStringify,
  correctionHelp,
  vehicleCorrectionHelp,
  formatIdPreviewCard,
  formatVehiclePreviewCard,
  parseCorrections,
  parseVehicleCorrections,
  applyCorrections,
  cardTextToPrecad,
  cardTextToVehicle,
} from "./formatters.js";
import { ensureSupportedMedia } from "./media.js";

// === menu dinâmico (lê MENUS / MENU_OPCOES no banco do cliente)
import { getClientByNumber, getTenantPool, loadMenu } from "../../services/db.js";

const MODEL_LABEL = { "55": "NF-e", "57": "CT-e", "58": "MDF-e", "65": "NFC-e", "67": "CT-e OS" };

/* ------------------------------------------------------------------
   Anti-“OK”: wrapper centralizado para TODO envio de texto
-------------------------------------------------------------------*/
function sanitizeMessage(m) {
  if (typeof m === "boolean") {
    return m ? "✅ Operação concluída." : "❌ Operação não concluída.";
  }
  let txt = String(m ?? "").trim();
  if (txt.toUpperCase() === "OK") {
    // impede o “OK” curtinho
    txt = "✅ Pronto! Envie as informações solicitadas.";
  }
  return txt;
}
async function send(to, message) {
  const body = sanitizeMessage(message);
  if (!body) return; // não envia vazio
  await replyText({ to, body });
}

/* ------------------------------------------------------------------ */
/* --------------------------- Helpers --------------------------------*/
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
async function getMenuTextFromDB(payload) {
  const toBiz = payload?.To || payload?.to;
  try {
    if (!toBiz) return buildMenuFallback();

    const client = await getClientByNumber(toBiz);   // pega o cliente pelo número Twilio (master)
    if (!client) return buildMenuFallback();

    const pool = getTenantPool(client);
    const menu = await loadMenu(client.id, pool);    // lê MENUS + MENU_OPCOES no tenant
    if (!menu) return buildMenuFallback();

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
    const txt = linhas.join("\n").trim();
    return txt || buildMenuFallback();
  } catch (e) {
    logger.error({ err: e?.message || e }, "[getMenuTextFromDB] falha ao montar menu");
    return buildMenuFallback();
  }
}

/* ------------------------------------------------------------------ */
/* ------------------------- Handler principal ------------------------*/
export default async function handleIncoming(payload) {
  const from = payload.From;
  const toBiz = payload.To || payload.to;
  const rawBody = (payload.Body || "").trim();
  const body = normalizeCmd(rawBody);
  const numMedia = parseInt(payload.NumMedia || "0", 10);
  const messageSid = payload.MessageSid;

  if (!from) return;
  if (messageSid && wasProcessed(messageSid)) {
    logger.warn({ messageSid }, "🔁 Mensagem duplicada ignorada");
    return;
  }

  try {
    const session = getState(from) ?? {};
    const cpf = session.cpf ?? null;
    let sessionState = session.state ?? STATES.IDLE;
    const client = toBiz ? await getClientByNumber(toBiz) : null;
    let pool = null;
    if (client) {
      try {
        pool = getTenantPool(client);
      } catch (e) {
        logger.error({ err: e?.message || e, toBiz }, "Configuração do tenant inválida");
      }
    }

    // Autorização e identificação via telefone
    if (!session.autorizado) {
      const cpfTel = await verificarMotoristaPorTelefone(from, toBiz);
      if (!cpfTel) {
        await send(from, buildMenuFallback());
        if (messageSid) markProcessed(messageSid);
        return;
      }
      updateState(from, { autorizado: true, cpf: cpfTel, state: STATES.IDLE });
      await send(from, await getMenuTextFromDB(payload));
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Menu 1..5
    if (rawBody === "1") {
      setState(from, STATES.AWAIT_ENTREGA);
      await send(from, "🧾 Informe o *número da entrega* (apenas números).");
      if (messageSid) markProcessed(messageSid);
      return;
    }
    if (rawBody === "2") {
      setState(from, STATES.AWAIT_OCO);
      await send(from, "🧾 Informe o número do pedido, ou envie o CTE");
      if (messageSid) markProcessed(messageSid);
      return;
    }
    if (rawBody === "3") {
      setState(from, STATES.AWAIT_CTE_MEDIA);
      await send(from, "📄 *Consulta de CT-e*\nEnvie a *imagem* ou *PDF* do CT-e, ou cole a *chave de 44 dígitos* do CT-e.\nPara sair, digite *CANCELAR*.");
      if (messageSid) markProcessed(messageSid);
      return;
    }
    if (rawBody === "4") {
      setState(from, STATES.AWAIT_ID_MEDIA, { idText: "", idPaths: [] });
      await send(from, "🪪 *Cadastro de motorista*\nEnvie a foto da *frente* e/ou *verso* da identidade/CNH. Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.");
      if (messageSid) markProcessed(messageSid);
      return;
    }
    if (rawBody === "5") {
      setState(from, STATES.AWAIT_VEHICLE_MEDIA, { vehicleText: "", vehiclePaths: [] });
      await send(from, "🚚 *Cadastro de veículo*\nEnvie a foto ou PDF do documento do veículo. Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.");
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // === AWAIT_ENTREGA ===
    if (sessionState === STATES.AWAIT_ENTREGA) {
      const numeroEntrega = rawBody.replace(/\D/g, "");
      if (!numeroEntrega) {
        await send(from, "❗ Envie apenas o *número da entrega* (ex.: 12345).");
        if (messageSid) markProcessed(messageSid);
        return;
      }
      try {
        if (!client) {
          await send(from, "❌ Cliente não configurado para este número.");
          clearState(from);
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const resp = await getEntrega(numeroEntrega, cpf, toBiz);
        const txt = formatEntrega(resp?.entrega);
        await send(from, txt);
      } catch (e) {
        logger.error({ e }, "Falha na consulta de entrega");
        const detalhe = e?.response?.data?.detail || e?.message;
        await send(from, detalhe || "❌ Não encontrei essa entrega ou houve um erro ao consultar.");
      } finally {
        clearState(from);
      }
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // === AWAIT_OCO ===
    if (sessionState === STATES.AWAIT_OCO) {
      if (!pool) {
        await send(from, "❌ Configuração de banco ausente.");
        clearState(from);
        if (messageSid) markProcessed(messageSid);
        return;
      }
      let nomovtra = null;
      const chave = extractAccessKey(rawBody);

      if (chave) {
        if (!validateAccessKey(chave)) {
          await send(from, "❌ Chave inválida. Verifique os dígitos e tente novamente.");
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const parsed = parseAccessKey(chave);
        if (parsed && parsed.mod !== "57") {
          await send(from, "❗ A chave informada não é de CT-e.");
          if (messageSid) markProcessed(messageSid);
          return;
        }
        try {
          nomovtra = await getNomovtraByChave(chave, pool);
        } catch (e) {
          logger.error({ err: e?.message || e }, "Falha ao buscar pedido por chave CT-e");
        }
        if (!nomovtra) {
          await send(from, "❌ CT-e não encontrado ou sem pedido vinculado.");
          if (messageSid) markProcessed(messageSid);
          return;
        }
      } else {
        nomovtra = rawBody.replace(/\D/g, "");
      }

      if (!nomovtra) {
        await send(from, "❗ Informe o *número do pedido* ou a *chave do CT-e*.");
        if (messageSid) markProcessed(messageSid);
        return;
      }

      try {
        const cpfPedido = await getMotoristaCpf(nomovtra, pool);
        const cpfDigits = String(cpf || "").replace(/\D/g, "");
        const cpfPedidoDigits = String(cpfPedido || "").replace(/\D/g, "");
        if (!cpfPedido) {
          await send(from, "❌ Pedido não encontrado.");
          clearState(from);
        } else if (cpfDigits !== cpfPedidoDigits) {
          await send(from, "❌ Você não está autorizado a registrar ocorrência para este pedido.");
          clearState(from);
        } else {
          updateState(from, { state: STATES.AWAIT_OCO_MOTIVO, nomovtra });
          await send(from, "📝 Qual o motivo da ocorrência?");
        }
      } catch (e) {
        logger.error({ err: e?.message || e }, "Falha ao validar pedido");
        await send(from, "❌ Erro ao validar pedido. Tente novamente mais tarde.");
        clearState(from);
      }
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // === AWAIT_OCO_MOTIVO ===
    if (sessionState === STATES.AWAIT_OCO_MOTIVO) {
      if (!pool) {
        await send(from, "❌ Configuração de banco ausente.");
        clearState(from);
        if (messageSid) markProcessed(messageSid);
        return;
      }
      const { nomovtra } = getState(from);
      const obs = rawBody.trim();
      if (!obs) {
        await send(from, "❗ Informe o motivo da ocorrência.");
        if (messageSid) markProcessed(messageSid);
        return;
      }
      try {
        await inserirOcorrencia(nomovtra, obs, cpf, pool);
        await send(from, "✅ Ocorrência registrada com sucesso.");
      } catch (e) {
        logger.error({ err: e?.message || e }, "Falha ao inserir ocorrência");
        await send(from, "❌ Erro ao registrar ocorrência. Tente novamente mais tarde.");
      }
      clearState(from);
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // === AWAIT_ID_MEDIA ===
    if (sessionState === STATES.AWAIT_ID_MEDIA) {
      if (isCmd(body, "CAMPOS")) {
        await send(from, correctionHelp());
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (/^CORRIGIR(\s|:)/i.test(rawBody)) {
        const cur = getState(from);
        const currentText = cur.idText || "";
        if (!currentText) {
          await send(from, "❗ Ainda não há cartão para corrigir. Envie a foto da CNH primeiro.");
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patches = parseCorrections(rawBody);
        if (!patches || Object.keys(patches).length === 0) {
          await send(from, correctionHelp());
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patched = applyCorrections(currentText, patches);
        updateState(from, { idText: patched });
        await send(from, "✅ Correções aplicadas.\n\n" + formatIdPreviewCard(patched));
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (isCmd(body, "CONFIRMAR")) {
        const { idText, idPaths } = getState(from);
        if (!idText) {
          await send(from, "❗ Ainda não recebi nenhuma imagem. Envie a foto da identidade/CNH primeiro.");
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const dados = cardTextToPrecad(idText);
        try {
          await sendIdDataToExtractor(dados, idPaths?.[0]);
          await send(from, `✅ Cadastro concluído com sucesso.\n\n${await getMenuTextFromDB(payload)}`);
        } catch (e) {
          logger.error({ err: e?.message || e }, "Falha ao salvar pré-cadastro");
          const detalhe = e?.response?.data?.detail || e?.message;
          if (detalhe && !/erro interno|internal server/i.test(detalhe)) {
            await send(from, `⚠️ ${detalhe}`);
          } else {
            await send(from, "⚠️ Erro interno ao salvar cadastro. Tente novamente ou fale com o suporte.");
          }
        }
        clearState(from);
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (numMedia > 0) {
        const cur = getState(from);
        let accText = cur.idText || "";
        let paths = Array.isArray(cur.idPaths) ? cur.idPaths.slice() : [];

        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = payload[`MediaUrl${i}`];
          const contentType = payload[`MediaContentType${i}`];
          try {
            await ensureSupportedMedia(from, contentType, "identidade/CNH");
            const { path, filename } = await downloadTwilioMedia(mediaUrl);
            const data = await sendFileToExtractor(path, contentType, filename, "pessoa");
            logger.info({ from, filename, preview: safeStringify(data).slice(0, 400) }, "🧾 Preview data do extrator");
            const txt = pickOrganizedText(data?.dados) || pickOrganizedText(data);
            if (txt) accText = accText ? `${accText}\n────────\n${txt}` : txt;
            if (data?.temp_path) paths.push(data.temp_path);
          } catch (e) {
            logger.error({ err: e?.message || e, mediaIndex: i, mediaUrl, contentType }, "Erro ao processar mídia de identidade");
            await send(from, "⚠️ Não consegui processar este arquivo. Verifique nitidez/iluminação ou envie em PDF.");
            continue;
          }
        }

        updateState(from, { idText: accText, idPaths: paths });

        if (!accText) {
          await send(
            from,
            "⚠️ Não consegui extrair os dados. Tente novamente com foto *de frente, bem enquadrada*, em boa iluminação. Se preferir, envie em *PDF*."
          );
        } else {
          await send(from, formatIdPreviewCard(accText));
        }

        if (messageSid) markProcessed(messageSid);
        return;
      }

      await send(from, "📸 Envie a foto (frente/verso) da identidade/CNH. Quando terminar, digite *CONFIRMAR*.");
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // === AWAIT_VEHICLE_MEDIA ===
    if (sessionState === STATES.AWAIT_VEHICLE_MEDIA) {
      if (isCmd(body, "CAMPOS")) {
        await send(from, vehicleCorrectionHelp());
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (/^CORRIGIR(\s|:)/i.test(rawBody)) {
        const cur = getState(from);
        const currentText = cur.vehicleText || "";
        if (!currentText) {
          await send(from, "❗ Ainda não há cartão para corrigir. Envie o documento do veículo primeiro.");
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patches = parseVehicleCorrections(rawBody);
        if (!patches || Object.keys(patches).length === 0) {
          await send(from, vehicleCorrectionHelp());
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patched = applyCorrections(currentText, patches);
        updateState(from, { vehicleText: patched });
        await send(from, "✅ Correções aplicadas.\n\n" + formatVehiclePreviewCard(patched));
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (isCmd(body, "CONFIRMAR")) {
        const { vehicleText, vehiclePaths } = getState(from);
        if (!vehicleText) {
          await send(from, "❗ Ainda não recebi nenhuma imagem. Envie o documento do veículo primeiro.");
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const dados = cardTextToVehicle(vehicleText);
        try {
          await sendVehicleDataToExtractor(dados, vehiclePaths?.[0]);
          await send(from, `✅ Cadastro concluído com sucesso.\n\n${await getMenuTextFromDB(payload)}`);
        } catch (e) {
          logger.error({ err: e?.message || e }, "Falha ao salvar cadastro de veículo");
          const detalhe = e?.response?.data?.detail || e?.message;
          await send(from, (detalhe && !/erro interno|internal server/i.test(detalhe)) ? `⚠️ ${detalhe}` : "⚠️ Erro interno ao salvar cadastro de veículo. Tente novamente ou fale com o suporte.");
        }
        clearState(from);
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (numMedia > 0) {
        const cur = getState(from);
        let accText = cur.vehicleText || "";
        let paths = Array.isArray(cur.vehiclePaths) ? cur.vehiclePaths.slice() : [];

        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = payload[`MediaUrl${i}`];
          const contentType = payload[`MediaContentType${i}`];
          try {
            await ensureSupportedMedia(from, contentType, "documento do veículo");
            const { path, filename } = await downloadTwilioMedia(mediaUrl);
            const data = await sendFileToExtractor(path, contentType, filename, "veiculo");
            logger.info({ from, filename, preview: safeStringify(data).slice(0, 400) }, "🧾 Preview data do extrator");
            const txt = pickOrganizedText(data?.dados) || pickOrganizedText(data);
            if (txt) accText = accText ? `${accText}\n────────\n${txt}` : txt;
            if (data?.temp_path) paths.push(data.temp_path);
          } catch (e) {
            logger.error({ err: e?.message || e, mediaIndex: i, mediaUrl, contentType }, "Erro ao processar mídia de veículo");
            await send(from, "⚠️ Não consegui processar este arquivo. Verifique nitidez/iluminação ou envie em PDF.");
            continue;
          }
        }

        updateState(from, { vehicleText: accText, vehiclePaths: paths });

        if (!accText) {
          await send(from, "⚠️ Não consegui extrair os dados. Tente novamente com imagem legível ou envie em PDF.");
        } else {
          await send(from, formatVehiclePreviewCard(accText));
        }

        if (messageSid) markProcessed(messageSid);
        return;
      }

      await send(from, "📄 Envie a foto ou PDF do documento do veículo. Quando terminar, digite *CONFIRMAR*.");
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // === AWAIT_CTE_MEDIA ===
    if (sessionState === STATES.AWAIT_CTE_MEDIA) {
      if (isCmd(body, "CANCELAR")) {
        clearState(from);
        await send(from, await getMenuTextFromDB(payload));
        if (messageSid) markProcessed(messageSid);
        return;
      }

      let chave = null;

      if (numMedia > 0) {
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = payload[`MediaUrl${i}`];
          const contentType = payload[`MediaContentType${i}`];
          try {
            await ensureSupportedMedia(from, contentType, "documento do CT-e");
            const { path, filename } = await downloadTwilioMedia(mediaUrl);
            const data = await sendFileToExtractor(path, contentType, filename, "cte");
            logger.info({ from, filename, preview: safeStringify(data).slice(0, 400) }, "🧾 Preview data do extrator");
            const txt = pickOrganizedText(data?.dados) || pickOrganizedText(data);
            const found = txt && extractAccessKey(txt);
            if (found) { chave = found; break; }
          } catch (e) {
            logger.error({ err: e?.message || e, mediaIndex: i, mediaUrl, contentType }, "Erro ao processar mídia de CT-e");
            await send(from, "⚠️ Não consegui processar este arquivo. Verifique o documento e tente novamente.");
          }
        }
      } else if (rawBody) {
        const found = extractAccessKey(rawBody);
        if (found) chave = found;
      }

      if (!chave) {
        await send(from, "⚠️ Não consegui extrair a *chave de 44 dígitos* do CT-e. Envie novamente (pode colar com espaços ou pontos).");
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (!validateAccessKey(chave)) {
        await send(from, "❌ Chave inválida (DV incorreto). Verifique os dígitos e envie novamente.");
        if (messageSid) markProcessed(messageSid);
        return;
      }

      const parsed = parseAccessKey(chave);
      if (parsed && parsed.mod !== "57") {
        const rotulo = MODEL_LABEL[parsed.mod] || "desconhecido";
        await send(from, `❗ Esta chave não é de CT-e. Dígitos 21–22 = *${parsed.mod}* (${rotulo}).`);
        if (messageSid) markProcessed(messageSid);
        return;
      }

      try {
        const { cte } = await getCte(chave, cpf);
        const msg =
          `📦 *CT-e Encontrado*\n\n` +
          `🆔 Status: ${cte.statuscte || "-"}\n` +
          `📅 Data de Emissão: ${cte.dataemi || "-"}\n` +
          `⚖️ Peso Total: ${cte.totalpeso || "-"} kg\n` +
          `🚚 Entrega (NOMOVTRA): ${cte.nomovtra || "-"}\n` +
          (cte.motivo ? `📝 Motivo: ${cte.motivo}` : "");
        await send(from, msg);
      } catch (e) {
        logger.error({ err: e?.message || e }, "Falha ao consultar CT-e");
        const detalhe = e?.response?.data?.detail || e?.message;
        await send(from, detalhe || "❌ Erro ao consultar CT-e. Tente novamente mais tarde.");
      } finally {
        clearState(from);
      }

      if (messageSid) markProcessed(messageSid);
      return;
    }

    // CANCELAR genérico
    if (rawBody === "CANCELAR") {
      clearState(from);
      await send(from, await getMenuTextFromDB(payload));
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Default: volta ao menu dinâmico
    await send(from, await getMenuTextFromDB(payload));
    if (messageSid) markProcessed(messageSid);
  } catch (err) {
    logger.error({ err }, "Erro inesperado no handleIncoming");
    await send(from, "❌ Erro interno. Tente novamente mais tarde.");
    if (messageSid) markProcessed(messageSid);
  }
}
