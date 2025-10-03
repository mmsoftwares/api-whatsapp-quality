// twilio/src/routes/whatsapp/index.js
import express from "express";
import PQueue from "p-queue";
import logger from "../../utils/logger.js";
import { validateTwilioSignature } from "../../services/twilioClient.js";
import { replyText } from "../../services/responder.js";
import { wasProcessed, markProcessed } from "../../services/idempotencyStore.js";

import handleIncoming from "./handler.js";
import { normalizeCmd, isCmd } from "./commands.js";
import { clearState, getState, setState, STATES } from "./state.js";

// menu dinâmico
import { getMenuTextFromDB, getMenuTextSafeStatic } from "./menuService.js";

const router = express.Router();
const queue = new PQueue({ concurrency: Number(process.env.CONCURRENCY || 4) });

async function safeReply({ to, from, body }) {
  const candidate = (body ?? "").toString().trim();
  if (!candidate) {
    const fb = getMenuTextSafeStatic();
    logger.warn("[safeReply] body vazio — enviando fallback de menu");
    return replyText({ to, from, body: fb });
  }
  const res = await replyText({ to, from, body: candidate });
  if (res && res.skipped === "empty_body") {
    const fb = getMenuTextSafeStatic();
    logger.warn("[safeReply] replyText pulou envio (empty_body) — enviando fallback");
    return replyText({ to, from, body: fb });
  }
  return res;
}

router.post(
  "/whatsapp",
  express.urlencoded({ extended: false }),
  validateTwilioSignature,
  async (req, res) => {
    // ✅ ACK sem corpo para não gerar "OK" no WhatsApp
    res.sendStatus(204); // (pode usar res.status(200).end() se preferir)

    const payload = req.body || {};
    const from = payload?.From;
    const toBiz = payload?.To || payload?.to;
    const rawBody = (payload?.Body || "").trim();
    const bodyNorm = normalizeCmd(rawBody);
    const numMedia = parseInt(payload?.NumMedia || "0", 10);

    if (payload.MessageSid && wasProcessed(payload.MessageSid)) {
      logger.warn({ messageSid: payload.MessageSid }, "🔁 Mensagem duplicada ignorada (fast)");
      return;
    }

    // FAST-PATH: MENU / SAIR / CANCELAR
    if (isCmd(bodyNorm, "MENU", "SAIR", "CANCELAR")) {
      try {
        if (isCmd(bodyNorm, "MENU")) {
          clearState(from);
          const text = await getMenuTextFromDB(payload);
          await safeReply({ to: from, from: toBiz, body: text });
        } else {
          clearState(from);
          const text = await getMenuTextFromDB(payload);
          await safeReply({
            to: from,
            from: toBiz,
            body: `🚫 Operação cancelada. Digite *MENU* para opções.\n\n${text}`,
          });
        }

        if (payload.MessageSid) markProcessed(payload.MessageSid);
      } catch (err) {
        logger.error({ err: err?.message || err, payload }, "Falha fast-path comando");
      }
      return;
    }

    // Demais mensagens: fila com prioridade
    const prio =
      numMedia > 0 ? 10 :
      (rawBody && /^\d+$/.test(rawBody)) ? 50 :
      20;

    queue
      .add(async () => {
        try {
          await handleIncoming(payload);
          if (payload.MessageSid) markProcessed(payload.MessageSid);
        } catch (err) {
          logger.error({ err: err?.message || err, payload }, "Erro na fila de processamento");
        }
      }, { priority: prio })
      .catch((err) => {
        logger.error({ err: err?.message || err, payload }, "Erro ao enfileirar processamento");
      });
  }
);

export default router;
