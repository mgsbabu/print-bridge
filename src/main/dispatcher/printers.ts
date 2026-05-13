import { getPrinters, getDefaultPrinter } from "pdf-to-printer";
import type { LoadedPrinter } from "../../shared/protocol";

let cache: LoadedPrinter[] = [];

export async function refreshPrinters(): Promise<LoadedPrinter[]> {
  const [printers, def] = await Promise.all([getPrinters(), getDefaultPrinter().catch(() => null)]);
  const defaultName = def?.name ?? null;
  cache = printers.map((p) => ({
    name: p.name,
    language: "PDF",
    mediaWidthMm: null,
    mediaHeightMm: null,
    mediaKind: null,
    isDefault: p.name === defaultName,
    online: true,
  }));
  return cache;
}

export function getCachedPrinters(): LoadedPrinter[] {
  return cache;
}

export function findPrinter(name: string): LoadedPrinter | undefined {
  return cache.find((p) => p.name === name);
}
