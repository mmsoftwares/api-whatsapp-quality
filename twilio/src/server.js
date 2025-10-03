// twilio/src/server.js
// twilio/src/server.js
import dotenv from "dotenv";
dotenv.config();

// 2) Demais imports (que podem usar process.env)
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

import logger from './utils/logger.js';
import whatsappWebhook from './routes/whatsapp/index.js';
import multiTenantWebhook from './routes/webhook.js';
import { validateTwilioSignature } from './services/twilioClient.js';
import { verifyTwilioAuth } from './services/twilioClient.js';
import ocorrenciaRoute from './routes/ocorrencia.js';
import precadastroRoute from './routes/precadastro.js';
import cadastroVeiculoRoute from './routes/cadastroveiculo.js';
import internalMasterRoute from './routes/internalMaster.js';

// depois de montar middlewares/rotas
verifyTwilioAuth().catch(() => {
  // Fail-fast: se autenticar com a Twilio falhar no boot, encerra o processo
  console.error('[FATAL] Twilio auth failed on boot. Exiting.');
  try { process.exit(1); } catch {}
});


const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://192.168.150.38:5173',
  'https://api.tisoluciona.com',
  'https://aplicativo.tisoluciona.com',
  'https://caminhoneiro.tisoluciona.com',
  'https://backend.tisoluciona.com',
  'https://purselike-elena-buckish.ngrok-free.dev',
  'http://localhost:8081',
];

app.set('trust proxy', 1);

// Segurança básica (CSP desligado por padrão para evitar bloquear webhooks; ajuste se precisar)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

// CORS
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // permite tools/healthchecks sem origin
      const ok = allowedOrigins.includes(origin);
      cb(ok ? null : new Error('Not allowed by CORS'), ok);
    },
    credentials: true,
  })
);

// Logs HTTP
app.use(morgan('combined'));

// Body parsers — importante: capturar rawBody para JSON (Twilio Signature com JSON usa raw)
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8'); // corpo cru para validação de assinatura
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// Rate limit — protege somente os webhooks
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 req/min por IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/webhooks', limiter);

// Validação de assinatura da Twilio — aplique APENAS nos webhooks
app.use('/webhooks', validateTwilioSignature);

// Rotas
app.use('/webhooks', whatsappWebhook); // ex.: POST /webhooks/whatsapp
app.use('/webhook', multiTenantWebhook);           // mantém sua rota multi-tenant (ex.: POST /webhook)
app.use(ocorrenciaRoute);             // POST /ocorrencia
app.use(precadastroRoute);            // POST /precadastro (Node)
app.use(cadastroVeiculoRoute);        // POST /cadastroveiculo (Node)
app.use('/internal/master', internalMasterRoute); // GET /internal/master/cliente            // POST /precadastro (Node)

// Healthcheck
app.get('/health', (req, res) => res.json({ ok: true }));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err: err?.message || err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal Server Error' });
});

// Porta (mantive 8001 como você vinha usando; se quiser, deixe PORT no .env)
const port = Number(process.env.PORT || 8001);
app.listen(port, () => {
  logger.info(`🚀 Twilio WhatsApp integration rodando na porta ${port}`);
});
