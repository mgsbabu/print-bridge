import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { feed, planTag, planFlush, mmToUnits, MOTION_MM, LINE_UNITS, IDLE_FLUSH_MS, EJECT_MM } from "../src/main/dispatcher/tight-cut";
import { dispatchEscpos } from "../src/main/dispatcher/escpos";
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

const J = 0x4a;
const CUT = [0x1d, 0x56, 0x00];
const rowA = Buffer.from("A");
const rowB = Buffer.from("B");

// Paper fed by a stream: the sum of its ESC J n feeds.
const fed = (b: Buffer): number => {
  let n = 0;
  for (let i = 0; i < b.length - 2; i++) if (b[i] === 0x1b && b[i + 1] === J) n += b[i + 2];
  return n;
};
const cutCount = (b: Buffer): number => {
  let n = 0;
  for (let i = 0; i < b.length - 2; i++) if (b[i] === 0x1d && b[i + 1] === 0x56 && b[i + 2] === 0) n++;
  return n;
};

describe("planTag", () => {
  it("advances one label length per tag, centring the rows with a bottom margin", () => {
    // 2 rows of 20 on a 51-unit (9 mm) label: 11 spare, 6 under the rows, 5 above.
    const plan = planTag([rowA, rowB], 20, 51, 100, []);
    expect(plan.pitchUnits).toBe(51);
    expect([...plan.payload]).toEqual([
      0x1b, 0x40,
      0x1b, J, 5,
      0x41, 0x1b, J, 20,
      0x42, 0x1b, J, 20,
      0x1b, J, 6,
      0x1d, 0x21, 0x00,
    ]);
    // Nothing reached the cutter yet: its top edge is 51 past the head, its bottom at it.
    expect(plan.cuts).toBe(0);
    expect(plan.edges).toEqual([51, 0]);
  });

  it("cuts an earlier edge when it reaches the cutter, splitting the feed there", () => {
    // Edge at 51 reaches the 100-unit cutter after 49 more: inside this tag's last feed.
    const plan = planTag([rowA, rowB], 20, 51, 100, [51, 0]);
    expect([...plan.payload]).toEqual([
      0x1b, 0x40,
      0x1b, J, 5,
      0x41, 0x1b, J, 20,
      0x42, 0x1b, J, 20,
      0x1b, J, 4, ...CUT, 0x1b, J, 2,
      0x1d, 0x21, 0x00,
    ]);
    expect(plan.edges).toEqual([51, 0]);
  });

  it("every slip is one pitch long once the strip is running", () => {
    const gap = Math.round(40 / MOTION_MM); // the 40 mm the Bixolon is set to
    let edges: number[] = [];
    const cutAt: number[] = [];
    let travelled = 0;
    for (let t = 0; t < 8; t++) {
      const plan = planTag([rowA, rowB], 20, 51, gap, edges);
      // Absolute position of each cut, measured along the paper.
      let pos = travelled;
      for (let i = 0; i < plan.payload.length - 2; i++) {
        if (plan.payload[i] === 0x1b && plan.payload[i + 1] === J) pos += plan.payload[i + 2];
        if (plan.payload[i] === 0x1d && plan.payload[i + 1] === 0x56) cutAt.push(pos);
      }
      travelled += fed(plan.payload);
      edges = plan.edges;
    }
    const slips = cutAt.slice(1).map((c, i) => c - cutAt[i]);
    expect(slips.length).toBeGreaterThan(2);
    expect(new Set(slips)).toEqual(new Set([51]));
  });

  it("uses the rows' height when the label is shorter than them", () => {
    expect(planTag([rowA, rowB, rowA], 20, 51, 100, []).pitchUnits).toBe(66);
  });

  it("copes with a pitch longer than the gap", () => {
    const plan = planTag([rowA, rowB], 20, 51, 30, []);
    expect(plan.cuts).toBe(1); // its own top edge, which passes the cutter mid-tag
    expect(plan.edges).toEqual([0]);
  });
});

describe("planFlush", () => {
  it("feeds every uncut edge to the cutter and cuts each", () => {
    expect([...planFlush([51, 0], 100)]).toEqual([0x1b, J, 49, ...CUT, 0x1b, J, 51, ...CUT]);
    expect(planFlush([], 100).length).toBe(0);
  });
  it("feeds the eject distance after the last cut, without cutting it", () => {
    expect([...planFlush([51, 0], 100, 85)]).toEqual([0x1b, J, 49, ...CUT, 0x1b, J, 51, ...CUT, 0x1b, J, 85]);
  });
  it("splits feeds longer than 255 units", () => {
    expect([...feed(300)]).toEqual([0x1b, J, 255, 0x1b, J, 45]);
  });
});

describe("dispatchTspl tight mode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  let printer = 0;
  // A fresh printer name per test, since the paper state is kept per printer.
  const setup = () => {
    const name = `BIXOLON SRP-275III #${++printer}`;
    const lookup = (): PrinterLookup => ({
      kind: "os",
      record: { name, language: "ESC_POS", mediaWidthMm: 76, mediaHeightMm: null, mediaKind: null, isDefault: false, online: true },
    });
    const req = (copies = 1): PrintRequest => ({
      printerName: name,
      language: "TSPL",
      payloadBase64: Buffer.from(TAG).toString("base64"),
      copies,
      jobRef: 1,
    });
    const sent: Buffer[] = [];
    const sendLocalRaw = vi.fn(async (_n: string, p: Buffer) => void sent.push(p));
    return { name, lookup, req, sent, sendLocalRaw };
  };
  const settings = () => ({ cutMode: "tight" as const, cutterGapMm: 40 });
  const gap = Math.round(40 / MOTION_MM);
  // TAG: 3 rows (60) + 6 margin = 66, taller than its 9 mm (51) label.
  const pitch = 3 * LINE_UNITS + 6;

  it("feeds one tag per tag, then flushes the batch out after idle", async () => {
    const { lookup, req, sent, sendLocalRaw } = setup();
    const r1 = await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    const r2 = await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    expect(r1).toEqual({ dispatched: true, copiesAcknowledged: 1 });
    expect(r2).toEqual({ dispatched: true, copiesAcknowledged: 1 });
    expect(sent.map(fed)).toEqual([pitch, pitch]);
    expect(sent).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(IDLE_FLUSH_MS + 10);
    expect(sent).toHaveLength(3);
    // The flush brings the last tag's bottom edge to the cutter (one gap), then
    // carries the cut slip out of the cover.
    expect(fed(sent[2])).toBe(gap + mmToUnits(EJECT_MM));
    // Edges: top of tag 1 (the blank strip ahead of it), tag1|tag2, bottom of tag 2.
    expect(sent.map(cutCount).reduce((a, b) => a + b)).toBe(3);
  });

  it("a second tag within the idle window restarts the flush timer", async () => {
    const { lookup, req, sent, sendLocalRaw } = setup();
    await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    await vi.advanceTimersByTimeAsync(1000);
    await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600);
    expect(sent).toHaveLength(3);
  });

  it("prints copies as separate tags in one send", async () => {
    const { lookup, req, sent, sendLocalRaw } = setup();
    const r = await dispatchTspl(req(3), { sendLocalRaw, lookup, settings });
    expect(r).toEqual({ dispatched: true, copiesAcknowledged: 3 });
    expect(sent).toHaveLength(1);
    expect(fed(sent[0])).toBe(3 * pitch);
  });

  it("flushes pending tags before a receipt on the same printer", async () => {
    const { name, lookup, req, sent, sendLocalRaw } = setup();
    await dispatchTspl(req(), { sendLocalRaw, lookup, settings });
    await dispatchEscpos(
      { printerName: name, language: "ESC_POS", payloadBase64: Buffer.from("receipt\n").toString("base64"), copies: 1, jobRef: 2 },
      { sendLocalRaw, lookup, settings: () => ({}) },
    );
    expect(sent).toHaveLength(3);
    expect(fed(sent[1])).toBe(gap); // the flush, ahead of the receipt
    expect(sent[2].toString("latin1")).toContain("receipt");
    await vi.advanceTimersByTimeAsync(IDLE_FLUSH_MS + 10);
    expect(sent).toHaveLength(3); // nothing left to flush
  });

  it("without cutterGapMm it keeps the normal feed-then-cut path", async () => {
    const { lookup, req, sent, sendLocalRaw } = setup();
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
