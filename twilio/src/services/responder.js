// src/services/responder.js (ESM)
import logger from "../utils/logger.js";
import { client as twilioClient } from "./twilioClient.js";

const DEFAULT_FROM = (process.env.TWILIO_WHATSAPP_FROM || "").trim(); // ex: whatsapp:+1...

/* ----------------------- Helpers ----------------------- */
function normalizeWa(addr) {
  if (!addr) return "";
  const s = String(addr).trim();
  return s.startsWith("whatsapp:") ? s : `whatsapp:${s.replace(/^whatsapp:/, "")}`;
}
function nonEmpty(s) {
  return typeof s === "string" && s.trim().length > 0;
}

/** Converte body para texto seguro:
 * - boolean => mensagem clara
 * - "ok"/"OK"/"Ok." => frase útil (nunca envia apenas "OK")
 * - trim/colapsa espaços
 */
function sanitizeBody(body) {
  if (typeof body === "boolean") {
    return body ? "✅ Operação concluída." : "❌ Operação não concluída.";
  }
  // mantém quebras de linha, normalizando apenas espaços e tabs em cada linha
  let txt = String(body ?? "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
  if (txt.length > 0 && /^ok[.!]*$/i.test(txt)) {
    txt = "✅ Pronto! Envie as informações solicitadas.";
  }
  return txt;
}

/* --------------------- Split seguro --------------------- */
function splitMessage(text, maxLen = 1500) {
  if (!text || text.length <= maxLen) return [text];
  const parts = [];
  let chunk = "";
  for (const line of text.split("\n")) {
    if ((chunk + "\n" + line).length > maxLen) {
      parts.push(chunk.trim());
      chunk = line;
    } else {
      chunk += (chunk ? "\n" : "") + line;
    }
  }
  if (chunk) parts.push(chunk.trim());
  return parts;
}

/* --------------------- Envio de mensagem --------------------- */
/**
 * Envia texto/mídia via WhatsApp. Nunca dispara Twilio com body vazio se não houver media.
 * @param {object} p
 * @param {string} p.to            número destino (whatsapp:+5511..., ou só +5511...)
 * @param {string} [p.from]        remetente Twilio (whatsapp:+1..., default TWILIO_WHATSAPP_FROM)
 * @param {string|boolean} [p.body] texto (aceita boolean; será sanitizado)
 * @param {string|string[]} [p.mediaUrl] url(s) de mídia
 */
export async function replyText({ to, from, body, mediaUrl } = {}) {
  const toAddr = normalizeWa(to);
  const fromAddr = normalizeWa(from || DEFAULT_FROM);
  const txt = sanitizeBody(body);

  if (!fromAddr || !fromAddr.startsWith("whatsapp:+")) {
    logger.error("[replyText] Remetente inválido/ausente. Configure TWILIO_WHATSAPP_FROM.");
    return { skipped: "missing_from" };
  }
  if (!toAddr || !toAddr.startsWith("whatsapp:+")) {
    logger.error("[replyText] Destino inválido:", to);
    return { skipped: "invalid_to" };
  }

  const hasMedia = Array.isArray(mediaUrl) ? mediaUrl.length > 0 : nonEmpty(mediaUrl);
  if (!hasMedia && !nonEmpty(txt)) {
    // Evita erro 21619 (mensagem vazia)
    logger.warn("[replyText] Mensagem vazia sem media — envio pulado.", { to: toAddr });
    return { skipped: "empty_body" };
  }

  const messages = nonEmpty(txt) ? splitMessage(txt) : [""];
  const results = [];

  for (const [idx, part] of messages.entries()) {
  const hasBody = nonEmpty(part);
  const attachMedia = hasMedia && idx === 0;

  if (!hasBody && !attachMedia) {
    logger.warn("[replyText] Pulando envio vazio", { to: toAddr, idx });
    continue;
  }

  const payload = {
    to: toAddr,
    from: fromAddr,
    ...(hasBody ? { body: part } : {}),
    ...(attachMedia ? { mediaUrl } : {}),
  };

  const preview = (payload.body || "").toString().slice(0, 120);
  try {
    const res = await twilioClient.messages.create(payload);
    logger.info(
      { sid: res.sid, to: toAddr, from: fromAddr, body_preview: preview },
      "📤 Resposta enviada"
    );
    results.push({ ok: true, sid: res.sid });
  } catch (err) {
    logger.error(
      { err: err?.message || err, to: toAddr, from: fromAddr, body_preview: preview },
      "[replyText] Falha Twilio"
    );
    throw err;
  }
}


  return results.length === 1 ? results[0] : results;
}
