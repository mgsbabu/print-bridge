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

export const LoadedPrinter = z.object({
  name: z.string(),
  language: z.enum(["PDF", "ZPL", "ESC_POS", "TSPL"]),
  mediaWidthMm: z.number().nullable(),
  mediaHeightMm: z.number().nullable(),
  mediaKind: z.string().nullable(),
  isDefault: z.boolean(),
  online: z.boolean(),
});
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
