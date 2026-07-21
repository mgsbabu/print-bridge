import type http from "node:http";
import type { ErrorRing } from "./error-ring";
import { log } from "./logger";

export interface SupervisorDeps {
  start: () => http.Server;
  errorRing: ErrorRing;
  minRestartIntervalMs?: number;
  maxRestartIntervalMs?: number;
  timers?: { setTimeout: typeof setTimeout };
}

/**
 * Holds the live http.Server and restarts it cleanly if the main
 * process emits uncaughtException / unhandledRejection, or if the
 * server itself emits 'error' (most commonly EADDRINUSE — something
 * else, often a not-yet-exited previous instance, is still holding
 * port 7755). Electron, the tray, the jobs db, and the pairing all
 * stay untouched — only the HTTP layer comes back up.
 *
 * Restarts back off exponentially between minRestartIntervalMs
 * (default 5s) and maxRestartIntervalMs (default 60s) per consecutive
 * failure, so a permanently occupied port doesn't hot-loop the CPU
 * and spam the error ring. The backoff resets once the server
 * successfully binds again.
 */
export class HttpSupervisor {
  private current: http.Server;
  private restarting = false;
  private consecutiveFailures = 0;
  private readonly minRestartIntervalMs: number;
  private readonly maxRestartIntervalMs: number;
  private readonly timer: { setTimeout: typeof setTimeout };

  constructor(private readonly deps: SupervisorDeps) {
    this.minRestartIntervalMs = deps.minRestartIntervalMs ?? 5000;
    this.maxRestartIntervalMs = deps.maxRestartIntervalMs ?? 60000;
    this.timer = deps.timers ?? { setTimeout };
    this.current = this.launch();
  }

  private launch(): http.Server {
    const server = this.deps.start();
    server.once("error", (err: NodeJS.ErrnoException) => {
      this.handleCrash(err, err.code === "EADDRINUSE" ? "PORT_IN_USE" : "SERVER_ERROR");
    });
    server.once("listening", () => {
      this.consecutiveFailures = 0;
    });
    return server;
  }

  handleCrash(err: unknown, code = "UNCAUGHT"): void {
    this.deps.errorRing.record(err, code);
    this.consecutiveFailures += 1;
    log.error({ err, code, attempt: this.consecutiveFailures }, `bridge crash (${code}); restarting HTTP server`);
    if (this.restarting) return;
    this.restarting = true;
    const delay = Math.min(
      this.minRestartIntervalMs * 2 ** (this.consecutiveFailures - 1),
      this.maxRestartIntervalMs,
    );
    this.timer.setTimeout(() => {
      try {
        this.current.close();
        this.current = this.launch();
        log.info({ delay }, "HTTP server restarted");
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
