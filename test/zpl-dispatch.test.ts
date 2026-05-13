import { describe, it, expect, vi } from "vitest";
import { dispatchZpl } from "../src/main/dispatcher/zpl";
import type { PrinterLookup } from "../src/main/dispatcher/printers";
import type { PrintRequest } from "../src/shared/protocol";

const ZPL = "^XA^FO20,20^FDhello^FS^XZ";
const PAYLOAD = Buffer.from(ZPL, "utf-8").toString("base64");

const req = (overrides: Partial<PrintRequest> = {}): PrintRequest => ({
  printerName: "Zebra-net",
  language: "ZPL",
  payloadBase64: PAYLOAD,
  copies: 1,
  jobRef: 7,
  ...overrides,
});

const validateOk = vi.fn(async () => ({ ok: true as const }));

describe("dispatchZpl", () => {
  it("routes to sendNetwork for network printers and writes once per copy", async () => {
    const sendNetwork = vi.fn(async () => undefined);
    const sendLocalRaw = vi.fn(async () => undefined);
    const lookup = vi.fn(
      (): PrinterLookup => ({
        kind: "network",
        record: {
          name: "Zebra-net",
          ip: "192.168.1.30",
          port: 9100,
          language: "ZPL",
          mediaWidthMm: null,
          mediaHeightMm: null,
          mediaKind: null,
        },
      }),
    );

    const result = await dispatchZpl(req({ copies: 3 }), {
      validate: validateOk,
      sendNetwork,
      sendLocalRaw,
      lookup,
    });
    expect(result).toEqual({ dispatched: true, copiesAcknowledged: 3 });
    expect(sendNetwork).toHaveBeenCalledTimes(3);
    expect(sendLocalRaw).not.toHaveBeenCalled();
    expect(sendNetwork).toHaveBeenCalledWith("192.168.1.30", 9100, expect.any(Buffer));
  });

  it("routes to sendLocalRaw for OS printers", async () => {
    const sendNetwork = vi.fn(async () => undefined);
    const sendLocalRaw = vi.fn(async () => undefined);
    const lookup = vi.fn(
      (): PrinterLookup => ({
        kind: "os",
        record: {
          name: "Zebra-USB",
          language: "ZPL",
          mediaWidthMm: null,
          mediaHeightMm: null,
          mediaKind: null,
          isDefault: false,
          online: true,
        },
      }),
    );
    const result = await dispatchZpl(req({ printerName: "Zebra-USB" }), {
      validate: validateOk,
      sendNetwork,
      sendLocalRaw,
      lookup,
    });
    expect(result.dispatched).toBe(true);
    expect(sendLocalRaw).toHaveBeenCalledOnce();
    expect(sendNetwork).not.toHaveBeenCalled();
  });

  it("returns PRINTER_NOT_FOUND when printer is unknown", async () => {
    const result = await dispatchZpl(req(), {
      validate: validateOk,
      lookup: () => null,
      sendNetwork: vi.fn(),
      sendLocalRaw: vi.fn(),
    });
    expect(result).toMatchObject({
      dispatched: false,
      copiesAcknowledged: 0,
      errorCode: "PRINTER_NOT_FOUND",
    });
  });

  it("returns BAD_PAYLOAD when labelary rejects the ZPL", async () => {
    const result = await dispatchZpl(req(), {
      validate: async () => ({ ok: false, reason: "Unknown command" }),
      sendNetwork: vi.fn(),
      sendLocalRaw: vi.fn(),
      lookup: (): PrinterLookup => ({
        kind: "network",
        record: { name: "Zebra-net", ip: "1.2.3.4", port: 9100, language: "ZPL", mediaWidthMm: null, mediaHeightMm: null, mediaKind: null },
      }),
    });
    expect(result).toMatchObject({
      dispatched: false,
      errorCode: "BAD_PAYLOAD",
      error: "Unknown command",
    });
  });

  it("maps ECONNREFUSED to PRINTER_OFFLINE", async () => {
    const result = await dispatchZpl(req(), {
      validate: validateOk,
      sendNetwork: async () => {
        throw new Error("connect ECONNREFUSED 192.168.1.30:9100");
      },
      sendLocalRaw: vi.fn(),
      lookup: (): PrinterLookup => ({
        kind: "network",
        record: { name: "Zebra-net", ip: "192.168.1.30", port: 9100, language: "ZPL", mediaWidthMm: null, mediaHeightMm: null, mediaKind: null },
      }),
    });
    expect(result).toMatchObject({
      dispatched: false,
      errorCode: "PRINTER_OFFLINE",
    });
  });

  it("maps lp 'no such printer' to PRINTER_NOT_FOUND", async () => {
    const result = await dispatchZpl(req({ printerName: "Zebra-USB" }), {
      validate: validateOk,
      sendNetwork: vi.fn(),
      sendLocalRaw: async () => {
        throw new Error("lp: error - No such printer or class.");
      },
      lookup: (): PrinterLookup => ({
        kind: "os",
        record: {
          name: "Zebra-USB",
          language: "ZPL",
          mediaWidthMm: null,
          mediaHeightMm: null,
          mediaKind: null,
          isDefault: false,
          online: true,
        },
      }),
    });
    expect(result.errorCode).toBe("PRINTER_NOT_FOUND");
  });
});
