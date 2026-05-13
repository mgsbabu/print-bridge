import { autoUpdater } from "electron-updater";
import { log } from "./logger";

export interface UpdaterDeps {
  /**
   * Returns true when the bridge has no recent print activity and is
   * safe to restart. The idle-watcher polls this; quitAndInstall only
   * fires when it returns true.
   */
  isIdle: () => boolean;
  /** Inject for testing; defaults to global setTimeout/setInterval. */
  timers?: {
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
  };
}

export const STARTUP_CHECK_MS = 30_000;
export const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000;
export const IDLE_POLL_MS = 30_000;

export function startAutoUpdate(deps: UpdaterDeps): void {
  const t = deps.timers ?? { setTimeout, setInterval };

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let updateDownloaded = false;

  autoUpdater.on("checking-for-update", () => log.info("auto-update: checking"));
  autoUpdater.on("update-available", (info) =>
    log.info({ version: info.version }, "auto-update: available"),
  );
  autoUpdater.on("update-not-available", () => log.debug("auto-update: nothing newer"));
  autoUpdater.on("download-progress", (p) =>
    log.debug({ percent: p.percent }, "auto-update: download progress"),
  );
  autoUpdater.on("error", (err) => log.warn({ err }, "auto-update: error"));

  autoUpdater.on("update-downloaded", (info) => {
    log.info({ version: info.version }, "auto-update: downloaded, waiting for idle");
    updateDownloaded = true;
  });

  t.setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) =>
      log.warn({ err }, "auto-update: initial check failed"),
    );
  }, STARTUP_CHECK_MS);

  t.setInterval(() => {
    autoUpdater
      .checkForUpdates()
      .catch((err) => log.warn({ err }, "auto-update: periodic check failed"));
  }, PERIODIC_CHECK_MS);

  t.setInterval(() => {
    if (!updateDownloaded) return;
    if (!deps.isIdle()) return;
    log.info("auto-update: bridge idle, applying update");
    autoUpdater.quitAndInstall();
  }, IDLE_POLL_MS);
}
