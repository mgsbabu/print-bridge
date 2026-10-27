import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPrinters, getDefaultPrinter } from "pdf-to-printer";
import type { LoadedPrinter, PrintLanguage, NetworkPrinter } from "../../shared/protocol";
import { getNetworkPrinters, getPrinterSettings } from "../store";

let osCache: LoadedPrinter[] = [];

// BIXOLON SRP-275III: ESC/POS-compatible impression printer with an auto-cutter.
const BIXOLON_RE = /bixolon|\bsrp-?\d/i;

// Models known to have an auto-cutter; the ESC/POS dispatcher cuts after every
// job on these so each tag comes out separated.
export function hasAutoCutter(name: string): boolean {
  return BIXOLON_RE.test(name);
}

// Unnati TT 203 DPI prints TSPL rotated 180° with the TSC-style DIRECTION 1 the
// web app sends, so the TSPL dispatcher flips DIRECTION for it.
export function needsReversedDirection(name: string): boolean {
  return /\bunnati\b/i.test(name);
}

// The SRP-275III is an impact printer that only takes a 76 mm roll. Reported in
// /printers so the web app can lay receipts out for 76 mm (40 cols) vs 80 mm (48).
function defaultMediaWidthMm(name: string): number | null {
  return BIXOLON_RE.test(name) ? 76 : null;
}

function inferLanguage(name: string): PrintLanguage {
  const n = name.toLowerCase();
  // GODEX G500 (and other Godex): driven in ZPL emulation (GZPL) — set the
  // printer's language to ZPL/GZPL in Godex's config tool.
  if (/\bgodex\b|\bg-?[35]\d\d\b|\bez-?\d{3,4}/.test(n)) return "ZPL";
  if (/zebra|^zd|^zt|^gx|^gk|^gc/.test(n)) return "ZPL";
  // TSC TTP-244 / TTP-244 Pro / TE244 / TE244 Pro (also when the queue name drops
  // the "TSC" prefix), Unnati TT 203 DPI: TSPL label printers.
  if (/\btsc\b|\bttp[- ]?\d|\bte[- ]?\d{3}|^ta\d|^tx\d|^tdp-|\bunnati\b/.test(n)) return "TSPL";
  // Thermal bill/receipt printers (ESC/POS). BT-802 is Bluetooth, not a label printer.
  if (
    BIXOLON_RE.test(n) ||
    /\btsp\s?\d|\bmc-?print|\btm-[tum]\d|\bct-?s\d|\bpos-?\d{2}|\brp-?\d{3}|\bxp-?[a-z]?\d{2}|\bxprinter|\bposiflex|\bsewoo|\bsam4s|\bcustom\b.*\bk3|\bblack ?copper|\bzonerich|\bgprinter|\bgp-?\d{3,4}|rongta|thermal.*(receipt|pos)|receipt|epson.*receipt|\bbt-?802\b/.test(
      n,
    )
  )
    return "ESC_POS";
  // Everything else — laser/inkjet A4/A5 and any driver-only printer — prints the
  // PDF through the OS driver.
  return "PDF";
}

const execFileAsync = promisify(execFile);

// pdf-to-printer is Windows-only (it throws "Operating System not supported"
// elsewhere), so macOS/Linux enumerate CUPS destinations via lpstat instead.
async function listCupsPrinters(): Promise<{ names: string[]; defaultName: string | null }> {
  const [{ stdout: all }, def] = await Promise.all([
    execFileAsync("lpstat", ["-e"]),
    execFileAsync("lpstat", ["-d"]).catch(() => ({ stdout: "" })),
  ]);
  const names = all.split("\n").map((l) => l.trim()).filter(Boolean);
  const m = /system default destination:\s*(\S+)/i.exec(def.stdout);
  return { names, defaultName: m?.[1] ?? null };
}

async function listOsPrinters(): Promise<{ names: string[]; defaultName: string | null }> {
  if (process.platform !== "win32") return listCupsPrinters();
  const [printers, def] = await Promise.all([getPrinters(), getDefaultPrinter().catch(() => null)]);
  return { names: printers.map((p) => p.name), defaultName: def?.name ?? null };
}

export async function refreshPrinters(): Promise<LoadedPrinter[]> {
  const { names, defaultName } = await listOsPrinters();
  osCache = names.map((name) => ({
    name,
    language: inferLanguage(name),
    mediaWidthMm: defaultMediaWidthMm(name),
    mediaHeightMm: null,
    mediaKind: null,
    isDefault: name === defaultName,
    online: true,
  }));
  return getCachedPrinters();
}

export function getCachedPrinters(): LoadedPrinter[] {
  const network: LoadedPrinter[] = getNetworkPrinters().map((n) => ({
    name: n.name,
    language: n.language,
    mediaWidthMm: n.mediaWidthMm,
    mediaHeightMm: n.mediaHeightMm,
    mediaKind: n.mediaKind,
    isDefault: false,
    online: true,
  }));
  return [...osCache, ...network].map((p) => ({ ...p, ...getPrinterSettings(p.name) }));
}

export type PrinterLookup =
  | { kind: "os"; record: LoadedPrinter }
  | { kind: "network"; record: NetworkPrinter };

export function findPrinter(name: string): PrinterLookup | null {
  const network = getNetworkPrinters().find((p) => p.name === name);
  if (network) return { kind: "network", record: network };
  const os = osCache.find((p) => p.name === name);
  if (os) return { kind: "os", record: os };
  return null;
}
