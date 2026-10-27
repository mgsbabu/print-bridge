import type { PrintRequest, PrinterSettings } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { applyEscposSettings } from "./print-settings";
import { log } from "../logger";
import { trace } from "../job-trace";
import type { PrintResult } from "./pdf";

// Gap-free tags on an auto-cutter receipt printer (BIXOLON SRP-275III).
//
// The cutter sits cutterGapMm downstream of the print head, so cutting right
// after a tag leaves that distance as a blank above it. Instead each tag is
// followed by a feed of (gap - tag height) and a cut, which puts the cut at
// the tag's own top edge: it separates the PREVIOUS tag. The tag just printed
// stays in the printer until the next tag arrives or the idle flush below
// feeds it out.

const ESC = 0x1b;
const GS = 0x1d;

export const MOTION_MM = 0.176; // SRP-275III vertical motion unit, 1/144 inch
export const LINE_UNITS = 20; // 3.5 mm per row (a 9-dot row needs 18)
const FLUSH_SLACK_UNITS = 6; // ~1 mm so the cut doesn't clip the last row
export const IDLE_FLUSH_MS = 2000;

const PARTIAL_CUT = Buffer.from([GS, 0x56, 0x00]); // GS V 0: cut here, no feed

const mmToUnits = (mm: number): number => Math.round(mm / MOTION_MM);

// ESC J n feeds at most 255 units (45 mm) per command.
export function feed(units: number): Buffer {
  const parts: number[] = [];
  for (let left = units; left > 0; left -= 255) parts.push(ESC, 0x4a, Math.min(left, 255));
  return Buffer.from(parts);
}

// null when the tag is as long as the head-to-cutter gap or longer: the cut
// could not land on its top edge.
export function tightPayload(content: Buffer, heightUnits: number, gapMm: number): Buffer | null {
  const gap = mmToUnits(gapMm);
  if (gap <= heightUnits) return null;
  return Buffer.concat([content, feed(gap - heightUnits), PARTIAL_CUT]);
}

interface Pending {
  heightUnits: number;
  timer: NodeJS.Timeout;
}
const pending = new Map<string, Pending>();

export async function dispatchTightTag(
  req: PrintRequest,
  content: Buffer,
  heightUnits: number,
  settings: PrinterSettings,
  deps: RawBytesDeps,
): Promise<PrintResult | null> {
  const payload = tightPayload(applyEscposSettings(content, settings), heightUnits, settings.cutterGapMm ?? 0);
  if (!payload) return null;
  trace(`tight cut: tag ${heightUnits} units, feed ${mmToUnits(settings.cutterGapMm ?? 0) - heightUnits} units, then cut; last tag is flushed after ${IDLE_FLUSH_MS / 1000}s idle`);

  clearTimeout(pending.get(req.printerName)?.timer);
  const result = await dispatchRawBytes({ ...req, language: "ESC_POS", payloadBase64: payload.toString("base64") }, deps);
  if (result.dispatched) {
    const timer = setTimeout(() => void flush(req, heightUnits, deps), IDLE_FLUSH_MS);
    timer.unref();
    pending.set(req.printerName, { heightUnits, timer });
  }
  return result;
}

// Feeds the last tag out and cuts it, so a lone tag isn't left inside the printer.
async function flush(req: PrintRequest, heightUnits: number, deps: RawBytesDeps): Promise<void> {
  pending.delete(req.printerName);
  const bytes = Buffer.concat([feed(heightUnits + FLUSH_SLACK_UNITS), PARTIAL_CUT]);
  const r = await dispatchRawBytes(
    { ...req, language: "ESC_POS", copies: 1, payloadBase64: bytes.toString("base64") },
    deps,
  ).catch((err: unknown) => ({ dispatched: false as const, error: String(err) }));
  if (!r.dispatched) log.warn({ printer: req.printerName }, "tight-cut flush failed");
}
