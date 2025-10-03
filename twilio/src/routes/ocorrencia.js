import express from 'express';
import logger from '../utils/logger.js';
import { getClientByNumber, getTenantPool } from '../services/db.js';
import { inserirOcorrencia } from '../services/ocoService.js';

const router = express.Router();

router.post('/ocorrencia', async (req, res) => {
  const toBiz = req.header('x-whatsapp-number') || req.body?.toBiz;
  const { nomovtra, texto, cpf } = req.body || {};

  if (!toBiz) {
    return res.status(400).json({ error: "x-whatsapp-number ausente" });
  }
  if (!nomovtra || !texto || !cpf) {
    return res
      .status(400)
      .json({ error: "Campos obrigatórios: nomovtra, texto, cpf" });
  }

  try {
    const client = await getClientByNumber(toBiz);
    if (!client) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }
    const pool = getTenantPool(client);
    const resultado = await inserirOcorrencia(nomovtra, texto, cpf, pool);
    return res.json({ status: "ok", ...resultado });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'falha registrar ocorrência');
    return res.status(500).json({ error: 'Erro ao registrar ocorrência' });
  }
});

export default router;
