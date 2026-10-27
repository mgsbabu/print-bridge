import { validateZpl, type LabelaryResult } from "../labelary";
import { ErrorCode } from "../../shared/error-codes";
import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { applyZplSettings, type SettingsLookup } from "./print-settings";
import { resolveSettings } from "./printers";
import type { PrintResult } from "./pdf";

export interface ZplDeps extends RawBytesDeps {
  validate?: (zpl: string) => Promise<LabelaryResult>;
  settings?: SettingsLookup;
}

export async function dispatchZpl(req: PrintRequest, deps: ZplDeps = {}): Promise<PrintResult> {
  const validate = deps.validate ?? validateZpl;
  const zpl = Buffer.from(req.payloadBase64, "base64").toString("utf-8");
  const v = await validate(zpl);
  if (!v.ok) {
    return {
      dispatched: false,
      copiesAcknowledged: 0,
      error: v.reason ?? "ZPL validation failed",
      errorCode: ErrorCode.BAD_PAYLOAD,
    };
  }
  const out = applyZplSettings(zpl, (deps.settings ?? resolveSettings)(req.printerName));
  if (out !== zpl) req = { ...req, payloadBase64: Buffer.from(out, "utf-8").toString("base64") };
  return dispatchRawBytes(req, deps);
}
