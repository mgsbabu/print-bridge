import { create as createQr } from "qrcode";

// Tag jobs reach the bridge as TSPL. When the chosen printer is a receipt
// printer (e.g. BIXOLON SRP-275III) it has no TSPL interpreter and prints the
// commands as text. This renders the same TEXT / QRCODE / BARCODE elements as
// a plain ESC/POS tag so the job still comes out as a tag.

const ESC = 0x1b;
const GS = 0x1d;
const DOTS_PER_MM = 8; // 203 dpi, same as the label printers
const DEFAULT_LABEL_WIDTH_DOTS = 305; // 38.1 mm
const TAG_COLS = 21; // 38 mm of a 76 mm roll at 40 cols/76 mm
const BIG_MULTIPLIER = 12; // TSPL x/y multiplier at or above this prints double size
const QR_MODULE_DOTS = 3;

type Item =
  | { kind: "text"; x: number; y: number; big: boolean; text: string }
  | { kind: "qr"; x: number; y: number; data: string; ecc: "L" | "M" | "Q" | "H" };

const unescape = (s: string): string => s.replace(/\\(.)/g, "$1");
const ascii = (s: string): string => s.replace(/[^\x20-\x7e]/g, "?");

const TEXT_RE =
  /^TEXT\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*"[^"]*"\s*,\s*\d+\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:[^"\\]|\\.)*)"/i;
const QR_RE =
  /^QRCODE\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\w)\s*,\s*\d+\s*,\s*\w+\s*,\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"/i;
const BARCODE_RE =
  /^BARCODE\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*"[^"]*"\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"/i;

function parse(tspl: string): { items: Item[]; widthDots: number } {
  const items: Item[] = [];
  let widthDots = DEFAULT_LABEL_WIDTH_DOTS;
  for (const raw of tspl.split(/\r?\n/)) {
    const line = raw.trim();
    const size = /^SIZE\s+([\d.]+)/i.exec(line);
    if (size) {
      widthDots = Math.round(parseFloat(size[1]) * DOTS_PER_MM);
      continue;
    }
    let m = TEXT_RE.exec(line);
    if (m) {
      const big = Math.max(Number(m[3]), Number(m[4])) >= BIG_MULTIPLIER;
      items.push({ kind: "text", x: +m[1], y: +m[2], big, text: ascii(unescape(m[5])) });
      continue;
    }
    m = QR_RE.exec(line);
    if (m) {
      const ecc = m[3].toUpperCase();
      items.push({
        kind: "qr",
        x: +m[1],
        y: +m[2],
        ecc: ecc === "L" || ecc === "Q" || ecc === "H" ? ecc : "M",
        data: unescape(m[4]),
      });
      continue;
    }
    m = BARCODE_RE.exec(line);
    if (m) items.push({ kind: "text", x: +m[1], y: +m[2], big: false, text: ascii(unescape(m[3])) });
  }
  return { items, widthDots };
}

function qrRaster(data: string, ecc: "L" | "M" | "Q" | "H"): Buffer {
  const { size, data: modules } = createQr(data, { errorCorrectionLevel: ecc }).modules;
  const quiet = 1;
  const px = (size + quiet * 2) * QR_MODULE_DOTS;
  const rowBytes = Math.ceil(px / 8);
  const bitmap = Buffer.alloc(rowBytes * px);
  for (let y = 0; y < px; y++) {
    const my = Math.floor(y / QR_MODULE_DOTS) - quiet;
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / QR_MODULE_DOTS) - quiet;
      if (mx >= 0 && my >= 0 && mx < size && my < size && modules[my * size + mx]) {
        bitmap[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  // GS v 0 m xL xH yL yH d...
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, px & 0xff, px >> 8]),
    bitmap,
  ]);
}

// Returns null when the stream has nothing renderable (so the caller can fail
// fast instead of feeding a blank slip).
export function tsplToEscpos(tspl: string): Buffer | null {
  const { items, widthDots } = parse(tspl);
  if (items.length === 0) return null;
  items.sort((a, b) => a.y - b.y || a.x - b.x);

  const out: Buffer[] = [Buffer.from([ESC, 0x40])]; // init
  const align = (n: number): void => void out.push(Buffer.from([ESC, 0x61, n]));
  const lf = Buffer.from("\n");

  for (let i = 0; i < items.length; ) {
    const first = items[i];
    if (first.kind === "qr") {
      align(1);
      out.push(qrRaster(first.data, first.ecc), lf);
      i++;
      continue;
    }
    // Text items within ~10 dots vertically share one printed row.
    const row: Extract<Item, { kind: "text" }>[] = [];
    while (i < items.length) {
      const it = items[i];
      if (it.kind !== "text" || it.y - first.y > 10) break;
      row.push(it);
      i++;
    }
    const big = row.some((r) => r.big);
    const cols = big ? Math.floor(TAG_COLS / 2) : TAG_COLS;
    if (row.length === 1) {
      align(1);
      out.push(Buffer.from([GS, 0x21, big ? 0x11 : 0x00]), Buffer.from(row[0].text.slice(0, cols)), lf);
    } else {
      // Several items on one row: place each at its x position.
      align(0);
      const line = Array<string>(cols).fill(" ");
      for (const r of row) {
        const col = Math.min(
          Math.max(0, Math.round((r.x / widthDots) * cols)),
          Math.max(0, cols - r.text.length),
        );
        for (let k = 0; k < r.text.length && col + k < cols; k++) line[col + k] = r.text[k];
      }
      out.push(Buffer.from([GS, 0x21, big ? 0x11 : 0x00]), Buffer.from(line.join("").trimEnd()), lf);
    }
  }
  out.push(Buffer.from([GS, 0x21, 0x00]));
  align(0);
  return Buffer.concat(out);
}
