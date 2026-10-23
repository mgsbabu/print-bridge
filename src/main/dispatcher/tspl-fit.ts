// Keeps TSPL Code 128 barcodes inside the label and centred. The web app picks
// a module width and x without knowing the printer's real label width, so a
// longer order number overflows the right edge (clipped, unscannable) on 38 mm
// stock. We recompute: shrink the module width until the barcode plus its quiet
// zones fit, then centre it.

const DOTS_PER_MM = 8; // 203 dpi
const EDGE_MARGIN_DOTS = 8;
const QUIET_MODULES = 10;

const BARCODE_RE =
  /^BARCODE\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*"(128M?|EAN128)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*$/i;

// Upper bound of Code 128 width in modules: start + data + checksum (11 each) + stop (13).
// All-digit even-length content packs two digits per symbol (subset C).
export function code128Modules(content: string): number {
  const text = content.replace(/\\(.)/g, "$1");
  const symbols = /^\d+$/.test(text) && text.length % 2 === 0 ? text.length / 2 : text.length;
  return 11 * (symbols + 2) + 13;
}

export function fitTsplBarcodes(tspl: string): string {
  const widthMatch = /^SIZE\s+([\d.]+)/im.exec(tspl);
  if (!widthMatch) return tspl;
  const labelDots = Math.round(parseFloat(widthMatch[1]) * DOTS_PER_MM);
  if (!(labelDots > 0)) return tspl;

  return tspl
    .split("\n")
    .map((raw) => {
      const cr = raw.endsWith("\r") ? "\r" : "";
      const m = BARCODE_RE.exec(raw.trim());
      if (!m || m[6] !== "0") return raw; // only unrotated barcodes
      const modules = code128Modules(m[9]);
      let narrow = Math.max(1, Number(m[7]));
      const usable = labelDots - 2 * EDGE_MARGIN_DOTS;
      while (narrow > 1 && (modules + 2 * QUIET_MODULES) * narrow > usable) narrow--;
      const x = Math.max(0, Math.round((labelDots - modules * narrow) / 2));
      return `BARCODE ${x},${m[2]},"${m[3]}",${m[4]},${m[5]},${m[6]},${narrow},${m[8]},"${m[9]}"${cr}`;
    })
    .join("\n");
}
