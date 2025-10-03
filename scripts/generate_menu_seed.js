// @file: gerar_menus.mjs (ou .js com "type":"module" no package.json)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as vm from 'node:vm';

async function main() {
  // === Paths base (EMULANDO __dirname) ===
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const ROOT = path.resolve(__dirname, '..');

  // Imports dinâmicos (ESM) dos módulos do Twilio
  const commandsPath = pathToFileURL(
    path.resolve(ROOT, 'twilio/src/routes/whatsapp/commands.js')
  );
  const formattersPath = pathToFileURL(
    path.resolve(ROOT, 'twilio/src/routes/whatsapp/formatters.js')
  );
  const handlerPath = path.resolve(ROOT, 'twilio/src/routes/whatsapp/handler.js');

  const commands = await import(commandsPath.href);
  const formatters = await import(formattersPath.href);

  const { normalizeCmd, isCmd } = commands;
  const {
    menuText,
    pickOrganizedText,
    parseCorrections,
    applyCorrections,
    cardTextToPrecad,
  } = formatters;

  // Carrega o handler como texto (para extrair mensagens de cada opção)
  const handlerSrc = fs.readFileSync(handlerPath, 'utf8');

  // Extrai mensagens associadas a replyText(...) quando o usuário digita 1..9
  function extractHandlerMessages(src) {
    const map = {};

    // Aceita " e ` como delimitadores e espaços variados antes de replyText(
    for (let n = 1; n <= 9; n++) {
      const re = new RegExp(
        String.raw`if\s*\(\s*rawBody\s*===\s*["\']${n}["\']\s*\)[\s\S]*?replyText\([^,]+,([\s\S]*?)\);`,
        'm'
      );
      const m = src.match(re);
      if (m) {
        try {
          // Avalia expressão de string capturada (suporta template literals)
          map[String(n)] = vm.runInNewContext(m[1]);
        } catch {
          // Se não conseguir avaliar, ignora (vamos usar fallback do menu)
        }
      }
    }
    return map;
  }

  const handlerMsgs = extractHandlerMessages(handlerSrc);

  // Garante que dependências dos formatters são carregadas/executadas
  pickOrganizedText(null);
  parseCorrections('');
  applyCorrections('', {});
  cardTextToPrecad('');
  isCmd('MENU', 'MENU');

  // Constrói lista de opções a partir do texto do menu
  const text = menuText();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error('menuText() retornou vazio.');
  }

  const titulo = lines.shift(); // primeira linha = título
  const options = [];

  for (const line of lines) {
    const m = line.match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const opcao = normalizeCmd(m[1]);
    const texto = handlerMsgs[opcao] || m[2];
    options.push({ opcao, texto });
  }

  if (options.length === 0) {
    throw new Error('Nenhuma opção de menu encontrada.');
  }

  // === Chama o Python correto ===
  const PY_EXE = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const pythonScript = path.resolve(ROOT, 'python', 'utils', 'menu_logic.py');

  const py = spawnSync(PY_EXE, [pythonScript], {
    input: JSON.stringify({ options }),
    encoding: 'utf8',
    cwd: ROOT,
  });

  if (py.status !== 0) {
    console.error('❌ Erro executando script Python:\n', py.stderr || py.stdout);
    process.exit(py.status || 1);
  }

  let out;
  try {
    out = JSON.parse(py.stdout);
  } catch {
    console.error('❌ Saída inválida do Python (não é JSON):\n', py.stdout);
    process.exit(1);
  }

  // === Geração dos SQLs ===
  const menuId = 1;
  const clienteId = 1;

  // Helper para escapar aspas simples
  const esc = (s) => String(s).replace(/'/g, "''");

  // --- Firebird 2.5 (INSERT/DELETE) ---
  const fb25 = ['SET AUTODDL OFF;', 'COMMIT;', 'BEGIN;'];
  fb25.push(`DELETE FROM MENUS WHERE ID IN (${menuId});`);
  fb25.push(
    `INSERT INTO MENUS (ID, CLIENTE_ID, TITULO, ATIVO) VALUES (${menuId}, ${clienteId}, '${esc(
      titulo
    )}', 1);`
  );

  const ids = [];
  for (let i = 0; i < out.options.length; i++) {
    const opt = out.options[i];
    const id = i + 1;
    ids.push(id);
    fb25.push(
      `INSERT INTO MENU_OPCOES (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM) VALUES (${id}, ${menuId}, '${esc(
        opt.chave_pai
      )}', '${esc(opt.opcao)}', '${esc(opt.texto)}', ${
        opt.proxima_chave ? `'${esc(opt.proxima_chave)}'` : 'NULL'
      }, ${opt.ordem});`
    );
  }
  if (ids.length > 0) {
    fb25.splice(3, 0, `DELETE FROM MENU_OPCOES WHERE ID IN (${ids.join(',')});`);
  }
  fb25.push('COMMIT;');

  // --- Firebird 5.0 (MERGE) ---
  const fb50 = ['SET AUTODDL OFF;', 'COMMIT;', 'BEGIN;'];
  fb50.push(
    `MERGE INTO MENUS m
USING (SELECT ${menuId} AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET CLIENTE_ID = ${clienteId}, TITULO = '${esc(titulo)}', ATIVO = 1
WHEN NOT MATCHED THEN INSERT (ID, CLIENTE_ID, TITULO, ATIVO) VALUES (${menuId}, ${clienteId}, '${esc(
      titulo
    )}', 1);`
  );

  for (let i = 0; i < out.options.length; i++) {
    const opt = out.options[i];
    const id = i + 1;
    fb50.push(
      `MERGE INTO MENU_OPCOES m
USING (SELECT ${id} AS ID FROM RDB$DATABASE) src
ON (m.ID = src.ID)
WHEN MATCHED THEN UPDATE SET MENU_ID=${menuId}, CHAVE_PAI='${esc(opt.chave_pai)}', OPCAO='${esc(
        opt.opcao
      )}', TEXTO='${esc(opt.texto)}', PROXIMA_CHAVE=${
        opt.proxima_chave ? `'${esc(opt.proxima_chave)}'` : 'NULL'
      }, ORDEM=${opt.ordem}
WHEN NOT MATCHED THEN INSERT (ID, MENU_ID, CHAVE_PAI, OPCAO, TEXTO, PROXIMA_CHAVE, ORDEM)
VALUES (${id}, ${menuId}, '${esc(opt.chave_pai)}', '${esc(opt.opcao)}', '${esc(opt.texto)}', ${
        opt.proxima_chave ? `'${esc(opt.proxima_chave)}'` : 'NULL'
      }, ${opt.ordem});`
    );
  }
  fb50.push('COMMIT;');

  // Grava arquivos sempre na raiz do projeto
  fs.writeFileSync(path.resolve(ROOT, 'insert_menu_fb25.sql'), fb25.join('\n') + '\n');
  fs.writeFileSync(path.resolve(ROOT, 'insert_menu_fb50.sql'), fb50.join('\n') + '\n');

  console.log(`✅ Menus: 1, Opções: ${out.options.length}`);
  console.log('📝 Gerados: insert_menu_fb25.sql, insert_menu_fb50.sql');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
