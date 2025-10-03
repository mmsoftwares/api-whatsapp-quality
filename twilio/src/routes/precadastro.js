// src/routes/precadastro.js
import express from 'express';
import firebird from 'node-firebird';
import logger from '../utils/logger.js';
import { getClientByNumber, getTenantPool } from '../services/db.js';

const router = express.Router();

function normWhats(v) {
  return String(v || '').trim().replace(/^whatsapp:/i, '');
}

function fbQuery(options, sql, params = []) {
  return new Promise((resolve, reject) => {
    // Forçar uso das credenciais hardcoded se faltarem no pool
    const hardUser = options.user || 'SYSDBA';
    const hardPass = options.password || 'masterkey';
    const opts2 = { ...options, user: hardUser, password: hardPass };

    firebird.attach(opts2, (err, db) => {
      if (err) return reject(err);

      db.query(sql, params, (qerr, result) => {
        try {
          db.detach();
        } catch (e) {
          // ignora erro de detach
        }

        if (qerr) return reject(qerr);
        resolve(result || []);
      });
    });
  });
}

router.post('/precadastro', express.json(), async (req, res) => {
  try {
    const toBiz = normWhats(req.header('x-whatsapp-number') || req.body?.to || req.body?.To);
    if (!toBiz) return res.status(400).json({ error: 'whatsapp number ausente' });

    const client = await getClientByNumber(toBiz);
    if (!client) return res.status(404).json({ error: 'cliente nao encontrado' });
    const pool = getTenantPool(client);

    const dados = req.body?.dados || {};
    const link = req.body?.link || null;

    // Normalizador de datas (DD/MM/AAAA -> AAAA-MM-DD)
    const toISO = (s) => {
      const v = String(s || '').trim();
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      return v || null;
    };

    // Mapeia campos recebidos -> colunas reais da tabela
    const record = {
      NOME: dados.NOME ?? null,
      CNH_DATAEMISSAO: toISO(dados.CNH_DATAEMISSAO),
      CNH_DATA1CNH: toISO(dados.CNH_DATA1CNH),
      CNH_DATAVCTO: toISO(dados.CNH_DATAVCTO),
      DATANASC: toISO(dados.DATANASC),
      CIDADENASC: dados.CIDADENASC ?? null,
      // Se vier apenas UFEXPEDICAO/UF, replicamos em UFEMISSOR
      UFEMISSOR: dados.UFEMISSOR ?? dados.UFEXPEDICAO ?? dados.UF ?? null,
      ORGAOEMISSOR: dados.ORGAOEMISSOR ?? null,
      RG: dados.RG ?? null,
      CPF: dados.CPF ?? null,
      CNH_REGISTRO: dados.CNH_REGISTRO ?? dados.CNH_REG_11 ?? dados.CNH_REG_10 ?? null,
      CNH_CAT: dados.CNH_CAT ?? null,
      NACIONALIDADE: dados.NACIONALIDADE ?? null,
      FIL_PAI: dados.FIL_PAI ?? null,
      FIL_MAE: dados.FIL_MAE ?? null,
      CNH_PROTOCOLO: dados.CNH_PROTOCOLO ?? null,
      CIDADEEXPEDICAO: dados.CIDADEEXPEDICAO ?? dados.LOCAL_EMISSAO ?? null,
      UFEXPEDICAO: dados.UFEXPEDICAO ?? dados.UF ?? null,
      CNH_SEGURO: dados.CNH_SEGURO ?? null,
      LINK: link,
      TELEFONE: dados.TELEFONE ?? null,
      // Preenche datas de registro/alteração caso não haja trigger
      DATAREG: new Date(),
      DATAALT: new Date(),
    };

    // Monta INSERT dinâmico apenas com colunas não-nulas
    const cols = Object.keys(record).filter((k) => record[k] !== undefined);
    const vals = cols.map((k) => record[k]);
    const placeholders = cols.map(() => '?').join(',');
    const sql = `INSERT INTO TABPRECAD_PESSOA (${cols.join(',')}) VALUES (${placeholders})`;

    await fbQuery(pool, sql, vals).catch(async (e) => {
      // Fallback enxuto com subset mínimo caso alguma coluna não exista
      logger.warn({ err: e?.message || e }, 'TABPRECAD_PESSOA: fallback subset');
      const minCols = ['NOME','CPF','TELEFONE','LINK'];
      const cols2 = minCols.filter((c) => c in record);
      const vals2 = cols2.map((k) => record[k]);
      const sql2 = `INSERT INTO TABPRECAD_PESSOA (${cols2.join(',')}) VALUES (${cols2.map(()=>'?').join(',')})`;
      await fbQuery(pool, sql2, vals2);
    });

    return res.json({ status: 'salvo' });
  } catch (err) {
    logger.error({ err: err?.message || err }, 'falha /precadastro (node)');
    return res.status(500).json({ error: 'falha ao salvar precadastro' });
  }
});

export default router;
