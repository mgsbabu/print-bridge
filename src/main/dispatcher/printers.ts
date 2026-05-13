import { getPrinters, getDefaultPrinter } from "pdf-to-printer";
import type { LoadedPrinter, PrintLanguage, NetworkPrinter } from "../../shared/protocol";
import { getNetworkPrinters } from "../store";

let osCache: LoadedPrinter[] = [];

function inferLanguage(name: string): PrintLanguage {
  const n = name.toLowerCase();
  if (/zebra|^zd|^zt|^gx|^gk|^gc/.test(n)) return "ZPL";
  if (/tsp|tm-t|rongta|epson.*receipt/.test(n)) return "ESC_POS";
  return "PDF";
}

export async function refreshPrinters(): Promise<LoadedPrinter[]> {
  const [printers, def] = await Promise.all([getPrinters(), getDefaultPrinter().catch(() => null)]);
  const defaultName = def?.name ?? null;
  osCache = printers.map((p) => ({
    name: p.name,
    language: inferLanguage(p.name),
    mediaWidthMm: null,
    mediaHeightMm: null,
    mediaKind: null,
    isDefault: p.name === defaultName,
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
