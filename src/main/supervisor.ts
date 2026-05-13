import type http from "node:http";
import type { ErrorRing } from "./error-ring";
import { log } from "./logger";

export interface SupervisorDeps {
  start: () => http.Server;
  errorRing: ErrorRing;
  minRestartIntervalMs?: number;
  timers?: { setTimeout: typeof setTimeout };
}

/**
 * Holds the live http.Server and restarts it cleanly if the main
 * process emits uncaughtException / unhandledRejection. Electron, the
 * tray, the jobs db, and the pairing all stay untouched — only the
 * HTTP layer comes back up.
 *
 * Restarts are throttled by minRestartIntervalMs (default 5s) so a
 * hot crash loop does not pin the CPU.
 */
export class HttpSupervisor {
  private current: http.Server;
  private lastRestartAt = 0;
  private restarting = false;
  private readonly minRestartIntervalMs: number;
  private readonly timer: { setTimeout: typeof setTimeout };

  constructor(private readonly deps: SupervisorDeps) {
    this.minRestartIntervalMs = deps.minRestartIntervalMs ?? 5000;
    this.timer = deps.timers ?? { setTimeout };
    this.current = deps.start();
  }

  handleCrash(err: unknown, code = "UNCAUGHT"): void {
    this.deps.errorRing.record(err, code);
    log.error({ err }, `bridge crash (${code}); restarting HTTP server`);
    if (this.restarting) return;
    this.restarting = true;
    const since = Date.now() - this.lastRestartAt;
    const delay = Math.max(this.minRestartIntervalMs - since, 0);
    this.timer.setTimeout(() => {
      try {
        this.current.close();
        this.current = this.deps.start();
        this.lastRestartAt = Date.now();
        log.info("HTTP server restarted");
      } catch (e) {
        log.error({ err: e }, "HTTP server restart failed");
      } finally {
        this.restarting = false;
      }
    }, delay);
  }

  server(): http.Server {
    return this.current;
  }
}
