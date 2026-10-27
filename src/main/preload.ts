import { contextBridge, ipcRenderer } from "electron";
import type { NetworkPrinter, LoadedPrinter, PrinterSettings } from "../shared/protocol";
import type { JobRow } from "./jobs/repository";

contextBridge.exposeInMainWorld("bridge", {
  addNetworkPrinter: (p: NetworkPrinter): Promise<{ added: true } | { error: string }> =>
    ipcRenderer.invoke("add-network-printer", p),
  listPrinterSettings: (): Promise<LoadedPrinter[]> => ipcRenderer.invoke("list-printer-settings"),
  setPrinterSettings: (name: string, settings: PrinterSettings): Promise<{ saved: true } | { error: string }> =>
    ipcRenderer.invoke("set-printer-settings", name, settings),
  listRecentJobs: (limit?: number): Promise<JobRow[]> =>
    ipcRenderer.invoke("list-recent-jobs", limit ?? 100),
});
