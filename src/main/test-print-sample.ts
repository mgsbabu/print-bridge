export function buildZplSample(now: Date = new Date()): string {
  const ts = now.toISOString().replace("T", " ").slice(0, 16);
  return ["^XA", "^CF0,30", "^FO20,20^FDBRIDGE OK^FS", `^FO20,60^FD${ts}^FS`, "^XZ"].join("\n");
}

// ESC/POS control sequences:
//   ESC @       — initialize printer (1B 40)
//   ESC a 1     — center align (1B 61 01)
//   LF          — line feed (0A)
//   GS V 1      — paper cut, partial (1D 56 01)
export function buildEscposSample(now: Date = new Date()): Buffer {
  const ts = now.toISOString().replace("T", " ").slice(0, 16);
  const init = Buffer.from([0x1b, 0x40]);
  const center = Buffer.from([0x1b, 0x61, 0x01]);
  const lf = Buffer.from([0x0a]);
  const cut = Buffer.from([0x1d, 0x56, 0x01]);
  return Buffer.concat([
    init,
    center,
    Buffer.from("BRIDGE OK\n"),
    Buffer.from(`${ts}\n`),
    lf,
    lf,
    lf,
    cut,
  ]);
}
