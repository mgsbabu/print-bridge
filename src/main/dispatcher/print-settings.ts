import { PDFDocument, degrees } from "pdf-lib";
import type { PrinterSettings } from "../../shared/protocol";

// Applies a printer's per-printer settings (rotate180; density for TSPL/ZPL) to the payload
// each language dispatcher is about to send. cutMode is handled where the cut
// is added (dispatcher/escpos.ts).

export type SettingsLookup = (printerName: string) => PrinterSettings;

const ESC = 0x1b;

// Density is stored on the TSPL scale (0-15) and scaled to each language's own range.
const zplDensity = (d: number): number => Math.round((d / 15) * 30);

// Index just past the first ESC @ (initialise), or 0 when the stream has none.
function afterInit(payload: Buffer): number {
  for (let i = 0; i < payload.length - 1; i++) {
    if (payload[i] === ESC && payload[i + 1] === 0x40) return i + 2;
  }
  return 0;
}

export function applyEscposSettings(payload: Buffer, s: PrinterSettings): Buffer {
  const extra: number[] = [];
  if (s.rotate180) extra.push(ESC, 0x7b, 0x01); // ESC { 1: upside-down printing
  // No density here: the SRP-275III has no density command (its manual has no GS ( K),
  // and unknown commands may print as text. Density is TSPL/ZPL only.
  if (extra.length === 0) return payload;
  const at = afterInit(payload); // ESC @ resets both settings, so they go after it
  return Buffer.concat([payload.subarray(0, at), Buffer.from(extra), payload.subarray(at)]);
}

export function applyTsplSettings(tspl: string, s: PrinterSettings): string {
  let out = tspl;
  if (s.rotate180) {
    if (/^\s*DIRECTION\s+[01]/im.test(out)) {
      out = out.replace(/^(\s*DIRECTION\s+)([01])/im, (_m, p: string, d: string) => p + (d === "1" ? "0" : "1"));
    } else {
      // No DIRECTION sent means the default, 0; the opposite is 1.
      out = insertBeforeCls(out, "DIRECTION 1");
    }
  }
  if (s.density !== undefined) {
    if (/^\s*DENSITY\s+\d+/im.test(out)) out = out.replace(/^(\s*DENSITY\s+)\d+/im, `$1${s.density}`);
    else out = insertBeforeCls(out, `DENSITY ${s.density}`);
  }
  return out;
}

// Setup commands must precede CLS; fall back to right after SIZE.
function insertBeforeCls(tspl: string, line: string): string {
  const eol = tspl.includes("\r\n") ? "\r\n" : "\n";
  if (/^\s*CLS\b/im.test(tspl)) return tspl.replace(/^(\s*CLS\b)/im, `${line}${eol}$1`);
  return tspl.replace(/^(\s*SIZE[^\r\n]*)/im, `$1${eol}${line}`);
}

export function applyZplSettings(zpl: string, s: PrinterSettings): string {
  let out = zpl;
  if (s.rotate180) {
    out = out.replace(/\^FWN/g, "^FWI").replace(/\^XA/g, "^XA^POI");
  }
  if (s.density !== undefined) {
    // ~SD is a control command: it goes ahead of the format, not inside ^XA..^XZ.
    out = `~SD${String(zplDensity(s.density)).padStart(2, "0")}\n${out}`;
  }
  return out;
}

export async function rotatePdf180(pdf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  for (const page of doc.getPages()) {
    page.setRotation(degrees((page.getRotation().angle + 180) % 360));
  }
  return Buffer.from(await doc.save());
}
