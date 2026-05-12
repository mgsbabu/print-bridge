import { BrowserWindow, app } from "electron";
import path from "node:path";

let pairWindow: BrowserWindow | null = null;

export function openPairingWindow(): void {
  if (pairWindow && !pairWindow.isDestroyed()) {
    pairWindow.focus();
    return;
  }
  pairWindow = new BrowserWindow({
    width: 420,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "Pair with TailorApp",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  pairWindow.loadFile(path.join(app.getAppPath(), "src", "renderer", "pair.html"));
  pairWindow.once("ready-to-show", () => pairWindow?.show());
  pairWindow.on("closed", () => {
    pairWindow = null;
  });
}
