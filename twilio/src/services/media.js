import axios from "axios";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.js";
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from "./twilioClient.js";

// Baixa a mídia do MediaUrl{N} da Twilio.
// Retorna { path, contentType, filename } (arquivo temporário salvo)
export async function downloadTwilioMedia(mediaUrl, preferredName = null) {
  const id = uuid().slice(0, 8);
  const targetDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const resp = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    auth: {
      username: TWILIO_ACCOUNT_SID,
      password: TWILIO_AUTH_TOKEN
    },
    timeout: Number(process.env.EXTERNAL_HTTP_TIMEOUT_MS || 20000)
  });

  const contentType = resp.headers["content-type"] || "application/octet-stream";
  const ext = guessExtByContentType(contentType);
  const filename = preferredName || `tw-${id}${ext}`;
  const filePath = path.join(targetDir, filename);

  fs.writeFileSync(filePath, Buffer.from(resp.data));
  logger.info({ filePath, contentType }, "📥 Mídia baixada da Twilio");
  return { path: filePath, contentType, filename };
}

function guessExtByContentType(ct) {
  if (!ct) return "";
  if (/pdf/i.test(ct)) return ".pdf";
  if (/png/i.test(ct)) return ".png";
  if (/jpeg/i.test(ct)) return ".jpg";
  if (/jpg/i.test(ct)) return ".jpg";
  if (/webp/i.test(ct)) return ".webp";
  return "";
}
