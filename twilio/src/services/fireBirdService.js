// src/services/masterDb.js
import fb from 'node-firebird';
import logger from '../utils/logger.js';

const env = (k, d = undefined) => process.env[k] ?? d;

// Preferir FB_MASTER_*; suporte a FIREBIRD_* (legado)
const FIREBIRD_HOST='177.67.203.208'
const FIREBIRD_DATABASE='/home/bdmm/Siserv/Database/DATABASE.GDB'
const FIREBIRD_USER='SYSDBA'
const FIREBIRD_PASSWORD='masterkey'
const FIREBIRD_PORT = 7272
const MASTER_OPTS = {
  host: FIREBIRD_HOST,
  port: FIREBIRD_PORT,
  database: FIREBIRD_DATABASE,
  user: FIREBIRD_USER,
  password: FIREBIRD_PASSWORD,
  role: null,
  pageSize: 8192,
  lowercase_keys: true,
};

function hasMasterConfig() {
  return Boolean(MASTER_OPTS.host && MASTER_OPTS.database && MASTER_OPTS.user && MASTER_OPTS.password);
}

function assertMasterEnv() {
  const missing = [];
  if (!MASTER_OPTS.host) missing.push('FB_MASTER_HOST');
  if (!MASTER_OPTS.database) missing.push('FB_MASTER_DATABASE');
  if (!MASTER_OPTS.user) missing.push('FB_MASTER_USER');
  if (!MASTER_OPTS.password) missing.push('FB_MASTER_PASSWORD');

  if (missing.length) {
    logger.warn({
      missing,
      resolved: {
        host: MASTER_OPTS.host,
        database: MASTER_OPTS.database,
        user: MASTER_OPTS.user,
      },
    }, 'Variaveis do MASTER ausentes - usando valores resolvidos (ou vazios)');
  }
  return missing.length === 0;
}

export function attachMaster() {
  const ok = assertMasterEnv();
  if (!ok) {
    const err = new Error('MASTER DB ausente: defina FB_MASTER_HOST, FB_MASTER_DATABASE, FB_MASTER_USER e FB_MASTER_PASSWORD');
    err.code = 'MASTER_ENV_MISSING';
    throw err;
  }
  return new Promise((resolve, reject) => {
    fb.attach(MASTER_OPTS, (err, db) => (err ? reject(err) : resolve(db)));
  });
}

export async function queryMaster(sql, params = []) {
  const db = await attachMaster();
  try {
    const rows = await new Promise((resolve, reject) => {
      db.query(sql, params, (err, rs) => (err ? reject(err) : resolve(rs || [])));
    });
    return rows;
  } finally {
    db.detach();
  }
}

export async function logMasterDbPath() {
  try {
    const rows = await queryMaster('SELECT MON$DATABASE_NAME AS PATH FROM MON$DATABASE');
    if (rows?.[0]?.path) {
      logger.info({ master_db: rows[0].path }, 'MASTER MON$DATABASE');
    } else {
      logger.warn('MASTER MON$DATABASE retornou vazio');
    }
  } catch (e) {
    if (e?.code === 'MASTER_ENV_MISSING') {
      logger.warn('MASTER nao configurado (variaveis ausentes) - pulando leitura de MON$DATABASE');
      return;
    }
    logger.warn({ e, gdscode: e?.gdscode }, 'Falha ao ler MON$DATABASE no MASTER');
  }
}
