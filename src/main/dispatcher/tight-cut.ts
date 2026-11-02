import type { PrintRequest, PrinterSettings } from "../../shared/protocol";
import { dispatchRawBytes, type RawBytesDeps } from "./raw-bytes";
import { applyEscposSettings } from "./print-settings";
import { log } from "../logger";
import { trace } from "../job-trace";
import type { PrintResult } from "./pdf";

// Gap-free tags on an auto-cutter receipt printer (BIXOLON SRP-275III).
//
// The cutter sits cutterGapMm downstream of the print head, so a tag can only be
// cut off once the paper has moved that far past it. Cutting right after each
// tag (feed the gap, cut) makes every slip a whole gap long: 40 mm of paper for
// a 9 mm tag. Instead each tag advances the paper by its own length only, and
// the bridge remembers where the not-yet-cut tag edges are between the head and
// the cutter. Whenever one of them reaches the cutter — usually while a later
// tag is printing — the feed is split there and the cut is made, so every slip
// is exactly one tag long.
//
// Paper only gets past the cutter when more paper is fed, so after the last tag
// of a batch an idle flush feeds the gap and cuts the remaining edges. A cut slip
// still sits just past the cutter, inside the cover, so the idle flush then feeds
// EJECT_MM more to carry it out. The first tag after that starts behind a gap
// plus EJECT_MM of blank paper, which comes off as one blank strip ahead of it.

const ESC = 0x1b;
const GS = 0x1d;

export const MOTION_MM = 0.176; // SRP-275III vertical motion unit, 1/144 inch
export const LINE_UNITS = 20; // 3.5 mm per row (a 9-dot row needs 18)
const BOTTOM_MARGIN_UNITS = 6; // ~1 mm under the last row so the cut doesn't clip it
export const IDLE_FLUSH_MS = 2000;
export const EJECT_MM = 15; // cutter to the cover's paper exit, plus a little to grip

const CUT = Buffer.from([GS, 0x56, 0x00]); // GS V 0: cut here, no feed

export const mmToUnits = (mm: number): number => Math.round(mm / MOTION_MM);

// ESC J n prints whatever is buffered and feeds n units, at most 255 (45 mm) per command.
export function feed(units: number): Buffer {
  const parts: number[] = [];
  for (let left = units; left > 0; left -= 255) parts.push(ESC, 0x4a, Math.min(left, 255));
  return Buffer.from(parts);
}

// Builds a stream that moves the paper while cutting at the given advances
// (units from the start of this stream). Rows print at the start of their move.
function mover(cutsAt: number[]): { move: (units: number, row?: Buffer) => void; out: Buffer[] } {
  const cuts = [...cutsAt].sort((a, b) => a - b);
  const out: Buffer[] = [];
  let pos = 0;
  const move = (units: number, row?: Buffer): void => {
    if (row) out.push(row);
    const end = pos + units;
    while (cuts.length > 0 && cuts[0] <= end) {
      const at = cuts.shift()!;
      out.push(feed(at - pos), CUT);
      pos = at;
    }
    if (end > pos) out.push(feed(end - pos));
    pos = end;
  };
  return { move, out };
}

export interface TagPlan {
  payload: Buffer;
  /** Uncut tag edges after this tag, as units already past the head (each < gap). */
  edges: number[];
  pitchUnits: number;
  cuts: number;
}

/**
 * One tag: its rows on a pitch of max(label height, rows + bottom margin), with a
 * cut wherever an earlier edge, or this tag's own top edge, reaches the cutter.
 * {@code edges} are the uncut edges from the tags before it.
 */
export function planTag(
  rows: Buffer[],
  lineUnits: number,
  labelUnits: number,
  gapUnits: number,
  edges: number[],
): TagPlan {
  const contentUnits = rows.length * lineUnits;
  const pitchUnits = Math.max(labelUnits, contentUnits + BOTTOM_MARGIN_UNITS);
  const pad = pitchUnits - contentUnits;
  const bottom = Math.max(BOTTOM_MARGIN_UNITS, Math.ceil(pad / 2));

  // This tag's top edge is at the head now; it's the previous tag's bottom edge
  // when that one is still uncut.
  const all = edges.includes(0) ? edges : [...edges, 0];
  const cutsAt = all.map((d) => gapUnits - d).filter((at) => at <= pitchUnits);
  const { move, out } = mover(cutsAt);
  move(pad - bottom);
  for (const row of rows) move(lineUnits, row);
  move(bottom);

  return {
    payload: Buffer.concat([Buffer.from([ESC, 0x40]), ...out, Buffer.from([GS, 0x21, 0x00])]),
    edges: [...all.map((d) => d + pitchUnits).filter((d) => d < gapUnits), 0],
    pitchUnits,
    cuts: cutsAt.length,
  };
}

/**
 * Feeds until every uncut edge has reached the cutter, cutting at each, then
 * feeds ejectUnits more (no cut) to carry the last slip out of the printer.
 */
export function planFlush(edges: number[], gapUnits: number, ejectUnits = 0): Buffer {
  if (edges.length === 0) return Buffer.alloc(0);
  const cutsAt = edges.map((d) => gapUnits - d);
  const { move, out } = mover(cutsAt);
  move(Math.max(...cutsAt) + ejectUnits);
  return Buffer.concat(out);
}

interface Paper {
  edges: number[];
  gapUnits: number;
  timer?: NodeJS.Timeout;
  // Sends go out one at a time, in the order they were planned.
  queue: Promise<unknown>;
}
const papers = new Map<string, Paper>();

function paperFor(name: string, gapUnits: number): Paper {
  let p = papers.get(name);
  if (!p) {
    p = { edges: [], gapUnits, queue: Promise.resolve() };
    papers.set(name, p);
  }
  return p;
}

function send(p: Paper, req: PrintRequest, bytes: Buffer, deps: RawBytesDeps): Promise<PrintResult> {
  const sent = p.queue.then(() =>
    dispatchRawBytes({ ...req, language: "ESC_POS", payloadBase64: bytes.toString("base64") }, deps),
  );
  p.queue = sent.catch(() => undefined);
  return sent;
}

export async function dispatchTightTag(
  req: PrintRequest,
  rows: Buffer[],
  lineUnits: number,
  labelHeightMm: number | null,
  settings: PrinterSettings,
  deps: RawBytesDeps,
): Promise<PrintResult> {
  const gapUnits = mmToUnits(settings.cutterGapMm ?? 0);
  const p = paperFor(req.printerName, gapUnits);
  if (p.gapUnits !== gapUnits) {
    // The gap setting changed: the remembered edges no longer line up with the cutter.
    p.edges = [];
    p.gapUnits = gapUnits;
  }
  clearTimeout(p.timer);

  // Every copy is its own tag on the strip, so each is planned (and cut) separately
  // and the lot goes out as one send.
  const labelUnits = labelHeightMm ? mmToUnits(labelHeightMm) : 0;
  const payloads: Buffer[] = [];
  let cuts = 0;
  let pitchUnits = 0;
  for (let i = 0; i < req.copies; i++) {
    const plan = planTag(rows, lineUnits, labelUnits, gapUnits, p.edges);
    p.edges = plan.edges;
    payloads.push(applyEscposSettings(plan.payload, settings)); // per copy: each starts with ESC @
    cuts += plan.cuts;
    pitchUnits = plan.pitchUnits;
  }
  trace(
    `tight cut: tag ${rows.length * lineUnits} units on a ${pitchUnits}-unit pitch, ` +
      `${cuts} cut(s) in this job; the rest are cut after ${IDLE_FLUSH_MS / 1000}s idle`,
  );
  p.timer = setTimeout(() => void flushTight(req.printerName, deps, true), IDLE_FLUSH_MS);
  p.timer.unref();

  const bytes = Buffer.concat(payloads);
  const result = await send(p, { ...req, copies: 1 }, bytes, deps);
  // Nothing moved, so the remembered edges are wrong; start again from a blank gap.
  if (!result.dispatched) {
    p.edges = [];
    return result;
  }
  return { ...result, copiesAcknowledged: req.copies };
}

/**
 * Feeds out and cuts any tags still between the head and the cutter. Runs after
 * a batch goes idle, and before any other job on the same printer so its own
 * feed-then-cut doesn't carry uncut tags out stuck together. eject carries the
 * last slip out of the cover; a following job's own feed does that otherwise.
 */
export async function flushTight(printerName: string, deps: RawBytesDeps, eject = false): Promise<void> {
  const p = papers.get(printerName);
  if (!p) return;
  clearTimeout(p.timer);
  const bytes = planFlush(p.edges, p.gapUnits, eject ? mmToUnits(EJECT_MM) : 0);
  p.edges = [];
  if (bytes.length === 0) {
    await p.queue;
    return;
  }
  const req: PrintRequest = { printerName, language: "ESC_POS", copies: 1, jobRef: 0, payloadBase64: "" };
  const r = await send(p, req, bytes, deps).catch((err: unknown) => ({
    dispatched: false as const,
    error: String(err),
  }));
  if (!r.dispatched) log.warn({ printer: printerName }, "tight-cut flush failed");
}
