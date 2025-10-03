// src/services/authService.js
import { query } from "./fireBirdService.js";
import { getClientByNumber, getTenantPool } from "./db.js";
import logger from "../utils/logger.js";

// Resolução de cliente/pool centralizada via db.js

const onlyDigits = (v) => String(v || "").replace(/\D/g, "");
const SQL_CLEAN_TEL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(C.TELEFONE,'-',''),' ',''),'(',''),')',''),'.','')";

async function getTenantPoolByTo(toBiz) {
  const n = String(toBiz || "").trim();
  if (!n) return null;
  const client = await getClientByNumber(n);
  if (!client) return null;
  return getTenantPool(client);
}

// ✅ Verificação por telefone
export async function verificarMotoristaPorTelefone(fromUser, toBiz) {
  try {
    const digits = onlyDigits(String(fromUser || "").replace(/^whatsapp:/i, ""));
    if (!digits.startsWith("55") || digits.length < 12) return null;

    const dddRaw = digits.slice(2, 4);
    const phone = digits.slice(4);
    const ddd2 = dddRaw.replace(/^0+/, "");
    const ddd3 = ddd2.padStart(3, "0");
    const last8 = phone.slice(-8);
    const last9 = phone.slice(-9);
    const with9 = last9.length === 9 ? last9 : `9${last8}`;

    const pool = await getTenantPoolByTo(toBiz);

    // 🔍 Primeiro tenta no TABCLI
    const sqlCli = `
      SELECT FIRST 1 T.CGCCLI
        FROM TABCLI_CONT C
        JOIN TABCLI T ON T.NOCLI = C.NOCLI
       WHERE (T.MOT = 'T' OR T.PROP = 'T')
         AND COALESCE(T.INATIVO, 'F') <> 'T'
         AND COALESCE(T.BLOQUEARMOT, 'F') <> 'T'
         AND (C.DDD = ? OR C.DDD = ?)
         AND (C.TIPOTEL IS NULL OR UPPER(C.TIPOTEL) STARTING WITH 'CEL')
         AND (
              ${SQL_CLEAN_TEL} = ? OR
              ${SQL_CLEAN_TEL} = ? OR
              ${SQL_CLEAN_TEL} LIKE ? OR
              ${SQL_CLEAN_TEL} LIKE ?
         )
    `;
    const r1 = await query(sqlCli, [ddd2, ddd3, last8, with9, `%${last8}`, `%${with9}`], pool);
    if (r1.length > 0) return onlyDigits(r1[0].cgccli);

    // 🔍 Se não achou, tenta no TABPRECAD_PESSOA (nova coluna TELEFONE)
    const sqlPessoa = `
      SELECT FIRST 1 CPF
        FROM TABPRECAD_PESSOA
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TELEFONE,'-',''),' ',''),'(',''),')',''),'.','')
             LIKE ? OR
             REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TELEFONE,'-',''),' ',''),'(',''),')',''),'.','')
             LIKE ?
    `;
    const r2 = await query(sqlPessoa, [`%${last8}`, `%${with9}`], pool);
    if (r2.length > 0) return onlyDigits(r2[0].cpf);

    return null;
  } catch (err) {
    logger.error({ err, fromUser, toBiz }, "verificarMotoristaPorTelefone: falha de consulta");
    return null;
  }
}

/**
 * Retorna o status do telefone no banco do cliente.
 * - { cadastrado: true, cpf } se encontrado em TABCLI (motorista/proprietário ativo)
 * - { precadastro: true, cpf } se não estiver em TABCLI mas existir em TABPRECAD_PESSOA
 * - { cadastrado:false, precadastro:false } caso contrário
 */
export async function verificarStatusTelefone(fromUser, toBiz) {
  try {
    const digits = onlyDigits(String(fromUser || "").replace(/^whatsapp:/i, ""));
    if (!digits.startsWith("55") || digits.length < 12) {
      return { cadastrado: false, precadastro: false };
    }

    const dddRaw = digits.slice(2, 4);
    const phone = digits.slice(4);
    const ddd2 = dddRaw.replace(/^0+/, "");
    const ddd3 = ddd2.padStart(3, "0");
    const last8 = phone.slice(-8);
    const last9 = phone.slice(-9);
    const with9 = last9.length === 9 ? last9 : `9${last8}`;

    const pool = await getTenantPoolByTo(toBiz);

    const sqlCli = `
      SELECT FIRST 1 T.CGCCLI
        FROM TABCLI_CONT C
        JOIN TABCLI T ON T.NOCLI = C.NOCLI
       WHERE (T.MOT = 'T' OR T.PROP = 'T')
         AND COALESCE(T.INATIVO, 'F') <> 'T'
         AND COALESCE(T.BLOQUEARMOT, 'F') <> 'T'
         AND (C.DDD = ? OR C.DDD = ?)
         AND (C.TIPOTEL IS NULL OR UPPER(C.TIPOTEL) STARTING WITH 'CEL')
         AND (
              ${SQL_CLEAN_TEL} = ? OR
              ${SQL_CLEAN_TEL} = ? OR
              ${SQL_CLEAN_TEL} LIKE ? OR
              ${SQL_CLEAN_TEL} LIKE ?
         )
    `;
    const r1 = await query(sqlCli, [ddd2, ddd3, last8, with9, `%${last8}`, `%${with9}`], pool);
    if (r1.length > 0) {
      const cpf = onlyDigits(r1[0].cgccli);
      return { cadastrado: true, precadastro: false, cpf };
    }

    const sqlPessoa = `
      SELECT FIRST 1 CPF
        FROM TABPRECAD_PESSOA
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TELEFONE,'-',''),' ',''),'(',''),')',''),'.','')
             LIKE ? OR
             REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TELEFONE,'-',''),' ',''),'(',''),')',''),'.','')
             LIKE ?
    `;
    const r2 = await query(sqlPessoa, [`%${last8}`, `%${with9}`], pool);
    if (r2.length > 0) {
      const cpf = onlyDigits(r2[0].cpf);
      // Novo: se o CPF do pré-cadastro já existir como cliente ativo (TABCLI), trate como cadastrado
      const sqlCliCpf = `
        SELECT FIRST 1 T.CGCCLI
          FROM TABCLI T
         WHERE (T.MOT = 'T' OR T.PROP = 'T')
           AND COALESCE(T.INATIVO, 'F') <> 'T'
           AND COALESCE(T.BLOQUEARMOT, 'F') <> 'T'
           AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(T.CGCCLI,'-',''),' ',''),'(',''),')',''),'.','') = ?
      `;
      const rCpf = await query(sqlCliCpf, [cpf], pool);
      if (rCpf.length > 0) {
        return { cadastrado: true, precadastro: false, cpf };
      }
      return { cadastrado: false, precadastro: true, cpf };
    }

    return { cadastrado: false, precadastro: false };
  } catch (err) {
    logger.error({ err, fromUser, toBiz }, "verificarStatusTelefone: falha de consulta");
    return { cadastrado: false, precadastro: false };
  }
}

export default { verificarMotoristaPorTelefone, verificarStatusTelefone };
