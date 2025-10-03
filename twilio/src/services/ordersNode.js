// src/services/ordersNode.js
import { one } from './fireBirdService.js';

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

function fmtMoneyBR(val) {
  if (val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateBR(d) {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dt.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return null;
  }
}

function fmtDateTimeBR(d) {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yyyy = String(dt.getFullYear());
    const HH = String(dt.getHours()).padStart(2, '0');
    const MM = String(dt.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
  } catch {
    return null;
  }
}

export async function getEntrega(numero, cpf, pool) {
  const sql = `
    SELECT FIRST 1
           m.NOMOVTRA                           AS numero,
           m.DATA                               AS m_data,
           m.DATA_HORA                          AS m_data_hora,
           c.NOMCLI                             AS cliente_nome,
           c.CGCCLI                             AS cliente_cnpj,
           mot.NOMCLI                           AS motorista_nome,
           mot.CGCCLI                           AS motorista_doc,
           m.PLACACAR                           AS placa,
           (SELECT SUM(nf.VLRTOTAL)
              FROM TABMOVTRA_NF nf
             WHERE nf.NOMOVTRA = m.NOMOVTRA)    AS valor_total
      FROM TABMOVTRA m
      LEFT JOIN TABCLI c   ON c.NOCLI  = m.NOCLI
      LEFT JOIN TABCLI mot ON mot.NOCLI = m.NOMOT
     WHERE m.NOMOVTRA = ?
  `;

  const row = await one(sql, [numero], pool);
  if (!row) {
    const err = new Error('Entrega não encontrada');
    err.status = 404;
    throw err;
  }

  const prov = onlyDigits(cpf);
  const stored = onlyDigits(row.motorista_doc);
  const isCpf = (s) => s && s.length === 11;
  const isCnpj = (s) => s && s.length === 14;

  let authorized = false;
  if (isCpf(prov) && isCpf(stored) && prov === stored) authorized = true;
  if (isCnpj(prov) && isCnpj(stored) && prov === stored) authorized = true;
  if (isCpf(prov) && isCnpj(stored) && stored.endsWith(prov)) authorized = true;

  if (!authorized) {
    const err = new Error('Motorista não autorizado para esta entrega');
    err.status = 403;
    throw err;
  }

  const entrega = {
    numero: row.numero,
    cliente_nome: row.cliente_nome || null,
    cliente_cnpj: row.cliente_cnpj || null,
    motorista_nome: row.motorista_nome || null,
    placa: row.placa || null,
    valor_total: fmtMoneyBR(row.valor_total),
    data_prevista: fmtDateBR(row.m_data),
    data_entrega: fmtDateTimeBR(row.m_data_hora || row.m_data),
  };
  return { status: 'ok', entrega };
}

export default { getEntrega };

