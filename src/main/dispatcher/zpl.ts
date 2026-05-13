import { validateZpl, type LabelaryResult } from "../labelary";
import { ErrorCode } from "../../shared/error-codes";
import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import type { PrintResult } from "./pdf";

export interface ZplDeps extends RawBytesDeps {
  validate?: (zpl: string) => Promise<LabelaryResult>;
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
  return dispatchRawBytes(req, deps);
}
