import { contextBridge, ipcRenderer } from "electron";
import type { NetworkPrinter } from "../shared/protocol";

contextBridge.exposeInMainWorld("bridge", {
  addNetworkPrinter: (p: NetworkPrinter): Promise<{ added: true } | { error: string }> =>
    ipcRenderer.invoke("add-network-printer", p),
});
