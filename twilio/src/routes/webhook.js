// src/routes/webhook.js
import fs from 'fs';
import express from 'express';
import logger from '../utils/logger.js';
import { replyText } from '../services/responder.js';
import { logMasterDbPath } from '../services/masterDb.js';

import {
  getClientByNumber,
  getTenantPool,
  logConversation,
  loadMenu,
  getOptions,
} from '../services/db.js';
import { getEntrega } from '../services/ordersNode.js';
import { inserirOcorrencia, getNomovtraByChave, getMotoristaCpf } from '../services/ocoService.js';
import { getCte } from '../services/cteClient.js';
import {
  sendFileToExtractor,
  sendIdDataToExtractor,
  sendVehicleDataToExtractor,
} from '../services/extractorClient.js';
import { downloadTwilioMedia } from '../services/media.js';
import {
  extractAccessKey,
  validateAccessKey,
  parseAccessKey,
} from '../utils/fiscalKey.js';
import { ensureSupportedMedia } from './whatsapp/media.js';

import {
  pickOrganizedText,
  safeStringify,
  correctionHelp,
  vehicleCorrectionHelp,
  formatIdPreviewCard,
  formatVehiclePreviewCard,
  parseCorrections,
  parseVehicleCorrections,
  applyCorrections,
  cardTextToPrecad,
  cardTextToVehicle,
} from './whatsapp/formatters.js';

import { verificarMotoristaPorTelefone, verificarStatusTelefone } from '../services/authService.js';
import { STATES } from '../state/sessionStore.js';   // 🔑 estados centralizados

const router = express.Router();
const sessions = new Map();

const norm = (t) => (t || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim();
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const isOnlyDigits = (s) => /^\d+$/.test(String(s || '').trim());
const isAskState   = (st) => st && Object.values(STATES).includes(st);

// prompts
const ASK_PROMPT = {
  [STATES.AWAIT_ENTREGA]: '🧾 Informe o *número da entrega* (apenas números).',
  [STATES.AWAIT_OCO]: 'Para qual pedido deseja fazer a ocorrência? Digite o número do pedido',
  [STATES.AWAIT_OCO_MOTIVO]: 'Qual o motivo da ocorrência? (digite um texto curto).',
  [STATES.AWAIT_CTE_MEDIA]:
    '📦 *Baixa de entrega*\nEnvie a *imagem* ou *PDF* do CT-e, ou cole a *chave de 44 dígitos* do CT-e.\nPara retornar ao menu, digite *menu*.',
  [STATES.AWAIT_ID_MEDIA]:
    '🪪 *Cadastro de motorista*\nEnvie a foto da *frente* e/ou *verso* da identidade/CNH. Quando terminar, digite *menu*.',
  [STATES.AWAIT_VEHICLE_MEDIA]:
    '🚚 *Cadastro de veículo*\nEnvie a foto ou PDF do *documento do veículo*. Quando terminar, digite *menu*.',
  [STATES.AWAIT_BAIXA_CONFIRMA]:
    '❓ Deseja confirmar a baixa? Responda *sim* para confirmar ou *não* para cancelar.',
};

function renderMenu(title, opts) {
  const lines = [];
  const t = (title || '').trim();
  lines.push(t ? `📋 ${t}` : '📋 Escolha uma opção digitando o número:');
  for (const o of opts) {
    const k = o?.CHAVE ?? o?.chave ?? o?.opcao;
    const txt = o?.TEXTO ?? o?.texto;
    if (k && txt) lines.push(`${k} - ${txt}`);
  }
  lines.push('');
  lines.push(`⚠️ Para retornar ao menu digite 'menu'`);
  return lines.join('\n');
}

function renderFallbackMenu() {
  return [
    '⚠️ Número não cadastrado.',
    '1 - Cadastrar motorista',
    '2 - Cadastrar veículo',
    '0 - Falar com suporte',
  ].join('\n');
}

async function replyAndLog({ to, from, body, sess, userText, mediaUrl }) {
  // se não veio texto, mas veio mídia
  const safeBody = body && body.trim()
    ? body
    : (mediaUrl ? '[arquivo recebido]' : '[sem conteúdo]');
  const safeUserText = userText && userText.trim()
    ? userText
    : (mediaUrl ? '[arquivo recebido]' : '[sem texto]');

  await replyText({ to, from, body: safeBody });

  try {
    if (sess?.pool && sess?.clienteId) {
      await logConversation(
        sess.pool,
        sess.clienteId,
        to,
        safeUserText,
        safeBody,
        mediaUrl || null      // novo parâmetro
      );
    }
  } catch (err) {
    logger.error({ err, safeUserText, safeBody, mediaUrl }, 'falha ao registrar conversas');
  }
}


async function processAskInput({ state, text, from, toBiz, sess, payload }) {
  const t = String(text || '').trim();

  function formatEntregaCard(e, numeroDigitado) {
    const n = e?.numero || numeroDigitado || "-";
    const linhas = [
      `📦 *Entrega ${n}*`,
      e?.motorista_nome ? `🧑‍✈️ Motorista: ${e.motorista_nome}` : null,
      e?.placa ? `🚚 Placa: ${e.placa}` : null,
      e?.valor_total ? `💰 Valor: ${e.valor_total}` : null,
      e?.data_prevista ? `📅 Prev. Coleta: ${e.data_prevista}` : null,
      e?.data_entrega ? `📅 Prev. Entrega: ${e.data_entrega}` : null,
    ].filter(Boolean);
    return linhas.join("\n");
  }

  switch (state) {
    case STATES.AWAIT_OCO: {
      const entregaNum = onlyDigits(t);
      if (!entregaNum) {
        await replyAndLog({ to: from, from: toBiz, body: '❗ Digite apenas números (ex.: 12345).', sess, userText: text });
        return;
      }
      sess.ctx.nomovtra = Number(entregaNum);
      sess.state = STATES.AWAIT_OCO_MOTIVO;
      await replyAndLog({ to: from, from: toBiz, body: ASK_PROMPT[sess.state], sess, userText: text });
      return;
    }

    case STATES.AWAIT_ENTREGA: {
      const entregaNum = onlyDigits(t);
      if (!entregaNum) {
        await replyAndLog({ to: from, from: toBiz, body: '❗ Digite apenas números (ex.: 12345).', sess, userText: text });
        return;
      }
      try {
        const cpf = sess?.ctx?.cpf;
        if (!toBiz) {
          await replyAndLog({ to: from, from: toBiz, body: '⚠️ Não consegui identificar o atendente. Tente novamente.', sess, userText: text });
          return;
        }
        const resp = await getEntrega(entregaNum, cpf, toBiz);
        const msg = formatEntregaCard(resp.entrega, entregaNum);
        sess.state = 'root'; // reseta ANTES da resposta
        await replyAndLog({ to: from, from: toBiz, body: msg, sess, userText: text });
      } catch (err) {
        const status = err?.response?.status;
        if (status === 403) {
          await replyAndLog({ to: from, from: toBiz, body: '❌ Você não é o motorista responsável por esta entrega.', sess, userText: text });
        } else if (status === 404) {
          await replyAndLog({ to: from, from: toBiz, body: `❌ Entrega ${entregaNum} não encontrada para este CPF/CNPJ.`, sess, userText: text });
        } else {
          logger.error({ err: err?.message || err }, 'falha getEntrega');
          await replyAndLog({ to: from, from: toBiz, body: `⚠️ Erro ao consultar entrega: ${err?.message || 'desconhecido'}`, sess, userText: text });
        }
      }
      return;
    }

    case STATES.AWAIT_OCO_MOTIVO: {
      if (!t) {
        await replyAndLog({ to: from, from: toBiz, body: '❗ Informe o motivo da ocorrência (texto obrigatório).', sess, userText: text });
        return;
      }
      try {
        const nomovtra = sess?.ctx?.nomovtra;
        const usuario = sess?.ctx?.cpf || 'BOT';
        if (!nomovtra) throw new Error('NOMOVTRA ausente no contexto');
        // Valida existência da entrega antes de inserir ocorrência
        try {
          const cpfMot = await getMotoristaCpf(nomovtra, sess.pool);
          if (!cpfMot) {
            await replyAndLog({ to: from, from: toBiz, body: `❌ Entrega ${nomovtra} não encontrada ou sem motorista vinculada.`, sess, userText: text });
            sess.state = 'root';
            return;
          }
        } catch (e) {
          // Se a validação falhar por erro de DB, segue para o handler principal que já reporta erro
        }
        // Grava ocorrência diretamente no banco do cliente (Node), sem Python
        await inserirOcorrencia(nomovtra, t, usuario, sess.pool);
        sess.state = 'root'; // reseta ANTES da resposta
        await replyAndLog({ to: from, from: toBiz, body: '✅ Ocorrência registrada com sucesso.', sess, userText: text });
      } catch (err) {
        logger.error({ err: err?.message || err }, 'falha registrar ocorrência (Node)');
        await replyAndLog({ to: from, from: toBiz, body: `⚠️ Falha ao registrar ocorrência: ${err?.message || 'erro desconhecido'}`, sess, userText: text });
      }
      return;
    }

    case STATES.AWAIT_ID_MEDIA: {
      const cmd = norm(t).toUpperCase();
      const numMedia = Number(payload?.NumMedia || payload?.numMedia || 0);

      if (cmd === 'CAMPOS') {
        await replyAndLog({ to: from, from: toBiz, body: correctionHelp(), sess, userText: text });
        return;
      }

      if (cmd.startsWith('CORRIGIR')) {
        const current = sess.ctx.idText || '';
        if (!current) {
          await replyAndLog({ to: from, from: toBiz, body: '❗ Ainda não há cartão para corrigir. Envie a foto da CNH primeiro.', sess, userText: text });
          return;
        }
        const patches = parseCorrections(t);
        if (!patches || Object.keys(patches).length === 0) {
          await replyAndLog({ to: from, from: toBiz, body: correctionHelp(), sess, userText: text });
          return;
        }
        const patched = applyCorrections(current, patches);
        sess.ctx.idText = patched;
        await replyAndLog({ to: from, from: toBiz, body: '✅ Correções aplicadas.\n\n' + formatIdPreviewCard(patched), sess, userText: text });
        return;
      }

      if (cmd === 'CONFIRMAR') {
        const { idText, idPaths } = sess.ctx;
        if (!idText) {
          await replyAndLog({ to: from, from: toBiz, body: '❗ Ainda não recebi nenhuma imagem. Envie a foto da identidade/CNH primeiro.', sess, userText: text });
          return;
        }
        const dados = cardTextToPrecad(idText);
        const telefone = onlyDigits(from).replace(/^55/, '');
        if (telefone) dados.TELEFONE = telefone;
        try {
          await sendIdDataToExtractor(dados, idPaths?.[0], toBiz);
          sess.state = 'root';
          await replyAndLog({ to: from, from: toBiz, body: '✅ Cadastro concluído com sucesso.', sess, userText: text });
        } catch (e) {
          logger.error({ err: e?.message || e }, 'falha ao salvar pré-cadastro');
          const detalhe = e?.response?.data?.detail || e?.message;
          await replyAndLog({ to: from, from: toBiz, body: `⚠️ ${detalhe || 'Erro ao salvar cadastro.'}`, sess, userText: text });
        }
        return;
      }

      if (numMedia > 0) {
        let accText = sess.ctx.idText || '';
        let paths = Array.isArray(sess.ctx.idPaths) ? sess.ctx.idPaths.slice() : [];
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = payload[`MediaUrl${i}`];
          const contentType = payload[`MediaContentType${i}`];
          try {
            await ensureSupportedMedia(from, contentType, 'identidade/CNH');
            const { path, filename } = await downloadTwilioMedia(mediaUrl);
            logger.info({ path, size: fs.statSync(path).size }, 'Mídia salva com sucesso');

            let data;
            try {
              data = await sendFileToExtractor(path, contentType, filename, 'pessoa');
              logger.info({ preview: safeStringify(data).slice(0,300) }, 'Resposta do extrator');
            } catch (e) {
              logger.error({ err: e?.message, stack: e?.stack }, 'Falha no extractor');
              throw e;
            }

            logger.info({ from, filename, preview: safeStringify(data).slice(0, 400) }, '🧾 Preview data do extrator');
            const txt = pickOrganizedText(data?.dados) || pickOrganizedText(data);


            if (txt) accText = accText ? `${accText}\n────────\n${txt}` : txt;
            if (data?.temp_path) paths.push(data.temp_path);
          } catch (e) {
            logger.error({ err: e?.message || e, mediaUrl, contentType }, 'Erro ao processar mídia de identidade');
            await replyAndLog({ to: from, from: toBiz, body: '⚠️ Não consegui processar este arquivo. Verifique nitidez/iluminação ou envie em PDF.', sess, userText: text });
          }
        }

        sess.ctx.idText = accText;
        sess.ctx.idPaths = paths;
        if (!accText) {
          await replyAndLog({ to: from, from: toBiz, body: '⚠️ Não consegui extrair os dados. Tente novamente com foto de frente, bem enquadrada, em boa iluminação. Se preferir, envie em PDF.', sess, userText: text });
        } else {
          await replyAndLog({ to: from, from: toBiz, body: formatIdPreviewCard(accText), sess, userText: text });
        }
        return;
      }

      await replyAndLog({ to: from, from: toBiz, body: '📸 Envie a foto (frente/verso) da identidade/CNH. Quando terminar, digite *CONFIRMAR*.', sess, userText: text });
      return;
    }

    case STATES.AWAIT_VEHICLE_MEDIA: {
      const cmd = norm(t).toUpperCase();
      const numMedia = Number(payload?.NumMedia || payload?.numMedia || 0);

      if (cmd === 'CAMPOS') {
        await replyAndLog({ to: from, from: toBiz, body: vehicleCorrectionHelp(), sess, userText: text });
        return;
      }

      if (cmd.startsWith('CORRIGIR')) {
        const current = sess.ctx.vehicleText || '';
        if (!current) {
          await replyAndLog({ to: from, from: toBiz, body: '❗ Ainda não há cartão para corrigir. Envie o documento do veículo primeiro.', sess, userText: text });
          return;
        }
        const patches = parseVehicleCorrections(t);
        if (!patches || Object.keys(patches).length === 0) {
          await replyAndLog({ to: from, from: toBiz, body: vehicleCorrectionHelp(), sess, userText: text });
          return;
        }
        const patched = applyCorrections(current, patches);
        sess.ctx.vehicleText = patched;
        await replyAndLog({ to: from, from: toBiz, body: '✅ Correções aplicadas.\n\n' + formatVehiclePreviewCard(patched), sess, userText: text });
        return;
      }

      if (cmd === 'CONFIRMAR') {
        const { vehicleText, vehiclePaths } = sess.ctx;
        if (!vehicleText) {
          await replyAndLog({ to: from, from: toBiz, body: '❗ Ainda não recebi nenhuma imagem. Envie o documento do veículo primeiro.', sess, userText: text });
          return;
        }
        const dados = cardTextToVehicle(vehicleText);
        try {
          await sendVehicleDataToExtractor(dados, vehiclePaths?.[0], toBiz);
          sess.state = 'root';
          await replyAndLog({ to: from, from: toBiz, body: '✅ Cadastro concluído com sucesso.', sess, userText: text });
        } catch (e) {
          logger.error({ err: e?.message || e }, 'falha ao salvar cadastro de veículo');
          const detalhe = e?.response?.data?.detail || e?.message;
          await replyAndLog({ to: from, from: toBiz, body: `⚠️ ${detalhe || 'Erro ao salvar cadastro de veículo.'}`, sess, userText: text });
        }
        return;
      }

      if (numMedia > 0) {
        let accText = sess.ctx.vehicleText || '';
        let paths = Array.isArray(sess.ctx.vehiclePaths) ? sess.ctx.vehiclePaths.slice() : [];
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = payload[`MediaUrl${i}`];
          const contentType = payload[`MediaContentType${i}`];
          try {
            await ensureSupportedMedia(from, contentType, 'documento do veículo');
            const { path, filename } = await downloadTwilioMedia(mediaUrl);

          let data;
          try {
            data = await sendFileToExtractor(path, contentType, filename, 'veiculo');
            logger.info({ preview: safeStringify(data).slice(0,300) }, 'Resposta do extrator');
          } catch (e) {
            logger.error({ err: e?.message, stack: e?.stack }, 'Falha no extractor (veiculo)');
            throw e;
          }

          logger.info({ from, filename, preview: safeStringify(data).slice(0, 400) }, '🧾 Preview data do extrator');
          const txt = pickOrganizedText(data?.dados) || pickOrganizedText(data);

            if (txt) accText = accText ? `${accText}\n────────\n${txt}` : txt;
            if (data?.temp_path) paths.push(data.temp_path);
          } catch (e) {
            logger.error({ err: e?.message || e, mediaUrl, contentType }, 'Erro ao processar mídia de veículo');
            await replyAndLog({ to: from, from: toBiz, body: '⚠️ Não consegui processar este arquivo. Verifique nitidez/iluminação ou envie em PDF.', sess, userText: text });
          }
        }

        sess.ctx.vehicleText = accText;
        sess.ctx.vehiclePaths = paths;
        if (!accText) {
          await replyAndLog({ to: from, from: toBiz, body: '⚠️ Não consegui extrair os dados. Tente novamente com imagem legível ou envie em PDF.', sess, userText: text });
        } else {
          await replyAndLog({ to: from, from: toBiz, body: formatVehiclePreviewCard(accText), sess, userText: text });
        }
        return;
      }

      await replyAndLog({ to: from, from: toBiz, body: '📄 Envie a foto ou PDF do documento do veículo. Quando terminar, digite *CONFIRMAR*.', sess, userText: text });
      return;
    }

    case STATES.AWAIT_CTE_MEDIA: {
      const numMedia = Number(payload?.NumMedia || payload?.numMedia || 0);
      let chave = null;

      if (numMedia > 0) {
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = payload[`MediaUrl${i}`];
          const contentType = payload[`MediaContentType${i}`];
          try {
            await ensureSupportedMedia(from, contentType, 'documento do CT-e');
            const { path, filename } = await downloadTwilioMedia(mediaUrl);

            let data;
            try {
              data = await sendFileToExtractor(path, contentType, filename, 'cte');
              logger.info({ preview: safeStringify(data).slice(0,300) }, 'Resposta do extrator');
            } catch (e) {
              logger.error({ err: e?.message, stack: e?.stack }, 'Falha no extractor (CT-e)');
              throw e;
            }

            const found = data.chave || extractAccessKey(data?.dados?.text);

            if (found) { chave = found; break; }
          } catch (e) {
            logger.error({ err: e?.message || e, mediaUrl, contentType }, 'Erro ao processar mídia de CT-e');
          }
        }
      } else if (t) {
        const found = extractAccessKey(t);
        if (found) chave = found;
      }

      if (!chave) {
        await replyAndLog({ to: from, from: toBiz, body: '⚠️ Não consegui extrair a *chave de 44 dígitos* do CT-e. Envie novamente.', sess, userText: text });
        return;
      }

      if (!validateAccessKey(chave)) {
        await replyAndLog({ to: from, from: toBiz, body: '❌ Chave inválida (DV incorreto).', sess, userText: text });
        return;
      }


      const parsed = parseAccessKey(chave);
      if (parsed?.mod !== '57') {
        await replyAndLog({ to: from, from: toBiz, body: '❗ Esta chave não é de CT-e.', sess, userText: text });
        return;
      }

      try {
        const nomovtra = await getNomovtraByChave(chave, sess.pool);
        if (!nomovtra) {
          await replyAndLog({ to: from, from: toBiz, body: '❌ CT-e não encontrado ou sem pedido vinculado.', sess, userText: text });
          return;
        }
        const cpf = sess?.ctx?.cpf;
        const resp = await getEntrega(nomovtra, cpf, toBiz);
        const msg =
          formatEntregaCard(resp.entrega, nomovtra) +
          '\n\nDeseja dar baixa nesta entrega? Responda *sim* ou *não*.';
        sess.ctx.nomovtra = nomovtra;
        sess.state = STATES.AWAIT_BAIXA_CONFIRMA;
        await replyAndLog({ to: from, from: toBiz, body: msg, sess, userText: text });
      } catch (err) {
        const status = err?.response?.status;
        if (status === 403) {
          await replyAndLog({ to: from, from: toBiz, body: '❌ Você não é o motorista responsável por esta entrega.', sess, userText: text });
        } else if (status === 404) {
          await replyAndLog({ to: from, from: toBiz, body: '❌ Entrega não encontrada para esta chave.', sess, userText: text });
        } else {
          logger.error({ err: err?.message || err }, 'falha ao processar CT-e');
          await replyAndLog({ to: from, from: toBiz, body: `⚠️ Erro ao consultar CT-e: ${err?.message || 'desconhecido'}`, sess, userText: text });
        }
      }
      return;
    }

    case STATES.AWAIT_BAIXA_CONFIRMA: {
      const low = t.toLowerCase();
      if (low === 'sim' || low === 's') {
        sess.state = 'root';
        await replyAndLog({ to: from, from: toBiz, body: '✅ Baixa registrada com sucesso.', sess, userText: text });
      } else {
        sess.state = 'root';
        await replyAndLog({ to: from, from: toBiz, body: 'Operação cancelada.', sess, userText: text });
      }
      return;
    }

    default:
      await replyAndLog({ to: from, from: toBiz, body: ASK_PROMPT[state] || 'Envie as informações solicitadas corretamente.', sess, userText: text });
      return;
  }
}

router.post('/', express.urlencoded({ extended: false }), async (req, res) => {
  if (!res.headersSent) res.sendStatus(204);

  const from    = req.body?.From || req.body?.from;
  const toBiz   = (req.body?.To || req.body?.to || '').replace(/^whatsapp:/i, '');
  const rawBody = req.body?.Body || req.body?.body || '';
  const body    = norm(rawBody);

  try {
    // Removido: leitura de MON$DATABASE no MASTER para evitar conexões desnecessárias

    if (!from || !toBiz) return;

    let s = sessions.get(from);
    if (!s) { s = { state: 'root', ctx: {}, bot: toBiz }; sessions.set(from, s); }
    else if (!s.bot) s.bot = toBiz;

    if (!s.clienteId) {
      const client = await getClientByNumber(toBiz);
      logger.info({ toBiz, clienteId: client?.id }, 'map To -> cliente');
      if (!client) {
        await replyAndLog({ to: from, from: toBiz, body: '⚠️ Número do atendente não configurado. Contate o suporte.', sess: s, userText: rawBody });
        return;
      }
      s.clienteId = client.id;
      s.pool = getTenantPool(client);
    }
    if (!s.pool) {
      const client = await getClientByNumber(toBiz);
      logger.info({ toBiz, clienteId: client?.id }, 'map To -> cliente (refresh pool)');
      if (!client) {
        await replyAndLog({ to: from, from: toBiz, body: 'Numero do atendente nao configurado. Contate o suporte.', sess: s, userText: rawBody });
        return;
      }
      s.clienteId = client.id;
      s.pool = getTenantPool(client);
    }

    if (!s.menuId) {
      const menu = await loadMenu(s.clienteId, s.pool);
      if (!menu) {
        await replyAndLog({ to: from, from: toBiz, body: '⚠️ Menu não configurado para este cliente. Cadastre MENUS e MENU_OPCOES.', sess: s, userText: rawBody });
        return;
      }
      s.menuId = menu.id;
      s.titulo = menu.titulo;
      s.state  = 'root';
    }

    const low = body.toLowerCase();
    {
      // Verificação de cadastro com refresh defensivo do cliente/pool em caso de falha
      let st = await verificarStatusTelefone(from, toBiz).catch((err) => {
        logger.error({ err: err?.message || err }, 'statusTelefone: erro primário');
        return { cadastrado: false, precadastro: false, _err: true };
      });
      if (!st.cadastrado && s.pool) {
        // Se falhou, tentar um refresh único do client/pool e revalidar
        try {
          const client2 = await getClientByNumber(toBiz);
          if (client2?.id) {
            s.clienteId = client2.id;
            s.pool = getTenantPool(client2);
            st = await verificarStatusTelefone(from, toBiz).catch((err) => {
              logger.error({ err: err?.message || err }, 'statusTelefone: erro após refresh');
              return { cadastrado: false, precadastro: false, _err: true };
            });
          }
        } catch (e) {
          logger.error({ err: e?.message || e }, 'refresh cliente/pool falhou');
        }
      }
            // Nova regra: apenas bloqueia quando estiver em pre-cadastro.
      if (st.precadastro) {
        s.ctx = { ...(s.ctx || {}), cpf: undefined };
        await replyAndLog({ to: from, from: toBiz, body: 'Esse numero de telefone esta em pre-cadastro, aguarde aprovacao', sess: s, userText: rawBody });
        return;
      }
      if (st.cpf) {
        s.ctx = { ...(s.ctx || {}), cpf: onlyDigits(st.cpf) };
      }
      // Se usuário não está cadastrado nem em pré-cadastro, exibe menu de fallback
      if (!st.cadastrado && !st.precadastro) {
        s.ctx = { ...(s.ctx || {}), cpf: undefined };
        if (['menu', 'inicio', 'start'].includes(low)) {
          s.state = 'root';
          await replyAndLog({ to: from, from: toBiz, body: renderFallbackMenu(), sess: s, userText: rawBody });
          return;
        }
        // Permite fluxos de cadastro (1 e 2) e processamento de mídia nesses estados
        if (s.state === STATES.AWAIT_ID_MEDIA || s.state === STATES.AWAIT_VEHICLE_MEDIA) {
          await processAskInput({ state: s.state, text: rawBody, from, toBiz, sess: s, payload: req.body });
          return;
        }
        if (body === '1') {
          s.state = STATES.AWAIT_ID_MEDIA;
          await replyAndLog({ to: from, from: toBiz, body: ASK_PROMPT[STATES.AWAIT_ID_MEDIA], sess: s, userText: rawBody });
          return;
        }
        if (body === '2') {
          s.state = STATES.AWAIT_VEHICLE_MEDIA;
          await replyAndLog({ to: from, from: toBiz, body: ASK_PROMPT[STATES.AWAIT_VEHICLE_MEDIA], sess: s, userText: rawBody });
          return;
        }
        if (body === '0') {
          s.state = 'root';
          await replyAndLog({ to: from, from: toBiz, body: 'Entre em contato com esse número para ter suporte : 47996077564', sess: s, userText: rawBody });
          return;
        }
        await replyAndLog({ to: from, from: toBiz, body: renderFallbackMenu(), sess: s, userText: rawBody });
        return;
      }
    }

    if (low === 'menu' || low === 'inicio' || low === 'start') s.state = 'root';

    if (isAskState(s.state)) {
      await processAskInput({ state: s.state, text: rawBody, from, toBiz, sess: s, payload: req.body });
      return; // 🔥 agora não repete mais pergunta aqui
    }

    const current = s.state || 'root';
    const opts = await getOptions(s.pool, s.menuId, current);

    if (opts.length > 0 && isOnlyDigits(body)) {
      const chosen = opts.find(o => String(o.CHAVE ?? o.chave ?? o.opcao) === String(body));
      if (chosen) {
        const next = (chosen.PROXIMA_CHAVE || chosen.proxima_chave || '').trim();
        if (next) {
          s.state = next;
          const nextOpts = await getOptions(s.pool, s.menuId, s.state);
          if (nextOpts.length > 0) {
            await replyAndLog({ to: from, from: toBiz, body: renderMenu(s.titulo, nextOpts), sess: s, userText: rawBody });
            return;
          }
          if (isAskState(s.state)) {
            await replyAndLog({ to: from, from: toBiz, body: ASK_PROMPT[s.state], sess: s, userText: rawBody });
            return;
          }
          await replyAndLog({ to: from, from: toBiz, body: 'Ok! Envie as informações solicitadas.', sess: s, userText: rawBody });
          return;
        }
      }
    }

    if (opts.length === 0) {
      if (isAskState(current)) {
        await replyAndLog({ to: from, from: toBiz, body: ASK_PROMPT[current], sess: s, userText: rawBody });
        return;
      }
      await replyAndLog({
        to: from, from: toBiz,
        body: `⚠️ Não há opções configuradas para a tela '${current}'. Cadastre MENU_OPCOES (MENU_ID=${s.menuId}, CHAVE_PAI='${current}').`,
        sess: s,
        userText: rawBody,
      });
      return;
    }

    await replyAndLog({ to: from, from: toBiz, body: renderMenu(s.titulo, opts), sess: s, userText: rawBody });
  } catch (err) {
    logger.error({ err: err?.message || err, stack: err?.stack }, 'Webhook exception');
    try {
      if (from && toBiz) {
        await replyAndLog({ to: from, from: toBiz, body: `⚠️ Erro interno no servidor: ${err?.message || 'desconhecido'}`, sess: s, userText: rawBody });
      }
    } catch {}
  }
});

export default router;




