// scripts/pingTenant.js
import logger from "../twilio/src/utils/logger.js";
import fb from "../twilio/src/services/fireBirdService.js";
import { one } from "../twilio/src/services/fireBirdService.js";
import { fileURLToPath } from "url";

process.on("unhandledRejection", (e) => console.error(e));

async function main() {
  const cfg = {
    host: "26.213.142.58",
    port: 3050,
    database: "C:\\Siserv\\database_homologacao_api\\DATABASE.GDB",
    user: "SYSDBA",
    password: "masterkey",
    charset: "UTF8",
  };

  console.log("CFG:", cfg);

  // attach log já deve existir no fireBirdService; mas força um ping aqui:
  const ok = await fb.ping(cfg);
  console.log("PING:", ok ? "OK" : "FAIL");

  const row = await one("select 1 as ok from rdb$database", [], cfg);
  console.log("QUERY:", row);
}

main().catch((err) => {
  console.error("PING FAILED:", err);
  process.exit(1);
});
