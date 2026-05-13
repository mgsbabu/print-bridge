export function buildZplSample(now: Date = new Date()): string {
  const ts = now.toISOString().replace("T", " ").slice(0, 16);
  return ["^XA", "^CF0,30", "^FO20,20^FDBRIDGE OK^FS", `^FO20,60^FD${ts}^FS`, "^XZ"].join("\n");
}
