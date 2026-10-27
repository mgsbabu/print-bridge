import { BrowserWindow, app } from "electron";
import path from "node:path";

let win: BrowserWindow | null = null;

export function openPrinterSettingsWindow(): void {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 560,
    height: 560,
    minimizable: false,
    maximizable: false,
    title: "Printer Settings",
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "main", "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(app.getAppPath(), "src", "renderer", "printer-settings.html"));
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
}
