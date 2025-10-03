// src/services/menuRepo.js
// Consulta CLIENTES, MENUS e MENU_OPCOES no MASTER (Firebird)

import { queryMaster } from './masterDb.js';

/** Normaliza para só dígitos (ex.: 'whatsapp:+55 47 9607-7564' -> '554796077564') */
function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/**
 * Localiza o cliente pelo NÚMERO DO BOT (o "To" da Twilio),
 * lido de CLIENTES.WHATSAPP_NUMBER no MASTER.
 *
 * Aceita formatos salvos como:
 *   - 'whatsapp:+17816788032'
 *   - '+17816788032'
 *   - '17816788032'
 *   - com espaços
 */
export async function getClientByNumber(rawTo) {
  const number = onlyDigits(rawTo);

  const sql = `
    SELECT FIRST 1 c.id AS cliente_id
      FROM clientes c
     WHERE c.ativo = 1
       AND REPLACE(REPLACE(REPLACE(UPPER(c.whatsapp_number),
                                   'WHATSAPP:', ''), '+', ''), ' ', '') = ?
  `;
  const rows = await queryMaster(sql, [number]);
  return rows?.[0]?.cliente_id ?? null;
}

/** Carrega o menu ativo do cliente no MASTER */
export async function loadMenuByCliente(clienteId) {
  const sql = `
    SELECT FIRST 1 id, titulo
      FROM menus
     WHERE cliente_id = ? AND ativo = 1
     ORDER BY id
  `;
  const rows = await queryMaster(sql, [clienteId]);
  if (!rows?.length) return null;
  return { menu_id: rows[0].id, titulo: rows[0].titulo };
}

/** Carrega opções para a chave/tela atual */
export async function getOptions(menuId, chavePai) {
  const sql = `
    SELECT opcao, texto, proxima_chave, ordem
      FROM menu_opcoes
     WHERE menu_id = ?
       AND UPPER(chave_pai) = UPPER(?)
     ORDER BY ordem, opcao
  `;
  return await queryMaster(sql, [menuId, chavePai || 'root']);
}
