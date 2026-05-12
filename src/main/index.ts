import { app, Menu, Tray, nativeImage } from "electron";
import path from "node:path";

let tray: Tray | null = null;

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
  tray.setContextMenu(
    Menu.buildFromTemplate([{ label: "Quit", click: () => app.quit() }]),
  );
});

app.on("window-all-closed", () => {
  // Tray-only background app; never quit on window close.
});
