import { app, Menu, Tray, Notification, nativeImage, ipcMain } from "electron";
import path from "node:path";
import { startServer, BRIDGE_PORT, type JobRecorder } from "./server";
import { getPairing, setPairing, clearPairing, addNetworkPrinter, type PairingRecord } from "./store";
import { openPairingWindow } from "./pair-window";
import { openNetworkPrinterWindow } from "./network-printer-window";
import { openLogsWindow } from "./logs-window";
import { refreshPrinters, getCachedPrinters } from "./dispatcher/printers";
import { dispatchPdf } from "./dispatcher/pdf";
import { dispatchZpl } from "./dispatcher/zpl";
import { dispatchEscpos } from "./dispatcher/escpos";
import { NetworkPrinter } from "../shared/protocol";
import { openJobsDb } from "./jobs/db";
import { JobsRepository } from "./jobs/repository";
import { startAutoUpdate } from "./updater";
import { ErrorRing } from "./error-ring";
import { HttpSupervisor } from "./supervisor";
import { initTelemetry } from "./telemetry";
import { log } from "./logger";

initTelemetry();

const IDLE_WINDOW_MS = 2 * 60_000;

const STATUS_WINDOW_MS = 5 * 60_000;
const STATUS_REFRESH_MS = 30_000;

let tray: Tray | null = null;
let reloadingPrinters = false;
let jobsRepo: JobsRepository | null = null;
const errorRing = new ErrorRing();

function statusLabel(): string {
  if (!jobsRepo) return "Initializing…";
  const { total, succeeded, rate } = jobsRepo.getSuccessRate(STATUS_WINDOW_MS);
  if (total === 0) return "Idle — no jobs in last 5m";
  const tag = rate >= 0.95 ? "Healthy" : rate >= 0.8 ? "Degraded" : "Failing";
  return `${tag} — ${succeeded}/${total} succeeded last 5m`;
}

function buildMenu(): Menu {
  const pairing = getPairing();
  const printers = getCachedPrinters();
  return Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    { type: "separator" },
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
    { label: "Open Logs…", click: () => openLogsWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

function refreshMenu(): void {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(`TailorApp Print Bridge — ${statusLabel()}`);
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

  jobsRepo = new JobsRepository(openJobsDb());

  ipcMain.handle("list-recent-jobs", (_event, limit: number) =>
    jobsRepo?.listRecentJobs(limit) ?? [],
  );

  const jobRecorder: JobRecorder = {
    start: (printer, language, copies) => jobsRepo!.insertJob(printer, language, copies),
    finish: (id, copies, status, error) => jobsRepo?.updateJobResult(id, copies, status, error),
  };

  const serverDeps = {
    getPairing,
    setPairing: (p: PairingRecord) => {
      const wasUnpaired = getPairing() === null;
      setPairing(p);
      refreshMenu();
      if (wasUnpaired && Notification.isSupported()) {
        new Notification({
          title: "TailorApp Print Bridge",
          body: `Paired with tenant ${p.tenantId}`,
        }).show();
      }
    },
    appVersion: app.getVersion(),
    listPrinters: getCachedPrinters,
    refreshPrinters,
    dispatchPdf,
    dispatchZpl,
    dispatchEscpos,
    jobRecorder,
    errorRing,
  };

  const supervisor = new HttpSupervisor({
    start: () => startServer(serverDeps),
    errorRing,
  });

  process.on("uncaughtException", (err) => supervisor.handleCrash(err, "UNCAUGHT"));
  process.on("unhandledRejection", (err) => supervisor.handleCrash(err, "UNHANDLED_REJECTION"));

  log.info({ port: BRIDGE_PORT, server: supervisor.server().address() }, "bridge listening");
  void reloadPrintersAndRefresh();
  setInterval(refreshMenu, STATUS_REFRESH_MS);

  if (!app.isPackaged) {
    log.debug("auto-update: skipping in dev (electron-updater requires a packaged build)");
  } else {
    startAutoUpdate({
      isIdle: () => (jobsRepo?.getSuccessRate(IDLE_WINDOW_MS).total ?? 0) === 0,
    });
  }
});

app.on("window-all-closed", () => {
  // Tray-only background app; never quit on window close.
});
