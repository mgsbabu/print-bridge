// Rotates a TSPL label 180° by rewriting the objects themselves, for label printers
// that ignore the DIRECTION command (e.g. the Unnati's Bluetooth unit, "BP-Label203").
//
// Every object is rotated 180° about the label centre. TEXT / QRCODE / BARCODE are
// anchored at their top-left corner and rotate about it, so the new anchor is
// (W - x, H - y) with the rotation parameter advanced by 180. BAR and BOX are plain
// rectangles and are mirrored through the centre. Anything else that can't be
// rotated this way (BITMAP, BLOCK, ...) makes the whole job fall back to the
// DIRECTION flip: a half-rotated label would be worse than none.

const DOTS_PER_MM = 8; // 203 dpi

const SETUP_COMMANDS = new Set([
  "SIZE", "GAP", "BLINE", "DIRECTION", "CLS", "DENSITY", "SPEED", "SET", "CODEPAGE",
  "PRINT", "REFERENCE", "OFFSET", "SHIFT", "FEED", "BACKFEED", "BACKUP", "FORMFEED",
  "HOME", "SOUND", "LIMITFEED", "SELFTEST", "EOP", "INITIALPRINTER",
]);

const TEXT_RE = /^(TEXT\s+)(-?\d+)(\s*,\s*)(-?\d+)(\s*,\s*"[^"]*"\s*,\s*)(\d+)(.*)$/i;
const QR_RE = /^(QRCODE\s+)(-?\d+)(\s*,\s*)(-?\d+)(\s*,\s*\w+\s*,\s*\d+\s*,\s*\w+\s*,\s*)(\d+)(.*)$/i;
const BARCODE_RE =
  /^(BARCODE\s+)(-?\d+)(\s*,\s*)(-?\d+)(\s*,\s*"[^"]*"\s*,\s*\d+\s*,\s*\d+\s*,\s*)(\d+)(.*)$/i;
const BAR_RE = /^(BAR\s+)(-?\d+)(\s*,\s*)(-?\d+)(\s*,\s*)(-?\d+)(\s*,\s*)(-?\d+)(.*)$/i;
const BOX_RE = /^(BOX\s+)(-?\d+)(\s*,\s*)(-?\d+)(\s*,\s*)(-?\d+)(\s*,\s*)(-?\d+)(.*)$/i;

export interface RotateResult {
  tspl: string;
  objects: number;
}

// null when the label can't be rotated by rewriting (unknown size, unsupported object).
export function rotateTspl180(tspl: string): RotateResult | null {
  const size = /^\s*SIZE\s+([\d.]+)\s*mm\s*,\s*([\d.]+)\s*mm/im.exec(tspl);
  if (!size) return null;
  const w = Math.round(parseFloat(size[1]) * DOTS_PER_MM);
  const h = Math.round(parseFloat(size[2]) * DOTS_PER_MM);
  if (!(w > 0 && h > 0)) return null;

  let objects = 0;
  const out: string[] = [];
  for (const raw of tspl.split("\n")) {
    const cr = raw.endsWith("\r") ? "\r" : "";
    const line = cr ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();
    if (trimmed === "") {
      out.push(raw);
      continue;
    }
    const command = /^[A-Za-z]+/.exec(trimmed)?.[0].toUpperCase() ?? "";
    if (SETUP_COMMANDS.has(command)) {
      out.push(raw);
      continue;
    }
    let m = TEXT_RE.exec(trimmed) ?? QR_RE.exec(trimmed) ?? BARCODE_RE.exec(trimmed);
    if (m) {
      const rot = (Number(m[6]) + 180) % 360;
      out.push(`${m[1]}${w - Number(m[2])}${m[3]}${h - Number(m[4])}${m[5]}${rot}${m[7]}${cr}`);
      objects++;
      continue;
    }
    m = BAR_RE.exec(trimmed);
    if (m) {
      const [x, y, bw, bh] = [Number(m[2]), Number(m[4]), Number(m[6]), Number(m[8])];
      out.push(`${m[1]}${w - x - bw}${m[3]}${h - y - bh}${m[5]}${bw}${m[7]}${bh}${m[9]}${cr}`);
      objects++;
      continue;
    }
    m = BOX_RE.exec(trimmed);
    if (m) {
      const [x1, y1, x2, y2] = [Number(m[2]), Number(m[4]), Number(m[6]), Number(m[8])];
      out.push(`${m[1]}${w - x2}${m[3]}${h - y2}${m[5]}${w - x1}${m[7]}${h - y1}${m[9]}${cr}`);
      objects++;
      continue;
    }
    return null; // an object we can't rotate (BITMAP, BLOCK, CIRCLE, ...)
  }
  return { tspl: out.join("\n"), objects };
}
