/**
 * Serviço utilitário para acessar o Firebird (ESM).
 *
 * Windows: pode ser necessário apontar a fbclient.dll:
 *   setx FIREBIRD_CLIENTLIB "C:\\Program Files\\Firebird\\Firebird_2_5\\bin\\fbclient.dll"
 *
 * Dependência:
 *   npm i node-firebird
 */
import fb from "node-firebird";

function isAuthError(e) {
  const msg = String(e?.message || e || "");
  return e?.gdscode === 335544472 || /user name and password are not defined/i.test(msg);
}

const FIREBIRD_HOST = "177.67.203.208";
const FIREBIRD_DATABASE = "/home/bdmm/Siserv/Database/DATABASE.GDB";
const FIREBIRD_USER = "SYSDBA";
const FIREBIRD_PASSWORD = "masterkey";
const FIREBIRD_PORT = "7272";

// Defaults que podem ser sobrescritos por variáveis de ambiente
const baseConfig = {
  host: process.env.FIREBIRD_HOST || FIREBIRD_HOST,
  port: process.env.FIREBIRD_PORT ? Number(process.env.FIREBIRD_PORT) : Number(FIREBIRD_PORT),
  database: process.env.FIREBIRD_DATABASE || FIREBIRD_DATABASE,
  user: process.env.FIREBIRD_USER || FIREBIRD_USER,
  password: process.env.FIREBIRD_PASSWORD || FIREBIRD_PASSWORD,
  role: null,
  pageSize: 8192,
  // Com isso, o driver retorna as chaves dos objetos em minúsculas
  lowercase_keys: true,
  clientlib: process.env.FIREBIRD_CLIENTLIB, // opcional no Windows
};

function buildConfig(overrides = {}) {
  /**
   * Mescla sem sobrescrever com valores undefined.
   */
  const cleanOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined)
  );
  const charset = cleanOverrides.charset || process.env.FIREBIRD_CHARSET || "UTF8"; // use UTF8 se sua base for UTF8
  const cfg = { ...baseConfig, ...cleanOverrides, charset };
  const missing = [];
  if (!cfg.host) missing.push("host");
  if (!cfg.port && cfg.port !== 0) missing.push("port");
  if (!cfg.database) missing.push("database");
  if (!cfg.user) missing.push("user");
  if (!cfg.password) missing.push("password");
  if (missing.length) {
    throw new Error(`Configuração Firebird incompleta: ${missing.join(", ")}`);
  }
  return cfg;
}

export function attach(overrides = {}) {
  const cfg = buildConfig(overrides);
  return new Promise((resolve, reject) => {
    fb.attach(cfg, (err, db) => {
      if (!err) return resolve(db);
      // Retry com fallback SYSDBA/masterkey somente em erro de autenticação
      if (isAuthError(err)) {
        const fbCfg = { ...cfg, user: 'SYSDBA', password: 'masterkey' };
        return fb.attach(fbCfg, (err2, db2) => (err2 ? reject(err) : resolve(db2)));
      }
      return reject(err);
    });
  });
}

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => (err ? reject(err) : resolve(result || [])));
  });
}

function detach(db) {
  try {
    db && db.detach && db.detach();
  } catch {
    /* ignore */
  }
}

/**
 * Executa SELECT/DML abrindo e fechando conexão automaticamente.
 * Para DML com RETURNING, o driver devolve as linhas retornadas.
 */
export async function query(sql, params = [], overrides = {}) {
  const db = await attach(overrides);
  try {
    return await dbQuery(db, sql, params);
  } finally {
    detach(db);
  }
}

/** Retorna a primeira linha (ou null). */
export async function one(sql, params = [], overrides = {}) {
  const rows = await query(sql, params, overrides);
  return rows?.[0] ?? null;
}

/** Alias semântico para DML. Retorna as linhas (útil com RETURNING). */
export async function execute(sql, params = [], overrides = {}) {
  return query(sql, params, overrides);
}

/**
 * Transação simples: abre 1 conexão e executa várias queries nela.
 * Uso:
 *   await transaction(async (dbq) => {
 *     await dbq("INSERT ...", [..]);
 *     await dbq("UPDATE ...", [..]);
 *   });
 */
export async function transaction(fn, overrides = {}) {
  const db = await attach(overrides);
  try {
    const dbq = (sql, params = []) => dbQuery(db, sql, params);
    await fn(dbq);
  } finally {
    detach(db);
  }
}

export default { attach, query, one, execute, transaction };
