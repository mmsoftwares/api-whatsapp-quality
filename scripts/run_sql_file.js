#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Firebird from "node-firebird";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** === Parse simples de argumentos CLI (--chave=valor) === */
function arg(key, def = undefined) {
  const hit = process.argv.find(a => a.startsWith(`--${key}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}
function hasFlag(key) {
  return process.argv.some(a => a === `--${key}` || a.startsWith(`--${key}=`));
}

/** === Config Firebird vindo 100% da CLI (sem .env) === */
const fbConfig = {
  host: arg("host", "127.0.0.1"),
  port: parseInt(arg("port", "3050"), 10),
  database:
    arg("db") || arg("database") || (() => {
      console.error('❌ Parâmetro obrigatório ausente: --db="C:\\caminho\\base.fdb"');
      process.exit(1);
    })(),
  user: arg("user", "SYSDBA"),
  password: arg("password", "masterkey"),
  role: arg("role") || null,
  pageSize: 8192,
  charset: arg("charset", "WIN1252"), // ou UTF8 conforme sua base
  clientlib: arg("clientlib") || undefined,
  lowercase_keys: true,
};

/** === Escolha do arquivo SQL (ou SQL inline) === */
const fbFlavor = arg("fb");       // "25" ou "50" (opcional)
const sqlInline = arg("sql");     // SQL direto via CLI
const fileArg   = arg("file");    // caminho do .sql

const ROOT = path.resolve(__dirname);
const default25 = path.join(ROOT, "insert_menu_fb25.sql");
const default50 = path.join(ROOT, "insert_menu_fb50.sql");

const sqlFile = sqlInline
  ? null
  : (fileArg
      ? path.resolve(fileArg)
      : fbFlavor === "50" ? default50
      : fbFlavor === "25" ? default25
      : (fs.existsSync(default50) ? default50 : default25));

/** === Driver promisificado === */
function attachAsync(opts) {
  return new Promise((resolve, reject) => {
    Firebird.attach(opts, (err, db) => (err ? reject(err) : resolve(db)));
  });
}
function queryAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}
function detachAsync(db) {
  return new Promise((resolve, reject) => {
    db.detach(err => (err ? reject(err) : resolve()));
  });
}

/** === Split SQL ciente de PSQL (EXECUTE BLOCK / TRIGGER / PROCEDURE / FUNCTION) === */
function splitSql(sql) {
  const stmts = [];
  let cur = "";

  let inSingle = false;       // '
  let inDouble = false;       // "
  let inLineComment = false;  // --
  let inBlockComment = false; // /* ... */

  // Estado PSQL
  let psqlMode = false;       // estamos dentro de um statement PSQL (com cabeçalho)
  let pdepth = 0;             // profundidade de BEGIN..END dentro do PSQL
  let lastWord = "";          // última palavra vista (fora de strings/coment.)
  let word = "";              // acumulador da palavra corrente

  const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch);

  function pushStatement() {
    const trimmed = cur.trim();
    if (trimmed) stmts.push(trimmed + (trimmed.endsWith(";") ? "" : ";"));
    cur = "";
  }

  function flushWord() {
    if (!word) return;
    const W = word.toUpperCase();

    if (!inSingle && !inDouble && !inLineComment && !inBlockComment) {
      // Detecta início de PSQL antes do primeiro BEGIN:
      // EXECUTE BLOCK
      if (!psqlMode && lastWord === "EXECUTE" && W === "BLOCK") {
        psqlMode = true;
        pdepth = 0; // ainda estamos no cabeçalho, sem BEGIN
      }
      // CREATE/ALTER/RECREATE {TRIGGER|PROCEDURE|FUNCTION}
      if (
        !psqlMode &&
        ((lastWord === "CREATE" || lastWord === "ALTER" || lastWord === "RECREATE") &&
          (W === "TRIGGER" || W === "PROCEDURE" || W === "FUNCTION"))
      ) {
        psqlMode = true;
        pdepth = 0; // cabeçalho PSQL até encontrar o primeiro BEGIN
      }

      // Controle de blocos internos
      if (W === "BEGIN") {
        if (psqlMode) pdepth++;
      } else if (W === "END") {
        if (psqlMode && pdepth > 0) pdepth--;
      }
    }
    lastWord = W;
    word = "";
  }

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const n = sql[i + 1];

    // Comentário de linha
    if (inLineComment) {
      cur += c;
      if (c === "\n") inLineComment = false;
      continue;
    }

    // Comentário de bloco
    if (inBlockComment) {
      cur += c;
      if (c === "*" && n === "/") { cur += "/"; i++; inBlockComment = false; }
      continue;
    }

    // Início de comentário (fora de strings)
    if (!inSingle && !inDouble) {
      if (c === "-" && n === "-") { cur += c; inLineComment = true; continue; }
      if (c === "/" && n === "*") { cur += "/*"; i++; inBlockComment = true; continue; }
    }

    // Strings
    if (!inDouble && c === "'" && sql[i - 1] !== "\\") { inSingle = !inSingle; cur += c; continue; }
    if (!inSingle && c === '"' && sql[i - 1] !== "\\") { inDouble = !inDouble; cur += c; continue; }

    // Tokenização (fora de strings/coment.)
    if (!inSingle && !inDouble && !inLineComment && !inBlockComment) {
      if (isWord(c)) {
        word += c;
      } else {
        flushWord();
      }

      // Fechamento no ';'
      if (c === ";") {
        // Se estamos em PSQL, só encerramos quando o ';' vier após o END final
        if (psqlMode) {
          if (pdepth === 0 && lastWord === "END") {
            cur += c;     // inclui o ';'
            pushStatement();
            psqlMode = false;
            lastWord = "";
            continue;
          }
          // dentro do cabeçalho PSQL ou de blocos (pdepth>0), não quebrar
        } else {
          // statement SQL simples
          cur += c;
          pushStatement();
          lastWord = "";
          continue;
        }
      }
    }

    cur += c;
  }
  flushWord();
  const last = cur.trim();
  if (last) stmts.push(last + (last.endsWith(";") ? "" : ";"));
  return stmts;
}

/** Ignora comandos ISQL e transacionais */
function shouldSkip(stmt) {
  const s = stmt.trim().replace(/;$/, "").toUpperCase();
  return (
    s.startsWith("SET AUTODDL") ||
    s.startsWith("SET TERM") ||
    s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK"
  );
}

/** === Utilitários DB === */
async function getDatabasePath(db) {
  try {
    const rows = await queryAsync(db, "SELECT MON$DATABASE_NAME AS db FROM MON$DATABASE");
    const r = rows && rows[0];
    return (r && (r.db || r["mon$database_name"])) || "(indisponível)";
  } catch {
    return "(indisponível)";
  }
}
async function tableExists(db, name) {
  const rows = await queryAsync(
    db,
    "SELECT 1 FROM RDB$RELATIONS WHERE TRIM(UPPER(RDB$RELATION_NAME)) = ?",
    [String(name).trim().toUpperCase()]
  );
  return rows.length > 0;
}
async function assertTablesExist(db, tables) {
  const missing = [];
  for (const t of tables) if (!(await tableExists(db, t))) missing.push(t);
  if (missing.length) {
    const dbPath = await getDatabasePath(db);
    console.error("❌ Tabelas não encontradas:", missing.join(", "));
    console.error("📍 Banco conectado (MON$DATABASE):", dbPath);
    console.error("👉 Verifique se os parâmetros --db/--host/--port apontam para a base correta.");
    process.exit(1);
  }
}

/** === Exec principal === */
(async () => {
  let db;
  try {
    db = await attachAsync(fbConfig);
  } catch (err) {
    console.error("❌ Falha ao conectar no Firebird.");
    console.error("   Dica: garanta fbclient.dll (FIREBIRD_CLIENTLIB), host/porta, credenciais e charset.");
    console.error("Erro:", err?.message || err);
    process.exit(1);
  }

  try {
    const dbPath = await getDatabasePath(db);
    console.log("📍 Banco conectado (MON$DATABASE):", dbPath);

    let rawSql = "";
    if (sqlInline) {
      rawSql = sqlInline.trim();
      console.log("🔗 Executando SQL inline...");
    } else {
      if (!sqlFile || !fs.existsSync(sqlFile)) {
        console.error('❌ SQL não encontrado. Forneça --file="caminho.sql" ou --sql="...".');
        process.exit(1);
      }
      rawSql = fs.readFileSync(sqlFile, "utf8");
      console.log(`🔗 Executando arquivo: ${path.basename(sqlFile)}`);
    }

    const statements = splitSql(rawSql)
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !shouldSkip(s));

    console.log(`🧾 ${statements.length} statements (SET/BEGIN/COMMIT/SET TERM filtrados)...`);

    if (!hasFlag("skip-checks")) {
      // deixe comentado se for rodar em bases ainda sem todas as tabelas
      // await assertTablesExist(db, ["MENUS", "MENU_OPCOES"]);
    } else {
      console.log("⏭️  Checagem de tabelas MENUS/MENU_OPCOES ignorada (--skip-checks).");
    }

    let ok = 0;
    for (const stmt of statements) {
      try {
        await queryAsync(db, stmt);
        ok++;
      } catch (err) {
        console.error("\n❌ Falha ao executar:\n", stmt);
        console.error("Erro:", err?.message || err);
        process.exit(1);
      }
    }

    console.log(`✅ Concluído. ${ok}/${statements.length} statements executados com sucesso.`);
  } finally {
    try { await detachAsync(db); } catch {}
  }
})().catch(e => {
  console.error("❌ Erro inesperado:", e);
  process.exit(1);
});
