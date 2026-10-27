import { z } from "zod";
import { ErrorCode } from "./error-codes";

export const PairRequest = z.object({
  tenantId: z.number().int().positive(),
  orgUnitId: z.number().int().positive(),
  token: z.string().min(32),
  /**
   * The web origin this Bridge answers to. Required, and still the primary:
   * every pairing has exactly one origin it was created from.
   */
  tenantOrigin: z.string().url(),
  /**
   * Further origins the same install may be driven from.
   *
   * <p>One counter can legitimately be reached at more than one hostname —
   * a tenant on a custom domain who also uses the platform domain, or a
   * single machine serving two brands of the same platform. The Bridge used
   * to allow exactly one, so the second hostname failed CORS on every route
   * but /pair: the browser blocked the request, fetch threw, and the web app
   * reported the Bridge "offline" while it sat there running and never saw
   * the call. Nothing appeared in any log, on either side.
   *
   * <p>Optional so an older pairing payload — and the QR codes already
   * printed from it — keep working untouched. Still a strict allow-list:
   * this widens it by named origins, never to a wildcard.
   */
  tenantOrigins: z.array(z.string().url()).max(10).optional(),
});
export type PairRequest = z.infer<typeof PairRequest>;

/**
 * Per-printer tuning kept in the Bridge's own store (set from the prefs
 * window, never by the web app). Every field is optional: unset means the
 * printer behaves exactly as before.
 */
export const PrinterSettings = z.object({
  /** Print upside-down: for printers mounted/held the other way up (e.g. Bluetooth). */
  rotate180: z.boolean().optional(),
  /**
   * "partial": feed to the cutter then cut after every tag (leaves the
   * head-to-cutter gap as a blank above each tag).
   * "none": no cut, one continuous strip.
   * "tight": gap-free slips on an auto-cutter receipt printer — each tag is cut
   * one tag late, at its top edge. Needs cutterGapMm.
   */
  cutMode: z.enum(["none", "partial", "tight"]).optional(),
  /** Distance from the print head to the cutter in mm (measure the blank above a printed tag). */
  cutterGapMm: z.number().min(5).max(100).optional(),
  /** Print darkness on the TSPL scale, 0-15 (mapped to ZPL ~SD 0-30). Not used for ESC/POS. */
  density: z.number().int().min(0).max(15).optional(),
});
export type PrinterSettings = z.infer<typeof PrinterSettings>;

// The three settings are additive and optional so a backend that predates them
// keeps parsing /printers and /health unchanged.
export const LoadedPrinter = z
  .object({
    name: z.string(),
    language: z.enum(["PDF", "ZPL", "ESC_POS", "TSPL"]),
    mediaWidthMm: z.number().nullable(),
    mediaHeightMm: z.number().nullable(),
    mediaKind: z.string().nullable(),
    isDefault: z.boolean(),
    online: z.boolean(),
  })
  .merge(PrinterSettings);
export type LoadedPrinter = z.infer<typeof LoadedPrinter>;

export const HealthError = z.object({
  ts: z.number(),
  msg: z.string(),
  code: z.string().optional(),
});
export type HealthError = z.infer<typeof HealthError>;

export const HealthResponse = z.object({
  version: z.string(),
  os: z.string(),
  loadedPrinters: z.array(LoadedPrinter),
  tenantId: z.number().nullable(),
  orgUnitId: z.number().nullable(),
  uptimeSeconds: z.number(),
  recentErrors: z.array(HealthError).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ErrorResponse = z.object({
  error: z.string(),
  errorCode: z.nativeEnum(ErrorCode),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const PrintLanguage = z.enum(["PDF", "ZPL", "ESC_POS", "TSPL"]);
export type PrintLanguage = z.infer<typeof PrintLanguage>;

export const PrintRequest = z.object({
  printerName: z.string().min(1),
  language: PrintLanguage,
  payloadBase64: z.string().min(1),
  copies: z.number().int().min(1).max(99),
  jobRef: z.number().int().nonnegative(),
});
export type PrintRequest = z.infer<typeof PrintRequest>;

export const PrintSuccessResponse = z.object({
  dispatched: z.literal(true),
  copiesAcknowledged: z.number().int().nonnegative(),
});
export type PrintSuccessResponse = z.infer<typeof PrintSuccessResponse>;

export const PrintFailureResponse = z.object({
  dispatched: z.literal(false),
  copiesAcknowledged: z.literal(0),
  error: z.string(),
  errorCode: z.nativeEnum(ErrorCode),
});
export type PrintFailureResponse = z.infer<typeof PrintFailureResponse>;

export const TestPrintRequest = z.object({
  printerName: z.string().min(1),
});
export type TestPrintRequest = z.infer<typeof TestPrintRequest>;

export const NetworkPrinter = z.object({
  name: z.string().min(1),
  ip: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  language: PrintLanguage,
  mediaWidthMm: z.number().nullable(),
  mediaHeightMm: z.number().nullable(),
  mediaKind: z.string().nullable(),
});
export type NetworkPrinter = z.infer<typeof NetworkPrinter>;
