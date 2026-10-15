import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPrinters, getDefaultPrinter } from "pdf-to-printer";
import type { LoadedPrinter, PrintLanguage, NetworkPrinter } from "../../shared/protocol";
import { getNetworkPrinters } from "../store";

let osCache: LoadedPrinter[] = [];

// BIXOLON SRP-275III: ESC/POS-compatible impression printer with an auto-cutter.
const BIXOLON_RE = /bixolon|\bsrp-?\d/i;

// Models known to have an auto-cutter; the ESC/POS dispatcher cuts after every
// job on these so each tag comes out separated.
export function hasAutoCutter(name: string): boolean {
  return BIXOLON_RE.test(name);
}

function inferLanguage(name: string): PrintLanguage {
  const n = name.toLowerCase();
  if (/zebra|^zd|^zt|^gx|^gk|^gc/.test(n)) return "ZPL";
  // Unnati TT 203 DPI: USB + Bluetooth label/barcode printer, TSPL.
  if (/\btsc\b|^ttp-|^te\d|^ta\d|^tx\d|^tdp-|\bunnati\b/.test(n)) return "TSPL";
  // BT-802: Bluetooth thermal bill/receipt printer (ESC/POS), not a label printer.
  if (BIXOLON_RE.test(n) || /tsp|tm-t|rongta|epson.*receipt|\bbt-?802\b/.test(n)) return "ESC_POS";
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
    mediaWidthMm: null,
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
  return [...osCache, ...network];
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
