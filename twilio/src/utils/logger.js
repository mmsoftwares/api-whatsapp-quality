// ESM — pino simples com ISO timestamp
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: null,
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});

export default logger;
