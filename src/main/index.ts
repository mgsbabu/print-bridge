import { app, Menu, Tray, nativeImage } from "electron";
import path from "node:path";
import { startServer, BRIDGE_PORT } from "./server";
import { getPairing, setPairing, clearPairing } from "./store";
import { openPairingWindow } from "./pair-window";
import { log } from "./logger";

let tray: Tray | null = null;

function buildMenu(): Menu {
  const pairing = getPairing();
  return Menu.buildFromTemplate([
    pairing
      ? {
          label: `Paired with tenant ${pairing.tenantId}`,
          enabled: false,
        }
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
    { label: "Quit", click: () => app.quit() },
  ]);
}

function refreshMenu(): void {
  tray?.setContextMenu(buildMenu());
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

  startServer({
    getPairing,
    setPairing: (p) => {
      setPairing(p);
      refreshMenu();
    },
    appVersion: app.getVersion(),
  });

  log.info({ port: BRIDGE_PORT }, "bridge listening");
});

app.on("window-all-closed", () => {
  // Tray-only background app; never quit on window close.
});
