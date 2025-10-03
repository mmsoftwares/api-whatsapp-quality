// src/services/twilioClient.js
// ============================================================
// ATENÇÃO: CREDENCIAIS EXPLÍCITAS NO CÓDIGO (apenas para teste).
// NÃO COMMITAR EM REPOSITÓRIO PÚBLICO / GIT REMOTO!
// ============================================================

import twilio from "twilio";
import logger from "../utils/logger.js";

/* =========[ CONFIG EXPLÍCITA (HARD-CODED) ]========= */
// Obrigatórios
export const TWILIO_ACCOUNT_SID = "AC65f9333ba0a6f76d2990190db6640eed".trim();
export const TWILIO_AUTH_TOKEN  = "8e79c00e4e3f1e06f2225a65d8b6507c".trim();

// Opcional: fallback de remetente (se o cliente não tiver from no banco)
const TWILIO_WHATSAPP_FROM = "whatsapp:+17816788032".trim();

// Opcional: base pública para cálculo correto da assinatura
const BASE_URL = "https://purselike-elena-buckish.ngrok-free.dev".replace(/\/$/, "");

/* =========[ HELPERS DE LOG / VALIDAÇÃO ]========= */
const maskSid   = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "(none)");
const maskToken = (t) => (t ? `${t.slice(0, 2)}…${t.slice(-2)}` : "(none)");
const isWhats   = (v) => /^whatsapp:\+\d+$/.test(String(v || "").trim());
const normalizeWhats = (v) => (String(v || "").startsWith("whatsapp:") ? v : `whatsapp:${v}`);
const isValidSid = (sid) => /^AC[0-9a-z]{32}$/i.test(sid);

/* =========[ SANITY CHECK ]========= */
(function assertTwilioEnv() {
  const miss = [];
  if (!TWILIO_ACCOUNT_SID || !isValidSid(TWILIO_ACCOUNT_SID)) miss.push("TWILIO_ACCOUNT_SID(AC...) inválido");
  if (!TWILIO_AUTH_TOKEN) miss.push("TWILIO_AUTH_TOKEN ausente");
  if (miss.length) {
    logger.error({ miss }, "⚠️ Config Twilio inválida (hard-coded)");
    throw new Error("Config Twilio inválida. Verifique constantes no twilioClient.js");
  }
  logger.info(
    {
      accountSid: maskSid(TWILIO_ACCOUNT_SID),
      token: maskToken(TWILIO_AUTH_TOKEN),
      fallbackFrom: TWILIO_WHATSAPP_FROM || "(none)",
      baseUrl: BASE_URL || "(auto)",
      pid: process.pid,
      node: process.version,
    },
    "Twilio configurado (hard-coded)"
  );
})();

/* =========[ CLIENT ]========= */
export const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// em src/services/twilioClient.js, após export const client = twilio(...)
function sanitizeOutgoingBody(body) {
  if (typeof body === 'boolean') return body ? '✅ Operação concluída.' : '❌ Operação não concluída.';
  let txt = String(body ?? '').trim();
  if (/^ok[.!]*$/i.test(txt)) txt = '✅ Pronto! Envie as informações solicitadas.';
  return txt;
}
function diagTwilioError(err) {
  const e = err || {};
  return {
    message: e.message || (typeof e.toString === 'function' ? e.toString() : String(e)),
    status: e.status,
    code: e.code,
    moreInfo: e.moreInfo,
    detail: e.detail,
  };
}

const _origCreate = client.messages.create.bind(client);
client.messages.create = async (payload) => {
  const p = { ...payload };
  if (p.body != null) p.body = sanitizeOutgoingBody(p.body);
  try {
    return await _origCreate(p);
  } catch (err) {
    const diag = diagTwilioError(err);
    logger.error({ diag, to: p.to, from: p.from, preview: String(p.body || '').slice(0, 120) }, 'Twilio create() fail');
    throw err;
  }
};


/**
 * Verifica autenticação no boot (útil para diagnosticar 'invalid username' / token inválido)
 * Use em server.js:  verifyTwilioAuth().catch(()=>{})
 */
export async function verifyTwilioAuth() {
  try {
    const acc = await client.api.accounts(TWILIO_ACCOUNT_SID).fetch();
    logger.info({ sid: maskSid(acc.sid), status: acc.status, type: acc.type }, "Twilio auth OK");
  } catch (e) {
    logger.error({ err: e?.message || e, accountSid: maskSid(TWILIO_ACCOUNT_SID) }, "❌ Twilio auth FAIL");
    throw e;
  }
}

/* =========[ FROM CHOOSER ]========= */
/**
 * Decide o FROM que será usado no envio:
 * 1) Se 'from' (override) for válido → usa.
 * 2) Senão, se fallback do arquivo (TWILIO_WHATSAPP_FROM) for válido → usa.
 * 3) Senão, erro.
 */
function chooseFrom(overrideFrom) {
  const o = String(overrideFrom || "").trim();
  if (isWhats(o)) return o;
  if (isWhats(TWILIO_WHATSAPP_FROM)) return TWILIO_WHATSAPP_FROM;
  return null;
}

/* =========[ SEND: TEXTO ]========= */
// src/services/twilioClient.js
export async function sendWhatsAppText({ to, body, from }) {
  if (!to) throw new Error("to obrigatório");
  if (!body?.trim()) throw new Error("body obrigatório");
  const _from = chooseFrom(from);
  if (!_from) throw new Error("Remetente (from) inválido/ausente");

  const toFmt = normalizeWhats(to);
  const preview = String(body).replace(/\s+/g, ' ').slice(0, 80);

  try {
    const msg = await client.messages.create({ from: _from, to: toFmt, body: String(body) });
    logger.info({ sid: msg.sid, to: toFmt, from: _from, body_preview: preview }, "WA enviado (texto)");
    return msg;
  } catch (e) {
    const diag = diagTwilioError(e);
    logger.error({ diag, to: toFmt, from: _from, body_preview: preview }, "Falha ao enviar WA");
    throw e;
  }
}


/* =========[ SEND: MÍDIA ]========= */
export async function sendWhatsAppMedia({ to, body, mediaUrl, from }) {
  const toFmt = normalizeWhats(String(to || "").trim());
  const urls = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl];
  if (!urls.length || urls.some((u) => !/^https?:\/\//i.test(String(u || "")))) {
    throw new Error("mediaUrl inválido — precisa ser URL http(s)");
  }
  const _from = chooseFrom(from);
  if (!_from) {
    throw new Error("Remetente (from) inválido/ausente: defina CLIENTES.WHATSAPP_NUMBER ou TWILIO_WHATSAPP_FROM");
  }

  try {
    const msg = await client.messages.create({
      from: _from,
      to: toFmt,
      body: body || undefined,
      mediaUrl: urls,
    });
    logger.info({ sid: msg.sid, to: toFmt, from: _from, mediaCount: urls.length }, "WhatsApp enviado (mídia)");
    return msg;
  } catch (e) {
    logger.error({ e: e?.message || e, to: toFmt, from: _from }, "Falha ao enviar WhatsApp (mídia)");
    throw e;
  }
}

/* =========[ ASSINATURA DO WEBHOOK ]========= */
/**
 * Constrói a URL pública exatamente como a Twilio enxergou.
 * Em produção, prefira BASE_URL fixa para não depender de headers do proxy.
 */
function buildPublicUrl(req) {
  if (BASE_URL) return BASE_URL + req.originalUrl;
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host  = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}${req.originalUrl}`;
}

/**
 * Middleware de validação da assinatura (Twilio)
 * - Para JSON: usa req.rawBody (string capturada no server.js)
 * - Para x-www-form-urlencoded: usa req.body (objeto)
 */
export function validateTwilioSignature(req, res, next) {
  const signature = req.headers["x-twilio-signature"];
  if (!signature) return res.status(401).send("Missing signature");

  const url   = buildPublicUrl(req);
  const ctype = (req.headers["content-type"] || "").toLowerCase();
  const isJson = ctype.includes("application/json");

  let valid = false;
  try {
    valid = isJson && typeof req.rawBody === "string"
      ? twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.rawBody)
      : twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  } catch {
    return res.status(403).send("Invalid signature");
  }

  if (!valid) return res.status(403).send("Invalid signature");
  return next();
}
