import * as Sentry from "@sentry/electron/main";
import { scrub, scrubString } from "./scrub";
import { log } from "./logger";

export interface TelemetryOptions {
  dsn?: string;
  environment?: string;
  release?: string;
}

/**
 * Opt-in error telemetry. SENTRY_DSN unset → no init, no network
 * calls, no overhead. When set, every event and breadcrumb passes
 * through scrub() before transport so payloadBase64, X-Bridge-Token,
 * and the pairing token never leave the box.
 *
 * "Baked at build" pattern: a CI step writes the DSN into an env file
 * before electron-builder runs (see docs/SIGNING.md or TELEMETRY.md).
 * The build embeds it in the JS bundle. At runtime, process.env reads
 * the embedded constant.
 */
export function initTelemetry(opts: TelemetryOptions = {}): void {
  const dsn = opts.dsn ?? process.env.SENTRY_DSN;
  if (!dsn) {
    log.debug("telemetry: SENTRY_DSN unset; Sentry disabled");
    return;
  }
  Sentry.init({
    dsn,
    environment: opts.environment ?? (process.env.NODE_ENV ?? "production"),
    release: opts.release,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        breadcrumb.data = scrub(breadcrumb.data) as Record<string, unknown>;
      }
      if (typeof breadcrumb.message === "string") {
        breadcrumb.message = scrubString(breadcrumb.message);
      }
      return breadcrumb;
    },
    beforeSend(event) {
      return scrub(event) as typeof event;
    },
  });
  log.info("telemetry: Sentry initialized");
}
