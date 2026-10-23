import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { hasAutoCutter } from "./printers";
import { fitToBixolon76, hasCut } from "./escpos-fit";
import type { PrintResult } from "./pdf";

export type EscposDeps = RawBytesDeps;

// GS V 66 3 — feed to the cut position, then partial cut (1D 56 42 03).
const FEED_AND_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x03]);

export function dispatchEscpos(req: PrintRequest, deps: EscposDeps = {}): Promise<PrintResult> {
  // Auto-cutter printers (BIXOLON SRP-275III, 76 mm roll): word-wrap to the
  // roll's columns, turn every cut into feed-then-cut (so the last lines
  // aren't left inside the machine), and add a cut if the sender sent none.
  if (hasAutoCutter(req.printerName)) {
    let payload = fitToBixolon76(Buffer.from(req.payloadBase64, "base64"));
    if (!hasCut(payload)) payload = Buffer.concat([payload, FEED_AND_CUT]);
    req = { ...req, payloadBase64: payload.toString("base64") };
  }
  return dispatchRawBytes(req, deps);
}
