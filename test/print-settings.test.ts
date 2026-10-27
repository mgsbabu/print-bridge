import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  applyEscposSettings,
  applyTsplSettings,
  applyZplSettings,
  rotatePdf180,
} from "../src/main/dispatcher/print-settings";
import { dispatchEscpos } from "../src/main/dispatcher/escpos";
import { dispatchTspl } from "../src/main/dispatcher/tspl";
import { dispatchZpl } from "../src/main/dispatcher/zpl";
import { dispatchPdf } from "../src/main/dispatcher/pdf";
import { describeEscpos } from "../src/main/dispatcher/escpos-fit";
import type { PrinterLookup } from "../src/main/dispatcher/printers";
import type { PrintRequest } from "../src/shared/protocol";

const osPrinter = (name: string, language: "ESC_POS" | "TSPL" | "ZPL" | "PDF"): PrinterLookup => ({
  kind: "os",
  record: { name, language, mediaWidthMm: null, mediaHeightMm: null, mediaKind: null, isDefault: false, online: true },
});
const b64 = (b: Buffer | string): string => Buffer.from(b).toString("base64");
const req = (printerName: string, language: PrintRequest["language"], payload: Buffer | string): PrintRequest => ({
  printerName,
  language,
  payloadBase64: b64(payload),
  copies: 1,
  jobRef: 1,
});

describe("applyEscposSettings", () => {
  const body = Buffer.from([0x1b, 0x40, 0x41, 0x42]);
  it("puts ESC { 1 right after ESC @", () => {
    expect([...applyEscposSettings(body, { rotate180: true })]).toEqual([0x1b, 0x40, 0x1b, 0x7b, 0x01, 0x41, 0x42]);
  });
  it("prepends when the stream has no ESC @", () => {
    expect([...applyEscposSettings(Buffer.from("AB"), { rotate180: true }).subarray(0, 3)]).toEqual([0x1b, 0x7b, 0x01]);
  });
  it("adds GS ( K density after ESC @", () => {
    const out = applyEscposSettings(body, { density: 15 });
    expect([...out.subarray(2, 9)]).toEqual([0x1d, 0x28, 0x4b, 0x02, 0x00, 0x30, 8]);
  });
  it("leaves the stream alone with no settings", () => {
    expect(applyEscposSettings(body, {})).toBe(body);
  });
});

describe("applyTsplSettings", () => {
  const tspl = "SIZE 40 mm,25 mm\r\nGAP 0 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nPRINT 1,1\r\n";
  it("flips DIRECTION", () => {
    expect(applyTsplSettings(tspl, { rotate180: true })).toContain("DIRECTION 0");
    expect(applyTsplSettings(tspl.replace("DIRECTION 1", "DIRECTION 0"), { rotate180: true })).toContain("DIRECTION 1");
  });
  it("inserts DIRECTION 1 before CLS when none was sent", () => {
    const out = applyTsplSettings("SIZE 40 mm,25 mm\nCLS\nPRINT 1\n", { rotate180: true });
    expect(out).toBe("SIZE 40 mm,25 mm\nDIRECTION 1\nCLS\nPRINT 1\n");
  });
  it("rewrites or inserts DENSITY", () => {
    expect(applyTsplSettings("SIZE 1 mm,1 mm\nDENSITY 8\nCLS\n", { density: 12 })).toContain("DENSITY 12");
    expect(applyTsplSettings("SIZE 1 mm,1 mm\nCLS\n", { density: 3 })).toContain("DENSITY 3\nCLS");
  });
});

describe("applyZplSettings", () => {
  it("inverts field orientation and the label", () => {
    expect(applyZplSettings("^XA^FWN^FO1,1^FDx^FS^XZ", { rotate180: true })).toBe("^XA^POI^FWI^FO1,1^FDx^FS^XZ");
  });
  it("sends ~SD ahead of the format, scaled to 0-30", () => {
    expect(applyZplSettings("^XA^XZ", { density: 15 })).toBe("~SD30\n^XA^XZ");
    expect(applyZplSettings("^XA^XZ", { density: 5 })).toBe("~SD10\n^XA^XZ");
  });
});

describe("rotatePdf180", () => {
  it("adds 180 degrees to every page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage().setRotation({ type: "degrees" as never, angle: 90 });
    const out = await PDFDocument.load(await rotatePdf180(Buffer.from(await doc.save())));
    expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([180, 270]);
  });
});

describe("dispatch wiring", () => {
  it("ESC/POS: Bixolon with cutMode none sends no cut; partial keeps feed-then-cut", async () => {
    const sent: Buffer[] = [];
    const sendLocalRaw = vi.fn(async (_n: string, p: Buffer) => void sent.push(p));
    const payload = Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from("hello\n"), Buffer.from([0x1d, 0x56, 0x00])]);
    const lookup = () => osPrinter("BIXOLON SRP-275III", "ESC_POS");
    await dispatchEscpos(req("BIXOLON SRP-275III", "ESC_POS", payload), { sendLocalRaw, lookup, settings: () => ({ cutMode: "none" }) });
    await dispatchEscpos(req("BIXOLON SRP-275III", "ESC_POS", payload), { sendLocalRaw, lookup, settings: () => ({}) });
    expect(sent[0].includes(Buffer.from([0x1d, 0x56]))).toBe(false);
    expect([...sent[1].subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x03]);
  });

  it("TSPL on a native printer flips DIRECTION and sets DENSITY", async () => {
    let sent = "";
    const sendLocalRaw = vi.fn(async (_n: string, p: Buffer) => void (sent = p.toString()));
    await dispatchTspl(req("TSC TTP-244", "TSPL", "SIZE 40 mm,25 mm\nDIRECTION 1\nCLS\nPRINT 1,1\n"), {
      sendLocalRaw,
      lookup: () => osPrinter("TSC TTP-244", "TSPL"),
      settings: () => ({ rotate180: true, density: 9 }),
    });
    expect(sent).toContain("DIRECTION 0");
    expect(sent).toContain("DENSITY 9");
  });

  it("ZPL gets rotated", async () => {
    let sent = "";
    const sendLocalRaw = vi.fn(async (_n: string, p: Buffer) => void (sent = p.toString()));
    await dispatchZpl(req("Zebra", "ZPL", "^XA^FWN^FDx^FS^XZ"), {
      sendLocalRaw,
      lookup: () => osPrinter("Zebra", "ZPL"),
      validate: async () => ({ ok: true }),
      settings: () => ({ rotate180: true }),
    });
    expect(sent).toBe("^XA^POI^FWI^FDx^FS^XZ");
  });

  it("PDF is rotated only when the printer has rotate180", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const pdf = Buffer.from(await doc.save());
    const seen: number[] = [];
    const printFn = vi.fn(async (file: string) => {
      const { readFile } = await import("node:fs/promises");
      seen.push((await PDFDocument.load(await readFile(file))).getPage(0).getRotation().angle);
    });
    await dispatchPdf(req("Laser", "PDF", pdf), printFn, () => ({ rotate180: true }));
    await dispatchPdf(req("Laser", "PDF", pdf), printFn, () => ({}));
    expect(seen).toEqual([180, 0]);
  });
});

describe("describeEscpos", () => {
  it("hides printable text but keeps control bytes", () => {
    const d = describeEscpos(Buffer.from([0x1b, 0x40, ...Buffer.from("SECRET ORDER"), 0x0a, 0x1d, 0x56, 0x42, 0x03]));
    expect(d).not.toContain("SECRET");
    expect(d).toContain("<text×13>");
    expect(d.endsWith("1d 56 42 03")).toBe(true);
  });
});
