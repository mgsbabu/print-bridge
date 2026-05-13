import { app, Menu, Tray, nativeImage, ipcMain } from "electron";
import path from "node:path";
import { startServer, BRIDGE_PORT } from "./server";
import { getPairing, setPairing, clearPairing, addNetworkPrinter } from "./store";
import { openPairingWindow } from "./pair-window";
import { openNetworkPrinterWindow } from "./network-printer-window";
import { refreshPrinters, getCachedPrinters } from "./dispatcher/printers";
import { dispatchPdf } from "./dispatcher/pdf";
import { dispatchZpl } from "./dispatcher/zpl";
import { NetworkPrinter } from "../shared/protocol";
import { log } from "./logger";

let tray: Tray | null = null;
let reloadingPrinters = false;

function buildMenu(): Menu {
  const pairing = getPairing();
  const printers = getCachedPrinters();
  return Menu.buildFromTemplate([
    pairing
      ? { label: `Paired with tenant ${pairing.tenantId}`, enabled: false }
      : { label: "Pair with TailorApp", click: () => openPairingWindow() },
    pairing
      ? {
          label: "Unpair",
          click: () => {
            clearPairing();
            refreshMenu();
          },
        }
      : { label: "Unpair", enabled: false },
    { type: "separator" },
    {
      label: reloadingPrinters ? "Reloading printers…" : `Reload Printers (${printers.length} loaded)`,
      enabled: !reloadingPrinters,
      click: () => void reloadPrintersAndRefresh(),
    },
    { label: "Add Network Printer…", click: () => openNetworkPrinterWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

function refreshMenu(): void {
  tray?.setContextMenu(buildMenu());
}

async function reloadPrintersAndRefresh(): Promise<void> {
  reloadingPrinters = true;
  refreshMenu();
  try {
    const list = await refreshPrinters();
    log.info({ count: list.length }, "printers reloaded");
  } catch (err) {
    log.error({ err }, "printer enumeration failed");
  } finally {
    reloadingPrinters = false;
    refreshMenu();
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  const icon = nativeImage.createFromPath(
    path.join(app.getAppPath(), "assets", "tray-default.png"),
  );
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip("TailorApp Print Bridge");
  refreshMenu();

  ipcMain.handle("add-network-printer", (_event, payload) => {
    try {
      const p = NetworkPrinter.parse(payload);
      addNetworkPrinter(p);
      refreshMenu();
      return { added: true } as const;
    } catch (err) {
      return { error: err instanceof Error ? err.message : "invalid network printer" } as const;
    }
  });

  startServer({
    getPairing,
    setPairing: (p) => {
      setPairing(p);
      refreshMenu();
    },
    appVersion: app.getVersion(),
    listPrinters: getCachedPrinters,
    refreshPrinters,
    dispatchPdf: (req) => dispatchPdf(req),
    dispatchZpl: (req) => dispatchZpl(req),
  });

  log.info({ port: BRIDGE_PORT }, "bridge listening");
  void reloadPrintersAndRefresh();
});

app.on("window-all-closed", () => {
  // Tray-only background app; never quit on window close.
});
