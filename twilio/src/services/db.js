// src/services/db.js
// ESM — Firebird (pacote "node-firebird" legado)
import fs from "fs";
import firebird from "node-firebird";
import logger from "../utils/logger.js";

// DLLs via .env (com defaults sensatos). Preferimos x64 quando existir.
const pickFirstExisting = (candidates) => candidates.find((p) => p && fs.existsSync(p));
const FB_DLL_25 =
  pickFirstExisting([
    "C:/Program Files/Firebird/Firebird_2_5/bin/fbclient.dll",
    "C:/Program Files (x86)/Firebird/Firebird_2_5/bin/fbclient.dll",
    process.env.FBCLIENT_DLL_25,
  ]) || "C:/Program Files (x86)/Firebird/Firebird_2_5/bin/fbclient.dll";
const FB_DLL_50 =
  pickFirstExisting([
    "C:/Program Files/Firebird/Firebird_5_0/fbclient.dll",
    "C:/Program Files (x86)/Firebird/Firebird_5_0/bin/fbclient.dll",
    process.env.FBCLIENT_DLL_50,
  ]) || "C:/Program Files (x86)/Firebird/Firebird_5_0/fbclient.dll";
  

/**
 * ---------- Config MASTER (onde ficam os clientes) ----------
 * Preferimos FB_MASTER_*; se não existir, caímos nos FIREBIRD_* (legado).
 */
const FIREBIRD_HOST = '192.168.1.252'
const FIREBIRD_DATABASE = '/home/bdmm/Siserv/Database/DATABASE.GDB'
const FIREBIRD_USER = 'SYSDBA'
const FIREBIRD_PASSWORD = 'masterkey'
const masterOptions = {
  host: FIREBIRD_HOST || process.env.FB_MASTER_HOST || process.env.FIREBIRD_HOST,
  database: FIREBIRD_DATABASE || process.env.FB_MASTER_DATABASE || process.env.FIREBIRD_DATABASE || "Siserv", // ex.: /home/bdmm/Siserv/Database/DATABASE.GDB
  user: FIREBIRD_USER || process.env.FB_MASTER_USER || process.env.FIREBIRD_USER,
  password: FIREBIRD_PASSWORD || process.env.FB_MASTER_PASSWORD || process.env.FIREBIRD_PASSWORD,
  lowercase_keys: true,
  clientlib: process.env.FBCLIENT_DLL || FB_DLL_25, // usa DLL 2.5 por padrão
  encoding: process.env.FB_ENCODING_MASTER || "win1252",
  // wireCrypt é aplicável ao FB 3+. Master é 2.5 — deixamos padrão do client.
};

if (!masterOptions.database) {
  logger.warn({ masterOptions }, "MASTER sem caminho de database. Verifique .env (FB_MASTER_DATABASE ou FIREBIRD_DATABASE).");
}

function masterConfigured() {
  return Boolean(masterOptions.host && masterOptions.database && masterOptions.user && masterOptions.password);
}

// ---------- Pools por cliente ----------
const clientPools = new Map();

// ---------- Helper genérico de query ----------
function isAuthError(e) {
  const msg = String(e?.message || e || "");
  return e?.gdscode === 335544472 || /user name and password are not defined/i.test(msg);
}

function fbQuery(options, sql, params = []) {
  return new Promise((resolve, reject) => {
    const doAttach = (opts, triedFallback = false) => {
      firebird.attach(opts, (err, db) => {
        if (err) {
          if (!triedFallback) {
            // Se falhou por autenticação, tenta fallback SYSDBA/masterkey uma vez
            if (isAuthError(err)) {
              const fbOpts = { ...opts, user: "SYSDBA", password: "masterkey" };
              logger.warn({ host: fbOpts.host, database: fbOpts.database }, "attach retry with SYSDBA/masterkey");
              return doAttach(fbOpts, true);
            }
          }
          return reject(err);
        }
        db.query(sql, params, (qerr, result) => {
          try { db.detach(); } catch {}
          if (qerr) return reject(qerr);
          resolve(result || []);
        });
      });
    };
    doAttach(options, false);
  });
}

// Normalizador simples para número whatsapp (remove prefixo e espaços)
function normWhats(v) {
  return String(v || "").trim().replace(/^whatsapp:/i, "");
}

// ------------------------------------------------------------------
// Suporte legado: parse de DB_PATH no formato "host[:/port]:database"
// Exemplos:
//   192.168.1.252:SISERV            -> host=192.168.1.252, port=3050, database=SISERV
//   192.168.1.252/3051:SISERV_ALIAS -> host=192.168.1.252, port=3051, database=SISERV_ALIAS
//   host: C:/Siserv/database/DATABASE.GDB -> host=host, port=3050, database=C:/Siserv/.../DATABASE.GDB
function parseLegacyConnString(path) {
  const str = String(path || "").trim();
  const idx = str.indexOf(":");
  if (idx <= 0) return null;
  const hostPart = str.slice(0, idx).trim();
  const database = str.slice(idx + 1).trim();
  if (!hostPart || !database) return null;

  let host = hostPart;
  let port = 3050;
  const slashIdx = hostPart.indexOf("/");
  if (slashIdx > 0) {
    host = hostPart.slice(0, slashIdx).trim();
    const p = parseInt(hostPart.slice(slashIdx + 1).trim(), 10);
    if (!Number.isNaN(p)) port = p;
  }
  if (!host) return null;
  return { host, port, database };
}

// Remove prefixo de host/porta do DB_PATH quando um host já foi fornecido separadamente
function stripHostFromDbPath(dbPath, host) {
  const s = String(dbPath || "").trim();
  if (!s) return s;
  if (!host) return s;
  // padrao: <host>[:/<port>]:<database>
  const m = s.match(/^([^:]+)(?:\/(\d+))?:(.+)$/);
  if (m) {
    const h = (m[1] || "").trim();
    const database = (m[3] || "").trim();
    if (h && h === String(host).trim()) {
      return database; // remove host duplicado
    }
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* ---------------- MASTER: mapeia cliente pelo número Twilio -------- */
/* ------------------------------------------------------------------ */
export async function getClientByNumber(to) {
  if (!masterConfigured()) {
    logger.warn({ master: { host: masterOptions.host, database: masterOptions.database, user: masterOptions.user } }, "MASTER nao configurado - getClientByNumber retornando null");
    return null;
  }
  // procura com e sem o prefixo "whatsapp:" para ficar tolerante ao que vier salvo no DB
  const n = normWhats(to);
  const withPrefixLower = `whatsapp:${n}`;
  const withPrefixUpper = `WHATSAPP:${n}`;

  const rows = await fbQuery(
    masterOptions,
    "SELECT FIRST 1 * " +
      "FROM CLIENTES " +
      "WHERE ATIVO = 1 " +
      "  AND WHATSAPP_NUMBER IN (?, ?, ?)",
    [n, withPrefixLower, withPrefixUpper]
  );

  return rows[0] || null; // retorna a linha do cliente (db_path, db_user, db_password, db_version, etc.)
}

/* ------------------------------------------------------------------ */
/* --------------- TENANT: opções de conexão por cliente ------------- */
/* ------------------------------------------------------------------ */
export function getTenantPool(client) {
  if (!client) return null;

  if (!clientPools.has(client.id)) {
    // Tenta derivar host/port a partir do DB_PATH quando ausentes (legado)
    let host = client.db_host;
    let port = client.db_port != null ? Number(client.db_port) : undefined;
    let database = client.db_path;

    if ((!host || !port) && client.db_path) {
      const parsed = parseLegacyConnString(client.db_path);
      if (parsed) {
        host = host || parsed.host;
        port = port || parsed.port;
        database = parsed.database || database;
      }
    }

    // Se temos host, garanta que database nao traga prefixo "host:..."
    database = stripHostFromDbPath(database, host);

    // Fallback hardcoded: usar SYSDBA/masterkey se ausência de credenciais do tenant
    const user = client.db_user || 'SYSDBA';
    const password = client.db_password || 'masterkey';
    const missing = [];
    if (!host) missing.push("db_host");
    if (port == null || Number.isNaN(port)) missing.push("db_port");
    if (!database) missing.push("db_path");
    // Para user/password, aceitamos fallback SYSDBA/masterkey
    if (!user) missing.push("db_user");
    if (!password) missing.push("db_password");
    if (missing.length) {
      const msg = `Tenant=${client.id} configuração ausente: ${missing.join(", ")}`;
      logger.error({ clienteId: client.id, missing }, msg);
      throw new Error(msg);
    }

    const is25 = String(client.db_version || "").startsWith("2.5");
    const fbClientPath = is25 ? FB_DLL_25 : FB_DLL_50;

    // Encoding do banco do cliente
    const encoding = process.env.FB_ENCODING_TENANT || "win1252";

    const opts = {
      host,
      port: Number(port),
      database,
      user: user,
      password: password,
      lowercase_keys: true,
      clientlib: fbClientPath,
      encoding,
    };

    logger.info(
      {
        clienteId: client.id,
        host: opts.host,
        port: opts.port,
        database: opts.database,
        user: opts.user,
        passwordLength: String(opts.password || '').length,
        fbclient: fbClientPath,
        version: client.db_version,
      },
      "TENANT DB attach options",
    );

    clientPools.set(client.id, opts);
  }

  return clientPools.get(client.id);
}

/* ------------------------------------------------------------------ */
/* ----------------------------- Menus ------------------------------ */
/* ------------------------------------------------------------------ */
export async function loadMenu(clienteId, pool) {
  const menuRows = await fbQuery(
    pool,
    "SELECT FIRST 1 ID, TITULO FROM MENUS WHERE CLIENTE_ID = ? AND ATIVO = 1 ORDER BY ID",
    [clienteId]
  );
  const menu = menuRows[0];
  if (!menu) return null;

  const options = await fbQuery(
    pool,
    "SELECT OPCAO AS CHAVE, TEXTO, PROXIMA_CHAVE " +
      "FROM MENU_OPCOES WHERE MENU_ID = ? AND CHAVE_PAI = 'root' " +
      "ORDER BY ORDEM, ID",
    [menu.id]
  );

  return { ...menu, options };
}

export async function getOptions(pool, menuId, chaveAtual) {
  return fbQuery(
    pool,
    "SELECT OPCAO AS CHAVE, TEXTO, PROXIMA_CHAVE " +
      "FROM MENU_OPCOES WHERE MENU_ID = ? AND CHAVE_PAI = ? " +
      "ORDER BY ORDEM, ID",
    [menuId, chaveAtual]
  );
}

/* ------------------------------------------------------------------ */
/* --------------------------- Conversas ----------------------------- */
/* ------------------------------------------------------------------ */
export async function logConversation(pool, clienteId, userNumber, mensagem, resposta, link = null) {
  try {
    const onlyNumber = normWhats(userNumber);
    const cut = (s, n) => (s ? String(s).slice(0, n) : null);

    await fbQuery(
      pool,
      "INSERT INTO CONVERSAS (CLIENTE_ID, USER_NUMBER, MENSAGEM, RESPOSTA, DATA_HORA, LINK) " +
        "VALUES (?,?,?,?,CURRENT_TIMESTAMP, ?)",
      [
        clienteId,
        cut(onlyNumber, 32),
        cut(mensagem, 1000),
        cut(resposta, 2000),
        cut(link, 500)   // ✅ novo parâmetro para o LINK
      ]
    );
  } catch (err) {
    logger.error({ err }, "Falha ao registrar conversa");
  }
}
