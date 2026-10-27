import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { feed, tightPayload, MOTION_MM, LINE_UNITS, IDLE_FLUSH_MS } from "../src/main/dispatcher/tight-cut";
import { tsplToEscposTag } from "../src/main/dispatcher/tspl-to-escpos";
import { dispatchTspl } from "../src/main/dispatcher/tspl";
import type { PrinterLookup } from "../src/main/dispatcher/printers";
import type { PrintRequest } from "../src/shared/protocol";

const TAG = [
  "SIZE 76 mm,9 mm",
  "GAP 0 mm,0 mm",
  "DIRECTION 1",
  "CLS",
  'TEXT 8,4,"0",0,1,1,"DM1406"',
  'TEXT 8,28,"0",0,1,1,"Abhaya 1(1)/1"',
  'TEXT 330,28,"0",0,1,1,"WF/W"',
  'TEXT 560,28,"0",0,1,1,"1/3"',
  'TEXT 8,52,"0",0,1,1,"23 Aug 25 Sat"',
  "PRINT 1,1",
  "",
].join("\r\n");

describe("tsplToEscposTag", () => {
  it("uses the full 76 mm width and keeps right-hand fields on the right", () => {
    const tag = tsplToEscposTag(TAG, LINE_UNITS)!;
    const lines = tag.bytes.toString("latin1").split("\n");
    const row2 = lines.find((l) => l.includes("Abhaya"))!;
    expect(row2.replace(/[^\x20-\x7e]/g, "").trimEnd().length).toBeGreaterThan(30);
    expect(row2.trimEnd().endsWith("1/3")).toBe(true);
  });
  it("reports 3 rows of fixed spacing as the tag height", () => {
    const tag = tsplToEscposTag(TAG, LINE_UNITS)!;
    expect(tag.heightUnits).toBe(3 * LINE_UNITS);
    expect([...tag.bytes.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x33, LINE_UNITS]);
  });
  it("cannot measure a tag with a double-size row", () => {
    const big = TAG.replace('"DM1406"', '"DM1406"').replace("0,1,1,\"DM1406\"", '0,12,12,"DM1406"');
    expect(tsplToEscposTag(big, LINE_UNITS)!.heightUnits).toBeNull();
  });
});

describe("tightPayload", () => {
  it("feeds gap minus height, then cuts without feeding", () => {
    const gapMm = 30;
    const gapUnits = Math.round(gapMm / MOTION_MM);
    const out = tightPayload(Buffer.from("x"), 60, gapMm)!;
    expect([...out.subarray(1)]).toEqual([0x1b, 0x4a, gapUnits - 60, 0x1d, 0x56, 0x00]);
  });
  it("splits feeds longer than 255 units", () => {
    expect([...feed(300)]).toEqual([0x1b, 0x4a, 255, 0x1b, 0x4a, 45]);
  });
  it("refuses when the tag is as long as the gap", () => {
    expect(tightPayload(Buffer.from("x"), 200, 30)).toBeNull();
  });
});

describe("dispatchTspl tight mode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const lookup = (): PrinterLookup => ({
    kind: "os",
    record: { name: "BIXOLON SRP-275III", language: "ESC_POS", mediaWidthMm: 76, mediaHeightMm: null, mediaKind: null, isDefault: false, online: true },
  });
  const req = (): PrintRequest => ({
    printerName: "BIXOLON SRP-275III",
    language: "TSPL",
    payloadBase64: Buffer.from(TAG).toString("base64"),
    copies: 1,
    jobRef: 1,
  });

  it("cuts at the tag's top edge, then flushes the last tag after idle", async () => {
    const sent: Buffer[] = [];
    const sendLocalRaw = vi.fn(async (_n: string, p: Buffer) => void sent.push(p));
    const settings = () => ({ cutMode: "tight" as const, cutterGapMm: 30 });

    const r = await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    expect(r).toEqual({ dispatched: true, copiesAcknowledged: 1 });
    const gapUnits = Math.round(30 / MOTION_MM);
    expect([...sent[0].subarray(-6)]).toEqual([0x1b, 0x4a, gapUnits - 3 * LINE_UNITS, 0x1d, 0x56, 0x00]);
    expect(sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(IDLE_FLUSH_MS + 10);
    expect(sent).toHaveLength(2);
    expect([...sent[1]]).toEqual([0x1b, 0x4a, 3 * LINE_UNITS + 6, 0x1d, 0x56, 0x00]);
  });

  it("a second tag within the idle window cancels the flush", async () => {
    const sent: Buffer[] = [];
    const sendLocalRaw = vi.fn(async (_n: string, p: Buffer) => void sent.push(p));
    const settings = () => ({ cutMode: "tight" as const, cutterGapMm: 30 });
    await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    await vi.advanceTimersByTimeAsync(1000);
    await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(2); // still no flush: its timer restarted at the second tag
    await vi.advanceTimersByTimeAsync(600);
    expect(sent).toHaveLength(3);
  });

  it("without cutterGapMm it keeps the normal feed-then-cut path", async () => {
    const sent: Buffer[] = [];
    const sendLocalRaw = vi.fn(async (_n: string, p: Buffer) => void sent.push(p));
    await dispatchTspl(req(), { sendLocalRaw, lookup, settings: () => ({ cutMode: "tight" as const }) });
    expect([...sent[0].subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x03]);
  });
});

describe("job route notes", () => {
  it("records which path a Bixolon tag took, without payload text", async () => {
    const { withTrace } = await import("../src/main/job-trace");
    const lookup = (): PrinterLookup => ({
      kind: "os",
      record: { name: "BIXOLON SRP-275III", language: "ESC_POS", mediaWidthMm: 76, mediaHeightMm: null, mediaKind: null, isDefault: false, online: true },
    });
    const run = (settings: () => Record<string, unknown>) =>
      withTrace(() =>
        dispatchTspl(
          { printerName: "BIXOLON SRP-275III", language: "TSPL", payloadBase64: Buffer.from(TAG).toString("base64"), copies: 1, jobRef: 1 },
          { sendLocalRaw: async () => undefined, lookup, settings },
        ),
      );
    const tight = await run(() => ({ cutMode: "tight", cutterGapMm: 30 }));
    expect(tight.notes.join(";")).toContain("tight cut");
    expect(tight.notes.join(";")).not.toContain("DM1406");
    const noGap = await run(() => ({ cutMode: "tight" }));
    expect(noGap.notes.join(";")).toContain("tight skipped: head-to-cutter gap not set");
  });
});
