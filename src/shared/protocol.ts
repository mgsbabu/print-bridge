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
