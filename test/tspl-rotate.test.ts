import { describe, it, expect, vi } from "vitest";
import { rotateTspl180 } from "../src/main/dispatcher/tspl-rotate";
import { dispatchTspl } from "../src/main/dispatcher/tspl";
import type { PrinterLookup } from "../src/main/dispatcher/printers";

const TAG = [
  "SIZE 38.1 mm,43.5 mm",
  "GAP 0 mm,0 mm",
  "DIRECTION 1",
  "CLS",
  'TEXT 76,0,"0",0,9,9,"UV Laundry"',
  'QRCODE 121,85,M,3,A,0,"ORD-26-2-1"',
  'BARCODE 16,300,"128",40,0,0,2,2,"ORD-26"',
  "BAR 10,20,100,4",
  "PRINT 1,1",
  "",
].join("\r\n");

describe("rotateTspl180", () => {
  it("moves every object through the label centre and adds 180 degrees", () => {
    // 38.1 mm x 43.5 mm at 8 dots/mm = 305 x 348
    const r = rotateTspl180(TAG)!;
    expect(r.objects).toBe(4);
    const lines = r.tspl.split("\r\n");
    expect(lines).toContain('TEXT 229,348,"0",180,9,9,"UV Laundry"');
    // a QR is mirrored to its new top-left corner but not rotated: 21 modules x 3 = 63 dots
    expect(lines).toContain('QRCODE 121,200,M,3,A,0,"ORD-26-2-1"');
    expect(lines).toContain('BARCODE 289,48,"128",40,0,180,2,2,"ORD-26"');
    expect(lines).toContain("BAR 195,324,100,4");
    expect(lines).toContain("DIRECTION 1"); // setup lines untouched
    expect(r.tspl.endsWith("\r\n")).toBe(true);
  });

  it("adds to an existing rotation", () => {
    const r = rotateTspl180('SIZE 10 mm,10 mm\nTEXT 8,8,"0",90,1,1,"x"\nPRINT 1\n')!;
    expect(r.tspl).toContain('TEXT 72,72,"0",270,1,1,"x"');
  });

  it("gives up on objects it can't rotate, or an unknown size", () => {
    expect(rotateTspl180(TAG.replace("PRINT", 'BITMAP 0,0,8,8,0,"abcdefgh"\r\nPRINT'))).toBeNull();
    expect(rotateTspl180(TAG.replace("SIZE 38.1 mm,43.5 mm", "SIZE 1.5,1.7"))).toBeNull();
  });
});

describe("dispatchTspl on BP-Label203", () => {
  const lookup = (): PrinterLookup => ({
    kind: "os",
    record: { name: "BP-Label203", language: "TSPL", mediaWidthMm: null, mediaHeightMm: null, mediaKind: null, isDefault: false, online: true },
  });
  const req = (tspl: string) => ({
    printerName: "BP-Label203",
    language: "TSPL" as const,
    payloadBase64: Buffer.from(tspl).toString("base64"),
    copies: 1,
    jobRef: 1,
  });

  it("rotates the content and leaves DIRECTION alone when rotate180 is on", async () => {
    const sendLocalRaw = vi.fn(async () => undefined);
    await dispatchTspl(req(TAG), { sendLocalRaw, lookup, settings: () => ({ rotate180: true }) });
    const sent = (sendLocalRaw.mock.calls[0] as unknown as [string, Buffer])[1].toString();
    expect(sent).toContain('TEXT 229,348,"0",180');
    expect(sent).toContain("DIRECTION 1");
    expect(sent).not.toContain("DIRECTION 0");
  });

  it("sends the label unchanged when rotate180 is off", async () => {
    const sendLocalRaw = vi.fn(async () => undefined);
    await dispatchTspl(req(TAG), { sendLocalRaw, lookup, settings: () => ({ rotate180: false }) });
    expect(((sendLocalRaw.mock.calls[0] as unknown as [string, Buffer])[1]).toString()).toContain('TEXT 76,0,"0",0');
  });

  it("falls back to flipping DIRECTION for a label it can't rotate", async () => {
    const sendLocalRaw = vi.fn(async () => undefined);
    const withBitmap = TAG.replace("PRINT", 'BITMAP 0,0,8,8,0,"abcdefgh"\r\nPRINT');
    await dispatchTspl(req(withBitmap), { sendLocalRaw, lookup, settings: () => ({ rotate180: true }) });
    expect(((sendLocalRaw.mock.calls[0] as unknown as [string, Buffer])[1]).toString()).toContain("DIRECTION 0");
  });
});
