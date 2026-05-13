import { BrowserWindow, app } from "electron";
import path from "node:path";

let win: BrowserWindow | null = null;

export function openLogsWindow(): void {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 880,
    height: 540,
    title: "Print Bridge — Recent Jobs",
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "main", "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(app.getAppPath(), "src", "renderer", "logs.html"));
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
}
