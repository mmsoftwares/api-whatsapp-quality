// twilio/src/routes/whatsapp/handler.js
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
  menuText,
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

import {
  extractAccessKey,
  validateAccessKey,
  parseAccessKey,
} from "../../utils/fiscalKey.js";

const MODEL_LABEL = {
  "55": "NF-e",
  "57": "CT-e",
  "58": "MDF-e",
  "65": "NFC-e",
  "67": "CT-e OS",
};

// --------- Helpers locais ---------

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

function getMenuTextSafe() {
  try {
    const txt = (menuText?.() ?? "").toString().trim();
    if (txt) return txt;
    logger.warn("[getMenuTextSafe] menuText() vazio — usando fallback");
    return buildMenuFallback();
  } catch (e) {
    logger.error("[getMenuTextSafe] erro ao gerar menuText():", e?.message || e);
    return buildMenuFallback();
  }
}

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

    // Autorização e identificação via telefone
    if (!session.autorizado) {
      const cpfTel = await verificarMotoristaPorTelefone(from, toBiz);
      if (!cpfTel) {
        await replyText({ to: from, body: buildMenuFallback() });
        if (messageSid) markProcessed(messageSid);
        return;
      }
      updateState(from, { autorizado: true, cpf: cpfTel, state: STATES.IDLE });
      await replyText({ to: from, body: getMenuTextSafe() });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Opção 1: Detalhes da entrega
    if (rawBody === "1") {
      setState(from, STATES.AWAIT_ENTREGA);
      await replyText({ to: from, body: "🧾 Informe o *número da entrega* (apenas números)." });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Opção 2: Registrar ocorrência
    if (rawBody === "2") {
      setState(from, STATES.AWAIT_OCO);
      await replyText({ to: from, body: "🧾 Informe o número do pedido, ou envie o CTE" });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Opção 3: Enviar CT-e
    if (rawBody === "3") {
      setState(from, STATES.AWAIT_CTE_MEDIA);
      await replyText({
        to: from,
        body:
          "📄 *Consulta de CT-e*\n" +
          "Envie a *imagem* ou *PDF* do CT-e, ou cole a *chave de 44 dígitos* do CT-e.\n" +
          "Para sair, digite *CANCELAR*.",
      });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Opção 4: Doc. motorista
    if (rawBody === "4") {
      setState(from, STATES.AWAIT_ID_MEDIA, { idText: "", idPaths: [] });
      await replyText({
        to: from,
        body:
          "🪪 *Cadastro de motorista*\n" +
          "Envie a foto da *frente* e/ou *verso* da identidade/CNH (pode enviar em mensagens separadas). " +
          "Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.",
      });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Opção 5: Doc. veículo
    if (rawBody === "5") {
      setState(from, STATES.AWAIT_VEHICLE_MEDIA, { vehicleText: "", vehiclePaths: [] });
      await replyText({
        to: from,
        body:
          "🚚 *Cadastro de veículo*\n" +
          "Envie a foto ou PDF do documento do veículo. Pode enviar em mensagens separadas. " +
          "Quando terminar, digite *CONFIRMAR*. Para cancelar, *CANCELAR*.",
      });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // AWAIT_ENTREGA
    if (sessionState === STATES.AWAIT_ENTREGA) {
      const numeroEntrega = rawBody.replace(/\D/g, "");
      if (!numeroEntrega) {
        await replyText({ to: from, body: "❗ Envie apenas o *número da entrega* (ex.: 12345)." });
        if (messageSid) markProcessed(messageSid);
        return;
      }
      try {
        const resp = await getEntrega(numeroEntrega, cpf);
        const txt = formatEntrega(resp?.entrega);
        await replyText({ to: from, body: txt });
      } catch (e) {
        logger.error({ e }, "Falha na consulta de entrega");
        const detalhe = e?.response?.data?.detail || e?.message;
        await replyText({ to: from, body: detalhe || "❌ Não encontrei essa entrega ou houve um erro ao consultar." });
      } finally {
        clearState(from);
      }
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // AWAIT_OCO
    if (sessionState === STATES.AWAIT_OCO) {
      let nomovtra = null;
      const chave = extractAccessKey(rawBody);

      if (chave) {
        if (!validateAccessKey(chave)) {
          await replyText({ to: from, body: "❌ Chave inválida. Verifique os dígitos e tente novamente." });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const parsed = parseAccessKey(chave);
        if (parsed && parsed.mod !== "57") {
          await replyText({ to: from, body: "❗ A chave informada não é de CT-e." });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        try {
          nomovtra = await getNomovtraByChave(chave);
        } catch (e) {
          logger.error({ err: e?.message || e }, "Falha ao buscar pedido por chave CT-e");
        }
        if (!nomovtra) {
          await replyText({ to: from, body: "❌ CT-e não encontrado ou sem pedido vinculado." });
          if (messageSid) markProcessed(messageSid);
          return;
        }
      } else {
        nomovtra = rawBody.replace(/\D/g, "");
      }

      if (!nomovtra) {
        await replyText({ to: from, body: "❗ Informe o *número do pedido* ou a *chave do CT-e*." });
        if (messageSid) markProcessed(messageSid);
        return;
      }

      try {
        const cpfPedido = await getMotoristaCpf(nomovtra);
        const cpfDigits = String(cpf || "").replace(/\D/g, "");
        const cpfPedidoDigits = String(cpfPedido || "").replace(/\D/g, "");
        if (!cpfPedido) {
          await replyText({ to: from, body: "❌ Pedido não encontrado." });
          clearState(from);
        } else if (cpfDigits !== cpfPedidoDigits) {
          await replyText({ to: from, body: "❌ Você não está autorizado a registrar ocorrência para este pedido." });
          clearState(from);
        } else {
          updateState(from, { state: STATES.AWAIT_OCO_MOTIVO, nomovtra });
          await replyText({ to: from, body: "📝 Qual o motivo da ocorrência?" });
        }
      } catch (e) {
        logger.error({ err: e?.message || e }, "Falha ao validar pedido");
        await replyText({ to: from, body: "❌ Erro ao validar pedido. Tente novamente mais tarde." });
        clearState(from);
      }
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // AWAIT_OCO_MOTIVO
    if (sessionState === STATES.AWAIT_OCO_MOTIVO) {
      const { nomovtra } = getState(from);
      const obs = rawBody.trim();
      if (!obs) {
        await replyText({ to: from, body: "❗ Informe o motivo da ocorrência." });
        if (messageSid) markProcessed(messageSid);
        return;
      }
      try {
        await inserirOcorrencia(nomovtra, obs, cpf);
        await replyText({ to: from, body: "✅ Ocorrência registrada com sucesso." });
      } catch (e) {
        logger.error({ err: e?.message || e }, "Falha ao inserir ocorrência");
        await replyText({ to: from, body: "❌ Erro ao registrar ocorrência. Tente novamente mais tarde." });
      }
      clearState(from);
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // AWAIT_ID_MEDIA
    if (sessionState === STATES.AWAIT_ID_MEDIA) {
      if (isCmd(body, "CAMPOS")) {
        await replyText({ to: from, body: correctionHelp() });
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (/^CORRIGIR(\s|:)/i.test(rawBody)) {
        const cur = getState(from);
        const currentText = cur.idText || "";
        if (!currentText) {
          await replyText({ to: from, body: "❗ Ainda não há cartão para corrigir. Envie a foto da CNH primeiro." });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patches = parseCorrections(rawBody);
        if (!patches || Object.keys(patches).length === 0) {
          await replyText({ to: from, body: correctionHelp() });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patched = applyCorrections(currentText, patches);
        updateState(from, { idText: patched });
        await replyText({ to: from, body: "✅ Correções aplicadas.\n\n" + formatIdPreviewCard(patched) });
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (isCmd(body, "CONFIRMAR")) {
        const { idText, idPaths } = getState(from);
        if (!idText) {
          await replyText({ to: from, body: "❗ Ainda não recebi nenhuma imagem. Envie a foto da identidade/CNH primeiro." });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const dados = cardTextToPrecad(idText);
        try {
          await sendIdDataToExtractor(dados, idPaths?.[0]);
          await replyText({ to: from, body: `✅ Cadastro concluído com sucesso.\n\n${getMenuTextSafe()}` });
        } catch (e) {
          logger.error({ err: e?.message || e }, "Falha ao salvar pré-cadastro");
          const detalhe = e?.response?.data?.detail || e?.message;
          if (detalhe && !/erro interno|internal server/i.test(detalhe)) {
            await replyText({ to: from, body: `⚠️ ${detalhe}` });
          } else {
            await replyText({ to: from, body: "⚠️ Erro interno ao salvar cadastro. Tente novamente ou fale com o suporte." });
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
            await replyText({ to: from, body: "⚠️ Não consegui processar este arquivo. Verifique nitidez/iluminação ou envie em PDF." });
            continue;
          }
        }

        updateState(from, { idText: accText, idPaths: paths });

        if (!accText) {
          await replyText({
            to: from,
            body:
              "⚠️ Não consegui extrair os dados. Tente novamente com foto *de frente, bem enquadrada*, em boa iluminação, sem recortes. Se preferir, envie em *PDF*.",
          });
        } else {
          await replyText({ to: from, body: formatIdPreviewCard(accText) });
        }

        if (messageSid) markProcessed(messageSid);
        return;
      }

      await replyText({ to: from, body: "📸 Envie a foto (frente/verso) da identidade/CNH. Quando terminar, digite *CONFIRMAR*." });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // AWAIT_VEHICLE_MEDIA
    if (sessionState === STATES.AWAIT_VEHICLE_MEDIA) {
      if (isCmd(body, "CAMPOS")) {
        await replyText({ to: from, body: vehicleCorrectionHelp() });
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (/^CORRIGIR(\s|:)/i.test(rawBody)) {
        const cur = getState(from);
        const currentText = cur.vehicleText || "";
        if (!currentText) {
          await replyText({ to: from, body: "❗ Ainda não há cartão para corrigir. Envie o documento do veículo primeiro." });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patches = parseVehicleCorrections(rawBody);
        if (!patches || Object.keys(patches).length === 0) {
          await replyText({ to: from, body: vehicleCorrectionHelp() });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const patched = applyCorrections(currentText, patches);
        updateState(from, { vehicleText: patched });
        await replyText({ to: from, body: "✅ Correções aplicadas.\n\n" + formatVehiclePreviewCard(patched) });
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (isCmd(body, "CONFIRMAR")) {
        const { vehicleText, vehiclePaths } = getState(from);
        if (!vehicleText) {
          await replyText({ to: from, body: "❗ Ainda não recebi nenhuma imagem. Envie o documento do veículo primeiro." });
          if (messageSid) markProcessed(messageSid);
          return;
        }
        const dados = cardTextToVehicle(vehicleText);
        try {
          await sendVehicleDataToExtractor(dados, vehiclePaths?.[0]);
          await replyText({ to: from, body: `✅ Cadastro concluído com sucesso.\n\n${getMenuTextSafe()}` });
        } catch (e) {
          logger.error({ err: e?.message || e }, "Falha ao salvar cadastro de veículo");
          const detalhe = e?.response?.data?.detail || e?.message;
          if (detalhe && !/erro interno|internal server/i.test(detalhe)) {
            await replyText({ to: from, body: `⚠️ ${detalhe}` });
          } else {
            await replyText({ to: from, body: "⚠️ Erro interno ao salvar cadastro de veículo. Tente novamente ou fale com o suporte." });
          }
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
            await replyText({ to: from, body: "⚠️ Não consegui processar este arquivo. Verifique nitidez/iluminação ou envie em PDF." });
            continue;
          }
        }

        updateState(from, { vehicleText: accText, vehiclePaths: paths });

        if (!accText) {
          await replyText({ to: from, body: "⚠️ Não consegui extrair os dados. Tente novamente com imagem legível ou envie em PDF." });
        } else {
          await replyText({ to: from, body: formatVehiclePreviewCard(accText) });
        }

        if (messageSid) markProcessed(messageSid);
        return;
      }

      await replyText({ to: from, body: "📄 Envie a foto ou PDF do documento do veículo. Quando terminar, digite *CONFIRMAR*." });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // AWAIT_CTE_MEDIA
    if (sessionState === STATES.AWAIT_CTE_MEDIA) {
      if (isCmd(body, "CANCELAR")) {
        clearState(from);
        await replyText({ to: from, body: getMenuTextSafe() });
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
            if (found) {
              chave = found;
              break;
            }
          } catch (e) {
            logger.error({ err: e?.message || e, mediaIndex: i, mediaUrl, contentType }, "Erro ao processar mídia de CT-e");
            await replyText({ to: from, body: "⚠️ Não consegui processar este arquivo. Verifique o documento e tente novamente." });
          }
        }
      } else if (rawBody) {
        const found = extractAccessKey(rawBody);
        if (found) chave = found;
      }

      if (!chave) {
        await replyText({ to: from, body: "⚠️ Não consegui extrair a *chave de 44 dígitos* do CT-e. Envie novamente (pode colar com espaços ou pontos)." });
        if (messageSid) markProcessed(messageSid);
        return;
      }

      if (!validateAccessKey(chave)) {
        await replyText({ to: from, body: "❌ Chave inválida (DV incorreto). Verifique os dígitos e envie novamente." });
        if (messageSid) markProcessed(messageSid);
        return;
      }

      const parsed = parseAccessKey(chave);
      if (parsed && parsed.mod !== "57") {
        const rotulo = MODEL_LABEL[parsed.mod] || "desconhecido";
        await replyText({
          to: from,
          body: `❗ Esta chave não é de CT-e. Dígitos 21–22 = *${parsed.mod}* (${rotulo}).`,
        });
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

        await replyText({ to: from, body: msg });
      } catch (e) {
        logger.error({ err: e?.message || e }, "Falha ao consultar CT-e");
        const detalhe = e?.response?.data?.detail || e?.message;
        await replyText({ to: from, body: detalhe || "❌ Erro ao consultar CT-e. Tente novamente mais tarde." });
      } finally {
        clearState(from);
      }

      if (messageSid) markProcessed(messageSid);
      return;
    }

    // CANCELAR genérico
    if (rawBody === "CANCELAR") {
      clearState(from);
      await replyText({ to: from, body: getMenuTextSafe() });
      if (messageSid) markProcessed(messageSid);
      return;
    }

    // Default: mostra menu
    await replyText({ to: from, body: getMenuTextSafe() });
    if (messageSid) markProcessed(messageSid);
  } catch (err) {
    logger.error({ err }, "Erro inesperado no handleIncoming");
    await replyText({ to: from, body: "❌ Erro interno. Tente novamente mais tarde." });
    if (messageSid) markProcessed(messageSid);
  }
}