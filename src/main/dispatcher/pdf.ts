import { print as pdfPrint, type PrintOptions } from "pdf-to-printer";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ErrorCode } from "../../shared/error-codes";
import type { PrintRequest, PrintSuccessResponse, PrintFailureResponse } from "../../shared/protocol";

export type PrintFn = (pdf: string, options?: PrintOptions) => Promise<void>;

export type PrintResult = PrintSuccessResponse | PrintFailureResponse;

export async function dispatchPdf(
  req: PrintRequest,
  printFn: PrintFn = pdfPrint,
): Promise<PrintResult> {
  const tmp = path.join(os.tmpdir(), `bridge-${crypto.randomUUID()}.pdf`);
  try {
    await fs.writeFile(tmp, Buffer.from(req.payloadBase64, "base64"));
    await printFn(tmp, { printer: req.printerName, copies: req.copies });
    return { dispatched: true, copiesAcknowledged: req.copies };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      dispatched: false,
      copiesAcknowledged: 0,
      error: message,
      errorCode: classifyPrintError(message),
    };
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

function classifyPrintError(message: string): ErrorCode {
  const m = message.toLowerCase();
  if (m.includes("not found") || m.includes("no such printer")) return ErrorCode.PRINTER_NOT_FOUND;
  if (m.includes("offline") || m.includes("not connected")) return ErrorCode.PRINTER_OFFLINE;
  return ErrorCode.INTERNAL;
}
