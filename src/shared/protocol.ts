import { z } from "zod";
import { ErrorCode } from "./error-codes";

export const PairRequest = z.object({
  tenantId: z.number().int().positive(),
  orgUnitId: z.number().int().positive(),
  token: z.string().min(32),
  tenantOrigin: z.string().url(),
});
export type PairRequest = z.infer<typeof PairRequest>;

export const LoadedPrinter = z.object({
  name: z.string(),
  language: z.enum(["PDF", "ZPL", "ESC_POS"]),
  mediaWidthMm: z.number().nullable(),
  mediaHeightMm: z.number().nullable(),
  mediaKind: z.string().nullable(),
  isDefault: z.boolean(),
  online: z.boolean(),
});
export type LoadedPrinter = z.infer<typeof LoadedPrinter>;

export const HealthResponse = z.object({
  version: z.string(),
  os: z.string(),
  loadedPrinters: z.array(LoadedPrinter),
  tenantId: z.number().nullable(),
  orgUnitId: z.number().nullable(),
  uptimeSeconds: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ErrorResponse = z.object({
  error: z.string(),
  errorCode: z.nativeEnum(ErrorCode),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const PrintLanguage = z.enum(["PDF", "ZPL", "ESC_POS"]);
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
