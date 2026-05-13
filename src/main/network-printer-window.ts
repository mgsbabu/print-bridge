import { BrowserWindow, app } from "electron";
import path from "node:path";

let win: BrowserWindow | null = null;

export function openNetworkPrinterWindow(): void {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "Add Network Printer",
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "main", "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(app.getAppPath(), "src", "renderer", "network-printer.html"));
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
}
