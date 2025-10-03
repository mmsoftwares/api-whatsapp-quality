// scripts/pingTenant.js
import { one } from "../twilio/src/services/fireBirdService.js";

const cfg = {
  host: "26.213.142.58",
  port: 3050,
  database: "C:\\Siserv\\database_homologacao_api\\DATABASE.GDB",
  user: "SYSDBA",
  password: "masterkey",
  charset: "UTF8",
};

try {
  console.log("CFG:", cfg);
  const row = await one("select 1 as ok from rdb$database", [], cfg);
  console.log("RESULT:", row);
  process.exit(0);
} catch (err) {
  console.error("FAILED:", err);
  process.exit(1);
}
