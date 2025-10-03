// src/services/dbClientes.js
import firebird from "node-firebird";
import logger from "../utils/logger.js";

const FB_MASTER = {
  host: process.env.FB_MASTER_HOST || process.env.FIREBIRD_HOST || "192.168.1.252",
  database: process.env.FB_MASTER_DATABASE || process.env.FIREBIRD_DATABASE,
  user: process.env.FB_MASTER_USER || process.env.FIREBIRD_USER || "SYSDBA",
  password: process.env.FB_MASTER_PASSWORD || process.env.FIREBIRD_PASSWORD || "masterkey",
  lowercase_keys: true,
  // se você precisar apontar o fbclient.dll: clientlib: 'C:/.../fbclient.dll'
};

function fbQuery(sql, params = []) {
  logger.info({ sql, params }, "Executando consulta ao banco master");
  return new Promise((resolve, reject) => {
    firebird.attach(FB_MASTER, (err, db) => {
      if (err) {
        logger.error({ err }, "Erro ao conectar ao Firebird");
        return reject(err);
      }
      db.query(sql, params, (qerr, rows) => {
        db.detach();
        if (qerr) {
          logger.error({ err: qerr, sql, params }, "Erro ao executar query");
          return reject(qerr);
        }
        logger.info(
          { count: Array.isArray(rows) ? rows.length : 0 },
          "Consulta executada com sucesso",
        );
        resolve(rows || []);
      });
    });
  });
}

/** remove 'whatsapp:' para facilitar comparação */
const stripWhats = (v) => String(v || "").trim().replace(/^whatsapp:/i, "");

/**
 * Descobre o cliente pelo número que RECEBE a mensagem (campo 'To' do webhook).
 * Faz match com variações (com/sem prefixo).
 */
export async function findClienteByToNumber(toNumberRaw) {
  const n = stripWhats(toNumberRaw);
  logger.info({ to: n }, "Buscando cliente pelo número recebido");
  try {
    const rows = await fbQuery(
      `SELECT FIRST 1
            ID,
            NOME,
            WHATSAPP_NUMBER,  -- de onde vamos tirar o FROM
            ATIVO,
            DB_PATH, DB_USER, DB_PASSWORD, DB_VERSION
       FROM CLIENTES
      WHERE ATIVO = 1
        AND (WHATSAPP_NUMBER = ? OR WHATSAPP_NUMBER = ? OR WHATSAPP_NUMBER = ?)`,
      [n, `whatsapp:${n}`, `WHATSAPP:${n}`],
    );
    if (!rows.length) {
      logger.warn({ to: n }, "Cliente não encontrado");
      return null;
    }
    logger.info({ id: rows[0].id }, "Cliente encontrado");
    return rows[0] || null;
  } catch (err) {
    logger.error({ err, to: n }, "Erro ao buscar cliente");
    throw err;
  }
}
