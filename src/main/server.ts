import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import http from "node:http";
import { ZodError } from "zod";
import {
  PairRequest,
  PrintRequest,
  TestPrintRequest,
  type HealthResponse,
  type LoadedPrinter,
} from "../shared/protocol";
import { ErrorCode } from "../shared/error-codes";
import type { PairingRecord } from "./store";
import type { PrintResult } from "./dispatcher/pdf";
import { buildZplSample } from "./test-print-sample";

export const BRIDGE_PORT = 7755;
export const BRIDGE_HOST = "127.0.0.1";

export interface ServerDeps {
  getPairing: () => PairingRecord | null;
  setPairing: (p: PairingRecord) => void;
  appVersion: string;
  startedAt?: number;
  listPrinters: () => LoadedPrinter[];
  refreshPrinters: () => Promise<LoadedPrinter[]>;
  dispatchPdf: (req: PrintRequest) => Promise<PrintResult>;
  dispatchZpl: (req: PrintRequest) => Promise<PrintResult>;
}

function sendError(res: Response, status: number, code: ErrorCode, message: string): void {
  res.status(status).json({ error: message, errorCode: code });
}

export function createApp(deps: ServerDeps): Express {
  const app = express();
  const startedAt = deps.startedAt ?? Date.now();

  app.use(express.json({ limit: "20mb" }));

  app.use((req, res, next) => {
    if (req.path === "/pair") {
      cors({ origin: true, methods: ["POST", "OPTIONS"], allowedHeaders: ["Content-Type"] })(
        req,
        res,
        next,
      );
      return;
    }
    const pairing = deps.getPairing();
    cors({
      origin: pairing?.tenantOrigin ?? false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Bridge-Token"],
      maxAge: 600,
    })(req, res, next);
  });

  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const pairing = deps.getPairing();
    const presented = req.header("x-bridge-token");
    if (!pairing || !presented || presented !== pairing.token) {
      sendError(res, 401, ErrorCode.UNAUTHORIZED, "Missing or invalid bridge token");
      return;
    }
    next();
  };

  app.post("/pair", (req, res) => {
    try {
      const body = PairRequest.parse(req.body);
      deps.setPairing(body);
      res.json({ paired: true });
    } catch (err) {
      if (err instanceof ZodError) {
        sendError(res, 400, ErrorCode.BAD_PAYLOAD, err.issues[0]?.message ?? "Invalid pair body");
        return;
      }
      sendError(res, 500, ErrorCode.INTERNAL, "Failed to persist pairing");
    }
  });

  app.get("/health", requireAuth, (_req, res) => {
    const pairing = deps.getPairing();
    const body: HealthResponse = {
      version: deps.appVersion,
      os: process.platform,
      loadedPrinters: deps.listPrinters(),
      tenantId: pairing?.tenantId ?? null,
      orgUnitId: pairing?.orgUnitId ?? null,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    };
    res.json(body);
  });

  app.get("/printers", requireAuth, (_req, res) => {
    res.json(deps.listPrinters());
  });

  app.post("/print", requireAuth, async (req, res) => {
    try {
      const body = PrintRequest.parse(req.body);
      let result: PrintResult;
      if (body.language === "PDF") {
        result = await deps.dispatchPdf(body);
      } else if (body.language === "ZPL") {
        result = await deps.dispatchZpl(body);
      } else {
        res.status(400).json({
          dispatched: false,
          copiesAcknowledged: 0,
          error: `Language ${body.language} not implemented yet`,
          errorCode: ErrorCode.BAD_PAYLOAD,
        });
        return;
      }
      res.status(result.dispatched ? 200 : 502).json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          dispatched: false,
          copiesAcknowledged: 0,
          error: err.issues[0]?.message ?? "Invalid print body",
          errorCode: ErrorCode.BAD_PAYLOAD,
        });
        return;
      }
      res.status(500).json({
        dispatched: false,
        copiesAcknowledged: 0,
        error: err instanceof Error ? err.message : "internal",
        errorCode: ErrorCode.INTERNAL,
      });
    }
  });

  app.post("/test-print", requireAuth, async (req, res) => {
    try {
      const { printerName } = TestPrintRequest.parse(req.body);
      const target = deps.listPrinters().find((p) => p.name === printerName);
      if (!target) {
        res.status(404).json({
          dispatched: false,
          copiesAcknowledged: 0,
          error: `Printer ${printerName} not registered`,
          errorCode: ErrorCode.PRINTER_NOT_FOUND,
        });
        return;
      }
      if (target.language !== "ZPL") {
        res.status(400).json({
          dispatched: false,
          copiesAcknowledged: 0,
          error: `Test print only supports ZPL printers in M3; ${printerName} reports ${target.language}`,
          errorCode: ErrorCode.BAD_PAYLOAD,
        });
        return;
      }
      const zpl = buildZplSample();
      const result = await deps.dispatchZpl({
        printerName,
        language: "ZPL",
        payloadBase64: Buffer.from(zpl, "utf-8").toString("base64"),
        copies: 1,
        jobRef: 0,
      });
      res.status(result.dispatched ? 200 : 502).json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          dispatched: false,
          copiesAcknowledged: 0,
          error: err.issues[0]?.message ?? "Invalid test-print body",
          errorCode: ErrorCode.BAD_PAYLOAD,
        });
        return;
      }
      res.status(500).json({
        dispatched: false,
        copiesAcknowledged: 0,
        error: err instanceof Error ? err.message : "internal",
        errorCode: ErrorCode.INTERNAL,
      });
    }
  });

  return app;
}

export function startServer(deps: ServerDeps, port = BRIDGE_PORT): http.Server {
  return createApp(deps).listen(port, BRIDGE_HOST);
}
