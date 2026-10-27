import { print as pdfPrint, type PrintOptions } from "pdf-to-printer";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ErrorCode } from "../../shared/error-codes";
import { rotatePdf180, type SettingsLookup } from "./print-settings";
import { getPrinterSettings } from "../store";
import type { PrintRequest, PrintSuccessResponse, PrintFailureResponse } from "../../shared/protocol";

export type PrintFn = (pdf: string, options?: PrintOptions) => Promise<void>;

export type PrintResult = PrintSuccessResponse | PrintFailureResponse;

const execFileAsync = promisify(execFile);

// pdf-to-printer is Windows-only; on macOS/Linux hand the PDF to CUPS.
const cupsPrint: PrintFn = async (pdf, options) => {
  const args = options?.printer ? ["-d", options.printer] : [];
  await execFileAsync("lp", [...args, "-n", String(options?.copies ?? 1), pdf]);
};

export async function dispatchPdf(
  req: PrintRequest,
  printFn: PrintFn = process.platform === "win32" ? pdfPrint : cupsPrint,
  settings: SettingsLookup = getPrinterSettings,
): Promise<PrintResult> {
  const tmp = path.join(os.tmpdir(), `bridge-${crypto.randomUUID()}.pdf`);
  try {
    let pdf: Buffer = Buffer.from(req.payloadBase64, "base64");
    if (settings(req.printerName).rotate180) pdf = await rotatePdf180(pdf);
    await fs.writeFile(tmp, pdf);
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
