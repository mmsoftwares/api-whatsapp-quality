// src/routes/cadastroveiculo.js
import express from 'express';
import logger from '../utils/logger.js';
import { getClientByNumber, getTenantPool } from '../services/db.js';
import firebird from 'node-firebird';

const router = express.Router();

function normWhats(v) {
  return String(v || '').trim().replace(/^whatsapp:/i, '');
}

function fbQuery(options, sql, params = []) {
  return new Promise((resolve, reject) => {
    firebird.attach(options, (err, db) => {
      if (err) return reject(err);
      db.query(sql, params, (qerr, result) => {
        try { db.detach(); } catch {}
        if (qerr) return reject(qerr);
        resolve(result || []);
      });
    });
  });
}

// Tamanhos de VARCHAR
const MAXLEN = {
  PLACA: 10,
  RENAVAN: 30,
  CATEGORIA: 100,
  CAPACIDADE: 50,
  POTENCIA: 50,
  PESOBRUTO: 50,
  MOTOR: 50,
  CMT: 50,
  LOTACAO: 50,
  CARROCERIA: 50,
  NOME: 150,
  CPFCNPJ: 20,
  LOCALIDADE: 50,
  CODIGOCLA: 50,
  CAT: 50,
  MARCA_MODELO: 50,
  ESPECIE_TIPO: 50,
  PLACAANTERIOR: 10,
  CHASSI: 50,
  COR: 50,
  COMBUSTIVEL: 50,
  OBS: 500,
  LINK: 500,
};

const INT_FIELDS = new Set(['ANOEXERCICIO', 'ANOMODELO', 'ANOFABRICACAO', 'EIXOS']);
const DATE_FIELDS = new Set(['DATA_LANC', 'DATAALT']);
const ALIASES = { LOCAL: 'LOCALIDADE', DATA: 'DATA_LANC' };

const VALID_COLUMNS = new Set([
  ...Object.keys(MAXLEN),
  ...INT_FIELDS,
  ...DATE_FIELDS,
  'DATAREG',
]);

function parseDatePt(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  // node-firebird aceita Date JS
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  try { return new Date(year, month, day); } catch { return null; }
}

function strFit(col, v) {
  const s = String(v ?? '').trim();
  const n = MAXLEN[col];
  return n ? s.slice(0, n) : s;
}

function toInt(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

router.post('/cadastroveiculo', express.json(), async (req, res) => {
  try {
    const toBiz = normWhats(req.header('x-whatsapp-number') || req.body?.to || req.body?.To);
    if (!toBiz) return res.status(400).json({ error: 'whatsapp number ausente' });

    const client = await getClientByNumber(toBiz);
    if (!client) return res.status(404).json({ error: 'cliente nao encontrado' });
    const pool = getTenantPool(client);

    const dadosIn = req.body?.dados || {};
    const link = req.body?.link || null;

    const dados = { ...(dadosIn || {}) };
    if (link) dados.LINK = link;

    // Normaliza colunas
    const norm = {};
    for (const [k, v] of Object.entries(dados)) {
      const up = String(k || '').toUpperCase();
      const key = ALIASES[up] || up;
      if (VALID_COLUMNS.has(key)) norm[key] = v;
    }

    // Monta colunas/valores
    const cols = ['DATAREG'];
    const vals = [new Date()];

    for (const [col, val] of Object.entries(norm)) {
      if (val === undefined || val === null || String(val).trim() === '') continue;
      if (DATE_FIELDS.has(col)) {
        const d = parseDatePt(val);
        if (d) { cols.push(col); vals.push(d); }
        continue;
      }
      if (INT_FIELDS.has(col)) {
        const iv = toInt(val);
        if (iv !== null) { cols.push(col); vals.push(iv); }
        continue;
      }
      if (MAXLEN[col] !== undefined) {
        cols.push(col); vals.push(strFit(col, val));
      }
    }

    if (cols.length === 1) {
      return res.status(400).json({ error: 'nenhum dado válido para inserir' });
    }

    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO TABPRECAD_VEICULO (${cols.join(', ')}) VALUES (${placeholders})`;
    logger.info({ toBiz, cols, preview: sql }, 'Insert TABPRECAD_VEICULO');

    await fbQuery(pool, sql, vals);
    return res.json({ status: 'salvo' });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'cadastro veiculo erro');
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;

