import { ErrorCode } from "../../shared/error-codes";
import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { dispatchEscpos } from "./escpos";
import { findPrinter, needsReversedDirection } from "./printers";
import { tsplToEscpos } from "./tspl-to-escpos";
import { fitTsplBarcodes } from "./tspl-fit";
import type { PrintResult } from "./pdf";

export type TsplDeps = RawBytesDeps;

/**
 * Dispatch a TSPL2 stream to a TSC / TSPL-native printer (e.g. TSC TTP-244
 * Pro). TSPL is the printer's native page-description language, so — like ZPL
 * for Zebra — we send the raw bytes straight to the spooler with no driver
 * rendering or scaling in between.
 *
 * <p>Unlike {@code dispatchZpl} there's no Labelary validation step: Labelary
 * only understands ZPL. We do a cheap sanity check that the payload looks like
 * TSPL (carries a SIZE/PRINT command) so an obviously-wrong stream fails fast
 * instead of feeding blank labels.
 *
 * <p>Two printer-specific adjustments:
 * <ul>
 *   <li>Receipt printers (ESC/POS, e.g. BIXOLON) can't read TSPL and would print
 *       the commands as text, so the tag is re-rendered as ESC/POS (with cut).</li>
 *   <li>Unnati prints with the opposite orientation to TSC, so DIRECTION is
 *       flipped to keep the tag upright.</li>
 * </ul>
 */
export async function dispatchTspl(req: PrintRequest, deps: TsplDeps = {}): Promise<PrintResult> {
  const text = Buffer.from(req.payloadBase64, "base64").toString("utf-8");
  if (!/\bPRINT\b/i.test(text) || !/\bSIZE\b/i.test(text)) {
    return {
      dispatched: false,
      copiesAcknowledged: 0,
      error: "Payload does not look like TSPL (missing SIZE / PRINT command)",
      errorCode: ErrorCode.BAD_PAYLOAD,
    };
  }

  const target = (deps.lookup ?? findPrinter)(req.printerName);
  if (target?.record.language === "ESC_POS") {
    const escpos = tsplToEscpos(text);
    if (!escpos) {
      return {
        dispatched: false,
        copiesAcknowledged: 0,
        error: "TSPL tag has no TEXT/QRCODE/BARCODE elements to render on an ESC/POS printer",
        errorCode: ErrorCode.BAD_PAYLOAD,
      };
    }
    return dispatchEscpos({ ...req, language: "ESC_POS", payloadBase64: escpos.toString("base64") }, deps);
  }

  let out = fitTsplBarcodes(text);
  if (needsReversedDirection(req.printerName)) {
    out = out.replace(/^(\s*DIRECTION\s+)([01])/im, (_m, p: string, d: string) => p + (d === "1" ? "0" : "1"));
  }
  if (out !== text) req = { ...req, payloadBase64: Buffer.from(out, "utf-8").toString("base64") };
  return dispatchRawBytes(req, deps);
}
