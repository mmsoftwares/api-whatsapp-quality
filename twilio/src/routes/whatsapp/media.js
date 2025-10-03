import { isPdfByContentType, isImageByContentType } from "../../utils/validators.js";
import { replyText } from "../../services/responder.js";

/**
 * Valida tipo de mídia enviado.
 * Pode ser chamado de duas formas:
 *   ensureSupportedMedia(from, contentType, label?);
 *   ensureSupportedMedia({ toBiz, from, contentType, label? });
 */
export function ensureSupportedMedia(a, b, c) {
  // Normaliza assinatura
  let toBiz, from, contentType, label;

  if (typeof a === "object" && a !== null) {
    ({ toBiz, from, contentType } = a);
    label = a.label || "documento";
  } else {
    from = a;
    contentType = b;
    label = c || "documento";
    // sem toBiz -> usa fallback do .env dentro do replyText
  }

  const ok = isImageByContentType(contentType) || isPdfByContentType(contentType);
  if (!ok) {
    return replyText({
      to: from,
      from: toBiz, // se undefined, responder.js usa fallback TWILIO_WHATSAPP_FROM
      body: `⚠️ Envie apenas *imagem* (JPG/PNG) ou *PDF* do ${label}.`
    });
  }
  return Promise.resolve();
}
