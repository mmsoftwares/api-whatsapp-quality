import { one, execute } from "./fireBirdService.js";
import logger from "../utils/logger.js";

/** Busca o número do pedido vinculado à chave do CT-e. */
export async function getNomovtraByChave(chave, cfg) {
  const sql = "SELECT NOMOVTRA FROM TABCTRC WHERE CHAVECTE = ?";
  logger.info({ host: cfg.host, port: cfg.port, database: cfg.database }, "getNomovtraByChave");
  const row = await one(sql, [chave], cfg);
  return row?.nomovtra ?? null; // lowercase_keys: true -> 'nomovtra'
}

/** Retorna o CPF do motorista vinculado ao pedido. */
export async function getMotoristaCpf(nomovtra, cfg) {
  const sql = `
    SELECT mot.CGCCLI AS cpf
      FROM TABMOVTRA m
      JOIN TABCLI mot ON mot.NOCLI = m.NOMOT
     WHERE m.NOMOVTRA = ?
  `;
  logger.info({ host: cfg.host, port: cfg.port, database: cfg.database }, "getMotoristaCpf");
  const row = await one(sql, [nomovtra], cfg);
  return row?.cpf ?? null; // alias em minúsculo por causa de lowercase_keys
}

/** Gera o próximo NOITEM para o pedido informado. */
export async function getProximoNoitem(nomovtra, cfg) {
  const sql = `
    SELECT COALESCE(MAX(NOITEM), 0) + 1 AS prox_item
      FROM TABMOVTRA_OCO
     WHERE NOMOVTRA = ?
  `;
  logger.info({ host: cfg.host, port: cfg.port, database: cfg.database }, "getProximoNoitem");
  const row = await one(sql, [Number(nomovtra)], cfg);
  return row?.prox_item ?? 1; // <= importante: alias minúsculo
}

/**
 * Insere ocorrência.
 * Dica: se quiser confirmar o número gerado, use RETURNING NOMOVTRA, NOITEM.
 */
export async function inserirOcorrencia(nomovtra, obs, usuario, cfg) {
  const noitem = await getProximoNoitem(nomovtra, cfg);

  const sql = `
  INSERT INTO TABMOVTRA_OCO (NOMOVTRA, NOITEM, DATA, HORA, OBS, USUARIO)
  VALUES (
    ?,                                   -- NOMOVTRA
    ?,                                   -- NOITEM
    CAST('NOW' AS DATE),                 -- DATA (timestamp completo)
    SUBSTRING(CAST('NOW' AS CHAR(24)) FROM 12 FOR 5), -- HORA HH:MM
    ?,                                   -- OBS
    ?                                    -- USUARIO
  )
  RETURNING NOMOVTRA, NOITEM
`;



  logger.info({ host: cfg.host, port: cfg.port, database: cfg.database }, "inserirOcorrencia");
  console.log(nomovtra)
  const rows = await execute(sql, [Number(nomovtra), noitem, obs, usuario], cfg);
  const ret = rows?.[0] || {};
  return { nomovtra: ret.nomovtra ?? Number(nomovtra), noitem: ret.noitem ?? noitem };
}

export default { getNomovtraByChave, getMotoristaCpf, getProximoNoitem, inserirOcorrencia };
