import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { hasAutoCutter } from "./printers";
import type { PrintResult } from "./pdf";

export type EscposDeps = RawBytesDeps;

// GS V 66 3 — feed to the cut position, then partial cut (1D 56 42 03).
const FEED_AND_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x03]);

// Any GS V (cut) or ESC i / ESC m (legacy cut) already in the stream.
function hasCutCommand(payload: Buffer): boolean {
  for (let i = 0; i < payload.length - 1; i++) {
    if (payload[i] === 0x1d && payload[i + 1] === 0x56) return true;
    if (payload[i] === 0x1b && (payload[i + 1] === 0x69 || payload[i + 1] === 0x6d)) return true;
  }
  return false;
}

export function dispatchEscpos(req: PrintRequest, deps: EscposDeps = {}): Promise<PrintResult> {
  // Auto-cutter printers (BIXOLON SRP-275III) get a cut after each tag unless
  // the sender already put one in the stream.
  if (hasAutoCutter(req.printerName)) {
    const payload = Buffer.from(req.payloadBase64, "base64");
    if (!hasCutCommand(payload)) {
      req = {
        ...req,
        payloadBase64: Buffer.concat([payload, FEED_AND_CUT]).toString("base64"),
      };
    }
  }
  return dispatchRawBytes(req, deps);
}
