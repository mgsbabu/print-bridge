export function buildZplSample(now: Date = new Date()): string {
  const ts = now.toISOString().replace("T", " ").slice(0, 16);
  return ["^XA", "^CF0,30", "^FO20,20^FDBRIDGE OK^FS", `^FO20,60^FD${ts}^FS`, "^XZ"].join("\n");
}

// ESC/POS control sequences:
//   ESC @       — initialize printer (1B 40)
//   ESC a 1     — center align (1B 61 01)
//   LF          — line feed (0A)
//   GS V 1      — paper cut, partial (1D 56 01)
//
// Cut is OPT-IN. Many entry-level thermal printers (e.g. the Epson TM-T82X,
// a tear-bar model) have NO auto-cutter; on those, GS V either no-ops or
// misbehaves and there's nothing to cut. So the default sample feeds a few
// blank lines to clear the head for a manual tear and does NOT cut. Callers
// with a known auto-cutter (TM-T82 / TM-T88) pass { cut: true }.
export function buildEscposSample(
  now: Date = new Date(),
  opts: { cut?: boolean } = {},
): Buffer {
  const ts = now.toISOString().replace("T", " ").slice(0, 16);
  const init = Buffer.from([0x1b, 0x40]);
  const center = Buffer.from([0x1b, 0x61, 0x01]);
  const lf = Buffer.from([0x0a]);
  const cut = Buffer.from([0x1d, 0x56, 0x01]);
  const parts = [
    init,
    center,
    Buffer.from("BRIDGE OK\n"),
    Buffer.from(`${ts}\n`),
    // Feed-to-tear: blank lines to push the last line past the tear bar so
    // the operator has something to grab on a cutter-less printer.
    lf,
    lf,
    lf,
    lf,
  ];
  if (opts.cut) parts.push(cut);
  return Buffer.concat(parts);
}
