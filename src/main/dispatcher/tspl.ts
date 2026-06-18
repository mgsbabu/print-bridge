import { ErrorCode } from "../../shared/error-codes";
import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
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
  return dispatchRawBytes(req, deps);
}
