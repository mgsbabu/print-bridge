import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import type { PrintResult } from "./pdf";

export type EscposDeps = RawBytesDeps;

export function dispatchEscpos(req: PrintRequest, deps: EscposDeps = {}): Promise<PrintResult> {
  return dispatchRawBytes(req, deps);
}
