import { contextBridge, ipcRenderer } from "electron";
import type { NetworkPrinter } from "../shared/protocol";
import type { JobRow } from "./jobs/repository";

contextBridge.exposeInMainWorld("bridge", {
  addNetworkPrinter: (p: NetworkPrinter): Promise<{ added: true } | { error: string }> =>
    ipcRenderer.invoke("add-network-printer", p),
  listRecentJobs: (limit?: number): Promise<JobRow[]> =>
    ipcRenderer.invoke("list-recent-jobs", limit ?? 100),
});
