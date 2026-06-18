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
import { buildZplSample, buildEscposSample, buildTsplSample } from "./test-print-sample";
import type { PrintLanguage } from "../shared/protocol";
import type { JobStatus } from "./jobs/repository";
import type { ErrorRing } from "./error-ring";

export interface JobRecorder {
  start(printer: string, language: PrintLanguage, copiesRequested: number): number;
  finish(id: number, copiesAcknowledged: number, status: JobStatus, error: string | null): void;
}

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
  dispatchEscpos: (req: PrintRequest) => Promise<PrintResult>;
  dispatchTspl: (req: PrintRequest) => Promise<PrintResult>;
  jobRecorder?: JobRecorder;
  errorRing?: ErrorRing;
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
      recentErrors: deps.errorRing?.list() ?? [],
    };
    res.json(body);
  });

  app.get("/printers", requireAuth, (_req, res) => {
    res.json(deps.listPrinters());
  });

  async function recordedDispatch(body: PrintRequest): Promise<PrintResult> {
    const jobId = deps.jobRecorder?.start(body.printerName, body.language, body.copies);
    let result: PrintResult;
    if (body.language === "PDF") {
      result = await deps.dispatchPdf(body);
    } else if (body.language === "ZPL") {
      result = await deps.dispatchZpl(body);
    } else if (body.language === "ESC_POS") {
      result = await deps.dispatchEscpos(body);
    } else if (body.language === "TSPL") {
      result = await deps.dispatchTspl(body);
    } else {
      const failure = {
        dispatched: false as const,
        copiesAcknowledged: 0 as const,
        error: `Language ${body.language} not implemented yet`,
        errorCode: ErrorCode.BAD_PAYLOAD,
      };
      if (jobId !== undefined) {
        deps.jobRecorder?.finish(jobId, 0, "FAILED", failure.error);
      }
      return failure;
    }
    if (jobId !== undefined) {
      deps.jobRecorder?.finish(
        jobId,
        result.copiesAcknowledged,
        result.dispatched ? "DISPATCHED" : "FAILED",
        result.dispatched ? null : result.error,
      );
    }
    return result;
  }

  app.post("/print", requireAuth, async (req, res) => {
    try {
      const body = PrintRequest.parse(req.body);
      const result = await recordedDispatch(body);
      if (
        body.language !== "PDF" &&
        body.language !== "ZPL" &&
        body.language !== "ESC_POS" &&
        body.language !== "TSPL"
      ) {
        res.status(400).json(result);
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
      if (target.language === "PDF") {
        res.status(400).json({
          dispatched: false,
          copiesAcknowledged: 0,
          error: `Test print only supports ZPL, TSPL and ESC/POS printers; ${printerName} reports PDF`,
          errorCode: ErrorCode.BAD_PAYLOAD,
        });
        return;
      }
      const payload =
        target.language === "ZPL"
          ? Buffer.from(buildZplSample(), "utf-8")
          : target.language === "TSPL"
            ? Buffer.from(buildTsplSample(), "utf-8")
            : buildEscposSample();
      const result = await recordedDispatch({
        printerName,
        language: target.language,
        payloadBase64: payload.toString("base64"),
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
