import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers['x-bridge-token']", "token", "payloadBase64"],
});
