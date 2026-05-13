import Store from "electron-store";
import { safeStorage } from "electron";
import type { NetworkPrinter } from "../shared/protocol";

export interface PairingRecord {
  tenantId: number;
  orgUnitId: number;
  token: string;
  tenantOrigin: string;
}

interface PersistedShape {
  pairing?: {
    tenantId: number;
    orgUnitId: number;
    tokenEnc: string;
    tenantOrigin: string;
  };
  networkPrinters?: NetworkPrinter[];
}

const store = new Store<PersistedShape>({ name: "bridge" });

export function getPairing(): PairingRecord | null {
  const p = store.get("pairing");
  if (!p) return null;
  const token = safeStorage.decryptString(Buffer.from(p.tokenEnc, "base64"));
  return {
    tenantId: p.tenantId,
    orgUnitId: p.orgUnitId,
    token,
    tenantOrigin: p.tenantOrigin,
  };
}

export function setPairing(p: PairingRecord): void {
  const tokenEnc = safeStorage.encryptString(p.token).toString("base64");
  store.set("pairing", {
    tenantId: p.tenantId,
    orgUnitId: p.orgUnitId,
    tokenEnc,
    tenantOrigin: p.tenantOrigin,
  });
}

export function clearPairing(): void {
  store.delete("pairing");
}

export function getNetworkPrinters(): NetworkPrinter[] {
  return store.get("networkPrinters") ?? [];
}

export function addNetworkPrinter(p: NetworkPrinter): void {
  const existing = getNetworkPrinters().filter((x) => x.name !== p.name);
  store.set("networkPrinters", [...existing, p]);
}

export function removeNetworkPrinter(name: string): void {
  store.set(
    "networkPrinters",
    getNetworkPrinters().filter((x) => x.name !== name),
  );
}
