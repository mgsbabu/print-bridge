import type { PrintRequest } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { hasAutoCutter } from "./printers";
import { describeEscpos, fitToBixolon76, hasCut } from "./escpos-fit";
import { applyEscposSettings, type SettingsLookup } from "./print-settings";
import { getPrinterSettings } from "../store";
import { log } from "../logger";
import type { PrintResult } from "./pdf";

export interface EscposDeps extends RawBytesDeps {
  settings?: SettingsLookup;
}

// GS V 66 3 — feed to the cut position, then partial cut (1D 56 42 03).
const FEED_AND_CUT = Buffer.from([0x1d, 0x56, 0x42, 0x03]);

export function dispatchEscpos(req: PrintRequest, deps: EscposDeps = {}): Promise<PrintResult> {
  const settings = (deps.settings ?? getPrinterSettings)(req.printerName);
  let payload: Buffer = Buffer.from(req.payloadBase64, "base64");

  // Auto-cutter printers (BIXOLON SRP-275III, 76 mm roll): word-wrap to the
  // roll's columns, turn every cut into feed-then-cut (so the last lines
  // aren't left inside the machine), and add a cut if the sender sent none.
  // cutMode "none" skips all of that cutting: each tag leaves the head-to-cutter
  // gap only once, so a batch prints as one continuous strip.
  if (hasAutoCutter(req.printerName)) {
    const cut = settings.cutMode !== "none";
    payload = fitToBixolon76(payload, cut);
    if (cut && !hasCut(payload)) payload = Buffer.concat([payload, FEED_AND_CUT]);
  }
  payload = applyEscposSettings(payload, settings);
  if (hasAutoCutter(req.printerName)) {
    log.debug({ printer: req.printerName, bytes: payload.length, shape: describeEscpos(payload) }, "escpos sent");
  }
  return dispatchRawBytes({ ...req, payloadBase64: payload.toString("base64") }, deps);
}
