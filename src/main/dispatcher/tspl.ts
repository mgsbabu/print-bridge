import { ErrorCode } from "../../shared/error-codes";
import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { dispatchEscpos } from "./escpos";
import { findPrinter, resolveSettings } from "./printers";
import { tsplToEscpos, tsplToEscposTag } from "./tspl-to-escpos";
import { LINE_UNITS, dispatchTightTag } from "./tight-cut";
import { fitTsplBarcodes } from "./tspl-fit";
import { applyTsplSettings, type SettingsLookup } from "./print-settings";
import { trace } from "../job-trace";
import type { PrintResult } from "./pdf";

export interface TsplDeps extends RawBytesDeps {
  settings?: SettingsLookup;
}

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
 *   <li>Orientation: the printer's rotate180 setting flips DIRECTION. It is on by
 *       default for Unnati, which prints the opposite way to TSC.</li>
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
    const settings = (deps.settings ?? resolveSettings)(req.printerName);
    trace(`TSPL tag to ESC/POS printer; cut=${settings.cutMode ?? "partial"}, gap=${settings.cutterGapMm ?? "not set"}`);
    if (settings.cutMode === "tight" && settings.cutterGapMm !== undefined) {
      // Gap-free slips: cut each tag at its own top edge. Falls through to the normal
      // feed-then-cut path when the tag's length can't be known or exceeds the gap.
      const tag = tsplToEscposTag(text, LINE_UNITS);
      if (!tag?.heightUnits) {
        trace("tight skipped: tag has a QR code or double-size row, so its length is unknown");
      } else {
        const tight = await dispatchTightTag(req, tag.bytes, tag.heightUnits, settings, deps);
        if (tight) return tight;
        trace("tight skipped: tag is taller than the head-to-cutter gap");
      }
    } else if (settings.cutMode === "tight") {
      trace("tight skipped: head-to-cutter gap not set");
    }
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
  // The ESC/POS branch above applies settings in dispatchEscpos; native TSPL does it here.
  const settings = (deps.settings ?? resolveSettings)(req.printerName);
  const directionBefore = /^\s*DIRECTION\s+([01])/im.exec(out)?.[1] ?? "none";
  out = applyTsplSettings(out, settings);
  const directionAfter = /^\s*DIRECTION\s+([01])/im.exec(out)?.[1] ?? "none";
  trace(`TSPL sent as-is; rotate180=${settings.rotate180 ? "on" : "off"}, DIRECTION ${directionBefore} -> ${directionAfter}`);
  if (out !== text) req = { ...req, payloadBase64: Buffer.from(out, "utf-8").toString("base64") };
  return dispatchRawBytes(req, deps);
}
