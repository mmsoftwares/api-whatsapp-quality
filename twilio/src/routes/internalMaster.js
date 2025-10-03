// twilio/src/routes/internalMaster.js
import express from 'express';
import logger from '../../src/utils/logger.js';
import { getClientByNumber } from '../../src/services/db.js';

const router = express.Router();

// GET /internal/master/cliente?toBiz=+1781...
router.get('/cliente', async (req, res) => {
  try {
    const toBiz = String(req.query.toBiz || '').replace(/^whatsapp:/i, '');
    if (!toBiz) return res.status(400).json({ error: 'toBiz ausente' });
    const client = await getClientByNumber(toBiz);
    if (!client) return res.status(404).json({ error: 'cliente nao encontrado' });
    // Mapeia campos esperados pelo backend Python
    return res.json({
      DB_HOST: client.db_host,
      DB_PORT: client.db_port,
      DB_PATH: client.db_path,
      DB_USER: client.db_user,
      DB_PASSWORD: client.db_password,
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'internal master error');
    return res.status(500).json({ error: 'internal error' });
  }
});

export default router;

