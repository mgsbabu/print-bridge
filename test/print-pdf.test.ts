import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import fs from "node:fs/promises";
import { dispatchPdf } from "../src/main/dispatcher/pdf";
import type { PrintRequest } from "../src/shared/protocol";

function makeSamplePdfBase64(): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [141.7, 42.5] }); // 50×15mm in PDF points
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    doc.on("error", reject);
    doc.fontSize(8).text("BRIDGE OK 2026-05-12 18:55", 10, 14);
    doc.end();
  });
}

describe("dispatchPdf with a PDFKit-generated 50×15mm sample", () => {
  it("writes a real PDF to tmpfile, calls printFn with the right args, cleans up", async () => {
    const payloadBase64 = await makeSamplePdfBase64();
    const req: PrintRequest = {
      printerName: "Zebra-ZD220",
      language: "PDF",
      payloadBase64,
      copies: 3,
      jobRef: 482,
    };

    let observedPath: string | null = null;
    let observedOptions: Record<string, unknown> | null = null;
    let pdfBytesAtPrintTime: Buffer | null = null;

    const result = await dispatchPdf(req, async (pdfPath, options) => {
      observedPath = pdfPath;
      observedOptions = options as Record<string, unknown>;
      pdfBytesAtPrintTime = await fs.readFile(pdfPath);
    });

    expect(result).toEqual({ dispatched: true, copiesAcknowledged: 3 });
    expect(observedPath).toMatch(/bridge-.*\.pdf$/);
    expect(observedOptions).toEqual({ printer: "Zebra-ZD220", copies: 3 });
    expect(pdfBytesAtPrintTime?.subarray(0, 5).toString()).toBe("%PDF-");

    // tmpfile cleaned up after dispatch
    await expect(fs.access(observedPath!)).rejects.toThrow();
  });

  it("returns PRINTER_OFFLINE when the print fn rejects with 'offline'", async () => {
    const payloadBase64 = await makeSamplePdfBase64();
    const result = await dispatchPdf(
      {
        printerName: "Zebra-ZD220",
        language: "PDF",
        payloadBase64,
        copies: 1,
        jobRef: 1,
      },
      async () => {
        throw new Error("Printer is offline");
      },
    );
    expect(result).toEqual({
      dispatched: false,
      copiesAcknowledged: 0,
      error: "Printer is offline",
      errorCode: "PRINTER_OFFLINE",
    });
  });
});
