import { describe, it, expect, vi } from "vitest";
import { dispatchTspl } from "../src/main/dispatcher/tspl";
import type { PrinterLookup } from "../src/main/dispatcher/printers";
import type { PrintRequest } from "../src/shared/protocol";

const TSPL = [
  "SIZE 38.1 mm,43.5 mm",
  "GAP 0 mm,0 mm",
  "DIRECTION 1",
  "CLS",
  'TEXT 76,0,"0",0,9,9,"UV Laundry"',
  'TEXT 91,37,"0",0,14,14,"ORD-26"',
  'TEXT 16,210,"0",0,9,9,"Laundry"',
  'TEXT 248,208,"0",0,9,9,"1/1"',
  'QRCODE 121,85,M,3,A,0,"ORD-26-2-1"',
  "PRINT 1,1",
].join("\r\n");

const req = (printerName: string): PrintRequest => ({
  printerName,
  language: "TSPL",
  payloadBase64: Buffer.from(TSPL).toString("base64"),
  copies: 1,
  jobRef: 1,
});

const os = (name: string, language: "TSPL" | "ESC_POS"): (() => PrinterLookup) => () => ({
  kind: "os",
  record: { name, language, mediaWidthMm: null, mediaHeightMm: null, mediaKind: null, isDefault: false, online: true },
});

describe("dispatchTspl", () => {
  it("flips DIRECTION for Unnati so the tag prints upright", async () => {
    const sendLocalRaw = vi.fn(async () => undefined);
    const name = "Unnati TT 203 DPI Premium";
    await dispatchTspl(req(name), { sendLocalRaw, lookup: os(name, "TSPL") });
    const sent = (sendLocalRaw.mock.calls[0][1] as unknown as Buffer).toString();
    expect(sent).toContain("DIRECTION 0");
    expect(sent).not.toContain("DIRECTION 1");
  });

  it("leaves other TSPL printers untouched", async () => {
    const sendLocalRaw = vi.fn(async () => undefined);
    await dispatchTspl(req("TSC TTP-244"), { sendLocalRaw, lookup: os("TSC TTP-244", "TSPL") });
    expect((sendLocalRaw.mock.calls[0][1] as unknown as Buffer).toString()).toBe(TSPL);
  });

  it("renders a TSPL tag as ESC/POS with a cut on the BIXOLON instead of printing the commands", async () => {
    const sendLocalRaw = vi.fn(async () => undefined);
    const name = "BIXOLON SRP-275III";
    const result = await dispatchTspl(req(name), { sendLocalRaw, lookup: os(name, "ESC_POS") });
    expect(result.dispatched).toBe(true);
    const sent = sendLocalRaw.mock.calls[0][1] as unknown as Buffer;
    const text = sent.toString("latin1");
    expect(text).not.toContain("SIZE");
    expect(text).not.toContain("TEXT ");
    expect(text).toContain("UV Laundry");
    expect(text).toContain("ORD-26");
    expect(sent.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(sent.includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(true); // QR raster
    expect(sent.subarray(-4)).toEqual(Buffer.from([0x1d, 0x56, 0x42, 0x03]));
  });
});

describe("barcode fitting", () => {
  it("shrinks and centres a Code 128 barcode that overflows a 38 mm label", async () => {
    const { fitTsplBarcodes } = await import("../src/main/dispatcher/tspl-fit");
    const out = fitTsplBarcodes('SIZE 38.1 mm,43.5 mm\r\nBARCODE 10,100,"128",60,0,0,3,3,"ORD-28"\r\nPRINT 1,1\r\n');
    const m = /BARCODE (\d+),100,"128",60,0,0,(\d+),3,"ORD-28"\r\n/.exec(out)!;
    const x = Number(m[1]);
    const narrow = Number(m[2]);
    const width = (11 * (6 + 2) + 13) * narrow; // 101 modules
    expect(narrow).toBeLessThan(3);
    expect(x + width).toBeLessThanOrEqual(305);
    expect(Math.abs(x - (305 - width - x))).toBeLessThanOrEqual(1); // centred
  });
});
