export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  PRINTER_NOT_FOUND: "PRINTER_NOT_FOUND",
  PRINTER_OFFLINE: "PRINTER_OFFLINE",
  MEDIA_OUT: "MEDIA_OUT",
  RIBBON_OUT: "RIBBON_OUT",
  BAD_PAYLOAD: "BAD_PAYLOAD",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
